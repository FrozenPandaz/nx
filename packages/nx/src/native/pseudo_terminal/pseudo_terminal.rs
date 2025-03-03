use super::os;
use crate::native::pseudo_terminal::child_process::ChildProcess;
use anyhow::anyhow;
use crossbeam_channel::{bounded, unbounded, Receiver};
use crossterm::{
    terminal,
    terminal::{disable_raw_mode, enable_raw_mode},
    tty::IsTty,
};
use portable_pty::{CommandBuilder, NativePtySystem, PtyPair, PtySize, PtySystem};
use std::sync::{LockResult, Mutex, PoisonError, RwLock, RwLockReadGuard};
use std::{
    collections::HashMap,
    io,
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};
use tracing::log::trace;
use vt100_ctt::{Parser, Screen};

pub struct PseudoTerminalOptions {
    pub rows: u16,
    pub cols: u16,
    pub writable: bool,
}

impl PseudoTerminalOptions {
    pub fn default() -> Self {
        let (w, h) = terminal::size().unwrap_or((80, 24));
        Self {
            rows: h,
            cols: w,
            writable: true,
        }
    }
}

pub struct PseudoTerminal {
    pty_pair: PtyPair,
    parser: Arc<RwLock<Parser>>,
    pub writer: Option<Arc<Mutex<Box<dyn Write + Send>>>>,
    message_rx: Receiver<String>,
    printing_rx: Receiver<()>,
    pub quiet: Arc<AtomicBool>,
    pub running: Arc<AtomicBool>,
}

impl PseudoTerminal {
    pub fn default() -> napi::Result<Self> {
        Self::new(PseudoTerminalOptions::default())
    }

    pub fn new(options: PseudoTerminalOptions) -> napi::Result<Self> {
        let quiet = Arc::new(AtomicBool::new(true));
        let running = Arc::new(AtomicBool::new(false));

        let pty_system = NativePtySystem::default();

        let rows = options.rows;
        let cols = options.cols;

        trace!("Opening Pseudo Terminal");
        let pty_pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let parser = Arc::new(RwLock::new(Parser::new(rows, cols, 10000)));
        let parser_clone = parser.clone();

        let mut writer = if options.writable {
            let mut pty_writer = pty_pair.master.take_writer()?;
            let writer = Arc::new(Mutex::new(pty_writer));
            let mut writer_clone = writer.clone();
            // Stdin -> pty stdin
            if std::io::stdout().is_tty() {
                trace!("Passing through stdin");
                std::thread::spawn(move || {
                    let mut stdin = std::io::stdin();
                    let mut writer_lock = writer_clone.lock();
                    let writer = writer_lock.as_mut().expect("Failed to get writer");
                    if let Err(e) = os::write_to_pty(&mut stdin, &mut **writer) {
                        trace!("Error writing to pty: {:?}", e);
                    }
                });
            }
            Some(writer)
        } else {
            None
        };

        let mut reader = pty_pair.master.try_clone_reader()?;
        let (message_tx, message_rx) = unbounded();
        let (printing_tx, printing_rx) = unbounded();
        // Output -> stdout handling
        let quiet_clone = quiet.clone();
        let running_clone = running.clone();
        std::thread::spawn(move || {
            let mut stdout = std::io::stdout();
            let mut buf = [0; 8 * 1024];

            let prev_screen = parser_clone.read().unwrap().screen();
            'read_loop: loop {
                if let Ok(len) = reader.read(&mut buf) {
                    if len == 0 {
                        break;
                    }
                    message_tx
                        .send(String::from_utf8_lossy(&buf[0..len]).to_string())
                        .ok();
                    let mut parser = parser_clone.write().unwrap();
                    parser.process(&buf);
                    let quiet = quiet_clone.load(Ordering::Relaxed);
                    trace!("Quiet: {}", quiet);
                    if !quiet {
                        let mut content = String::from_utf8_lossy(&buf[0..len]).to_string();
                        parser.screen().contents_diff(&prev_screen);
                        if content.contains("\x1B[6n") {
                            trace!("Prevented terminal escape sequence ESC[6n from being printed.");
                            content = content.replace("\x1B[6n", "");
                        }
                        let mut logged_interrupted_error = false;
                        while let Err(e) = stdout.write_all(content.as_bytes()) {
                            match e.kind() {
                                std::io::ErrorKind::Interrupted => {
                                    if !logged_interrupted_error {
                                        trace!("Interrupted error writing to stdout: {:?}", e);
                                        logged_interrupted_error = true;
                                    }
                                    continue;
                                }
                                _ => {
                                    // We should figure out what to do for more error types as they appear.
                                    trace!("Error writing to stdout: {:?}", e);
                                    trace!("Error kind: {:?}", e.kind());
                                    break 'read_loop;
                                }
                            }
                        }
                        let _ = stdout.flush();
                    }
                }
                if !running_clone.load(Ordering::SeqCst) {
                    printing_tx.send(()).ok();
                }
            }

            printing_tx.send(()).ok();
        });
        Ok(Self {
            parser,
            writer,
            quiet,
            running,
            pty_pair,
            message_rx,
            printing_rx,
        })
    }

    pub fn get_state(&self) -> RwLockReadGuard<'_, Parser> {
        self.parser.read().expect("Could not get parser state")
    }

    pub fn run_command(
        &self,
        command: String,
        command_dir: Option<String>,
        js_env: Option<HashMap<String, String>>,
        exec_argv: Option<Vec<String>>,
        quiet: Option<bool>,
        tty: Option<bool>,
    ) -> napi::Result<ChildProcess> {
        let command_dir = get_directory(command_dir)?;

        let pair = &self.pty_pair;

        let quiet = quiet.unwrap_or(false);

        self.quiet.store(quiet, Ordering::Relaxed);

        let mut cmd = command_builder();
        cmd.arg(command.as_str());
        cmd.cwd(command_dir);

        if let Some(js_env) = js_env {
            for (key, value) in js_env {
                cmd.env(key, value);
            }
        }

        if let Some(exec_argv) = exec_argv {
            cmd.env("NX_PSEUDO_TERMINAL_EXEC_ARGV", exec_argv.join("|"));
        }

        let (exit_to_process_tx, exit_to_process_rx) = bounded(1);
        trace!("Running {}", command);
        let mut child = pair.slave.spawn_command(cmd)?;
        self.running.store(true, Ordering::SeqCst);
        let is_tty = tty.unwrap_or_else(|| std::io::stdout().is_tty());
        if is_tty {
            trace!("Enabling raw mode");
            enable_raw_mode().expect("Failed to enter raw terminal mode");
        }
        let process_killer = child.clone_killer();

        trace!("Getting running clone");
        let running_clone = self.running.clone();
        trace!("Getting printing_rx clone");
        let printing_rx = self.printing_rx.clone();

        trace!("spawning thread to wait for command");
        std::thread::spawn(move || {
            trace!("Waiting for {}", command);

            let res = child.wait();
            if let Ok(exit) = res {
                trace!("{} Exited", command);
                // This mitigates the issues with ConPTY on windows and makes it work.
                running_clone.store(false, Ordering::SeqCst);
                if cfg!(windows) {
                    trace!("Waiting for printing to finish");
                    let timeout = 500;
                    let a = Instant::now();
                    loop {
                        if printing_rx.try_recv().is_ok() {
                            break;
                        }
                        if a.elapsed().as_millis() > timeout {
                            break;
                        }
                    }
                    trace!("Printing finished");
                }
                if is_tty {
                    trace!("Disabling raw mode");
                    disable_raw_mode().expect("Failed to restore non-raw terminal");
                }
                exit_to_process_tx.send(exit).ok();
            } else {
                trace!("Error waiting for {}", command);
            };
        });

        trace!("Returning ChildProcess");
        Ok(ChildProcess::new(
            process_killer,
            self.message_rx.clone(),
            exit_to_process_rx,
        ))
    }

    pub fn resize(&mut self, rows: u16, cols: u16) -> io::Result<()> {
        // Ensure minimum sizes
        let rows = rows.max(3);
        let cols = cols.max(20);

        // Get current dimensions before resize
        let (old_rows, _) = self.get_state().screen().size();

        // Create a new parser with the new dimensions while preserving state
        if let Ok(mut parser_guard) = self.parser.write() {
            let raw_output = parser_guard.get_raw_output().to_vec();

            // Create new parser with new dimensions
            let mut new_parser = Parser::new(rows, cols, 10000);
            new_parser.process(&raw_output);

            // If we lost height, scroll up by that amount to maintain relative view position
            if rows < old_rows {
                let lines_lost = (old_rows - rows) as usize;
                let current = new_parser.screen().scrollback();
                // Adjust by -1 to ensure that the cursor is consistently at the bottom of the visible output on resize
                new_parser
                    .screen_mut()
                    .set_scrollback(current + lines_lost - 1);
            }

            *parser_guard = new_parser;
        }

        Ok(())
    }

    pub fn write_input(&mut self, input: &[u8]) -> io::Result<()> {
        if let Some(writer) = &self.writer {
            if let Ok(mut writer_guard) = writer.lock() {
                writer_guard.write_all(input)?;
                writer_guard.flush()?;
            }
        }
        Ok(())
    }

    pub fn scroll_up(&mut self) {
        if let Ok(mut parser) = self.parser.write() {
            let current = parser.screen().scrollback();
            parser.screen_mut().set_scrollback(current + 1);
        }
    }

    pub fn scroll_down(&mut self) {
        if let Ok(mut parser) = self.parser.write() {
            let current = parser.screen().scrollback();
            if current > 0 {
                parser.screen_mut().set_scrollback(current - 1);
            }
        }
    }

    pub fn get_screen(&self) -> Option<Screen> {
        self.parser.read().ok().map(|p| p.screen().clone())
    }

    pub fn get_scroll_offset(&self) -> usize {
        if let Ok(parser) = self.parser.read() {
            return parser.screen().scrollback();
        }
        0
    }

    pub fn get_total_content_rows(&self) -> usize {
        if let Ok(parser) = self.parser.read() {
            let screen = parser.screen();
            screen.get_total_content_rows()
        } else {
            0
        }
    }
}

fn get_directory(command_dir: Option<String>) -> anyhow::Result<String> {
    if let Some(command_dir) = command_dir {
        Ok(command_dir)
    } else {
        std::env::current_dir()
            .map(|v| v.to_string_lossy().to_string())
            .map_err(|_| {
                anyhow!("failed to get current directory, please specify command_dir explicitly")
            })
    }
}

fn command_builder() -> CommandBuilder {
    if cfg!(windows) {
        let comspec = std::env::var("COMSPEC");
        let shell = comspec
            .as_ref()
            .map(|v| v.as_str())
            .unwrap_or_else(|_| "cmd.exe");
        let mut command = CommandBuilder::new(shell);
        command.arg("/C");

        command
    } else {
        let mut command = CommandBuilder::new("sh");
        command.arg("-c");
        command
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn can_run_commands() {
        let mut i = 0;
        let pseudo_terminal = create_pseudo_terminal().unwrap();
        while i < 10 {
            println!("Running {}", i);
            let cp1 =
                run_command(&pseudo_terminal, String::from("whoami"), None, None, None).unwrap();
            cp1.wait_receiver.recv().unwrap();
            i += 1;
        }
        drop(pseudo_terminal);
    }
}

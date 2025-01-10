import { ChildProcess, Serializable } from 'child_process';
import { signalToCode } from '../../utils/exit-codes';
import { Transform } from 'stream';
import * as chalk from 'chalk';
import { readFileSync } from 'fs';

export abstract class NodeChildProcess {
  abstract getResults(): Promise<{ code: number; terminalOutput: string }>;

  abstract onExit(cb: (code: number) => void): void;

  abstract send(message: Serializable): void;

  abstract kill(signal?: NodeJS.Signals | number): void;
}

export class NodeChildProcessWithNonDirectOutput implements NodeChildProcess {
  private terminalOutput: string;
  private exited = false;
  private exitCode: number;
  private exitCallbacks: Array<(code: number) => void> = [];

  constructor(
    private childProcess: ChildProcess,
    { streamOutput, prefix }: { streamOutput: boolean; prefix: string }
  ) {
    if (streamOutput) {
      if (process.env.NX_PREFIX_OUTPUT === 'true') {
        const color = getColor(prefix);
        const prefixText = `${prefix}:`;

        this.childProcess.stdout
          .pipe(logClearLineToPrefixTransformer(color.bold(prefixText) + ' '))
          .pipe(addPrefixTransformer(color.bold(prefixText)))
          .pipe(process.stdout);
        this.childProcess.stderr
          .pipe(logClearLineToPrefixTransformer(color(prefixText) + ' '))
          .pipe(addPrefixTransformer(color(prefixText)))
          .pipe(process.stderr);
      } else {
        this.childProcess.stdout
          .pipe(addPrefixTransformer())
          .pipe(process.stdout);
        this.childProcess.stderr
          .pipe(addPrefixTransformer())
          .pipe(process.stderr);
      }

      this.onExit(() => {
        for (const cb of this.exitCallbacks) {
          cb(this.exitCode);
        }
      });
    }

    // Re-emit any messages from the task process
    this.childProcess.on('message', (message) => {
      if (process.send) {
        process.send(message);
      }
    });

    this.childProcess.stdout.on('data', (chunk) => {
      this.terminalOutput += chunk.toString();
    });
    this.childProcess.stderr.on('data', (chunk) => {
      this.terminalOutput += chunk.toString();
    });
  }

  onExit(cb: (code: number) => void) {
    this.exitCallbacks.push(cb);
  }

  async getResults(): Promise<{ code: number; terminalOutput: string }> {
    const code = await this.waitForExit();
    return { code, terminalOutput: this.terminalOutput };
  }

  send(message: Serializable): void {
    if (this.childProcess.connected) {
      this.childProcess.send(message);
    }
  }

  public kill(signal?: NodeJS.Signals | number) {
    if (this.childProcess.connected) {
      this.childProcess.kill(signal);
    }
  }

  private async waitForExit(): Promise<number> {
    if (this.exited) {
      return this.exitCode;
    }

    const [exitCode] = await Promise.all([
      new Promise<number>((res) => {
        this.childProcess.on('exit', (code, signal) => {
          if (code === null) code = signalToCode(signal);
          res(code);
        });
      }),
      new Promise<void>((res) => {
        this.childProcess.stdout.on('end', () => {
          res();
        });
      }),
      new Promise<void>((res) => {
        this.childProcess.stderr.on('end', () => {
          res();
        });
      }),
    ]);

    this.exited = true;
    this.exitCode = exitCode;

    return exitCode;
  }
}

function addPrefixTransformer(prefix?: string) {
  const newLineSeparator = process.platform.startsWith('win') ? '\r\n' : '\n';
  return new Transform({
    transform(chunk, _encoding, callback) {
      const list = chunk.toString().split(/\r\n|[\n\v\f\r\x85\u2028\u2029]/g);
      list
        .filter(Boolean)
        .forEach((m) =>
          this.push(
            prefix ? prefix + ' ' + m + newLineSeparator : m + newLineSeparator
          )
        );
      callback();
    },
  });
}

const colors = [
  chalk.green,
  chalk.greenBright,
  chalk.red,
  chalk.redBright,
  chalk.cyan,
  chalk.cyanBright,
  chalk.yellow,
  chalk.yellowBright,
  chalk.magenta,
  chalk.magentaBright,
];

function getColor(projectName: string) {
  let code = 0;
  for (let i = 0; i < projectName.length; ++i) {
    code += projectName.charCodeAt(i);
  }
  const colorIndex = code % colors.length;

  return colors[colorIndex];
}

/**
 * Prevents terminal escape sequence from clearing line prefix.
 */
function logClearLineToPrefixTransformer(prefix: string) {
  let prevChunk = null;
  return new Transform({
    transform(chunk, _encoding, callback) {
      if (prevChunk && prevChunk.toString() === '\x1b[2K') {
        chunk = chunk.toString().replace(/\x1b\[1G/g, (m) => m + prefix);
      }
      this.push(chunk);
      prevChunk = chunk;
      callback();
    },
  });
}

export class NodeChildProcessWithDirectOutput implements NodeChildProcess {
  private terminalOutput = '';
  private exitCallbacks: Array<(code: number, signal: string) => void> = [];

  private exited = false;
  private exitCode: number;

  constructor(
    private childProcess: ChildProcess,
    { temporaryOutputPath }: { temporaryOutputPath: string }
  ) {
    // Re-emit any messages from the task process
    this.childProcess.on('message', (message) => {
      if (process.send) {
        process.send(message);
      }
    });

    this.childProcess.on('exit', (code, signal) => {
      if (code === null) code = signalToCode(signal);

      this.exited = true;
      this.exitCode = code;

      for (const cb of this.exitCallbacks) {
        cb(code, signal);
      }
    });

    this.onExit(() => {
      this.terminalOutput = readFileSync(temporaryOutputPath).toString();
    });
  }

  send(message: Serializable): void {
    if (this.childProcess.connected) {
      this.childProcess.send(message);
    }
  }

  onExit(cb: (code: number, signal: NodeJS.Signals) => void) {
    this.exitCallbacks.push(cb);
  }

  async getResults(): Promise<{ code: number; terminalOutput: string }> {
    if (this.exited) {
      return Promise.resolve({
        code: this.exitCode,
        terminalOutput: this.terminalOutput,
      });
    }
    await this.waitForExit();
    return Promise.resolve({
      code: this.exitCode,
      terminalOutput: this.terminalOutput,
    });
  }

  waitForExit() {
    return new Promise<void>((res) => {
      this.onExit(() => res());
    });
  }

  getTerminalOutput() {
    return this.terminalOutput;
  }

  kill(signal?: NodeJS.Signals | number): void {
    if (this.childProcess.connected) {
      this.childProcess.kill(signal);
    }
  }
}

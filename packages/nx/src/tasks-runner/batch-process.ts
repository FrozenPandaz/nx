import {
  BatchMessage,
  BatchMessageType,
  BatchResults,
} from './batch/batch-messages';
import { ChildProcess, Serializable } from 'child_process';
import { signalToCode } from '../utils/exit-codes';

export class BatchProcess {
  private results: BatchResults;
  private exitCallbacks: Array<(code: number) => void> = [];
  private exited = false;
  private exitCode: number;

  constructor(
    private childProcess: ChildProcess,
    private executorName: string
  ) {
    this.childProcess.on('message', (message: BatchMessage) => {
      switch (message.type) {
        case BatchMessageType.CompleteBatchExecution: {
          this.results = message.results;
          break;
        }
        case BatchMessageType.RunTasks: {
          break;
        }
        default: {
          // Re-emit any non-batch messages from the task process
          if (process.send) {
            process.send(message);
          }
        }
      }
    });

    this.childProcess.once('exit', (code, signal) => {
      if (code === null) code = signalToCode(signal);

      this.exited = true;
      this.exitCode = code;

      for (const cb of this.exitCallbacks) {
        cb(code);
      }
    });
  }

  onExit(cb: (code: number) => void) {
    this.exitCallbacks.push(cb);
  }

  async getResults(): Promise<BatchResults> {
    if (this.exited) {
      return this.results;
    }
    await new Promise((res) => {
      this.onExit(res);
    });

    if (this.exitCode !== 0) {
      throw Error(
        `"${this.executorName}" exited unexpectedly with code: ${this.exitCode}`
      );
    }
  }

  send(message: Serializable): void {
    if (this.childProcess.connected) {
      this.childProcess.send(message);
    }
  }

  kill(signal?: NodeJS.Signals | number): void {
    if (this.childProcess.connected) {
      this.childProcess.kill(signal);
    }
  }
}

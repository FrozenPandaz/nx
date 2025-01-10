import { writeFileSync } from 'fs';

export class NoopChildProcess {
  constructor(private results: { code: number; terminalOutput: string }) {}

  async getResults(): Promise<{ code: number; terminalOutput: string }> {
    return this.results;
  }

  kill(): void {
    return;
  }

  onExit(cb: (code: number) => void): void {
    cb(this.results.code);
  }
}

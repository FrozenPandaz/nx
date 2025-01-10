import { PseudoTtyProcess } from '../pseudo-terminal';
import { NodeChildProcess } from './node-child-process';
import { NoopChildProcess } from './noop-child-process';

export type RunningTask =
  | NodeChildProcess
  | PseudoTtyProcess
  | NoopChildProcess;

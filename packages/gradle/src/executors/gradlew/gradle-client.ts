import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { readJsonFile } from 'nx/src/utils/fileutils';

const [_, __, workspaceRoot, outDir] = process.argv;

const batchRunnerPath = join(
  __dirname,
  '../../../batch-runner/build/libs/nx-batch-runner.jar'
);
console.log('starting');
const gradleConnection = spawn(
  `java`,
  [
    '-jar',
    `${batchRunnerPath}`,
    '--ipc',
    `--workspaceRoot=${workspaceRoot}`,
    `--output=${outDir}`,
  ],
  {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  }
);

console.log('waiting for output');
gradleConnection.stdout.on('data', (chunk) => {
  console.log(chunk.toString());
  const line = chunk.toString();

  if (chunk.toString().includes('Kotlin CLI started.')) {
    start();
    return;
  }

  if (line.startsWith('{')) {
    const result = JSON.parse(line);
    if (result.task === ':batch-runner:build') {
      // const r = JSON.parse(readFileSync(result.path, 'utf8'));
      // const data = r[':batch-runner:build'];
      console.log(result.terminalOutput);
    }
  }
});

process.on('message', (message) => {
  // const { task } = message;
});

function start() {
  // process.send({ ready: true });
  for (let i = 0; i < 10; i++) {
    gradleConnection.stdin.write(':batch-runner:build\n');
  }
}

// export class GradleClient {
//   constructor() {
//     const { pid } = readJsonFile(join(__dirname, 'pid.json'));
//   }
// }

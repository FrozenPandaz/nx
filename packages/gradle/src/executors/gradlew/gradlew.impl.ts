import { ExecutorContext, TaskGraph } from '@nx/devkit';
import runCommandsImpl, {
  RunCommandsOptions,
} from 'nx/src/executors/run-commands/run-commands.impl';
import { BatchResults } from 'nx/src/tasks-runner/batch/batch-messages';
import { GraldewExecutorSchema } from './schema';
import { execGradleAsync, findGraldewFile } from '../../utils/exec-gradle';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import { workspaceDataDirectory } from 'nx/src/utils/cache-directory';

export async function graldewExecutor(
  options: GraldewExecutorSchema,
  context: ExecutorContext
): Promise<{ success: boolean }> {
  const root = context.root;
  const gradlewPath = findGraldewFile(root);
  try {
    process.stdout.write(output);
    return { success: true };
  } catch (e) {
    process.stdout.write(e);
    return { success: false };
  }
}

export default graldewExecutor;

interface GradleBatchResults {
  [taskName: string]: {
    success: boolean;
    terminalOutput: string;
  };
}

export const batchRunnerPath = join(
  __dirname,
  '../../../batch-runner/build/libs/nx-batch-runner.jar'
);
export async function batchGradlew(
  taskGraph: TaskGraph,
  inputs: Record<string, GraldewExecutorSchema>,
  overrides: RunCommandsOptions,
  context: ExecutorContext
): Promise<BatchResults> {
  const rootTaskNames = taskGraph.roots.map((root) => inputs[root].taskNames);
  const root = context.root;
  const gradlewPath = findGraldewFile(root);
  const outputPath = join(workspaceDataDirectory, 'gradle-task-outputs.json');

  execSync(
    `java -jar ${batchRunnerPath} --tasks=${rootTaskNames.join(
      ','
    )} --workspaceRoot=${dirname(gradlewPath)} --args=${
      overrides?.args
    } --outputPath=${outputPath}`
  );

  const results: GradleBatchResults = require(outputPath);

  console.log(results);

  return results;
}

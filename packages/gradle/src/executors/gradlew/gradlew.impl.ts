import { ExecutorContext, TaskGraph } from '@nx/devkit';
import runCommandsImpl, {
  RunCommandsOptions,
} from 'nx/src/executors/run-commands/run-commands.impl';
import { BatchResults } from 'nx/src/tasks-runner/batch/batch-messages';
import { GraldewExecutorSchema } from './schema';
import { execGradleAsync, findGraldewFile } from '../../utils/exec-gradle';
import { dirname, join } from 'path';
import { execSync } from 'child_process';

export async function graldewExecutor(
  options: GraldewExecutorSchema,
  context: ExecutorContext
): Promise<{ success: boolean }> {
  const root = context.root;
  const gradlewPath = findGraldewFile(root);
  try {
    const output = await execGradleAsync(
      gradlewPath,
      [...options.taskNames, ...options.args],
    );

    process.stdout.write(output);
    return { success: true };
  } catch (e) {
    process.stdout.write(e);
    return { success: false };
  }
}

export default graldewExecutor;

export const batchRunnerPath = join(__dirname, '../../../batch-runner/build/libs/nx-batch-runner.jar');
export async function batchGradlew(
  taskGraph: TaskGraph,
  inputs: Record<string, GraldewExecutorSchema>,
  overrides: RunCommandsOptions,
  context: ExecutorContext
): Promise<BatchResults> {

  const rootTaskNames = taskGraph.roots.map(root => inputs[root].taskNames);
  const root = context.root;
  const gradlewPath = findGraldewFile(root);

  execSync(`java -jar ${batchRunnerPath} --tasks=${rootTaskNames.join(',')} --workspaceRoot=${dirname(gradlewPath)} --args=${overrides?.args}`);
 
}

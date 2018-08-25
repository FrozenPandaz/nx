import {
  BuildEvent,
  Builder,
  BuilderConfiguration,
  BuilderContext
} from '@angular-devkit/architect';
import { ChildProcess, fork } from 'child_process';
import * as treeKill from 'tree-kill';

import { Observable, bindCallback, of } from 'rxjs';
import { concatMap, tap, map } from 'rxjs/operators';

import {
  BuildNodeBuilderOptions,
  NodeBuildEvent
} from '../build/node-build.builder';

export interface NodeExecuteBuilderOptions {
  inspect: boolean;
  args: string[];
  buildTarget: string;
}

export class NodeExecuteBuilder implements Builder<NodeExecuteBuilderOptions> {
  private subProcess: ChildProcess;

  constructor(private context: BuilderContext) {}

  run(
    target: BuilderConfiguration<NodeExecuteBuilderOptions>
  ): Observable<BuildEvent> {
    const options = target.options;

    return this.startBuild(options).pipe(
      concatMap((event: NodeBuildEvent) => {
        if (event.success) {
          return this.restartProcess(event.outfile, options).pipe(
            map(() => {
              return event;
            })
          );
        } else {
          this.context.logger.error(
            'There was an error with the build. See above.'
          );
          this.context.logger.info(`${event.outfile} was not restarted.`);
          return of(event);
        }
      })
    );
  }

  private runProcess(file: string, options: NodeExecuteBuilderOptions) {
    if (this.subProcess) {
      throw new Error('Already running');
    }
    this.subProcess = fork(file, options.args, {
      execArgv: options.inspect ? ['--inspect'] : []
    });
  }

  private restartProcess(file: string, options: NodeExecuteBuilderOptions) {
    const obs$ = this.subProcess ? this.killProcess() : of(undefined);
    return obs$.pipe(
      tap(() => {
        this.runProcess(file, options);
      })
    );
  }

  private killProcess() {
    const observableTreeKill = bindCallback(treeKill);
    return observableTreeKill(this.subProcess.pid, 'SIGTERM').pipe(
      tap(err => {
        if (!err) {
          this.subProcess = null;
        }
      })
    );
  }

  private startBuild(
    options: NodeExecuteBuilderOptions
  ): Observable<NodeBuildEvent> {
    const builderConfig = this._getBuildBuilderConfig(options);

    return this.context.architect
      .getBuilderDescription(builderConfig)
      .pipe(
        concatMap(buildDescription =>
          this.context.architect.validateBuilderOptions(
            builderConfig,
            buildDescription
          )
        ),
        concatMap(
          builderConfig =>
            this.context.architect.run(
              builderConfig,
              this.context
            ) as Observable<NodeBuildEvent>
        )
      );
  }

  private _getBuildBuilderConfig(options: NodeExecuteBuilderOptions) {
    const [project, target, configuration] = options.buildTarget.split(':');

    return this.context.architect.getBuilderConfiguration<
      BuildNodeBuilderOptions
    >({
      project,
      target,
      configuration,
      overrides: {
        watch: true
      }
    });
  }
}

export default NodeExecuteBuilder;

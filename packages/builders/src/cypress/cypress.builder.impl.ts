import {
  createBuilder,
  BuilderContext,
  BuilderOutput,
  BuilderRun,
  scheduleTargetAndForget
} from '@angular-devkit/architect/src/index2';
import { Observable, of, Subscriber, noop, from } from 'rxjs';
import {
  catchError,
  concatMap,
  tap,
  map,
  take,
  switchMap
} from 'rxjs/operators';
import { ChildProcess, fork } from 'child_process';
import { copySync, removeSync } from 'fs-extra';
import { fromPromise } from 'rxjs/internal-compatibility';
import { Schema as DevServerBuilderSchema } from '@angular-devkit/build-angular/src/dev-server/schema';
import { readFile } from '@angular-devkit/schematics/tools/file-system-utility';
import { JsonObject } from '@angular-devkit/core';
import * as path from 'path';
import * as url from 'url';
import * as treeKill from 'tree-kill';
const Cypress = require('cypress'); // @NOTE: Importing via ES6 messes the whole test dependencies.

export interface CypressBuilderOptions {
  baseUrl: string;
  cypressConfig: string;
  devServerTarget: string;
  headless: boolean;
  record: boolean;
  tsConfig: string;
  watch: boolean;
  browser?: string;
}

try {
  require('dotenv').config();
} catch (e) {}

/**
 * @whatItDoes Implementation of the Cypress Builder, compile Typescript files,
 * build the devServer to serve the app then run Cypress e2e test runner.
 * The builder needs some information from the `angular.json` file:
 * @example:
```
 "my-app-e2e": {
    "root": "apps/my-app-e2e/",
    "projectType": "application",
    "architect": {
      "e2e": {
        "builder": "@nrwl/builders:cypress",
        "options": {
          "cypressConfig": "apps/my-app-e2e/cypress.json",
          "tsConfig": "apps/my-app-e2e/tsconfig.json",
          "devServerTarget": "my-app:serve"
      },
      "configurations": {
        "production": {
          "devServerTarget": "my-app:serve:production"
        }
      }
      }
    }
 }

 
```
*
*/
let computedCypressBaseUrl: string;
let tscProcess: ChildProcess = null;

/**
 * @whatItDoes This is the starting point of the builder.
 * @param builderConfig
 */

/**
 * @whatItDoes Compile typescript spec files to be able to run Cypress.
 * The compilation is done via executing the `tsc` command line/
 * @param tsConfigPath
 * @param isWatching
 */
function compileTypescriptFiles(
  tsConfigPath: string,
  isWatching: boolean,
  context: BuilderContext
): Observable<BuilderOutput> {
  if (tscProcess) {
    killProcess(context);
  }
  const root = context.workspaceRoot;
  return Observable.create((subscriber: Subscriber<BuilderOutput>) => {
    try {
      let args = ['-p', tsConfigPath];
      const tscPath = path.join(root, '/node_modules/typescript/bin/tsc');
      if (isWatching) {
        args.push('--watch');
        tscProcess = fork(tscPath, args, { stdio: [0, 1, 2, 'ipc'] });
        subscriber.next({ success: true });
      } else {
        tscProcess = fork(tscPath, args, { stdio: [0, 1, 2, 'ipc'] });
        tscProcess.on('exit', code => {
          subscriber.next({ success: code === 0 });
          subscriber.complete();
        });
      }
    } catch (error) {
      if (tscProcess) {
        killProcess(context);
      }
      subscriber.error(
        new Error(`Could not compile Typescript files: \n ${error}`)
      );
    }
  });
}

/**
 * @whatItDoes Copy all the fixtures into the dist folder.
 * This is done because `tsc` doesn't handle `json` files.
 * @param tsConfigPath
 */
function copyCypressFixtures(tsConfigPath: string, cypressConfigPath: string) {
  const cypressConfig = JSON.parse(readFile(cypressConfigPath));
  // DOn't copy fixtures if cypress config does not have it set
  if (!cypressConfig.fixturesFolder) {
    return;
  }

  copySync(
    `${path.dirname(tsConfigPath)}/src/fixtures`,
    path.join(path.dirname(cypressConfigPath), cypressConfig.fixturesFolder),
    { overwrite: true }
  );
}

/**
 * @whatItDoes Initialize the Cypress test runner with the provided project configuration.
 * If `headless` is `false`: open the Cypress application, the user will
 * be able to interact directly with the application.
 * If `headless` is `true`: Cypress will run in headless mode and will
 * provide directly the results in the console output.
 * @param cypressConfig
 * @param headless
 * @param baseUrl
 * @param isWatching
 */
function initCypress(
  cypressConfig: string,
  headless: boolean,
  record: boolean,
  isWatching: boolean,
  baseUrl: string,
  browser?: string
): Observable<BuilderOutput> {
  // Cypress expects the folder where a `cypress.json` is present
  const projectFolderPath = path.dirname(cypressConfig);
  const options: any = {
    project: projectFolderPath
  };

  // If not, will use the `baseUrl` normally from `cypress.json`
  if (baseUrl || computedCypressBaseUrl) {
    options.config = { baseUrl: baseUrl || computedCypressBaseUrl };
  }

  if (browser) {
    options.browser = browser;
  }

  options.headed = !headless;
  options.record = record;

  return fromPromise<any>(
    !isWatching || headless ? Cypress.run(options) : Cypress.open(options)
  ).pipe(
    tap(() => (isWatching && !headless ? process.exit() : null)), // Forcing `cypress.open` to give back the terminal
    map(result => ({
      /**
       * `cypress.open` is returning `0` and is not of the same type as `cypress.run`.
       * `cypress.open` is the graphical UI, so it will be obvious to know what wasn't
       * working. Forcing the build to success when `cypress.open` is used.
       */
      success: result.hasOwnProperty(`totalFailed`)
        ? result.totalFailed === 0
        : true
    }))
  );
}

/**
 * @whatItDoes Compile the application using the webpack builder.
 * @param devServerTarget
 * @param isWatching
 * @function
 */
function startDevServer(
  devServerTarget: string,
  isWatching: boolean,
  context: BuilderContext
): Observable<BuilderOutput> {
  // TODO use architect export
  const [project, targetName, configuration] = devServerTarget.split(':');
  // Overrides dev server watch setting.
  const overrides = { watch: isWatching };
  const targetSpec = {
    project,
    target: targetName,
    configuration
  };
  const getDevServerBuilderOptions = async () => {
    const rawOptions = await context.getTargetOptions(targetSpec);
    const builderName = await context.getBuilderNameForTarget(targetSpec);
    return context.validateOptions(rawOptions, builderName);
  };
  return from(getDevServerBuilderOptions()).pipe(
    tap((options: Partial<DevServerBuilderSchema>) => {
      if (devServerTarget && options.publicHost) {
        let publicHost = options.publicHost;
        if (!/^\w+:\/\//.test(publicHost)) {
          publicHost = `${options.ssl ? 'https' : 'http'}://${publicHost}`;
        }
        const clientUrl = url.parse(publicHost);
        computedCypressBaseUrl = url.format(clientUrl);
      } else if (devServerTarget) {
        computedCypressBaseUrl = url.format({
          protocol: options.ssl ? 'https' : 'http',
          hostname: options.host,
          port: options.port.toString(),
          pathname: options.servePath || ''
        });
      }
    }),
    switchMap(() => {
      // return of({ success: true });
      return scheduleTargetAndForget(context, targetSpec, overrides);
    })
  );
}

function killProcess(context: BuilderContext): void {
  return treeKill(tscProcess.pid, 'SIGTERM', error => {
    tscProcess = null;
    if (error) {
      if (Array.isArray(error) && error[0] && error[2]) {
        const errorMessage = error[2];
        context.logger.error(errorMessage);
      } else if (error.message) {
        context.logger.error(error.message);
      }
    }
  });
}

// @angular/architect will change the type to be compatible
export default createBuilder<JsonObject & CypressBuilderOptions>(run as any);

function run(
  options: JsonObject & CypressBuilderOptions,
  context: BuilderContext
): Observable<BuilderOutput> {
  const tsconfigJson = JSON.parse(readFile(options.tsConfig));

  // Cleaning the /dist folder
  removeSync(
    path.join(
      path.dirname(options.tsConfig),
      tsconfigJson.compilerOptions.outDir
    )
  );

  return compileTypescriptFiles(options.tsConfig, options.watch, context).pipe(
    tap(() => copyCypressFixtures(options.tsConfig, options.cypressConfig)),
    concatMap(() =>
      !options.baseUrl && options.devServerTarget
        ? startDevServer(options.devServerTarget, options.watch, context)
        : of(null)
    ),
    concatMap(() =>
      initCypress(
        options.cypressConfig,
        options.headless,
        options.record,
        options.watch,
        options.baseUrl,
        options.browser
      )
    ),
    options.watch ? tap(noop) : take(1),
    catchError(error => {
      console.error(error);
      throw new Error(error);
    })
  );
}

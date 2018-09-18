import {
  chain,
  noop,
  SchematicContext,
  Tree,
  Rule,
  mergeWith,
  apply,
  url,
  template,
  move
} from '@angular-devkit/schematics';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks';
import { join } from '@angular-devkit/core';
import { updateJsonInTree } from '../../../utils/ast-utils';
import { nestVersion } from '../../../lib-versions';
import { NormalizedSchema } from '../schema';

function addInstall(host: Tree, context: SchematicContext) {
  context.addTask(new NodePackageInstallTask());
}

function createApplicationCode(options: NormalizedSchema): Rule {
  return (host: Tree, context: SchematicContext) => {
    host.delete(join(options.appProjectRoot, 'src/main.ts'));
    return mergeWith(
      apply(url('../files/nest'), [
        template({
          tmpl: '',
          name: options.name
        }),
        move(join(options.appProjectRoot, 'src'))
      ])
    )(host, context);
  };
}

function addDependencies(options: NormalizedSchema) {
  if (options.skipPackageJson) {
    return noop();
  }

  let needInstall = false;
  return chain([
    updateJsonInTree('package.json', json => {
      json.dependencies = json.dependencies || {};
      ['@nestjs/core', '@nestjs/common', '@nestjs/testing'].forEach(dep => {
        if (!json.dependencies[dep]) {
          needInstall = true;
          json.dependencies[dep] = nestVersion;
        }
      });
      return json;
    }),
    needInstall ? addInstall : noop()
  ]);
}

export function generateNestApp(options: NormalizedSchema): Rule {
  return chain([createApplicationCode(options), addDependencies(options)]);
}

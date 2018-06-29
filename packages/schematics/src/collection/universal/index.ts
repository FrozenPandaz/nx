import {
  chain,
  externalSchematic,
  Rule,
  SchematicContext,
  Tree
} from '@angular-devkit/schematics';
import { getProjectConfig, updateJsonInTree } from '../../utils/ast-utils';
import { join } from 'path';
import { SchematicsException } from '@angular-devkit/schematics';

function updateAngularJson(options: any) {
  return (host: Tree, context: SchematicContext) => {
    const project = getProjectConfig(host, options.clientProject);
    return updateJsonInTree('angular.json', json => {
      json.projects[
        options.clientProject
      ].architect.server.options.outputPath = join(
        project.architect.build.options.outputPath,
        '..',
        options.clientProject + '-server'
      );
      return json;
    })(host, context);
  };
}

function updateTsconfig(options: any) {
  return (host: Tree, context: SchematicContext) => {
    const project = getProjectConfig(host, options.clientProject);

    return updateJsonInTree(
      join(project.root, 'tsconfig.server.json'),
      json => {
        return {
          ...json,
          compilerOptions: {
            ...json.compilerOptions,
            baseUrl: undefined
          }
        };
      }
    )(host, context);
  };
}

function addDependencies() {
  return updateJsonInTree('package.json', json => {
    if (!json.dependencies['@angular/core']) {
      throw new SchematicsException('Could not find version of @angular/core');
    }
    return {
      ...json,
      dependencies: {
        ...json.dependencies,
        '@angular/http': json.dependencies['@angular/core']
      }
    };
  });
}

export default function universal(options: { clientProject: string }): Rule {
  return chain([
    externalSchematic('@schematics/angular', 'universal', options),
    updateTsconfig(options),
    updateAngularJson(options),
    addDependencies()
  ]);
}

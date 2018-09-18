import {
  chain,
  externalSchematic,
  Rule,
  Tree,
  SchematicContext,
  schematic,
  noop,
  move,
  mergeWith,
  apply,
  url,
  template
} from '@angular-devkit/schematics';
import { join, normalize, Path } from '@angular-devkit/core';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks';
import { Schema, NormalizedSchema } from './schema';
import { offsetFromRoot } from '../../utils/common';
import { replaceAppNameWithPath } from '../../utils/cli-config-utils';
import { excludeUnnecessaryFiles } from '../../utils/rules/filter-tree';
import { updateJsonInTree } from '../../utils/ast-utils';
import { toFileName } from '../../utils/name-utils';
import { nestVersion } from '../../lib-versions';
import { generateNestApp } from './rules/nestjs';

function createApplicationCode(options: NormalizedSchema): Rule {
  return (host: Tree, context: SchematicContext) => {
    host.delete(join(options.appProjectRoot, 'src/main.ts'));
    return mergeWith(
      apply(url('./files/nest'), [
        template({
          tmpl: '',
          name: options.name
        }),
        move(join(options.appProjectRoot, 'src'))
      ])
    )(host, context);
  };
}

function addInstall(host: Tree, context: SchematicContext) {
  context.addTask(new NodePackageInstallTask());
}

function addSource(options: NormalizedSchema) {
  switch (options.framework) {
    case 'apollo':
      return generateNestApp(options);
      break;
    case 'express':
      return generateNestApp(options);
      break;
    case 'nestjs':
      return generateNestApp(options);
      break;
    case 'none':
      return generateEmptyApp(options);
      break;
  }
}

function addDependencies(options: NormalizedSchema) {
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

function updateAppTsconfigJson(options: NormalizedSchema) {
  return updateJsonInTree(
    `${options.appProjectRoot}/tsconfig.app.json`,
    json => {
      return {
        ...json,
        extends: `${offsetFromRoot(options.appProjectRoot)}tsconfig.json`,
        compilerOptions: {
          ...json.compilerOptions,
          outDir: `${offsetFromRoot(options.appProjectRoot)}dist/out-tsc/${
            options.appProjectRoot
          }`
        },
        include: ['**/*.ts']
      };
    }
  );
}

function updateTslintJson(options: NormalizedSchema): Rule {
  return updateJsonInTree(`${options.appProjectRoot}/tslint.json`, json => {
    return {
      ...json,
      extends: `${offsetFromRoot(options.appProjectRoot)}tslint.json`,
      rules: {}
    };
  });
}

function updateNxJson(options: NormalizedSchema): Rule {
  return updateJsonInTree(`/nx.json`, json => {
    return {
      ...json,
      projects: {
        ...json.projects,
        [options.name]: { tags: options.parsedTags }
      }
    };
  });
}

function getBuildConfig(project: any, options: NormalizedSchema) {
  return {
    builder: '@nrwl/builders:node-build',
    options: {
      outputPath: join(normalize('dist'), options.appProjectRoot),
      main: join(project.sourceRoot, 'main.ts'),
      tsConfig: join(options.appProjectRoot, 'tsconfig.app.json')
    },
    configurations: {
      production: {
        optimization: true,
        extractLicenses: true,
        fileReplacements: [
          {
            replace: join(project.sourceRoot, 'environments/environment.ts'),
            with: join(project.sourceRoot, 'environments/environment.prod.ts')
          }
        ]
      }
    }
  };
}

function getServeConfig(options: NormalizedSchema) {
  return {
    builder: '@nrwl/builders:node-execute',
    options: {
      buildTarget: `${options.name}:build`
    }
  };
}

function updateAngularJson(options: NormalizedSchema): Rule {
  return updateJsonInTree('angular.json', angularJson => {
    const project = angularJson.projects[options.name];
    const fixedProject = replaceAppNameWithPath(
      project,
      options.name,
      options.appProjectRoot
    );
    delete fixedProject.architect.test;

    fixedProject.architect.build = getBuildConfig(fixedProject, options);
    fixedProject.architect.serve = getServeConfig(options);

    fixedProject.architect.lint.options.tsConfig = fixedProject.architect.lint.options.tsConfig.filter(
      path =>
        path !== join(normalize(options.appProjectRoot), 'tsconfig.spec.json')
    );
    angularJson.projects[options.name] = fixedProject;

    delete angularJson.projects[options.e2eProjectName];
    return angularJson;
  });
}

function removeE2e(options: NormalizedSchema): Rule {
  return (host: Tree) => {
    [
      'protractor.conf.js',
      'tsconfig.e2e.json',
      'src/app.e2e-spec.ts',
      'src/app.po.ts'
    ].forEach(path => {
      host.delete(join(options.e2eProjectRoot, path));
    });
    return host;
  };
}

function removeAppFiles(options: NormalizedSchema): Rule {
  return (host: Tree) => {
    [
      'src/main.ts',
      'src/favicon.ico',
      'src/index.html',
      'src/polyfills.ts',
      'src/styles.css',
      'browserslist',
      'src/app/app.module.ts',
      'src/app/app.component.ts',
      'src/app/app.component.spec.ts'
    ].forEach(path => {
      host.delete(join(options.appProjectRoot, path));
    });
    return host;
  };
}

function removeKarma(options: NormalizedSchema): Rule {
  return (host: Tree) => {
    host.delete(join(options.appProjectRoot, 'src/test.ts'));
    host.delete(join(options.appProjectRoot, 'tsconfig.spec.json'));
    host.delete(join(options.appProjectRoot, 'karma.conf.js'));
    return host;
  };
}

export default function(schema: Schema): Rule {
  return (host: Tree, context: SchematicContext) => {
    const options = normalizeOptions(schema);
    return chain([
      externalSchematic('@schematics/angular', 'application', {
        name: options.name,
        inlineStyle: true,
        inlineTemplate: true,
        skipPackageJson: true
      }),
      excludeUnnecessaryFiles(),
      move(options.e2eProjectName, options.e2eProjectRoot),
      move(options.name, options.appProjectRoot),
      removeE2e(options),
      removeAppFiles(options),
      removeKarma(options),
      updateAngularJson(options),
      updateNxJson(options),
      updateAppTsconfigJson(options),
      updateTslintJson(options),
      addSourceCode(options),
      options.unitTestRunner === 'jest'
        ? schematic('jest-project', {
            project: options.name,
            skipSetupFile: true
          })
        : noop()
    ])(host, context);
  };
}

function normalizeOptions(options: Schema): NormalizedSchema {
  const appDirectory = options.directory
    ? `${toFileName(options.directory)}/${toFileName(options.name)}`
    : toFileName(options.name);

  const appProjectName = appDirectory.replace(new RegExp('/', 'g'), '-');
  const e2eProjectName = `${appProjectName}-e2e`;

  const appProjectRoot = join(normalize('apps'), appDirectory);
  const e2eProjectRoot = join(normalize('apps'), appDirectory + '-e2e');

  const parsedTags = options.tags
    ? options.tags.split(',').map(s => s.trim())
    : [];

  return {
    ...options,
    name: appProjectName,
    appProjectRoot,
    e2eProjectRoot,
    e2eProjectName,
    parsedTags
  };
}

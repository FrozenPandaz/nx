import { SchematicTestRunner } from '@angular-devkit/schematics/testing';
import * as path from 'path';
import { Tree, VirtualTree } from '@angular-devkit/schematics';
import { createEmptyWorkspace } from '../../utils/testing-utils';
import { readJsonInTree } from '../../utils/ast-utils';
import { updateJsonInTree } from '@nrwl/schematics/src/utils/ast-utils';

describe('universal', () => {
  const schematicRunner = new SchematicTestRunner(
    '@nrwl/schematics',
    path.join(__dirname, '../../collection.json')
  );

  let appTree: Tree;

  beforeEach(() => {
    appTree = new VirtualTree();
    appTree = createEmptyWorkspace(appTree);
    appTree = schematicRunner.runSchematic(
      'application',
      {
        name: 'app1'
      },
      appTree
    );
  });

  it('should update tsconfig.server.json', () => {
    const result = schematicRunner.runSchematic(
      'universal',
      {
        clientProject: 'app1'
      },
      appTree
    );
    const tsConfig = readJsonInTree(result, 'apps/app1/tsconfig.server.json');
    expect(tsConfig.compilerOptions.baseUrl).toBeUndefined();
  });

  it('should update angular.json', () => {
    const result = schematicRunner.runSchematic(
      'universal',
      {
        clientProject: 'app1'
      },
      appTree
    );
    const angularJson = readJsonInTree(result, 'angular.json');
    expect(
      angularJson.projects.app1.architect.server.options.outputPath
    ).toEqual('dist/apps/app1-server');
  });

  it('should update package.json', () => {
    const result = schematicRunner.runSchematic(
      'universal',
      {
        clientProject: 'app1'
      },
      appTree
    );
    const packageJson = readJsonInTree(result, 'package.json');
    expect(packageJson.dependencies['@angular/http']).toEqual('0.0.0');
  });

  it('should throw an exception if there is no @angular/core dep', async done => {
    appTree = await schematicRunner
      .callRule(
        updateJsonInTree('package.json', json => {
          delete json.dependencies['@angular/core'];
          return json;
        }),
        appTree
      )
      .toPromise();
    try {
      schematicRunner.runSchematic(
        'universal',
        {
          clientProject: 'app1'
        },
        appTree
      );
      done.fail();
    } catch (e) {
      expect(e.message).toBe('Could not find version of @angular/core');
      done();
    }
  });
});

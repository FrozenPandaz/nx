import { SchematicTestRunner } from '@angular-devkit/schematics/testing';
import { Tree } from '@angular-devkit/schematics';

import * as path from 'path';

import { updateKarmaConf } from './update-karma-conf';
import { createEmptyWorkspace } from '../testing-utils';
import { updateJsonInTree } from '../ast-utils';

describe('updateKarmaConf', () => {
  let tree: Tree;
  let schematicRunner: SchematicTestRunner;
  beforeEach(done => {
    schematicRunner = new SchematicTestRunner(
      '@nrwl/schematics',
      path.join(__dirname, '../../collection.json')
    );
    tree = createEmptyWorkspace(Tree.empty());
    tree.create('apps/projectName/karma.conf.js', '');
    schematicRunner
      .callRule(
        updateJsonInTree('/angular.json', angularJson => {
          angularJson.projects.projectName = {
            root: 'apps/projectName',
            architect: {
              test: {
                options: {
                  karmaConfig: 'apps/projectName/karma.conf.js'
                }
              }
            }
          };
          return angularJson;
        }),
        tree
      )
      .subscribe(done);
  });

  it('overwrite the karma.conf.js', done => {
    schematicRunner
      .callRule(updateKarmaConf({ projectName: 'projectName' }), tree)
      .subscribe(result => {
        const contents = result
          .read('apps/projectName/karma.conf.ts')
          .toString();

        expect(contents).toEqual(
          `import { baseKarmaConf } from '../../karma.conf';

export default config => {
  const baseConfig = baseKarmaConf(config);

  config.set({
    ...baseConfig,
    coverageIstanbulReporter: {
      dir: 'coverage/apps/projectName'
    }
  });
};
`
        );
        done();
      });
  });
});

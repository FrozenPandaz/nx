import { join } from 'path';

import { offsetFromRoot } from '../common';
import { Rule, Tree, SchematicContext } from '@angular-devkit/schematics';
import {
  createOrUpdate,
  getProjectConfig,
  updateJsonInTree
} from '../ast-utils';

/**
 * This returns a Rule which changes the default Angular CLI Generated karma.conf.js
 * @param options Object containing projectROot
 */
export function updateKarmaConf(options: { projectName: string }): Rule {
  return (host: Tree, context: SchematicContext) => {
    const project = getProjectConfig(host, options.projectName);
    const projectRoot = project.root.replace(/\/$/, '');
    const oldKarmaConfPath = project.architect.test.options.karmaConfig;
    const newKarmaConfPath = join(projectRoot, 'karma.conf.ts');

    if (host.exists(oldKarmaConfPath)) {
      host.rename(oldKarmaConfPath, newKarmaConfPath);
    }
    host = updateJsonInTree('/angular.json', angularJson => {
      angularJson.projects[
        options.projectName
      ].architect.test.options.karmaConfig = newKarmaConfPath;
      return angularJson;
    })(host, context) as Tree;

    createOrUpdate(
      host,
      newKarmaConfPath,
      `import { baseKarmaConf } from '${offsetFromRoot(projectRoot)}karma.conf';

export default config => {
  const baseConfig = baseKarmaConf(config);

  config.set({
    ...baseConfig,
    coverageIstanbulReporter: {
      dir: 'coverage/${projectRoot}'
    }
  });
};
`
    );
    return host;
  };
}

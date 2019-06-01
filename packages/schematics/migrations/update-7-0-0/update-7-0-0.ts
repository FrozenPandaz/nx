import { Rule, externalSchematic, chain } from '@angular-devkit/schematics';
import { updateJsonInTree } from '@nrwl/workspace';

export default function(): Rule {
  return chain([
    updateJsonInTree('package.json', json => {
      json.devDependencies = json.devDependencies || {};
      json.devDependencies = {
        ...json.devDependencies,
        codelyzer: '~4.5.0',
        'jasmine-marbles': '0.4.0'
      };

      if (json.devDependencies['ng-packagr']) {
        json.devDependencies['ng-packagr'] = '^4.2.0';
      }

      return json;
    })
  ]);
}

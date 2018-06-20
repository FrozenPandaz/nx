import { SchematicTestRunner } from '@angular-devkit/schematics/testing';
import * as path from 'path';
import { Tree, VirtualTree } from '@angular-devkit/schematics';
import { createEmptyWorkspace } from '../../utils/testing-utils';
import { getFileContent } from '@schematics/angular/utility/test';
import * as stripJsonComments from 'strip-json-comments';
import { readJsonInTree } from '../../utils/ast-utils';

describe('app', () => {
  const schematicRunner = new SchematicTestRunner(
    '@nrwl/schematics',
    path.join(__dirname, '../../collection.json')
  );

  let projectTree: Tree;

  beforeEach(() => {
    projectTree = Tree.empty();
  });

  it('should update angular.json', () => {
    const tree = schematicRunner.runSchematic(
      'ng-new',
      { name: 'proj' },
      projectTree
    );
    expect(tree.exists('/proj/karma.conf.ts')).toBe(true);
    expect(tree.readContent('/proj/karma.conf.ts')).toBe(
      `export const baseKarmaConf = config => {
  return {
    basePath: "",
    frameworks: ["jasmine", "@angular-devkit/build-angular"],
    plugins: [
      require("karma-jasmine"),
      require("karma-chrome-launcher"),
      require("karma-jasmine-html-reporter"),
      require("karma-coverage-istanbul-reporter"),
      require("@angular-devkit/build-angular/plugins/karma")
    ],
    client: {
      clearContext: false // leave Jasmine Spec Runner output visible in browser
    },
    coverageIstanbulReporter: {
      dir: require("path").join(__dirname, "../../coverage"),
      reports: ["html", "lcovonly"],
      fixWebpackSourcePaths: true
    },
    reporters: ["progress", "kjhtml"],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: false,
    browsers: ["Chrome"],
    singleRun: true
  };
};
`
    );
  });
});

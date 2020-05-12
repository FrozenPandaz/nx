import * as stripJsonComments from 'strip-json-comments';
import { ProjectGraphContext, AddProjectNode } from '../project-graph-models';
import * as resolve from 'resolve';
import { appRootPath } from '@nrwl/workspace/src/utils/app-root';
import { mtime } from '@nrwl/workspace/src/core/file-utils';

export function buildNpmPackageNodes(
  ctx: ProjectGraphContext,
  addNode: AddProjectNode,
  fileRead: (s: string) => string
) {
  const packageJson = JSON.parse(stripJsonComments(fileRead('package.json')));
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  Object.keys(deps).forEach((d) => {
    const packageJsonPath = resolve.sync(`${d}/package.json`, {
      basedir: appRootPath,
    });
    const packageJsonMTime = mtime(packageJsonPath);
    addNode({
      type: 'npm',
      name: d,
      data: {
        version: deps[d],
        files: [
          {
            file: packageJsonPath,
            mtime: packageJsonMTime,
            ext: '.json',
          },
        ],
      },
    });
  });
}

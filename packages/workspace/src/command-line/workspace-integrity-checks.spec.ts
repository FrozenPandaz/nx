import { WorkspaceIntegrityChecks } from './workspace-integrity-checks';
import { ProjectType } from './affected-apps';

describe('WorkspaceIntegrityChecks', () => {
  const packageJson = {
    dependencies: {
      '@nrwl/angular': '1.2.3'
    },
    devDependencies: {
      '@nrwl/workspace': '1.2.3'
    }
  };

  describe('.angular-cli.json is in sync with the filesystem', () => {
    it('should not error when they are in sync', () => {
      const c = new WorkspaceIntegrityChecks(
        [
          {
            name: 'project1',
            type: ProjectType.lib,
            root: 'libs/project1',
            tags: [],
            implicitDependencies: [],
            architect: {},
            files: ['libs/project1/src/index.ts'],
            fileMTimes: {
              'libs/project1/src/index.ts': 1
            }
          }
        ],
        ['libs/project1/src/index.ts'],
        packageJson
      );
      expect(c.run().length).toEqual(0);
    });

    it('should error when there are projects without files', () => {
      const c = new WorkspaceIntegrityChecks(
        [
          {
            name: 'project1',
            type: ProjectType.lib,
            root: 'libs/project1',
            tags: [],
            implicitDependencies: [],
            architect: {},
            files: [],
            fileMTimes: {}
          },
          {
            name: 'project2',
            type: ProjectType.lib,
            root: 'libs/project2',
            tags: [],
            implicitDependencies: [],
            architect: {},
            files: ['libs/project2/src/index.ts'],
            fileMTimes: {
              'libs/project2/src/index.ts': 1
            }
          }
        ],
        ['libs/project2/src/index.ts'],
        packageJson
      );

      const errors = c.run();
      expect(errors.length).toEqual(1);
      expect(errors[0].errors[0]).toEqual(
        `Cannot find project 'project1' in 'libs/project1'`
      );
    });

    it('should error when there are files in apps or libs without projects', () => {
      const c = new WorkspaceIntegrityChecks(
        [
          {
            name: 'project1',
            type: ProjectType.lib,
            root: 'libs/project1',
            fileMTimes: {
              'libs/project1/src/index.ts': 1
            },
            tags: [],
            implicitDependencies: [],
            architect: {},
            files: ['libs/project1/src/index.ts']
          }
        ],
        ['libs/project1/src/index.ts', 'libs/project2/src/index.ts'],
        packageJson
      );

      const errors = c.run();
      expect(errors.length).toEqual(1);
      expect(errors[0].errors[0]).toEqual(
        `The 'libs/project2/src/index.ts' file doesn't belong to any project.`
      );
    });
  });

  describe('package.json is consistent', () => {
    it('should not error when all packages are in sync', () => {
      const c = new WorkspaceIntegrityChecks([], [], packageJson);
      expect(c.run().length).toEqual(0);
    });

    it('should error when all packages are not in sync', () => {
      const c = new WorkspaceIntegrityChecks([], [], {
        dependencies: {
          '@nrwl/angular': '1.2.3',
          '@nrwl/cypress': '1.2.3',
          '@nrwl/express': '1.2.3',
          '@nrwl/jest': '1.2.3',
          '@nrwl/nest': '1.2.3',
          '@nrwl/node': '1.2.3',
          '@nrwl/react': '1.2.3',
          '@nrwl/web': '1.2.3'
        },
        devDependencies: {
          '@nrwl/workspace': '4.5.6'
        }
      });
      const errors = c.run();
      expect(errors.length).toEqual(1);
      expect(errors[0].errors).toEqual([
        `The versions of the @nrwl/angular and @nrwl/workspace packages must be the same.`,
        `The versions of the @nrwl/cypress and @nrwl/workspace packages must be the same.`,
        `The versions of the @nrwl/express and @nrwl/workspace packages must be the same.`,
        `The versions of the @nrwl/jest and @nrwl/workspace packages must be the same.`,
        `The versions of the @nrwl/nest and @nrwl/workspace packages must be the same.`,
        `The versions of the @nrwl/node and @nrwl/workspace packages must be the same.`,
        `The versions of the @nrwl/react and @nrwl/workspace packages must be the same.`,
        `The versions of the @nrwl/web and @nrwl/workspace packages must be the same.`
      ]);
    });
  });
});

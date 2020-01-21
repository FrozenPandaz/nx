import { getImplicitlyTouchedProjectsByJsonChanges } from './implicit-json-changes';
import { WholeFileChange } from '../../file-utils';
import { DiffType } from '../../../utils/json-diff';
import { ProjectGraphNode } from '../../project-graph';
import { vol, fs } from 'memfs';

describe('getImplicitlyTouchedProjectsByJsonChanges', () => {
  let nodes: Record<string, ProjectGraphNode<{}>>;
  let readFile: (s: string) => string;
  beforeEach(() => {
    readFile = path => fs.readFileSync(path).toString();
    nodes = {
      proj1: {
        type: 'app',
        name: 'proj1',
        data: {
          files: []
        }
      }
    };
    vol.fromJSON({
      'nx.json': JSON.stringify({
        implicitDependencies: {
          'package.json': {
            dependencies: ['proj1'],
            some: {
              'deep-field': ['proj2']
            }
          }
        },
        npmScope: 'scope',
        projects: {
          proj1: {},
          proj2: {}
        }
      })
    });
  });

  it('should handle json changes', () => {
    const result = getImplicitlyTouchedProjectsByJsonChanges(
      [
        {
          file: 'package.json',
          mtime: 0,
          ext: '.json',
          getChanges: () => [
            {
              type: DiffType.Modified,
              path: ['some', 'deep-field'],
              value: {
                lhs: 'before',
                rhs: 'after'
              }
            }
          ]
        }
      ],
      nodes,
      readFile
    );
    expect(result).toEqual(['proj2']);
  });

  it('should handle whole file changes', () => {
    const result = getImplicitlyTouchedProjectsByJsonChanges(
      [
        {
          file: 'package.json',
          mtime: 0,
          ext: '.json',
          getChanges: () => [new WholeFileChange()]
        }
      ],
      nodes,
      readFile
    );
    expect(result).toEqual(['proj1', 'proj2']);
  });
});

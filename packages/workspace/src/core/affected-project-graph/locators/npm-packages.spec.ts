import { getTouchedNpmPackages } from './npm-packages';
import { WholeFileChange } from '../..//file-utils';
import { DiffType } from '../../../utils/json-diff';
import { ProjectGraphNode } from '../..//project-graph';
import { vol, fs } from 'memfs';

describe('getTouchedNpmPackages', () => {
  let nodes: Record<string, ProjectGraphNode>;
  let readFile: (p: string) => string;
  let packageJson: any;
  beforeEach(() => {
    nodes = {
      proj1: {
        type: 'app',
        name: 'proj1',
        data: {
          files: []
        }
      },
      proj2: {
        type: 'app',
        name: 'proj2',
        data: {
          files: []
        }
      }
    };
    packageJson = {
      dependencies: {
        'happy-nrwl': '0.0.2',
        'awesome-nrwl': '0.0.1'
      }
    };
    vol.fromJSON({
      'package.json': JSON.stringify(packageJson)
    });
    readFile = path => fs.readFileSync(path).toString();
  });

  it('should handle json changes', () => {
    const result = getTouchedNpmPackages(
      [
        {
          file: 'package.json',
          mtime: 0,
          ext: '.json',
          getChanges: () => [
            {
              type: DiffType.Modified,
              path: ['dependencies', 'happy-nrwl'],
              value: {
                lhs: '0.0.1',
                rhs: '0.0.2'
              }
            },
            // If it's deleted then it should not exist in project graph.
            {
              type: DiffType.Deleted,
              path: ['dependencies', 'sad-nrwl'],
              value: {
                lhs: '0.0.1',
                rhs: undefined
              }
            }
          ]
        }
      ],
      nodes,
      readFile
    );
    expect(result).toEqual(['happy-nrwl']);
  });

  it('should handle whole file changes', () => {
    const result = getTouchedNpmPackages(
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
    expect(result).toEqual(['happy-nrwl', 'awesome-nrwl']);
  });
});

import { getTouchedProjectsInNxJson } from './nx-json-changes';
import { WholeFileChange } from '../../file-utils';
import { DiffType } from '../../../utils/json-diff';
import { ProjectGraphNode } from '@nrwl/workspace/src/core/project-graph';

describe('getTouchedProjectsInNxJson', () => {
  let nodes: Record<string, ProjectGraphNode>;
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
  });

  it('should not return changes when nx.json is not touched', () => {
    const result = getTouchedProjectsInNxJson(
      [
        {
          file: 'source.ts',
          ext: '.ts',
          mtime: 0,
          getChanges: () => [new WholeFileChange()]
        }
      ],
      nodes
    );
    expect(result).toEqual([]);
  });

  it('should return all projects for a whole file change', () => {
    const result = getTouchedProjectsInNxJson(
      [
        {
          file: 'nx.json',
          ext: '.json',
          mtime: 0,
          getChanges: () => [new WholeFileChange()]
        }
      ],
      nodes
    );
    expect(result).toEqual(['proj1', 'proj2']);
  });

  it('should return all projects for changes to npmScope', () => {
    const result = getTouchedProjectsInNxJson(
      [
        {
          file: 'nx.json',
          ext: '.json',
          mtime: 0,
          getChanges: () => [
            {
              type: DiffType.Modified,
              path: ['npmScope'],
              value: {
                lhs: 'proj',
                rhs: 'awesome-proj'
              }
            }
          ]
        }
      ],
      nodes
    );
    expect(result).toEqual(['proj1', 'proj2']);
  });

  it('should return projects added in nx.json', () => {
    const result = getTouchedProjectsInNxJson(
      [
        {
          file: 'nx.json',
          ext: '.json',
          mtime: 0,
          getChanges: () => [
            {
              type: DiffType.Added,
              path: ['projects', 'proj1', 'tags'],
              value: {
                lhs: undefined,
                rhs: []
              }
            }
          ]
        }
      ],
      nodes
    );
    expect(result).toEqual(['proj1']);
  });

  it('should return all projects when a project is removed from nx.json', () => {
    const result = getTouchedProjectsInNxJson(
      [
        {
          file: 'nx.json',
          ext: '.json',
          mtime: 0,
          getChanges: () => [
            {
              type: DiffType.Deleted,
              path: ['projects', 'proj3', 'tags'],
              value: {
                lhs: [],
                rhs: undefined
              }
            }
          ]
        }
      ],
      nodes
    );
    expect(result).toEqual(['proj1', 'proj2']);
  });

  it('should return projects modified in nx.json', () => {
    const result = getTouchedProjectsInNxJson(
      [
        {
          file: 'nx.json',
          ext: '.json',
          mtime: 0,
          getChanges: () => [
            {
              type: DiffType.Modified,
              path: ['projects', 'proj1', 'tags', '0'],
              value: {
                lhs: 'scope:feat',
                rhs: 'scope:shared'
              }
            }
          ]
        }
      ],
      nodes
    );
    expect(result).toEqual(['proj1']);
  });
});

import { getTouchedProjectsInWorkspaceJson } from './workspace-json-changes';
import { WholeFileChange } from '../../file-utils';
import { DiffType } from '../../../utils/json-diff';
import { ProjectGraphNode } from '@nrwl/workspace/src/core/project-graph';

describe('getTouchedProjectsInWorkspaceJson', () => {
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

  it('should not return changes when angular.json is not touched', () => {
    const result = getTouchedProjectsInWorkspaceJson(
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
    const result = getTouchedProjectsInWorkspaceJson(
      [
        {
          file: 'angular.json',
          ext: '.json',
          mtime: 0,
          getChanges: () => [new WholeFileChange()]
        }
      ],
      nodes
    );
    expect(result).toEqual(['proj1', 'proj2']);
  });

  it('should return all projects for changes to newProjectRoot', () => {
    const result = getTouchedProjectsInWorkspaceJson(
      [
        {
          file: 'angular.json',
          ext: '.json',
          mtime: 0,
          getChanges: () => [
            {
              type: DiffType.Modified,
              path: ['newProjectRoot'],
              value: {
                lhs: '',
                rhs: 'projects'
              }
            }
          ]
        }
      ],
      nodes
    );
    expect(result).toEqual(['proj1', 'proj2']);
  });

  it('should return projects added in angular.json', () => {
    const result = getTouchedProjectsInWorkspaceJson(
      [
        {
          file: 'angular.json',
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

  it('should affect all projects if a project is removed from angular.json', () => {
    const result = getTouchedProjectsInWorkspaceJson(
      [
        {
          file: 'angular.json',
          ext: '.json',
          mtime: 0,
          getChanges: () => [
            {
              type: DiffType.Deleted,
              path: ['projects', 'proj3', 'root'],
              value: {
                lhs: 'proj3',
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

  it('should return projects modified in angular.json', () => {
    const result = getTouchedProjectsInWorkspaceJson(
      [
        {
          file: 'angular.json',
          ext: '.json',
          mtime: 0,
          getChanges: () => [
            {
              type: DiffType.Modified,
              path: ['projects', 'proj1', 'root'],
              value: {
                lhs: 'proj3',
                rhs: 'proj1'
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

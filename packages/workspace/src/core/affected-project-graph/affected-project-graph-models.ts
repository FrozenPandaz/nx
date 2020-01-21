import { NxJson } from '../shared-interfaces';
import { Change, FileChange } from '../file-utils';
import { ProjectGraphNode } from '@nrwl/workspace/src/core/project-graph';

export interface AffectedProjectGraphContext {
  workspaceJson: any;
  nxJson: NxJson<string[]>;
  touchedProjects: string[];
}

export interface TouchedProjectLocator<T extends Change = Change> {
  (
    fileChanges: FileChange<T>[],
    projectNodes?: Record<string, ProjectGraphNode<{}>>,
    readFile?: (s: string) => string
  ): string[];
}

import {
  isWholeFileChange,
  WholeFileChange,
  workspaceFileName
} from '../../file-utils';
import { isJsonChange, JsonChange } from '../../../utils/json-diff';
import { TouchedProjectLocator } from '../affected-project-graph-models';

export const getTouchedProjectsInWorkspaceJson: TouchedProjectLocator<
  WholeFileChange | JsonChange
> = (touchedFiles, nodes): string[] => {
  const workspaceChange = touchedFiles.find(
    change => change.file === workspaceFileName()
  );
  if (!workspaceChange) {
    return [];
  }

  const changes = workspaceChange.getChanges();

  if (
    changes.some(change => {
      if (isJsonChange(change)) {
        return change.path[0] !== 'projects';
      }
      if (isWholeFileChange(change)) {
        return true;
      }
      return false;
    })
  ) {
    return Object.keys(nodes);
  }

  const touched = [];
  changes.forEach(change => {
    if (!isJsonChange(change) || change.path[0] !== 'projects') {
      return;
    }

    if (nodes[change.path[1]]) {
      touched.push(change.path[1]);
    } else {
      // The project was deleted so affect all projects
      touched.push(...Object.keys(nodes));
    }
  });
  return touched;
};

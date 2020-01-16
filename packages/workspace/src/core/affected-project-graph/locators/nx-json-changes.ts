import { isWholeFileChange, WholeFileChange } from '../../file-utils';
import { DiffType, isJsonChange, JsonChange } from '../../../utils/json-diff';
import { TouchedProjectLocator } from '../affected-project-graph-models';

export const getTouchedProjectsInNxJson: TouchedProjectLocator<
  WholeFileChange | JsonChange
> = (touchedFiles, workspaceJson, nxJson): string[] => {
  const nxJsonChange = touchedFiles.find(change => change.file === 'nx.json');
  if (!nxJsonChange) {
    return [];
  }

  const changes = nxJsonChange.getChanges();

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
    return Object.keys(nxJson.projects);
  }

  const touched = [];
  changes.forEach(change => {
    if (!isJsonChange(change) || change.path[0] !== 'projects') {
      return;
    }

    if (nxJson.projects[change.path[1]]) {
      touched.push(change.path[1]);
    } else {
      // The project was deleted so affect all projects
      touched.push(...Object.keys(nxJson.projects));
    }
  });
  return touched;
};

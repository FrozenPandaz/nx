import { TouchedProjectLocator } from '../affected-project-graph-models';
import { readNxJson } from '../../../core/file-utils';
import { normalizeNxJson } from '../../normalize-nx-json';

export const getTouchedProjects: TouchedProjectLocator = (
  touchedFiles,
  nodes
): string[] => {
  return touchedFiles
    .map(f => {
      return Object.values(nodes).find(node => {
        return f.file.startsWith(node.data.root);
      });
    })
    .filter(Boolean)
    .map(node => node.name);
};

export const getImplicitlyTouchedProjects: TouchedProjectLocator = (
  fileChanges,
  nodes,
  readFile
): string[] => {
  const nxJson = normalizeNxJson(readNxJson(readFile));
  if (!nxJson.implicitDependencies) {
    return [];
  }

  const touched = [];

  for (const [filePath, projects] of Object.entries(
    nxJson.implicitDependencies
  )) {
    const implicitDependencyWasChanged = fileChanges.some(
      f => f.file === filePath
    );
    if (!implicitDependencyWasChanged) {
      continue;
    }

    // File change affects all projects, just return all projects.
    if (Array.isArray(projects)) {
      touched.push(...projects);
    }
  }

  return touched;
};

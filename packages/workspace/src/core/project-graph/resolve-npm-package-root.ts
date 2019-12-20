import { dirname, join, relative } from 'path';

import { appRootPath } from '../../utils/app-root';

export function resolveNpmPackageRoot(p: string) {
  try {
    return relative(
      appRootPath,
      dirname(require.resolve(join(p, 'package.json')))
    );
  } catch (e) {
    return '';
  }
}

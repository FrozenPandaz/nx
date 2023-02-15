import type { Tree } from '@nrwl/devkit';
import { ensurePackage, formatFiles } from '@nrwl/devkit';
import { nxVersion } from '../../utils/versions';

import type { Schema } from './schema';

export async function angularChangeStorybookTargestGenerator(
  tree: Tree,
  schema: Schema
) {
  const { changeStorybookTargetsGenerator } = ensurePackage<
    typeof import('@nrwl/storybook')
  >('@nrwl/storybook', nxVersion);
  await changeStorybookTargetsGenerator(tree);

  if (!schema.skipFormat) {
    await formatFiles(tree);
  }
}

export default angularChangeStorybookTargestGenerator;

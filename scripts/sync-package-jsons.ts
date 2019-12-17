import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { formatWithPrettier } from './documentation/utils';

const packages = readdirSync(join(__dirname, '../packages'));
const rootPackageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json')).toString()
);

const packageGroupExclusions = ['create-nx-workspace', 'insights'];
const packageGroup = packages
  .filter(p => !packageGroupExclusions.includes(p))
  .map(p => `@nrwl/${p}`);

async function syncDependencies(
  packageJson: any,
  packageJsonPath: string,
  kind: 'dependencies' | 'peerDependencies'
) {
  if (!packageJson[kind]) {
    return;
  }
  Object.keys(packageJson[kind]).forEach(packageName => {
    if (
      !packageName.startsWith('@nrwl/') &&
      rootPackageJson.devDependencies[packageName]
    ) {
      packageJson[kind][packageName] =
        rootPackageJson.devDependencies[packageName];
    }
  });
  if (packageJson['ng-update']) {
    packageJson['ng-update'].packageGroup = packageGroup;
  }
  writeFileSync(
    packageJsonPath,
    await formatWithPrettier(packageJsonPath, JSON.stringify(packageJson))
  );
}

async function syncPackageJson(packageJsonPath: string) {
  const packageJson = JSON.parse(readFileSync(packageJsonPath).toString());
  await syncDependencies(packageJson, packageJsonPath, 'dependencies');
  await syncDependencies(packageJson, packageJsonPath, 'peerDependencies');
}

packages.forEach(async pkg => {
  await syncPackageJson(join(__dirname, '../packages', pkg, 'package.json'));
});

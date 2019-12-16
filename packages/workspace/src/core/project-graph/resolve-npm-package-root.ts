export function resolveNpmPackageRoot(p: string) {
  try {
    return require.resolve(p);
  } catch {
    return '';
  }
}

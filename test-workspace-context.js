const { WorkspaceContext } = require('./packages/nx/src/native');

// Create a workspace context with additional project roots
const workspaceRoot = process.cwd();
const additionalProjectRoots = ['/tmp/test-additional-roots'];
const cacheDir = '/tmp/test-cache';

console.log('Creating WorkspaceContext with:');
console.log('  workspaceRoot:', workspaceRoot);
console.log('  additionalProjectRoots:', additionalProjectRoots);

const context = new WorkspaceContext(workspaceRoot, additionalProjectRoots, cacheDir);

console.log('\nTesting getFilesByRoot...');
const filesByRoot = context.getFilesByRoot();
console.log('Keys in filesByRoot:', Object.keys(filesByRoot));

// Check if our test file is found
for (const [rootPath, files] of Object.entries(filesByRoot)) {
  console.log(`\nRoot: ${rootPath}`);
  console.log(`Files count: ${files.length}`);
  if (rootPath === '/tmp/test-additional-roots') {
    console.log('Test files found:', files.filter(f => f.file.includes('test-additional-roots')));
  }
}

console.log('\nTesting multiGlob...');
const globResult = context.multiGlob(['package.json']);
console.log('multiGlob result keys:', Object.keys(globResult));
for (const [rootPath, files] of Object.entries(globResult)) {
  console.log(`Root: ${rootPath}, package.json files: ${files.length}`);
  if (files.length > 0) {
    console.log('  Files:', files);
  }
}
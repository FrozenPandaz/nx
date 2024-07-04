import { basename, dirname, join, relative } from 'path';
import { cloneFromUpstream, GitClient } from '../../utils/git-utils';
import { copyFile, mkdir, readdir, rm } from 'fs';
import { promisify } from 'util';
import { tmpdir } from 'tmp';
import { prompt } from 'enquirer';

const readdirAsync = promisify(readdir);
const rmAsync = promisify(rm);
const copyFileAsync = promisify(copyFile);
const mkdirAsync = promisify(mkdir);

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ImportOptions {
  sourceRemoteUrl: string;
  ref: string;
  destination: string;
  verbose: boolean;
}

const importRemoteName = '__tmp_nx_import__';
const tempImportBranch = '__tmp_import_stage__';
const tempFileDir = '__tmp_import_stage__';

async function prepareSourceRepo(
  gitClient: GitClient,
  sourceDir: string,
  tempSourceDir: string
) {
  const relativeSourceDir = relative(gitClient.root, sourceDir);

  if (relativeSourceDir === '') {
    try {
      await rmAsync(tempSourceDir, {
        recursive: true,
      });
    } catch {}
    const files = await gitClient.getGitFiles('.');
    // const entries = await readdirAsync(gitClient.repoRoot);
    await mkdirAsync(tempSourceDir);
    const gitignores = new Set<string>();
    for (const file of files) {
      if (basename(file) === '.gitignore') {
        gitignores.add(file);
        continue;
      }

      await mkdirAsync(dirname(join(tempSourceDir, file)), { recursive: true });

      // await wait(25);

      const newPath = join(tempSourceDir, file);
      console.log('Moving', file, 'to', newPath);
      try {
        await gitClient.move(file, newPath);
      } catch {
        console.log('failed once');
        await wait(100);
        await gitClient.move(file, newPath);
      }
    }

    await gitClient.stageToGit(tempSourceDir);
    await gitClient.commit('prepare for import');

    for (const gitignore of gitignores) {
      await gitClient.move(gitignore, join(tempSourceDir, gitignore));
      await copyFileAsync(
        join(tempSourceDir, gitignore),
        join(gitClient.root, gitignore)
      );
    }
    await gitClient.stageToGit('.');
    await gitClient.commit('prepare for import 2');
  } else {
    throw new Error('boom');

    await gitClient.move(sourceDir, join(tempSourceDir, relativeSourceDir));

    const entries = await readdirAsync(gitClient.root);
    await mkdirAsync(tempSourceDir);
    for (const entry of entries) {
      if (entry === '.gitignore') {
        continue;
      }

      await gitClient.move(entry, join('garbage', entry));
    }

    await gitClient.stageToGit(tempSourceDir, 'garbage');
  }

  // Move our source directory into a temp directory
  // await Promise.all(
  //   entries.map(async (entry) => {
  //     await renameAsync(entry, tempSourceDir);
  //   })
  // );

  // Delete everything else to avoid conflicts
  // const otherEntries = await readdirAsync(sourceDir);
  // await Promise.all(
  //   otherEntries
  //     .filter((entry) => {})
  //     .map(async (entry) => {
  //       await rmAsync(entry);
  //     })
  // );
}

async function confirmOrExitWithAnError(message: string) {
  const { confirm } = await prompt<{ confirm: boolean }>([
    {
      type: 'confirm',
      name: 'confirm',
      message,
    },
  ]);

  if (confirm === false) {
    throw new Error('Cancelled');
  }
}

export async function importHandler(options: ImportOptions) {
  const { sourceRemoteUrl, ref, destination } = options;

  const tempRepoPath = join(tmpdir, 'nx-import');

  try {
    await rmAsync(tempRepoPath, { recursive: true });
  } catch {}
  await mkdirAsync(tempRepoPath, { recursive: true });
  await confirmOrExitWithAnError(
    `Clone repo into a temporary directory where it will be prepared to import, ${tempRepoPath} from ${sourceRemoteUrl}`
  );
  await cloneFromUpstream(sourceRemoteUrl, 'repo', {
    cwd: tempRepoPath,
  });
  const absSource = join(tempRepoPath, 'repo');

  const sourceGitClient = new GitClient(absSource);

  await wait(100);

  await sourceGitClient.checkout(tempImportBranch, {
    new: true,
    base: `origin/${ref}`,
  });

  const tempSourceDir = join(sourceGitClient.root, tempFileDir);
  await prepareSourceRepo(sourceGitClient, absSource, tempSourceDir);

  await confirmOrExitWithAnError(
    `Pushing prepared repo as ${tempImportBranch} to ${sourceRemoteUrl} (git push -u -f origin ${tempImportBranch})`
  );
  await sourceGitClient.push(tempImportBranch);

  // Ready to import

  const destinationGitClient = new GitClient(process.cwd());

  await confirmOrExitWithAnError(
    `Adding ${sourceRemoteUrl} as a remote in this repo (git remote add ${importRemoteName} ${sourceRemoteUrl})`
  );
  try {
    await destinationGitClient.deleteGitRemote(importRemoteName);
  } catch {}
  await destinationGitClient.addGitRemote(importRemoteName, sourceRemoteUrl);
  await destinationGitClient.fetch(importRemoteName);

  await confirmOrExitWithAnError(
    `Importing the changes into this repo into a temporary directory (git merge ${importRemoteName}/${tempImportBranch} -X ours --allow-unrelated-histories)`
  );
  await destinationGitClient.merge(
    `${importRemoteName}/${tempImportBranch}`,
    `feat(repo): merge ${sourceRemoteUrl}`
  );

  await mkdirAsync(destination, { recursive: true });

  const files = await destinationGitClient.getGitFiles(tempFileDir);

  for (const file of files) {
    const newPath = join(destination, relative(tempFileDir, file));

    await mkdirAsync(dirname(newPath), { recursive: true });

    console.log('Moving', file, 'to', newPath);
    try {
      await destinationGitClient.move(file, newPath);
    } catch {
      console.log('failed once');
      await wait(100);
      await destinationGitClient.move(file, newPath);
    }
  }

  await destinationGitClient.commit(
    `feat(repo): complete import of ${sourceRemoteUrl}`
  );

  // Ensure that tmp remote does not exist
  // try {
  //   deleteGitRemote(importRemoteName, {
  //     cwd: workspaceRoot,
  //   });
  // } catch {
  //   // It's okay if it errors because it means that it did not exist.
  // }
  //
  // // Add source remote to destination workspace
  // addGitRemote(importRemoteName, sourceGitRemote.url, {
  //   cwd: workspaceRoot,
  // });
  //
  // // Fetch the remote
  // fetchGitRemote(importRemoteName, tempImportBranch, { cwd: workspaceRoot });
  //
  // console.log({ remotes: sourceGitRemote });
}

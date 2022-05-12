#!/usr/bin/env node
import * as yargsParser from 'yargs-parser';

import { execSync } from 'child_process';

import { readFileSync, writeFileSync } from 'fs';

import * as version from '@lerna/version/index';

import * as publish from '@lerna/publish/index';
import { URL } from 'url';
import { join } from 'path';

const parsedArgs: {
  local: boolean;
  dryRun: boolean;
  help: boolean;
  force: boolean;
  clearLocalRegistry: boolean;
  tag: string;
  preid: string;
  version?: string;
} = yargsParser(process.argv, {
  boolean: ['dry-run', 'local', 'force', 'clearLocalRegistry'],
  string: ['version', 'tag', 'preid'],
  alias: {
    d: 'dry-run',
    h: 'help',
    l: 'local',
  },
  default: {
    tag: 'next',
    preid: 'beta',
  },
}) as any;

if (parsedArgs.help) {
  console.log(`
      Usage: yarn nx-release <version> [options]

      Example: "yarn nx-release 1.0.0-beta.1"

      The acceptable format for the version number is:
      {number}.{number}.{number}[-{alpha|beta|rc}.{number}]

      The subsection of the version number in []s is optional, and, if used, will be used to
      mark the release as "prerelease" on GitHub, and tag it with "next" on npm.

      Options:
        --dry-run           Do not touch or write anything, but show the commands
        --help              Show this message
        --local             Publish to local npm registry (IMPORTANT: install & run Verdaccio first & set registry in .npmrc)

    `);
  process.exit(0);
}

const allowedTags = ['next', 'latest', 'previous'];
if (!allowedTags.includes(parsedArgs.tag)) {
  throw new Error(
    `tag: ${parsedArgs.tag} is not one of ${allowedTags.join(',')}`
  );
}

const registry = getRegistry();
const registryIsLocalhost = registry.hostname === 'localhost';
console.log('Publishing to', registry.toString());
if (!parsedArgs.local) {
  if (!process.env.GH_TOKEN) {
    throw new Error('process.env.GITHUB_TOKEN_RELEASE_IT_NX is not set');
  }
  if (!parsedArgs.force && registryIsLocalhost) {
    throw new Error(
      'Registry is still set to localhost! Run "yarn local-registry disable" or pass --force'
    );
  }
  if (!parsedArgs.force) {
    console.log('Authenticating to NPM');
    execSync('npm adduser', {
      stdio: [0, 1, 2],
    });
  }
} else {
  if (!parsedArgs.force && !registryIsLocalhost) {
    throw new Error('--local was passed and registry is not localhost');
  }
  if (parsedArgs.clearLocalRegistry) {
    execSync('yarn local-registry clear');
  }
}
(async () => {
  console.log('Executing build script:');
  const buildCommand = 'yarn build';
  console.log(`> ${buildCommand}`);
  execSync(buildCommand, {
    stdio: [0, 1, 2],
  });

  const versionOptions = {
    bump: parsedArgs.version ? parsedArgs.version : undefined,
    conventionalCommits: true,
    conventionalPrerelease: parsedArgs.tag === 'next',
    preid: parsedArgs.preid,
    forcePublish: true,
    createRelease: parsedArgs.tag !== 'next' ? 'github' : undefined,
    noChangelog: parsedArgs.tag === 'next',
    tagVersionPrefix: '',
    exact: true,
    gitTagVersion: parsedArgs.tag !== 'next',
    message: 'chore(misc): publish %v',
    loglevel: 'info',
    yes: false,
    ignoreScripts: true,
  };

  if (parsedArgs.local) {
    versionOptions.conventionalCommits = false;
    delete versionOptions.createRelease;
    versionOptions.gitTagVersion = false;
    versionOptions.loglevel = 'error';
    versionOptions.yes = true;
    versionOptions.bump = parsedArgs.version ? parsedArgs.version : 'minor';
  }

  let uncommittedFiles: string[];
  try {
    const lernaJsonPath = join(__dirname, '../lerna.json');
    let originalLernaJson: Buffer;
    if (parsedArgs.local || parsedArgs.tag === 'next') {
      originalLernaJson = readFileSync(lernaJsonPath);
    }
    if (parsedArgs.local) {
      uncommittedFiles = execSync('git diff --name-only --relative HEAD .')
        .toString()
        .split('\n')
        .filter((i) => i.length > 0);
      execSync(
        `git update-index --assume-unchanged ${uncommittedFiles.join(' ')}`
      );
    }

    const publishOptions = {
      gitReset: false,
      distTag: parsedArgs.tag,
    };

    if (!parsedArgs.dryRun) {
      console.log('Publishing');
      await publish({ ...versionOptions, ...publishOptions });
    } else {
      await version(versionOptions);
      console.warn('Not Publishing because --dryRun was passed');
    }

    if (parsedArgs.local || parsedArgs.tag === 'next') {
      writeFileSync(lernaJsonPath, originalLernaJson);
    }
  } finally {
    if (parsedArgs.local) {
      execSync(
        `git update-index --no-assume-unchanged ${uncommittedFiles.join(' ')}`
      );
    }
  }
})();

function getRegistry() {
  return new URL(execSync('npm config get registry').toString().trim());
}

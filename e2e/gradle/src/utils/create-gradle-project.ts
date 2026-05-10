import {
  e2eConsoleLogger,
  isWindows,
  runCommand,
  tmpProjPath,
} from '@nx/e2e-utils';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { appendFileSync, createFileSync, writeFileSync } from 'fs-extra';
import { join, resolve } from 'path';

const kotlinVersion = '2.1.20';

export function createGradleProject(
  projectName: string,
  type: 'kotlin' | 'groovy' = 'kotlin',
  cwd: string = tmpProjPath(),
  packageName: string = 'gradleProject',
  addProjectJsonNamePrefix: string = ''
) {
  e2eConsoleLogger(`Using java version: ${execSync('java -version')}`);
  const gradleCommand = isWindows()
    ? resolve(`${__dirname}/../../../../gradlew.bat`)
    : resolve(`${__dirname}/../../../../gradlew`);
  e2eConsoleLogger(
    'Using gradle version: ' +
      execSync(`${gradleCommand} --version`, {
        cwd,
      })
  );
  // Run setup-time gradle commands with --no-daemon so we don't leave a
  // long-lived daemon holding inotify watches on the project dir. A daemon
  // spawned here outlives the setup phase and interferes with later
  // non-gradle filesystem operations (e.g. `nx import` runs `git
  // filter-branch --tree-filter`, which fails with "Unable to read current
  // working directory" when the daemon is concurrently watching the same
  // tree). The actual test-body gradle calls keep daemons enabled.
  e2eConsoleLogger(
    execSync(`${gradleCommand} help --task :init --no-daemon`, {
      cwd,
    }).toString()
  );
  e2eConsoleLogger(
    runCommand(
      `${gradleCommand} init --type ${type}-application --dsl ${type} --project-name ${projectName} --package ${packageName} --no-incubating --split-project --overwrite --no-daemon`,
      {
        cwd,
      }
    )
  );

  // Update Kotlin version to 2.0.21 after project creation
  if (type === 'kotlin') {
    updateKotlinVersion(cwd, type);
    // The Kotlin Gradle Plugin writes session/IPC files under .kotlin/.
    // gradle init's template doesn't include it, so events for those
    // files leak through the daemon's watcher and cause recompute storms.
    appendToGitignore(cwd, '.kotlin/');
  }

  // Raise Gradle and Kotlin daemon heap sizes for the generated workspace.
  // The `dev.nx.gradle.project-graph` plugin (added by `nx add @nx/gradle`)
  // triggers compilation of buildSrc, and in kotlin-dsl mode that compile
  // expands a large generated accessors set. The default Kotlin daemon heap
  // (~256m) is too small and OOMs with "GC overhead limit exceeded" on the
  // CI runner where org.gradle.jvmargs is already pinned to -Xmx512m.
  ensureDaemonHeap(cwd);

  try {
    e2eConsoleLogger(
      runCommand(`${gradleCommand} clean --no-daemon`, {
        cwd,
      })
    );
  } catch (e) {}

  if (addProjectJsonNamePrefix) {
    createFileSync(join(cwd, 'app/project.json'));
    writeFileSync(
      join(cwd, 'app/project.json'),
      `{"name": "${addProjectJsonNamePrefix}app"}`
    );
    createFileSync(join(cwd, 'list/project.json'));
    writeFileSync(
      join(cwd, 'list/project.json'),
      `{"name": "${addProjectJsonNamePrefix}list"}`
    );
    createFileSync(join(cwd, 'utilities/project.json'));
    writeFileSync(
      join(cwd, 'utilities/project.json'),
      `{"name": "${addProjectJsonNamePrefix}utilities"}`
    );
  }

  addLocalPluginManagement(
    join(cwd, `settings.gradle${type === 'kotlin' ? '.kts' : ''}`)
  );
  addLocalPluginManagement(
    join(cwd, `buildSrc/settings.gradle${type === 'kotlin' ? '.kts' : ''}`)
  );

  addSpringBootPlugin(
    join(cwd, `app/build.gradle${type === 'kotlin' ? '.kts' : ''}`)
  );
}

/**
 * Ensures `gradle.properties` at the workspace root sets daemon heap sizes
 * large enough to compile buildSrc with the Nx project graph plugin.
 *
 * - `org.gradle.jvmargs=-Xmx2g` raises the Gradle daemon heap above the
 *   512m CI default so configuration of large `projectReportAll` graphs
 *   does not OOM.
 * - `kotlin.daemon.jvmargs=-Xmx2g` raises the Kotlin compiler daemon heap
 *   above the ~256m default so kotlin-dsl buildSrc (with hundreds of
 *   generated `Accessors*.kt` files) can compile without
 *   `OutOfMemoryError: GC overhead limit exceeded`.
 *
 * Existing keys in `gradle.properties` are preserved; we only append the
 * keys that are not already set.
 */
function ensureDaemonHeap(cwd: string) {
  const gradlePropertiesPath = join(cwd, 'gradle.properties');
  const desiredEntries: Record<string, string> = {
    'org.gradle.jvmargs': '-Xmx2g',
    'kotlin.daemon.jvmargs': '-Xmx2g',
  };

  let content = '';
  if (existsSync(gradlePropertiesPath)) {
    content = readFileSync(gradlePropertiesPath, 'utf-8');
  }

  const existingKeys = new Set(
    content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split('=')[0].trim())
  );

  const additions: string[] = [];
  for (const [key, value] of Object.entries(desiredEntries)) {
    if (!existingKeys.has(key)) {
      additions.push(`${key}=${value}`);
    }
  }

  if (additions.length === 0) {
    return;
  }

  const separator = !content || content.endsWith('\n') ? '' : '\n';
  const updated = `${content}${separator}${additions.join('\n')}\n`;
  writeFileSync(gradlePropertiesPath, updated);
}

function appendToGitignore(cwd: string, entry: string) {
  const gitignorePath = join(cwd, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, `${entry}\n`);
    return;
  }
  const existing = readFileSync(gitignorePath, 'utf-8');
  if (existing.split('\n').some((line) => line.trim() === entry.trim())) {
    return;
  }
  appendFileSync(
    gitignorePath,
    existing.endsWith('\n') ? `${entry}\n` : `\n${entry}\n`
  );
}

function addLocalPluginManagement(filePath: string) {
  let content = readFileSync(filePath).toString();
  content =
    `pluginManagement {
    repositories {
        mavenLocal()
        gradlePluginPortal()
        mavenCentral()
        // Add other repositories if needed
    }
}
` + content;
  writeFileSync(filePath, content);
}

function updateKotlinVersion(cwd: string, type: 'kotlin' | 'groovy') {
  e2eConsoleLogger(`Updating Kotlin version to ${kotlinVersion}`);

  // Update the main build file
  const buildFilePath = join(
    cwd,
    `build.gradle${type === 'kotlin' ? '.kts' : ''}`
  );
  try {
    let buildContent = readFileSync(buildFilePath, 'utf-8');

    if (type === 'kotlin') {
      // Update Kotlin JVM plugin version in build.gradle.kts
      buildContent = buildContent.replace(
        /id\s*\(\s*["']org\.jetbrains\.kotlin\.jvm["']\s*\)\s+version\s+["'][^"']*["']/g,
        `id("org.jetbrains.kotlin.jvm") version "${kotlinVersion}"`
      );
    } else {
      // Update Kotlin JVM plugin version in build.gradle (Groovy)
      buildContent = buildContent.replace(
        /id\s+['"]org\.jetbrains\.kotlin\.jvm['"]\s+version\s+['"][^'"]*['"]/g,
        `id 'org.jetbrains.kotlin.jvm' version '${kotlinVersion}'`
      );
    }

    writeFileSync(buildFilePath, buildContent);
    e2eConsoleLogger(`Updated Kotlin version in ${buildFilePath}`);
  } catch (error) {
    e2eConsoleLogger(`Warning: Could not update ${buildFilePath}: ${error}`);
  }

  // Update subproject build files
  const subprojects = ['app', 'list', 'utilities'];
  subprojects.forEach((subproject) => {
    const subBuildFilePath = join(
      cwd,
      subproject,
      `build.gradle${type === 'kotlin' ? '.kts' : ''}`
    );
    try {
      let subBuildContent = readFileSync(subBuildFilePath, 'utf-8');

      if (type === 'kotlin') {
        // Update Kotlin JVM plugin version in subproject build.gradle.kts
        subBuildContent = subBuildContent.replace(
          /id\s*\(\s*["']org\.jetbrains\.kotlin\.jvm["']\s*\)/g,
          `id("org.jetbrains.kotlin.jvm") version "${kotlinVersion}"`
        );
      } else {
        // Update Kotlin JVM plugin version in subproject build.gradle (Groovy)
        subBuildContent = subBuildContent.replace(
          /id\s+['"]org\.jetbrains\.kotlin\.jvm['"]/g,
          `id 'org.jetbrains.kotlin.jvm' version '${kotlinVersion}'`
        );
      }

      writeFileSync(subBuildFilePath, subBuildContent);
      e2eConsoleLogger(`Updated Kotlin version in ${subBuildFilePath}`);
    } catch (error) {
      e2eConsoleLogger(
        `Warning: Could not update ${subBuildFilePath}: ${error}`
      );
    }
  });

  // Create or update gradle/libs.versions.toml if it exists
  const versionCatalogPath = join(cwd, 'gradle', 'libs.versions.toml');
  try {
    let versionContent = readFileSync(versionCatalogPath, 'utf-8');
    // Update kotlin-gradle-plugin version in version catalog
    versionContent = versionContent.replace(
      /kotlin-gradle-plugin\s*=\s*["'][^"']*["']/g,
      `kotlin-gradle-plugin = "${kotlinVersion}"`
    );
    // Also update any plain kotlin version if it exists
    versionContent = versionContent.replace(
      /^kotlin\s*=\s*["'][^"']*["']/gm,
      `kotlin = "${kotlinVersion}"`
    );
    writeFileSync(versionCatalogPath, versionContent);
    e2eConsoleLogger(`Updated Kotlin version in ${versionCatalogPath}`);
  } catch (error) {
    // Version catalog might not exist, which is fine
    e2eConsoleLogger(
      `Version catalog not found at ${versionCatalogPath}, skipping`
    );
  }
}

function addSpringBootPlugin(filePath: string) {
  let content = readFileSync(filePath).toString();
  const isKotlin = filePath.endsWith('.kts');

  // Find the plugins block and add Spring Boot plugin
  if (content.includes('plugins {')) {
    const pluginLine = isKotlin
      ? '    id("org.springframework.boot") version "+"'
      : "    id 'org.springframework.boot' version '+'";

    content = content.replace(
      /plugins\s*\{/,
      `plugins {
${pluginLine}`
    );
  }

  writeFileSync(filePath, content);
}

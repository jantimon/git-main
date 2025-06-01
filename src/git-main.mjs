/// @ts-check
import { $, spinner, question, fs } from "zx";
import chalk from "chalk";
// @ts-ignore
$.quiet = true;
$.verbose = false;

const log = {
  /** @param {string} msg */
  info: (msg) => console.log(chalk.blue("ℹ"), msg),
  /** @param {string} msg */
  success: (msg) => console.log(chalk.green("✓"), msg),
  /** @param {string} msg */
  warning: (msg) => console.log(chalk.yellow("⚠"), msg),
  /** @param {string} msg */
  error: (msg) => console.log(chalk.red("✖"), msg),
  /** @param {string} msg */
  action: (msg) => console.log(chalk.cyan("→"), msg),
};

  /** @param {string} message */
const confirmAction = async (message) => {
  let result = "";
  while (result !== "y" && result !== "n") {
    result = await question(`${chalk.yellow("?")} ${message} [y/n]: `, {
      choices: ["y", "n"],
    });
  }
  return result === "y";
};

/**
 * @typedef {'yarn' | 'pnpm' | 'npm'} PackageManager
 */

/**
 * Detects which package manager is used in the repository
 * @param {string} gitRoot
 * @returns {Promise<PackageManager | null>}
 */
async function detectPackageManager(gitRoot) {
  if (await fs.pathExists(`${gitRoot}/yarn.lock`)) return "yarn";
  if (await fs.pathExists(`${gitRoot}/pnpm-lock.yaml`)) return "pnpm";
  if (await fs.pathExists(`${gitRoot}/package-lock.json`)) return "npm";
  return null;
}

/**
 * Installs dependencies based on the package manager
 * @param {PackageManager} packageManager
 * @param {string} gitRoot
 */
async function installDependencies(packageManager, gitRoot) {
  switch (packageManager) {
    case "yarn":
      await $`cd "${gitRoot}" && yarn --immutable`.pipe(process.stdout);
      break;
    case "pnpm":
      await $`cd "${gitRoot}" && pnpm install --frozen-lockfile`.pipe(process.stdout);
      break;
    case "npm":
      await $`cd "${gitRoot}" && npm ci`.pipe(process.stdout);
      break;
  }
}

/**
 * Gets the lockfile name for the package manager
 * @param {string} gitRoot
 */
async function getLockfile(gitRoot) {
  const packageManager = await detectPackageManager(gitRoot);
  if (!packageManager) return null;
  switch (packageManager) {
    case "yarn":
      return "yarn.lock";
    case "pnpm":
      return "pnpm-lock.yaml";
    case "npm":
      return "package-lock.json";
  }
}

/**
 * Reads the contents of the lockfile
 * @param {string} gitRoot
 * @returns {Promise<string>}
 */
async function getLockfileContent(gitRoot) {
  const lockfile = await getLockfile(gitRoot);
  if (!lockfile) return "";
  return await readFileIfExists(`${gitRoot}/${lockfile}`);
}

/**
 * Reads the contents of a file if it exists
 * @param {string} filepath
 * @returns {Promise<string>}
 */
async function readFileIfExists(filepath) {
  try {
    return await fs.readFile(filepath, "utf8");
  } catch {
    return "";
  }
}

/**
 * Quickly checks if a local branch can be safely deleted
 * @param {string} branchName Name of the branch to check
 * @param {string} mainBranch Name of the main branch (default: 'master')
 * @returns {Promise<{safe: boolean, reason?: string}>}
 */
async function canSafelyDeleteBranch(branchName, mainBranch = "master") {
  try {
    const mergedBranches = (await $`git branch --merged ${mainBranch}`).stdout;
    if (mergedBranches.includes(branchName)) {
      return { safe: true, reason: "Branch is fully merged" };
    }
    const branchTree = (await $`git rev-parse "${branchName}"^{tree}`).stdout.trim();
    const mainTree = (await $`git rev-parse "${mainBranch}"^{tree}`).stdout.trim();
    if (branchTree === mainTree) {
      return { safe: true, reason: "Branch content matches current main" };
    }
    return { safe: false, reason: "Branch may contain unique commits" };
  } catch (e) {
    return { safe: false, reason: `Error checking branch: ${e instanceof Error ? e.message : e}` };
  }
}

// Helper functions for cleanupStaleBranches, defined at module scope
/** @param {string} string */
const escapeRegExp = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * @param {string} branchNameRaw Raw branch name
 * @param {string} remoteNameRaw Raw remote name
 * @returns {string} Regex pattern string for RegExp constructor
 */
const buildGoneRegexPattern = (branchNameRaw, remoteNameRaw) => {
    const bRawStr = String(branchNameRaw);
    const rRawStr = String(remoteNameRaw);
    const bEscaped = escapeRegExp(bRawStr);
    const rEscaped = escapeRegExp(rRawStr);

    const corePattern = '\\[' + rEscaped + '/' + bEscaped + ':\\s*gone\\]';
    const fullPattern = '^\\s*(\\*\\s+)?' + bEscaped + '.*?\\s*' + corePattern + '.*';
    return fullPattern;
};

async function cleanupStaleBranches() {
  log.action("Cleaning up stale branches...");

  const branchesOutput = await $`git for-each-ref refs/heads/ --format='%(refname:short)'`;
  const localBranches = branchesOutput.stdout.trim().split("\n").filter(Boolean);

  if (localBranches.length === 0) {
    log.info("No local branches found to clean up.");
    return;
  }

  const staleBranches = [];
  const now = new Date();
  const oneMonthAgoDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  oneMonthAgoDate.setUTCMonth(oneMonthAgoDate.getUTCMonth() - 1);
  const oneMonthAgoTimestamp = oneMonthAgoDate.getTime();

  const rawRemoteName = (await $`git remote show -n`.catch(() => ({ stdout: "" }))).stdout.trim() || "origin";

  let branchVerboseOutput;
  // Use mocked output if the specific env var is set (useful for testing)
  if (process.env.TEST_MOCK_GIT_BRANCH_VV_OUTPUT) {
    branchVerboseOutput = process.env.TEST_MOCK_GIT_BRANCH_VV_OUTPUT;
  } else {
    branchVerboseOutput = (await $`git branch -vv`).stdout;
  }

  for (const branch of localBranches) {
    if (branch === "main" || branch === "master") {
      continue;
    }

    const lastCommitDateTimestamp = (await $`git log -1 --format=%ct ${branch}`).stdout.trim();
    const lastCommitDate = new Date(parseInt(lastCommitDateTimestamp, 10) * 1000);
    const isOlderThanOneMonth = lastCommitDate.getTime() < oneMonthAgoTimestamp;

    const remoteGoneRegexPattern = buildGoneRegexPattern(branch, rawRemoteName);
    const remoteGoneRegex = new RegExp(remoteGoneRegexPattern, "m");
    const isRemoteGone = remoteGoneRegex.test(branchVerboseOutput);

    if (isOlderThanOneMonth && isRemoteGone) {
      staleBranches.push(branch);
    }
  }

  if (staleBranches.length === 0) {
    log.info("No stale branches found matching the criteria.");
    return;
  }

  let branchesToDelete = staleBranches;
  if (staleBranches.length > 5) {
    log.info(`Found ${staleBranches.length} stale branches. Randomly selecting 5 for deletion.`);
    branchesToDelete = staleBranches.sort(() => 0.5 - Math.random()).slice(0, 5);
  }

  branchesToDelete.sort();

  log.warning("The following stale branches are selected for deletion:");
  branchesToDelete.forEach(branch => console.log(`  - ${chalk.bold(branch)}`));
  console.log("");

  const confirmed = await confirmAction(
    `Do you want to delete these ${branchesToDelete.length} branches?`
  );

  if (confirmed) {
    for (const branch of branchesToDelete) {
      log.action(`Deleting branch ${chalk.bold(branch)}...`);
      try {
        await $`git branch -D ${branch}`;
        log.success(`Branch ${chalk.bold(branch)} deleted.`);
      } catch (e) {
        if (e instanceof Error && 'stderr' in e) {
          // @ts-ignore Property 'stderr' does exist on ProcessOutput
          log.error(`Failed to delete branch ${chalk.bold(branch)}: ${e.stderr || e.message}`);
        } else if (e instanceof Error) {
          log.error(`Failed to delete branch ${chalk.bold(branch)}: ${e.message}`);
        } else {
          log.error(`Failed to delete branch ${chalk.bold(branch)}: ${String(e)}`);
        }
      }
    }
  } else {
    log.info("Branch deletion cancelled.");
  }
}

async function main() {
  const defaultRemote = (await $`git remote show -n`).stdout.trim();
  if (!defaultRemote) {
    log.error("No remote repository found");
    process.exit(1);
  }

  try {
    log.action("Fetching latest changes...");
    await $`git fetch`;
  } catch (e) {
    if (e instanceof Error && e.message.includes("fatal: not a git repository")) {
      log.error("Not a git repository");
      process.exit(1);
    }
  }

  let mainBranch = "main";
  try {
    await $`git rev-parse --quiet --verify ${mainBranch}`;
  } catch {
    mainBranch = "master";
  }
  log.info(`Using main branch: ${chalk.bold(mainBranch)}`);

  const gitRoot = (await $`git rev-parse --show-toplevel`).stdout.trim();
  const packageManager = await detectPackageManager(gitRoot);

  const currentBranch = (await $`git rev-parse --abbrev-ref HEAD`).stdout.trim();
  const status = (await $`git status --porcelain`).stdout;

  if (status) {
    if (currentBranch === mainBranch) {
      console.log("");
      log.warning(`You are on ${chalk.bold(mainBranch)} branch with uncommitted changes:\n`);
      const files = (await $`git ls-files -mo --exclude-standard`).stdout;
      files.split("\n").filter(Boolean).forEach((file) => {
        console.log(` ./${chalk.bold(file)}`);
      });
      console.log("");
      if (await confirmAction("Revert all changes?")) {
        log.action("Resetting working directory...");
        await $`git add --all`;
        await $`git reset --hard HEAD`;
        log.success("Working directory cleaned");
      } else {
        process.exit(1);
      }
    } else {
      log.error("Branch is not clean");
      process.exit(1);
    }
  }

  const originalLockfileContent = await getLockfileContent(gitRoot);

  if (currentBranch !== mainBranch) {
    log.action(`Switching to ${chalk.bold(mainBranch)} branch...`);
    await $`git checkout ${mainBranch}`;
  }

  log.action("Pulling latest changes...");
  let needsCleanup = true;
  const pullResult = await $`git pull`;
  if (pullResult.stdout.includes("Already up to date.")) {
    log.info("Repository is already up to date");
    needsCleanup = false;
  }

  let hasLockfileChanges = false;
  if (packageManager) {
    const newLockfileContent = await getLockfileContent(gitRoot);
    hasLockfileChanges = originalLockfileContent !== newLockfileContent;
  }

  if (needsCleanup) {
    log.action("Cleaning up merged branches...");
    const branches = (await $`git for-each-ref refs/heads/ --format='%(refname:short)'`).stdout
      .trim().split("\n").filter((branch) => branch !== mainBranch);
    for (const branch of branches) {
      const { safe, reason } = await canSafelyDeleteBranch(branch, mainBranch);
      if (safe) {
        log.info(`Deleting branch ${chalk.bold(branch)} (${reason})`);
        await $`git branch -D ${branch}`;
      } else {
        log.warning(`Skipping branch ${chalk.bold(branch)} (${reason})`);
      }
    }
  } else {
    log.info("Skipping branch cleanup");
  }

  await cleanupStaleBranches();

  if (hasLockfileChanges && packageManager) {
    await spinner(
      `Installing dependencies with ${chalk.bold(packageManager)}...`,
      () => installDependencies(packageManager, gitRoot)
    );
  } else if (packageManager) {
    log.info(`${await getLockfile(gitRoot)} is unchanged`);
  }

  log.success("All done! 🎉");
}

main().then(
  () => process.exit(0),
  (error) => {
    log.error(`Error: ${error.message}`);
    process.exit(1);
  }
);

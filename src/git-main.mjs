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
  // Check for lockfiles in order of preference
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
      await $`cd "${gitRoot}" && pnpm install --frozen-lockfile`.pipe(
        process.stdout
      );
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
 * Finds branches with deleted remotes (remote tracking branches that are gone)
 * @param {string} mainBranch
 * @returns {Promise<string[]>}
 */
async function findBranchesWithDeletedRemotes(mainBranch) {
  const branchesToDelete = [];

  try {
    // Clean stale remote refs first
    await $`git remote prune origin`;

    // Get branches with remote tracking info
    const branchOutput = (await $`git branch -vv`).stdout;
    const branches = branchOutput.split("\n").filter(Boolean);

    const currentBranch = (
      await $`git rev-parse --abbrev-ref HEAD`
    ).stdout.trim();

    for (const line of branches) {
      const match = line.match(
        /^\s*(\*?\s*)([^\s]+)\s+[a-f0-9]+(?:\s+\[([^\]]+)\])?\s*(.*)/
      );
      if (!match) continue;

      const branchName = match[2];
      const trackingInfo = match[3] || "";

      // Safety checks - skip protected branches
      if (
        !branchName ||
        branchName === currentBranch ||
        branchName === mainBranch ||
        branchName === "master" ||
        branchName === "main"
      ) {
        continue;
      }

      // Check if remote is gone
      const isRemoteGone = trackingInfo && trackingInfo.includes(": gone");

      if (isRemoteGone) {
        branchesToDelete.push(branchName);
      }
    }
    return branchesToDelete;
  } catch (e) {
    log.error(
      `Error finding branches with deleted remotes: ${e instanceof Error ? e.message : e}`
    );
    return [];
  }
}


async function main() {
  // Argument validation - only allow single branch name argument
  const args = process.argv.slice(2);
  if (args.length > 1 || args?.[0]?.startsWith("-")) {
    log.error("Usage: git-main [branch-name]");
    process.exit(1);
  }

  const explicitBranch = args.length === 1 ? args[0] : null;
  const defaultRemote = (await $`git remote show -n`).stdout.trim();
  if (!defaultRemote) {
    log.error("No remote repository found");
    process.exit(1);
  }

  // Determine main branch - use explicit argument or detect main/master
  let mainBranch;
  if (explicitBranch) {
    // Check if explicitly provided branch exists locally
    try {
      await $`git rev-parse --quiet --verify ${explicitBranch}`;
      mainBranch = explicitBranch;
    } catch {
      // Branch doesn't exist locally, check if it exists on remote
      try {
        await $`git ls-remote --exit-code origin ${explicitBranch}`;
        // Branch exists on remote, checkout and track it
        log.action(`Checking out remote branch ${chalk.bold(explicitBranch)}...`);
        await $`git checkout -b ${explicitBranch} origin/${explicitBranch}`;
        mainBranch = explicitBranch;
      } catch {
        // Branch doesn't exist locally or on remote, ask to create it
        const shouldCreate = await confirmAction(
          `Branch '${explicitBranch}' does not exist locally or on remote. Create it?`
        );
        if (shouldCreate) {
          log.action(`Creating branch ${chalk.bold(explicitBranch)}...`);
          await $`git checkout -b ${explicitBranch}`;
          mainBranch = explicitBranch;
        } else {
          process.exit(1);
        }
      }
    }
  } else {
    // Auto-detect main/master branch
    mainBranch = "main";
    try {
      await $`git rev-parse --quiet --verify ${mainBranch}`;
    } catch {
      mainBranch = "master";
    }
  }
  log.info(`Using main branch: ${chalk.bold(mainBranch)}`);

  try {
    log.action("Fetching latest changes...");
    await $`git fetch`;
  } catch (e) {
    if (
      e instanceof Error &&
      e.message.includes("fatal: not a git repository")
    ) {
      log.error("Not a git repository");
      process.exit(1);
    }
  }

  // Get git root and check package manager changes
  const gitRoot = (await $`git rev-parse --show-toplevel`).stdout.trim();
  const packageManager = await detectPackageManager(gitRoot);

  const currentBranch = (
    await $`git rev-parse --abbrev-ref HEAD`
  ).stdout.trim();

  const status = (await $`git status --porcelain`).stdout;
  if (status) {
    if (currentBranch === mainBranch) {
      console.log("");
      log.warning(
        `You are on ${chalk.bold(
          mainBranch
        )} branch with uncommitted changes:\n`
      );
      const files = (await $`git ls-files -mo --exclude-standard`).stdout;
      files
        .split("\n")
        .filter(Boolean)
        .forEach((file) => {
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

  // Switch to main branch if needed
  if (currentBranch !== mainBranch) {
    log.action(`Switching to ${chalk.bold(mainBranch)} branch...`);
    await $`git checkout ${mainBranch}`;
  }

  // Pull changes
  log.action("Pulling latest changes...");
  try {
    const pullResult = await $`git pull`;
    if (pullResult.stdout.includes("Already up to date.")) {
      log.info("Repository is already up to date");
    }
  } catch (e) {
    // Handle case where custom branch has no upstream tracking
    if (
      explicitBranch &&
      e instanceof Error &&
      e.message.includes("There is no tracking information")
    ) {
      log.info(
        `Branch '${mainBranch}' has no upstream tracking, skipping pull`
      );
    } else {
      throw e;
    }
  }

  // Compare lockfile contents after pull
  let hasLockfileChanges = false;
  if (packageManager) {
    const newLockfileContent = await getLockfileContent(gitRoot);
    hasLockfileChanges = originalLockfileContent !== newLockfileContent;
  }

  if (mainBranch === "master" || mainBranch === "main") {
    // Auto-cleanup branches with deleted remotes
    log.action("Cleaning up branches with deleted remotes...");

    const branchesToDelete = await findBranchesWithDeletedRemotes(mainBranch);

    if (branchesToDelete.length === 0) {
      log.info("No branches with deleted remotes found");
    } else {
      // Automatically delete branches with deleted remotes
      for (const branchName of branchesToDelete) {
        log.info(`Deleting branch ${chalk.bold(branchName)} (remote deleted)`);
        await $`git branch -D ${branchName}`;
      }
      log.success(
        `Deleted ${branchesToDelete.length} branch${
          branchesToDelete.length > 1 ? "es" : ""
        } with deleted remotes`
      );
    }
  }

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

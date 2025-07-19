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
        process.stdout,
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
 * Performs initial repository setup operations in parallel for better performance
 * @returns {Promise<{defaultRemote: string, gitRoot: string}>}
 */
async function setupRepository() {
  const [remoteResult, gitRootResult] = await Promise.all([
    $`git remote show -n`,
    $`git rev-parse --show-toplevel`,
  ]);

  const defaultRemote = remoteResult.stdout.trim();
  const gitRoot = gitRootResult.stdout.trim();

  if (!defaultRemote) {
    log.error("No remote repository found");
    process.exit(1);
  }

  return { defaultRemote, gitRoot };
}

/**
 * Fetches changes and detects package manager configuration in parallel
 * @param {string} gitRoot - The git repository root path
 * @returns {Promise<{packageManager: PackageManager | null, originalLockfileContent: string}>}
 */
async function fetchAndDetectDependencies(gitRoot) {
  const [packageManager, originalLockfileContent] = await Promise.all([
    detectPackageManager(gitRoot),
    getLockfileContent(gitRoot),
    $`git fetch`.catch((e) => {
      if (
        e instanceof Error &&
        e.message.includes("fatal: not a git repository")
      ) {
        log.error("Not a git repository");
        process.exit(1);
      }
      throw e;
    }),
  ]);

  return { packageManager, originalLockfileContent };
}

/**
 * Validates branch existence locally and remotely in parallel
 * @param {string} branchName - The branch to validate
 * @param {string} defaultRemote - The default remote name
 * @returns {Promise<{localExists: boolean, remoteExists: boolean}>}
 */
async function validateBranchExistence(branchName, defaultRemote) {
  const validationResults = await Promise.allSettled([
    $`git rev-parse --quiet --verify ${branchName}`,
    $`git ls-remote --exit-code ${defaultRemote} ${branchName}`,
  ]);

  const localExists = validationResults[0].status === "fulfilled";
  const remoteExists = validationResults[1].status === "fulfilled";

  return { localExists, remoteExists };
}

/**
 * Pull optimization leveraging prior fetch. Uses git merge --ff-only which attempts 
 * fast-forward merge without creating merge commits, falling back to standard pull
 * @param {string} mainBranch 
 * @param {string} remote
 */
async function quickPull(mainBranch, remote) {
  try {
    await $`git merge --ff-only ${remote}/${mainBranch}`;
    log.success("Fast-forwarded to latest changes");
  } catch (e) {
    log.action("Cannot fast-forward, using git pull...");
    try {
      const pullResult = await $`git pull`;
      if (pullResult.stdout.includes("Already up to date.")) {
        log.info("Repository is already up to date");
      }
    } catch (pullError) {
      if (
        pullError instanceof Error &&
        pullError.message.includes("There is no tracking information")
      ) {
        log.info(`Branch '${mainBranch}' has no upstream tracking, skipping pull`);
      } else {
        throw pullError;
      }
    }
  }
}

/**
 * Finds branches with deleted remotes (remote tracking branches that are gone)
 * @param {string} mainBranch
 * @param {string} defaultRemote
 * @returns {Promise<string[]>}
 */
async function findBranchesWithDeletedRemotes(mainBranch, defaultRemote) {
  const branchesToDelete = [];

  try {
    // Run cleanup operations in parallel - prune and get branch info concurrently
    const [, branchResult, currentBranch] = await Promise.all([
      $`git remote prune ${defaultRemote}`,
      $`git branch -vv`,
      $`git rev-parse --abbrev-ref HEAD`.then((result) => result.stdout.trim()),
    ]);

    const branches = branchResult.stdout.split("\n").filter(Boolean);

    for (const line of branches) {
      const match = line.match(
        /^\s*(\*?\s*)([^\s]+)\s+[a-f0-9]+(?:\s+\[([^\]]+)\])?\s*(.*)/,
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
      `Error finding branches with deleted remotes: ${e instanceof Error ? e.message : e}`,
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

  // Setup repository and get essential information
  log.action("Setting up repository...");
  const { defaultRemote, gitRoot } = await setupRepository();

  // Fetch changes and detect dependencies in parallel
  log.action("Fetching latest changes and detecting dependencies...");
  const {
    packageManager: finalPackageManager,
    originalLockfileContent: finalOriginalLockfileContent,
  } = await fetchAndDetectDependencies(gitRoot);

  // Determine main branch - use explicit argument or detect main/master
  let mainBranch;

  // Auto-detect main/master branch
  mainBranch = "main";
  try {
    await $`git rev-parse --quiet --verify ${mainBranch}`;
  } catch {
    mainBranch = "master";
  }
  log.info(`Using main branch: ${chalk.bold(mainBranch)}`);

  /** @type {string|null} */
  let createNewBranch = null;
  /** @type {boolean} whether the branch exists on remote */
  let isRemoteBranch = false;
  if (explicitBranch) {
    // Validate branch existence in parallel
    const { localExists, remoteExists } = await validateBranchExistence(
      explicitBranch,
      defaultRemote,
    );

    if (localExists) {
      mainBranch = explicitBranch;
    } else if (remoteExists) {
      // Branch exists on remote, will checkout and track it later
      mainBranch = explicitBranch;
      isRemoteBranch = true;
    } else {
      // Branch doesn't exist locally or on remote, ask to create it
      const shouldCreate = await confirmAction(
        `Branch '${explicitBranch}' does not exist locally or on remote. Create it?`,
      );
      if (!shouldCreate) {
        process.exit(1);
      }
      createNewBranch = explicitBranch;
    }
  }

  const currentBranch = (
    await $`git rev-parse --abbrev-ref HEAD`
  ).stdout.trim();

  const status = (await $`git status --porcelain`).stdout;
  if (status) {
    // When creating a new branch, allow dirty state - we'll create the branch with uncommitted changes
    if (createNewBranch) {
      log.info("Creating new branch with uncommitted changes");
    } else if (currentBranch === mainBranch) {
      console.log("");
      log.warning(
        `You are on ${chalk.bold(
          mainBranch,
        )} branch with uncommitted changes:\n`,
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

  // Only pull on main if we're not creating a new branch on dirty state
  if (!(createNewBranch && status)) {
    // Switch to main branch if needed
    if (currentBranch !== mainBranch) {
      // If the branch exist on remote but not locally, create it
      if (isRemoteBranch) {
        log.action(`Switching to remote branch ${chalk.bold(mainBranch)}...`);
        await $`git checkout -b ${mainBranch} ${defaultRemote}/${mainBranch}`;
      }
      // If we are not going to create a new branch, checkout the main branch
      // that allows branching of another branch
      else if (!createNewBranch) {
        log.action(`Switching to ${chalk.bold(mainBranch)} branch...`);
        await $`git checkout ${mainBranch}`;
      } else {
        log.info(`Branching off from ${chalk.bold(currentBranch)} branch`);
      }
    }

    // Pull changes
    log.action("Pulling latest changes...");
    await quickPull(mainBranch, defaultRemote);
  }

  // Compare lockfile contents after pull
  let hasLockfileChanges = false;
  if (finalPackageManager) {
    const newLockfileContent = await getLockfileContent(gitRoot);
    hasLockfileChanges = finalOriginalLockfileContent !== newLockfileContent;
  }

  // Create branch if needed (after pulling latest changes)
  if (createNewBranch) {
    log.action(`Creating branch ${chalk.bold(createNewBranch)}...`);
    await $`git checkout -b ${createNewBranch}`;
  }

  if (mainBranch === "master" || mainBranch === "main") {
    // Auto-cleanup branches with deleted remotes
    log.action("Cleaning up branches with deleted remotes...");

    const branchesToDelete = await findBranchesWithDeletedRemotes(
      mainBranch,
      defaultRemote,
    );

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
        } with deleted remotes`,
      );
    }
  }

  if (hasLockfileChanges && finalPackageManager) {
    await spinner(
      `Installing dependencies with ${chalk.bold(finalPackageManager)}...`,
      () => installDependencies(finalPackageManager, gitRoot),
    );
  } else if (finalPackageManager) {
    log.info(`${await getLockfile(gitRoot)} is unchanged`);
  }

  log.success("All done! 🎉");
}

main().then(
  () => process.exit(0),
  (error) => {
    log.error(`Error: ${error.message}`);
    process.exit(1);
  },
);

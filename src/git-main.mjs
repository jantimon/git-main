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
 * Quickly checks if a local branch can be safely deleted
 * Uses git's built-in branch management tools for maximum performance
 *
 * @param {string} branchName Name of the branch to check
 * @param {string} mainBranch Name of the main branch (default: 'master')
 * @returns {Promise<{safe: boolean, reason?: string}>}
 */
async function canSafelyDeleteBranch(branchName, mainBranch = "master") {
  try {
    // `git branch --merged` is very fast as git maintains this information
    const mergedBranches = (await $`git branch --merged ${mainBranch}`).stdout;

    // If branch is fully merged, we can safely delete it
    if (mergedBranches.includes(branchName)) {
      return { safe: true, reason: "Branch is fully merged" };
    }

    // If not merged, do a quick check for identical tree with current main
    // This is fast because we're only checking one tree hash
    const branchTree = (
      await $`git rev-parse "${branchName}"^{tree}`
    ).stdout.trim();
    const mainTree = (
      await $`git rev-parse "${mainBranch}"^{tree}`
    ).stdout.trim();

    if (branchTree === mainTree) {
      return { safe: true, reason: "Branch content matches current main" };
    }

    return {
      safe: false,
      reason: "Branch may contain unique commits",
    };
  } catch (e) {
    return {
      safe: false,
      reason: `Error checking branch: ${e instanceof Error ? e.message : e}`,
    };
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

  // Detect main/master branch
  let mainBranch = "main";
  try {
    await $`git rev-parse --quiet --verify ${mainBranch}`;
  } catch {
    mainBranch = "master";
  }
  log.info(`Using main branch: ${chalk.bold(mainBranch)}`);

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
  let needsCleanup = true;
  const pullResult = await $`git pull`;
  if (pullResult.stdout.includes("Already up to date.")) {
    log.info("Repository is already up to date");
    needsCleanup = false;
  }

  // Compare lockfile contents after pull
  let hasLockfileChanges = false;
  if (packageManager) {
    const newLockfileContent = await getLockfileContent(gitRoot);
    hasLockfileChanges = originalLockfileContent !== newLockfileContent;
  }

  if (needsCleanup) {
    log.action("Cleaning up merged branches...");

    const branches = (
      await $`git for-each-ref refs/heads/ --format='%(refname:short)'`
    ).stdout
      .trim()
      .split("\n")
      .filter((branch) => branch !== mainBranch);

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

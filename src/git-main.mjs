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
 * @typedef StaleBranch
 * @property {string} name - Branch name
 * @property {number} age - Age in seconds
 * @property {number} unpushedCommits - Number of unpushed commits
 * @property {'current' | 'old' | 'very-old'} category - Age category
 */

/**
 * Gets the age category for a branch based on its age in seconds
 * @param {number} ageInSeconds
 * @returns {'current' | 'old' | 'very-old'}
 */
function getAgeCategory(ageInSeconds) {
  const days = ageInSeconds / (24 * 60 * 60);
  if (days < 7) return "current";
  if (days < 28) return "old";
  return "very-old";
}

/**
 * Formats age in a human-readable way
 * @param {number} ageInSeconds
 * @returns {string}
 */
function formatAge(ageInSeconds) {
  const hours = Math.floor(ageInSeconds / (60 * 60));
  const days = Math.floor(ageInSeconds / (24 * 60 * 60));
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (months > 0) return `${months} month${months > 1 ? "s" : ""} ago`;
  if (weeks > 0) return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
  if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  return "less than 1 hour ago";
}

/**
 * Finds branches with deleted remotes (stale branches)
 * @param {string} mainBranch
 * @returns {Promise<StaleBranch[]>}
 */
async function findStaleBranches(mainBranch) {
  try {
    // Clean stale remote refs first
    await $`git remote prune origin`;

    // Get branches with remote tracking info
    const branchOutput = (await $`git branch -vv`).stdout;
    const branches = branchOutput.split("\n").filter(Boolean);

    const staleBranches = [];
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

      // Skip branches that were never pushed (no remote tracking)
      if (!trackingInfo) continue;

      // Check if remote is gone
      if (trackingInfo.includes(": gone")) {
        // Get branch age (last commit timestamp)
        const ageOutput = await $`git log -1 --format=%ct ${branchName}`;
        const lastCommitTime = parseInt(ageOutput.stdout.trim());
        const currentTime = Math.floor(Date.now() / 1000);
        const age = currentTime - lastCommitTime;

        // Count unpushed commits
        const cherryOutput = await $`git cherry ${mainBranch} ${branchName}`;
        const unpushedCommits = cherryOutput.stdout
          .split("\n")
          .filter((line) => line.startsWith("+")).length;

        staleBranches.push({
          name: branchName,
          age,
          unpushedCommits,
          category: getAgeCategory(age),
        });
      }
    }

    return staleBranches;
  } catch (e) {
    log.error(
      `Error finding stale branches: ${e instanceof Error ? e.message : e}`
    );
    return [];
  }
}

/**
 * Groups stale branches by category with smart limiting
 * @param {StaleBranch[]} branches
 * @returns {Object<string, StaleBranch[]>}
 */
function groupAndLimitBranches(branches) {
  const grouped = {
    current: branches.filter((b) => b.category === "current").slice(0, 1),
    old: branches.filter((b) => b.category === "old").slice(0, 2),
    "very-old": branches.filter((b) => b.category === "very-old").slice(0, 2),
  };

  return grouped;
}

/**
 * Displays categorized branches for cleanup
 * @param {Object<string, StaleBranch[]>} groupedBranches
 * @returns {StaleBranch[]} All branches to potentially delete
 */
function displayStaleBranches(groupedBranches) {
  const allBranches = [];
  const categoryTitles = {
    current: "CURRENT (< 1 week)",
    old: "OLD (1-4 weeks)",
    "very-old": "VERY OLD (> 1 month)",
  };

  const hasMultipleCategories =
    Object.values(groupedBranches).filter((arr) => arr.length > 0).length > 1;

  for (const [category, branches] of Object.entries(groupedBranches)) {
    if (branches.length === 0) continue;

    if (hasMultipleCategories) {
      const title =
        categoryTitles[/** @type {keyof typeof categoryTitles} */ (category)];
      console.log(chalk.bold(title) + ":");
    }

    for (const branch of branches) {
      const unpushedInfo =
        branch.unpushedCommits > 0
          ? `, has ${branch.unpushedCommits} unpushed commit${
              branch.unpushedCommits > 1 ? "s" : ""
            }`
          : "";

      console.log(
        `→ ${chalk.yellow(branch.name)} (${formatAge(
          branch.age
        )}) - remote deleted${unpushedInfo}`
      );
      allBranches.push(branch);
    }

    if (hasMultipleCategories) console.log("");
  }

  return allBranches;
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
    // Check if explicitly provided branch exists
    try {
      await $`git rev-parse --quiet --verify ${explicitBranch}`;
      mainBranch = explicitBranch;
    } catch {
      // Branch doesn't exist, ask to create it
      const shouldCreate = await confirmAction(
        `Branch '${explicitBranch}' does not exist. Create it?`
      );
      if (shouldCreate) {
        log.action(`Creating branch ${chalk.bold(explicitBranch)}...`);
        await $`git checkout -b ${explicitBranch}`;
        mainBranch = explicitBranch;
      } else {
        process.exit(1);
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
    // Auto-cleanup stale branches with deleted remotes
    log.action("🔍 Scanning for stale branches...");

    let deletedMergedBranches = 0;
    // Find and delete branches that are already merged into main
    const branchList = (await $`git for-each-ref refs/heads/ "--format=%(refname:short)"`).stdout.trim().split('\n');
    for (const branch of branchList) {
      if (branch === mainBranch || branch === currentBranch) continue;
      
      try {
        // Find merge base between main and the branch
        const mergeBase = (await $`git merge-base ${mainBranch} ${branch}`).stdout.trim();
        
        // Create a commit object with the branch's tree but using merge base as parent
        const treeish = (await $`git rev-parse ${branch}^{tree}`).stdout.trim();
        const commitId = (await $`git commit-tree ${treeish} -p ${mergeBase} -m _`).stdout.trim();
        
        // Check if this commit is already in main branch (meaning branch is merged)
        const cherryResult = (await $`git cherry ${mainBranch} ${commitId}`).stdout.trim();
        
        if (cherryResult.startsWith('-')) {
          // Branch is already merged, delete it
          log.info(`Deleting fully merged branch ${chalk.bold(branch)}`);
          await $`git branch -D ${branch}`;
          deletedMergedBranches++;
        }
      } catch (e) {
        // Skip branches that cause errors
      }
    }

    const staleBranches = await findStaleBranches(mainBranch);

    if (deletedMergedBranches > 0 && staleBranches.length === 0) {
      log.success(
        `Deleted ${deletedMergedBranches} fully merged branch${
          deletedMergedBranches > 1 ? "es" : ""
        }`
      );
    } else if (staleBranches.length === 0) {
      log.info("No stale branches found");
    } else {
      console.log(
        `Found ${staleBranches.length} branch${
          staleBranches.length > 1 ? "es" : ""
        } to clean up:`
      );

      const groupedBranches = groupAndLimitBranches(staleBranches);
      const allBranches = displayStaleBranches(groupedBranches);

      if (allBranches.length > 0) {
        let choice = "";

        // Bulk delete prompt
        if (allBranches.length > 1) {
          console.log("");
          console.log(
            `Delete all ${allBranches.length} stale branch${
              allBranches.length > 1 ? "es" : ""
            }? [Enter to pick individually]`
          );

          while (choice !== "y" && choice !== "n" && choice !== "") {
            choice = await question(
              `Delete all? [${chalk.green("y")}/${chalk.red(
                "n"
              )}/${chalk.yellow("Enter")}]: `
            );
          }
        }

        if (choice === "y") {
          // Bulk delete all branches
          for (const branch of allBranches) {
            log.info(`Deleting branch ${chalk.bold(branch.name)}`);
            await $`git branch -D ${branch.name}`;
          }
          log.success(
            `Deleted ${allBranches.length} stale branch${
              allBranches.length > 1 ? "es" : ""
            }`
          );
        } else if (choice === "") {
          // Individual review mode
          console.log("");
          for (const branch of allBranches) {
            const unpushedInfo =
              branch.unpushedCommits > 0
                ? ` (${branch.unpushedCommits} unpushed commit${
                    branch.unpushedCommits > 1 ? "s" : ""
                  })`
                : "";

            const shouldDelete = await confirmAction(
              `Delete ${chalk.bold(branch.name)} (${formatAge(
                branch.age
              )})${unpushedInfo}?`
            );

            if (shouldDelete) {
              log.info(`Deleting branch ${chalk.bold(branch.name)}`);
              await $`git branch -D ${branch.name}`;
            }
          }
        }
      }
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

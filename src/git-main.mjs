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
// Placed escapeRegExp at a higher scope, accessible to buildGoneRegexPattern
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

    // Using string concatenation for clarity with backslashes for RegExp
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
  // Correctly calculate one month ago in UTC for reliable comparison
  const now = new Date();
  const oneMonthAgoDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  oneMonthAgoDate.setUTCMonth(oneMonthAgoDate.getUTCMonth() - 1);
  const oneMonthAgoTimestamp = oneMonthAgoDate.getTime();

  /** @param {string} string */
  function escapeRegExp(string) { // Moved to higher scope for buildGoneRegexPattern
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * @param {string} branchNameRaw Raw branch name (unescaped)
   * @param {string} remoteNameRaw Raw remote name (unescaped)
   * @param {boolean} isDebugLogEnabled
   * @returns {string} Regex pattern string
   */
  function buildGoneRegexPattern(branchNameRaw, remoteNameRaw, isDebugLogEnabled) {
      const bRawStr = String(branchNameRaw);
      const rRawStr = String(remoteNameRaw);

      const bEscaped = escapeRegExp(bRawStr);
      const rEscaped = escapeRegExp(rRawStr);

      if (isDebugLogEnabled && branchNameRaw === 'stale-and-gone') { // Log char codes only for specific branch
          let bc = ""; for(let i=0; i < bEscaped.length; i++) bc += bEscaped.charCodeAt(i) + " ";
          let rc = ""; for(let i=0; i < rEscaped.length; i++) rc += rEscaped.charCodeAt(i) + " ";
          log.info(`[DEBUG buildGoneRegexPattern] Escaped branch ('${bEscaped}') chars: ${bc.trim()}`);
          log.info(`[DEBUG buildGoneRegexPattern] Escaped remote ('${rEscaped}') chars: ${rc.trim()}`);
      }
      // In a string for new RegExp, \s becomes whitespace char class, literal [ needs \[
      // String concatenation is used to avoid issues with template literal processing of backslashes for RegExp.
      const corePattern = '\\[' + rEscaped + '/' + bEscaped + ':\\s*gone\\]'; // \s* for regex engine
      const fullPattern = '^\\s*(\\*\\s+)?' + bEscaped + '.*?\\s*' + corePattern + '.*'; // All \s become \s for regex engine

      if (isDebugLogEnabled) {
        log.info(`[DEBUG buildGoneRegexPattern] Constructed corePattern string: "${corePattern}"`);
        log.info(`[DEBUG buildGoneRegexPattern] Constructed fullPattern string: "${fullPattern}"`);
      }
      return fullPattern;
  }

  const rawRemoteName = (await $`git remote show -n`.catch(() => ({ stdout: "" }))).stdout.trim() || "origin";
  // Note: remoteName is now derived inside the loop if it needs to be branch-specific,
  // or use this global rawRemoteName for buildGoneRegexPattern's remoteNameRaw argument.
  // For now, assuming rawRemoteName is the one to use for all branches.

  let branchVerboseOutput;
  // Use mocked output ONLY if debug mode is active AND the env var is set
  if (isTestDebugMode && process.env.TEST_MOCK_GIT_BRANCH_VV_OUTPUT) { // isTestDebugMode check remains for mock activation
    branchVerboseOutput = process.env.TEST_MOCK_GIT_BRANCH_VV_OUTPUT;
  } else {
    branchVerboseOutput = (await $`git branch -vv`).stdout;
  }

  for (const branch of localBranches) {
    // Skip main/master branch
    if (branch === "main" || branch === "master") {
      continue;
    }

    const lastCommitDateTimestamp = (await $`git log -1 --format=%ct ${branch}`).stdout.trim();
    const lastCommitDate = new Date(parseInt(lastCommitDateTimestamp, 10) * 1000); // This is already UTC-based

    const isOlderThanOneMonth = lastCommitDate.getTime() < oneMonthAgoTimestamp;

    const escapedBranch = escapeRegExp(String(branch)); // Ensure branch is string then escape
    const currentRemoteName = escapeRegExp(String(rawRemoteName)); // Ensure rawRemoteName is string then escape for this specific regex construction

    const remoteGoneRegexPattern = buildGoneRegexPattern(branch, rawRemoteName, isTestDebugMode); // buildGoneRegexPattern uses String() and escapeRegExp internally
    const remoteGoneRegex = new RegExp(remoteGoneRegexPattern, "m");
    const isRemoteGone = remoteGoneRegex.test(branchVerboseOutput);

    if (isTestDebugMode) {
      log.info(`[DEBUG] Branch: "${branch}", OlderThan1M: ${isOlderThanOneMonth}, RemoteGone: ${isRemoteGone}`);

      if (isOlderThanOneMonth && !isRemoteGone) {
        log.info(`[DEBUG] ---- Analyzing mismatch for STALE (by date) branch: "${branch}" ----`);
        log.info(`[DEBUG] Using Pattern (multiline): "${remoteGoneRegex.source}"`);
        const lines = branchVerboseOutput.split('\n');
        const relevantLine = lines.find(line => line.includes(branch));

        if (relevantLine) {
          const trimmedLine = relevantLine.trim();
          log.info(`[DEBUG] Relevant trimmed line: ${JSON.stringify(trimmedLine)}`);

          const lineSpecificPattern = buildGoneRegexPattern(branch, rawRemoteName, false); // isDebug=false for this call
          const lineSpecificRegex = new RegExp(lineSpecificPattern);
          log.info(`[DEBUG] Line-specific regex test (pattern: "${lineSpecificRegex.source}"): ${lineSpecificRegex.test(trimmedLine)}`);

          // Only do super detailed char logging for 'stale-and-gone'
          if (branch === 'stale-and-gone' && rawRemoteName === 'origin') {
              const hardcodedPatternString = "\\[origin/stale-and-gone:\\s*gone\\]";
              const hardcodedSimpleRegex = new RegExp(hardcodedPatternString);
              log.info(`[DEBUG_SNG] Hardcoded Simple Regex source: ${hardcodedSimpleRegex.source}`);
              const hardcodedMatchResult = hardcodedSimpleRegex.test(trimmedLine);
              log.info(`[DEBUG_SNG] Hardcoded Simple Regex result: ${hardcodedMatchResult}`);

              if (!hardcodedMatchResult) {
                  log.info(`[DEBUG_SNG] HARDCODED SIMPLE FAILED. Chars for expected part:`);
                  const targetStrInMock = "[origin/stale-and-gone: gone]";
                  const indexInTrimmed = trimmedLine.indexOf(targetStrInMock);
                  if (indexInTrimmed > -1) {
                      const sub = trimmedLine.substring(indexInTrimmed, indexInTrimmed + targetStrInMock.length);
                      let chars = ""; for (let k=0; k < sub.length; k++) { chars += sub.charCodeAt(k) + " "; }
                      log.info(`[DEBUG_SNG] Actual substring ("${sub}") codes: ${chars.trim()}`);
                  }
                  let patternChars = ""; const expected = `[${rawRemoteName}/${branch}: gone]`;
                  for (let k=0; k < expected.length; k++) { patternChars += expected.charCodeAt(k) + " "; }
                  log.info(`[DEBUG_SNG] Expected pattern str ("${expected}") codes: ${patternChars.trim()}`);
              }

              const rRawStrCoerced = String(rawRemoteName);
              const bRawStrCoerced = String(branch);
              const rEscapedCoerced = escapeRegExp(rRawStrCoerced);
              const bEscapedCoerced = escapeRegExp(bRawStrCoerced);
              // Char codes for dynamic parts
              let rcChars = ""; for(let i=0; i < rEscapedCoerced.length; i++) rcChars += rEscapedCoerced.charCodeAt(i) + " ";
              log.info(`[DEBUG_SNG] Char codes for rEscapedCoerced ('${rEscapedCoerced}'): ${rcChars.trim()}`);
              let bcChars = ""; for(let i=0; i < bEscapedCoerced.length; i++) bcChars += bEscapedCoerced.charCodeAt(i) + " ";
              log.info(`[DEBUG_SNG] Char codes for bEscapedCoerced ('${bEscapedCoerced}'): ${bcChars.trim()}`);

              const dynamicSimplePatternStr = '\\[' + rEscapedCoerced + '/' + bEscapedCoerced + ':\\s*gone\\]';
              const dynamicSimpleRegex = new RegExp(dynamicSimplePatternStr);
              log.info(`[DEBUG_SNG] Dynamic Simple Regex source: ${dynamicSimpleRegex.source}`);
              log.info(`[DEBUG_SNG] Dynamic Simple Regex result: ${dynamicSimpleRegex.test(trimmedLine)}`);
              if (!dynamicSimpleRegex.test(trimmedLine)) {
                const directInclude = `[${rawRemoteName}/${branch}: gone]`;
                log.info(`[DEBUG_SNG] Direct include check for "${directInclude}" in trimmedLine: ${trimmedLine.includes(directInclude)}`);
              }
          }
        } else {
          log.info(`[DEBUG] No relevant line found for branch "${branch}" for detailed analysis.`);
        }
        log.info(`[DEBUG] ---- End regex mismatch analysis for branch: "${branch}" ----`);
      }
    }

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
    // Shuffle and pick 5
    branchesToDelete = staleBranches.sort(() => 0.5 - Math.random()).slice(0, 5);
  }

  branchesToDelete.sort(); // Sort alphabetically

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

  // Clean up stale branches
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

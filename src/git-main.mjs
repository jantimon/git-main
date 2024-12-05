/// @ts-check
import { $, spinner, question, fs } from 'zx'
// @ts-ignore
$.quiet = true;
$.verbose = false;

const confirmAction = async message => {
  let result = "";
  while (result !== "y" && result !== "n") {
     result = await question(`${message} [y/n]: `, { choices: ['y', 'n'] });
  }
  return result === "y";
}

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
  if (await fs.pathExists(`${gitRoot}/yarn.lock`)) return 'yarn';
  if (await fs.pathExists(`${gitRoot}/pnpm-lock.yaml`)) return 'pnpm';
  if (await fs.pathExists(`${gitRoot}/package-lock.json`)) return 'npm';
  return null;
}

/**
 * Installs dependencies based on the package manager
 * @param {PackageManager} packageManager 
 * @param {string} gitRoot 
 */
async function installDependencies(packageManager, gitRoot) {
  switch (packageManager) {
    case 'yarn':
      await $`cd "${gitRoot}" && yarn --immutable`.pipe(process.stdout)
      break;
    case 'pnpm':
      await $`cd "${gitRoot}" && pnpm install --frozen-lockfile`.pipe(process.stdout);
      break;
    case 'npm':
      await $`cd "${gitRoot}" && npm ci`.pipe(process.stdout)
      break;
  }
}

/**
 * Gets the lockfile name for the package manager
 * @param {PackageManager} packageManager 
 */
function getLockfile(packageManager) {
  switch (packageManager) {
    case 'yarn': return 'yarn.lock';
    case 'pnpm': return 'pnpm-lock.yaml';
    case 'npm': return 'package-lock.json';
  }
}

/**
 * Reads the contents of a file if it exists
 * @param {string} filepath 
 * @returns {Promise<string>}
 */
async function readFileIfExists(filepath) {
  try {
    return await fs.readFile(filepath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Safely executes git commands with proper branch name escaping
 * @param {string} branchName 
 */
async function isBranchMerged(branchName, mainBranch) {
  try {
    // Use -- to separate branch name from the tree object identifier
    const branchTree = (await $`git rev-parse refs/heads/${branchName}^{tree}`).stdout.trim();
    const mergeBase = (await $`git merge-base ${mainBranch} refs/heads/${branchName}`).stdout.trim();
    const tempCommit = (await $`git commit-tree ${branchTree} -p ${mergeBase} -m "temp"`).stdout.trim();
    const revList = await $`git rev-list ${mainBranch}..${tempCommit}`;
    return !revList.stdout.trim();
  } catch (e) {
    console.error(`Error processing branch ${branchName}:`, e.message);
    return false;
  }
}

async function main() {  
  const defaultRemote = (await $`git remote show -n`).stdout.trim();
  if (!defaultRemote) {
    console.log('❌ no remote repository')
    process.exit(1);
  }
  
  try {
    await $`git fetch`
  } catch (e) {
    if (e.message.includes('fatal: not a git repository')) {
      console.log('❌ not a git repository')
      process.exit(1);
    }
  }

  // Detect main/master branch
  let mainBranch = 'main'
  try {
    await $`git rev-parse --quiet --verify ${mainBranch}`
  } catch {
    mainBranch = 'master'
  }
  console.log(`switching to main branch: ${mainBranch}`)

  // Get git root and check package manager changes
  const gitRoot = (await $`git rev-parse --show-toplevel`).stdout.trim()
  const packageManager = await detectPackageManager(gitRoot);
  
  // Store the original lockfile content before pull
  let originalLockfileContent = '';
  if (packageManager) {
    const lockfile = getLockfile(packageManager);
    const lockfilePath = `${gitRoot}/${lockfile}`;
    originalLockfileContent = await readFileIfExists(lockfilePath);
  }

  const currentBranch = (await $`git rev-parse --abbrev-ref HEAD`).stdout.trim()
  
  const status = (await $`git status --porcelain`).stdout
  if (status) {
    if (currentBranch === mainBranch) {
      console.log(`\n⚠️ you are on ${mainBranch} branch but have uncommitted changes:\n`)
      await $`git ls-files -mo --exclude-standard`.pipe(process.stdout)
      console.log("")
      if (await confirmAction('💥 RESET ALL CHANGES?')) {
        await $`git add --all`
        await $`git reset --hard HEAD`
        console.log('🧹 Clean')
      } else {
        process.exit(1)
      }
    } else {
      console.log('❌ branch not clean')
      process.exit(1)
    }
  }

  // Switch to main branch if needed
  if (currentBranch !== mainBranch) {
    await $`git checkout ${mainBranch}`
  } else {
    console.log('pull')
  }

  // Pull changes
  let needsCleanup = true
  const pullResult = await $`git pull`
  if (pullResult.stdout.includes('Already up to date.')) {
    needsCleanup = false
  }

  // Compare lockfile contents after pull
  let hasLockfileChanges = false;
  if (packageManager) {
    const lockfile = getLockfile(packageManager);
    const lockfilePath = `${gitRoot}/${lockfile}`;
    const newLockfileContent = await readFileIfExists(lockfilePath);
    hasLockfileChanges = originalLockfileContent !== newLockfileContent;
  }

  if (needsCleanup) {
    console.log('🧹 cleaning up empty branches')
    
    const branches = (await $`git for-each-ref refs/heads/ --format='%(refname:short)'`)
      .stdout.trim()
      .split('\n')
      .filter(branch => branch !== mainBranch)

    for (const branch of branches) {
      if (await isBranchMerged(branch, mainBranch)) {
        console.log(`Deleting branch ${branch} (no unique changes)`)
        // Use refs/heads/ prefix to ensure we're dealing with the correct reference
        await $`git branch -D ${branch}`
      }
    }
  } else {
    console.log('skip cleanup')
  }

  if (hasLockfileChanges && packageManager) {
    await spinner(`Installing dependencies with ${packageManager}...`, () =>
      installDependencies(packageManager, gitRoot)
    )
  } else if (packageManager) {
    console.log(`${getLockfile(packageManager)} was unchanged`)
  }

  console.log('✨ done')
}

main().then(
  () => process.exit(0),
  error => {
    console.error('Error:', error.message)
    process.exit(1)
  }
)
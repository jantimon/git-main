import { execSync } from 'child_process';
import { mkdtemp, rm, copyFile, readdir, lstat, mkdir } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { tmpdir } from 'os';
// Removed: import { afterEach } from 'node:test';

const __filename = new URL(import.meta.url).pathname;
const utilsScriptDirname = dirname(__filename);

const projectRoot = join(utilsScriptDirname, '..', '..');
const gitMainScript = join(projectRoot, 'dist', 'git-main.js');

/**
 * Sets up a temporary E2E testing environment with a local Git repository
 * and a simulated remote repository, then executes a provided callback
 * function with an API to interact with this environment.
 *
 * This function creates a base temporary directory containing:
 *  1. A 'local/' subdirectory: This is a standard Git repository where test
 *     operations are typically run. It's initialized with fixtures from
 *     a 'fixtures/initial' subdirectory (relative to 'testFileDirname')
 *     committed to the 'main' branch.
 *  2. A 'remote/' subdirectory: This contains 'upstream.git', a bare Git
 *     repository that acts as the remote 'origin' for the 'local/' repository.
 *
 * The 'local/' repository's 'main' branch is pushed to 'origin/main' upon setup.
 *
 * The provided 'testCallback' function is then invoked with a 'TestEnvironment'
 * object. This object contains paths (to the local repository, project assets,
 * base temp dir) and methods ('exec', 'applyChange') to execute commands
 * and apply further Git changes within the 'local/' repository.
 *
 * Cleanup of the entire base temporary directory (including local and remote)
 * is automatically handled within a 'finally' block after the 'testCallback'
 * completes or if an error occurs during setup or callback execution.
 */
export async function setupTemporaryTestEnvironment(testFileDirname, testCallback) {
    let baseTempDir; // Needs to be accessible in finally

    try {
        // --- Start of existing setup logic ---
        baseTempDir = await mkdtemp(join(tmpdir(), `git-main-e2e-${basename(testFileDirname)}-base-`));
        console.log(`Base temporary directory created: ${baseTempDir}`);

        const localDir = join(baseTempDir, 'local');
        const remoteDir = join(baseTempDir, 'remote');
        await mkdir(localDir);
        await mkdir(remoteDir);
        console.log(`Created local (${localDir}) and remote (${remoteDir}) subdirectories.`);

        const remoteRepoPath = join(remoteDir, 'upstream.git');
        console.log(`Initializing bare remote repository at: ${remoteRepoPath}`);
        execSync(`git init --bare "${remoteRepoPath}"`, { cwd: baseTempDir, stdio: 'pipe', encoding: 'utf-8' });
        console.log('Bare remote repository initialized.');

        const tempDir = localDir; // tempDir for the TestAPI refers to localDir

        const execInTempDir = (command) => {
            console.log(`Executing in local repo [${tempDir}]: ${command}`);
            try {
                const output = execSync(command, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' });
                console.log(`Output of [${command}]:\n${output}`);
                return output;
            } catch (e) {
                console.error(`Error executing command [${command}]:`, e.message);
                if (e.stdout) console.error('Stdout:', e.stdout.toString());
                if (e.stderr) console.error('Stderr:', e.stderr.toString());
                throw e;
            }
        };
        
        // Initial git setup in localDir
        execInTempDir('git init');
        console.log('Local repository initialized.');
        execInTempDir('git config user.name "Test User"');
        execInTempDir('git config user.email "test@example.com"');
        console.log('Git user configured in local repository.');
        execInTempDir('git checkout -b main');
        console.log("Switched to 'main' branch in local repository.");

        const initialFixturesPath = join(testFileDirname, 'fixtures', 'initial');
        const fixtureFiles = await readdir(initialFixturesPath); // This is for initial setup
        for (const file of fixtureFiles) {
            const srcPath = join(initialFixturesPath, file);
            const destPath = join(tempDir, file); // tempDir is localDir
            const stat = await lstat(srcPath);
            if (stat.isFile()) {
                await copyFile(srcPath, destPath);
            }
        }
        console.log('Initial fixture files copied to local repository.');

        execInTempDir('git add .');
        execInTempDir('git commit -m "Initial commit with fixtures"');
        console.log('Initial commit made in local repository.');

        const relativeRemotePath = join('..', 'remote', 'upstream.git');
        execInTempDir(`git remote add origin "${relativeRemotePath}"`);
        console.log("Remote 'origin' added to local repository.");
        execInTempDir('git push -u origin main');
        console.log("'main' branch pushed to 'origin'.");

        const applyGitChangeLogic = async (fixtureDirPath, commitMessage) => {
            console.log(`Applying git change from ${fixtureDirPath} to ${tempDir} with message "${commitMessage}"`);
            try {
                const changeFixtureFiles = await readdir(fixtureDirPath); // Renamed to avoid conflict
                for (const file of changeFixtureFiles) {
                    const srcPath = join(fixtureDirPath, file);
                    const destPath = join(tempDir, file); // tempDir is localDir
                    const stat = await lstat(srcPath);
                    if (stat.isFile()) {
                        await copyFile(srcPath, destPath);
                    }
                }
                console.log('Files for git change copied.');
                execInTempDir('git add .');
                console.log('Git add . executed for change.');
                execInTempDir(`git commit -m "${commitMessage}"`);
                console.log(`Git commit executed for change with message: "${commitMessage}".`);
            } catch (error) {
                console.error(`Error in applyGitChangeLogic (fixture: ${fixtureDirPath}, message: "${commitMessage}"):`, error.message);
                throw error;
            }
        };
        // --- End of setup logic ---

        // Define the TestAPI object to be passed to the callback
        const testAPI = {
            tempDir,      // This is localDir
            baseTempDir,
            gitMainScript, // Module-level constant
            projectRoot,   // Module-level constant
            exec: execInTempDir,
            applyChange: applyGitChangeLogic
        };

        // Execute the callback with the TestAPI
        await testCallback(testAPI);

    } finally {
        if (baseTempDir) {
            console.log(`Cleaning up base temporary directory: ${baseTempDir}`);
            try {
                await rm(baseTempDir, { recursive: true, force: true });
                console.log(`Base temporary directory ${baseTempDir} deleted.`);
            } catch (cleanupError) {
                // Log error but don't rethrow from finally, to let original error (if any) propagate
                console.error(`Failed to delete base temporary directory ${baseTempDir}:`, cleanupError.message);
            }
        }
    }
}

// The old 'export async function applyGitChange(...)' is removed.

import { execSync } from 'child_process';
import { mkdtemp, rm, copyFile, readdir, lstat, mkdir } from 'fs/promises'; // Added mkdir
import { join, dirname, basename } from 'path';
import { tmpdir } from 'os';
import { afterEach } from 'node:test';

const __filename = new URL(import.meta.url).pathname;
const utilsScriptDirname = dirname(__filename);

const projectRoot = join(utilsScriptDirname, '..', '..');
const gitMainScript = join(projectRoot, 'dist', 'git-main.js');

/**
 * Sets up a temporary E2E testing environment with a local Git repository
 * and a simulated remote repository.
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
 * It returns a 'TestEnvironment' object containing paths (to the local repository,
 * project assets, base temp dir) and methods to execute commands within the
 * 'local/' repository and apply further Git changes.
 *
 * Automatic cleanup of the entire base temporary directory (including local
 * and remote) is registered via 'afterEach' from 'node:test'.
 */
export async function setupTemporaryTestEnvironment(testFileDirname) {
    let baseTempDir; // For cleanup closure, this is the main temp dir from mkdtemp
    const initialFixturesPath = join(testFileDirname, 'fixtures', 'initial');

    afterEach(async () => {
        if (baseTempDir) { // Now cleans up baseTempDir
            try {
                await rm(baseTempDir, { recursive: true, force: true });
                console.log(`Automatic cleanup: Base temporary directory ${baseTempDir} deleted.`);
            } catch (cleanupError) {
                console.error(`Automatic cleanup: Failed to delete base temporary directory ${baseTempDir}:`, cleanupError);
            }
        }
    });

    try {
        baseTempDir = await mkdtemp(join(tmpdir(), `git-main-e2e-${basename(testFileDirname)}-base-`));
        console.log(`Base temporary directory created: ${baseTempDir}`);

        const localDir = join(baseTempDir, 'local');
        const remoteDir = join(baseTempDir, 'remote');
        await mkdir(localDir);
        await mkdir(remoteDir);
        console.log(`Created local (${localDir}) and remote (${remoteDir}) subdirectories.`);

        const remoteRepoPath = join(remoteDir, 'upstream.git');
        console.log(`Initializing bare remote repository at: ${remoteRepoPath}`);
        // Use raw execSync for this one-off command outside localDir context
        // Quote the path to handle potential spaces, though unlikely with tmpdir()
        execSync(`git init --bare "${remoteRepoPath}"`, { cwd: baseTempDir, stdio: 'pipe', encoding: 'utf-8' });
        console.log('Bare remote repository initialized.');

        // tempDir for TestEnvironment object now refers to localDir.
        // This is the directory where test operations will typically occur.
        const tempDir = localDir; 

        const execInTempDir = (command) => { // Now uses localDir (via tempDir closure)
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

        const applyGitChangeLogic = async (fixtureDirPath, commitMessage) => {
            console.log(`Applying git change from ${fixtureDirPath} to ${tempDir} with message "${commitMessage}"`); // tempDir is localDir
            try {
                const fixtureFiles = await readdir(fixtureDirPath);
                for (const file of fixtureFiles) {
                    const srcPath = join(fixtureDirPath, file);
                    const destPath = join(tempDir, file); // Files copied into localDir
                    const stat = await lstat(srcPath);
                    if (stat.isFile()) {
                        await copyFile(srcPath, destPath);
                    }
                }
                console.log('Files for git change copied.');
                execInTempDir('git add .'); 
                console.log('Git add . executed.');
                execInTempDir(`git commit -m "${commitMessage}"`); 
                console.log(`Git commit executed with message: "${commitMessage}".`);
            } catch (error) {
                console.error(`Error in applyGitChangeLogic (fixture: ${fixtureDirPath}, message: "${commitMessage}"):`, error.message);
                throw error;
            }
        };

        // Git operations are now in localDir context via execInTempDir
        execInTempDir('git init'); // Initialize localDir as a git repo
        execInTempDir('git config user.name "Test User"');
        execInTempDir('git config user.email "test@example.com"');
        execInTempDir('git checkout -b main');
        console.log(`Git initialized in local directory (${localDir}) and switched to 'main' branch.`);

        const fixtureFiles = await readdir(initialFixturesPath);
        for (const file of fixtureFiles) {
            const srcPath = join(initialFixturesPath, file);
            const destPath = join(tempDir, file); // Copy to localDir
            const stat = await lstat(srcPath);
            if (stat.isFile()) {
                 await copyFile(srcPath, destPath);
            }
        }
        console.log(`Initial fixture files copied into ${localDir}.`);

        execInTempDir('git add .');
        execInTempDir('git commit -m "Initial commit with fixtures"');
        console.log(`Initial commit made in local repository (${localDir}).`);

        console.log(`Adding remote 'origin' to local repository, pointing to ${remoteRepoPath}`);
        const relativeRemotePath = join('..', 'remote', 'upstream.git'); // Path from localDir to remoteDir/upstream.git
        execInTempDir(`git remote add origin "${relativeRemotePath}"`);
        console.log("Remote 'origin' added.");

        console.log("Pushing initial 'main' branch to 'origin'.");
        execInTempDir('git push -u origin main');
        console.log("'main' branch pushed to 'origin'.");
        
        return {
            tempDir, // This is localDir
            baseTempDir, 
            gitMainScript,
            projectRoot,
            exec: execInTempDir,
            applyChange: applyGitChangeLogic
        };

    } catch (error) {
        console.error(`Error in setupTemporaryTestEnvironment for ${testFileDirname}:`, error.message);
        // afterEach will handle cleanup of baseTempDir if it was created.
        throw error;
    }
}

// The old 'export async function applyGitChange(...)' is removed.

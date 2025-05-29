import { execSync } from 'child_process';
import { mkdtemp, rm, copyFile, readdir, lstat } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { tmpdir } from 'os';
import { afterEach } from 'node:test';

const __filename = new URL(import.meta.url).pathname;
const utilsScriptDirname = dirname(__filename);

const projectRoot = join(utilsScriptDirname, '..', '..');
const gitMainScript = join(projectRoot, 'dist', 'git-main.js');

/**
 * Sets up a temporary Git repository environment for E2E testing.
 *
 * This function creates a temporary directory, initializes a Git repository,
 * copies initial fixtures from a 'fixtures/initial' subdirectory (relative
 * to the provided 'testFileDirname'), and makes an initial commit on the 'main' branch.
 *
 * It returns a 'TestEnvironment' object containing the temp directory path,
 * paths to project assets, and methods to execute commands and apply further
 * Git changes within this environment.
 *
 * Automatic cleanup of the temporary directory is registered via 'afterEach'
 * from 'node:test'.
 */
export async function setupTemporaryTestEnvironment(testFileDirname) {
    let tempDir;
    const initialFixturesPath = join(testFileDirname, 'fixtures', 'initial');

    afterEach(async () => {
        if (tempDir) {
            try {
                await rm(tempDir, { recursive: true, force: true });
                console.log(`Automatic cleanup: Temporary directory ${tempDir} deleted.`);
            } catch (cleanupError) {
                console.error(`Automatic cleanup: Failed to delete temporary directory ${tempDir}:`, cleanupError);
            }
        }
    });

    try {
        tempDir = await mkdtemp(join(tmpdir(), `git-main-e2e-${basename(testFileDirname)}-initial-`));
        console.log(`Temporary directory created: ${tempDir} for test in ${testFileDirname}`);

        const execInTempDir = (command) => {
            console.log(`Executing in tempDir [${tempDir}]: ${command}`);
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

        // Define the new applyGitChangeLogic function inside setupTemporaryTestEnvironment
        const applyGitChangeLogic = async (fixtureDirPath, commitMessage) => {
            console.log(`Applying git change from ${fixtureDirPath} to ${tempDir} with message "${commitMessage}"`);
            try {
                const fixtureFiles = await readdir(fixtureDirPath);
                for (const file of fixtureFiles) {
                    const srcPath = join(fixtureDirPath, file);
                    const destPath = join(tempDir, file);
                    const stat = await lstat(srcPath);
                    if (stat.isFile()) {
                        await copyFile(srcPath, destPath);
                    }
                }
                console.log('Files for git change copied.');
                execInTempDir('git add .'); // Uses the execInTempDir from outer scope
                console.log('Git add . executed.');
                execInTempDir(`git commit -m "${commitMessage}"`); // Uses execInTempDir
                console.log(`Git commit executed with message: "${commitMessage}".`);
            } catch (error) {
                console.error(`Error in applyGitChangeLogic (fixture: ${fixtureDirPath}, message: "${commitMessage}"):`, error.message);
                // execInTempDir already logs stdout/stderr, so no need to repeat here unless more context is needed
                throw error;
            }
        };

        execInTempDir('git init');
        execInTempDir('git config user.name "Test User"');
        execInTempDir('git config user.email "test@example.com"');
        execInTempDir('git checkout -b main');
        console.log("Git initialized and switched to 'main' branch.");

        const fixtureFiles = await readdir(initialFixturesPath);
        for (const file of fixtureFiles) {
            const srcPath = join(initialFixturesPath, file);
            const destPath = join(tempDir, file);
            const stat = await lstat(srcPath);
            if (stat.isFile()) {
                 await copyFile(srcPath, destPath);
            }
        }
        console.log('Initial fixture files copied.');

        execInTempDir('git add .');
        execInTempDir('git commit -m "Initial commit with fixtures"');
        console.log('Initial commit made with fixtures on main branch.');

        return {
            tempDir,
            gitMainScript,
            projectRoot,
            exec: execInTempDir, // Method alias
            applyChange: applyGitChangeLogic // Method alias
        };
    } catch (error) {
        console.error(`Error in setupTemporaryTestEnvironment for ${testFileDirname}:`, error);
        throw error;
    }
}

// The old 'export async function applyGitChange(...)' is removed.

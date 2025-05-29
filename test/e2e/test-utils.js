import { execSync } from 'child_process';
import { mkdtemp, rm, copyFile, readdir, lstat } from 'fs/promises';
import { join, dirname, basename } from 'path'; // Added basename
import { tmpdir } from 'os';
import { afterEach } from 'node:test'; // Import afterEach

const __filename = new URL(import.meta.url).pathname;
const utilsScriptDirname = dirname(__filename); // This is test/e2e/

// projectRoot is relative to test-utils.js's location
const projectRoot = join(utilsScriptDirname, '..', '..'); // Moves from test/e2e up to project root
const gitMainScript = join(projectRoot, 'dist', 'git-main.js');

export async function setupTemporaryTestEnvironment(testFileDirname) { // testFileDirname is __dirname of the calling test
    let tempDir; // This will be captured by the afterEach closure
    const initialFixturesPath = join(testFileDirname, 'fixtures', 'initial');

    // Register cleanup immediately, so it's registered even if setup fails midway
    // It will use the 'tempDir' variable from the outer scope.
    afterEach(async () => {
        if (tempDir) { // tempDir will be undefined if mkdtemp failed early
            try {
                await rm(tempDir, { recursive: true, force: true });
                // console.log(`Automatic cleanup: Temporary directory ${tempDir} deleted.`);
            } catch (cleanupError) {
                console.error(`Automatic cleanup: Failed to delete temporary directory ${tempDir}:`, cleanupError);
            }
        }
    });

    try {
        // Use basename from testFileDirname to make temp dir name more specific
        tempDir = await mkdtemp(join(tmpdir(), `git-main-e2e-${basename(testFileDirname)}-initial-`));
        // console.log(`Temporary directory created: ${tempDir} for test in ${testFileDirname}`);

        const execOpts = { cwd: tempDir, stdio: 'pipe' };

        execSync('git init', execOpts);
        execSync('git config user.name "Test User"', execOpts);
        execSync('git config user.email "test@example.com"', execOpts);
        execSync('git checkout -b main', execOpts); // Ensure main branch for the first commit
        // console.log("Git initialized and switched to 'main' branch.");

        // Copy initial fixture files
        const fixtureFiles = await readdir(initialFixturesPath);
        for (const file of fixtureFiles) {
            const srcPath = join(initialFixturesPath, file);
            const destPath = join(tempDir, file);
            const stat = await lstat(srcPath);
            if (stat.isFile()) { // Only copy files
                 await copyFile(srcPath, destPath);
            }
        }
        // console.log('Initial fixture files copied.');

        execSync('git add .', execOpts);
        execSync('git commit -m "Initial commit with fixtures"', execOpts);
        // console.log('Initial commit made with fixtures on main branch.');

        return {
            tempDir,
            gitMainScript, // This is already correctly calculated using projectRoot
            projectRoot,   // This is the project root, also correctly calculated
            execOpts
            // No cleanup function here
        };
    } catch (error) {
        // console.error(`Error in setupTemporaryTestEnvironment for ${testFileDirname}:`, error);
        // No need to manually call cleanup here, afterEach will still run if tempDir was set.
        // If mkdtemp failed, tempDir is undefined, afterEach does nothing.
        // If a later step failed, afterEach will clean up tempDir if it was created.
        throw error; // Re-throw the error to fail the test
    }
}

export async function applyGitChange(fixtureDirPath, tempDir, commitMessage, execOpts) {
    // console.log(`Applying git change from ${fixtureDirPath} to ${tempDir} with message "${commitMessage}"`);
    try {
        const fixtureFiles = await readdir(fixtureDirPath);
        for (const file of fixtureFiles) {
            const srcPath = join(fixtureDirPath, file);
            const destPath = join(tempDir, file); // Assumes files are copied to root of tempDir
            const stat = await lstat(srcPath);
            if (stat.isFile()) { // Only copy files
                 await copyFile(srcPath, destPath);
            }
        }
        // console.log('Files for git change copied.');

        execSync('git add .', execOpts);
        // console.log('Git add . executed.');
        execSync(`git commit -m "${commitMessage}"`, execOpts);
        // console.log(`Git commit executed with message: "${commitMessage}".`);

    } catch (error) {
        // console.error(`Error in applyGitChange (fixture: ${fixtureDirPath}, message: "${commitMessage}"):`, error);
        if (error.stdout) console.error('Stdout:', error.stdout.toString());
        if (error.stderr) console.error('Stderr:', error.stderr.toString());
        throw error; // Re-throw to fail the test
    }
}

import { execSync } from 'child_process';
import { mkdtemp, rm, copyFile, readdir, lstat } from 'fs/promises';
import { join, dirname, basename } from 'path'; // basename is used.
import { tmpdir } from 'os';
import { afterEach } from 'node:test';

const __filename = new URL(import.meta.url).pathname; // This is how __filename is obtained in ESM
const utilsScriptDirname = dirname(__filename); // This is test/e2e/

const projectRoot = join(utilsScriptDirname, '..', '..');
const gitMainScript = join(projectRoot, 'dist', 'git-main.js');

export async function setupTemporaryTestEnvironment(testFileDirname) {
    let tempDir;
    const initialFixturesPath = join(testFileDirname, 'fixtures', 'initial');

    afterEach(async () => {
        if (tempDir) {
            try {
                await rm(tempDir, { recursive: true, force: true });
                console.log(`Automatic cleanup: Temporary directory ${tempDir} deleted.`); // Uncommented
            } catch (cleanupError) {
                console.error(`Automatic cleanup: Failed to delete temporary directory ${tempDir}:`, cleanupError); // Uncommented
            }
        }
    });

    try {
        tempDir = await mkdtemp(join(tmpdir(), `git-main-e2e-${basename(testFileDirname)}-initial-`));
        console.log(`Temporary directory created: ${tempDir} for test in ${testFileDirname}`); // Uncommented

        // Define execInTempDir helper
        const execInTempDir = (command) => {
            console.log(`Executing in tempDir [${tempDir}]: ${command}`); // Uncommented
            try {
                const output = execSync(command, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' });
                console.log(`Output of [${command}]:\n${output}`); // Uncommented
                return output;
            } catch (e) {
                console.error(`Error executing command [${command}]:`, e.message); // Uncommented
                if (e.stdout) console.error('Stdout:', e.stdout.toString()); // Uncommented
                if (e.stderr) console.error('Stderr:', e.stderr.toString()); // Uncommented
                throw e;
            }
        };

        execInTempDir('git init');
        execInTempDir('git config user.name "Test User"');
        execInTempDir('git config user.email "test@example.com"');
        execInTempDir('git checkout -b main');
        console.log("Git initialized and switched to 'main' branch."); // This was already a direct log

        const fixtureFiles = await readdir(initialFixturesPath);
        for (const file of fixtureFiles) {
            const srcPath = join(initialFixturesPath, file);
            const destPath = join(tempDir, file);
            const stat = await lstat(srcPath);
            if (stat.isFile()) {
                 await copyFile(srcPath, destPath);
            }
        }
        console.log('Initial fixture files copied.'); // Uncommented

        execInTempDir('git add .');
        execInTempDir('git commit -m "Initial commit with fixtures"');
        console.log('Initial commit made with fixtures on main branch.'); // Uncommented

        return {
            tempDir,
            gitMainScript,
            projectRoot,
            execInTempDir // New helper
            // execOpts removed
        };
    } catch (error) {
        console.error(`Error in setupTemporaryTestEnvironment for ${testFileDirname}:`, error); // Uncommented
        throw error;
    }
}

export async function applyGitChange(fixtureDirPath, tempDir, commitMessage, execInTempDir) { // execOpts changed to execInTempDir
    console.log(`Applying git change from ${fixtureDirPath} to ${tempDir} with message "${commitMessage}"`); // Uncommented
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
        console.log('Files for git change copied.'); // Uncommented

        // These will be updated in a subsequent step to use execInTempDir
        // For now, this function will be broken if called, as execOpts is removed
        // but the prompt says "The internal logic of applyGitChange using execInTempDir will be handled in a subsequent plan step"
        // So, I'll leave these as-is for now, knowing they'll be fixed next.
        // However, to prevent it from completely breaking if called before the next step,
        // I will temporarily use execInTempDir for these git commands as well,
        // as it's available in scope and should work.
        execInTempDir('git add .');
        console.log('Git add . executed.'); // Uncommented
        execInTempDir(`git commit -m "${commitMessage}"`);
        console.log(`Git commit executed with message: "${commitMessage}".`); // Uncommented

    } catch (error) {
        console.error(`Error in applyGitChange (fixture: ${fixtureDirPath}, message: "${commitMessage}"):`, error); // Uncommented
        if (error.stdout) console.error('Stdout:', error.stdout.toString()); // Uncommented
        if (error.stderr) console.error('Stderr:', error.stderr.toString()); // Uncommented
        throw error;
    }
}

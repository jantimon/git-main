import { execSync } from 'child_process';
import { mkdtemp, rm, copyFile, readdir, lstat } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

const __filename = new URL(import.meta.url).pathname;
const __dirname = dirname(__filename);

export async function setupTemporaryTestEnvironment(fixturesSubDir) {
    let tempDir;
    const projectRoot = join(__dirname, '..', '..', '..'); // From test/e2e/test-utils.js to project root
    const gitMainScript = join(projectRoot, 'dist', 'git-main.js');
    const fixturesBasePath = join(projectRoot, 'test', 'e2e', 'simple', 'fixtures');
    const specificFixturesPath = join(fixturesBasePath, fixturesSubDir);

    try {
        tempDir = await mkdtemp(join(tmpdir(), `git-main-e2e-${fixturesSubDir}-`));
        // console.log(`Temporary directory created: ${tempDir} for fixtures ${fixturesSubDir}`);

        const execOpts = { cwd: tempDir, stdio: 'pipe' };

        execSync('git init', execOpts);
        // console.log('Git repository initialized.');
        execSync('git config user.name "Test User"', execOpts);
        execSync('git config user.email "test@example.com"', execOpts);
        // console.log('Git user configured.');

        // Directly create and checkout the 'main' branch.
        // This makes 'main' the active branch for the first commit.
        execSync('git checkout -b main', execOpts); // Create and switch to main branch
        // console.log("Switched to 'main' branch (created if it didn't exist).");

        // Copy fixture files
        const fixtureFiles = await readdir(specificFixturesPath);
        for (const file of fixtureFiles) {
            const srcPath = join(specificFixturesPath, file);
            const destPath = join(tempDir, file);
            const stat = await lstat(srcPath);
            if (stat.isFile()) { // Only copy files, not subdirectories from fixture folder
                 await copyFile(srcPath, destPath);
            }
        }
        // console.log('Fixture files copied.');

        execSync('git add .', execOpts);
        execSync('git commit -m "Initial commit with fixtures"', execOpts); // This first commit will be on 'main'
        // console.log('Initial commit made with fixtures on main branch.');

        return {
            tempDir,
            gitMainScript,
            projectRoot,
            execOpts,
            cleanup: async () => {
                if (tempDir) {
                    try {
                        await rm(tempDir, { recursive: true, force: true });
                        // console.log(`Temporary directory ${tempDir} deleted.`);
                    } catch (cleanupError) {
                        console.error(`Failed to delete temporary directory ${tempDir}:`, cleanupError);
                    }
                }
            }
        };
    } catch (error) {
        // console.error('Error in setupTemporaryTestEnvironment:', error);
        // If setup fails, try to cleanup whatever was created
        if (tempDir) {
            try {
                await rm(tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
                // console.error(`Failed to delete partial temporary directory ${tempDir}:`, cleanupError);
            }
        }
        throw error; // Re-throw the error to fail the test
    }
}

import { execSync } from 'child_process';
import { readFile } from 'fs/promises'; // copyFile is no longer needed here
import { dirname, join } from 'path';   // For __dirname and joining paths
import { fileURLToPath } from 'url';  // For __dirname
import assert from 'assert';
import { test } from 'node:test';   // afterEach is no longer needed here
import { setupTemporaryTestEnvironment, applyGitChange } from '../test-utils.js'; // Import applyGitChange

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// No more afterEach or cleanupFixture variable needed here

test('reset-to-main: git-main switches to main and resets content from diverged feature branch', async () => {
    // setupTemporaryTestEnvironment now takes __dirname and handles initial fixtures by convention
    const { tempDir, gitMainScript, execOpts } = await setupTemporaryTestEnvironment(__dirname);
    // 'cleanup' is no longer returned. 'projectRoot' is also not needed here anymore.

    const divergedFixturePath = join(__dirname, 'fixtures', 'diverged-change');
    const initialFixturePath = join(__dirname, 'fixtures', 'initial'); // For final assertion

    // console.log('Setting up feature branch with diverged content...');
    execSync('git checkout -b feature-branch', execOpts);
    // console.log('Checked out feature-branch.');

    // Use the new applyGitChange utility
    await applyGitChange(divergedFixturePath, tempDir, "Commit on feature-branch with diverged README", execOpts);
    // console.log('Applied git change for diverged README.');
    
    // Ensure we are on feature-branch before running git-main (if applyGitChange doesn't guarantee it, though it should not change branch)
    execSync('git checkout feature-branch', execOpts);
    // console.log('Switched back to feature-branch to run git-main.');

    // Execute git-main (while on feature-branch)
    // console.log(`Executing: node ${gitMainScript} in ${tempDir} while on feature-branch`);
    execSync(`node ${gitMainScript}`, execOpts);
    // console.log('git-main executed.');

    // Assertions
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', execOpts).toString().trim();
    assert.strictEqual(currentBranch, 'main', 'Current branch should be main after git-main');
    // console.log(`Assertion passed: Current branch is ${currentBranch}.`);

    const readmeContent = await readFile(join(tempDir, 'README.md'), 'utf-8');
    // Read initial README content from the conventional path for assertion
    const initialReadmeContent = await readFile(join(initialFixturePath, 'README.md'), 'utf-8');
    assert.strictEqual(readmeContent, initialReadmeContent, 'README.md content should match initial fixture after git-main');
    // console.log('Assertion passed: README.md content matches initial fixture.');
    // console.log('Reset to main test completed successfully.');
});

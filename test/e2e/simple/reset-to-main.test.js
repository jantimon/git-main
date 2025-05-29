import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import { test } from 'node:test';
import { setupTemporaryTestEnvironment, applyGitChange } from '../test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('reset-to-main: git-main switches to main and resets content from diverged feature branch', async () => {
    console.log('Starting test: reset-to-main: git-main switches to main and resets content from diverged feature branch');
    const { tempDir, gitMainScript, execInTempDir } = await setupTemporaryTestEnvironment(__dirname);
    // execOpts removed

    const divergedFixturePath = join(__dirname, 'fixtures', 'diverged-change');
    const initialFixturePath = join(__dirname, 'fixtures', 'initial');

    console.log('Setting up feature branch with diverged content...');
    execInTempDir('git checkout -b feature-branch'); // Use helper
    console.log('Checked out feature-branch.');

    // Pass execInTempDir to applyGitChange
    await applyGitChange(divergedFixturePath, tempDir, "Commit on feature-branch with diverged README", execInTempDir);
    console.log('Applied git change for diverged README.');
    
    console.log('Ensuring we are on feature-branch to run git-main.');
    execInTempDir('git checkout feature-branch'); // Use helper
    
    console.log(`Executing: node ${gitMainScript} in ${tempDir} while on feature-branch`);
    execInTempDir(`node ${gitMainScript}`); // Use helper
    console.log('git-main executed.');

    const currentBranch = execInTempDir('git rev-parse --abbrev-ref HEAD').trim(); // Use helper and trim
    assert.strictEqual(currentBranch, 'main', 'Current branch should be main after git-main');
    console.log(`Assertion passed: Current branch is ${currentBranch}.`);

    const readmeContent = await readFile(join(tempDir, 'README.md'), 'utf-8');
    const initialReadmeContent = await readFile(join(initialFixturePath, 'README.md'), 'utf-8');
    assert.strictEqual(readmeContent, initialReadmeContent, 'README.md content should match initial fixture after git-main');
    console.log('Assertion passed: README.md content matches initial fixture.');
    console.log('Reset to main test completed successfully.');
});

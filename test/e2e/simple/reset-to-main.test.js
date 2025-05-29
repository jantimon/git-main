import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import { test } from 'node:test';
// setupTemporaryTestEnvironment is imported, applyGitChange is NOT directly imported anymore
import { setupTemporaryTestEnvironment } from '../test-utils.js'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('reset-to-main: git-main switches to main and resets content from diverged feature branch', async () => {
    console.log('Starting test: reset-to-main: git-main switches to main and resets content from diverged feature branch');
    
    // setupTemporaryTestEnvironment returns a TestEnvironment object
    const testEnv = await setupTemporaryTestEnvironment(__dirname);

    const divergedFixturePath = join(__dirname, 'fixtures', 'diverged-change');
    const initialFixturePath = join(__dirname, 'fixtures', 'initial'); // For final assertion

    console.log('Setting up feature branch with diverged content...');
    testEnv.exec('git checkout -b feature-branch'); // Use testEnv.exec()
    console.log('Checked out feature-branch.');

    // Use the new testEnv.applyChange() method
    await testEnv.applyChange(divergedFixturePath, "Commit on feature-branch with diverged README");
    console.log('Applied git change for diverged README via testEnv.applyChange().'); // Updated log
    
    console.log('Ensuring we are on feature-branch to run git-main.');
    testEnv.exec('git checkout feature-branch'); // Use testEnv.exec()
    
    console.log(`Executing: node ${testEnv.gitMainScript} in ${testEnv.tempDir} while on feature-branch`);
    testEnv.exec(`node ${testEnv.gitMainScript}`); // Use testEnv.exec()
    console.log('git-main executed.');

    const currentBranch = testEnv.exec('git rev-parse --abbrev-ref HEAD').trim(); // Use testEnv.exec()
    assert.strictEqual(currentBranch, 'main', 'Current branch should be main after git-main');
    console.log(`Assertion passed: Current branch is ${currentBranch}.`);

    const readmeContent = await readFile(join(testEnv.tempDir, 'README.md'), 'utf-8'); // Use testEnv.tempDir
    const initialReadmeContent = await readFile(join(initialFixturePath, 'README.md'), 'utf-8');
    assert.strictEqual(readmeContent, initialReadmeContent, 'README.md content should match initial fixture after git-main');
    console.log('Assertion passed: README.md content matches initial fixture.');
    console.log('Reset to main test completed successfully.');
});

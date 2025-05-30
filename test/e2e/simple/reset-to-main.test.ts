import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import { test } from 'node:test';
import { setupTemporaryTestEnvironment } from '../test-utils.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('reset-to-main: git-main switches to main and resets content from diverged feature branch', async () => {
    // console.log('Outer test: reset-to-main: git-main switches to main and resets content from diverged feature branch');
    await setupTemporaryTestEnvironment(__dirname, async (testAPI) => {
        // All test logic is now inside this callback
        // console.log('Starting test logic for: reset-to-main: git-main switches to main and resets content from diverged feature branch');
        
        const divergedFixturePath: string = join(__dirname, 'fixtures', 'diverged-change');
        const initialFixturePath: string = join(__dirname, 'fixtures', 'initial');

        // console.log('Setting up feature branch with diverged content...');
        testAPI.exec('git checkout -b feature-branch');
        // console.log('Checked out feature-branch.');

        await testAPI.applyChange(divergedFixturePath, "Commit on feature-branch with diverged README");
        // console.log('Applied git change for diverged README via testAPI.applyChange().');
        
        // console.log('Ensuring we are on feature-branch to run git-main.');
        testAPI.exec('git checkout feature-branch'); // Make sure we are on the feature branch
        
        // console.log(`Executing: node ${testAPI.gitMainScript} in ${testAPI.tempDir} while on feature-branch`);
        testAPI.exec(`node ${testAPI.gitMainScript}`);
        // console.log('git-main executed.');

        const currentBranch: string = testAPI.exec('git rev-parse --abbrev-ref HEAD').trim();
        assert.strictEqual(currentBranch, 'main', 'Current branch should be main after git-main');
        // console.log(`Assertion passed: Current branch is ${currentBranch}.`);

        const readmeContent: string = await readFile(join(testAPI.tempDir, 'README.md'), 'utf-8');
        const initialReadmeContent: string = await readFile(join(initialFixturePath, 'README.md'), 'utf-8');
        assert.strictEqual(readmeContent, initialReadmeContent, 'README.md content should match initial fixture after git-main');
        // console.log('Assertion passed: README.md content matches initial fixture.');
        // console.log('Reset to main test logic completed successfully.');
    });
});

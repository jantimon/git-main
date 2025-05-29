import { dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import { test } from 'node:test';
import { setupTemporaryTestEnvironment } from '../test-utils.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('happy-path: git-main runs successfully on a clean repository', async () => {
    // console.log('Outer test: happy-path: git-main runs successfully on a clean repository'); // Log for test itself
    await setupTemporaryTestEnvironment(__dirname, async (testAPI) => {
        // All test logic is now inside this callback
        // console.log('Starting test logic for: happy-path: git-main runs successfully on a clean repository');
        
        // console.log(`Executing: node ${testAPI.gitMainScript} in ${testAPI.tempDir}`);
        testAPI.exec(`node ${testAPI.gitMainScript}`);
        // console.log('git-main executed successfully via testAPI.exec().');

        const currentBranch: string = testAPI.exec('git rev-parse --abbrev-ref HEAD').trim();
        assert.strictEqual(currentBranch, 'main', 'Current branch should be main');
        // console.log(`Assertion passed: Current branch is ${currentBranch}.`);
        // console.log('Happy path test logic completed successfully.');
    });
});

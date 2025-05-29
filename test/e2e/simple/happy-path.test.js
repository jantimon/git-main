import { dirname } from 'path'; // 'join' was already removed
import { fileURLToPath } from 'url';
import assert from 'assert';
import { test } from 'node:test';
import { setupTemporaryTestEnvironment } from '../test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('happy-path: git-main runs successfully on a clean repository', async () => {
    console.log('Starting test: happy-path: git-main runs successfully on a clean repository');
    
    // setupTemporaryTestEnvironment now returns a TestEnvironment object
    const testEnv = await setupTemporaryTestEnvironment(__dirname);

    console.log(`Executing: node ${testEnv.gitMainScript} in ${testEnv.tempDir}`);
    testEnv.exec(`node ${testEnv.gitMainScript}`); // Use testEnv.exec()
    console.log('git-main executed successfully via testEnv.exec().'); // Updated log

    const currentBranch = testEnv.exec('git rev-parse --abbrev-ref HEAD').trim(); // Use testEnv.exec()
    assert.strictEqual(currentBranch, 'main', 'Current branch should be main');
    console.log(`Assertion passed: Current branch is ${currentBranch}.`);
    console.log('Happy path test completed successfully.');
});

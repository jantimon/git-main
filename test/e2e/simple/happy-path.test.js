import { execSync } from 'child_process';
import assert from 'assert';
import { test, afterEach } from 'node:test'; // Using describe and test
import { setupTemporaryTestEnvironment } from '../test-utils.js';

let cleanupFixture; // To store cleanup function for afterEach

afterEach(async () => {
    if (cleanupFixture) {
        await cleanupFixture();
        cleanupFixture = null;
    }
});

test('happy-path: git-main runs successfully on a clean repository', async () => {
    const { tempDir, gitMainScript, execOpts, cleanup } = await setupTemporaryTestEnvironment('initial');
    cleanupFixture = cleanup; // Assign cleanup function to be called by afterEach

    // console.log(`Executing: node ${gitMainScript} in ${tempDir}`);
    execSync(`node ${gitMainScript}`, execOpts);
    // console.log('git-main executed successfully.');

    // Assertions
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', execOpts).toString().trim();
    assert.strictEqual(currentBranch, 'main', 'Current branch should be main');
    // console.log(`Assertion passed: Current branch is ${currentBranch}.`);
    // console.log('Happy path test completed successfully.');
});

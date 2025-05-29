import { execSync } from 'child_process';
import assert from 'assert';
import { test } from 'node:test'; // afterEach is no longer needed here
import { dirname, join } from 'path'; // For __dirname
import { fileURLToPath } from 'url'; // For __dirname
import { setupTemporaryTestEnvironment } from '../test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// No more afterEach or cleanupFixture variable needed here

test('happy-path: git-main runs successfully on a clean repository', async () => {
    // Pass __dirname to the setup function. It will handle 'fixtures/initial' by convention
    // and also handles automatic cleanup.
    const { tempDir, gitMainScript, execOpts } = await setupTemporaryTestEnvironment(__dirname);
    // 'cleanup' is no longer returned or needed here.

    // console.log(`Executing: node ${gitMainScript} in ${tempDir}`);
    execSync(`node ${gitMainScript}`, execOpts);
    // console.log('git-main executed successfully.');

    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', execOpts).toString().trim();
    assert.strictEqual(currentBranch, 'main', 'Current branch should be main');
    // console.log(`Assertion passed: Current branch is ${currentBranch}.`);
    // console.log('Happy path test completed successfully.');
});

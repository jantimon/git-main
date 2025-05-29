// execSync is no longer needed directly in this file
import assert from 'assert';
import { test } from 'node:test';
import { dirname } from 'path'; // join is removed as it's no longer used
import { fileURLToPath } from 'url';
import { setupTemporaryTestEnvironment } from '../test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('happy-path: git-main runs successfully on a clean repository', async () => {
    console.log('Starting test: happy-path: git-main runs successfully on a clean repository'); // Added
    // Pass __dirname to the setup function.
    // Destructure execInTempDir; execOpts is no longer returned or needed.
    const { tempDir, gitMainScript, execInTempDir } = await setupTemporaryTestEnvironment(__dirname);

    console.log(`Executing: node ${gitMainScript} in ${tempDir}`); // Uncommented
    execInTempDir(`node ${gitMainScript}`); // Use new helper
    console.log('git-main executed successfully via helper.'); // Updated log, and uncommented

    // Use helper and trim
    const currentBranch = execInTempDir('git rev-parse --abbrev-ref HEAD').trim(); 
    assert.strictEqual(currentBranch, 'main', 'Current branch should be main');
    console.log(`Assertion passed: Current branch is ${currentBranch}.`); // Uncommented
    console.log('Happy path test completed successfully.'); // Uncommented
});

import { dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import { test } from 'node:test';
import { setupTemporaryTestEnvironment } from '../test-utils.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('happy-path: git-main runs successfully on a clean repository', async () => {
    await setupTemporaryTestEnvironment(__dirname, async (testAPI) => {
        // All test logic is now inside this callback
        
        testAPI.exec(`node ${testAPI.gitMainScript}`);

        const currentBranch: string = testAPI.exec('git rev-parse --abbrev-ref HEAD').trim();
        assert.strictEqual(currentBranch, 'main', 'Current branch should be main');
    });
});

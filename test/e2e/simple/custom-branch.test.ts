import { dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import { test } from 'node:test';
import { setupTemporaryTestEnvironment } from '../test-utils.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('custom-branch: git-main uses custom branch when specified as argument', async () => {
    await setupTemporaryTestEnvironment(__dirname, async (testAPI) => {
        // Create a custom branch and push it to establish tracking
        testAPI.exec('git checkout -b develop');
        testAPI.exec('echo "develop content" > develop.txt');
        testAPI.exec('git add develop.txt');
        testAPI.exec('git commit -m "Add develop content"');
        
        // Switch back to main
        testAPI.exec('git checkout main');
        
        // Run git-main with custom branch argument
        testAPI.exec(`node ${testAPI.gitMainScript} develop`);
        
        // Verify we're on the develop branch
        const currentBranch = testAPI.exec('git rev-parse --abbrev-ref HEAD').trim();
        assert.strictEqual(currentBranch, 'develop', 'Should be on develop branch');
        
        // Verify develop content exists
        const developContent = testAPI.exec('cat develop.txt').trim();
        assert.strictEqual(developContent, 'develop content', 'Should have develop branch content');
    });
});

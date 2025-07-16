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

test('custom-branch: git-main checks out remote branch when it exists on remote but not locally', async () => {
    await setupTemporaryTestEnvironment(__dirname, async (testAPI) => {
        // Create a branch locally, add content, and push to remote
        testAPI.exec('git checkout -b feature/remote-only');
        testAPI.exec('echo "remote content" > remote.txt');
        testAPI.exec('git add remote.txt');
        testAPI.exec('git commit -m "Add remote content"');
        testAPI.exec('git push -u origin feature/remote-only');
        
        // Switch back to main and delete the local branch
        testAPI.exec('git checkout main');
        testAPI.exec('git branch -D feature/remote-only');
        
        // Fetch the remote branch info
        testAPI.exec('git fetch');
        
        // Verify the branch doesn't exist locally
        const localBranches = testAPI.exec('git branch --list feature/remote-only').trim();
        assert.strictEqual(localBranches, '', 'Branch should not exist locally');
        
        // Verify the branch exists on remote
        const remoteBranches = testAPI.exec('git branch -r --list origin/feature/remote-only').trim();
        assert(remoteBranches.includes('origin/feature/remote-only'), 'Branch should exist on remote');
        
        // Run git-main with the remote branch name
        const output = testAPI.exec(`node ${testAPI.gitMainScript} feature/remote-only`);
        
        // Verify it mentions checking out remote branch
        assert(output.includes('Checking out remote branch feature/remote-only'), 'Should mention checking out remote branch');
        
        // Verify we're on the remote branch
        const currentBranch = testAPI.exec('git rev-parse --abbrev-ref HEAD').trim();
        assert.strictEqual(currentBranch, 'feature/remote-only', 'Should be on feature/remote-only branch');
        
        // Verify the branch is tracking the remote
        const trackingInfo = testAPI.exec('git branch -vv').trim();
        assert(trackingInfo.includes('[origin/feature/remote-only]'), 'Branch should be tracking remote');
        
        // Verify remote content exists
        const remoteContent = testAPI.exec('cat remote.txt').trim();
        assert.strictEqual(remoteContent, 'remote content', 'Should have remote branch content');
    });
});

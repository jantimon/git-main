import { dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import { test } from 'node:test';
import { setupTemporaryTestEnvironment } from '../test-utils.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('stale-branch-cleanup: git-main detects and cleans up branches with deleted remotes', async () => {
    await setupTemporaryTestEnvironment(__dirname, async (testAPI) => {
        // Create a new branch
        testAPI.exec('git checkout -b feature/test-branch');
        
        // Add a new file and commit it
        testAPI.exec('echo "test content" > test-file.txt');
        testAPI.exec('git add test-file.txt');
        testAPI.exec('git commit -m "Add test file"');
        
        // Push the branch to remote to establish tracking
        testAPI.exec('git push -u origin feature/test-branch');
        
        // Switch back to main
        testAPI.exec('git checkout main');
        
        // Verify the branch exists and has remote tracking
        const branchList = testAPI.exec('git branch -vv');
        assert(branchList.includes('feature/test-branch'), 'Branch should exist with remote tracking');
        assert(branchList.includes('[origin/feature/test-branch]'), 'Branch should have remote tracking info');
        
        // Simulate remote branch deletion (like after a PR merge)
        const remoteRepoPath = `${testAPI.baseTempDir}/remote/upstream.git`;
        testAPI.exec(`git -C "${remoteRepoPath}" branch -D feature/test-branch`);
        
        // Update local tracking info to reflect remote deletion
        testAPI.exec('git remote prune origin');
        
        // Verify branch now shows as "gone"
        const branchListAfterPrune = testAPI.exec('git branch -vv');
        assert(branchListAfterPrune.includes('gone]'), 'Branch should show as gone after remote prune');
        
        // Run git-main script interactively
        const run = testAPI.execInteractive(`node ${testAPI.gitMainScript}`);
        
        // Wait for the stale branch detection and respond (with longer timeout)
        await run.waitForText('Found 1 branch to clean up', 5000);
        await run.waitForText('[y/n]:');
        run.respond('y');
        await run.waitForEnd();
        
        // Verify the stale branch was cleaned up
        const finalBranchList = testAPI.exec('git branch --list feature/test-branch');
        assert.strictEqual(finalBranchList.trim(), '', 'Stale branch should be deleted');
        
        // Verify we're still on main branch
        const currentBranch = testAPI.exec('git rev-parse --abbrev-ref HEAD').trim();
        assert.strictEqual(currentBranch, 'main', 'Should remain on main branch');
    });
});
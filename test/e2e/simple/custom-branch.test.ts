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
        testAPI.exec(`node ${testAPI.gitMainScript} feature/remote-only`);
        
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

test('custom-branch: git-main creates new branch when it does not exist and user confirms', async () => {
    await setupTemporaryTestEnvironment(__dirname, async (testAPI) => {
        // Verify the branch doesn't exist locally
        const localBranches = testAPI.exec('git branch --list feature/new-branch').trim();
        assert.strictEqual(localBranches, '', 'Branch should not exist locally');
        
        // Verify the branch doesn't exist on remote
        try {
            testAPI.exec('git ls-remote --exit-code origin feature/new-branch');
            assert.fail('Branch should not exist on remote');
        } catch (error) {
            // Expected - branch should not exist on remote
        }
        
        // Use interactive test to confirm branch creation
        const run = testAPI.execInteractive(`node ${testAPI.gitMainScript} feature/new-branch`);
        await run.waitForText("Branch 'feature/new-branch' does not exist locally or on remote. Create it?", 5000);
        run.respond('y');
        await run.waitForEnd(10000);
        
        // Verify we're on the new branch
        const currentBranch = testAPI.exec('git rev-parse --abbrev-ref HEAD').trim();
        assert.strictEqual(currentBranch, 'feature/new-branch', 'Should be on feature/new-branch branch');
        
        // Verify the branch was created from the latest main
        const mainCommit = testAPI.exec('git rev-parse main').trim();
        const newBranchCommit = testAPI.exec('git rev-parse feature/new-branch').trim();
        assert.strictEqual(mainCommit, newBranchCommit, 'New branch should be created from latest main');
    });
});

test('custom-branch: git-main creates new branch with dirty working directory', async () => {
    await setupTemporaryTestEnvironment(__dirname, async (testAPI) => {
        // Create some uncommitted changes
        testAPI.exec('echo "uncommitted content" > uncommitted.txt');
        testAPI.exec('git add uncommitted.txt');
        testAPI.exec('echo "modified content" >> main.txt');
        
        // Verify we have uncommitted changes
        const status = testAPI.exec('git status --porcelain').trim();
        assert(status.length > 0, 'Should have uncommitted changes');
        
        // Use interactive test to confirm branch creation
        const run = testAPI.execInteractive(`node ${testAPI.gitMainScript} feature/dirty-branch`);
        await run.waitForText("Branch 'feature/dirty-branch' does not exist locally or on remote. Create it?", 5000);
        run.respond('y');
        await run.waitForEnd(10000);
        
        // Verify we're on the new branch
        const currentBranch = testAPI.exec('git rev-parse --abbrev-ref HEAD').trim();
        assert.strictEqual(currentBranch, 'feature/dirty-branch', 'Should be on feature/dirty-branch branch');
        
        // Verify the uncommitted changes are still there
        const newStatus = testAPI.exec('git status --porcelain').trim();
        assert(newStatus.length > 0, 'Should still have uncommitted changes');
        
        // Verify the new files exist
        const uncommittedContent = testAPI.exec('cat uncommitted.txt').trim();
        assert.strictEqual(uncommittedContent, 'uncommitted content', 'Should have uncommitted file');
    });
});

test('custom-branch: git-main exits when user declines to create new branch', async () => {
    await setupTemporaryTestEnvironment(__dirname, async (testAPI) => {
        // Verify the branch doesn't exist locally or on remote
        const localBranches = testAPI.exec('git branch --list feature/declined-branch').trim();
        assert.strictEqual(localBranches, '', 'Branch should not exist locally');
        
        try {
            testAPI.exec('git ls-remote --exit-code origin feature/declined-branch');
            assert.fail('Branch should not exist on remote');
        } catch (error) {
            // Expected - branch should not exist on remote
        }
        
        // Use interactive test to decline branch creation
        const run = testAPI.execInteractive(`node ${testAPI.gitMainScript} feature/declined-branch`);
        await run.waitForText("Branch 'feature/declined-branch' does not exist locally or on remote. Create it?", 5000);
        run.respond('n');
        
        const result = await run.waitForEnd(10000);
        
        // Verify the process exited with code 1
        assert.strictEqual(result.code, 1, 'Should exit with code 1 when user declines');
        
        // Verify we're still on the original branch
        const currentBranch = testAPI.exec('git rev-parse --abbrev-ref HEAD').trim();
        assert.strictEqual(currentBranch, 'main', 'Should still be on main branch');
        
        // Verify the branch was not created
        const finalBranches = testAPI.exec('git branch --list feature/declined-branch').trim();
        assert.strictEqual(finalBranches, '', 'Branch should not have been created');
    });
});

test('custom-branch: git-main creates new branch from non-main branch', async () => {
    await setupTemporaryTestEnvironment(__dirname, async (testAPI) => {
        // Create a feature branch and switch to it
        testAPI.exec('git checkout -b feature/parent-branch');
        testAPI.exec('echo "parent branch content" > parent.txt');
        testAPI.exec('git add parent.txt');
        testAPI.exec('git commit -m "Add parent branch content"');
        
        // Verify we're on the parent branch
        const currentBranch = testAPI.exec('git rev-parse --abbrev-ref HEAD').trim();
        assert.strictEqual(currentBranch, 'feature/parent-branch', 'Should be on parent branch');
        
        // Use interactive test to create new branch from current branch
        const run = testAPI.execInteractive(`node ${testAPI.gitMainScript} feature/child-branch`);
        await run.waitForText("Branch 'feature/child-branch' does not exist locally or on remote. Create it?", 5000);
        run.respond('y');
        await run.waitForEnd(10000);
        
        // Verify we're on the new child branch
        const newBranch = testAPI.exec('git rev-parse --abbrev-ref HEAD').trim();
        assert.strictEqual(newBranch, 'feature/child-branch', 'Should be on child branch');
        
        // Verify the child branch was created from the parent branch (not main)
        const parentCommit = testAPI.exec('git rev-parse feature/parent-branch').trim();
        const childCommit = testAPI.exec('git rev-parse feature/child-branch').trim();
        assert.strictEqual(parentCommit, childCommit, 'Child branch should be created from parent branch');
        
        // Verify parent branch content exists in child branch
        const parentContent = testAPI.exec('cat parent.txt').trim();
        assert.strictEqual(parentContent, 'parent branch content', 'Should have parent branch content');
        
        // Verify child branch has the parent branch's commit but not main's latest commit
        const mainCommit = testAPI.exec('git rev-parse main').trim();
        assert.notStrictEqual(childCommit, mainCommit, 'Child branch should not be created from main');
    });
});

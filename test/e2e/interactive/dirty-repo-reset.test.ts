import { test } from 'node:test';
import assert from 'assert';
import { dirname, join as pathJoin } from 'path'; // Renamed join to pathJoin to avoid conflict
import { fileURLToPath } from 'url';
import *_fs from 'fs'; // Import fs for existsSync and writeFileSync
import { setupTemporaryTestEnvironment } from '../test-utils.ts';
import { createInteractiveCLI } from '../interactiveSpawn.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test('interactive: dirty-repo-reset: git-main prompts to reset a dirty main branch and resets if confirmed', async () => {
    console.log('Outer test: interactive: dirty-repo-reset test');
    await setupTemporaryTestEnvironment(__dirname, async (testAPI) => {
        console.log('Starting test logic for: interactive: dirty-repo-reset');

        const dirtyFilePath = pathJoin(testAPI.tempDir, 'dirty-file.txt');

        // 1. Make the main branch dirty by creating an untracked file
        // setupTemporaryTestEnvironment ensures we have a repo, possibly with an initial empty commit.
        // The main branch should be checked out by default by setupTemporaryTestEnvironment.
        _fs.writeFileSync(dirtyFilePath, 'This is a dirty file.', 'utf-8');
        console.log('Created dirty-file.txt to make the repository dirty.');

        // 2. Verify it's dirty
        const initialStatus = testAPI.exec('git status --porcelain').trim();
        // Expect something like "?? dirty-file.txt"
        assert.ok(initialStatus.includes('?? dirty-file.txt'), `Branch should be dirty with untracked file. Got status: "${initialStatus}"`);
        console.log(`Verified repository is dirty. Status: "${initialStatus}"`);

        // 3. Initiate interactive CLI
        console.log(`Initiating interactive CLI: node ${testAPI.gitMainScript} in ${testAPI.tempDir}`);
        const cliSession = createInteractiveCLI(`node ${testAPI.gitMainScript}`, { cwd: testAPI.tempDir });

        let promptReceived = false;
        for await (const prompt of cliSession) {
            console.log(`Received prompt: "${prompt.output.trim()}"`);
            assert.ok(
                prompt.output.includes('Your main branch is dirty') && prompt.output.includes('reset it? [y/n]'),
                `Prompt should ask about resetting dirty branch. Got: "${prompt.output}"`
            );
            promptReceived = true;
            console.log('Responding with "y" to the prompt.');
            prompt.respond("y");
        }

        assert.ok(promptReceived, 'Should have received a prompt about the dirty branch.');
        console.log('Finished iterating through prompts.');

        // 4. Get result and assert exit code
        const result = await cliSession.getResult();
        console.log(`CLI finished. Code: ${result.code}, Full Output:\n${result.fullOutput}`);
        assert.strictEqual(result.code, 0, `CLI should exit successfully after reset. Full output:\n${result.fullOutput}`);
        console.log('Assertion passed: CLI exited with code 0.');

        // 5. Verify branch is clean
        const finalStatus = testAPI.exec('git status --porcelain').trim();
        assert.strictEqual(finalStatus, '', `Git status should be clean after reset. Got status: "${finalStatus}"`);
        console.log('Assertion passed: Git status is clean.');

        // Verify untracked file is gone
        const dirtyFileExists = _fs.existsSync(dirtyFilePath);
        assert.strictEqual(dirtyFileExists, false, 'Dirty file should have been removed by the reset.');
        console.log('Assertion passed: Dirty file is removed.');
        
        // 6. Assert current branch is main
        const currentBranch = testAPI.exec('git rev-parse --abbrev-ref HEAD').trim();
        assert.strictEqual(currentBranch, 'main', 'Current branch should be main.');
        console.log(`Assertion passed: Current branch is ${currentBranch}.`);

        console.log('Interactive dirty-repo-reset test logic completed successfully.');
    });
});

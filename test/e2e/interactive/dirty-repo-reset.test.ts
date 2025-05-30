import { test } from 'node:test';
import assert from 'assert';
import { dirname, join as pathJoin } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, existsSync } from 'fs';
import { setupTemporaryTestEnvironment } from '../test-utils.ts';
import { createInteractiveCLI } from '../interactiveSpawn.ts'; // Adjusted path

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Define generous timeouts for CI environments
const INTERACTIVE_TIMEOUT_MS = 10000; // For waiting for specific text
const END_TIMEOUT_MS = 15000;       // For waiting for the process to finish

test('interactive: dirty-repo-reset: git-main prompts to reset a dirty main branch and resets if confirmed', async (t) => {
    // t.diagnostic is node:test's equivalent of console.log, but better for test output
    t.diagnostic('Outer test: interactive: dirty-repo-reset test');
    await setupTemporaryTestEnvironment(__dirname, async (testAPI) => {
        t.diagnostic('Starting test logic for: interactive: dirty-repo-reset');

        const dirtyFilePath = pathJoin(testAPI.tempDir, 'dirty-file.txt');

        // 1. Make the main branch dirty
        writeFileSync(dirtyFilePath, 'This is a dirty file.', 'utf-8');
        t.diagnostic('Created dirty-file.txt to make the repository dirty.');

        // 2. Verify it's dirty
        const initialStatus = testAPI.exec('git status --porcelain').trim();
        assert.ok(initialStatus.includes('?? dirty-file.txt'), `Branch should be dirty with untracked file. Got status: "${initialStatus}"`);
        t.diagnostic(`Verified repository is dirty. Status: "${initialStatus}"`);

        // 3. Initiate interactive CLI
        t.diagnostic(`Initiating interactive CLI: node ${testAPI.gitMainScript} in ${testAPI.tempDir}`);
        const cliSession = createInteractiveCLI(`node ${testAPI.gitMainScript}`, { cwd: testAPI.tempDir });

        try {
            // Wait for the prompt asking to revert changes
            const promptOutput = await cliSession.waitForText(
                /Revert all changes\? \[y\/n]:/i, // Using regex for flexibility
                INTERACTIVE_TIMEOUT_MS
            );
            t.diagnostic(`Received prompt: "${promptOutput.trim()}"`);
            assert.ok(
                promptOutput.includes('You are on main branch with uncommitted changes:'), // Check for the context line too
                `Prompt context "You are on main branch with uncommitted changes:" not found. Got: "${promptOutput}"`
            );

            // Respond "y" to the prompt
            t.diagnostic('Responding with "y" to the prompt.');
            cliSession.respond("y");

            // Wait for a success message (adjust regex/text as needed)
            // Assuming git-main outputs a success message like "All done!" or similar after cleaning.
            const successMessage = await cliSession.waitForText(
                /✓ All done!/i, // Example success message, adjust if different
                INTERACTIVE_TIMEOUT_MS
            );
            t.diagnostic(`Received success message: "${successMessage.trim()}"`);
            
            // 4. Get result and assert exit code
            t.diagnostic('Waiting for CLI session to end.');
            const result = await cliSession.waitForEnd(END_TIMEOUT_MS);
            t.diagnostic(`CLI finished. Code: ${result.code}, Full Output (last part):\n${result.fullOutput.slice(-500)}`); // Log last 500 chars
            assert.strictEqual(result.code, 0, `CLI should exit successfully after reset. Full output:\n${result.fullOutput}`);
            t.diagnostic('Assertion passed: CLI exited with code 0.');

            // 5. Verify branch is clean
            const finalStatus = testAPI.exec('git status --porcelain').trim();
            assert.strictEqual(finalStatus, '', `Git status should be clean after reset. Got status: "${finalStatus}"`);
            t.diagnostic('Assertion passed: Git status is clean.');

            // Verify untracked file is gone
            const dirtyFileExists = existsSync(dirtyFilePath);
            assert.strictEqual(dirtyFileExists, false, 'Dirty file should have been removed by the reset.');
            t.diagnostic('Assertion passed: Dirty file is removed.');
            
            // 6. Assert current branch is main
            const currentBranch = testAPI.exec('git rev-parse --abbrev-ref HEAD').trim();
            assert.strictEqual(currentBranch, 'main', 'Current branch should be main.');
            t.diagnostic(`Assertion passed: Current branch is ${currentBranch}.`);

            t.diagnostic('Interactive dirty-repo-reset test logic completed successfully.');

        } catch (error: any) {
            // If any step fails (timeout, assertion), terminate the CLI session to prevent hangs
            t.diagnostic(`Error during interactive test: ${error.message}. Terminating CLI session.`);
            cliSession.terminate(); // Ensure process is killed on error
            // Rethrow to fail the test
            throw error;
        }
    });
});

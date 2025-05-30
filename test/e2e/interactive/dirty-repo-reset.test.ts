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
    await setupTemporaryTestEnvironment(__dirname, async (testAPI) => {

        const dirtyFilePath = pathJoin(testAPI.tempDir, 'dirty-file.txt');

        // 1. Make the main branch dirty
        writeFileSync(dirtyFilePath, 'This is a dirty file.', 'utf-8');

        // 2. Verify it's dirty
        const initialStatus = testAPI.exec('git status --porcelain').trim();
        assert.ok(initialStatus.includes('?? dirty-file.txt'), `Branch should be dirty with untracked file. Got status: "${initialStatus}"`);

        // 3. Initiate interactive CLI
        const cliSession = createInteractiveCLI(`node ${testAPI.gitMainScript}`, { cwd: testAPI.tempDir });

        try {
            // Wait for the prompt asking to revert changes
            const promptOutput = await cliSession.waitForText(
                /Revert all changes\? \[y\/n]:/i, // Using regex for flexibility
                INTERACTIVE_TIMEOUT_MS
            );
            assert.ok(
                promptOutput.includes('You are on main branch with uncommitted changes:'), // Check for the context line too
                `Prompt context "You are on main branch with uncommitted changes:" not found. Got: "${promptOutput}"`
            );

            // Respond "y" to the prompt
            cliSession.respond("y");

            // Wait for a success message (adjust regex/text as needed)
            // Assuming git-main outputs a success message like "All done!" or similar after cleaning.
            const successMessage = await cliSession.waitForText(
                /✓ All done!/i, // Example success message, adjust if different
                INTERACTIVE_TIMEOUT_MS
            );
            
            // 4. Get result and assert exit code
            const result = await cliSession.waitForEnd(END_TIMEOUT_MS);
            t.diagnostic(`CLI finished. Code: ${result.code}, Full Output (last part):\n${result.fullOutput.slice(-500)}`); // Log last 500 chars
            assert.strictEqual(result.code, 0, `CLI should exit successfully after reset. Full output:\n${result.fullOutput}`);

            // 5. Verify branch is clean
            const finalStatus = testAPI.exec('git status --porcelain').trim();
            assert.strictEqual(finalStatus, '', `Git status should be clean after reset. Got status: "${finalStatus}"`);

            // Verify untracked file is gone
            const dirtyFileExists = existsSync(dirtyFilePath);
            assert.strictEqual(dirtyFileExists, false, 'Dirty file should have been removed by the reset.');
            
            // 6. Assert current branch is main
            const currentBranch = testAPI.exec('git rev-parse --abbrev-ref HEAD').trim();
            assert.strictEqual(currentBranch, 'main', 'Current branch should be main.');

        } catch (error: any) {
            // If any step fails (timeout, assertion), terminate the CLI session to prevent hangs
            t.diagnostic(`Error during interactive test: ${error.message}. Terminating CLI session.`);
            cliSession.terminate(); // Ensure process is killed on error
            // Rethrow to fail the test
            throw error;
        }
    });
});

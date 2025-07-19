import { test } from "node:test";
import assert from "assert";
import { dirname, join as pathJoin } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, existsSync } from "fs";
import { setupTemporaryTestEnvironment } from "../test-utils.ts";
import { createInteractiveCLI } from "../interactiveSpawn.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Define generous timeouts for CI environments
const INTERACTIVE_TIMEOUT_MS = 10000;
const END_TIMEOUT_MS = 15000;

test("interactive: dirty-repo-reset: git-main prompts to reset a dirty main branch and resets if confirmed", async () => {
  await setupTemporaryTestEnvironment(__dirname, async (testAPI) => {
    const dirtyFilePath = pathJoin(testAPI.tempDir, "dirty-file.txt");

    // Make the main branch dirty
    writeFileSync(dirtyFilePath, "This is a dirty file.", "utf-8");

    // Verify it's dirty
    const initialStatus = testAPI.exec("git status --porcelain").trim();
    assert.ok(
      initialStatus.includes("?? dirty-file.txt"),
      `Branch should be dirty with untracked file. Got status: "${initialStatus}"`,
    );

    const cliSession = createInteractiveCLI(`node ${testAPI.gitMainScript}`, {
      cwd: testAPI.tempDir,
    });

    // Wait for the prompt asking to revert changes
    const promptOutput = await cliSession.waitForText(
      /Revert all changes\? \[y\/n]:/i,
      INTERACTIVE_TIMEOUT_MS,
    );
    assert.ok(
      promptOutput.includes("You are on main branch with uncommitted changes:"),
      `Prompt context "You are on main branch with uncommitted changes:" not found. Got: "${promptOutput}"`,
    );

    cliSession.respond("y");

    await cliSession.waitForText(/✓ All done!/i, INTERACTIVE_TIMEOUT_MS);

    const result = await cliSession.waitForEnd(END_TIMEOUT_MS);
    assert.strictEqual(
      result.code,
      0,
      `CLI should exit successfully after reset. Full output:\n${result.fullOutput}`,
    );

    // Verify branch is clean
    const finalStatus = testAPI.exec("git status --porcelain").trim();
    assert.strictEqual(
      finalStatus,
      "",
      `Git status should be clean after reset. Got status: "${finalStatus}"`,
    );

    // Verify untracked file is gone
    const dirtyFileExists = existsSync(dirtyFilePath);
    assert.strictEqual(
      dirtyFileExists,
      false,
      "Dirty file should have been removed by the reset.",
    );

    // Assert current branch is main
    const currentBranch = testAPI
      .exec("git rev-parse --abbrev-ref HEAD")
      .trim();
    assert.strictEqual(currentBranch, "main", "Current branch should be main.");
  });
});

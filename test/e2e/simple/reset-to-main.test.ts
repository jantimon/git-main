import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import assert from "assert";
import { test } from "node:test";
import { setupTemporaryTestEnvironment } from "../test-utils.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test("reset-to-main: git-main switches to main and resets content from diverged feature branch", async () => {
  await setupTemporaryTestEnvironment(__dirname, async (testAPI) => {
    const divergedFixturePath: string = join(
      __dirname,
      "fixtures",
      "diverged-change",
    );
    const initialFixturePath: string = join(__dirname, "fixtures", "initial");

    testAPI.exec("git checkout -b feature-branch");

    await testAPI.applyChange(
      divergedFixturePath,
      "Commit on feature-branch with diverged README",
    );

    testAPI.exec("git checkout feature-branch"); // Make sure we are on the feature branch

    testAPI.exec(`node ${testAPI.gitMainScript}`);

    const currentBranch: string = testAPI
      .exec("git rev-parse --abbrev-ref HEAD")
      .trim();
    assert.strictEqual(
      currentBranch,
      "main",
      "Current branch should be main after git-main",
    );

    const readmeContent: string = await readFile(
      join(testAPI.tempDir, "README.md"),
      "utf-8",
    );
    const initialReadmeContent: string = await readFile(
      join(initialFixturePath, "README.md"),
      "utf-8",
    );
    assert.strictEqual(
      readmeContent,
      initialReadmeContent,
      "README.md content should match initial fixture after git-main",
    );
  });
});

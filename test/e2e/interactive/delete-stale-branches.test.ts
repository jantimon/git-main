import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
// zx is used by the script under test. No direct import needed here for mocking anymore.
import { setupTemporaryTestEnvironment, type TestAPI } from "../test-utils.ts";
import { createInteractiveCLI } from "../interactiveSpawn.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = __dirname;

const INTERACTIVE_TIMEOUT_MS = 10000;
const END_TIMEOUT_MS = 15000;
const TIMEOUT_LONG = END_TIMEOUT_MS + INTERACTIVE_TIMEOUT_MS;

// This variable will hold the mock output for `git branch -vv`
let branchVvOutputControlledByTest = "";

async function createBranchAndCommit(
  testAPI: TestAPI,
  branchName: string,
  commitDateIso?: string,
  trackRemote?: string,
  _remoteGone: boolean = false // Not directly used by this func, but signals intent for vvOutput
) {
  // Use testAPI.exec which is synchronous, or ensure testAPI.execAsync exists and is used correctly.
  // Based on prior errors, testAPI.exec is more likely. If exec is sync, ensure it doesn't block needed async ops.
  // For git commands, sync exec is often fine.
  testAPI.exec(`git checkout -b ${branchName}`);
  // Create a unique file for this branch to ensure a real commit
  testAPI.exec(`echo "${branchName} content" > ${branchName}.txt`);
  testAPI.exec(`git add ${branchName}.txt`);
  testAPI.exec(`git commit -m "Commit for ${branchName}"`); // Initial commit with content
  if (commitDateIso) {
    testAPI.exec(
      // Amend the existing commit message or provide a new one if required.
      // Using the original message: git commit --amend --no-edit
      // Using a new one: git commit --amend -m "New commit message"
      `git commit --amend --no-edit`, // Removed --date, will use env vars
      {
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: commitDateIso,
          GIT_COMMITTER_DATE: commitDateIso,
        },
      }
    );
    // Verification log
    const verificationStdout = testAPI.exec('git log -1 --format="iso-strict-date:%aI%ncommit-date:%cI%nauthor-date-ts:%at%ncommit-date-ts:%ct"');
    const authorDateMatch = verificationStdout.match(/iso-strict-date:(.*)/);
    const commitDateMatch = verificationStdout.match(/commit-date:(.*)/);
    const authorTsMatch = verificationStdout.match(/author-date-ts:(.*)/);
    const commitTsMatch = verificationStdout.match(/commit-date-ts:(.*)/);
    console.log(`[TEST_SETUP_DEBUG] Branch: ${branchName}, After Amend (helper), Raw log output: "${verificationStdout.replace(/\n/g, "\\n")}"`);
    console.log(`[TEST_SETUP_DEBUG] Branch: ${branchName}, Dates:\nAuthor (ISO): ${authorDateMatch ? authorDateMatch[1] : "N/A"} (TS: ${authorTsMatch ? authorTsMatch[1] : "N/A"})\nCommit (ISO): ${commitDateMatch ? commitDateMatch[1] : "N/A"} (TS: ${commitTsMatch ? commitTsMatch[1] : "N/A"})`);
  }
  if (trackRemote) {
    // This command can fail if the remote branch doesn't exist, which is expected in some test setups.
    // The actual "gone" status is controlled by the mock of `git branch -vv`.
    // So, we can make this optional or simply remove it if it causes issues and isn't strictly needed
    // for other reasons beyond setting up the *appearance* of tracking for the mock.
    // For now, let's comment it out to prevent test failures due to this command.
    // testAPI.exec(
    //   `git branch --set-upstream-to=origin/${trackRemote}`
    // );
  }
  testAPI.exec("git checkout main");
}

test("git-main interactive - delete stale branches", async (t) => {
  // This outer test serves as a describe block.

  await t.test("should correctly identify and offer to delete a single stale branch", { timeout: TIMEOUT_LONG }, async () => {
    await setupTemporaryTestEnvironment(FIXTURE_DIR, async (testAPI: TestAPI) => {
      const ONE_MONTH_AGO = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString();
      const TWO_MONTHS_AGO = new Date(new Date().setMonth(new Date().getMonth() - 2)).toISOString();

      await createBranchAndCommit(testAPI, "stale-and-gone", TWO_MONTHS_AGO, "stale-and-gone", true);
      await createBranchAndCommit(testAPI, "old-not-gone", TWO_MONTHS_AGO, "old-not-gone", false);
      await createBranchAndCommit(testAPI, "recent-gone", ONE_MONTH_AGO, "recent-gone", true);
      await createBranchAndCommit(testAPI, "recent-not-gone", ONE_MONTH_AGO, "recent-not-gone", false);
      await createBranchAndCommit(testAPI, "old-no-remote", TWO_MONTHS_AGO);

      const justUnderOneMonthAgo = new Date();
      justUnderOneMonthAgo.setDate(justUnderOneMonthAgo.getDate() - 28);
      const recentGoneISODate = justUnderOneMonthAgo.toISOString();
      testAPI.exec("git checkout recent-gone");
      testAPI.exec(`echo "updated content for recent-gone" > ${testAPI.tempDir}/recent-gone.txt`); // Use full path for clarity
      testAPI.exec(`git add recent-gone.txt`);
      testAPI.exec(
        `git commit --amend --no-edit`, // Removed --date
        {
          env: {
            ...process.env,
            GIT_AUTHOR_DATE: recentGoneISODate,
            GIT_COMMITTER_DATE: recentGoneISODate,
          },
        }
      );
      // Verification log for direct amend
      const directAmendVerificationStdout = testAPI.exec('git log -1 --format="iso-strict-date:%aI%ncommit-date:%cI%nauthor-date-ts:%at%ncommit-date-ts:%ct"');
      const directAuthorDateMatch = directAmendVerificationStdout.match(/iso-strict-date:(.*)/);
      const directCommitDateMatch = directAmendVerificationStdout.match(/commit-date:(.*)/);
      const directAuthorTsMatch = directAmendVerificationStdout.match(/author-date-ts:(.*)/);
      const directCommitTsMatch = directAmendVerificationStdout.match(/commit-date-ts:(.*)/);
      console.log(`[TEST_SETUP_DEBUG] Branch: recent-gone, After direct amend, Raw log output: "${directAmendVerificationStdout.replace(/\n/g, "\\n")}"`);
      console.log(`[TEST_SETUP_DEBUG] Branch: recent-gone, Dates:\nAuthor (ISO): ${directAuthorDateMatch ? directAuthorDateMatch[1] : "N/A"} (TS: ${directAuthorTsMatch ? directAuthorTsMatch[1] : "N/A"})\nCommit (ISO): ${directCommitDateMatch ? directCommitDateMatch[1] : "N/A"} (TS: ${directCommitTsMatch ? directCommitTsMatch[1] : "N/A"})`);
      testAPI.exec("git checkout main");

      branchVvOutputControlledByTest = `
        main                  abcdef0 [origin/main] Initial commit on main
      * stale-and-gone        abcdef1 [origin/stale-and-gone: gone] Commit on stale-and-gone
        old-not-gone          abcdef2 [origin/old-not-gone] Commit on old-not-gone
        recent-gone           abcdef3 [origin/recent-gone: gone] Commit on recent-gone
        recent-not-gone       abcdef4 [origin/recent-not-gone] Commit on recent-not-gone
        old-no-remote         abcdef5 Commit on old-no-remote
      `.trim();

      const cliSession = createInteractiveCLI(
        `node ${testAPI.gitMainScript}`,
        {
          cwd: testAPI.tempDir,
          env: {
            ...process.env,
            TEST_MOCK_GIT_BRANCH_VV_OUTPUT: branchVvOutputControlledByTest,
            GIT_MAIN_TEST_DEBUG: 'true',
          }
        }
      );

      let output = await cliSession.waitForText(/The following stale branches are selected for deletion:/, INTERACTIVE_TIMEOUT_MS);
      assert.ok(output.includes("- stale-and-gone"), "Should list stale-and-gone");

      assert.ok(!output.includes("- old-not-gone"), "Should not list old-not-gone");
      assert.ok(!output.includes("- recent-gone"), "Should not list recent-gone");
      assert.ok(!output.includes("- recent-not-gone"), "Should not list recent-not-gone");
      assert.ok(!output.includes("- old-no-remote"), "Should not list old-no-remote");

      output += await cliSession.waitForText(/Do you want to delete these 1 branches\?/, INTERACTIVE_TIMEOUT_MS);

      cliSession.respond("n");
      output += await cliSession.waitForText(/Branch deletion cancelled/, INTERACTIVE_TIMEOUT_MS);

      const result = await cliSession.waitForEnd(END_TIMEOUT_MS);
      assert.strictEqual(result.code, 0, `CLI exited with code ${result.code}. Output: ${result.fullOutput}`);

      const branchesAfter = testAPI.exec("git branch -l").trim();
      assert.ok(branchesAfter.includes("stale-and-gone"), "stale-and-gone should still exist");
    });
  });

  await t.test("should delete the branch if user confirms with 'y'", { timeout: TIMEOUT_LONG }, async () => {
    await setupTemporaryTestEnvironment(FIXTURE_DIR, async (testAPI: TestAPI) => {
      const TWO_MONTHS_AGO = new Date(new Date().setMonth(new Date().getMonth() - 2)).toISOString();
      await createBranchAndCommit(testAPI, "stale-to-delete", TWO_MONTHS_AGO, "stale-to-delete", true);

      branchVvOutputControlledByTest = `
        main              abcdef0 [origin/main] Initial commit on main
      * stale-to-delete   abcdef1 [origin/stale-to-delete: gone] Commit on stale-to-delete
      `.trim();

      const cliSession = createInteractiveCLI(
        `node ${testAPI.gitMainScript}`,
        {
          cwd: testAPI.tempDir,
          env: {
            ...process.env,
            TEST_MOCK_GIT_BRANCH_VV_OUTPUT: branchVvOutputControlledByTest,
            GIT_MAIN_TEST_DEBUG: 'true',
          }
        }
      );

      await cliSession.waitForText(/- stale-to-delete/, INTERACTIVE_TIMEOUT_MS);
      await cliSession.waitForText(/Do you want to delete these 1 branches\?/, INTERACTIVE_TIMEOUT_MS);

      cliSession.respond("y");
      await cliSession.waitForText(/Branch stale-to-delete deleted/, INTERACTIVE_TIMEOUT_MS);

      const result = await cliSession.waitForEnd(END_TIMEOUT_MS);
      assert.strictEqual(result.code, 0, `CLI exited with code ${result.code}. Output: ${result.fullOutput}`);

      const branchesAfter = testAPI.exec("git branch -l").trim();
      assert.ok(!branchesAfter.includes("stale-to-delete"), "stale-to-delete should be gone");
    });
  });

  await t.test("should select at most 5 branches, sorted alphabetically, if many are stale", { timeout: TIMEOUT_LONG }, async () => {
    await setupTemporaryTestEnvironment(FIXTURE_DIR, async (testAPI: TestAPI) => {
      const branchNames = ["stale-g", "stale-a", "stale-d", "stale-c", "stale-f", "stale-b", "stale-e"];
      let vvOutput = "main abcdef0 [origin/main] Initial commit on main\n";
      const TWO_MONTHS_AGO = new Date(new Date().setMonth(new Date().getMonth() - 2)).toISOString();

      for (const name of branchNames) {
        await createBranchAndCommit(testAPI, name, TWO_MONTHS_AGO, name, true);
        vvOutput += `  ${name} abcdef${branchNames.indexOf(name) + 1} [origin/${name}: gone] Commit on ${name}\n`;
      }
      branchVvOutputControlledByTest = vvOutput.trim();

      const cliSession = createInteractiveCLI(
        `node ${testAPI.gitMainScript}`,
        {
          cwd: testAPI.tempDir,
          env: { ...process.env, TEST_MOCK_GIT_BRANCH_VV_OUTPUT: branchVvOutputControlledByTest }
        }
      );

      const output = await cliSession.waitForText(new RegExp(`Found ${branchNames.length} stale branches. Randomly selecting 5 for deletion.`), INTERACTIVE_TIMEOUT_MS);
      assert.ok(output.includes("The following stale branches are selected for deletion:"));

      // Extract listed branches from the full session output after the prompt
      const fullOutputBeforeQuestion = output + await cliSession.waitForText(/Do you want to delete these 5 branches\?/, INTERACTIVE_TIMEOUT_MS);

      const outputLines = fullOutputBeforeQuestion.split('\n');
      const deletionSectionStartIndex = outputLines.findIndex((line: string) => line.includes("The following stale branches are selected for deletion:"));
      let listedBranchesForDeletion: string[] = [];
      if (deletionSectionStartIndex > -1) {
        for (let i = deletionSectionStartIndex + 1; i < outputLines.length; i++) {
          const line = outputLines[i].trim();
          if (line.startsWith("- ")) {
            const branchNamePart = line.substring(2).trim().split(" ")[0];
            // More explicit check for a non-empty string
            if (typeof branchNamePart === 'string' && branchNamePart.length > 0) {
              const finalBranchName: string = branchNamePart; // Ensure type is string
              listedBranchesForDeletion.push(finalBranchName);
            }
          } else if (line.includes("Do you want to delete these 5 branches?")) {
            break;
          }
        }
      }

      assert.strictEqual(listedBranchesForDeletion.length, 5, "Should list 5 branches for deletion");
      const sortedList = [...listedBranchesForDeletion].sort();
      assert.deepStrictEqual(listedBranchesForDeletion, sortedList, "Listed branches should be sorted alphabetically");

      cliSession.respond("n");
      await cliSession.waitForText(/Branch deletion cancelled/, INTERACTIVE_TIMEOUT_MS);
      await cliSession.waitForEnd(END_TIMEOUT_MS);
    });
  });

  await t.test("should inform if no stale branches are found", { timeout: TIMEOUT_LONG }, async () => {
    await setupTemporaryTestEnvironment(FIXTURE_DIR, async (testAPI: TestAPI) => {
      const ONE_MONTH_AGO = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString();
      const TWO_MONTHS_AGO = new Date(new Date().setMonth(new Date().getMonth() - 2)).toISOString();

      await createBranchAndCommit(testAPI, "recent-branch", new Date().toISOString(), "recent-branch", false);
      await createBranchAndCommit(testAPI, "old-but-active-remote", TWO_MONTHS_AGO, "old-but-active-remote", false);
      await createBranchAndCommit(testAPI, "recent-gone-remote", ONE_MONTH_AGO, "recent-gone-remote", true);

      branchVvOutputControlledByTest = `
        main                    abcdef0 [origin/main] Initial commit on main
        recent-branch           abcdef1 [origin/recent-branch] Commit on recent-branch
        old-but-active-remote   abcdef2 [origin/old-but-active-remote] Commit on old-but-active-remote
        recent-gone-remote      abcdef3 [origin/recent-gone-remote: gone] Commit on recent-gone-remote
      `.trim();

      const cliSession = createInteractiveCLI(
        `node ${testAPI.gitMainScript}`,
        {
          cwd: testAPI.tempDir,
          env: {
            ...process.env,
            TEST_MOCK_GIT_BRANCH_VV_OUTPUT: branchVvOutputControlledByTest,
            GIT_MAIN_TEST_DEBUG: 'true',
          }
        }
      );

      const output = await cliSession.waitForText(/Cleaning up stale branches.../, INTERACTIVE_TIMEOUT_MS);
      assert.ok(output.includes("No stale branches found matching the criteria."), "Should inform no stale branches found");

      // Check that it doesn't try to ask for deletion
      const fullSessionOutput = await cliSession.waitForEnd(END_TIMEOUT_MS).then(r => r.fullOutput, e => (e as Error).message);
      assert.ok(!fullSessionOutput.includes("The following stale branches are selected for deletion:"), "Should not list branches for deletion");
      assert.ok(!fullSessionOutput.includes("Do you want to delete"), "Should not ask for deletion confirmation");
    });
  });
});

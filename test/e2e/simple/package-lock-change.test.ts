import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { setupTemporaryTestEnvironment, type TestAPI } from '../test-utils.ts';
import { test } from 'node:test';
import assert from 'node:assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('package-lock-change-simple', () => {
  test('should run npm ci if feature branch lockfile differs from main branch lockfile', { timeout: 20000 }, async () => {
    await setupTemporaryTestEnvironment(__dirname, async (testAPI: TestAPI) => {
      const { exec, tempDir, gitMainScript } = testAPI;

      // setupTemporaryTestEnvironment commits initial files to main and pushes to origin.

      exec('git checkout -b feature-branch');

      const packageLockPath = path.join(tempDir, 'package-lock.json');
      const initialPackageLockJsonContent = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));

      // Modify package-lock.json on the feature branch
      const modifiedPackageLockJsonContent = { ...initialPackageLockJsonContent };
      modifiedPackageLockJsonContent['extraProperty'] = "this is a test on feature branch";
      if (!modifiedPackageLockJsonContent.packages) modifiedPackageLockJsonContent.packages = {};
      // Ensure structure for packages[''] exists before modifying its version
      if (!modifiedPackageLockJsonContent.packages['']) {
        modifiedPackageLockJsonContent.packages[''] = { name: initialPackageLockJsonContent.name || "test-repo", version: initialPackageLockJsonContent.version || "1.0.0" };
      }
      modifiedPackageLockJsonContent.packages[''].version = "1.0.2";

      fs.writeFileSync(packageLockPath, JSON.stringify(modifiedPackageLockJsonContent, null, 2));

      exec('git add package-lock.json');
      exec('git commit -m "Modify package-lock.json on feature-branch"');

      // Run git-main.js while on the feature branch.
      // The script is expected to switch to main, pull, and then compare
      // the feature branch's lockfile (as 'original') with main's lockfile.
      const run = testAPI.execInteractive(`node ${gitMainScript}`);
      const result = await run.waitForEnd();
      const gitMainOutput = result.fullOutput;
      let gitMainErrorOutput = '';

      if (result.code !== 0) {
        gitMainErrorOutput = `Script exited with code ${result.code}. Output:\n${result.fullOutput}`;
      }

      // Assertions
      // Check that the lockfile on disk is now main's version (script should switch branch)
      const lockfileAfterGitMain = fs.readFileSync(packageLockPath, 'utf8');
      const initialLockfileFromFixtures = fs.readFileSync(path.join(__dirname, 'fixtures', 'initial', 'package-lock.json'), 'utf8');
      assert.deepStrictEqual(JSON.parse(lockfileAfterGitMain), JSON.parse(initialLockfileFromFixtures), "Lockfile on disk should be main's (initial) version after script execution");

      assert.ok(gitMainOutput.includes('Installing dependencies with npm'), 'Output should include spinner message "Installing dependencies with npm"');
      assert.strictEqual(gitMainErrorOutput, '', 'No errors should occur during git-main.js execution');

      const branches = exec('git branch');
      assert.ok(branches.includes('* main'), 'Should be on main branch after script execution');
      assert.ok(branches.includes('feature-branch'), 'feature-branch should still exist');
    });
  });
});

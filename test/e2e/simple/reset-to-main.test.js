import { execSync } from 'child_process';
import { readFile, copyFile } from 'fs/promises';
import { join } from 'path';
import assert from 'assert';
import { test, afterEach } from 'node:test';
import { setupTemporaryTestEnvironment } from '../test-utils.js';

let cleanupFixture;

afterEach(async () => {
    if (cleanupFixture) {
        await cleanupFixture();
        cleanupFixture = null;
    }
});

test('reset-to-main: git-main switches to main and resets content from diverged feature branch', async () => {
    // Initial setup with 'initial' fixtures on 'main' branch
    const { tempDir, gitMainScript, execOpts, cleanup, projectRoot } = await setupTemporaryTestEnvironment('initial');
    cleanupFixture = cleanup;

    const divergedFixtureDir = join(projectRoot, 'test', 'e2e', 'simple', 'fixtures', 'diverged-change');
    const initialFixtureDir = join(projectRoot, 'test', 'e2e', 'simple', 'fixtures', 'initial');

    // console.log('Setting up feature branch with diverged content...');
    execSync('git checkout -b feature-branch', execOpts);
    // console.log('Checked out feature-branch.');

    await copyFile(join(divergedFixtureDir, 'README.md'), join(tempDir, 'README.md'));
    // console.log('Copied diverged README.md.');

    execSync('git add .', execOpts);
    execSync('git commit -m "Commit on feature-branch with diverged README"', execOpts);
    // console.log('Committed diverged README on feature-branch.');
    
    // Ensure we are on feature-branch before running git-main
    execSync('git checkout feature-branch', execOpts);
    // console.log('Switched back to feature-branch to run git-main.');

    // Execute git-main (while on feature-branch)
    // console.log(`Executing: node ${gitMainScript} in ${tempDir} while on feature-branch`);
    execSync(`node ${gitMainScript}`, execOpts);
    // console.log('git-main executed.');

    // Assertions
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', execOpts).toString().trim();
    assert.strictEqual(currentBranch, 'main', 'Current branch should be main after git-main');
    // console.log(`Assertion passed: Current branch is ${currentBranch}.`);

    const readmeContent = await readFile(join(tempDir, 'README.md'), 'utf-8');
    const initialReadmeContent = await readFile(join(initialFixtureDir, 'README.md'), 'utf-8');
    assert.strictEqual(readmeContent, initialReadmeContent, 'README.md content should match initial fixture after git-main');
    // console.log('Assertion passed: README.md content matches initial fixture.');
    // console.log('Reset to main test completed successfully.');
});

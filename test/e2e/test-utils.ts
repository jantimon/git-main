import { execSync, type ExecSyncOptions, type SpawnOptions } from "child_process";
import { mkdtemp, rm, copyFile, readdir, lstat, mkdir } from "fs/promises";
import { join, dirname, basename } from "path";
import { createInteractiveCLI } from "./interactiveSpawn.ts";
import { tmpdir } from "os";

const __filename = new URL(import.meta.url).pathname;
const utilsScriptDirname = dirname(__filename);

const projectRoot: string = join(utilsScriptDirname, "..", "..");
const gitMainScript: string = join(projectRoot, "dist", "git-main.js");

export interface TestAPI {
  tempDir: string;
  baseTempDir: string;
  gitMainScript: string;
  projectRoot: string;
  exec: (command: string, options?: ExecSyncOptions) => string;
  /**
   * Executes a command in the temporary directory with interactive capabilities
   * Example usage:
   * const run = api.execInteractive("some tool");
   * await run.waitForText("Proceed with the operation? (y/n)");
   * run.respond("y");
   * await run.waitForEnd();
   */
  execInteractive: (
    command: string,
    options?: SpawnOptions
  ) => ReturnType<typeof createInteractiveCLI>;
  applyChange: (fixtureDirPath: string, commitMessage: string) => Promise<void>;
}

/**
 * Sets up a temporary E2E testing environment with a local Git repository
 * and a simulated remote repository, then executes a provided callback
 * function with an API to interact with this environment.
 */
export async function setupTemporaryTestEnvironment(
  testFileDirname: string,
  testCallback: (api: TestAPI) => Promise<void>
): Promise<void> {
  let baseTempDir: string | undefined; // Needs to be accessible in finally
  const cleanups: ((() => void) | (() => Promise<void>))[] = [];
  const cleanup = async () => {
    for (const cleanupFn of cleanups) {
      try {
        await cleanupFn();
      } catch (error: any) {
        console.error(`Error during cleanup: ${error.message}`);
      }
    }
    cleanups.length = 0;
  };

  try {
    const newTempdir = await mkdtemp(
      join(tmpdir(), `git-main-e2e-${basename(testFileDirname)}-base-`)
    );
    baseTempDir = newTempdir;
    // Remove the temporary dir and its contents after the test
    cleanups.push(
      async () => await rm(newTempdir, { recursive: true, force: true })
    );

    const localDir: string = join(baseTempDir, "local");
    const remoteDir: string = join(baseTempDir, "remote");
    await mkdir(localDir);
    await mkdir(remoteDir);

    const remoteRepoPath: string = join(remoteDir, "upstream.git");
    execSync(`git init --bare "${remoteRepoPath}"`, {
      cwd: baseTempDir,
      stdio: "pipe",
      encoding: "utf-8",
    });

    const tempDir: string = localDir; // tempDir for the TestAPI refers to localDir

    const execInTempDir = (command: string, options?: ExecSyncOptions): string => {
      try {
        const output: string = execSync(command, {
          cwd: tempDir,
          stdio: "pipe",
          encoding: "utf-8",
          env: {
            ...process.env,
            FORCE_COLOR: "0", // Disable color output for easier parsing
            ...options?.env,
          },
          ...options,
        }).toString("utf8").trim();
        return output;
      } catch (e: any) {
        console.error(`❌ Error executing command [${command}]:`, e.message);
        if (e.stdout) console.error("Stdout:", e.stdout.toString());
        if (e.stderr) console.error("Stderr:", e.stderr.toString());
        throw e;
      }
    };

    execInTempDir("git init");
    execInTempDir('git config user.name "Test User"');
    execInTempDir('git config user.email "test@example.com"');
    execInTempDir("git checkout -b main");

    const initialFixturesPath: string = join(
      testFileDirname,
      "fixtures",
      "initial"
    );
    const fixtureFiles: string[] = await readdir(initialFixturesPath);
    for (const file of fixtureFiles) {
      const srcPath: string = join(initialFixturesPath, file);
      const destPath: string = join(tempDir, file);
      const stat = await lstat(srcPath);
      if (stat.isFile()) {
        await copyFile(srcPath, destPath);
      }
    }

    execInTempDir("git add .");
    execInTempDir('git commit --allow-empty -m "Initial commit with fixtures"');

    const relativeRemotePath: string = join("..", "remote", "upstream.git");
    execInTempDir(`git remote add origin "${relativeRemotePath}"`);
    execInTempDir("git push -u origin main");

    const applyGitChangeLogic = async (
      fixtureDirPath: string,
      commitMessage: string
    ): Promise<void> => {
      try {
        const changeFixtureFiles: string[] = await readdir(fixtureDirPath);
        for (const file of changeFixtureFiles) {
          const srcPath: string = join(fixtureDirPath, file);
          const destPath: string = join(tempDir, file);
          const stat = await lstat(srcPath);
          if (stat.isFile()) {
            await copyFile(srcPath, destPath);
          }
        }
        execInTempDir("git add .");
        execInTempDir(`git commit -m "${commitMessage}"`);
      } catch (error: any) {
        console.error(
          `❌ Error in applyGitChangeLogic (fixture: ${fixtureDirPath}, message: "${commitMessage}"):`,
          error.message
        );
        throw error;
      }
    };

    const testAPI: TestAPI = {
      tempDir,
      baseTempDir,
      gitMainScript,
      projectRoot,
      exec: execInTempDir,
      execInteractive: (command: string, options?: SpawnOptions) => {
        const run = createInteractiveCLI(command, {
          cwd: tempDir,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            ...options?.env,
            FORCE_COLOR: "0",
          },
          ...options,
        });
        cleanups.push(() => {
          if (run.pid()) {
            run.terminate();
          }
        });
        return run;
      },
      applyChange: applyGitChangeLogic,
    };

    console.info("🚀", "Start test run");
    await testCallback(testAPI);
  } catch (error: any) {
    await cleanup();
    throw error;
  }
  await cleanup();
}

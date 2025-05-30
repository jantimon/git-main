import { execSync } from 'child_process';
import { mkdtemp, rm, copyFile, readdir, lstat, mkdir } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { tmpdir } from 'os';

const __filename = new URL(import.meta.url).pathname;
const utilsScriptDirname = dirname(__filename);

const projectRoot: string = join(utilsScriptDirname, '..', '..');
const gitMainScript: string = join(projectRoot, 'dist', 'git-main.js');

export interface TestAPI {
  tempDir: string;
  baseTempDir: string;
  gitMainScript: string;
  projectRoot: string;
  exec: (command: string) => string;
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

  try {
    baseTempDir = await mkdtemp(join(tmpdir(), `git-main-e2e-${basename(testFileDirname)}-base-`));
    console.log(`Base temporary directory created: ${baseTempDir}`);

    const localDir: string = join(baseTempDir, 'local');
    const remoteDir: string = join(baseTempDir, 'remote');
    await mkdir(localDir);
    await mkdir(remoteDir);
    console.log(`Created local (${localDir}) and remote (${remoteDir}) subdirectories.`);

    const remoteRepoPath: string = join(remoteDir, 'upstream.git');
    console.log(`Initializing bare remote repository at: ${remoteRepoPath}`);
    execSync(`git init --bare "${remoteRepoPath}"`, { cwd: baseTempDir, stdio: 'pipe', encoding: 'utf-8' });
    console.log('Bare remote repository initialized.');

    const tempDir: string = localDir; // tempDir for the TestAPI refers to localDir

    const execInTempDir = (command: string): string => {
      console.log(`Executing in local repo [${tempDir}]: ${command}`);
      try {
        const output: string = execSync(command, { cwd: tempDir, stdio: 'pipe', encoding: 'utf-8' });
        console.log(`Output of [${command}]:\n${output}`);
        return output;
      } catch (e: any) {
        console.error(`Error executing command [${command}]:`, e.message);
        if (e.stdout) console.error('Stdout:', e.stdout.toString());
        if (e.stderr) console.error('Stderr:', e.stderr.toString());
        throw e;
      }
    };
    
    execInTempDir('git init');
    console.log('Local repository initialized.');
    execInTempDir('git config user.name "Test User"');
    execInTempDir('git config user.email "test@example.com"');
    console.log('Git user configured in local repository.');
    execInTempDir('git checkout -b main');
    console.log("Switched to 'main' branch in local repository.");

    const initialFixturesPath: string = join(testFileDirname, 'fixtures', 'initial');
    const fixtureFiles: string[] = await readdir(initialFixturesPath);
    for (const file of fixtureFiles) {
      const srcPath: string = join(initialFixturesPath, file);
      const destPath: string = join(tempDir, file);
      const stat = await lstat(srcPath);
      if (stat.isFile()) {
        await copyFile(srcPath, destPath);
      }
    }
    console.log('Initial fixture files copied to local repository.');

    execInTempDir('git add .');
    execInTempDir('git commit --allow-empty -m "Initial commit with fixtures"');
    console.log('Initial commit made in local repository.');

    const relativeRemotePath: string = join('..', 'remote', 'upstream.git');
    execInTempDir(`git remote add origin "${relativeRemotePath}"`);
    console.log("Remote 'origin' added to local repository.");
    execInTempDir('git push -u origin main');
    console.log("'main' branch pushed to 'origin'.");

    const applyGitChangeLogic = async (fixtureDirPath: string, commitMessage: string): Promise<void> => {
      console.log(`Applying git change from ${fixtureDirPath} to ${tempDir} with message "${commitMessage}"`);
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
        console.log('Files for git change copied.');
        execInTempDir('git add .');
        console.log('Git add . executed for change.');
        execInTempDir(`git commit -m "${commitMessage}"`);
        console.log(`Git commit executed for change with message: "${commitMessage}".`);
      } catch (error: any) {
        console.error(`Error in applyGitChangeLogic (fixture: ${fixtureDirPath}, message: "${commitMessage}"):`, error.message);
        throw error;
      }
    };

    const testAPI: TestAPI = {
      tempDir,
      baseTempDir,
      gitMainScript,
      projectRoot,
      exec: execInTempDir,
      applyChange: applyGitChangeLogic
    };

    await testCallback(testAPI);

  } finally {
    if (baseTempDir) {
      console.log(`Cleaning up base temporary directory: ${baseTempDir}`);
      try {
        await rm(baseTempDir, { recursive: true, force: true });
        console.log(`Base temporary directory ${baseTempDir} deleted.`);
      } catch (cleanupError: any) {
        console.error(`Failed to delete base temporary directory ${baseTempDir}:`, cleanupError.message);
      }
    }
  }
}

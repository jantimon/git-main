import { spawn } from 'child_process';

// Inline stripAnsi function
const stripAnsi = (str: string): string => str.replace(/\[[0-9;]*[a-zA-Z]|[0-9;]*[a-zA-Z]/g, '');

// Custom type for spawn options to be more specific if needed, or use NodeSpawnOptions
// export interface SpawnOptions extends NodeSpawnOptions {
// // Add any custom options if necessary, otherwise NodeSpawnOptions is fine
// }

export interface InteractivePrompt {
  output: string;
  respond: (input: string) => void;
  terminate: () => void;
}

export interface InteractiveCLIResult {
  code: number | null;
  fullOutput: string; // Renamed from 'output' to avoid confusion with prompt output
}

async function* runInteractive(
  command: string,
  options?: import('child_process').SpawnOptions
): AsyncGenerator<InteractivePrompt, InteractiveCLIResult, string | undefined> {
  const [cmd, ...args] = command.split(' ');
  const child = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });

  let accumulatedOutputSinceLastPrompt = '';
  let fullSessionOutput = ''; // To capture all output for the final result
  let resolvePrompt: (() => void) | null = null;
  let manualClose = false;
  let processError: Error | null = null;

  const createPromptPromise = (): Promise<void> =>
    new Promise<void>((resolve) => {
      resolvePrompt = resolve;
    });

  let promptPromise = createPromptPromise();

  const onData = (data: Buffer) => {
    const text = data.toString(); // Keep raw text with ANSI for now, strip before yielding
    accumulatedOutputSinceLastPrompt += text;
    fullSessionOutput += text;
    // Simple prompt detection: ends with ' [y\/n]: ' or similar question marks, or known prompts.
    // Strip ANSI for prompt detection only.
    if (stripAnsi(text.trim()).match(/(?:\[y\/n\]:|\?)$/i)) { // Uses the inline stripAnsi
      if (resolvePrompt) {
        resolvePrompt();
      }
    }
  };

  child.stdout!.on('data', onData);
  child.stderr!.on('data', onData);

  child.on('error', (err) => {
    processError = err;
    if (resolvePrompt) resolvePrompt(); // Unblock the loop on error
  });

  child.on('close', (code, signal) => {
    if (manualClose) return;
    if (code !== 0 && signal !== 'SIGTERM' && !processError) { // SIGTERM is used by terminate()
        processError = new Error(`Process exited unexpectedly with code ${code} signal ${signal}. Output:
${stripAnsi(fullSessionOutput)}`); // Uses the inline stripAnsi
    }
    if (resolvePrompt) resolvePrompt(); // Unblock the loop on close
  });

  try {
    while (!child.killed && !processError) {
      await promptPromise;

      if (processError) throw processError; // Error detected by event handlers
      if (child.killed || child.exitCode !== null) break; // Process ended

      const outputToYield = stripAnsi(accumulatedOutputSinceLastPrompt); // Uses the inline stripAnsi
      accumulatedOutputSinceLastPrompt = ''; // Reset for next interaction

      // Before yielding, check if the process has already exited cleanly.
      if (child.exitCode === 0 && outputToYield.trim() === '' && !child.stdout!.readable && !child.stderr!.readable) {
           break;
      }

      const response: string | undefined = yield {
        output: outputToYield,
        respond: (input: string) => {
          if (!child.killed && child.stdin!.writable) {
            child.stdin!.write(Buffer.from(input + '\n')); // Use Buffer
            promptPromise = createPromptPromise(); 
          } else {
            // console.warn('CLI Helper: Attempted to respond to a killed or non-writable process.');
          }
        },
        terminate: () => {
          if (!child.killed) {
            // console.log('CLI Helper: Terminating process manually.');
            manualClose = true;
            child.kill('SIGTERM');
            if (resolvePrompt) resolvePrompt(); 
          }
        },
      };
    }
    if (processError && !manualClose) throw processError;

  } catch (error:any) {
    if (!manualClose) { 
        const errorMessage = error.message || "Error during interactive session";
        if (!errorMessage.includes("Output:\n")) { 
            error.message = `${errorMessage}\nFull Output:\n${stripAnsi(fullSessionOutput)}`; // Uses the inline stripAnsi
        }
        console.error("CLI Helper:", error.message);
        throw error;
    }
  } finally {
    if (!child.killed && !manualClose) {
      // console.warn('CLI Helper: Process was not killed at end of generator, force killing.');
      manualClose = true; 
      child.kill('SIGTERM');
    }
  }
  
  const exitCode = await new Promise<number | null>((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
    } else {
      child.on('close', (code) => resolve(code));
    }
  });

  return { code: exitCode, fullOutput: stripAnsi(fullSessionOutput) }; // Uses the inline stripAnsi
}


export interface InteractiveCLISession {
  [Symbol.asyncIterator](): AsyncGenerator<InteractivePrompt, InteractiveCLIResult, string | undefined>;
  getResult(): Promise<InteractiveCLIResult>;
}

export function createInteractiveCLI(command: string, options?: import('child_process').SpawnOptions): InteractiveCLISession {
  const gen = runInteractive(command, options);
  let lastResponse: string | undefined = undefined; 

  return {
    async *[Symbol.asyncIterator]() {
      let result = await gen.next(lastResponse); 
      while (!result.done) {
        const responseFromTest: string | undefined = yield result.value;
        lastResponse = responseFromTest; 
        result = await gen.next(responseFromTest);
      }
      return result.value; 
    },
    getResult: async (): Promise<InteractiveCLIResult> => {
      let result = await gen.next(lastResponse); 
      while(!result.done) {
        // console.warn("CLI Helper: getResult() called while generator is still yielding prompts. Advancing with no input.");
        lastResponse = undefined; 
        result = await gen.next(undefined);
      }
      return result.value;
    }
  };
}

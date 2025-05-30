import {
  spawn,
  type ChildProcess,
  type SpawnOptions as NodeSpawnOptions,
} from "child_process";

// Inline stripAnsi function
const stripAnsi = (str: string): string =>
  str.replace(/\[[0-9;]*[a-zA-Z]|[0-9;]*[a-zA-Z]/g, "");

export interface SpawnOptions extends NodeSpawnOptions {
  // Custom options can be added here if necessary
}

export interface InteractiveCLIResult {
  code: number | null;
  fullOutput: string;
}

interface WaitForTextRequest {
  textToMatch: string | RegExp;
  resolve: (matchedOutput: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  originalTimeout: number; // For error messages
  startTime: number; // For error messages
}

export interface InteractiveCLISession {
  waitForText(
    textToMatch: string | RegExp,
    timeoutMs?: number
  ): Promise<string>;
  respond(input: string): void;
  waitForEnd(timeoutMs?: number): Promise<InteractiveCLIResult>;
  terminate(): void;
  pid(): number | undefined;
}

export function createInteractiveCLI(
  command: string,
  options?: SpawnOptions
): InteractiveCLISession {
  const [cmd, ...args] = command.split(" ");
  if (!cmd) {
    throw new Error("No command provided to createInteractiveCLI");
  }
  const child: ChildProcess = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });

  let fullSessionOutput = "";
  let currentOutputBuffer = ""; // Stores stripped output
  let processExited = false;
  let exitCode: number | null = null;
  let processError: Error | null = null;

  const waitForTextQueue: WaitForTextRequest[] = [];
  let closePromise: Promise<InteractiveCLIResult> | null = null;
  let closeResolve: ((result: InteractiveCLIResult) => void) | null = null;
  let closeReject: ((error: Error) => void) | null = null;

  const processData = (data: Buffer) => {
    const rawText = data.toString();
    fullSessionOutput += rawText; // Keep raw for full output if needed, but strip for matching
    const strippedText = stripAnsi(rawText);
    currentOutputBuffer += strippedText;

    // Check pending waitForText requests
    for (let i = waitForTextQueue.length - 1; i >= 0; i--) {
      const request = waitForTextQueue[i];
      let match: RegExpMatchArray | null | number = null;

      if (!request) {
        continue;
      }

      if (request.textToMatch instanceof RegExp) {
        match = currentOutputBuffer.match(request.textToMatch);
      } else {
        const idx = currentOutputBuffer.indexOf(request.textToMatch);
        if (idx !== -1) {
          match = idx;
        }
      }

      if (match !== null) {
        clearTimeout(request.timer);
        let matchedPortion: string;
        // String indexOf case
        if (
          typeof match === "number" &&
          typeof request.textToMatch === "string"
        ) {
          matchedPortion = currentOutputBuffer.substring(
            0,
            match + request.textToMatch.length
          );
          currentOutputBuffer = currentOutputBuffer.substring(
            match + request.textToMatch.length
          );
        } else if (
          request.textToMatch instanceof RegExp &&
          typeof match == "object"
        ) {
          // RegExp.match case
          // match[0] is the matched string, match.index is its start
          matchedPortion = currentOutputBuffer.substring(
            0,
            (match.index || 0) + match[0].length
          );
          currentOutputBuffer = currentOutputBuffer.substring(
            (match.index || 0) + match[0].length
          );
        } else {
          throw new Error(`Unexpected match type: ${typeof match}`);
        }
        request.resolve(matchedPortion);
        waitForTextQueue.splice(i, 1); // Remove fulfilled request
      }
    }
  };

  child.stdout?.on("data", processData);
  child.stderr?.on("data", processData);

  child.on("error", (err: Error) => {
    processError = err;
    processExited = true; // Treat as exited for pending operations
    // Reject pending waitForText requests
    waitForTextQueue.forEach((req) => {
      clearTimeout(req.timer);
      req.reject(
        new Error(
          `Process error occurred: ${err.message}. Output received before error: ${currentOutputBuffer}`
        )
      );
    });
    waitForTextQueue.length = 0;
    if (closeReject) {
      closeReject(err);
    }
  });

  child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
    exitCode = code;
    processExited = true;
    // Reject any remaining waitForText requests because the process closed before they were met
    waitForTextQueue.forEach((req) => {
      clearTimeout(req.timer);
      const timeSpent = Date.now() - req.startTime;
      req.reject(
        new Error(
          `Process closed (code ${code}, signal ${signal}) before text "${String(
            req.textToMatch
          )}" was found. Timeout was ${
            req.originalTimeout
          }ms, spent ${timeSpent}ms. Output received: "${currentOutputBuffer}"`
        )
      );
    });
    waitForTextQueue.length = 0;

    if (closeResolve) {
      closeResolve({
        code: exitCode,
        fullOutput: stripAnsi(fullSessionOutput),
      });
    }
  });

  return {
    pid(): number | undefined {
      return child.pid;
    },

    async waitForText(
      textToMatch: string | RegExp,
      timeoutMs: number = 200
    ): Promise<string> {
      if (processExited && processError) {
        return Promise.reject(
          new Error(
            `Process has already exited with error: ${
              processError.message
            }. Full output: ${stripAnsi(fullSessionOutput)}`
          )
        );
      }
      if (processExited) {
        return Promise.reject(
          new Error(
            `Process has already exited with code ${exitCode}. Full output: ${stripAnsi(
              fullSessionOutput
            )}`
          )
        );
      }

      return new Promise<string>((resolve, reject) => {
        const startTime = Date.now();
        // Check immediate buffer first
        let match: RegExpMatchArray | null | number = null;
        if (textToMatch instanceof RegExp) {
          match = currentOutputBuffer.match(textToMatch);
        } else {
          const idx = currentOutputBuffer.indexOf(textToMatch as string);
          if (idx !== -1) match = idx;
        }

        if (match !== null) {
          let matchedPortion: string;
          if (typeof match === "number") {
            matchedPortion = currentOutputBuffer.substring(
              0,
              match + (textToMatch as string).length
            );
            currentOutputBuffer = currentOutputBuffer.substring(
              match + (textToMatch as string).length
            );
          } else {
            matchedPortion = currentOutputBuffer.substring(
              0,
              (match.index || 0) + match[0].length
            );
            currentOutputBuffer = currentOutputBuffer.substring(
              (match.index || 0) + match[0].length
            );
          }
          resolve(matchedPortion);
          return;
        }

        // If not found immediately, queue the request
        const timer = setTimeout(() => {
          const queueIndex = waitForTextQueue.findIndex(
            (req) => req.timer === timer
          );
          if (queueIndex !== -1) {
            waitForTextQueue.splice(queueIndex, 1); // Remove from queue
          }
          const timeSpent = Date.now() - startTime;
          reject(
            new Error(
              `Timeout after ${timeSpent}ms waiting for text: "${String(
                textToMatch
              )}". Output received during wait: "${stripAnsi(
                currentOutputBuffer
              )}"`
            )
          );
        }, timeoutMs);

        waitForTextQueue.push({
          textToMatch,
          resolve,
          reject,
          timer,
          originalTimeout: timeoutMs,
          startTime,
        });
      });
    },

    respond(input: string): void {
      if (child.stdin && !child.stdin.destroyed && !processExited) {
        child.stdin.write(input + "\n");
      } else {
        console.warn(
          "CLI Helper: Attempted to respond to a closed or non-writable process."
        );
      }
    },

    async waitForEnd(timeoutMs: number = 2000): Promise<InteractiveCLIResult> {
      if (processExited) {
        if (processError) return Promise.reject(processError);
        return Promise.resolve({
          code: exitCode,
          fullOutput: stripAnsi(fullSessionOutput),
        });
      }

      if (!closePromise) {
        closePromise = new Promise<InteractiveCLIResult>((resolve, reject) => {
          closeResolve = resolve;
          closeReject = reject;

          const endTimer = setTimeout(() => {
            // If processError happened, it would have been handled already.
            // This timeout means the process is still running.
            if (!processExited) {
              const msg = `Timeout after ${timeoutMs}ms waiting for process to end. PID: ${child.pid}. Current output buffer: "${currentOutputBuffer}"`;
              console.warn(msg); // Log a warning for better diagnostics
              this.terminate(); // Attempt to kill the process on timeout
              reject(new Error(msg));
            }
            // If it exited just before this timeout fired, the 'close' event handler would resolve/reject.
          }, timeoutMs);

          // Ensure timer is cleared if process closes naturally
          child.once("close", () => clearTimeout(endTimer));
          child.once("error", () => clearTimeout(endTimer));
        });
      }
      return closePromise;
    },

    terminate(): void {
      if (!processExited && child.pid) {
        try {
          // Attempt to kill the entire process group by sending SIGTERM to -PID
          // This is more robust for killing spawned shells or processes that create their own children.
          process.kill(-child.pid, "SIGTERM");
        } catch (e: any) {
          // Fallback if killing process group fails (e.g., not supported, or process already dead)
          child.kill("SIGTERM");
        }
      }
    },
  };
}

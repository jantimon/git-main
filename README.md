# git-main

> Switch to main branch, clean up merged branches, and handle dependencies - all in one command

## Features

- 🔄 Auto-detects and switches to main/master branch
- 🧹 Cleans up fully merged branches
- 🚦 Handles dirty working directory gracefully
- 📦 Auto-updates dependencies if lockfile changed
- 🎯 Supports yarn, pnpm, and npm
- ⚡️ Fast and lightweight

## Installation

```bash
npm install -g git-main
```

Or use it directly with npx:

```bash
npx git-main
```

## Usage

Simply run `git-main` in any git repository. The tool will:

1. Switch to your main branch (auto-detects main/master)
2. Clean up your working directory if needed
3. Pull latest changes
4. Remove fully merged branches
5. Update dependencies if lockfile changed (supports yarn, pnpm, and npm)

### Package Manager Support

The tool automatically detects your package manager based on lockfiles:
- `yarn.lock` → uses `yarn --immutable`
- `pnpm-lock.yaml` → uses `pnpm install --frozen-lockfile`
- `package-lock.json` → uses `npm ci`

## Example

```bash
$ git-main
ℹ Using main branch: main
→ Fetching latest changes...
→ Pulling latest changes...
→ Cleaning up merged branches...
ℹ Deleting branch feature/123 (Branch is fully merged)
ℹ Deleting branch fix/456 (Branch content matches current main)
→ Installing dependencies with pnpm...
✓ All done! 🎉
```

## Running Tests

This project includes end-to-end (E2E) tests to ensure `git-main` behaves as expected in various scenarios.

### End-to-End Tests

To run the E2E tests locally:

1.  Ensure you have Node.js installed (version 16 or higher).
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Build the project:
    ```bash
    npm run build
    ```
4.  Run the E2E tests:
    ```bash
    npm run test:e2e
    ```

The tests will execute `git-main` in temporary Git repositories to simulate real-world usage.

## License

MIT © [Jan Nicklas](https://github.com/jantimon)
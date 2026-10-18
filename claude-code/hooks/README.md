# KarmaDue pre-install hook for Claude Code

`karmadue-preinstall.js` is a [PreToolUse hook](https://code.claude.com/docs/en/hooks) (Node 18+, no dependencies). Before Claude Code runs a Bash command, it finds package installs in it, asks KarmaDue (`POST /v1/preflight`) about each package and version, and:

- **denies** when a malicious-package report or a confirmed KarmaDue refusal covers that exact version. Claude gets the reason and up to 3 alternatives (suggested by similarity and evidence, not endorsed);
- **warns** when published advisories affect that version: Claude gets the advisory IDs and alternatives as `additionalContext`, you get a `systemMessage`, and the command goes through the normal permission flow (`KARMADUE_WARN=ask` turns this into a confirmation prompt);
- **stays silent** otherwise (exit 0, no output). It never auto-approves anything.

Network errors and timeouts fail open (you see "check skipped") unless `KARMADUE_STRICT=1`. A reply the hook can't read is reported as a warning, never treated as "nothing found".

## Install

```sh
mkdir -p .claude/hooks
curl -fsSL https://karmadue.expo.app/hooks/karmadue-preinstall.js -o .claude/hooks/karmadue-preinstall.js
```

Read it, then merge [`settings.json`](settings.json) into `.claude/settings.json` (or `~/.claude/settings.json` with an absolute path in `args`).

## Settings (environment variables)

| Variable | Effect |
| --- | --- |
| `KARMADUE_STRICT=1` | Block when KarmaDue can't be reached or errors (default: fail open) |
| `KARMADUE_WARN=ask` | Advisory warnings become a permission prompt |
| `KARMADUE_ALLOW=vm2,left-pad` | Names (or `name@version`) to skip: your overrides |
| `KARMADUE_TIMEOUT_MS` | Per-package timeout, default 5000 |
| `KARMADUE_API` | REST base, default `https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/public-api` |
| `KARMADUE_DISABLE=1` | Do nothing |

Only `{target, action}` is sent per package (for example `npm:vm2@3.9.17`). No command text, paths or environment.

## What it matches

npm/pnpm/yarn/bun `install|i|add` with package names, `yarn global add`, `pnpm dlx`, `yarn dlx`, `bun x`, `npm exec`, `npx`, `bunx`, `pnpx`; `pip install` (and `pip3`, `python -m pip`), `uv pip install`, `uv add`, `uv tool install|run`, `uvx` (`--from`, `--with`), `pipx install|run`; `cargo install`; `go install|get`, `go run pkg@v`; `brew install`; `claude mcp add` (the server command, or a remote URL) and `claude mcp add-json`. Chains (`&&`, `;`, `|`), `$(...)`, backticks, `sudo`/`env`/`VAR=` prefixes. Up to 8 packages per command.

Exact versions are checked as that version. Ranges, tags (`latest`) or no version are checked against the latest version KarmaDue knows, which may differ from what your package manager resolves.

## What it does not catch

- `curl ... | sh`, `wget` and run, install scripts, Docker images, manual downloads, binaries.
- Lockfile/manifest installs (`npm install`, `npm ci`, `pip install -r`, `uv sync`, `poetry install`) and transitive dependencies. Use the [GitHub Action](../../github-action/) or `POST /feeds/v1/packages/check` in CI for those.
- Package managers it doesn't parse (gem, composer, apt, conda, nix, deno, `poetry add`, ...), aliases and shell functions, installs inside scripts Claude runs (`bash setup.sh`, `npm run x`), and anything not run through the Bash tool (MCP tools, files written and run later).
- Git URLs, local paths, tarballs.
- Cargo, Go and Homebrew are parsed and sent, but KarmaDue's advisory data covers npm and PyPI today, so those checks usually find nothing.
- Missing evidence: no report is not proof a package is safe. Hooks are best-effort; Claude Code's permission rules are the hard gate.

## Tests

```sh
node test/parse.js            # command parsing, no network
node test/run.js              # mock API: fresh live captures, the v1 reply format, and format-drift cases
node test/run.js --live       # real KarmaDue API (drift and legacy cases still use the mock)
node test/run.js --live --ci  # live contract: blocks event-stream@3.3.6 and postmark-mcp@1.0.18, warns on jinja2==2.11.2, quiet on is-number@7.0.0
node test/capture.js          # refresh fixtures/preflight-responses.json from the live API
```

CI: `integrations/.github/workflows/claude-code-hook-live.yml` runs all of the above on Node 18, 20 and 22, on changes and every 6 hours.

Version 1.1.0. See [CHANGELOG.md](CHANGELOG.md). If KarmaDue's reply can't be read, the hook warns ("check NOT done"), or denies under `KARMADUE_STRICT=1`. It never stays silent.

Each fixture in `test/fixtures/` is a PreToolUse stdin payload. The runner checks the contract from the hooks reference: exit 0; stdout empty or one JSON object; `hookSpecificOutput.hookEventName` is `PreToolUse`; `permissionDecision` is allow/deny/ask/defer with a reason; text fields under 10,000 characters.

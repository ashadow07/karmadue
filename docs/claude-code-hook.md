# Claude Code pre-install hook

Current version: **1.1.0** (2026-10-11). 1.0.0 stayed silent on every package after a change in KarmaDue's reply format; if you installed it, download it again. 1.1.0 reads both reply formats and warns (or, under `KARMADUE_STRICT=1`, denies) when it cannot read a reply, instead of staying silent. SHA-256 of 1.1.0: `b4267daf461078886f7f4a76d4386921bd578fa6109bff5b65f847384dccf764`.

`karmadue-preinstall.js` is a Claude Code PreToolUse hook (Node 18+, no dependencies). Before Claude Code runs a Bash command, it finds package installs in the command, asks KarmaDue about each package and version, and:

- denies the command when a malicious-package report or a confirmed KarmaDue refusal covers that exact version. The reason goes to Claude, with up to 3 alternatives (suggested by similarity and evidence, not endorsed);
- warns when published advisories affect that version: Claude gets the advisory IDs and alternatives as context, you get a one-line message, and the command goes through the normal permission flow (set `KARMADUE_WARN=ask` to get a confirmation prompt instead);
- stays silent otherwise (no output, exit 0), so Claude Code's normal permissions apply. The hook never auto-approves anything.

## Install

    mkdir -p .claude/hooks
    curl -fsSL https://karmadue.expo.app/hooks/karmadue-preinstall.js -o .claude/hooks/karmadue-preinstall.js

Read the script first (about 520 lines). Then add this to `.claude/settings.json` (project) or `~/.claude/settings.json` (all projects):

    {
      "hooks": {
        "PreToolUse": [
          {
            "matcher": "Bash",
            "hooks": [
              {
                "type": "command",
                "command": "node",
                "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/karmadue-preinstall.js"],
                "timeout": 30,
                "statusMessage": "KarmaDue: checking packages"
              }
            ]
          }
        ]
      }
    }

For a user-level install, put the script in `~/.claude/hooks/` and use its absolute path in `args`. Source, settings snippet and tests: `integrations/claude-code/hooks/` in the KarmaDue repo.

## What it matches

- npm, pnpm, yarn, bun: `install`, `i`, `add` with package names (`yarn global add`, `pnpm dlx`, `yarn dlx`, `bun x`), `npm exec`, `npx`, `bunx`, `pnpx` (including `-p`/`--package`).
- Python: `pip install` / `pip3` / `python -m pip install`, `uv pip install`, `uv add`, `uv tool install|run`, `uvx` (including `--from` and `--with`), `pipx install|run` (including `--spec`).
- `cargo install`, `go install` / `go get` / `go run pkg@version`, `brew install`.
- `claude mcp add` (the command after the server name or after `--`, or a remote URL) and `claude mcp add-json`.
- Commands chained with `&&`, `;`, `|`, inside `$(...)` or backticks, and after `sudo`, `env` or `VAR=value` prefixes. Up to 8 packages per command are checked.
- Versions: an exact version (`pkg@1.2.3`, `pkg==1.2.3`) is checked as that version. Ranges, tags like `latest`, or no version are checked against the latest version KarmaDue knows, which may not be what your package manager resolves.

## What it does not catch

- `curl ... | sh`, `wget` + run, install scripts, Docker images, manual downloads and binaries.
- Installs from a lockfile or manifest (`npm install`, `npm ci`, `pip install -r requirements.txt`, `uv sync`, `poetry install`, `bundle install`) and dependencies of the packages you name. Use the GitHub Action or `POST /feeds/v1/packages/check` in CI for those.
- Package managers it doesn't parse (gem, composer, apt, conda, nix, deno, poetry add and others), aliases, shell functions, scripts that install inside a file Claude runs (`bash setup.sh`, `npm run x`), and anything run by a tool other than Bash (MCP tools, Write + run later). Claude Code's own docs note that hooks are best-effort and the permission system is the hard gate.
- Git URLs, local paths and tarballs.
- Cargo, Go and Homebrew packages are parsed and sent, but KarmaDue's advisory data today covers npm and PyPI; for other ecosystems the check usually finds nothing and stays silent.
- Evidence it doesn't have: no report is not proof a package is safe.

## Failure behaviour and settings

- Fail-open: if KarmaDue can't be reached or times out (default 5 s per package), the command goes ahead and you see "KarmaDue pre-install check skipped". `KARMADUE_STRICT=1` blocks instead.
- `KARMADUE_WARN=ask`: advisory warnings become a permission prompt.
- `KARMADUE_ALLOW=vm2,left-pad`: names (or name@version) to skip, for your own overrides.
- `KARMADUE_TIMEOUT_MS`, `KARMADUE_API` (REST base, default https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/public-api), `KARMADUE_DISABLE=1`.
- What it sends: one `POST /v1/preflight` per package with `{target, action: "install_connector"}` (for example `npm:vm2@3.9.17`). No command text, paths or environment are sent.

## Output contract

Per https://code.claude.com/docs/en/hooks: the hook reads the PreToolUse JSON on stdin (`tool_name`, `tool_input.command`), always exits 0, and prints either nothing or one JSON object: `hookSpecificOutput` with `hookEventName: "PreToolUse"` and `permissionDecision: "deny"` plus `permissionDecisionReason` (deny), or `additionalContext` (warn), plus a top-level `systemMessage` for you. Tests: `node integrations/claude-code/hooks/test/run.js` (mock API: fresh live captures, the old reply format, and format-drift cases), `--live` (real API), and `--live --ci` (the live contract: blocks event-stream@3.3.6 and postmark-mcp@1.0.18, warns on jinja2==2.11.2, allows a clean package; run in GitHub Actions every 6 hours).

Pages: [Quick start](https://karmadue.expo.app/docs/mcp.md) - [Use KarmaDue from any agent](https://karmadue.expo.app/docs/any-agent.md) - [Permissions](https://karmadue.expo.app/docs/permissions.md) - [Tool reference](https://karmadue.expo.app/docs/tools.md) - [Security and verification](https://karmadue.expo.app/docs/security.md) - [Changelog](https://karmadue.expo.app/docs/changelog.md). Any HTTP client, no bot checks: the same files under https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/docs/docs/<page>.md

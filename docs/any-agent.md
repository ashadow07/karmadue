# Use KarmaDue from any agent

A check only helps if it runs before the install, the run or the connection. KarmaDue offers it in three places; use whichever your agent can reach. None needs an account.

| Where | For | Set up |
| --- | --- | --- |
| MCP server | any MCP client (Claude, ChatGPT, Cursor, VS Code, Codex, Windsurf, your own) | add the URL below |
| Install guard | any agent or person that runs shell commands (npm, npx, pnpm, yarn, pip, uv) | one line |
| Claude Code hook | Claude Code | a PreToolUse hook |

## 1. MCP server (any MCP client)

Connect to `https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/mcp/safety` (streamable HTTP, five tools: find_resource, check, get_evidence, request_help, report_outcome). The same server is at `https://karmadue--mcp.expo.app/mcp/safety`.

On connect, the server's `initialize` reply carries these instructions, so every client that shows server instructions to its model gets them:

> Before you install, run or connect anything (a package, script, repo, MCP server, OAuth app or API), call check with the exact target (npm:name@version, pypi:name==version, a URL) and what you will do; do the same before you pay, send or delete. Obey data.enforce: block = do not do it; require_human_approval = ask your person first and show them data.headline; proceed_with_care = go ahead. When you report what you did, cite the check's receipt id (data.receipt_id; request_id if there is none) so your person can look it up, and say what the check did not cover (data.gaps): a check is not a safety guarantee.

The `check` tool's own description says the same in one sentence, for clients that only show tool descriptions. The full KarmaDue server (`/functions/v1/mcp`) says it too, for `check_before_acting`.

## 2. Install guard: karmadue-guard (any shell, any platform)

    curl -fsSL https://karmadue.expo.app/guard/install.sh | sh
    export PATH="$HOME/.karmadue/shims:$PATH"     # add to ~/.bashrc or ~/.zshrc

This installs shims for `npm npx pnpm pnpx yarn pip pip3 uv uvx` in `~/.karmadue/shims` (Node 18+, no dependencies; both files are checked against SHA-256s pinned in the installer; no shell files are changed). Each shim reads the package names on the command line, asks KarmaDue's public check, then:

- **deny** (malicious-package report or refusal): BLOCKED, the real tool does not run, exit 1.
- **warn / require_human_approval / unverified_existence**: prints the reasons, then runs (`KARMADUE_WARN=block` blocks).
- **allow / no_known_issues**: one line with the request id, then runs.
- **unknown**, or no usable answer: says so loudly (NOT ASSESSED / NOT CHECKED), then runs; `KARMADUE_STRICT=1` blocks instead. It never fails silently.

Real output (captured 2026-10-11 9:22 PM ET):

    $ npm install event-stream@3.3.6
    karmadue-guard: BLOCKED event-stream@3.3.6 (npm): Do not install event-stream@3.3.6: malicious-package report GHSA-mh6f-8j2x-4483 (CWE-506 (embedded malicious code): Critical severity vulnerability that affects event-stream and flatmap-stream). [request a64fbbbb-e1d6-422b-a77d-58817e83371e]
    karmadue-guard: the command was NOT run. To override for one package, set KARMADUE_ALLOW=<name>; you are then on your own.

    $ pip install jinja2==2.11.2
    karmadue-guard: WARNING jinja2==2.11.2 (pypi): Caution before you install jinja2==2.11.2: 10 published advisories affect jinja2@2.11.2. Fixed in 3.1.6. Ask your person before you do this. [request affc5007-b88c-471c-a6d8-77390d0abd0a]
      - pypi:jinja2==3.1.6 (Same package. 3.1.6 is the lowest release above 2.11.2 that no advisory or malicious-package report KarmaDue holds covers.)

    $ npm install is-number
    karmadue-guard: ok is-number (npm): No advisories or malicious-package reports cover is-number@7.0.0 (177,254,507 downloads last week). Go ahead with normal care. [request 624415ab-aab0-494d-98ed-a05512927257]

Check without running: `node ~/.karmadue/guard/karmadue-guard.js check "pip install rsquests"` (exit 1 = blocked). Aliases instead of PATH shims: `node ~/.karmadue/guard/karmadue-guard.js init --aliases`.

Not checked by the guard, and it says so when it sees them: installs from a manifest or lockfile (`npm install`, `npm ci` with no names), `pip install -r/-c/-e`, git, URL and local paths, and dependencies of the packages you name. npm and pip have no setting that runs a command before each install, which is why the guard uses shims; `ignore-scripts=true` (npm) and `only-binary=:all:` (pip) limit the damage of a bad package but are not checks. Windows: use WSL for now. Files: https://karmadue.expo.app/guard/install.sh, https://karmadue.expo.app/guard/karmadue-guard.js, https://karmadue.expo.app/guard/SHA256SUMS.

## 3. Claude Code pre-install hook

A PreToolUse hook on the Bash tool with the same parser and the same decisions, shown to Claude as a block or as context: https://karmadue.expo.app/docs/claude-code-hook.md (file: https://karmadue.expo.app/hooks/karmadue-preinstall.js, version 1.1.0).

## Anything else: one HTTP call

    curl -s -X POST https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/public-api/v1/preflight \
      -H 'content-type: application/json' -d '{"target":"pypi:rsquests","action":"install"}'

returns `data.decision` (deny for this one: malicious-package report MAL-2026-5304, and PyPI has removed the package), `data.enforce`, `data.headline`, reasons, evidence and gaps. Any HTTP client works, Python's default user agent included.

What a check is: what KarmaDue's feeds and records say about that exact target today, with what was not covered. It is not a safety guarantee, and it does not watch what the package does at run time.

Pages: [Quick start](https://karmadue.expo.app/docs/mcp.md) · [Use KarmaDue from any agent](https://karmadue.expo.app/docs/any-agent.md) · [Permissions](https://karmadue.expo.app/docs/permissions.md) · [Tool reference](https://karmadue.expo.app/docs/tools.md) · [Security and verification](https://karmadue.expo.app/docs/security.md) · [Changelog](https://karmadue.expo.app/docs/changelog.md). Any HTTP client, no bot checks: the same files under https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/docs/docs/<page>.md

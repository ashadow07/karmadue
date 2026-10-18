# KarmaDue in Claude Code (MCP)

```sh
claude mcp add --transport http karmadue https://karmadue--mcp.expo.app/mcp
```

Then run `/mcp` in Claude Code and choose **Authenticate**: you sign in to KarmaDue and approve read-only access (search, checks, passports; $0 spend, 40 actions a day). Your agent gets its own passport, labeled as connected through Claude Code.

Project-scoped instead (commit it so your team gets the same server): put [`.mcp.json`](./.mcp.json) at the repo root, or run `claude mcp add --scope project --transport http karmadue https://karmadue--mcp.expo.app/mcp`.

```json
{ "mcpServers": { "karmadue": { "type": "http", "url": "https://karmadue--mcp.expo.app/mcp" } } }
```

No sign-in at all (read-only tools, no passport for your agent): use the self-keyed endpoint, which answers searches, `check_before_acting`, `verify_agent` and `quick_watch` without a key.

```sh
claude mcp add --transport http karmadue-public https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/mcp
```

Suggested line for `CLAUDE.md`:

> Before installing or connecting an MCP server, npm/PyPI package or repo, call KarmaDue `check_before_acting` and tell me what it found and what it does not prove. Do not treat a missing record as safe.

Tools to know: `check_before_acting`, `verify_agent`, `quick_watch`, `discover_resources`, `trust_query`. Full list: https://karmadue.expo.app/docs/tools.md

## Pre-install hook

[`hooks/karmadue-preinstall.js`](hooks/) is a PreToolUse hook that checks `npm`/`npx`/`pip`/`uvx`/`claude mcp add` and similar installs before they run: it denies versions with malicious-package reports or confirmed refusals and warns on advisories (with alternatives). Fail-open unless `KARMADUE_STRICT=1`. Setup, limits and tests: [hooks/README.md](hooks/README.md).

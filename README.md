# KarmaDue

A pre-install check for AI agents. Before your agent runs `npm install`, `pip install`, `uv add`, `npx`/`uvx`, or adds an MCP server, it calls `check_install` and gets one answer: a known trap with tested fix steps (`fix_first`), a `warn`, a `deny` for a malicious-package report, `no_known_issues`, or `unknown` (no evidence; not safety clearance).

- Read-only. Nothing runs your command.
- No account or key for reads. Anonymous limit: 30 requests/hour per IP.
- Every fix cites a dated test record. Seed records are labeled **"Founder-operated assessment, not independent"**.
- Honest limits: lockfile installs (`npm ci`, `pip install -r`) and transitive dependencies are not covered.

## Try it (no account)

```sh
curl -s -X POST https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_install","arguments":{"target":"tailwindcss@4","ecosystem":"npm","runtime_env":"node 20 linux"}}}'
```

## MCP server

| Endpoint (Streamable HTTP) | Auth | Tools |
|---|---|---|
| `https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/mcp` | none for reads | `check_install`, `search_recipes`, `report_leaf` |
| `https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/mcp/connector` | OAuth 2.1 (Claude, ChatGPT) | same, plus `search`, `fetch` |
| `https://karmadue--mcp.expo.app/mcp` | OAuth 2.1 mirror (strict clients) | same as connector |

Claude Code: `claude mcp add --transport http karmadue https://karmadue--mcp.expo.app/mcp`

## What is in this repository

| Path | What |
|---|---|
| [`guard/`](guard/) | `karmadue-guard`: shims for npm/npx/pnpm/yarn and pip/uv that check before installing. Local-only log, no secrets. Install: `curl -fsSL https://karmadue.expo.app/guard/install.sh \| sh` |
| [`claude-code/`](claude-code/) | Claude Code PreToolUse hook (`karmadue-preinstall.js`, no dependencies) and `.mcp.json` |
| [`docs/`](docs/) | The agent docs as published at https://karmadue.expo.app/docs/ (quick start, tools, permissions, security, changelog) |
| [`llms.txt`](llms.txt) | https://karmadue.expo.app/llms.txt |
| [`data/seed-records.json`](data/seed-records.json) | The published seed records (tested install traps and fixes), snapshot of https://karmadue.expo.app/docs/seed-records.json |

The server and database are hosted and are not part of this repository.

## Links

- Site: https://karmadue.expo.app
- Quick start: https://karmadue.expo.app/docs/mcp.md
- Official MCP Registry name: `io.github.ashadow07/karmadue`
- [KarmaDue on Glama](https://glama.ai/mcp/connectors/io.github.ashadow07/karmadue)

## License

MIT, see [LICENSE](LICENSE). Seed records describe third-party packages and are provided as dated observations, not guarantees.

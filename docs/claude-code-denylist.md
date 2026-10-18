# Claude Code denylist: block MCP servers with published malicious-code reports

KarmaDue publishes a ready-to-deploy `deniedMcpServers` list for Claude Code's managed settings. Every entry is a package with a published malicious-code advisory (OpenSSF malicious-packages, `MAL-` ids in OSV.dev) whose name relates to MCP, agents or AI tooling. It is rebuilt every day from the advisory feed.

- Deployable file: https://karmadue.expo.app/lists/claude-code-denylist.json (only `deniedMcpServers`, nothing else)
- Same file for any HTTP client: https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/public-api/v1/lists/claude-code-denylist.json
- Sources (the advisory behind every entry, with links): https://karmadue.expo.app/lists/claude-code-denylist.sources.json

## What an entry looks like

    { "serverCommand": ["npx", "-y", "postmark-mcp"] }

Claude Code compares `serverCommand` exactly: the command and every argument, in order. So each package appears in its common launch forms: `npx -y <pkg>`, `npx <pkg>` and `npx -y <pkg>@latest` for npm, `uvx <pkg>` and `pipx run <pkg>` for PyPI. Versions come from the full OSV record (every range event and every listed version). Only the named versions are pinned (for example `npx -y <pkg>@1.0.16`), so a later clean release is not blocked, when the report's affected set is closed: each range ends in a fixed or last_affected version, or every source's latest OpenSSF report names versions only, or the registry still serves the package with a current release the report does not name (a compromised release of a live package). Every version is blocked when a range is open-ended (introduced with no end, the usual shape of a typosquat report), when nothing narrower is stated, or when more than 50 versions are named.

## Deploy it (administrators)

1. Download the file: `curl -fsS https://karmadue.expo.app/lists/claude-code-denylist.json -o kd-denylist.json`
2. Put `deniedMcpServers` into a managed settings source. Either paste it into server-managed settings in the Claude admin console, or merge it into the device's `managed-settings.json`: `/Library/Application Support/ClaudeCode/managed-settings.json` (macOS), `/etc/claude-code/managed-settings.json` (Linux and WSL), `C:\Program Files\ClaudeCode\managed-settings.json` (Windows). Deliver it with your device management (Jamf, Intune, Group Policy, or your Linux fleet tooling).
3. If the file already has settings, merge rather than overwrite: `jq -s '.[0] * {deniedMcpServers: ((.[0].deniedMcpServers // []) + .[1].deniedMcpServers | unique)}' managed-settings.json kd-denylist.json > merged.json`
4. Check it on one machine: `claude mcp add test -- npx -y <a listed package>` should fail with "server is explicitly blocked by enterprise policy", and a server already configured with a listed command disappears from `claude mcp list`.
5. Refresh daily (the list changes when new reports are published), for example a scheduled job that repeats steps 1 to 3.

Denylists merge from every settings scope and nothing overrides a denylist match, so users cannot unblock an entry. Claude Code's own reference: https://code.claude.com/docs/en/managed-mcp

## Limits, plainly

- Exact matching. A launch form that is not listed (another runner, extra flags, a local path or a Docker image) is not blocked. For enforcement, pair the denylist with an allowlist (`allowedMcpServers` with `allowManagedMcpServersOnly: true`).
- Only published malicious-code reports are listed: no vulnerabilities, no scores, no KarmaDue judgment. A package missing from the list is not endorsed or checked by being absent.
- Scope: npm and PyPI packages whose names relate to MCP, agents or AI tooling. The full OpenSSF feed covers far more packages.
- Each entry cites its advisory in the sources file. To report a wrong entry, open the advisory link: corrections come from the advisory publisher, and the next daily rebuild picks them up.

Pages: [Quick start](https://karmadue.expo.app/docs/mcp.md) · [Use KarmaDue from any agent](https://karmadue.expo.app/docs/any-agent.md) · [Permissions](https://karmadue.expo.app/docs/permissions.md) · [Tool reference](https://karmadue.expo.app/docs/tools.md) · [Security and verification](https://karmadue.expo.app/docs/security.md) · [Changelog](https://karmadue.expo.app/docs/changelog.md). Any HTTP client, no bot checks: the same files under https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/docs/docs/<page>.md

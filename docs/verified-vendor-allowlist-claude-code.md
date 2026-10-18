# Verified-vendor allowlist for Claude Code (allowedMcpServers)

File: https://karmadue.expo.app/lists/verified-vendor-allowlist.claude-code.json (13,147 `serverUrl` entries). Other formats: [Cursor](https://karmadue.expo.app/docs/verified-vendor-allowlist-cursor.md), [Codex](https://karmadue.expo.app/docs/verified-vendor-allowlist-codex.md).

    { "allowedMcpServers": [ { "serverUrl": "https://mcp.stripe.com" }, { "serverUrl": "https://mcp.notion.com/mcp" } ] }

## Deploy it

1. Download: `curl -fsS https://karmadue.expo.app/lists/verified-vendor-allowlist.claude-code.json -o kd-allow.json`
2. Cut it down to the servers you want, and add `serverCommand` entries for any local (stdio) servers you allow.
3. Merge `allowedMcpServers` into your managed settings (server-managed settings, or `managed-settings.json` deployed by MDM). Set `"allowManagedMcpServersOnly": true` as well, or users' own settings can widen the allowlist.

## What Claude Code enforces

- Once `allowedMcpServers` is set, a remote server loads only if its URL matches a `serverUrl` entry. A pattern with no path matches every path on that host, port 443 only. A host with `*` matches every port.
- Stdio servers need a `serverCommand` entry. This file has none, so deploying it unchanged blocks every local server.
- `deniedMcpServers` (for example https://karmadue.expo.app/lists/claude-code-denylist.json) still wins over the allowlist.
- The allowlist filters servers someone configured; it doesn't install anything. Servers from `managedMcpServers`, built-in servers and `managed-mcp.json` entries without `${VAR}` skip the check.
- Source: https://code.claude.com/docs/en/managed-mcp

## What "domain-verified vendor servers" means

This is **not** a list of approved, audited or safe servers. KarmaDue has not reviewed them. Each entry passes four mechanical checks against the official MCP Registry (2026-10-11T15:42:33Z, latest version of each of 41,887 entries, 26,587 with a remote URL):

1. The registry status is active.
2. The namespace is a reverse-DNS domain (`com.stripe/mcp` means stripe.com). The registry only lets a publisher use such a namespace after proving control of the domain by DNS or HTTP. `io.github.*` names (GitHub-account verification, not a domain) are left out: 12,686.
3. The domain is not a subdomain handed out by a shared platform (the private section of the Public Suffix List: vercel.app, netlify.app, workers.dev, github.io and so on), where anyone can get a name: 282 left out.
4. The remote URL is https on port 443 and its host is that domain or a subdomain of it. 576 entries had no remote on their own domain and were left out; 209 were deprecated.

Result: **12,833 servers from 10,719 domains, 13,147 URLs**.

What that proves: whoever published the registry entry controls the domain the endpoint runs on. What it doesn't prove: that the company is who the name suggests, that the tools are safe or do what they say, that the endpoint is up, or that it has no advisories. Domains are cheap, so most entries are small independent publishers, and a few domains are hosting platforms that run servers for other authors (for example `ai.smithery/*` entries run on server.smithery.ai). Use the list as a starting set to cut down, not to deploy as-is. Every entry's registry record is in https://karmadue.expo.app/lists/verified-vendor-allowlist.sources.json.

URLs are copied from the registry. Template variables such as `{tenant}` become `*` (Claude Code, Cursor) or a `[^/]+` regex (Codex).

The list is a snapshot, refreshed when KarmaDue republishes. Summary and counts: https://karmadue.expo.app/lists/verified-vendor-allowlist.json

Pages: [Quick start](https://karmadue.expo.app/docs/mcp.md) · [Use KarmaDue from any agent](https://karmadue.expo.app/docs/any-agent.md) · [Permissions](https://karmadue.expo.app/docs/permissions.md) · [Tool reference](https://karmadue.expo.app/docs/tools.md) · [Security and verification](https://karmadue.expo.app/docs/security.md) · [Changelog](https://karmadue.expo.app/docs/changelog.md). Any HTTP client, no bot checks: the same files under https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/docs/docs/<page>.md

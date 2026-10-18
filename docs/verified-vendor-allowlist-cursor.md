# Verified-vendor allowlist for Cursor (MCP Allowlist)

Files: https://karmadue.expo.app/lists/verified-vendor-allowlist.cursor.txt (one URL per line) and https://karmadue.expo.app/lists/verified-vendor-allowlist.cursor.json (JSON array), 13,147 URLs. Other formats: [Claude Code](https://karmadue.expo.app/docs/verified-vendor-allowlist-claude-code.md), [Codex](https://karmadue.expo.app/docs/verified-vendor-allowlist-codex.md).

## Deploy it

Cursor's MCP Allowlist is an Enterprise feature set in the team dashboard (Team Settings, MCP Configuration). Cursor documents URL entries with `*` wildcards but no file import, so this is a list to choose from and paste: add each server you approve as a URL entry, then set its tool controls.

## What Cursor enforces

- When an allowlist is active, only servers matching an entry can run; others are blocked. A URL entry matches the full configured URL (`https://mcp.acme.com/*` covers every path on that host).
- Approving a server doesn't install it; users still add it, or you publish it through a team marketplace.
- Dashboard settings replace (don't merge with) `~/.cursor/permissions.json` and editor settings.
- `mcpAllowlist` in `~/.cursor/permissions.json` is a different thing: an auto-run list in `server:tool` form. This file is not in that format.
- Local (command) servers need their own command entries; this list has none.
- Source: https://cursor.com/docs/enterprise/model-and-integration-management

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

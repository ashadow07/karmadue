# Verified-vendor allowlist for OpenAI Codex (requirements.toml)

File: https://karmadue.expo.app/lists/verified-vendor-allowlist.codex.toml (12,763 servers). Other formats: [Claude Code](https://karmadue.expo.app/docs/verified-vendor-allowlist-claude-code.md), [Cursor](https://karmadue.expo.app/docs/verified-vendor-allowlist-cursor.md).

    [mcp_servers.com_stripe_mcp]
    identity = { url = "https://mcp.stripe.com" }

## Deploy it

1. Download: `curl -fsS https://karmadue.expo.app/lists/verified-vendor-allowlist.codex.toml -o kd-allow.toml`
2. Keep the tables you want and add your own (stdio servers match on `identity.command`).
3. Merge the `[mcp_servers.*]` tables into the `requirements.toml` you deploy (managed configuration).

## What Codex enforces

- With an `mcp_servers` table present, Codex enables a server only when **both its name and its identity** match an entry. The table key is the registry name with every character other than letters, digits, `_` and `-` turned into `_` (`com.stripe/mcp` becomes `com_stripe_mcp`). Users must name the server that way in config.toml, or rename the keys to the names your team uses.
- An empty `mcp_servers` table disables every server; any server not listed is disabled, including local ones.
- Only streamable-HTTP remotes are included (Codex connects to stdio and streamable HTTP servers), which is why the Codex count can be lower than the server count. URLs match exactly; servers with several URLs or template variables use a full-value regex.
- Source: https://developers.openai.com/codex/enterprise/managed-configuration

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

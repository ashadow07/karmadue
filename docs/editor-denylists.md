# Editor denylists: block MCP servers with published malicious-code reports

KarmaDue publishes the same malicious-package set in every editor format that is documented and enforced by the editor itself. Every entry is an npm or PyPI package with a published malicious-code advisory (OpenSSF malicious-packages, `MAL-` ids in OSV.dev) whose name relates to MCP, agents or AI tooling. The lists are rebuilt from the advisory feed every day.

| Editor | File | Enforced by | Status |
| --- | --- | --- | --- |
| Claude Code | https://karmadue.expo.app/lists/claude-code-denylist.json | managed settings `deniedMcpServers` | Published ([docs](https://karmadue.expo.app/docs/claude-code-denylist.md)) |
| GitHub Copilot: VS Code 1.130+, Copilot CLI, Copilot app, Copilot cloud agent, JetBrains | https://karmadue.expo.app/lists/github-copilot-denylist.json | enterprise managed settings `deniedMcpServers` | Published |
| VS Code | https://karmadue.expo.app/lists/vscode-denylist.json | the same Copilot managed settings (VS Code policy `ChatDeniedMcpServers`) | Published, identical to the GitHub Copilot file |
| Cursor | none | Enterprise allowlist and hooks | Skipped: no denylist format (see below) |
| Windsurf | none | admin allowlist and registry enforcement | Skipped: allowlist only |
| OpenAI Codex | none | `requirements.toml` MCP allowlist | Skipped: allowlist only |
| Gemini CLI | none | `mcp.excluded` by server name | Skipped: names are chosen by the user, so a name list can't block a package |

The advisory behind every entry, with links: https://karmadue.expo.app/lists/github-copilot-denylist.sources.json. The whole package set as data: https://karmadue.expo.app/lists/malicious-packages.json.

## GitHub Copilot and VS Code

### What an entry looks like

    { "serverCommand": ["npx", "-y", "postmark-mcp"] }
    { "serverCommand": ["cmd", "/c", "npx", "-y", "postmark-mcp"] }

GitHub's `serverCommand` matches the exact command and each argument, in order, with no wildcards. So each package is listed in its common launch forms: `npx -y <pkg>`, `npx <pkg>` and `npx -y <pkg>@latest` for npm, `uvx <pkg>` and `pipx run <pkg>` for PyPI. Each form is also listed with the Windows `cmd /c` prefix that GitHub's own examples use. Versions come from the full OSV record (every range event and every listed version). Only the named versions are pinned (for example `npx -y <pkg>@1.0.16`, `uvx <pkg>==1.0.16`), so a later clean release is not blocked, when the report's affected set is closed: each range ends in a fixed or last_affected version, or every source's latest OpenSSF report names versions only, or the registry still serves the package with a current release the report does not name (a compromised release of a live package). Every version is blocked when a range is open-ended (introduced with no end, the usual shape of a typosquat report), when nothing narrower is stated, or when more than 50 versions are named.

### Deploy it (enterprise owners)

1. Download: `curl -fsS https://karmadue.expo.app/lists/github-copilot-denylist.json -o kd-denylist.json`
2. Merge it into your enterprise's `managed-settings.json` instead of overwriting the file: `jq -s '.[0] * {deniedMcpServers: ((.[0].deniedMcpServers // []) + .[1].deniedMcpServers | unique)}' managed-settings.json kd-denylist.json > merged.json`. Validate the result with `jq empty merged.json`. **A malformed file makes Copilot clients block every MCP server except the built-in ones**, per GitHub's evaluation rules.
3. Deliver it with any of GitHub's documented methods. Denylists from different sources are combined, so a server blocked by any source is blocked:
   - Server-managed (the default): commit it as `copilot/managed-settings.json` in your enterprise's `.github-private` repository, on the default branch. Clients pick it up within about an hour, or right away after a restart or new sign-in. This applies to users who get their Copilot license from your enterprise, including Copilot cloud agent.
   - File-based: `/Library/Application Support/GitHubCopilot/managed-settings.json` (macOS), `%ProgramFiles%\GitHubCopilot\managed-settings.json` (Windows), `/etc/github-copilot/managed-settings.json` (Linux). For Copilot CLI on macOS and Linux the file must be a regular file owned by root and not group- or world-writable.
   - MDM: the key `deniedMcpServers` with the array stored as JSON text in a string value (Windows `HKEY_LOCAL_MACHINE\SOFTWARE\Policies\GitHubCopilot`, macOS `com.github.copilot`). The list is about 1 MB, so the repository or file method is easier.
4. Check it on one machine: add a listed server (for example `npx -y <a listed package>`) to `mcp.json` and confirm the client shows it as blocked by policy. In VS Code, `Developer: Sync Account Policy` forces a refresh.
5. Refresh daily, for example with a scheduled job that repeats steps 1 to 3 and opens a pull request in `.github-private`.

GitHub's references: [Enterprise managed settings](https://docs.github.com/en/copilot/reference/enterprise-administrators/enterprise-managed-settings#deniedmcpservers), [Configuring an MCP server allowlist](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-mcp-usage/configure-enterprise-allowlist), [Deployment methods](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-enterprise/use-managed-settings/deploy-managed-settings). In VS Code the setting is `chat.mcp.deniedServers` (policy `ChatDeniedMcpServers`, VS Code 1.130 and later). It isn't in VS Code's ADMX templates, so deliver it through Copilot managed settings. GitHub's supported-keys table lists which Copilot clients read each key; check it for the clients you run.

### What it does and doesn't enforce

- Matching is exact. A launch form that isn't listed is not blocked: another runner such as `bunx` or `pnpm dlx`, extra flags, a version pin not in the list, a local path or a Docker image. To actually enforce a policy, pair the denylist with an allowlist (`allowedMcpServers`). A deny entry always wins over an allow entry.
- It covers MCP servers that Copilot clients start. It doesn't stop `npm install` or `pip install` of the same package in a terminal or a build. The [KarmaDue GitHub Action](https://karmadue.expo.app/docs/feeds.md#github-action) checks pull requests for that.
- Other extensions that start their own MCP servers aren't covered by Copilot policy.
- The custom-registry restriction is a different mechanism. GitHub says it is weaker: it matches by name or ID only, and users can get around it by editing configuration files. The managed-settings denylist matches the actual command.
- Only published malicious-code reports are listed: no vulnerabilities, no scores, no KarmaDue judgment. A package that isn't on the list is not endorsed by being absent.

## Editors without an enforceable denylist

- **Cursor.** Enterprise admins approve servers in the dashboard under MCP Configuration (an allowlist entered there, with no import file), and can set a network denylist for user MCP servers. Cursor also runs Enterprise hooks (`beforeMCPExecution`, with `/etc/cursor/hooks.json` and equivalents) that can deny a tool call. But a hook runs when a tool is called, after the server process (and any install script it ran) has already started. Cursor's docs also warn that the `command` string a hook sees varies between installs. That would not stop a malicious package, so KarmaDue doesn't ship one. Use Cursor's allowlist.
- **Windsurf.** Admins can allowlist servers (anchored regex on the command and each argument) and enforce MCP registries. Once one server is allowlisted, everything else is blocked. There is no denylist.
- **OpenAI Codex.** `requirements.toml` `[mcp_servers]` is an allowlist keyed by server name plus identity. There is no deny form.
- **Gemini CLI.** `mcp.excluded` in system settings matches the server's name, which the user picks, so it can't reliably block a package. Use `mcp.allowed`.
- Other editors (Zed, Cline, Continue and others) were not checked for this release.

Requesting a list for an editor without an enforceable format (for example `/lists/cursor-denylist.json`) returns HTTP 404 with the reason.

Pages: [Quick start](https://karmadue.expo.app/docs/mcp.md) · [Use KarmaDue from any agent](https://karmadue.expo.app/docs/any-agent.md) · [Permissions](https://karmadue.expo.app/docs/permissions.md) · [Tool reference](https://karmadue.expo.app/docs/tools.md) · [Security and verification](https://karmadue.expo.app/docs/security.md) · [Changelog](https://karmadue.expo.app/docs/changelog.md). Any HTTP client, no bot checks: the same files under https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/docs/docs/<page>.md

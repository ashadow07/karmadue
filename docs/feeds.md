# Feeds: changed since you installed

KarmaDue publishes what changed in the last 30 days for the tools and packages in its catalog. Each entry has before and after values and links to evidence.

- https://karmadue.expo.app/feeds/changes.json (also `.rss` for RSS 2.0 and `.atom` for Atom)
- https://karmadue.expo.app/feeds/changes.json?ids=a,b,c lists only your tools. Ids can be `kd:res:<id>`, `github.com/<owner>/<repo>` or `<owner>/<repo>`, `npm:<name>` or `pypi:<name>`, up to 200, comma-separated. The `filter` block says which ids matched and which are unknown. `ids` works on `.rss` and `.atom` too, and `days=1..30` narrows the window.
- https://karmadue.expo.app/feeds/malicious.json lists new malicious-package reports for npm and PyPI agent, MCP and AI tooling packages, whether or not KarmaDue lists the package.
- https://karmadue.expo.app/lists/malicious-packages.json is every package with a malicious-code report (the set behind the editor denylists).
- The same data from the API: `https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/feeds/v1/feeds/changes.json` and so on. `GET .../feeds/v1` lists the routes.

## Entry types

| type | before / after | source |
| --- | --- | --- |
| owner_changed | GitHub owner, or npm/PyPI maintainers where the registry lists them (this is how publisher changes show up) | daily watch snapshot |
| license_changed | license id | daily watch snapshot |
| tool_list_changed | hash of a public remote MCP server's `tools/list` | daily watch snapshot |
| archived_upstream | archived flag | daily watch snapshot |
| terms_changed, description_changed | hash or text | daily watch snapshot |
| new_advisory | `none on record` → advisory id, severity, fixed versions, and whether it affects the version KarmaDue lists | OSV.dev, dated by OSV's published date |
| malicious_report | `none on record` → MAL id and versions | OpenSSF malicious-packages via OSV.dev |

Each entry has `id`, `type`, `at`, `summary`, `subject` (the catalog tool and its passport), `package` where relevant, `before`, `after`, `evidence` (links) and `source`.

## How thin the data is (read this)

- Snapshots of watched tools started on **2026-10-11**. A change can only show once a tool has two snapshots, so in the first days the owner, license, tool-list and archive sections are empty because there is nothing to compare yet, not because nothing changed. The `coverage` block gives the live numbers: watched tools, the first snapshot time, and how many tools have two snapshots.
- About 200 tools are snapshotted daily. Advisories cover the catalog tools whose npm or PyPI packages are mapped (several thousand).
- `affects_listed_version` is true when the advisory lists the version KarmaDue shows, and false when it lists a complete set of versions without it. It is left out when the stored data can't tell: the advisory gives ranges only, or its version list may be incomplete.
- Nothing here is a safety verdict. An entry is a fact with a source, and a tool with no entries is not certified.

## Watchlist agents

`watchlist_changes` (MCP, signed read) returns the same kinds of change for the tools on your own watchlist, plus the finding sent to your person and their choice. To follow tools without registering, subscribe to `/feeds/changes.rss?ids=...` with the same ids you would put in `set_watchlist`.

<a id="github-action"></a>
## GitHub Action

[ashadow07/karmadue-action](https://github.com/ashadow07/karmadue-action) checks the packages and MCP servers a pull request adds or changes: `package.json` and lockfiles, `requirements*.txt`, `pyproject.toml`, `poetry.lock`, `uv.lock`, `.mcp.json`, `.cursor/mcp.json` and `.vscode/mcp.json`. It fails on a malicious-code report, warns (or fails, if you configure it) on an advisory that covers the exact version, warns when KarmaDue recorded an owner, license or tool-list change in the last 30 days, and writes a job summary with evidence links. It needs no token. Its only network calls are the lookups to `POST /v1/packages/check`. That endpoint answers from KarmaDue's data plus an exact-version OSV.dev query made server-side; send `osv: false` to skip it.

Pages: [Quick start](https://karmadue.expo.app/docs/mcp.md) · [Use KarmaDue from any agent](https://karmadue.expo.app/docs/any-agent.md) · [Permissions](https://karmadue.expo.app/docs/permissions.md) · [Tool reference](https://karmadue.expo.app/docs/tools.md) · [Security and verification](https://karmadue.expo.app/docs/security.md) · [Changelog](https://karmadue.expo.app/docs/changelog.md). Any HTTP client, no bot checks: the same files under https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/docs/docs/<page>.md

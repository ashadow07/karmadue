# Cooldown pack: make "latest" mean at least 7 days old

One setting per package manager so installs skip versions published in the last 7 days. Each option name and the version that introduced it were checked against the tool's official docs or changelog on 2026-10-11. All files: https://karmadue.expo.app/lists/cooldown/ (index: https://karmadue.expo.app/lists/cooldown/index.json).

| Tool | Option | File | Unit | Introduced |
| --- | --- | --- | --- | --- |
| npm | `min-release-age` | .npmrc | days | npm 11.10.0 (2026-02-11) |
| pnpm | `minimumReleaseAge` | pnpm-workspace.yaml | minutes | pnpm 10.16.0 |
| Yarn (Berry) | `npmMinimalAgeGate` | .yarnrc.yml | minutes (a bare number); current docs also show duration strings such as "1w" | Yarn 4.10.0 |
| Bun | `install.minimumReleaseAge` | bunfig.toml | seconds | Bun 1.3 |
| uv | `exclude-newer` | uv.toml (or [tool.uv] in pyproject.toml) | RFC 3339 timestamp, friendly duration ("7 days") or ISO 8601 duration (P7D) | exclude-newer with absolute timestamps since early uv; relative durations since uv 0.9.17 |
| pip | `--uploaded-prior-to` | pip.conf / pip.ini | datetime, or an ISO 8601 duration in days (P7D) from pip 26.1 | pip 26.0 (absolute datetimes); pip 26.1 (2026-04-26) accepts a duration in days such as P7D |

## npm

File: .npmrc. Download: https://karmadue.expo.app/lists/cooldown/npmrc

    min-release-age=7

Command line: `npm install --min-release-age=7`

Environment: `npm_config_min_release_age=7`

Introduced: npm 11.10.0 (2026-02-11). Unit: days.

- Only versions published more than the given number of days ago are installed; if none qualify, the command errors.
- Complements --before (an exact date). min-release-age-exclude (added later in npm 11) exempts named packages.
- When the cutoff blocks a fix that npm audit fix would install, npm keeps the vulnerable version, warns, and exits non-zero.

Source: https://docs.npmjs.com/cli/v11/using-npm/config#min-release-age; https://github.com/npm/cli/blob/latest/CHANGELOG.md (11.10.0: add min-release-age, #8965)

## pnpm

File: pnpm-workspace.yaml. Download: https://karmadue.expo.app/lists/cooldown/pnpm-workspace.yaml

    minimumReleaseAge: 10080

Introduced: pnpm 10.16.0. Unit: minutes. Default is 1440 (1 day) since pnpm 11, 0 before.

- Applies to all dependencies, including transitive ones.
- minimumReleaseAgeExclude exempts named packages.

Source: https://pnpm.io/settings#minimumreleaseage

## Yarn (Berry)

File: .yarnrc.yml. Download: https://karmadue.expo.app/lists/cooldown/yarnrc.yml

    npmMinimalAgeGate: 10080

Introduced: Yarn 4.10.0. Unit: minutes (a bare number); current docs also show duration strings such as "1w". Yarn 4.15.0 made 1d the default.

- A bare number is minutes and works from 4.10.0. Newer releases accept duration strings (the docs example is "1w"); use 10080 if you support older 4.x.
- npmPreapprovedPackages exempts named packages. Yarn 4.17.0 allows a per-scope gate under npmScopes.
- npmMinimalAgeGate is a Yarn Berry (2+) setting; Yarn 1 (classic) does not read it.

Source: https://yarnpkg.com/configuration/yarnrc#npmMinimalAgeGate; https://github.com/yarnpkg/berry/releases/tag/%40yarnpkg%2Fcli%2F4.10.0

## Bun

File: bunfig.toml. Download: https://karmadue.expo.app/lists/cooldown/bunfig.toml

    [install]
    minimumReleaseAge = 604800

Introduced: Bun 1.3. Unit: seconds.

- Two lines in TOML: the key lives under [install]. 604800 seconds = 7 days.
- minimumReleaseAgeExcludes exempts named packages.

Source: https://bun.com/docs/runtime/bunfig#install-minimumreleaseage; https://bun.com/blog/bun-v1.3

## uv

File: uv.toml (or [tool.uv] in pyproject.toml). Download: https://karmadue.expo.app/lists/cooldown/uv.toml

    exclude-newer = "7 days"

Command line: `uv pip install --exclude-newer "7 days" <pkg>`

Environment: `UV_EXCLUDE_NEWER="7 days"`

Introduced: exclude-newer with absolute timestamps since early uv; relative durations since uv 0.9.17. Unit: RFC 3339 timestamp, friendly duration ("7 days") or ISO 8601 duration (P7D).

- Compares the upload time of each file, not the release date of the version.
- exclude-newer-package sets a per-package cutoff. Calendar units (months, years) are rejected.

Source: https://docs.astral.sh/uv/reference/settings/#exclude-newer

## pip

File: pip.conf / pip.ini. Download: https://karmadue.expo.app/lists/cooldown/pip.conf

    [install]
    uploaded-prior-to = P7D

Command line: `pip install --uploaded-prior-to P7D <pkg>`

Environment: `PIP_UPLOADED_PRIOR_TO=P7D`

Introduced: pip 26.0 (absolute datetimes); pip 26.1 (2026-04-26) accepts a duration in days such as P7D. Unit: datetime, or an ISO 8601 duration in days (P7D) from pip 26.1.

- Works only when the index publishes upload-time (PyPI does). Other indexes may not filter at all.
- pip 26.0 needs an absolute datetime; on 26.0 compute the date yourself, for example --uploaded-prior-to "$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)" (GNU date).
- Since pip 26.x, pip list --outdated and --uptodate respect it too.

Source: https://pip.pypa.io/en/stable/news/ (26.0: add --uploaded-prior-to, #13625; 26.1: durations, #13674); https://pip.pypa.io/en/stable/cli/pip_install/

## What a cooldown does and doesn't do

- These settings filter which versions a resolver will pick. They don't remove, audit or re-check versions already pinned in your lockfile.
- A cooldown delays fresh compromised releases (pnpm's docs note most malicious releases are found and removed within an hour). It does nothing about an old malicious package or a known vulnerability; pair it with the denylists and advisories.
- Seven days also delays security fixes. Every tool above has an exclude list for packages you need to take at once.

Pages: [Quick start](https://karmadue.expo.app/docs/mcp.md) · [Use KarmaDue from any agent](https://karmadue.expo.app/docs/any-agent.md) · [Permissions](https://karmadue.expo.app/docs/permissions.md) · [Tool reference](https://karmadue.expo.app/docs/tools.md) · [Security and verification](https://karmadue.expo.app/docs/security.md) · [Changelog](https://karmadue.expo.app/docs/changelog.md). Any HTTP client, no bot checks: the same files under https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/docs/docs/<page>.md

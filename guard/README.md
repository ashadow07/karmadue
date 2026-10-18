# karmadue-guard (PinTree guard)

PinTree returns known hazards and tested setup recipes, showing where the evidence applies, and where it is missing. Every fix cites a tested record; other answers name their source.

The guard sits where installs happen: in front of `npm npx pnpm pnpx yarn pip pip3 uv uvx`. It works for any agent or person that runs shell commands. No account, no dependencies.

## Start

```sh
npx karmadue-guard check "npx tailwindcss init -p"   # check one command: exit 0 go, 1 blocked, 2 needs your person's OK
npx karmadue-guard install-shims                     # guard every install: writes shims to ~/.karmadue/shims
export PATH="$HOME/.karmadue/shims:$PATH"            # add to ~/.bashrc or ~/.zshrc
```

From Python: `pipx run karmadue-guard check "pip install sklearn"` (or `pipx install karmadue-guard`). The PyPI package is a thin wrapper around the same Node CLI, so **Node.js 18+ must be on PATH**.

## What you see

| Answer | Guard |
| --- | --- |
| clean | one line, about 13 tokens: `pintree ok express@4.21.2` |
| known trap | `do:`, `don't:` (what failed, under which setup), `test (printed, not run):`, and the record it comes from. Name traps such as `pip install sklearn` or `npx shadcn-ui` are blocked locally (exit 1) |
| `block` (malicious-package report, refusal) | not run, exit 1 |
| `require_human_approval` | **paused**, not run, exit 2. In a terminal it asks y/N. Agents: show your person the line, then rerun with `KARMADUE_APPROVED=1` |
| warning (deprecated, very new release, medium advisories) | printed, then the command runs |
| hijack signal (0.4.0, see below) | `pintree WARN x@1.2.3: lost provenance (1.2.2 had it)` or `publisher a -> b`: printed, runs. Both together on a release under 30 days old: `pintree HIJACK RISK`, **paused** (exit 2) |
| release under 72 h old (0.4.0) | one soft line after the ok line: `pintree new (<72h, usually normal): x@1.2.3(5h)`. Never a warning, never a pause |
| no evidence | runs and says so. Missing evidence is not safety clearance. `KARMADUE_STRICT=1` blocks |
| PinTree unreachable | cached answer (up to 30 days, marked) or a loud NOT CHECKED line, then runs. `KARMADUE_STRICT=1` blocks |

`--detail` (or `KARMADUE_DETAIL=1`) prints the full answer. The guard **never runs** a command it got from a record or the server: test lines are printed for you to read.

## Hijacked-package signals (0.4.0)

For a named public package the guard compares the version you are installing (an exact pin, or the newest stable one when you give no version; ranges and tags such as `^1` or `next` are not judged) with the release published just before it, using **public registry metadata only**:

| Signal | npm | PyPI |
| --- | --- | --- |
| lost provenance: the previous release had it, this one does not | `dist.attestations.provenance` or a trusted publisher in `_npmUser` | PEP 740 attestations listed on the simple index |
| publisher changed | `_npmUser` differs, or a maintainer was added | **not available** (PyPI metadata does not say who published a release) |
| published within 72 h | `time` | `upload-time` |

Levels: lost provenance **and** publisher changed on a release under 30 days old is `HIJACK RISK` (the only signal that pauses; `KARMADUE_PROVENANCE=warn` keeps the line but never pauses). One of the two is a `WARN` (runs). A release under 72 hours old and nothing else is a single soft note. PyPI can only reach `WARN`, because it has no publisher data.

How it works: one GET per public package (`registry.npmjs.org/<name>` or `pypi.org/simple/<name>/`), in parallel with the KarmaDue check, kept 3 hours in `~/.karmadue/cache/provenance-v1.json` (only a short summary of the 12 newest versions plus `latest`). On a cold cache it adds roughly 0.3 s for a 7 MB packument such as `react`; a cached run stays under 50 ms. If the registry is slow, unreachable or the packument is over 25 MB, you get no signal and no error: this check never blocks an install by failing. No lockfile is read. Private scopes and custom registries or indexes are never looked up (the same rule as everything else). `KARMADUE_PROVENANCE=off` makes no registry request at all.

**False positives are normal. Read the line, do not obey it blindly.**
- A new release inside 72 hours is how every healthy package ships. That is why it is a soft note.
- Publisher changes are common and usually harmless. Real examples from the tests: `express@5.1.0` shows `publisher jonchurch -> wesleytodd` (a maintainer rotation), and the current `typescript` shows `typescript-bot -> microsoft1es`.
- Many legitimate packages never had provenance, and some maintainers move between CI and a laptop. Lost provenance alone is a hint, not proof.
- Misses are also normal: an attacker who publishes through the legitimate trusted-publisher workflow (the SlugFest class of attack in the GitHub/Bloom Security report) keeps provenance and the publisher, so none of these signals fires. A version the registry has since removed cannot be seen (axios 1.14.1 is blocked by KarmaDue's malware report, not by these signals). Provenance proves where a release was built, not that the code is safe.
- The "previous release" is the one published just before, by time, so back-ported patch releases can look like a publisher change.

## What is not covered

- Installs from a manifest or lockfile (`npm install` / `npm ci` with no names, `pip install -r`, `-c`, `-e`, `uv sync`). The guard says so when it sees them.
- Transitive dependencies, except known-trap rules. Today there is one: `passlib` without `bcrypt<5` is flagged before the install, and after the install the guard reads the bcrypt version that actually resolved.
- git, URL and local-path installs. Windows shims (WSL works).

## Privacy

- Private packages are never sent: scopes with their own registry in `.npmrc` (`@acme:registry=...`), `KARMADUE_PRIVATE_SCOPES=@acme,@corp`, any custom npm registry (`--registry`, `npm_config_registry`, `.npmrc registry=`) and any custom pip/uv index (`-i`, `--index-url`, `--extra-index-url`, `PIP_INDEX_URL`, `UV_INDEX_URL`...). Those commands are not checked and the guard says why.
- The guard never reads lockfiles or sibling projects.
- Leaves (pass/fail reports after an install) are **off** unless you set `KARMADUE_LEAVES=1` or pass `--leaves`. They carry only public package names, pass/fail, exit code, OS/arch/runtime major, the command shape, one scrubbed error line and a hashed random install id. `KARMADUE_LEAVES_DRYRUN=1` shows a leaf instead of sending it. The server keeps leaves pending until at least 3 installs on 2 or more networks agree, or a sandbox rerun does.

- **Registry lookups (0.4.0).** For public packages the guard now also contacts `registry.npmjs.org` or `pypi.org` directly with the package name (what your install does anyway). Nothing else is sent, and private scopes, custom registries and custom indexes are never looked up. Turn it off with `KARMADUE_PROVENANCE=off`. The local log only gets the signal level (`prov`: `strong`, `warn` or `note`), never a registry URL.
- **Local check log (0.3.0), never uploaded.** Each check appends one line to `~/.karmadue/guard-log.jsonl` (mode 600): time, ecosystem, package, version, verdict class (`clean`, `fix_first`, `approval`, `block`, `warn`, `unknown`, `unchecked`), cache (`hit`, `revalidated`, `offline`, `miss`), milliseconds, and, when the guard ran the install, a separate line with the exit code. Private-scope packages and anything under a custom registry or index are counted as `{private: true}` with no name, no URL and no hash. Commands, flags, paths and URLs are never written. Nothing is sent over the network for the log. `KARMADUE_NO_LOG=1` turns it off; `karmadue-guard log-clear` deletes it; the file rolls over at 5 MB.

## Settings

| Variable | Effect |
| --- | --- |
| `KARMADUE_STRICT=1` | block when there is no evidence, the name may not exist, or no usable answer |
| `KARMADUE_WARN=block` | block on warnings too |
| `KARMADUE_TRAPS=warn` | never block on a trap, only print it |
| `KARMADUE_APPROVED=1` | your person approved: run a paused command |
| `KARMADUE_ALLOW=name,name@1.2.3` | skip these (printed) |
| `KARMADUE_DISABLE=1` | run without a check (printed) |
| `KARMADUE_QUIET=1` | no line for clean packages |
| `KARMADUE_NO_LOG=1` | do not write the local check log |
| `KARMADUE_PROVENANCE=off\|warn\|ask` | 0.4.0 hijack signals: `off` = no registry request, `warn` = never pause, `ask` (default) = pause only on `HIJACK RISK`. `KARMADUE_PROV_TIMEOUT_MS` (4000) sets the registry timeout |
| `KARMADUE_NO_CACHE=1`, `karmadue-guard cache-clear` | skip or clear the answer cache (`~/.karmadue/cache`: 24 h clean, 6 h warnings, 1 h unknown) |
| `KARMADUE_API`, `KARMADUE_TIMEOUT_MS` | API base and timeout (8000 ms) |

## Commands

```sh
karmadue-guard check "pip install jinja2==2.11.2"
karmadue-guard exec npm install left-pad      # what each shim runs
karmadue-guard install-shims [DIR]
karmadue-guard init [--aliases] [--fish]
karmadue-guard cache-clear
karmadue-guard stats [--json] [--days N] [--path]   # counts, cache hit rate, avg ms, install exit codes (local log only)
karmadue-guard log-clear
```

Two npm/pip settings that limit damage (not checks; the guard does not set them): `npm config set ignore-scripts true`, and `PIP_ONLY_BINARY=:all:` (uv: `UV_NO_BUILD=1`).

Trap records: founder-operated assessments, not independent. 0.4.0, 2026-10-15. MIT.

## Our own releases

`karmadue-guard` 0.3.0 and earlier were published from a the build box with a token. They have **no npm provenance and no PyPI attestations**, so by the logic above they could not be told apart from a hijacked release by these signals, and the guard would not flag a future release of its own that also lacks provenance. Verify a release with its sha256 (listed in the release notes) until that changes. Publishing with provenance needs a public source repository and a trusted-publisher setup done by the maintainer; this is not done yet.

# Changelog: karmadue-preinstall.js

## 1.1.0 (2026-10-11)
**Fix: the hook was silent on every package.** KarmaDue's `POST /v1/preflight` now answers with `data.decision`, `data.enforce`, `data.headline`, `data.reasons`, `data.evidence` and `data.alternatives`. 1.0.0 only read `data.install_decision`, which is gone, so every reply counted as "nothing found". That covered malicious versions (event-stream@3.3.6, postmark-mcp@1.0.18) and versions with advisories (jinja2==2.11.2). The bundled tests didn't catch it because they replayed responses captured before the change.
- Reads the current format. `deny` or `enforce: block` → deny. `warn`, `unverified_existence` or `require_human_approval` → warn. `allow`, `no_known_issues` or `unknown` → quiet. Advisory IDs come from `evidence[].ref`, and alternatives from `{name, why, ref}`.
- Still reads the v1 format (`data.install_decision`).
- **An unreadable reply is never silent.** Non-JSON, `ok: false`, a missing `data`, or an unknown decision or enforce value produces a warning ("check NOT done … hook may be out of date"). Under `KARMADUE_STRICT=1` it denies.
- Unchecked packages (network errors) are now listed even when another package in the same command was flagged. A hook crash now shows a `systemMessage` (fail-open) instead of only writing to stderr.
- User-Agent now carries the version: `karmadue-preinstall-hook/1.1.0`.
- Tests: the replay-only fixtures were replaced. `test/capture.js` re-captures live replies into `fixtures/preflight-responses.json`. `test/run.js` covers the current format, the v1 format (`preflight-responses-legacy.json`) and 5 format-drift cases. `node test/run.js --live --ci` is the live contract: block, block, warn, allow. A GitHub Actions workflow (`integrations/.github/workflows/claude-code-hook-live.yml`) runs it on changes and every 6 hours.

## 1.0.0 (2026-10-11)
First release.

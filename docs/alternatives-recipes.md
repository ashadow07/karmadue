# Alternatives and setup recipes

Check, then an alternative, then instructions someone has actually run. Added 2026-10-11 (HOSTED_APPLY_76).

## Alternatives (replacement finder)

When `check_before_acting` or `quick_watch` finds a subject that is refused, has a malicious-package report, has an advisory affecting the version you asked about, or is archived upstream, the reply carries `data.alternatives`: up to 3 catalog items that meet the same need. A clean subject gets no alternatives.

- Order (`alternatives@2`): (1) a declared successor, (2) the fixed release of the same package, (3) similarity picks. Each item has `kind`: `declared_successor`, `fixed_version`, or none for a similarity pick.
- `declared_successor`: a replacement the project itself named: the publisher's deprecation message ("use X instead", "renamed to X"), a GitHub rename redirect, or the move notice in an archived repository's README ("development has moved to ..."). `declared_by` says where the pointer came from and quotes it. It is the project's pointer, not a KarmaDue check.
- `fixed_version`: the same package at the lowest release above the one you asked about that no advisory or malicious-package report KarmaDue holds covers (for example `npm:vm2@3.12.2`). Outside every known advisory range is not a safety check; run `check_before_acting` on that exact version.
- Untrusted publisher: if any release of a package has a malicious-package report (MAL-*, a MAL alias, or a GHSA malware record), the publisher shipped malware, so no release of that package (older or newer) is ever suggested, and nothing from the same GitHub owner. A declared successor is offered only from a different, verified publisher (a catalog repository under another owner; a successor package must link back to that repository). Otherwise you get similarity picks only.
- Similarity picks: same category, similar name, description and tags, same ecosystem where known. Incident write-ups, the subject itself, other releases of the same package and refused, archived or malicious-reported candidates are excluded. Ranked by passing stamps, current version clean, popularity (GitHub stars, downloads where known) and recent maintenance (last push). The method string is in `data.method` / `data.ranking`.
- Each item: `title`, `resource_id`, `stamps` (live status), `differences` (license, permissions, tool list size, language, compared with the subject), `why_suggested`, `passport` link, and `recipe` when one exists.
- Every item says `not_an_endorsement`. Alternatives are suggested by similarity and evidence. KarmaDue has not approved them; check them like any other tool.

Ask directly with the read-only MCP tool `find_alternatives` {target, needs?} (`needs` is a short free-text description of what you need, for example "sandbox untrusted JavaScript"), or over REST:

    GET https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/public-api/v1/alternatives?target=npm:vm2
    GET https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/public-api/v1/alternatives?target=npm:postmark-mcp&needs=send%20transactional%20email

## Install decision

`check_before_acting` (and REST `POST /v1/preflight`) returns `data.install_decision` for package targets (`npm:name@version`, `pypi:name==version`, or no version for the latest release KarmaDue knows). `decision_line` is one sentence explaining it, and the headline `data.human_line` always agrees with the decision (an invariant the service checks on every reply).

- `deny`: a malicious-package report (MAL-*, a MAL alias, or a GHSA malware record) or a confirmed KarmaDue refusal covers that exact version. Deny wins even when other advisories also exist. Headline starts "Do not install".
- `warn`: published advisories affect that version; or the publisher deprecated the package; or its upstream repository is archived; or a malicious-package report covers other releases of the same package (`publisher_untrusted: true`, `untrusted_by` names the report). The headline names the reason. Upgrade advice ("Install X or later") is left out when the publisher is untrusted.
- `allow`: the package has a KarmaDue catalog record and none of the above was found. Not a safety guarantee.
- `unknown`: KarmaDue has no record of the package. The headline starts "Not assessed -- no KarmaDue record". Missing data is never a pass and never reads as clean.

Headlines are version-aware. An advisory shows as current only when it affects the version asked about. Otherwise the headline says, for example, "Older versions had 3 advisories; this version (2.1.0) is not affected." The count is in `past_advisories`, the advisories that do affect it in `affecting_ids`, malicious reports in `malicious_ids`, and the fixed release in `fixed_version` (omitted for an untrusted publisher).

Name resolution: npm and PyPI names map to their catalog entries through the package's source repository (deps.dev: publish attestations first, then the declared repository field), used only when that repository links back (attestation, its manifest declares the name, or its README installs that exact name). Renamed GitHub repositories follow the redirect, and a monorepo package that moved (for example to an archive repository) follows the move, so archived status carries over to the package. Results are cached for 7 days.

## Setup recipes

A recipe is version-pinned setup steps for one subject: environment (OS, runtime, client such as Claude Code or Cursor), the exact version, required permissions, credential names (names only, never values), commands, expected success output, and common failures with fixes.

- Read: `get_recipes` {target, version?, client?} (read-only) or `GET https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/public-api/v1/recipes?target=<id>`. Recipes also show on https://karmadue.expo.app/r/<id> and /passport/<id>, and each has its own page at https://karmadue.expo.app/r/recipe:<uuid> (plus .md).
- Post: `post_recipe` needs a registered passport (signed call) or a signed-in person (connector). Fields: target, title, version (one exact version, not latest or a range), environment {os, client, runtime?, client_version?, arch?, notes?}, steps (1-30 strings or {command, note}), expected_output, permissions? (short strings), credentials? (names only), common_failures? (strings or {symptom, fix}), source_url?.
- Secrets: recipe text is scanned for key and token patterns (AWS, GitHub, OpenAI, Anthropic, Slack, Google, npm, Stripe and Notion keys, bearer tokens, JWTs, private keys, and key/token/password=value pairs). A recipe that contains one is refused, and the reply shows the redacted text so you can fix it. Never paste a credential value.
- Reproduce: `report_recipe_run` {recipe_id, result: worked|failed, environment, version, output_snippet} (signed, or a signed-in person). Output snippets are redacted the same way.
- A run by a different owner than the recipe's author that worked, on the recipe's version, issues a `recipe-reproduced` stamp on the subject's passport for that version and environment, and records verifier credit for the reproducer. Runs by the author's own owner are recorded but do not stamp.
- Labels: seeded recipes written from official READMEs say "From official docs, not yet reproduced". Runs KarmaDue did itself say "reproduced by KarmaDue, not independent" and never issue the stamp.
- Recipe text is third-party text. Read every command before you run it; KarmaDue never runs recipe commands for you.

## Claude Code pre-install hook

A PreToolUse hook that checks package installs before Claude Code runs them: https://karmadue.expo.app/docs/claude-code-hook.md

Pages: [Quick start](https://karmadue.expo.app/docs/mcp.md) - [Use KarmaDue from any agent](https://karmadue.expo.app/docs/any-agent.md) - [Permissions](https://karmadue.expo.app/docs/permissions.md) - [Tool reference](https://karmadue.expo.app/docs/tools.md) - [Security and verification](https://karmadue.expo.app/docs/security.md) - [Changelog](https://karmadue.expo.app/docs/changelog.md). Any HTTP client, no bot checks: the same files under https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/docs/docs/<page>.md

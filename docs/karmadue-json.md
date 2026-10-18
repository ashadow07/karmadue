# karmadue.json v0: publisher manifest

A small JSON file in which a publisher declares what its agent, repo, service or model is and does. KarmaDue reads it, checks it against the schema, checks the declared domain, and links the subject to its signed passport. **The file holds the publisher's own declarations. KarmaDue never writes scores, ratings or verdicts into it, and a valid file does not mean the claims are true.**

- Schema (JSON Schema 2020-12): https://karmadue.expo.app/schema/karmadue.v0.json
- Validate: MCP tool `check_manifest`, or `POST https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/public-api/v1/manifest/validate`
- Example (KarmaDue's own): https://karmadue.expo.app/.well-known/karmadue.json, passport https://karmadue.expo.app/passport/kd:res:service:karmadue

## Where to put it

1. Repository root: `karmadue.json` (or `.well-known/karmadue.json` in the repo). KarmaDue reads it at the exact HEAD commit and records that commit.
2. Or on your domain: `https://<domain>/.well-known/karmadue.json`.

## Fields

| Field | Required | What it is |
|---|---|---|
| `karmadue` | yes | Spec version, `"0"`. |
| `$schema` | no | `https://karmadue.expo.app/schema/karmadue.v0.json` |
| `subject.type` | yes | `agent`, `repo`, `service` or `model`. |
| `subject.name` | yes | Name. |
| `subject.version` | no | Version you are declaring for. |
| `subject.repository` | no | https URL of the source repository. If the KarmaDue listing knows a different repository, the manifest is refused (`subject_mismatch`). |
| `subject.homepage` | no | https URL. |
| `publisher.name` | yes | Who publishes it. |
| `publisher.domain` | no | Bare domain you control, e.g. `example.com`. Checked for the publisher-domain-verified stamp. |
| `publisher.securityContact` | no (recommended) | An https security page or `/.well-known/security.txt` URL. **Not an email address**; email addresses are refused. |
| `capabilities.tools` | no | Tool names, or `{name, description}`. |
| `capabilities.permissions` | no | What it can touch, e.g. `read:repo`, `write:issues`, `send:email`. Expected from L2 up. |
| `capabilities.network` | no | `{access: none / allowlist / any, domains: [...]}` |
| `capabilities.filesystem` | no | `{access: none / read / read-write, paths: [...]}` |
| `capabilities.payments` | no | `{access: none / request / autonomous, maxUsdPerDay}` |
| `capabilities.autonomyLevel` | no | `L0`-`L4` (below). |
| `capabilities.humanApprovalRequiredFor` | no | Actions that wait for a person. Expected from L3 up. |
| `policies.security`, `policies.privacy` | no | https URLs. |
| `policies.retention` | no | How long user data is kept, in words or a URL. |
| `policies.trainsOnUserData` | no | `true` or `false`. |
| `passport` | no | Link to your KarmaDue passport (`https://karmadue.expo.app/passport/<id>`). |

Anything else is refused (`additionalProperties: false`), including any score, rating, "verified" or "approved" field.

## Autonomy levels

| Level | Meaning |
|---|---|
| L0 | Suggests only; a person carries out every action. |
| L1 | Acts only after a person approves each action. |
| L2 | Reads and takes reversible steps alone; asks before writes, spending or anything irreversible. |
| L3 | Writes alone within declared permissions; asks before payments and irreversible actions. |
| L4 | Acts alone, including payments, within declared limits. |

Each level is expected to carry certain stamps and declarations (for example, L3 and above: advisory-clean, publisher-domain-verified, and declared permissions). The table is at https://karmadue.expo.app/standards#autonomy. Passports show, for example, "Declared L3; missing publisher-domain-verified, declared permissions." **KarmaDue does not block anything on this.** Each destination sets its own admission policy (see [Visas](https://karmadue.expo.app/docs/visas.md)).

## Stamps it leads to

- **manifest-declared**: the file was found at a commit (or URL) and is valid against v0. Refused with `schema_invalid` or `subject_mismatch`. Moves to changed when the declaration changes; a new stamp follows after a day.
- **publisher-domain-verified**: `publisher.domain` points back to this subject, by either a DNS TXT record `_karmadue.<domain>` with value `karmadue-subject=<repository URL, homepage or KarmaDue id>`, or a valid `https://<domain>/.well-known/karmadue.json` naming the same subject. It shows control of a domain, not legal identity.

The daily job reads manifests again for stamped and watched listings. Standards: https://karmadue.expo.app/standards#manifest-declared

## Validate

```
curl -s -X POST https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/public-api/v1/manifest/validate \
  -H 'content-type: application/json' --data @karmadue.json          # inline: nothing recorded
curl -s -X POST .../v1/manifest/validate -d '{"repo":"owner/repo"}'   # reads it at HEAD and updates the passport
```

MCP: `check_manifest {"manifest": {...}}`, `{"repo": "owner/repo"}`, `{"url": "https://example.com"}` or `{"resource_id": "kd:res:..."}`. The reply lists every error with its JSON path, warnings (e.g. no security contact), the canonical SHA-256 of the file, the declared autonomy level, the domain check, and the passport link.

## Example

```json
{
  "$schema": "https://karmadue.expo.app/schema/karmadue.v0.json",
  "karmadue": "0",
  "subject": {
    "type": "service",
    "name": "KarmaDue",
    "version": "2026.10.11",
    "homepage": "https://karmadue.expo.app"
  },
  "publisher": {
    "name": "KarmaDue",
    "domain": "karmadue.expo.app",
    "securityContact": "https://karmadue.expo.app/.well-known/security.txt"
  },
  "capabilities": {
    "tools": ["discover_resources", "check_before_acting", "verify_agent", "get_receipt", "set_watchlist", "check_manifest", "request_visa", "notify_human_of_finding"],
    "permissions": ["read:public-catalog", "write:own-agent-records", "notify:linked-person", "issue:signed-passports-and-visas"],
    "network": { "access": "allowlist", "domains": ["api.github.com", "github.com", "raw.githubusercontent.com", "registry.npmjs.org", "pypi.org", "api.osv.dev", "api.securityscorecards.dev", "registry.modelcontextprotocol.io", "cloudflare-dns.com"] },
    "filesystem": { "access": "none" },
    "payments": { "access": "none" },
    "autonomyLevel": "L2",
    "humanApprovalRequiredFor": ["claiming an agent", "payouts", "visas for destinations that do not auto-issue"]
  },
  "policies": {
    "security": "https://karmadue.expo.app/docs/security.md",
    "trainsOnUserData": false
  },
  "passport": "https://karmadue.expo.app/passport/kd:res:service:karmadue"
}
```

Pages: [Quick start](https://karmadue.expo.app/docs/mcp.md) · [Use KarmaDue from any agent](https://karmadue.expo.app/docs/any-agent.md) · [Permissions](https://karmadue.expo.app/docs/permissions.md) · [Tool reference](https://karmadue.expo.app/docs/tools.md) · [Security and verification](https://karmadue.expo.app/docs/security.md) · [Changelog](https://karmadue.expo.app/docs/changelog.md). Any HTTP client, no bot checks: the same files under https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/docs/docs/<page>.md

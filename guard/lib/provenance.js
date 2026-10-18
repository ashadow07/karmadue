"use strict";
// karmadue-guard 0.4.0: hijack signals from PUBLIC registry metadata only (one request per package, cached).
// Pure functions here (no I/O) so they can be tested with offline fixtures. Never reads lockfiles.
// Signals about the version being installed (pinned exact version, or the newest one) versus the version before it:
//   lostProvenance  previous version had publishing provenance (npm dist.attestations.provenance / trusted publisher;
//                   PyPI PEP 740 attestations listed on the simple index) and this one does not
//   publisherChange npm only: different publisher (_npmUser) or a maintainer added since the previous version
//   fresh           published within the last 72 hours (a SOFT note: normal releases do this all the time)
// level: strong (lost provenance AND publisher change, version <= 30 days old) | warn (one of the two) | note (fresh only) | none
const HOUR = 3600e3;
const FRESH_MS = 72 * HOUR;
const STRONG_MAX_AGE = 30 * 24 * HOUR;
const isPre = (v) => /-/.test(String(v)) || /\d(a|b|rc|dev)\d*(\.|$)/.test(String(v));
const keyNpm = (m) => { const u = m && m._npmUser; if (!u) return null; return u.trustedPublisher ? "trusted:" + (u.trustedPublisher.id || "?") : "user:" + (u.name || "?"); };

// npm full packument -> {eco, latest, vers:[{v,t,prov,pub,maint[]}]} (the 12 most recently published versions only)
function summarizeNpm(doc) {
  if (!doc || typeof doc !== "object" || !doc.versions || !doc.time) return null;
  const vers = Object.keys(doc.versions).filter((v) => doc.time[v]).map((v) => {
    const m = doc.versions[v] || {};
    return { v, t: Date.parse(doc.time[v]), prov: !!((m.dist && m.dist.attestations && m.dist.attestations.provenance) || (m._npmUser && m._npmUser.trustedPublisher)), pub: keyNpm(m), maint: (Array.isArray(m.maintainers) ? m.maintainers : []).map((x) => x && x.name).filter(Boolean).sort() };
  }).filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  // keep the 12 newest, plus the `latest` tag and the 3 releases before it (nightly/canary tags can bury `latest`)
  const lt = (doc["dist-tags"] || {}).latest; const li = vers.findIndex((x) => x.v === lt);
  const keep = new Set(vers.slice(-12).map((x) => x.v)); if (li >= 0) for (let k = Math.max(0, li - 3); k <= li; k++) keep.add(vers[k].v);
  return summarizeNpmOut(vers.filter((x) => keep.has(x.v)), lt);
}
function summarizeNpmOut(vers, lt) {
  return { eco: "npm", latest: lt || null, vers };
}

// PEP 700 simple index (JSON) -> {eco, vers:[{v,t,prov}]}; files grouped by version via filename.
const norm = (n) => String(n).toLowerCase().replace(/[-_.]+/g, "_");
function summarizePypi(doc, name) {
  if (!doc || !Array.isArray(doc.files)) return null;
  const nn = norm(name); const by = new Map();
  const versions = Array.isArray(doc.versions) && doc.versions.length ? doc.versions : null;
  for (const f of doc.files) {
    const fn = String(f.filename || ""); const low = fn.toLowerCase().replace(/-/g, "_");
    if (!low.startsWith(nn + "_")) continue;
    let ver = null;
    if (versions) ver = versions.filter((v) => low.startsWith(nn + "_" + String(v).toLowerCase().replace(/-/g, "_") + "_") || low.startsWith(nn + "_" + String(v).toLowerCase().replace(/-/g, "_") + ".")).sort((a, b) => b.length - a.length)[0] || null;
    else { const m = /^[^-]+-(\d[^-]*?)(?:-[^-]+)*\.(?:tar\.gz|zip|whl|egg)$/.exec(fn); ver = m ? m[1] : null; }
    if (!ver || f.yanked) continue;
    const e = by.get(ver) || { v: ver, t: Infinity, prov: false }; const t = Date.parse(f["upload-time"] || ""); if (Number.isFinite(t) && t < e.t) e.t = t; if (f.provenance) e.prov = true; by.set(ver, e);
  }
  const vers = [...by.values()].filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t).slice(-12);
  return { eco: "pypi", vers };
}

const isExact = (eco, v) => eco === "pypi" ? /^\d+(\.\d+)*((a|b|rc)\d+)?(\.post\d+)?(\.dev\d+)?$/.test(v || "") : /^\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(v || "");
// Which version to judge: exact pin, or (no version / "latest") the newest stable one. Ranges and other tags: not judged.
function pick(sum, version) {
  const vs = sum.vers; if (!vs.length) return null;
  if (!version || version === "latest") {
    if (sum.eco === "npm" && sum.latest) { const i = vs.findIndex((x) => x.v === sum.latest); if (i >= 0) return i; }
    for (let i = vs.length - 1; i >= 0; i--) if (!isPre(vs[i].v)) return i;
    return vs.length - 1;
  }
  if (!isExact(sum.eco, version)) return null;
  const i = vs.findIndex((x) => x.v === version); return i >= 0 ? i : null;
}

function assess(sum, version, now = Date.now()) {
  const out = { level: "none", signals: [], v: null };
  if (!sum) return out;
  const i = pick(sum, version); if (i == null) return out;
  const cur = sum.vers[i]; out.v = cur.v; out.ageH = Math.max(0, Math.round((now - cur.t) / HOUR));
  // previous version = the most recently published earlier version of the same kind (stable vs pre-release)
  let prev = null; for (let j = i - 1; j >= 0; j--) { if (isPre(sum.vers[j].v) === isPre(cur.v)) { prev = sum.vers[j]; break; } }
  const lost = !!(prev && prev.prov && !cur.prov);
  let pubChange = false, why = "";
  if (prev && sum.eco === "npm") {
    if (cur.pub && prev.pub && cur.pub !== prev.pub) { pubChange = true; why = `publisher ${prev.pub.replace(/^(user|trusted):/, "")} -> ${cur.pub.replace(/^(user|trusted):/, "")}`; }
    const added = cur.maint.filter((m) => !prev.maint.includes(m));
    if (!pubChange && added.length) { pubChange = true; why = `maintainer added: ${added.slice(0, 2).join(",")}`; }
  }
  const fresh = now - cur.t < FRESH_MS;
  if (lost) out.signals.push(`lost provenance (${prev.v} had it)`);
  if (pubChange) out.signals.push(why);
  if (fresh) out.signals.push(`published ${out.ageH}h ago`);
  out.prev = prev ? prev.v : null;
  out.level = lost && pubChange && now - cur.t <= STRONG_MAX_AGE ? "strong" : (lost || pubChange) ? "warn" : fresh ? "note" : "none";
  out.lost = lost; out.pubChange = pubChange; out.fresh = fresh; out.why = why;
  return out;
}
module.exports = { summarizeNpm, summarizePypi, assess, isExact, FRESH_MS };

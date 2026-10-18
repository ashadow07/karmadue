#!/usr/bin/env node
// Re-captures live KarmaDue replies for the targets the tests use and writes
// fixtures/preflight-responses.json. Run it when KarmaDue's reply format changes, then run
// `node test/run.js` (mock) and `node test/run.js --live`. Same request the hook sends.
"use strict";
const fs = require("fs");
const path = require("path");
const { VERSION } = require("../karmadue-preinstall.js");
const API = (process.env.KARMADUE_API || "https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/public-api").replace(/\/+$/, "");
const TARGETS = ["npm:event-stream@3.3.6", "npm:postmark-mcp@1.0.18", "pypi:jinja2==2.11.2", "npm:is-number@7.0.0", "npm:kd-hook-test-nonexistent-7f3a9c@1.0.0"];
(async () => {
  const responses = {};
  for (const target of TARGETS) {
    const r = await fetch(`${API}/v1/preflight`, { method: "POST", headers: { "content-type": "application/json", "user-agent": `karmadue-preinstall-hook/${VERSION} (capture)` }, body: JSON.stringify({ target, action: "install_connector" }) });
    const j = await r.json();
    delete j.request_id;
    responses[target] = j;
    const d = (j && j.data) || {};
    console.log(`${target.padEnd(44)} HTTP ${r.status}  decision=${d.decision || (d.install_decision && d.install_decision.decision)}  enforce=${d.enforce || "-"}`);
  }
  const out = { captured_from: `${API}/v1/preflight`, captured_at: new Date().toISOString(), hook_version: VERSION, responses };
  fs.writeFileSync(path.join(__dirname, "fixtures", "preflight-responses.json"), JSON.stringify(out, null, 1) + "\n");
})().catch((e) => { console.error(e); process.exit(1); });

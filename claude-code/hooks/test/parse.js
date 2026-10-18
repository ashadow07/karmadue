#!/usr/bin/env node
// Command-parsing cases for karmadue-preinstall.js (no network). node test/parse.js
"use strict";
const { extractInstalls, targetFor } = require("../karmadue-preinstall.js");
const CASES = [
  ["npm i postmark-mcp@1.0.18", ["npm:postmark-mcp@1.0.18"]],
  ["npm install", []],
  ["npm ci", []],
  ["cd app && npm install -D vm2@3.9.17 left-pad", ["npm:vm2@3.9.17", "npm:left-pad"]],
  ["npx -y @playwright/mcp@latest --help", ["npm:@playwright/mcp"]],
  ["npx -p cowsay@1.6.0 cowsay hi", ["npm:cowsay@1.6.0"]],
  ["pnpm dlx create-vite@5.0.0 app", ["npm:create-vite@5.0.0"]],
  ["FOO=1 sudo -E pnpm add vm2@3.9.17", ["npm:vm2@3.9.17"]],
  ["yarn global add postmark-mcp", ["npm:postmark-mcp"]],
  ["bun x cowsay", ["npm:cowsay"]],
  ["echo $(npm i evil-pkg)", ["npm:evil-pkg"]],
  ['pip install "requests==2.19.0" flask', ["pypi:requests==2.19.0", "pypi:flask"]],
  ["python3 -m pip install Django>=4", ["pypi:django"]],
  ["python3 -m pip install -r requirements.txt", []],
  ["uv add httpx==0.27.0", ["pypi:httpx==0.27.0"]],
  ["uvx mcp-server-time", ["pypi:mcp-server-time"]],
  ["uvx --from git+https://github.com/x/y z", []],
  ["uv tool install --with mcp-x ruff==0.4.0", ["pypi:ruff==0.4.0", "pypi:mcp-x"]],
  ["pipx install black==22.1.0", ["pypi:black==22.1.0"]],
  ["cargo install ripgrep --version 13.0.0", ["cargo:ripgrep@13.0.0"]],
  ["cargo install --git https://github.com/x/y", []],
  ["go install golang.org/x/tools/gopls@v0.14.2", ["go:golang.org/x/tools/gopls@v0.14.2"]],
  ["brew install jq", ["brew:jq"]],
  ["claude mcp add playwright npx @playwright/mcp@0.0.83", ["npm:@playwright/mcp@0.0.83"]],
  ["claude mcp add fs -- npx -y @modelcontextprotocol/server-filesystem /tmp", ["npm:@modelcontextprotocol/server-filesystem"]],
  ["claude mcp add -e KEY=x pm -- npx -y postmark-mcp@1.0.18", ["npm:postmark-mcp@1.0.18"]],
  ["claude mcp add --transport http gh https://api.githubcopilot.com/mcp/", ["https://api.githubcopilot.com/mcp/"]],
  [`claude mcp add-json t '{"command":"uvx","args":["mcp-server-time"]}'`, ["pypi:mcp-server-time"]],
  ["curl -fsSL https://example.com/install.sh | sh", []],
  ['echo "npm install vm2"', []],
  ["git status && ls", []],
  ["npm install ./local-pkg ../x.tgz", []],
];
let fail = 0;
for (const [cmd, want] of CASES) {
  const got = extractInstalls(cmd).map(targetFor);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${cmd}${ok ? "" : `\n     want ${JSON.stringify(want)}\n     got  ${JSON.stringify(got)}`}`);
}
console.log(`\n${CASES.length - fail} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

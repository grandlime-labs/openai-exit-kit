#!/usr/bin/env node
// 1) Convert the bundled fixtures with the built CLI.
// 2) `promptfoo validate config` every generated promptfooconfig.yaml (no network, no paid API).
// 3) Optionally (default on; pass --no-eval to skip) run `promptfoo eval` against a LOCAL mock
//    OpenAI server so the whole pipeline executes offline. No real API key is used or needed.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { startMockOpenAI } from "./mock-openai.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const out = join(root, "out", "verify");
const runEval = !process.argv.includes("--no-eval");
// spawnSync would block the event loop and starve the in-process mock server, so evals use async spawn.
function run(cmd, args, opts) {
  return new Promise((res) => {
    const c = spawn(cmd, args, opts);
    let stdout = "", stderr = "";
    c.stdout.on("data", (d) => (stdout += d));
    c.stderr.on("data", (d) => (stderr += d));
    const t = setTimeout(() => c.kill("SIGKILL"), 120000);
    c.on("close", (status) => { clearTimeout(t); res({ status, stdout, stderr }); });
  });
}
const pf = join(root, "node_modules", ".bin", "promptfoo");
if (!existsSync(pf)) { console.error("promptfoo is not installed; run npm install"); process.exit(2); }
if (!existsSync(join(root, "dist/cli/index.js"))) { console.error("Run `npm run build:cli` first."); process.exit(2); }

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const conv = spawnSync("node", ["dist/cli/index.js", "convert", "fixtures/evals-export", "fixtures/prompts", "--out", out], { cwd: root, encoding: "utf8" });
if (conv.status !== 0) { console.error(conv.stdout, conv.stderr); process.exit(1); }

const dir = join(out, "promptfoo");
const projects = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "promptfooconfig.yaml"))).map((d) => d.name);
const cleanEnv = { ...process.env, PROMPTFOO_DISABLE_TELEMETRY: "1", PROMPTFOO_DISABLE_UPDATE: "1", PROMPTFOO_CONFIG_DIR: join(out, ".promptfoo") };
delete cleanEnv.OPENAI_API_KEY;
let failed = 0;

console.log(`Validating ${projects.length} generated promptfoo configs (no API calls)...`);
for (const p of projects) {
  const r = spawnSync(pf, ["validate", "config", "-c", join(dir, p, "promptfooconfig.yaml")], { cwd: join(dir, p), encoding: "utf8", env: cleanEnv });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${p}`);
  if (!ok) console.log((r.stdout + r.stderr).split("\n").map((l) => "       " + l).join("\n"));
}

if (runEval && !failed) {
  const mock = await startMockOpenAI();
  console.log(`\nRunning promptfoo eval against a local mock OpenAI at ${mock.url} (no real API, no key)...`);
  const env = { ...cleanEnv, OPENAI_API_KEY: "sk-mock-not-a-real-key", OPENAI_API_BASE_URL: mock.url, OPENAI_BASE_URL: mock.url };
  for (const p of projects) {
    const outJson = join(out, `${p}.results.json`);
    const r = await run(pf, ["eval", "-c", join(dir, p, "promptfooconfig.yaml"), "--no-cache", "--no-write", "--no-progress-bar", "-o", outJson], { cwd: join(dir, p), encoding: "utf8", env });
    // exit 0 = all pass, 100 = some assertions failed (expected with a canned mock); anything else = broken pipeline
    const ran = existsSync(outJson);
    let line = "";
    if (ran) {
      const j = JSON.parse(readFileSync(outJson, "utf8"));
      const s = j.results?.stats ?? {};
      line = `successes=${s.successes} failures=${s.failures} errors=${s.errors}`;
      if ((s.errors ?? 0) > 0) {
        const msgs = new Set((j.results.results ?? []).filter((x) => x.error).map((x) => String(x.error).slice(0, 160)));
        line += `\n       first errors: ${[...msgs].slice(0, 2).join(" | ")}`;
      }
    }
    const ok = ran && [0, 100].includes(r.status);
    if (!ok) failed++;
    console.log(`  ${ok ? "RAN " : "FAIL"} ${p}: ${line || (r.stdout + r.stderr).slice(0, 400)}`);
  }
  console.log(`  (${mock.requests.length} requests went to the local mock; none left this machine)`);
  await mock.close();
}
console.log(failed ? `\n${failed} problem(s).` : "\nAll generated configs validate.");
process.exit(failed ? 1 : 0);

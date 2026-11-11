import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { convertPrompts, parseInputs, runAll } from "../core/index";
import { exportEvals } from "../core/exporter";
import { DEPRECATIONS_CHECKED, SHUTDOWNS } from "../core/deprecations";
import type { InputFile } from "../core/types";

const VERSION = "0.1.0";

const HELP = `openai-exit-kit ${VERSION}
Move off the OpenAI Evals / prompt-object shutdowns (2026-11-30). Runs locally; reads files, writes files.

Usage:
  openai-exit-kit export  --out <dir> [--max-output-items N]       Download evals, runs, output items and datasets (GET requests only).
                                                                 Needs OPENAI_API_KEY (optional: OPENAI_PROJECT, OPENAI_ORG, OPENAI_BASE_URL).
  openai-exit-kit convert <path...> --out <dir>                   Evals export -> promptfoo projects (+ prompt objects -> code if present).
        [--replace-deprecated] [--provider-prefix openai]
  openai-exit-kit prompts <path...> --out <dir>                   Prompt objects (JSON) or .txt/.md prompts -> TypeScript + Python code.
  openai-exit-kit models                                           Print the bundled model-shutdown table.
  openai-exit-kit --help | --version

Nothing is uploaded anywhere. 'convert' and 'prompts' never call an API.
`;

function walk(p: string, out: string[] = []): string[] {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const n of readdirSync(p).sort()) {
      if (n === "node_modules" || n.startsWith(".")) continue;
      walk(join(p, n), out);
    }
  } else out.push(p);
  return out;
}

function readInputs(paths: string[], includeText: boolean): InputFile[] {
  const files: InputFile[] = [];
  for (const p of paths) {
    const root = resolve(p);
    const isDir = statSync(root).isDirectory();
    for (const f of walk(root)) {
      if (!/\.(json|jsonl|txt|md)$/i.test(f)) continue;
      if (!includeText && /\.(txt|md)$/i.test(f)) continue;
      files.push({ name: isDir ? relative(root, f) || f : f.split("/").pop()!, text: readFileSync(f, "utf8") });
    }
  }
  return files;
}

function writeAll(outDir: string, files: { path: string; content: string }[]): void {
  for (const f of files) {
    const dest = join(outDir, f.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.content);
  }
}

interface Args { positional: string[]; flags: Record<string, string | true> }
function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) flags[k] = v;
      else if (["replace-deprecated", "help", "version"].includes(k)) flags[k] = true;
      else flags[k] = argv[++i] ?? "";
    } else positional.push(a);
  }
  return { positional, flags };
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { positional, flags } = parseArgs(rest);
  if (!cmd || cmd === "--help" || cmd === "-h" || flags.help) { process.stdout.write(HELP); return cmd ? 0 : 1; }
  if (cmd === "--version" || flags.version) { process.stdout.write(VERSION + "\n"); return 0; }

  if (cmd === "models") {
    process.stdout.write(`Model shutdown table (snapshot from developers.openai.com/api/docs/deprecations, read ${DEPRECATIONS_CHECKED}; re-check the page):\n`);
    for (const s of SHUTDOWNS) process.stdout.write(`${s.date}  ${s.ids.join(", ")}${s.replacement ? `  ->  ${s.replacement}` : ""}\n`);
    return 0;
  }

  const out = typeof flags.out === "string" && flags.out ? flags.out : "";
  if (!out) { process.stderr.write("Missing --out <dir>.\n\n" + HELP); return 1; }

  if (cmd === "export") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) { process.stderr.write("Set OPENAI_API_KEY (a key for the project that owns the evals). The key is only sent to the API base URL.\n"); return 1; }
    const outDir = resolve(out);
    const r = await exportEvals({
      apiKey,
      baseUrl: process.env.OPENAI_BASE_URL,
      project: process.env.OPENAI_PROJECT,
      organization: process.env.OPENAI_ORG,
      maxOutputItems: typeof flags["max-output-items"] === "string" ? Number(flags["max-output-items"]) : undefined,
      write: (p, c) => { const d = join(outDir, p); mkdirSync(dirname(d), { recursive: true }); writeFileSync(d, c); },
      log: (m) => process.stdout.write(m + "\n"),
    });
    for (const w of r.warnings) process.stderr.write(`warning: ${w}\n`);
    process.stdout.write(`Done: ${r.evals} eval(s), ${r.runs} run(s), ${r.outputItems} output item(s), ${r.datasetFiles} dataset file(s) -> ${outDir}\nNext: openai-exit-kit convert ${out} --out promptfoo-out\n`);
    return 0;
  }

  if (cmd === "convert") {
    if (!positional.length) { process.stderr.write("Give at least one file or folder to convert.\n"); return 1; }
    const inputs = readInputs(positional, false);
    const res = runAll(inputs, { replaceDeprecated: flags["replace-deprecated"] === true, providerPrefix: typeof flags["provider-prefix"] === "string" ? flags["provider-prefix"] : undefined });
    if (!res.files.length) { process.stderr.write(res.summary.join("\n") + "\n"); for (const w of res.warnings) process.stderr.write(`warning: ${w}\n`); return 1; }
    writeAll(resolve(out), res.files);
    for (const s of res.summary) process.stdout.write(s + "\n");
    for (const w of res.warnings) process.stderr.write(`warning: ${w}\n`);
    process.stdout.write(`Wrote ${res.files.length} files to ${resolve(out)}. Start with promptfoo/MIGRATION_REPORT.md.\n`);
    return 0;
  }

  if (cmd === "prompts") {
    if (!positional.length) { process.stderr.write("Give at least one file or folder.\n"); return 1; }
    const parsed = parseInputs(readInputs(positional, true));
    const res = convertPrompts(parsed.promptObjects, parsed.promptTexts);
    if (!res.prompts.length) { process.stderr.write("No prompt objects found.\n"); return 1; }
    writeAll(resolve(out), res.files);
    process.stdout.write(`${res.prompts.length} prompt(s) -> ${resolve(out)} (ts/, py/, prompts-manifest.json, MIGRATION_PROMPTS.md)\n`);
    for (const w of [...parsed.warnings, ...res.warnings]) process.stderr.write(`warning: ${w}\n`);
    return 0;
  }

  process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => { process.stderr.write(`error: ${(err as Error).message}\n`); process.exit(1); },
);

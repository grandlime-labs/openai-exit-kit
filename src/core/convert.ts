import { stringify } from "yaml";
import { contentToText, mapGrader, newGraderContext } from "./graders";
import { DEPRECATIONS_CHECKED, DEPRECATIONS_SOURCE, firstReplacementId, lookupShutdown } from "./deprecations";
import { slugify, toPromptfooVars } from "./template";
import type { ConvertOptions, ConvertResult, EvalBundle, Fidelity, GraderMapping, Obj, PromptfooAssertion, RunSummary } from "./types";

const SCHEMA_LINE = "# yaml-language-server: $schema=https://promptfoo.dev/config-schema.json\n";
const yaml = (o: unknown) => stringify(o, { lineWidth: 0 });

/* ------------------------------------ run summaries ------------------------------------ */

export function summarizeRun(run: Obj, items: Obj[]): RunSummary {
  const per = new Map<string, { passed: number; total: number; sum: number }>();
  for (const it of items) {
    for (const r of it.results ?? []) {
      const key = String(r.name ?? "grader");
      const e = per.get(key) ?? { passed: 0, total: 0, sum: 0 };
      e.total++;
      if (r.passed) e.passed++;
      if (typeof r.score === "number") e.sum += r.score;
      per.set(key, e);
    }
  }
  let perGrader: RunSummary["perGrader"] = [...per.entries()].map(([name, e]) => ({ name, passed: e.passed, total: e.total, meanScore: e.total ? e.sum / e.total : undefined }));
  if (!perGrader.length && Array.isArray(run.per_testing_criteria_results)) {
    perGrader = run.per_testing_criteria_results.map((p: Obj) => ({ name: String(p.testing_criteria), passed: p.passed ?? 0, total: (p.passed ?? 0) + (p.failed ?? 0) }));
  }
  const ds = run.data_source ?? {};
  return {
    id: String(run.id),
    name: run.name ?? undefined,
    model: run.model ?? ds.model ?? undefined,
    dataSourceType: ds.type,
    sourceType: ds.source?.type,
    createdAt: run.created_at,
    status: run.status,
    resultCounts: run.result_counts ?? undefined,
    perGrader,
    outputItemCount: items.length,
  };
}

/* --------------------------------------- dataset --------------------------------------- */

interface Row { item: Obj; sample?: Obj }

function normalizeRow(r: Obj): Row {
  if (r && typeof r.item === "object" && r.item !== null) return { item: r.item, sample: r.sample };
  return { item: r };
}

function rowsForRun(b: EvalBundle, run: Obj): { rows: Row[]; origin: string } | undefined {
  const src = run.data_source?.source ?? {};
  if (src.type === "file_content" && Array.isArray(src.content) && src.content.length) {
    return { rows: src.content.map(normalizeRow), origin: `inline file_content of run ${run.id}` };
  }
  if (src.type === "file_id" && src.id) {
    const ds = b.datasets[src.id];
    if (ds?.length) return { rows: ds.map(normalizeRow), origin: `dataset file ${src.id}` };
  }
  const rebuilt = b.datasets[`${run.id}.from_output_items`];
  if (rebuilt?.length) return { rows: rebuilt.map(normalizeRow), origin: `rebuilt rows of run ${run.id} (from_output_items file)` };
  const items = b.outputItems[run.id];
  if (items?.length) {
    const rows = items.filter((i) => i.datasource_item).map((i) => normalizeRow(i.datasource_item));
    if (rows.length) return { rows, origin: `datasource_item values from the output items of run ${run.id}` };
  }
  return undefined;
}

/* ---------------------------------------- prompts --------------------------------------- */

interface PromptBuild {
  mode: "chat" | "echo" | "fallback";
  messages?: { role: string; content: string }[];
  notes: string[];
}

function buildPrompt(run: Obj | undefined, firstVar: string | undefined): PromptBuild {
  const notes: string[] = [];
  const ds = run?.data_source;
  if (ds?.type === "jsonl") {
    return { mode: "echo", notes: ["This eval grades pre-computed outputs (`jsonl` data source): no model is called. Each test's `sample_output_text` var is echoed back as the output via promptfoo's `echo` provider."] };
  }
  const im = ds?.input_messages;
  if (im?.type === "template" && Array.isArray(im.template)) {
    const messages = im.template.map((m: Obj) => {
      const role = m.role === "developer" ? "system" : String(m.role ?? "user");
      return { role, content: toPromptfooVars(contentToText(m.content)) };
    });
    if (im.template.some((m: Obj) => m.role === "developer")) notes.push("`developer` messages were written as `system` (equivalent for OpenAI models; also valid for other providers).");
    if (JSON.stringify(im.template).includes("input_image") || JSON.stringify(im.template).includes("input_audio")) notes.push("Image/audio inputs in the template were replaced by a text placeholder. Re-add them with promptfoo's media support.");
    return { mode: "chat", messages, notes };
  }
  if (im?.type === "item_reference") {
    const v = String(im.item_reference).replace(/^item\./, "");
    notes.push(`The run used \`item_reference\` (${im.item_reference}), a pre-built message trajectory. promptfoo prompt files cannot expand that automatically; the prompt is a single user message with {{ ${v} }}. Provide a prompt function if the item holds a message array.`);
    return { mode: "chat", messages: [{ role: "user", content: `{{ ${v} }}` }], notes };
  }
  notes.push("No input message template was found (the run may have used stored completions or logs, which have no prompt to export). A placeholder prompt was written: edit prompts/main.json.");
  return { mode: "fallback", messages: [{ role: "user", content: `{{ ${firstVar ?? "input"} }}` }], notes };
}

/* --------------------------------------- providers -------------------------------------- */

function providerConfig(run: Obj): Obj {
  const sp = run.data_source?.sampling_params ?? {};
  const cfg: Obj = {};
  const isResponses = run.data_source?.type === "responses";
  if (typeof sp.temperature === "number") cfg.temperature = sp.temperature;
  if (typeof sp.top_p === "number") cfg.top_p = sp.top_p;
  const maxTok = sp.max_completion_tokens ?? sp.max_completions_tokens;
  if (isResponses) {
    if (typeof maxTok === "number") cfg.max_output_tokens = maxTok;
    if (sp.reasoning_effort) cfg.reasoning = { effort: sp.reasoning_effort };
    if (sp.text?.format) cfg.response_format = sp.text.format;
  } else {
    if (typeof sp.seed === "number") cfg.seed = sp.seed;
    if (typeof maxTok === "number") cfg.max_completion_tokens = maxTok;
    if (sp.reasoning_effort) cfg.reasoning_effort = sp.reasoning_effort;
    if (sp.response_format && sp.response_format.type !== "text") cfg.response_format = sp.response_format;
  }
  return cfg;
}

function walkProviders(a: PromptfooAssertion, fn: (id: string) => string): void {
  if (typeof a.provider === "string") a.provider = fn(a.provider);
  for (const c of a.assert ?? []) walkProviders(c, fn);
}

/* ---------------------------------------- convert --------------------------------------- */

const FID_RANK: Record<Fidelity, number> = { exact: 0, approximate: 1, manual: 2 };
const worstOf = (fs: Fidelity[]): Fidelity => fs.reduce<Fidelity>((w, f) => (FID_RANK[f] > FID_RANK[w] ? f : w), "exact");
const fmtDate = (ts?: number) => (typeof ts === "number" ? new Date(ts * 1000).toISOString().slice(0, 10) : "?");

export function convertEvals(bundles: EvalBundle[], opts: ConvertOptions = {}): ConvertResult {
  const now = opts.now ?? new Date();
  const prefix = opts.providerPrefix ?? "openai";
  const result: ConvertResult = { files: [], warnings: [], evals: [] };
  const usedFolders = new Set<string>();

  for (const b of bundles) {
    const ev = b.evalObj;
    const warnings: string[] = [];
    let folder = slugify(String(ev.name ?? ev.id ?? "eval"), "eval");
    if (usedFolders.has(folder)) folder = `${folder}-${slugify(String(ev.id)).slice(-8)}`;
    usedFolders.add(folder);
    const files: { path: string; content: string }[] = [];
    const add = (path: string, content: string) => files.push({ path: `${folder}/${path}`, content });

    /* graders */
    const gctx = newGraderContext();
    const criteria: Obj[] = Array.isArray(ev.testing_criteria) ? ev.testing_criteria : [];
    const graders: GraderMapping[] = criteria.map((c) => mapGrader(c, gctx));
    if (!criteria.length) warnings.push("The eval has no testing_criteria, so there is nothing to assert.");

    /* runs */
    const runs = [...b.runs].sort((a, c) => (a.created_at ?? 0) - (c.created_at ?? 0));
    const summaries = runs.map((r) => summarizeRun(r, b.outputItems[r.id] ?? []));
    const latestFirst = [...runs].reverse();

    /* dataset */
    let rows: Row[] = [];
    let origin = "none";
    let datasetRun: Obj | undefined;
    for (const r of latestFirst) {
      const got = rowsForRun(b, r);
      if (got) { rows = got.rows; origin = got.origin; datasetRun = r; break; }
    }
    if (!rows.length) warnings.push("No dataset rows could be recovered (no inline content, dataset file, or output-item `datasource_item`). tests.yaml is empty: add test cases.");
    const sourceType = datasetRun?.data_source?.source?.type;
    if (rows.length && (sourceType === "stored_completions" || sourceType === "responses" || ev.data_source_config?.type === "logs" || ev.data_source_config?.type === "stored_completions")) {
      warnings.push("This eval sampled from stored completions / logs. Test vars were recovered from output items, which only cover the items that were actually graded.");
    }

    /* prompt */
    const promptRun = latestFirst.find((r) => r.data_source?.input_messages || r.data_source?.type === "jsonl") ?? latestFirst[0];
    const firstVar = rows[0] ? Object.keys(rows[0].item)[0] : undefined;
    const prompt = buildPrompt(promptRun, firstVar);
    warnings.push(...prompt.notes);

    /* providers */
    const providers: Obj[] = [];
    const deprecated: string[] = [];
    const replace = (model: string): string => {
      const info = lookupShutdown(model, now);
      if (!info) return model;
      const when = info.alreadyShutDown ? `shut down on ${info.date}` : `shuts down on ${info.date}`;
      deprecated.push(`${model} (${when}${info.replacement ? `; OpenAI recommends ${info.replacement}` : ""})`);
      if (opts.replaceDeprecated) {
        const rep = firstReplacementId(info.replacement);
        if (rep) return rep;
      }
      return model;
    };
    if (prompt.mode === "echo") {
      providers.push({ id: "echo", label: "echo (pre-computed outputs)" });
    } else {
      const seen = new Set<string>();
      for (const r of latestFirst) {
        const t = r.data_source?.type;
        if (t !== "completions" && t !== "responses") continue;
        const model: string | undefined = r.data_source?.model ?? r.model ?? undefined;
        if (!model || seen.has(`${t}:${model}`)) continue;
        seen.add(`${t}:${model}`);
        const used = replace(model);
        const p: Obj = { id: `${prefix}:${t === "responses" ? "responses" : "chat"}:${used}`, label: used === model ? model : `${used} (was ${model})` };
        const cfg = providerConfig(r);
        if (Object.keys(cfg).length) p.config = cfg;
        providers.push(p);
      }
      if (!providers.length) {
        warnings.push("No sampled model found in any run. A placeholder provider was written: set `providers` in promptfooconfig.yaml.");
        providers.push({ id: `${prefix}:chat:REPLACE_WITH_MODEL` });
      }
    }

    /* judge models inside graders */
    const judgeModels = new Set<string>();
    for (const g of graders) for (const a of g.assertions) {
      walkProviders(a, (id) => {
        const m = id.match(/^openai:chat:(.+)$/);
        if (!m) return id;
        judgeModels.add(m[1]);
        return `${prefix}:chat:${replace(m[1])}`;
      });
    }

    /* tests */
    const echo = prompt.mode === "echo";
    const tests = rows.map((r, i) => {
      const vars: Obj = { ...r.item };
      if (echo) {
        const out = r.sample?.output_text ?? r.item.output_text ?? r.sample?.output ?? "";
        vars.sample_output_text = typeof out === "string" ? out : JSON.stringify(out);
      }
      return { description: `item ${i + 1}`, vars };
    });

    /* config */
    const assertions = graders.flatMap((g) => g.assertions);
    const usesSimilar = JSON.stringify(assertions).includes('"type":"similar"');
    const promptRef = echo ? "{{ sample_output_text }}" : "file://prompts/main.json";
    const config: Obj = {
      description: `Migrated from OpenAI eval ${ev.id}${ev.name ? ` ("${ev.name}")` : ""}`,
      prompts: [promptRef],
      providers,
      defaultTest: {
        ...(usesSimilar ? { options: { provider: { embedding: { id: `${prefix}:embedding:text-embedding-3-large` } } } } : {}),
        assert: assertions,
      },
      tests: "file://tests.yaml",
    };
    add("promptfooconfig.yaml", SCHEMA_LINE + yaml(config));
    add("tests.yaml", tests.length ? yaml(tests) : "[]\n");
    if (!echo) add("prompts/main.json", JSON.stringify(prompt.messages, null, 2) + "\n");
    for (const g of graders) for (const f of g.files) add(f.path, f.content);

    const baseline = { evalId: ev.id, generatedFrom: "OpenAI Evals export", runs: summaries };
    add("baseline.json", JSON.stringify(baseline, null, 2) + "\n");

    const evalWarnings = [...warnings];
    const info = { id: String(ev.id), name: String(ev.name ?? ev.id), folder, graders, runs: summaries, testCount: tests.length, deprecatedModels: [...new Set(deprecated)] };
    add("MIGRATION_REPORT.md", evalReport({ ev, info, origin, warnings: evalWarnings, judgeModels: [...judgeModels], now, usesSimilar }));
    result.files.push(...files);
    result.evals.push(info);
    result.warnings.push(...warnings.map((w) => `[${folder}] ${w}`));
  }

  result.files.push({ path: "MIGRATION_REPORT.md", content: rootReport(result, now, opts) });
  result.files.push({ path: "README.md", content: rootReadme(result) });
  return result;
}

/* ---------------------------------------- reports --------------------------------------- */

const badge: Record<Fidelity, string> = { exact: "exact", approximate: "approximate", manual: "MANUAL" };
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function evalReport(a: { ev: Obj; info: ConvertResult["evals"][number]; origin: string; warnings: string[]; judgeModels: string[]; now: Date; usesSimilar: boolean }): string {
  const { ev, info, origin, warnings, now } = a;
  const L: string[] = [];
  L.push(`# Migration report: ${info.name}`, "");
  L.push(`- Source eval id: \`${info.id}\``);
  L.push(`- Generated: ${now.toISOString().slice(0, 10)} by openai-exit-kit`);
  L.push(`- Test cases written: **${info.testCount}** (origin: ${origin})`);
  L.push(`- Runs in the export: ${info.runs.length}`);
  L.push(`- Data source config type: \`${ev.data_source_config?.type ?? "unknown"}\``, "");
  L.push("## Graders", "");
  L.push("| Grader | OpenAI type | Fidelity | promptfoo |", "| --- | --- | --- | --- |");
  for (const g of info.graders) {
    L.push(`| \`${g.name}\` | ${g.sourceType} | **${badge[g.fidelity]}** | ${esc(g.assertions.map((x) => x.type).join(", "))} |`);
  }
  L.push("", "Fidelity key: **exact** = same pass/fail logic; **approximate** = same intent, different implementation (scores and pass rates will move; re-baseline); **MANUAL** = a deliberately failing placeholder was written and you must replace it.", "");
  for (const g of info.graders) {
    L.push(`### \`${g.name}\` (${g.sourceType}, ${badge[g.fidelity]})`, "");
    for (const n of g.notes) L.push(n.startsWith("  - ") ? n : `- ${n}`);
    L.push("");
  }
  if (info.deprecatedModels.length) {
    L.push("## Models that are being shut down", "");
    for (const d of info.deprecatedModels) L.push(`- ${d}`);
    L.push("", `Source: ${DEPRECATIONS_SOURCE}, snapshot read ${DEPRECATIONS_CHECKED}. This is a point-in-time table; confirm on the page or via \`GET /v1/models\` (\`shutdown_date\`). Re-run with \`--replace-deprecated\` to swap in OpenAI's recommended replacement ids.`, "");
  }
  if (warnings.length) {
    L.push("## Warnings and things that do not carry over", "");
    for (const w of warnings) L.push(`- ${w}`);
    L.push("");
  }
  L.push("## Baseline from your OpenAI runs", "");
  if (!info.runs.length) L.push("No run objects in the export, so there is no baseline to compare against.", "");
  else {
    L.push("| Run | Model | Created | Items | Grader | Passed / total | Mean score |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (const r of info.runs) {
      if (!r.perGrader.length) L.push(`| \`${r.id}\` | ${r.model ?? "-"} | ${fmtDate(r.createdAt)} | ${r.outputItemCount} | - | - | - |`);
      for (const g of r.perGrader) {
        L.push(`| \`${r.id}\` | ${r.model ?? "-"} | ${fmtDate(r.createdAt)} | ${r.outputItemCount} | ${esc(g.name)} | ${g.passed} / ${g.total} | ${g.meanScore === undefined ? "-" : g.meanScore.toFixed(3)} |`);
      }
    }
    L.push("", "These are historical numbers from OpenAI's graders. Do not expect promptfoo to reproduce them exactly: judge, similarity and embedding graders will differ.", "");
  }
  L.push("## Run it", "", "```bash", "# no API key needed to validate:", `npx promptfoo validate config -c ${info.folder}/promptfooconfig.yaml`, "", "# a fresh run (this calls the models in the config, so it needs OPENAI_API_KEY and costs money):", `npx promptfoo eval -c ${info.folder}/promptfooconfig.yaml --no-cache`, "npx promptfoo view", "```", "");
  L.push("## Parity check (do this before you trust the new suite)", "",
    "1. Run the migrated eval against the same model and data as your last good OpenAI run.",
    "2. Compare case by case, not only in aggregate. Classify each difference as: harness difference, grader translation difference, or genuine output difference.",
    "3. Re-tune any threshold on an approximate grader, then record the new numbers as your baseline.", "");
  return L.join("\n");
}

function rootReport(r: ConvertResult, now: Date, opts: ConvertOptions): string {
  const L: string[] = [];
  L.push("# OpenAI Evals to promptfoo: migration report", "");
  L.push(`Generated ${now.toISOString().slice(0, 10)} by openai-exit-kit${opts.replaceDeprecated ? " (deprecated models replaced)" : ""}.`, "");
  L.push("OpenAI's deprecations page lists Evals, Agent Builder and the `v1/prompts` API for shutdown on 2026-11-30 (https://developers.openai.com/api/docs/deprecations). Anything you have not exported by then is gone.", "");
  L.push("## Summary", "");
  if (!r.evals.length) L.push("No evals were found in the input.", "");
  else {
    L.push("| Eval | Folder | Tests | Graders (exact / approx / manual) | Runs | Models being shut down |", "| --- | --- | --- | --- | --- | --- |");
    for (const e of r.evals) {
      const c = { exact: 0, approximate: 0, manual: 0 };
      for (const g of e.graders) c[g.fidelity]++;
      L.push(`| ${esc(e.name)} | \`${e.folder}/\` | ${e.testCount} | ${c.exact} / ${c.approximate} / ${c.manual} | ${e.runs.length} | ${e.deprecatedModels.length ? esc(e.deprecatedModels.join("; ")) : "none found"} |`);
    }
    L.push("");
    const all = r.evals.flatMap((e) => e.graders.map((g) => g.fidelity));
    L.push(`Overall: worst fidelity across all graders is **${badge[worstOf(all.length ? all : ["exact"])]}**.`, "");
  }
  L.push("## What this tool did and did not do", "",
    "- Read your exported eval definitions, run objects, output items and datasets. Nothing was uploaded anywhere.",
    "- Wrote one promptfoo project per eval (`promptfooconfig.yaml`, `tests.yaml`, `prompts/`, `graders/`).",
    "- Did **not** call any model or API. No scores were computed.",
    "- Did **not** migrate Agent Builder workflows (export those from the Agent Builder UI via Code, then Agents SDK) or hosted features that have no promptfoo equivalent.", "");
  if (r.warnings.length) {
    L.push("## All warnings", "");
    for (const w of r.warnings) L.push(`- ${w}`);
    L.push("");
  }
  return L.join("\n");
}

function rootReadme(r: ConvertResult): string {
  const L = ["# Migrated eval projects", "", "Generated by openai-exit-kit. Start with `MIGRATION_REPORT.md`.", "", "```bash"];
  for (const e of r.evals) L.push(`npx promptfoo validate config -c ${e.folder}/promptfooconfig.yaml`);
  L.push("```", "", "Validation does not call any model. `promptfoo eval` does (and needs your provider API keys).", "");
  return L.join("\n");
}

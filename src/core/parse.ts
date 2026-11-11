import type { EvalBundle, InputFile, Obj } from "./types";

export interface ParsedInputs {
  bundles: EvalBundle[];
  promptObjects: Obj[];
  /** Plain-text prompt files (name -> text), for the prompts converter. */
  promptTexts: { name: string; text: string }[];
  warnings: string[];
  ignored: string[];
}

export function parseJsonl(text: string): { rows: Obj[]; errors: number } {
  const rows: Obj[] = [];
  let errors = 0;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const v = JSON.parse(t);
      if (v && typeof v === "object") rows.push(v);
      else errors++;
    } catch {
      errors++;
    }
  }
  return { rows, errors };
}

const base = (name: string) => name.split(/[\\/]/).pop() ?? name;
const stem = (name: string) => base(name).replace(/\.(jsonl|json|txt|md)$/i, "");

type Kind = "eval" | "run" | "output_item" | "prompt" | "other";

function kindOf(o: Obj): Kind {
  if (!o || typeof o !== "object") return "other";
  if (o.object === "eval" || (Array.isArray(o.testing_criteria) && (o.data_source_config || o.name))) return "eval";
  if (o.object === "eval.run" || (o.eval_id && o.data_source && (o.status || o.result_counts))) return "run";
  if (o.object === "eval.run.output_item" || (Array.isArray(o.results) && o.datasource_item)) return "output_item";
  if (isPromptObject(o)) return "prompt";
  return "other";
}

export function isPromptObject(o: Obj): boolean {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  if (o.object === "prompt") return true;
  if (typeof o.id === "string" && o.id.startsWith("pmpt_")) return true;
  const hasBody = typeof o.instructions === "string" || Array.isArray(o.messages) || Array.isArray(o.input) || Array.isArray(o.versions) || typeof o.template === "string" || typeof o.text === "string" && o.variables;
  return Boolean(hasBody && (o.name || o.id || o.versions));
}

function unwrapList(v: any): Obj[] {
  if (Array.isArray(v)) return v.flatMap(unwrapList);
  if (v && typeof v === "object" && v.object === "list" && Array.isArray(v.data)) return v.data;
  if (v && typeof v === "object" && Array.isArray(v.data) && v.data.every((x: any) => x && typeof x === "object") && !v.testing_criteria) return v.data;
  return v && typeof v === "object" ? [v] : [];
}

/** Classify, group and link everything in a set of files. */
export function parseInputs(files: InputFile[]): ParsedInputs {
  const warnings: string[] = [];
  const ignored: string[] = [];
  const evals = new Map<string, Obj>();
  const runs: Obj[] = [];
  const outputItems: Obj[] = [];
  const datasets: Record<string, Obj[]> = {};
  const promptObjects: Obj[] = [];
  const promptTexts: { name: string; text: string }[] = [];

  for (const f of files) {
    const n = base(f.name);
    if (/^index\.json$/i.test(n) || /^manifest\.json$/i.test(n)) {
      // The index written by the export step: informational only.
      try {
        const idx = JSON.parse(f.text);
        if (Array.isArray(idx?.warnings) && idx.warnings.length) warnings.push(...idx.warnings.map((w: string) => `export warning: ${w}`));
      } catch { /* ignore */ }
      continue;
    }
    if (/\.(txt|md)$/i.test(n)) {
      if (!/^(readme|migration_report|launch)/i.test(n)) promptTexts.push({ name: stem(n), text: f.text });
      else ignored.push(f.name);
      continue;
    }
    if (/\.jsonl$/i.test(n)) {
      const { rows, errors } = parseJsonl(f.text);
      if (errors) warnings.push(`${f.name}: ${errors} line(s) were not valid JSON and were skipped.`);
      if (!rows.length) { ignored.push(f.name); continue; }
      const kinds = rows.map(kindOf);
      if (kinds.every((k) => k === "output_item")) { outputItems.push(...rows); continue; }
      if (kinds.every((k) => k === "run")) { runs.push(...rows); continue; }
      if (kinds.every((k) => k === "eval")) { for (const r of rows) evals.set(r.id ?? `eval_${evals.size}`, r); continue; }
      if (kinds.every((k) => k === "prompt")) { promptObjects.push(...rows); continue; }
      // Dataset rows: { item, sample? } or flat objects. Keyed by file stem (file id or run id).
      const key = stem(n).split(".")[0];
      datasets[key] = [...(datasets[key] ?? []), ...rows];
      // Also keep a "<run>.from_output_items" alias.
      if (/\.from_output_items$/i.test(stem(n))) datasets[stem(n)] = rows;
      continue;
    }
    if (/\.json$/i.test(n)) {
      let v: any;
      try { v = JSON.parse(f.text); } catch (e) { warnings.push(`${f.name}: not valid JSON (${(e as Error).message}).`); continue; }
      const items = unwrapList(v);
      let used = false;
      for (const o of items) {
        const k = kindOf(o);
        if (k === "eval") { evals.set(o.id ?? `eval_${evals.size}`, o); used = true; }
        else if (k === "run") { runs.push(o); used = true; }
        else if (k === "output_item") { outputItems.push(o); used = true; }
        else if (k === "prompt") { promptObjects.push(o); used = true; }
      }
      if (!used) ignored.push(f.name);
      continue;
    }
    ignored.push(f.name);
  }

  const bundles: EvalBundle[] = [];
  const orphanRuns = runs.filter((r) => !evals.has(r.eval_id));
  if (orphanRuns.length) warnings.push(`${orphanRuns.length} run(s) reference evals that are not in the input (${[...new Set(orphanRuns.map((r) => r.eval_id))].join(", ")}). Add the eval.json files.`);
  const itemsByRun: Record<string, Obj[]> = {};
  for (const it of outputItems) {
    const rid = it.run_id ?? "unknown";
    (itemsByRun[rid] ??= []).push(it);
  }
  for (const [id, evalObj] of evals) {
    const myRuns = runs.filter((r) => r.eval_id === id).sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
    const oi: Record<string, Obj[]> = {};
    for (const r of myRuns) if (itemsByRun[r.id]) oi[r.id] = itemsByRun[r.id];
    // Dashboard exports and some bundles have no run objects: group items by eval_id.
    if (!myRuns.length) {
      for (const [rid, its] of Object.entries(itemsByRun)) if (its.some((i) => i.eval_id === id)) oi[rid] = its;
    }
    bundles.push({ evalObj: { ...evalObj, id }, runs: myRuns, outputItems: oi, datasets });
  }
  const linked = new Set(bundles.flatMap((b) => Object.keys(b.outputItems)));
  const lone = Object.keys(itemsByRun).filter((r) => !linked.has(r));
  if (lone.length) warnings.push(`Output items for ${lone.length} run(s) could not be linked to an eval: ${lone.slice(0, 5).join(", ")}${lone.length > 5 ? ", ..." : ""}.`);
  return { bundles, promptObjects, promptTexts, warnings, ignored };
}

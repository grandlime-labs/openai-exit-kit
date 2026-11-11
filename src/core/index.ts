import { convertEvals } from "./convert";
import { parseInputs } from "./parse";
import { convertPrompts } from "./prompts";
import type { ConvertOptions, InputFile } from "./types";

export * from "./types";
export { convertEvals, summarizeRun } from "./convert";
export { mapGrader, parseLinearFormula } from "./graders";
export { parseInputs, parseJsonl, isPromptObject } from "./parse";
export { convertPrompts, normalizePrompt, generateTs, generatePy, extractVariables } from "./prompts";
export { lookupShutdown, SHUTDOWNS, DEPRECATIONS_CHECKED, DEPRECATIONS_SOURCE } from "./deprecations";

export interface RunAllResult {
  files: { path: string; content: string }[];
  warnings: string[];
  summary: string[];
}

/** Everything the web app and CLI do: classify the files, convert evals and prompt objects. */
export function runAll(inputs: InputFile[], options: ConvertOptions = {}): RunAllResult {
  const parsed = parseInputs(inputs);
  const files: { path: string; content: string }[] = [];
  const warnings = [...parsed.warnings];
  const summary: string[] = [];

  if (parsed.bundles.length) {
    const r = convertEvals(parsed.bundles, options);
    files.push(...r.files.map((f) => ({ path: `promptfoo/${f.path}`, content: f.content })));
    warnings.push(...r.warnings);
    const tests = r.evals.reduce((n, e) => n + e.testCount, 0);
    summary.push(`${r.evals.length} eval(s) converted, ${tests} test case(s) written.`);
  }
  if (parsed.promptObjects.length || parsed.promptTexts.length) {
    const r = convertPrompts(parsed.promptObjects, parsed.promptTexts);
    files.push(...r.files.map((f) => ({ path: `prompts-as-code/${f.path}`, content: f.content })));
    warnings.push(...r.warnings);
    summary.push(`${r.prompts.length} prompt(s) converted to TypeScript and Python.`);
  }
  if (!parsed.bundles.length && !parsed.promptObjects.length && !parsed.promptTexts.length) {
    summary.push("Nothing recognizable was found. Expected eval.json / runs.json / *.output_items.jsonl / dataset *.jsonl, or prompt object JSON.");
  }
  if (parsed.ignored.length) warnings.push(`Ignored files: ${parsed.ignored.slice(0, 8).join(", ")}${parsed.ignored.length > 8 ? ", ..." : ""}.`);
  return { files, warnings, summary };
}

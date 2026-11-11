/** Shared types. Loose by design: OpenAI exports vary by eval type and by date. */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Obj = Record<string, any>;

export type Fidelity = "exact" | "approximate" | "manual";

export interface InputFile {
  /** Path-like name, e.g. "eval_abc/runs/evalrun_1.output_items.jsonl". */
  name: string;
  text: string;
}

export interface PromptfooAssertion {
  type: string;
  value?: unknown;
  threshold?: number;
  weight?: number;
  metric?: string;
  provider?: unknown;
  /** Used by assert-set. */
  assert?: PromptfooAssertion[];
  [k: string]: unknown;
}

export interface GraderMapping {
  /** Grader name in the source eval. */
  name: string;
  /** Grader type in the source eval (string_check, python, ...). */
  sourceType: string;
  fidelity: Fidelity;
  assertions: PromptfooAssertion[];
  /** Extra files this grader needs (e.g. a python wrapper). path is relative to the eval folder. */
  files: { path: string; content: string }[];
  /** Human-readable explanation shown in the report. */
  notes: string[];
}

export interface RunSummary {
  id: string;
  name?: string;
  model?: string;
  dataSourceType?: string;
  sourceType?: string;
  createdAt?: number;
  status?: string;
  resultCounts?: { total?: number; passed?: number; failed?: number; errored?: number };
  /** Per-grader pass counts, from output items when available (else from the run object). */
  perGrader: { name: string; passed: number; total: number; meanScore?: number }[];
  outputItemCount: number;
}

export interface EvalBundle {
  evalObj: Obj;
  runs: Obj[];
  /** Output items by run id. */
  outputItems: Record<string, Obj[]>;
  /** Dataset rows by file id or run id (rows are { item, sample? } or flat objects). */
  datasets: Record<string, Obj[]>;
}

export interface ConvertOptions {
  /** Replace models with OpenAI's recommended replacement when they are being shut down. */
  replaceDeprecated?: boolean;
  /** Promptfoo provider id prefix; default "openai". */
  providerPrefix?: string;
  /** Override the generation date used in reports (tests). */
  now?: Date;
}

export interface ConvertResult {
  files: { path: string; content: string }[];
  warnings: string[];
  evals: {
    id: string;
    name: string;
    folder: string;
    graders: GraderMapping[];
    runs: RunSummary[];
    testCount: number;
    deprecatedModels: string[];
  }[];
}

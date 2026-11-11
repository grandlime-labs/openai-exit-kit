import type { GraderMapping, Obj, PromptfooAssertion } from "./types";
import {
  JS_PRELUDE,
  isOutputText,
  refsOf,
  slugify,
  toJsExpression,
  toPromptfooVars,
  toRubricVars,
} from "./template";

/** Python packages available to OpenAI python graders (image_tag 2025-05-08), per the Graders guide. */
const OPENAI_GRADER_PACKAGES: Record<string, string> = {
  numpy: "numpy", scipy: "scipy", sympy: "sympy", pandas: "pandas", rapidfuzz: "rapidfuzz",
  sklearn: "scikit-learn", rouge_score: "rouge-score", deepdiff: "deepdiff", jsonschema: "jsonschema",
  pydantic: "pydantic", yaml: "pyyaml", nltk: "nltk", sqlparse: "sqlparse", rdkit: "rdkit",
  skbio: "scikit-bio", ast_grep_py: "ast-grep-py",
};
const PY_STDLIB = new Set(["json", "re", "math", "typing", "collections", "itertools", "functools", "string", "statistics", "difflib", "unicodedata", "decimal", "fractions", "datetime", "random", "heapq", "bisect", "copy", "dataclasses", "enum", "operator", "textwrap", "html", "urllib", "ast", "__future__", "abc", "numbers", "hashlib", "base64", "csv", "io", "os", "sys", "time", "itertools"]);

export interface GraderContext {
  /** Names already used, to keep metric/file names unique. */
  usedNames: Set<string>;
}

export function newGraderContext(): GraderContext {
  return { usedNames: new Set() };
}

function uniqueName(ctx: GraderContext, base: string): string {
  const slug = slugify(base, "grader").replace(/-/g, "_");
  let name = slug;
  let i = 2;
  while (ctx.usedNames.has(name)) name = `${slug}_${i++}`;
  ctx.usedNames.add(name);
  return name;
}

/** OpenAI message content can be a string, {type,text}, or an array of those. */
export function contentToText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(contentToText).filter(Boolean).join("\n");
  if (typeof content === "object") {
    const o = content as Obj;
    if (typeof o.text === "string") return o.text;
    if (o.type === "input_image" || o.type === "input_audio") return `[${o.type} omitted]`;
  }
  return "";
}

function manualStub(name: string, sourceType: string, reason: string, original: unknown): GraderMapping {
  const value = `return { pass: false, score: 0, reason: ${JSON.stringify("MANUAL MIGRATION REQUIRED (" + name + "): " + reason)} };`;
  return {
    name,
    sourceType,
    fidelity: "manual",
    assertions: [{ type: "javascript", value, metric: name }],
    files: [],
    notes: [
      reason,
      "A deliberately failing placeholder assertion was emitted so this grader cannot silently pass. Replace it.",
      "Original grader JSON: `" + JSON.stringify(original).slice(0, 600) + "`",
    ],
  };
}

function jsAssertion(name: string, body: string, extra: Partial<PromptfooAssertion> = {}): PromptfooAssertion {
  return { type: "javascript", value: `${JS_PRELUDE}\n${body}`, metric: name, ...extra };
}

/* ---------------------------------- string_check ---------------------------------- */

function mapStringCheck(c: Obj, name: string): GraderMapping {
  const op: string = c.operation ?? "eq";
  const input: string = String(c.input ?? "");
  const reference: string = String(c.reference ?? "");
  const refRefs = refsOf(reference);
  const native: Record<string, string> = { eq: "equals", ne: "not-equals", neq: "not-equals", like: "contains", ilike: "icontains" };
  const notes: string[] = [];

  if (!(op in native)) {
    return manualStub(name, "string_check", `Unknown string_check operation "${op}".`, c);
  }
  if (op === "like") {
    notes.push("`like` is documented in the Graders guide as case-sensitive containment, so it maps to `contains`. It is not SQL LIKE with % wildcards; if your eval relied on wildcards, review it.");
  }

  if (isOutputText(input) && refRefs.sample.length === 0 && refRefs.other.length === 0) {
    return {
      name,
      sourceType: "string_check",
      fidelity: "exact",
      assertions: [{ type: native[op], value: toPromptfooVars(reference), metric: name }],
      files: [],
      notes,
    };
  }

  // General case: compile both templates to JS and compare.
  const a = toJsExpression(input);
  const b = toJsExpression(reference);
  const unsupported = [...a.unsupported, ...b.unsupported];
  if (unsupported.length) {
    return manualStub(name, "string_check", `Template variables not supported: ${unsupported.join(", ")}.`, c);
  }
  const cmp: Record<string, string> = {
    eq: "a === b",
    ne: "a !== b",
    neq: "a !== b",
    like: "a.includes(b)",
    ilike: "a.toLowerCase().includes(b.toLowerCase())",
  };
  notes.push("Input/reference are not the simple `{{sample.output_text}}` vs `{{item.x}}` shape, so a JavaScript assertion reproduces the comparison exactly.");
  return {
    name,
    sourceType: "string_check",
    fidelity: "exact",
    assertions: [jsAssertion(name, `const a = ${a.expr};\nconst b = ${b.expr};\nconst pass = ${cmp[op]};\nreturn { pass, score: pass ? 1 : 0, reason: ${JSON.stringify(`string_check ${op}`)} };`)],
    files: [],
    notes,
  };
}

/* -------------------------------- text_similarity --------------------------------- */

const ROUGE_N_JS = `const tok = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) || []);
const grams = (t, n) => { const m = new Map(); for (let i = 0; i + n <= t.length; i++) { const k = t.slice(i, i + n).join(' '); m.set(k, (m.get(k) || 0) + 1); } return m; };
const ca = tok(a), cb = tok(b);
const ga = grams(ca, N), gb = grams(cb, N);
let overlap = 0; for (const [k, v] of ga) overlap += Math.min(v, gb.get(k) || 0);
const na = Math.max(ca.length - N + 1, 0), nb = Math.max(cb.length - N + 1, 0);
const p = na ? overlap / na : 0, r = nb ? overlap / nb : 0;
const score = p + r ? (2 * p * r) / (p + r) : 0;`;

const LEV_JS = `const lev = (x, y) => { const m = x.length, n = y.length; let prev = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)); prev = cur; } return prev[n]; };
const score = 1 - lev(a, b) / (Math.max(a.length, b.length) || 1);`;

function mapTextSimilarity(c: Obj, name: string): GraderMapping {
  const metric: string = c.evaluation_metric ?? "fuzzy_match";
  const input = String(c.input ?? "{{ sample.output_text }}");
  const reference = String(c.reference ?? "");
  const threshold: number = typeof c.pass_threshold === "number" ? c.pass_threshold : 0.5;
  const notes: string[] = [];
  const nativeOk = isOutputText(input) && refsOf(reference).sample.length === 0;

  const native = (type: string, extra: Partial<PromptfooAssertion> = {}, note?: string): GraderMapping => {
    if (note) notes.push(note);
    return {
      name,
      sourceType: "text_similarity",
      fidelity: "approximate",
      assertions: [{ type, value: toPromptfooVars(reference), threshold, metric: name, ...extra }],
      files: [],
      notes,
    };
  };

  switch (metric) {
    case "cosine":
      if (!nativeOk) break;
      return native("similar", {}, "OpenAI computes cosine similarity with `text-embedding-3-large`; the config sets promptfoo's embedding provider to the same model, but scores can still differ slightly. Re-baseline.");
    case "bleu":
      if (!nativeOk) break;
      return native("bleu", {}, "BLEU implementations differ in tokenization and smoothing. Compare scores on your own data before trusting the threshold.");
    case "gleu":
      if (!nativeOk) break;
      return native("gleu", {}, "GLEU implementations differ in tokenization. Re-baseline the threshold.");
    case "meteor":
      if (!nativeOk) break;
      return native("meteor", {}, "METEOR depends on WordNet/stemming details that differ between implementations. Re-baseline the threshold.");
    case "rouge_1":
      if (!nativeOk) break;
      return native("rouge-n", {}, "promptfoo's `rouge-n` is unigram ROUGE-N (F1). Tokenization differs from OpenAI's `rouge-score`; re-baseline.");
    case "rouge_l":
      if (!nativeOk) break;
      return native("rouge-l", {}, "Tokenization differs from OpenAI's `rouge-score`; re-baseline.");
    case "fuzzy_match":
    case "rouge_2":
    case "rouge_3":
    case "rouge_4":
    case "rouge_5": {
      const a = toJsExpression(input);
      const b = toJsExpression(reference);
      const unsupported = [...a.unsupported, ...b.unsupported];
      if (unsupported.length) return manualStub(name, "text_similarity", `Template variables not supported: ${unsupported.join(", ")}.`, c);
      let body: string;
      if (metric === "fuzzy_match") {
        notes.push("OpenAI uses `rapidfuzz` (WRatio). This is a normalized Levenshtein ratio on lower-cased, trimmed text: same idea, different numbers. Re-baseline the threshold.");
        body = `const a = ${a.expr}.toLowerCase().trim();\nconst b = ${b.expr}.toLowerCase().trim();\n${LEV_JS}`;
      } else {
        const n = Number(metric.slice(-1));
        notes.push(`promptfoo has no ROUGE-${n} assertion; this is a small F1 over ${n}-grams with simple tokenization. Different from \`rouge-score\`; re-baseline.`);
        body = `const a = ${a.expr};\nconst b = ${b.expr};\nconst N = ${n};\n${ROUGE_N_JS}`;
      }
      body += `\nreturn { pass: score >= ${threshold}, score, reason: ${JSON.stringify(metric)} + ' ' + score.toFixed(3) + ' (threshold ${threshold})' };`;
      return { name, sourceType: "text_similarity", fidelity: "approximate", assertions: [jsAssertion(name, body)], files: [], notes };
    }
    default:
      return manualStub(name, "text_similarity", `Unknown evaluation_metric "${metric}".`, c);
  }
  return manualStub(name, "text_similarity", `\`${metric}\` with a non-default input (${JSON.stringify(input)}) needs a custom assertion.`, c);
}

/* ------------------------------------ model graders ------------------------------------ */

function messagesToRubricMessages(input: unknown): { messages: { role: string; content: string }[]; unsupported: string[] } {
  const unsupported: string[] = [];
  const list = Array.isArray(input) ? input : [];
  const messages = list.map((m: Obj) => {
    const t = toRubricVars(contentToText(m.content));
    unsupported.push(...t.unsupported);
    const role = m.role === "developer" ? "system" : String(m.role ?? "user");
    return { role, content: t.text };
  });
  return { messages, unsupported };
}

function mapLabelModel(c: Obj, name: string): GraderMapping {
  const labels: string[] = Array.isArray(c.labels) ? c.labels : [];
  const passing: string[] = Array.isArray(c.passing_labels) ? c.passing_labels : [];
  const { messages, unsupported } = messagesToRubricMessages(c.input);
  const notes = [
    "LLM-as-a-judge: the original messages are replayed as promptfoo's `rubricPrompt`, with a closing instruction that passes only when the label is in `passing_labels`. Judge behavior can differ from OpenAI's structured-output grader; validate before relying on it.",
  ];
  if (unsupported.length) notes.push(`Template variables approximated by the full output text: ${[...new Set(unsupported)].join(", ")}.`);
  messages.push({
    role: "user",
    content:
      `Choose exactly one label for the content above from: ${JSON.stringify(labels)}. ` +
      `Respond ONLY with JSON: {"reason": "<short reason>", "label": "<one label>", "pass": <true if the label is one of ${JSON.stringify(passing)}, else false>, "score": <1 if pass else 0>}.`,
  });
  const provider = c.model ? `openai:chat:${c.model}` : undefined;
  return {
    name,
    sourceType: "label_model",
    fidelity: "approximate",
    assertions: [{ type: "llm-rubric", value: `Label the output with one of ${JSON.stringify(labels)}; pass only for ${JSON.stringify(passing)}.`, rubricPrompt: messages, ...(provider ? { provider } : {}), metric: name }],
    files: [],
    notes,
  };
}

function mapScoreModel(c: Obj, name: string): GraderMapping {
  const range: number[] = Array.isArray(c.range) && c.range.length === 2 ? c.range : [0, 1];
  const [lo, hi] = range;
  const passRaw: number = typeof c.pass_threshold === "number" ? c.pass_threshold : (lo + hi) / 2;
  const norm = hi === lo ? passRaw : (passRaw - lo) / (hi - lo);
  const { messages, unsupported } = messagesToRubricMessages(c.input);
  const notes = [
    "LLM-as-a-judge: the original messages are replayed as promptfoo's `rubricPrompt`. OpenAI's score_model also returned reasoning steps in a fixed schema; this asks for a normalized 0-1 score plus a reason. Scores will move; re-baseline the threshold.",
  ];
  if (typeof c.pass_threshold !== "number") notes.push(`No pass_threshold in the source grader; defaulted to the midpoint of the range (${passRaw}).`);
  if (lo !== 0 || hi !== 1) notes.push(`Score range [${lo}, ${hi}] is normalized to 0-1; threshold ${passRaw} becomes ${Number(norm.toFixed(4))}.`);
  if (unsupported.length) notes.push(`Template variables approximated by the full output text: ${[...new Set(unsupported)].join(", ")}.`);
  messages.push({
    role: "user",
    content:
      `Score the content above on the range [${lo}, ${hi}] following the instructions. ` +
      `Respond ONLY with JSON: {"reason": "<short reason>", "raw_score": <number in [${lo}, ${hi}]>, "score": <raw_score normalized to 0-1 as (raw_score - ${lo}) / ${hi - lo || 1}>, "pass": <true if score >= ${Number(norm.toFixed(4))}, else false>}.`,
  });
  const provider = c.model ? `openai:chat:${c.model}` : undefined;
  return {
    name,
    sourceType: "score_model",
    fidelity: "approximate",
    assertions: [{ type: "llm-rubric", value: `Score the output on [${lo}, ${hi}]; pass at ${passRaw}.`, threshold: Number(norm.toFixed(4)), rubricPrompt: messages, ...(provider ? { provider } : {}), metric: name }],
    files: [],
    notes,
  };
}

/* -------------------------------------- python -------------------------------------- */

function mapPython(c: Obj, name: string, fileBase: string): GraderMapping {
  const source: string = String(c.source ?? "");
  const threshold: number = typeof c.pass_threshold === "number" ? c.pass_threshold : 0.5;
  const notes: string[] = [];
  if (!/def\s+grade\s*\(/.test(source)) {
    return manualStub(name, "python", "The grader source has no `def grade(sample, item)` function.", c);
  }
  if (typeof c.pass_threshold !== "number") notes.push("No pass_threshold in the source grader; defaulted to 0.5. Verify.");

  const usesUnavailable = /\bsample\s*\[\s*["'](choices|output_tools|output_audio)["']\s*\]|\bsample\.get\(\s*["'](choices|output_tools|output_audio)["']/.test(source);
  const needs = new Set<string>();
  for (const m of source.matchAll(/^\s*(?:from\s+([A-Za-z_][\w]*)(?:\.[\w.]*)?\s+import|import\s+([A-Za-z_][\w]*))/gm)) {
    const mod = (m[1] ?? m[2]) as string;
    if (!PY_STDLIB.has(mod) && OPENAI_GRADER_PACKAGES[mod]) needs.add(OPENAI_GRADER_PACKAGES[mod]);
    else if (!PY_STDLIB.has(mod) && !OPENAI_GRADER_PACKAGES[mod]) needs.add(`${mod} (not in OpenAI's grader image list; check it)`);
  }
  if (needs.size) notes.push(`Python packages used by this grader: ${[...needs].join(", ")}. Install them in the environment that runs promptfoo (\`pip install ...\`).`);
  notes.push("The original `grade(sample, item)` is kept verbatim. A generated adapter calls it with `sample` built from the model output (`output_text`, and `output_json` if the output parses as JSON) and `item` set to the test vars. OpenAI's grader ran in a network-less sandbox; promptfoo runs it on your machine.");
  if (usesUnavailable) notes.push("This grader reads `choices`, `output_tools` or `output_audio`, which the adapter cannot provide. Rewrite those parts by hand.");

  const wrapper = [
    "",
    "",
    "# ---- promptfoo adapter (generated by openai-exit-kit; the code above is your original grader) ----",
    "import json as _json",
    `_PASS_THRESHOLD = ${threshold}`,
    "",
    "",
    "def get_assert(output, context):",
    "    _item = dict((context or {}).get('vars') or {})",
    "    _text = output if isinstance(output, str) else _json.dumps(output)",
    "    _sample = {'output_text': _text, 'output_json': {}, 'output_tools': [], 'choices': [], 'output_audio': {}}",
    "    try:",
    "        _sample['output_json'] = _json.loads(_text)",
    "    except Exception:",
    "        pass",
    "    try:",
    "        _score = float(grade(_sample, _item))",
    "    except Exception as exc:  # OpenAI marked errors/invalid floats as 0",
    "        return {'pass': False, 'score': 0.0, 'reason': f'grade() failed: {exc}'}",
    "    return {'pass': _score >= _PASS_THRESHOLD, 'score': _score, 'reason': f'grade() returned {_score} (threshold {_PASS_THRESHOLD})'}",
    "",
  ].join("\n");

  const path = `graders/${fileBase}.py`;
  return {
    name,
    sourceType: "python",
    fidelity: usesUnavailable ? "manual" : "approximate",
    assertions: [{ type: "python", value: `file://${path}`, metric: name }],
    files: [{ path, content: source.replace(/\s+$/, "") + wrapper }],
    notes,
  };
}

/* --------------------------------------- multi --------------------------------------- */

/** Parse `0.5*a + 0.5*b` (or `a*0.5`, or bare `a`) into weights. Returns undefined if non-linear. */
export function parseLinearFormula(formula: string, names: string[]): Record<string, number> | undefined {
  const cleaned = formula.replace(/\s+/g, "");
  if (!cleaned) return undefined;
  const terms = cleaned.split(/\+(?![^()]*\))/);
  const out: Record<string, number> = {};
  for (const t of terms) {
    let m = t.match(/^(-?\d*\.?\d+)\*([A-Za-z_][\w-]*)$/) ?? t.match(/^([A-Za-z_][\w-]*)\*(-?\d*\.?\d+)$/);
    let coef: number, nm: string;
    if (m) {
      if (/^[A-Za-z_]/.test(m[1])) { nm = m[1]; coef = Number(m[2]); } else { coef = Number(m[1]); nm = m[2]; }
    } else if (/^[A-Za-z_][\w-]*$/.test(t)) {
      nm = t; coef = 1;
    } else return undefined;
    if (!names.includes(nm) || coef < 0 || Number.isNaN(coef)) return undefined;
    out[nm] = (out[nm] ?? 0) + coef;
  }
  return out;
}

function mapMulti(c: Obj, name: string, ctx: GraderContext): GraderMapping {
  const subs: Record<string, Obj> = c.graders && typeof c.graders === "object" ? c.graders : {};
  const names = Object.keys(subs);
  const formula: string = String(c.calculate_output ?? "");
  const notes: string[] = [];
  const files: { path: string; content: string }[] = [];
  const children: PromptfooAssertion[] = [];
  const childMaps: GraderMapping[] = [];
  const origName = new Map<GraderMapping, string>();
  for (const n of names) {
    const mapped = mapGrader({ ...subs[n], name: n }, ctx);
    childMaps.push(mapped);
    origName.set(mapped, n);
    files.push(...mapped.files);
  }
  const weights = parseLinearFormula(formula, names);
  if (!weights) {
    const m = manualStub(name, "multi", `calculate_output \`${formula}\` is not a simple weighted sum of grader names, so it cannot be mapped to a promptfoo assert-set automatically. The sub-graders were converted individually below.`, c);
    // Still emit the converted children as notes so the user has a starting point.
    m.assertions = [...m.assertions, ...childMaps.flatMap((x) => x.assertions)];
    m.files = files;
    m.notes.push(...childMaps.map((x) => `Sub-grader \`${x.name}\` (${x.sourceType}) converted as ${x.fidelity}.`));
    return m;
  }
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  for (const cm of childMaps) {
    const w = weights[origName.get(cm) as string] ?? 0;
    if (w === 0) continue;
    for (const a of cm.assertions) children.push({ ...a, weight: w });
    notes.push(`Sub-grader \`${cm.name}\` (${cm.sourceType}): ${cm.fidelity}; weight ${w}.`);
    notes.push(...cm.notes.map((n) => `  - ${cm.name}: ${n}`));
  }
  const threshold = typeof c.pass_threshold === "number" ? c.pass_threshold / total : 0.5;
  if (typeof c.pass_threshold !== "number") notes.push("No pass_threshold on the multi grader; defaulted to 0.5 of the weighted score. Verify.");
  notes.push(`\`${formula}\` becomes a weighted average (weights normalized by ${Number(total.toFixed(4))}) inside a promptfoo \`assert-set\`; threshold ${Number(threshold.toFixed(4))}.`);
  const worst = childMaps.some((x) => x.fidelity === "manual") ? "manual" : childMaps.some((x) => x.fidelity === "approximate") ? "approximate" : "exact";
  return {
    name,
    sourceType: "multi",
    fidelity: worst,
    assertions: [{ type: "assert-set", metric: name, threshold: Number(threshold.toFixed(4)), assert: children }],
    files,
    notes,
  };
}

/* --------------------------------------- entry --------------------------------------- */

export function mapGrader(c: Obj, ctx: GraderContext = newGraderContext()): GraderMapping {
  const name = uniqueName(ctx, String(c.name ?? c.id ?? c.type ?? "grader"));
  switch (c.type) {
    case "string_check":
    case "string-check-grader":
      return mapStringCheck(c, name);
    case "text_similarity":
    case "text-similarity-grader":
      return mapTextSimilarity(c, name);
    case "label_model":
    case "label-model-grader":
      return mapLabelModel(c, name);
    case "score_model":
    case "score-model-grader":
      return mapScoreModel(c, name);
    case "python":
    case "python-grader":
      return mapPython(c, name, name);
    case "multi":
    case "multi-grader":
      return mapMulti(c, name, ctx);
    default:
      return manualStub(name, String(c.type ?? "unknown"), `Unsupported grader type "${String(c.type)}".`, c);
  }
}

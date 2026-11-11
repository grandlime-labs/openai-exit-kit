/**
 * Template helpers. OpenAI Evals templates look like `{{ item.foo }}` and
 * `{{ sample.output_text }}`; promptfoo (nunjucks) uses plain test vars: `{{ foo }}`.
 */

const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export interface TemplateRefs {
  item: string[]; // dotted paths below "item."
  sample: string[]; // dotted paths below "sample."
  other: string[]; // anything else
}

export function refsOf(tpl: string): TemplateRefs {
  const refs: TemplateRefs = { item: [], sample: [], other: [] };
  for (const m of tpl.matchAll(TOKEN)) {
    const expr = m[1].trim();
    if (expr.startsWith("item.")) refs.item.push(expr.slice(5));
    else if (expr.startsWith("sample.")) refs.sample.push(expr.slice(7));
    else refs.other.push(expr);
  }
  return refs;
}

/** `{{ item.a.b }}` -> `{{ a.b }}`. `sample.*` is left as-is (callers decide). */
export function toPromptfooVars(tpl: string): string {
  return tpl.replace(TOKEN, (_all, expr: string) => {
    const e = expr.trim();
    if (e.startsWith("item.")) return `{{ ${e.slice(5)} }}`;
    return `{{ ${e} }}`;
  });
}

/** For rubric prompts: item.x -> x, sample.output_text -> output (promptfoo's rubricPrompt variable). */
export function toRubricVars(tpl: string): { text: string; unsupported: string[] } {
  const unsupported: string[] = [];
  const text = tpl.replace(TOKEN, (_all, expr: string) => {
    const e = expr.trim();
    if (e.startsWith("item.")) return `{{ ${e.slice(5)} }}`;
    if (e === "sample.output_text") return "{{ output }}";
    if (e.startsWith("sample.output_json")) {
      // The grader prompt gets the raw output text, which contains the JSON.
      unsupported.push(e);
      return "{{ output }}";
    }
    if (e.startsWith("sample.")) {
      unsupported.push(e);
      return "{{ output }}";
    }
    return `{{ ${e} }}`;
  });
  return { text, unsupported };
}

function pathAccessor(path: string[], root: string): string {
  return path.reduce((acc, k) => `${acc}?.[${JSON.stringify(k)}]`, root);
}

/**
 * Compile a template to a JS expression usable inside a promptfoo `javascript` assertion
 * (where `output` and `context.vars` exist). Returns the expression text.
 */
export function toJsExpression(tpl: string): { expr: string; unsupported: string[] } {
  const unsupported: string[] = [];
  const parts: string[] = [];
  let last = 0;
  for (const m of tpl.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(JSON.stringify(tpl.slice(last, idx)));
    const e = m[1].trim();
    if (e.startsWith("item.")) {
      parts.push(`__s(${pathAccessor(e.slice(5).split("."), "context.vars")})`);
    } else if (e === "sample.output_text") {
      parts.push("__s(output)");
    } else if (e.startsWith("sample.output_json")) {
      const rest = e.slice("sample.output_json".length).replace(/^\./, "");
      const path = rest ? rest.split(".") : [];
      parts.push(`__s(${pathAccessor(path, "__json(output)")})`);
    } else {
      unsupported.push(e);
      parts.push(JSON.stringify(m[0]));
    }
    last = idx + m[0].length;
  }
  if (last < tpl.length) parts.push(JSON.stringify(tpl.slice(last)));
  return { expr: parts.length ? parts.join(" + ") : '""', unsupported };
}

/** JS prelude for generated javascript assertions. */
export const JS_PRELUDE = [
  "const __s = (v) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v));",
  "const __json = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(String(v)); } catch { return undefined; } };",
].join("\n");

/** True if the template is exactly `{{ sample.output_text }}` (ignoring spaces). */
export function isOutputText(tpl: string): boolean {
  return /^\s*\{\{\s*sample\.output_text\s*\}\}\s*$/.test(tpl);
}

/** Extract plain variable names (top-level, no dots) from `{{ name }}` placeholders. */
export function placeholderNames(tpl: string): string[] {
  const names = new Set<string>();
  for (const m of tpl.matchAll(TOKEN)) {
    const base = m[1].trim().split(/[.\s|[]/)[0];
    if (base) names.add(base);
  }
  return [...names];
}

export function slugify(s: string, fallback = "item"): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return out || fallback;
}

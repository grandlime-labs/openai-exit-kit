import { contentToText } from "./graders";
import { isPromptObject } from "./parse";
import { slugify } from "./template";
import type { Obj } from "./types";

export interface PromptMessage { role: string; content: string }
export interface PromptVersion {
  version: string;
  messages: PromptMessage[];
  variables: string[];
  /** Variable name -> example value declared in the source, if any. */
  examples: Record<string, unknown>;
  model?: string;
  notes: string[];
}
export interface NormalizedPrompt {
  id: string;
  name: string;
  description?: string;
  versions: PromptVersion[];
  latest: string;
}
export interface PromptsResult {
  files: { path: string; content: string }[];
  prompts: NormalizedPrompt[];
  warnings: string[];
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;
const TS_RESERVED = new Set(["break","case","catch","class","const","continue","debugger","default","delete","do","else","enum","export","extends","false","finally","for","function","if","import","in","instanceof","new","null","return","super","switch","this","throw","true","try","typeof","var","void","while","with","yield","let","static","implements","interface","package","private","protected","public","await","async","of","type"]);
const PY_RESERVED = new Set(["False","None","True","and","as","assert","async","await","break","class","continue","def","del","elif","else","except","finally","for","from","global","if","import","in","is","lambda","nonlocal","not","or","pass","raise","return","try","while","with","yield","match","case"]);

function words(s: string): string[] {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
}
export const toCamel = (s: string): string => {
  const w = words(s).map((x) => x.toLowerCase());
  let out = w.map((x, i) => (i === 0 ? x : x[0].toUpperCase() + x.slice(1))).join("");
  if (!out || /^[0-9]/.test(out)) out = "v" + out;
  return TS_RESERVED.has(out) ? out + "_" : out;
};
export const toPascal = (s: string): string => {
  const c = words(s).map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join("");
  return /^[0-9]/.test(c) || !c ? "P" + c : c;
};
export const toSnake = (s: string): string => {
  let out = words(s).map((x) => x.toLowerCase()).join("_");
  if (!out || /^[0-9]/.test(out)) out = "v_" + out;
  return PY_RESERVED.has(out) ? out + "_" : out;
};

function varKey(expr: string): string {
  return expr.trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "value";
}

export function extractVariables(text: string): string[] {
  const set = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER)) set.add(varKey(m[1]));
  return [...set];
}

/* ------------------------------------- normalization ------------------------------------- */

function messagesFrom(v: Obj, notes: string[]): PromptMessage[] {
  const out: PromptMessage[] = [];
  const norm = (m: Obj): PromptMessage => ({ role: m.role === "developer" ? "system" : String(m.role ?? "user"), content: contentToText(m.content ?? m.text) });
  if (Array.isArray(v.messages)) out.push(...v.messages.map(norm));
  else {
    if (typeof v.instructions === "string") out.push({ role: "system", content: v.instructions });
    if (Array.isArray(v.input)) out.push(...v.input.map(norm));
    else if (typeof v.input === "string") out.push({ role: "user", content: v.input });
    for (const key of ["template", "text", "content", "prompt"]) {
      if (!out.length && typeof v[key] === "string") out.push({ role: "system", content: v[key] });
    }
  }
  if (out.some((m) => m.role === "system") && JSON.stringify(v).includes('"developer"')) notes.push("`developer` messages were written as `system` (equivalent for OpenAI models).");
  const blob = JSON.stringify(v);
  if (blob.includes("input_image") || blob.includes("input_file") || blob.includes("input_audio")) notes.push("Image/file/audio parts were dropped; only text was converted.");
  return out.filter((m) => m.content !== "");
}

function declaredVariables(v: Obj): { names: string[]; examples: Record<string, unknown> } {
  const examples: Record<string, unknown> = {};
  let names: string[] = [];
  const dv = v.variables;
  if (Array.isArray(dv)) names = dv.map((x: any) => (typeof x === "string" ? x : String(x?.name ?? ""))).filter(Boolean);
  else if (dv && typeof dv === "object") {
    names = Object.keys(dv);
    for (const [k, val] of Object.entries(dv)) if (val !== null && typeof val !== "object") examples[k] = val;
  }
  return { names: names.map(varKey), examples };
}

export function normalizePrompt(o: Obj, fallbackName = "prompt"): NormalizedPrompt {
  const id = String(o.id ?? o.prompt_id ?? fallbackName);
  const name = String(o.name ?? o.title ?? (id.startsWith("pmpt_") ? fallbackName : id));
  const rawVersions: Obj[] = Array.isArray(o.versions) && o.versions.length ? o.versions : [o];
  const versions: PromptVersion[] = rawVersions.map((v, i) => {
    const notes: string[] = [];
    const messages = messagesFrom(v, notes);
    const decl = declaredVariables(v.variables !== undefined ? v : o);
    const found = extractVariables(messages.map((m) => m.content).join("\n"));
    const variables = [...new Set([...decl.names, ...found])];
    const missing = found.filter((x) => decl.names.length && !decl.names.includes(x));
    if (missing.length) notes.push(`Placeholders used but not declared in \`variables\`: ${missing.join(", ")}.`);
    const unused = decl.names.filter((x) => !found.includes(x));
    if (unused.length) notes.push(`Variables declared but never used in the text: ${unused.join(", ")}.`);
    if (/\{\{[^}]*[|(][^}]*\}\}/.test(messages.map((m) => m.content).join("\n"))) notes.push("Some placeholders contain filters or expressions; they were turned into plain variables. Check them.");
    if (!messages.length) notes.push("No message text found in this version.");
    const ver = String(v.version ?? v.id ?? v.number ?? (rawVersions.length === 1 ? (o.version ?? o.latest_version ?? "1") : i + 1));
    return { version: ver, messages, variables, examples: decl.examples, model: typeof v.model === "string" ? v.model : typeof o.model === "string" ? o.model : undefined, notes };
  });
  const declaredLatest = o.latest_version ?? o.default_version ?? o.latest;
  const latest = declaredLatest !== undefined && versions.some((v) => v.version === String(declaredLatest)) ? String(declaredLatest) : versions[versions.length - 1].version;
  return { id, name, description: typeof o.description === "string" ? o.description : undefined, versions, latest };
}

/* --------------------------------------- generators --------------------------------------- */

const vs = (v: string) => v.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "0";
const tsTemplateEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

function tsTemplate(text: string, vars: Map<string, string>): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    const idx = m.index ?? 0;
    out += tsTemplateEscape(text.slice(last, idx)) + "${" + (vars.get(varKey(m[1])) ?? "undefined") + "}";
    last = idx + m[0].length;
  }
  return "`" + out + tsTemplateEscape(text.slice(last)) + "`";
}

function pyStr(literal: string): string {
  // JSON string escaping is valid Python string escaping for our purposes (no U+2028 issues in py3).
  return JSON.stringify(literal).slice(1, -1);
}
function pyFString(text: string, vars: Map<string, string>): string {
  let out = "";
  let last = 0;
  const lit = (s: string) => pyStr(s.replace(/\{/g, "{{").replace(/\}/g, "}}"));
  for (const m of text.matchAll(PLACEHOLDER)) {
    const idx = m.index ?? 0;
    out += lit(text.slice(last, idx)) + "{" + (vars.get(varKey(m[1])) ?? "None") + "}";
    last = idx + m[0].length;
  }
  return 'f"' + out + lit(text.slice(last)) + '"';
}

export function generateTs(p: NormalizedPrompt): string {
  const base = toPascal(p.name);
  const L: string[] = [];
  L.push(`// Generated by openai-exit-kit from prompt object ${JSON.stringify(p.id)} (${JSON.stringify(p.name)}).`);
  L.push("// OpenAI's `prompt: { id, version, variables }` is going away (v1/prompts shuts down 2026-11-30).");
  L.push("// Keep this file in your repo, review prompt changes in PRs, and pass the result as `input`.", "");
  L.push("export interface Message { role: \"system\" | \"user\" | \"assistant\"; content: string }", "");
  for (const v of p.versions) {
    const vars = new Map(v.variables.map((n) => [n, toCamel(n)] as const));
    const iface = `${base}V${vs(v.version)}Vars`;
    const fn = `build${base}V${vs(v.version)}`;
    for (const n of v.notes) L.push(`// NOTE (version ${v.version}): ${n}`);
    if (v.variables.length) {
      L.push(`export interface ${iface} {`);
      for (const n of v.variables) {
        const ex = v.examples[n];
        L.push(`  ${vars.get(n)}: string;${ex !== undefined ? ` // e.g. ${JSON.stringify(ex)}` : ""}${vars.get(n) !== n ? ` // prompt variable "${n}"` : ""}`);
      }
      L.push("}", "");
    }
    const arg = v.variables.length ? `{ ${v.variables.map((n) => vars.get(n)).join(", ")} }: ${iface}` : "";
    L.push(`/** Version ${JSON.stringify(v.version)} of ${JSON.stringify(p.name)}. */`);
    L.push(`export function ${fn}(${arg}): Message[] {`, "  return [");
    for (const m of v.messages) L.push(`    { role: ${JSON.stringify(m.role)}, content: ${tsTemplate(m.content, vars)} },`);
    L.push("  ];", "}", "");
    if (v.model) L.push(`export const ${fn.replace(/^build/, "model")} = ${JSON.stringify(v.model)};`, "");
  }
  const latest = p.versions.find((v) => v.version === p.latest) ?? p.versions[p.versions.length - 1];
  L.push(`/** Latest version (${JSON.stringify(latest.version)}). */`);
  L.push(`export const build${base} = build${base}V${vs(latest.version)};`);
  if (latest.variables.length) L.push(`export type ${base}Vars = ${base}V${vs(latest.version)}Vars;`);
  L.push("", "/* Usage:");
  const callVars = latest.variables.map((n) => `${toCamel(n)}: ${JSON.stringify(latest.examples[n] ?? `<${n}>`)}`).join(", ");
  L.push(" *   const response = await client.responses.create({");
  L.push(` *     model: ${JSON.stringify(latest.model ?? "YOUR_MODEL")},`);
  L.push(` *     input: build${base}(${latest.variables.length ? `{ ${callVars} }` : ""}),`);
  L.push(" *   });", " */", "");
  return L.join("\n");
}

export function generatePy(p: NormalizedPrompt): string {
  const base = toSnake(p.name);
  const L: string[] = [];
  L.push(`"""Generated by openai-exit-kit from prompt object ${JSON.stringify(p.id)} (${JSON.stringify(p.name)}).`, "");
  L.push("OpenAI's `prompt={'id', 'version', 'variables'}` is going away (v1/prompts shuts down 2026-11-30).");
  L.push("Keep this file in your repo, review prompt changes in PRs, and pass the result as `input`.", '"""', "");
  L.push("from __future__ import annotations", "");
  for (const v of p.versions) {
    const vars = new Map(v.variables.map((n) => [n, toSnake(n)] as const));
    const fn = `build_${base}_v${vs(v.version).toLowerCase()}`;
    L.push("");
    const args = v.variables.length ? "*, " + v.variables.map((n) => `${vars.get(n)}: str`).join(", ") : "";
    L.push(`def ${fn}(${args}) -> list[dict[str, str]]:`);
    L.push(`    """Version ${JSON.stringify(v.version)} of ${JSON.stringify(p.name)}."""`);
    for (const n of v.notes) L.push(`    # NOTE: ${n}`);
    L.push("    return [");
    for (const m of v.messages) L.push(`        {"role": ${JSON.stringify(m.role)}, "content": ${pyFString(m.content, vars)}},`);
    L.push("    ]", "");
    if (v.model) L.push(`${fn.replace(/^build_/, "").toUpperCase()}_MODEL = ${JSON.stringify(v.model)}`, "");
  }
  const latest = p.versions.find((v) => v.version === p.latest) ?? p.versions[p.versions.length - 1];
  L.push("", `# Latest version (${JSON.stringify(latest.version)}).`);
  L.push(`build_${base} = build_${base}_v${vs(latest.version).toLowerCase()}`, "");
  return L.join("\n");
}

export function convertPrompts(objects: Obj[], texts: { name: string; text: string }[] = []): PromptsResult {
  const warnings: string[] = [];
  const list: Obj[] = [];
  for (const o of objects) {
    if (o && typeof o === "object" && !Array.isArray(o) && !isPromptObject(o)) { warnings.push("Skipped an object that does not look like a prompt object."); continue; }
    list.push(o);
  }
  for (const t of texts) list.push({ id: t.name, name: t.name, instructions: t.text });
  const prompts = list.map((o, i) => normalizePrompt(o, `prompt_${i + 1}`));
  const files: { path: string; content: string }[] = [];
  const used = new Set<string>();
  const manifest: Obj[] = [];
  for (const p of prompts) {
    let slug = slugify(p.name, "prompt");
    if (used.has(slug)) slug += `-${slugify(p.id).slice(-6)}`;
    used.add(slug);
    files.push({ path: `ts/${slug}.ts`, content: generateTs(p) });
    files.push({ path: `py/${slug.replace(/-/g, "_")}.py`, content: generatePy(p) });
    const base = toPascal(p.name);
    manifest.push({ id: p.id, name: p.name, latest: p.latest, ts: `ts/${slug}.ts`, py: `py/${slug.replace(/-/g, "_")}.py`, versions: p.versions.map((v) => ({ version: v.version, variables: v.variables, tsFunction: `build${base}V${vs(v.version)}`, pyFunction: `build_${toSnake(p.name)}_v${vs(v.version).toLowerCase()}`, model: v.model ?? null })) });
    for (const v of p.versions) for (const n of v.notes) warnings.push(`${p.name} v${v.version}: ${n}`);
    if (p.versions.some((v) => !v.messages.length)) warnings.push(`${p.name}: a version has no messages; check the input shape.`);
  }
  files.push({ path: "prompts-manifest.json", content: JSON.stringify(manifest, null, 2) + "\n" });
  files.push({ path: "MIGRATION_PROMPTS.md", content: promptsReport(prompts, manifest, warnings) });
  return { files, prompts, warnings };
}

function promptsReport(prompts: NormalizedPrompt[], manifest: Obj[], warnings: string[]): string {
  const L: string[] = ["# Prompt object migration", "",
    "OpenAI's guide says to move prompt content into your code, replace variables with function arguments, and pass messages as `input` to the Responses API (https://developers.openai.com/api/docs/guides/prompting/migrate-from-prompt-object). This folder does the mechanical part.", "",
    "## What was converted", "", "| Prompt | Id | Versions | Variables (latest) |", "| --- | --- | --- | --- |"];
  for (const p of prompts) {
    const lv = p.versions.find((v) => v.version === p.latest) ?? p.versions[p.versions.length - 1];
    L.push(`| ${p.name} | \`${p.id}\` | ${p.versions.map((v) => v.version).join(", ")} | ${lv.variables.join(", ") || "-"} |`);
  }
  L.push("", "## Replace your call sites", "", "Before:", "", "```ts", "client.responses.create({ prompt: { id: \"pmpt_...\", version: \"1\", variables: { ... } } })", "```", "", "After (see `prompts-manifest.json` for the function that matches each id + version):", "", "```ts", "client.responses.create({ model: \"...\", input: buildYourPrompt({ ... }) })", "```", "");
  L.push("Things the prompt object carried that are **not** in the generated code unless your export included them: the model, tools, reasoning effort and response format that were stored with the prompt. Set those explicitly in your API call.", "");
  L.push("Static text first, dynamic text last keeps prompt-cache hits (OpenAI's guide notes cache hits depend on exact prefix matches).", "");
  if (warnings.length) { L.push("## Warnings", ""); for (const w of warnings) L.push(`- ${w}`); L.push(""); }
  L.push("## Not covered", "", "- OpenAI documents no export API for stored prompts. This tool reads JSON you copy from the dashboard or saved yourself, plus plain `.txt`/`.md` prompt files. The accepted shapes are listed in the README.", "- Agent Builder workflows (export those via Code, then Agents SDK in the Agent Builder UI).", "");
  void manifest;
  return L.join("\n");
}

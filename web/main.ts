import { zipSync, strToU8 } from "fflate";
import { runAll, type InputFile, type RunAllResult } from "../src/core/index";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const samples = import.meta.glob("../fixtures/{evals-export,prompts}/**/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

let inputs: InputFile[] = [];
let result: RunAllResult | undefined;
let selected: string | undefined;

const ACCEPT = /\.(json|jsonl|txt|md)$/i;

function setInputs(files: InputFile[], append = false): void {
  const kept = files.filter((f) => ACCEPT.test(f.name));
  const merged = append ? [...inputs.filter((e) => !kept.some((k) => k.name === e.name)), ...kept] : kept;
  inputs = merged;
  const skipped = files.length - kept.length;
  $("loaded").textContent = inputs.length
    ? `${inputs.length} file(s) loaded${skipped ? `, ${skipped} skipped (not .json/.jsonl/.txt/.md)` : ""}.`
    : "No files loaded.";
  render();
}

async function fromFileList(list: FileList | File[]): Promise<InputFile[]> {
  const out: InputFile[] = [];
  for (const f of Array.from(list)) {
    if (!ACCEPT.test(f.name)) continue;
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
    // Drop the top-level folder name so paths look like <eval>/eval.json
    const name = rel ? rel.split("/").slice(1).join("/") || f.name : f.name;
    out.push({ name, text: await f.text() });
  }
  return out;
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: InputFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    if (ACCEPT.test(file.name)) out.push({ name: prefix + file.name, text: await file.text() });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walkEntry(e, prefix + (entry.name ? entry.name + "/" : ""), out);
    }
  }
}

function render(): void {
  const results = $("results");
  if (!inputs.length) {
    results.hidden = true;
    result = undefined;
    return;
  }
  try {
    result = runAll(inputs, { replaceDeprecated: $<HTMLInputElement>("opt-replace").checked });
  } catch (e) {
    result = { files: [], warnings: [`Conversion failed: ${(e as Error).message}`], summary: [] };
  }
  results.hidden = false;
  const summary = $("summary");
  summary.replaceChildren(...result.summary.map((s) => Object.assign(document.createElement("li"), { textContent: s })));
  const warnings = $("warnings");
  warnings.replaceChildren(...result.warnings.map((s) => Object.assign(document.createElement("li"), { textContent: s })));
  $("warn-title").textContent = `Warnings (${result.warnings.length})`;
  $("warn-box").hidden = result.warnings.length === 0;
  ($("zip") as HTMLButtonElement).disabled = result.files.length === 0;

  const list = $("filelist");
  list.replaceChildren(
    ...result.files.map((f) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = f.path;
      b.addEventListener("click", () => select(f.path));
      li.append(b);
      return li;
    }),
  );
  const first = result.files.find((f) => f.path.endsWith("promptfoo/MIGRATION_REPORT.md")) ?? result.files[0];
  select(selected && result.files.some((f) => f.path === selected) ? selected : first?.path);
}

function select(path: string | undefined): void {
  selected = path;
  const file = result?.files.find((f) => f.path === path);
  $("preview-name").textContent = file ? file.path : "-";
  $("preview").textContent = file ? file.content : "";
  ($("dl-one") as HTMLButtonElement).disabled = !file;
  for (const b of $("filelist").querySelectorAll("button")) b.setAttribute("aria-current", String(b.textContent === path));
}

function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("dl-one").addEventListener("click", () => {
  const f = result?.files.find((x) => x.path === selected);
  if (f) download(f.path.split("/").pop() ?? "file.txt", f.content, "text/plain");
});

$("zip").addEventListener("click", () => {
  if (!result) return;
  const tree: Record<string, Uint8Array> = {};
  for (const f of result.files) tree[f.path] = strToU8(f.content);
  download("openai-exit-kit-output.zip", zipSync(tree) as unknown as BlobPart, "application/zip");
});

$<HTMLInputElement>("pick-files").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  if (input.files) setInputs(await fromFileList(input.files), true);
  input.value = "";
});
$<HTMLInputElement>("pick-folder").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement;
  if (input.files) setInputs(await fromFileList(input.files), true);
  input.value = "";
});
$("opt-replace").addEventListener("change", render);
$("clear").addEventListener("click", () => { selected = undefined; setInputs([]); });
$("sample").addEventListener("click", () => {
  const files: InputFile[] = Object.entries(samples).map(([path, text]) => ({ name: path.replace(/^\.\.\/fixtures\//, ""), text }));
  setInputs(files);
});

const drop = $("drop");
for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
drop.addEventListener("drop", async (e) => {
  e.preventDefault();
  const dt = (e as DragEvent).dataTransfer;
  if (!dt) return;
  const out: InputFile[] = [];
  const entries = Array.from(dt.items ?? []).map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
  if (entries.length) for (const en of entries) await walkEntry(en, "", out);
  else out.push(...(await fromFileList(dt.files)));
  setInputs(out, true);
});
drop.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") $<HTMLInputElement>("pick-files").click(); });

$("build-note").textContent = "Runs entirely in this page. A Content-Security-Policy with connect-src 'none' blocks network requests.";

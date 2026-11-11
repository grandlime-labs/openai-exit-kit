/**
 * Read-only exporter for the OpenAI Evals API. Only issues GET requests.
 * Endpoints (from the API reference): GET /evals, /evals/{id}, /evals/{id}/runs,
 * /evals/{id}/runs/{run}/output_items, and /files/{id}/content for file-backed datasets.
 */
export interface ExportOptions {
  apiKey: string;
  baseUrl?: string;
  project?: string;
  organization?: string;
  maxOutputItems?: number;
  fetchImpl?: typeof fetch;
  write: (path: string, content: string) => void | Promise<void>;
  log?: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface ExportResult {
  evals: number;
  runs: number;
  outputItems: number;
  datasetFiles: number;
  warnings: string[];
}

export async function exportEvals(o: ExportOptions): Promise<ExportResult> {
  const base = (o.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = o.log ?? (() => {});
  const warnings: string[] = [];
  const headers: Record<string, string> = { Authorization: `Bearer ${o.apiKey}`, "User-Agent": "openai-exit-kit/0.1" };
  if (o.organization) headers["OpenAI-Organization"] = o.organization;
  if (o.project) headers["OpenAI-Project"] = o.project;

  async function get(path: string, params?: Record<string, string | number>, raw = false): Promise<any> {
    const url = base + path + (params ? "?" + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() : "");
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(url, { method: "GET", headers });
      if (res.ok) return raw ? await res.text() : await res.json();
      if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 5) {
        await sleep(Math.min(30000, 500 * 2 ** attempt));
        continue;
      }
      let detail = "";
      try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
      throw new Error(`HTTP ${res.status} on ${path}: ${detail}`);
    }
  }

  async function* pages(path: string, cap?: number): AsyncGenerator<any> {
    const params: Record<string, string | number> = { limit: 100, order: "asc" };
    let seen = 0;
    for (;;) {
      let page: any;
      try {
        page = await get(path, params);
      } catch (e) {
        if (String((e as Error).message).startsWith("HTTP 400") && "limit" in params && !("after" in params)) { delete params.limit; continue; }
        throw e;
      }
      const data: any[] = page.data ?? [];
      for (const d of data) {
        if (cap !== undefined && seen >= cap) return;
        seen++;
        yield d;
      }
      if (!page.has_more || !data.length) return;
      params.after = page.last_id ?? data[data.length - 1].id;
    }
  }

  const result: ExportResult = { evals: 0, runs: 0, outputItems: 0, datasetFiles: 0, warnings };
  const evals: any[] = [];
  for await (const e of pages("/evals")) evals.push(e);
  log(`${evals.length} eval(s) found`);
  const index: any[] = [];
  const max = o.maxOutputItems ?? 100000;

  for (const e of evals) {
    const dir = e.id;
    let full = e;
    try { full = await get(`/evals/${encodeURIComponent(e.id)}`); } catch (err) { warnings.push(`${e.id}: kept the list copy of the eval (${(err as Error).message})`); }
    await o.write(`${dir}/eval.json`, JSON.stringify(full, null, 2));
    const runs: any[] = [];
    try { for await (const r of pages(`/evals/${encodeURIComponent(e.id)}/runs`)) runs.push(r); } catch (err) { warnings.push(`${e.id}: could not list runs (${(err as Error).message})`); }
    await o.write(`${dir}/runs.json`, JSON.stringify({ object: "list", data: runs }, null, 2));
    const fileIds = new Set<string>();
    let itemTotal = 0;
    for (const r of runs) {
      const src = r.data_source?.source ?? {};
      if (src.type === "file_id" && src.id) fileIds.add(src.id);
      if (max <= 0) continue;
      const lines: string[] = [];
      const rebuilt: string[] = [];
      try {
        for await (const it of pages(`/evals/${encodeURIComponent(e.id)}/runs/${encodeURIComponent(r.id)}/output_items`, max)) {
          lines.push(JSON.stringify(it));
          if (it.datasource_item != null) rebuilt.push(JSON.stringify({ item: it.datasource_item }));
        }
      } catch (err) { warnings.push(`${e.id}/${r.id}: output items stopped after ${lines.length} (${(err as Error).message})`); }
      if (lines.length >= max) warnings.push(`${e.id}/${r.id}: stopped at maxOutputItems=${max}`);
      await o.write(`${dir}/runs/${r.id}.output_items.jsonl`, lines.join("\n") + (lines.length ? "\n" : ""));
      if (rebuilt.length) await o.write(`${dir}/datasets/${r.id}.from_output_items.jsonl`, rebuilt.join("\n") + "\n");
      itemTotal += lines.length;
    }
    for (const fid of fileIds) {
      try {
        await o.write(`${dir}/datasets/${fid}.jsonl`, await get(`/files/${encodeURIComponent(fid)}/content`, undefined, true));
        result.datasetFiles++;
      } catch (err) { warnings.push(`${e.id}: dataset file ${fid} not downloaded (${(err as Error).message})`); }
    }
    result.evals++;
    result.runs += runs.length;
    result.outputItems += itemTotal;
    index.push({ id: e.id, name: full.name, runs: runs.length, output_items: itemTotal, dataset_files: [...fileIds] });
    log(`  ${e.id} ${full.name ?? ""}: ${runs.length} runs, ${itemTotal} output items, ${fileIds.size} dataset files`);
  }
  await o.write("index.json", JSON.stringify({ exported_at: Math.floor(Date.now() / 1000), api: base, evals: index, warnings }, null, 2));
  return result;
}

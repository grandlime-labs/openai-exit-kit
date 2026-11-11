// A tiny local stand-in for the OpenAI API, used ONLY by tests and scripts/verify-promptfoo.mjs.
// It never talks to the network. Chat/Responses/Embeddings return deterministic canned data;
// the Evals/Files GET endpoints serve the bundled fixtures so the exporter can be tested.
import http from "node:http";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const fixtures = new URL("../fixtures/evals-export/", import.meta.url).pathname;

function embed(text) {
  const v = new Array(16).fill(0);
  for (let i = 0; i < text.length; i++) v[i % 16] += text.charCodeAt(i) % 31;
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / n);
}

function loadEvals() {
  return readdirSync(fixtures, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().map((id) => ({
    id,
    eval: JSON.parse(readFileSync(join(fixtures, id, "eval.json"), "utf8")),
    runs: JSON.parse(readFileSync(join(fixtures, id, "runs.json"), "utf8")).data,
  }));
}

export async function startMockOpenAI({ failFirstEvalsCall = false } = {}) {
  const evals = loadEvals();
  const requests = [];
  let flaked = !failFirstEvalsCall;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname.replace(/^\/v1/, "");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ method: req.method, path, auth: req.headers.authorization });
      const send = (obj, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      const page = (arr) => {
        const after = url.searchParams.get("after");
        const limit = Number(url.searchParams.get("limit") ?? 20);
        let start = 0;
        if (after) start = arr.findIndex((x) => x.id === after) + 1;
        const data = arr.slice(start, start + limit);
        return { object: "list", data, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null, has_more: start + limit < arr.length };
      };
      if (req.method === "POST" && path === "/chat/completions") {
        const j = JSON.parse(body || "{}");
        const text = JSON.stringify(j.messages ?? "");
        const content = text.includes("raw_score") ? JSON.stringify({ reason: "mock grader", raw_score: 8, score: 0.8, pass: true }) : "Technology";
        return send({ id: "chatcmpl-mock", object: "chat.completion", created: 0, model: j.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      }
      if (req.method === "POST" && path === "/responses") {
        const j = JSON.parse(body || "{}");
        return send({ id: "resp_mock", object: "response", created_at: 0, status: "completed", model: j.model, output: [{ type: "message", id: "msg_mock", status: "completed", role: "assistant", content: [{ type: "output_text", text: "Technology", annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
      }
      if (req.method === "POST" && path === "/embeddings") {
        const j = JSON.parse(body || "{}");
        const inputs = Array.isArray(j.input) ? j.input : [j.input];
        return send({ object: "list", model: j.model, data: inputs.map((t, index) => ({ object: "embedding", index, embedding: embed(String(t)) })), usage: { prompt_tokens: 1, total_tokens: 1 } });
      }
      if (req.method !== "GET") return send({ error: { message: "mock is read-only for this path" } }, 405);
      if (path === "/evals") {
        if (!flaked) { flaked = true; return send({ error: { message: "rate limited (mock)" } }, 429); }
        return send(page(evals.map((e) => ({ ...e.eval, testing_criteria: undefined }))));
      }
      let m = path.match(/^\/evals\/([^/]+)$/);
      if (m) { const e = evals.find((x) => x.id === m[1]); return e ? send(e.eval) : send({ error: { message: "not found" } }, 404); }
      m = path.match(/^\/evals\/([^/]+)\/runs$/);
      if (m) { const e = evals.find((x) => x.id === m[1]); return e ? send(page(e.runs)) : send({ error: { message: "not found" } }, 404); }
      m = path.match(/^\/evals\/([^/]+)\/runs\/([^/]+)\/output_items$/);
      if (m) {
        const f = join(fixtures, m[1], "runs", `${m[2]}.output_items.jsonl`);
        if (!existsSync(f)) return send({ error: { message: "not found" } }, 404);
        const items = readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
        return send(page(items));
      }
      m = path.match(/^\/files\/([^/]+)\/content$/);
      if (m) {
        const e = evals.find((x) => existsSync(join(fixtures, x.id, "datasets", `${m[1]}.jsonl`)));
        if (!e) return send({ error: { message: "not found" } }, 404);
        res.writeHead(200, { "content-type": "application/octet-stream" });
        return res.end(readFileSync(join(fixtures, e.id, "datasets", `${m[1]}.jsonl`)));
      }
      send({ error: { message: `mock: unknown path ${path}` } }, 404);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return { url: `http://127.0.0.1:${port}/v1`, requests, close: () => new Promise((r) => server.close(r)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = await startMockOpenAI();
  console.log(`mock OpenAI listening at ${m.url} (Ctrl+C to stop)`);
}

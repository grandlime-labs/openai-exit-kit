import { describe, expect, it } from "vitest";
import { exportEvals } from "../src/core/exporter";
import { runAll } from "../src/core/index";
import { startMockOpenAI } from "../scripts/mock-openai.mjs";

describe("exportEvals against a local mock API", () => {
  it("downloads evals, runs, output items and dataset files using only GET, and the result converts", async () => {
    const mock = await startMockOpenAI({ failFirstEvalsCall: true });
    try {
      const written = new Map<string, string>();
      const r = await exportEvals({ apiKey: "sk-mock", baseUrl: mock.url, write: (p, c) => void written.set(p, c), sleep: async () => {} });
      expect(r.evals).toBe(4);
      expect(r.runs).toBe(6);
      expect(r.outputItems).toBe(10 + 10 + 6 + 6 + 5 + 4);
      expect(r.datasetFiles).toBe(1);
      expect(written.has("eval_fx_support_quality/datasets/file-fxSupport01.jsonl")).toBe(true);
      expect(written.has("index.json")).toBe(true);
      // read-only, authenticated, and retried the one 429
      expect(mock.requests.every((q) => q.method === "GET")).toBe(true);
      expect(mock.requests.every((q) => q.auth === "Bearer sk-mock")).toBe(true);
      expect(mock.requests.filter((q) => q.path === "/evals").length).toBe(2);
      // round trip: exported files convert to the same four projects
      const res = runAll([...written].map(([name, text]) => ({ name, text })));
      expect(res.summary[0]).toMatch(/4 eval\(s\) converted/);
    } finally {
      await mock.close();
    }
  });

  it("reports a clear error for a rejected key", async () => {
    const mock = await startMockOpenAI();
    try {
      await expect(exportEvals({ apiKey: "x", baseUrl: mock.url + "/nope", write: () => {}, sleep: async () => {} })).rejects.toThrow(/HTTP 404/);
    } finally {
      await mock.close();
    }
  });
});

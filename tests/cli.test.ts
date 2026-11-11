import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { startMockOpenAI } from "../scripts/mock-openai.mjs";
import { FIX, ROOT } from "./helpers";

const CLI = join(ROOT, "dist", "cli", "index.js");
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync("node", [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

beforeAll(() => {
  execFileSync("node", [join(ROOT, "scripts", "build-cli.mjs")], { cwd: ROOT });
});

describe("CLI end to end on the fixtures", () => {
  it("prints help and version", () => {
    expect(run(["--help"]).stdout).toContain("openai-exit-kit export");
    expect(run(["--version"]).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(run(["models"]).stdout).toContain("gpt-4o-mini-2024-07-18");
  });

  it("convert writes promptfoo projects and the report", () => {
    const out = mkdtempSync(join(tmpdir(), "exitkit-cli-"));
    const r = run(["convert", join(FIX, "evals-export"), join(FIX, "prompts"), "--out", out]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("4 eval(s) converted, 25 test case(s) written.");
    for (const f of ["promptfoo/MIGRATION_REPORT.md", "promptfoo/support-reply-quality/promptfooconfig.yaml", "prompts-as-code/ts/support-reply.ts"]) {
      expect(existsSync(join(out, f)), f).toBe(true);
    }
    expect(readFileSync(join(out, "promptfoo/MIGRATION_REPORT.md"), "utf8")).toContain("OpenAI Evals to promptfoo");
  });

  it("prompts converts prompt objects and text files", () => {
    const out = mkdtempSync(join(tmpdir(), "exitkit-cli-"));
    const r = run(["prompts", join(FIX, "prompts"), "--out", out]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("3 prompt(s)");
    expect(existsSync(join(out, "py/release_notes.py"))).toBe(true);
  });

  it("fails clearly with no --out, no input, or nothing recognizable", () => {
    expect(run(["convert", join(FIX, "evals-export")]).status).toBe(1);
    const empty = mkdtempSync(join(tmpdir(), "exitkit-empty-"));
    const r = run(["convert", empty, "--out", join(empty, "o")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Nothing recognizable/);
    expect(run(["bogus", "--out", "x"]).status).toBe(1);
  });

  it("export refuses to run without OPENAI_API_KEY", () => {
    const r = run(["export", "--out", join(tmpdir(), "nope")], { OPENAI_API_KEY: "" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("OPENAI_API_KEY");
  });

  it("export then convert works against the local mock API", async () => {
    const mock = await startMockOpenAI();
    try {
      const dir = mkdtempSync(join(tmpdir(), "exitkit-exp-"));
      const exp = await new Promise<{ status: number | null; stdout: string }>((resolve) => {
        const c = spawn("node", [CLI, "export", "--out", dir], { env: { ...process.env, OPENAI_API_KEY: "sk-mock", OPENAI_BASE_URL: mock.url } });
        let stdout = "";
        c.stdout.on("data", (d: Buffer) => (stdout += d));
        c.on("close", (status: number | null) => resolve({ status, stdout }));
      });
      expect(exp.status).toBe(0);
      expect(exp.stdout).toContain("4 eval(s), 6 run(s)");
      const out = join(dir, "converted");
      const conv = run(["convert", dir, "--out", out]);
      expect(conv.status).toBe(0);
      expect(conv.stdout).toContain("4 eval(s) converted");
    } finally {
      await mock.close();
    }
  });
});

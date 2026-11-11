import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { convertPrompts, extractVariables, parseInputs } from "../src/core/index";
import { ROOT, promptFixtures } from "./helpers";

const parsed = parseInputs(promptFixtures());
const res = convertPrompts(parsed.promptObjects, parsed.promptTexts);
const tmp = mkdtempSync(join(tmpdir(), "exitkit-"));

async function loadTs(path: string): Promise<Record<string, any>> {
  const src = res.files.find((f) => f.path === path)!.content;
  const js = transformSync(src, { loader: "ts", format: "esm", target: "es2022" }).code;
  const file = join(tmp, path.replace(/\W/g, "_") + ".mjs");
  writeFileSync(file, js);
  return import(pathToFileURL(file).href);
}

describe("extractVariables", () => {
  it("finds distinct placeholders with or without spaces", () => {
    expect(extractVariables("Hi {{name}} and {{ name }} and {{ plan.tier }}")).toEqual(["name", "plan_tier"]);
  });
});

describe("generated TypeScript", () => {
  it("passes tsc --strict for every generated file", () => {
    const dir = mkdtempSync(join(tmpdir(), "exitkit-tsc-"));
    const files: string[] = [];
    for (const f of res.files.filter((x) => x.path.endsWith(".ts"))) {
      const p = join(dir, f.path);
      mkdirSync(join(dir, "ts"), { recursive: true });
      writeFileSync(p, f.content);
      files.push(p);
    }
    expect(files.length).toBeGreaterThan(0);
    const tsc = join(ROOT, "node_modules", ".bin", "tsc");
    expect(() => execFileSync(tsc, ["--ignoreConfig", "--noEmit", "--strict", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", "--skipLibCheck", ...files], { encoding: "utf8" })).not.toThrow();
  });

  it("builds messages with variables substituted and literals preserved", async () => {
    const m = await loadTs("ts/support-reply.ts");
    const msgs = m.buildSupportReply({ customerName: "Ana", issue: "refund", planTier: "Pro", outputFormat: "json" });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("when json is json");
    expect(msgs[0].content).toContain("${price} USD");
    expect(msgs[0].content).toContain('{"reply": "...", "tone": "friendly"}');
    expect(msgs[0].content).toContain("`code`");
    expect(msgs[1].content).toContain("Customer name: Ana. Plan: Pro. Issue: refund.");
    expect(msgs[1].content).toContain("café, 日本語");
    expect(msgs[1].content).toContain('Backslash \\ and "quotes"');
  });

  it("keeps older versions callable", async () => {
    const m = await loadTs("ts/support-reply.ts");
    const v1 = m.buildSupportReplyV1({ customerName: "Bo", issue: "login" });
    expect(v1[0].content).toContain("Customer name: Bo. Issue: login.");
    expect(m.modelSupportReplyV3).toBe("gpt-5.6-terra");
  });
});

describe("generated Python", () => {
  const py = (code: string, file: string) => {
    const src = res.files.find((f) => f.path === file)!.content;
    const dir = mkdtempSync(join(tmpdir(), "exitkit-py-"));
    writeFileSync(join(dir, "mod.py"), src);
    return execFileSync("python3", ["-c", `import json, sys\nsys.path.insert(0, ${JSON.stringify(dir)})\nimport mod\n${code}`], { encoding: "utf8" });
  };

  it("matches the TypeScript output exactly for the same inputs", async () => {
    const m = await loadTs("ts/support-reply.ts");
    const fromTs = m.buildSupportReply({ customerName: "Ana", issue: "refund", planTier: "Pro", outputFormat: "json" });
    const fromPy = JSON.parse(py('print(json.dumps(mod.build_support_reply(customer_name="Ana", issue="refund", plan_tier="Pro", output_format="json"), ensure_ascii=False))', "py/support_reply.py"));
    expect(fromPy).toEqual(fromTs);
  });

  it("the triage prompt works too", () => {
    const out = JSON.parse(py('print(json.dumps(mod.build_ticket_triage(ticket_text="It broke")))', "py/ticket_triage.py"));
    expect(out[1]).toEqual({ role: "user", content: "It broke" });
  });
});

describe("manifest and docs", () => {
  it("lists versions and variables", () => {
    const manifest = JSON.parse(res.files.find((f) => f.path === "prompts-manifest.json")!.content);
    const s = manifest.find((p: any) => p.name === "support-reply");
    expect(s.latest).toBe("3");
    expect(s.versions.map((v: any) => v.version)).toEqual(["1", "2", "3"]);
    expect(s.versions[2].variables).toEqual(expect.arrayContaining(["customer_name", "plan_tier"]));
  });
  it("converts plain text prompts", () => {
    expect(res.files.map((f) => f.path)).toEqual(expect.arrayContaining(["ts/release-notes.ts", "py/release_notes.py"]));
  });
});

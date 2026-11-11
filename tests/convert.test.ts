import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { parseInputs, parseJsonl, runAll } from "../src/core/index";
import { lookupShutdown } from "../src/core/deprecations";
import { evalFixtures, promptFixtures } from "./helpers";

const NOW = new Date("2026-11-10T12:00:00Z");

describe("parseJsonl", () => {
  it("skips blank and broken lines and counts errors", () => {
    const r = parseJsonl('{"a":1}\n\nnot json\n{"b":2}\n');
    expect(r.rows).toEqual([{ a: 1 }, { b: 2 }]);
    expect(r.errors).toBe(1);
  });
});

describe("parseInputs on the fixtures", () => {
  const p = parseInputs([...evalFixtures(), ...promptFixtures()]);
  it("finds four evals with their runs, output items and datasets linked", () => {
    expect(p.bundles).toHaveLength(4);
    const support = p.bundles.find((b) => b.evalObj.id === "eval_fx_support_quality")!;
    expect(support.runs).toHaveLength(2);
    expect(Object.keys(support.outputItems)).toHaveLength(2);
    expect(Object.values(support.outputItems)[0]).toHaveLength(6);
    expect(Object.keys(support.datasets)).toContain("file-fxSupport01");
  });
  it("finds two prompt objects and one plain text prompt", () => {
    expect(p.promptObjects).toHaveLength(2);
    expect(p.promptTexts).toHaveLength(1);
  });
  it("warns about orphan run files instead of crashing", () => {
    const q = parseInputs([{ name: "x/runs/evalrun_zzz.output_items.jsonl", text: '{"object":"eval.run.output_item","id":"o1","eval_id":"eval_missing","run_id":"evalrun_zzz","results":[]}\n' }]);
    expect(q.bundles).toHaveLength(0);
    expect(q.warnings.length).toBeGreaterThan(0);
  });
});

describe("deprecations", () => {
  it("flags models by shutdown date relative to now", () => {
    expect(lookupShutdown("gpt-4o-mini-2024-07-18", NOW)).toMatchObject({ date: "2027-01-14", alreadyShutDown: false });
    expect(lookupShutdown("o3-mini-2025-01-31", NOW)).toMatchObject({ alreadyShutDown: true });
    expect(lookupShutdown("some-other-model", NOW)).toBeUndefined();
  });
});

describe("runAll on the fixtures", () => {
  const res = runAll([...evalFixtures(), ...promptFixtures()], { now: NOW });
  const get = (p: string) => res.files.find((f) => f.path === p)?.content;

  it("writes a project per eval plus reports", () => {
    const paths = res.files.map((f) => f.path);
    for (const slug of ["news-headline-topic-classifier", "support-reply-quality", "pre-computed-summary-checks", "push-notification-summaries"]) {
      expect(paths).toContain(`promptfoo/${slug}/promptfooconfig.yaml`);
      expect(paths).toContain(`promptfoo/${slug}/tests.yaml`);
      expect(paths).toContain(`promptfoo/${slug}/MIGRATION_REPORT.md`);
    }
    expect(paths).toContain("promptfoo/MIGRATION_REPORT.md");
    expect(paths).toContain("prompts-as-code/MIGRATION_PROMPTS.md");
  });

  it("emits YAML that parses and references its tests and prompt files", () => {
    const cfg = parseYaml(get("promptfoo/news-headline-topic-classifier/promptfooconfig.yaml")!);
    expect(cfg.tests).toBe("file://tests.yaml");
    expect(cfg.prompts).toEqual(["file://prompts/main.json"]);
    expect(cfg.providers.map((p: any) => p.id)).toEqual(expect.arrayContaining(["openai:chat:gpt-4o-mini-2024-07-18"]));
    expect(cfg.defaultTest.assert.map((a: any) => a.type)).toEqual(["equals", "icontains"]);
    const tests = parseYaml(get("promptfoo/news-headline-topic-classifier/tests.yaml")!);
    expect(tests).toHaveLength(10);
    expect(tests[0].vars).toEqual({ input: "Tech Company Launches Advanced Artificial Intelligence Platform", ground_truth: "Technology" });
  });

  it("recovers the dataset from a file_id run and from stored-completion output items", () => {
    const support = parseYaml(get("promptfoo/support-reply-quality/tests.yaml")!);
    expect(support).toHaveLength(6);
    const push = parseYaml(get("promptfoo/push-notification-summaries/tests.yaml")!);
    expect(push).toHaveLength(4);
    expect(push[0].vars.input).toContain("Alice");
  });

  it("converts the prompt template, mapping developer to system and {{item.x}} to {{x}}", () => {
    const messages = JSON.parse(get("promptfoo/news-headline-topic-classifier/prompts/main.json")!);
    expect(messages[0].role).toBe("system");
    expect(messages[1]).toEqual({ role: "user", content: "{{ input }}" });
  });

  it("uses the echo provider for pre-computed outputs", () => {
    const cfg = parseYaml(get("promptfoo/pre-computed-summary-checks/promptfooconfig.yaml")!);
    expect(cfg.providers[0].id).toBe("echo");
  });

  it("states the fidelity of every grader and flags shut-down models in the root report", () => {
    const report = get("promptfoo/MIGRATION_REPORT.md")!;
    expect(report).toMatch(/exact/);
    expect(report).toMatch(/approximate/);
    expect(report).toContain("gpt-4o-mini-2024-07-18");
    expect(report).toContain("o3-mini-2025-01-31");
    expect(report).toMatch(/shut down on 2026-10-23/);
    const sup = get("promptfoo/support-reply-quality/MIGRATION_REPORT.md")!;
    expect(sup).toContain("| `length_and_keyword_check` | python | **approximate** | python |");
    expect(sup).toContain("Baseline from your OpenAI runs");
  });

  it("includes the user's python grader verbatim in graders/", () => {
    const py = get("promptfoo/support-reply-quality/graders/length_and_keyword_check.py")!;
    expect(py).toContain("fuzz.WRatio(out, ref");
    expect(py).toContain("def get_assert");
  });

  it("does not call out to any model: no api keys or urls other than documentation links", () => {
    const urls = res.files.flatMap((f) => f.content.match(/https?:\/\/[^\s)"'>]+/g) ?? []);
    for (const u of urls) expect(u).toMatch(/^https:\/\/(developers\.openai\.com|platform\.openai\.com|promptfoo\.dev|www\.promptfoo\.dev|github\.com)/);
    expect(res.files.map((f) => f.content).join("\n")).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  });

  it("--replace-deprecated swaps in a replacement id", () => {
    const r = runAll(evalFixtures(), { now: NOW, replaceDeprecated: true });
    const cfg = parseYaml(r.files.find((f) => f.path === "promptfoo/news-headline-topic-classifier/promptfooconfig.yaml")!.content);
    const ids = cfg.providers.map((p: any) => p.id as string);
    expect(ids.some((i: string) => i.includes("gpt-4o-mini-2024-07-18"))).toBe(false);
  });

  it("returns a helpful message for unrecognized input", () => {
    const r = runAll([{ name: "random.json", text: '{"hello":"world"}' }]);
    expect(r.files).toHaveLength(0);
    expect(r.summary.join(" ")).toMatch(/Nothing recognizable/);
  });
});

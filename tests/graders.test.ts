import { describe, expect, it } from "vitest";
import { mapGrader, parseLinearFormula } from "../src/core/graders";
import { runJsAssertion } from "./helpers";

const OUT = "{{ sample.output_text }}";

describe("string_check", () => {
  it.each([
    ["eq", "equals"],
    ["ne", "not-equals"],
    ["like", "contains"],
    ["ilike", "icontains"],
  ])("maps %s to promptfoo %s, exactly", (operation, type) => {
    const m = mapGrader({ type: "string_check", name: "g", input: OUT, operation, reference: "{{ item.label }}" });
    expect(m.fidelity).toBe("exact");
    expect(m.assertions).toHaveLength(1);
    expect(m.assertions[0].type).toBe(type);
    expect(m.assertions[0].value).toBe("{{ label }}");
  });

  it("keeps reversed operands exact by compiling to javascript", () => {
    const m = mapGrader({ type: "string_check", name: "rev", input: "{{ item.fact }}", operation: "ilike", reference: "{{ item.kw }}" });
    expect(m.fidelity).toBe("exact");
    expect(m.assertions[0].type).toBe("javascript");
    const body = String(m.assertions[0].value);
    expect(runJsAssertion(body, "ignored", { fact: "Drafts are kept for 30 DAYS", kw: "30 days" }).pass).toBe(true);
    expect(runJsAssertion(body, "ignored", { fact: "nothing here", kw: "30 days" }).pass).toBe(false);
  });
});

describe("text_similarity", () => {
  it("maps cosine to similar with the threshold, flagged approximate", () => {
    const m = mapGrader({ type: "text_similarity", name: "sim", input: OUT, reference: "{{ item.ref }}", evaluation_metric: "cosine", pass_threshold: 0.8 });
    expect(m.fidelity).toBe("approximate");
    expect(m.assertions[0]).toMatchObject({ type: "similar", threshold: 0.8, value: "{{ ref }}" });
  });
  it("maps bleu / gleu / meteor / rouge_l to native assertions", () => {
    for (const [metric, type] of [["bleu", "bleu"], ["gleu", "gleu"], ["meteor", "meteor"], ["rouge_l", "rouge-l"]] as const) {
      const m = mapGrader({ type: "text_similarity", name: metric, input: OUT, reference: "{{ item.ref }}", evaluation_metric: metric, pass_threshold: 0.4 });
      expect(m.assertions[0].type).toBe(type);
      expect(m.fidelity).toBe("approximate");
    }
  });
  it("implements fuzzy_match and rouge_n with inline JS that scores sensibly", () => {
    const fz = mapGrader({ type: "text_similarity", name: "f", input: OUT, reference: "{{ item.ref }}", evaluation_metric: "fuzzy_match", pass_threshold: 0.8 });
    const body = String(fz.assertions[0].value);
    expect(runJsAssertion(body, "hello world", { ref: "hello world" }).pass).toBe(true);
    expect(runJsAssertion(body, "completely different", { ref: "hello world" }).pass).toBe(false);
    const r2 = mapGrader({ type: "text_similarity", name: "r", input: OUT, reference: "{{ item.ref }}", evaluation_metric: "rouge_2", pass_threshold: 0.5 });
    const rb = String(r2.assertions[0].value);
    expect(runJsAssertion(rb, "the cat sat on the mat", { ref: "the cat sat on the mat" }).score).toBeCloseTo(1);
    expect(runJsAssertion(rb, "zebra quantum", { ref: "the cat sat on the mat" }).pass).toBe(false);
  });
});

describe("label_model and score_model", () => {
  it("label_model becomes an llm-rubric with the judge model and passing labels", () => {
    const m = mapGrader({
      type: "label_model", name: "judge", model: "gpt-4.1-2025-04-14", labels: ["correct", "incorrect"], passing_labels: ["correct"],
      input: [{ role: "developer", content: "Label it." }, { role: "user", content: "In: {{item.input}} Out: {{sample.output_text}}" }],
    });
    expect(m.fidelity).toBe("approximate");
    const a = m.assertions[0];
    expect(a.type).toBe("llm-rubric");
    expect(a.provider).toBe("openai:chat:gpt-4.1-2025-04-14");
    const prompt = JSON.stringify(a.rubricPrompt);
    expect(prompt).toContain("{{ input }}");
    expect(prompt).toContain("{{ output }}");
    expect(prompt).toContain("correct");
    expect(prompt).not.toContain("sample.output_text");
  });
  it("score_model normalizes range and threshold to 0-1", () => {
    const m = mapGrader({ type: "score_model", name: "s", model: "gpt-4.1-2025-04-14", range: [0, 10], pass_threshold: 7, input: [{ role: "user", content: "{{ sample.output_text }}" }] });
    expect(m.assertions[0].type).toBe("llm-rubric");
    expect(m.assertions[0].threshold).toBeCloseTo(0.7);
    expect(m.notes.join(" ")).toMatch(/normalized/);
  });
});

describe("python", () => {
  it("keeps the original grade() verbatim and adds a promptfoo adapter", () => {
    const source = "def grade(sample, item) -> float:\n    return 1.0 if sample['output_text'] == item['x'] else 0.0\n";
    const m = mapGrader({ type: "python", name: "My Grader", source, pass_threshold: 0.5 });
    expect(m.files).toHaveLength(1);
    expect(m.files[0].content).toContain(source.trim());
    expect(m.files[0].content).toContain("def get_assert(output, context)");
    expect(m.assertions[0]).toMatchObject({ type: "python" });
    expect(String(m.assertions[0].value)).toMatch(/^file:\/\/graders\/.+\.py$/);
  });
});

describe("multi", () => {
  it("turns a weighted formula into an assert-set with weights", () => {
    const m = mapGrader({
      type: "multi", name: "mix", pass_threshold: 0.7, calculate_output: "0.3 * a + 0.7 * b",
      graders: {
        a: { type: "string_check", name: "a", input: OUT, operation: "eq", reference: "{{ item.x }}" },
        b: { type: "string_check", name: "b", input: OUT, operation: "ilike", reference: "{{ item.x }}" },
      },
    });
    const set = m.assertions[0];
    expect(set.type).toBe("assert-set");
    expect(set.threshold).toBe(0.7);
    expect(set.assert?.map((x) => x.weight)).toEqual([0.3, 0.7]);
  });
  it("parses linear formulas and rejects non-linear ones", () => {
    expect(parseLinearFormula("0.5 * a + 0.5 * b", ["a", "b"])).toEqual({ a: 0.5, b: 0.5 });
    expect(parseLinearFormula("a * b", ["a", "b"])).toBeUndefined();
  });
});

describe("unknown graders", () => {
  it("never pass silently: manual fidelity and a failing stub", () => {
    const m = mapGrader({ type: "mystery_v9", name: "weird" });
    expect(m.fidelity).toBe("manual");
    const body = String(m.assertions[0].value);
    expect(m.assertions[0].type).toBe("javascript");
    expect(runJsAssertion(body, "anything", {}).pass).toBe(false);
  });
});

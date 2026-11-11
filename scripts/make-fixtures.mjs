// Generates SYNTHETIC fixtures shaped after the OpenAI Evals API reference examples
// (list evals / get run / list output items). Nothing here is real customer data.
// Usage: node scripts/make-fixtures.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = new URL("../fixtures/", import.meta.url).pathname;
const w = (p, c) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), typeof c === "string" ? c : JSON.stringify(c, null, 2) + "\n"); };
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const T0 = 1789000000; // 2026-09 range, fixed so fixtures are deterministic

/* ---------------------------------- Eval A: news topics ---------------------------------- */
const headlines = [
  ["Tech Company Launches Advanced Artificial Intelligence Platform", "Technology"],
  ["Central Bank Increases Interest Rates Amid Inflation Concerns", "Markets"],
  ["International Summit Addresses Climate Change Strategies", "World"],
  ["Major Retailer Reports Record-Breaking Holiday Sales", "Business"],
  ["National Team Qualifies for World Championship Finals", "Sports"],
  ["Stock Markets Rally After Positive Economic Data Released", "Markets"],
  ["Global Manufacturer Announces Merger with Competitor", "Business"],
  ["Breakthrough in Renewable Energy Technology Unveiled", "Technology"],
  ["World Leaders Sign Historic Climate Agreement", "World"],
  ["Professional Athlete Sets New Record in Championship Event", "Sports"],
];
const newsPrompt = "Categorize a given news headline into one of the following topics: Technology, Markets, World, Business, or Sports.\n\n# Output Format\n\nRespond with the chosen category as a single word.";
const evalA = {
  object: "eval", id: "eval_fx_news_topics", name: "News headline topic classifier", created_at: T0,
  data_source_config: { type: "custom", schema: { type: "object", properties: { item: { type: "object", properties: { input: { type: "string" }, ground_truth: { type: "string" } }, required: ["input", "ground_truth"] } }, required: ["item"] } },
  testing_criteria: [
    { type: "string_check", name: "Exact topic match", input: "{{ sample.output_text }}", operation: "eq", reference: "{{ item.ground_truth }}" },
    { type: "string_check", name: "Topic mentioned (any case)", input: "{{ sample.output_text }}", operation: "ilike", reference: "{{ item.ground_truth }}" },
  ],
  metadata: { description: "Synthetic fixture" },
};
const runA = (id, model, created, wrongEvery) => ({
  object: "eval.run", id, eval_id: evalA.id, status: "completed", model, name: model, created_at: created,
  report_url: `https://platform.openai.com/evaluations/${evalA.id}?run_id=${id}`,
  result_counts: { total: 10, errored: 0, passed: 10 - Math.floor(10 / wrongEvery), failed: Math.floor(10 / wrongEvery) },
  per_model_usage: null,
  per_testing_criteria_results: [{ testing_criteria: "Exact topic match", passed: 10 - Math.floor(10 / wrongEvery), failed: Math.floor(10 / wrongEvery) }],
  data_source: {
    type: "completions",
    source: { type: "file_content", content: headlines.map(([input, ground_truth]) => ({ item: { input, ground_truth } })) },
    input_messages: { type: "template", template: [
      { type: "message", role: "developer", content: { type: "input_text", text: newsPrompt } },
      { type: "message", role: "user", content: { type: "input_text", text: "{{item.input}}" } },
    ] },
    model, sampling_params: { temperature: 0, max_completions_tokens: 256, seed: 42 },
  },
  error: null, metadata: {},
});
const runsA = [runA("evalrun_fx_news_1", "gpt-4o-mini-2024-07-18", T0 + 100, 5), runA("evalrun_fx_news_2", "gpt-5.6-terra", T0 + 5000, 10)];
const itemsFor = (run, evalObj, rows, outFn, gradeFn) => rows.map((row, i) => {
  const out = outFn(row, i);
  const results = evalObj.testing_criteria.map((c) => { const g = gradeFn(c, row, out, i); return { name: c.name, passed: g.passed, score: g.score, type: c.type, sample: null }; });
  return {
    object: "eval.run.output_item", id: `outputitem_${run.id}_${i}`, created_at: run.created_at + 10 + i, run_id: run.id, eval_id: evalObj.id,
    status: results.every((r) => r.passed) ? "pass" : "fail", datasource_item_id: i, datasource_item: row,
    results,
    sample: { input: [{ role: "developer", content: newsPrompt }, { role: "user", content: row.input ?? "" }], output: [{ role: "assistant", content: out }], finish_reason: "stop", model: run.model, usage: { total_tokens: 120, completion_tokens: 2, prompt_tokens: 118, cached_tokens: 0 }, error: null, temperature: 0, max_completion_tokens: 256, top_p: 1, seed: 42 },
  };
});
const rowsA = headlines.map(([input, ground_truth]) => ({ input, ground_truth }));
const outA = (wrongEvery) => (row, i) => ((i + 1) % wrongEvery === 0 ? (row.ground_truth === "World" ? "Business" : "World") : row.ground_truth);
const gradeA = (c, row, out) => { const eq = out === row.ground_truth; const il = out.toLowerCase().includes(row.ground_truth.toLowerCase()); const p = c.operation === "eq" ? eq : il; return { passed: p, score: p ? 1 : 0 }; };
w("evals-export/eval_fx_news_topics/eval.json", evalA);
w("evals-export/eval_fx_news_topics/runs.json", { object: "list", data: runsA, first_id: runsA[0].id, last_id: runsA[1].id, has_more: false });
w("evals-export/eval_fx_news_topics/runs/evalrun_fx_news_1.output_items.jsonl", jsonl(itemsFor(runsA[0], evalA, rowsA, outA(5), gradeA)));
w("evals-export/eval_fx_news_topics/runs/evalrun_fx_news_2.output_items.jsonl", jsonl(itemsFor(runsA[1], evalA, rowsA, outA(10), gradeA)));

/* -------------------------------- Eval B: support replies -------------------------------- */
const tickets = [
  ["My invoice shows two charges for November.", "I'm sorry about the duplicate charge. I've asked billing to refund the extra payment; you'll see it within 5 business days."],
  ["How do I reset my password?", "You can reset your password from the sign-in page with the 'Forgot password' link. We'll email you a reset link."],
  ["The export button does nothing in Safari.", "Thanks for reporting this. We've reproduced the Safari export issue and a fix is scheduled for next week's release."],
  ["Can I change my plan mid-cycle?", "Yes. You can change plans at any time in Billing settings, and we'll prorate the difference."],
  ["Do you support SSO?", "SSO via SAML is available on the Business plan. I can connect you with our team to set it up."],
  ["Your app deleted my draft.", "I'm sorry you lost your draft. Drafts are kept for 30 days in Trash under Settings; I can restore it for you if you share the title."],
];
const evalB = {
  object: "eval", id: "eval_fx_support_quality", name: "Support reply quality", created_at: T0 + 200,
  data_source_config: { type: "custom", schema: { type: "object", properties: { item: { type: "object", properties: { ticket: { type: "string" }, reference_answer: { type: "string" } }, required: ["ticket", "reference_answer"] } }, required: ["item"] } },
  testing_criteria: [
    { type: "text_similarity", name: "Fuzzy match to reference", input: "{{ sample.output_text }}", reference: "{{ item.reference_answer }}", evaluation_metric: "fuzzy_match", pass_threshold: 0.6 },
    { type: "text_similarity", name: "Embedding similarity", input: "{{ sample.output_text }}", reference: "{{ item.reference_answer }}", evaluation_metric: "cosine", pass_threshold: 0.8 },
    { type: "text_similarity", name: "ROUGE-2", input: "{{ sample.output_text }}", reference: "{{ item.reference_answer }}", evaluation_metric: "rouge_2", pass_threshold: 0.3 },
    { type: "score_model", name: "Helpfulness 0-10", model: "gpt-4.1-2025-04-14", range: [0, 10], pass_threshold: 7, sampling_params: { temperature: 0, top_p: 1 },
      input: [
        { role: "system", content: "You grade customer-support replies. Score 0-10 for helpfulness, accuracy and tone compared with the reference answer. 10 means it would satisfy the customer." },
        { role: "user", content: "Customer ticket: {{ item.ticket }}\nReference answer: {{ item.reference_answer }}\nReply to grade: {{ sample.output_text }}" },
      ] },
    { type: "python", name: "Length and keyword check", pass_threshold: 0.7, image_tag: "2025-05-08",
      source: "from rapidfuzz import fuzz, utils\n\ndef grade(sample, item) -> float:\n    out = sample[\"output_text\"]\n    ref = item[\"reference_answer\"]\n    score = fuzz.WRatio(out, ref, processor=utils.default_process) / 100.0\n    if len(out) > 600:\n        score *= 0.5\n    return score\n" },
  ],
  metadata: {},
};
const datasetB = tickets.map(([ticket, reference_answer]) => ({ item: { ticket, reference_answer } }));
const supportPrompt = "You are a helpful support assistant. Be concise, accurate, and friendly. Do not invent policy details.";
const runB = (id, type, model, created) => ({
  object: "eval.run", id, eval_id: evalB.id, status: "completed", model, name: `${model} (${type})`, created_at: created,
  result_counts: { total: 6, errored: 0, passed: 4, failed: 2 },
  per_testing_criteria_results: evalB.testing_criteria.map((c) => ({ testing_criteria: c.name, passed: 4, failed: 2 })),
  data_source: {
    type,
    source: { type: "file_id", id: "file-fxSupport01" },
    input_messages: { type: "template", template: [
      { role: "developer", content: supportPrompt },
      { role: "user", content: "Customer ticket: {{ item.ticket }}. Write a reply to the customer." },
    ] },
    model,
    sampling_params: type === "responses" ? { temperature: 0.2, max_completion_tokens: 400, reasoning_effort: "low", seed: 7 } : { temperature: 0.2, top_p: 1, max_completion_tokens: 400, seed: 7 },
  },
  error: null, metadata: { team: "support" },
});
const runsB = [runB("evalrun_fx_support_1", "completions", "gpt-4.1-2025-04-14", T0 + 300), runB("evalrun_fx_support_2", "responses", "gpt-5.6-terra", T0 + 6000)];
const itemsB = (run, delta) => itemsFor(run, evalB, tickets.map(([ticket, reference_answer]) => ({ ticket, reference_answer })),
  (row, i) => (i % 3 === 2 ? "We are looking into it." : row.reference_answer.replace("I'm sorry", "Sorry")),
  (c, row, out, i) => { const bad = i % 3 === 2; return { passed: !bad, score: bad ? 0.2 + delta : 0.85 + delta }; });
w("evals-export/eval_fx_support_quality/eval.json", evalB);
w("evals-export/eval_fx_support_quality/runs.json", { object: "list", data: runsB, has_more: false });
w("evals-export/eval_fx_support_quality/runs/evalrun_fx_support_1.output_items.jsonl", jsonl(itemsB(runsB[0], 0)));
w("evals-export/eval_fx_support_quality/runs/evalrun_fx_support_2.output_items.jsonl", jsonl(itemsB(runsB[1], 0.05)));
w("evals-export/eval_fx_support_quality/datasets/file-fxSupport01.jsonl", jsonl(datasetB));

/* ----------------------- Eval C: pre-computed outputs + a multi grader ------------------- */
const sums = [
  ["Refunds are processed within 5 business days.", "refund", "Refunds take about five business days to process."],
  ["The Safari export bug is fixed in release 4.2.", "Safari", "A Safari export bug was fixed in 4.2."],
  ["SSO is available on the Business plan.", "SSO", "Single sign-on comes with the Business plan."],
  ["Drafts are kept for 30 days.", "30 days", "We keep drafts for a month."],
  ["Plan changes are prorated.", "prorat", "Plan changes are prorated automatically."],
];
const evalC = {
  object: "eval", id: "eval_fx_precomputed", name: "Pre-computed summary checks", created_at: T0 + 400,
  data_source_config: { type: "custom", schema: { type: "object", properties: { item: { type: "object" }, sample: { type: "object" } }, required: ["item", "sample"] } },
  testing_criteria: [
    { type: "string_check", name: "Mentions keyword", input: "{{ sample.output_text }}", operation: "like", reference: "{{ item.keyword }}" },
    { type: "string_check", name: "Reference mentions summary keyword (reversed)", input: "{{ item.fact }}", operation: "ilike", reference: "{{ item.keyword }}" },
    { type: "text_similarity", name: "BLEU vs fact", input: "{{ sample.output_text }}", reference: "{{ item.fact }}", evaluation_metric: "bleu", pass_threshold: 0.2 },
    { type: "multi", name: "Weighted check", pass_threshold: 0.7, calculate_output: "0.5 * kw + 0.5 * sim",
      graders: {
        kw: { type: "string_check", name: "kw", input: "{{ sample.output_text }}", operation: "ilike", reference: "{{ item.keyword }}" },
        sim: { type: "text_similarity", name: "sim", input: "{{ sample.output_text }}", reference: "{{ item.fact }}", evaluation_metric: "fuzzy_match", pass_threshold: 0.5 },
      } },
  ],
  metadata: {},
};
const rowsC = sums.map(([fact, keyword, out]) => ({ item: { fact, keyword }, sample: { output_text: out } }));
const runC = { object: "eval.run", id: "evalrun_fx_pre_1", eval_id: evalC.id, status: "completed", model: null, name: "precomputed", created_at: T0 + 500, result_counts: { total: 5, errored: 0, passed: 3, failed: 2 }, data_source: { type: "jsonl", source: { type: "file_content", content: rowsC } }, error: null, metadata: {} };
w("evals-export/eval_fx_precomputed/eval.json", evalC);
w("evals-export/eval_fx_precomputed/runs.json", { object: "list", data: [runC], has_more: false });
w("evals-export/eval_fx_precomputed/runs/evalrun_fx_pre_1.output_items.jsonl", jsonl(rowsC.map((r, i) => ({
  object: "eval.run.output_item", id: `outputitem_pre_${i}`, created_at: T0 + 510 + i, run_id: runC.id, eval_id: evalC.id, status: i < 3 ? "pass" : "fail", datasource_item_id: i, datasource_item: { ...r.item, sample: r.sample },
  results: evalC.testing_criteria.map((c) => ({ name: c.name, passed: i < 3, score: i < 3 ? 1 : 0, type: c.type, sample: null })), sample: { input: [], output: [{ role: "assistant", content: r.sample.output_text }], finish_reason: "stop", model: "n/a", usage: { total_tokens: 0, completion_tokens: 0, prompt_tokens: 0, cached_tokens: 0 }, error: null },
}))));

/* ---------------- Eval D: stored completions + label_model judge on a retired model ----- */
const evalD = {
  object: "eval", id: "eval_fx_push_summaries", name: "Push notification summaries", created_at: T0 + 600,
  data_source_config: { type: "stored_completions", metadata: { usecase: "push_notifications_summarizer" }, schema: { type: "object", properties: { item: { type: "object" }, sample: { type: "object" } }, required: ["item", "sample"] } },
  testing_criteria: [
    { type: "label_model", name: "Push Notification Summary Grader", id: "grader-fx-1", model: "o3-mini-2025-01-31", labels: ["correct", "incorrect"], passing_labels: ["correct"], sampling_params: null,
      input: [
        { type: "message", role: "developer", content: { type: "input_text", text: "Label the following push notification summary as either correct or incorrect. A good summary is concise and snappy." } },
        { type: "message", role: "user", content: { type: "input_text", text: "Push notifications: {{item.input}}\nSummary: {{sample.output_text}}" } },
      ] },
  ],
  metadata: { description: "Synthetic fixture shaped after the API reference example" },
};
const pushes = ["Alice: lunch at 12? Bob: sure, the usual place. Alice: great.", "Your package was delivered to the front desk at 3:42 PM.", "Server CPU above 90% for 10 minutes on api-3.", "Reminder: dentist appointment tomorrow at 9:00."];
const runD = { object: "eval.run", id: "evalrun_fx_push_1", eval_id: evalD.id, status: "completed", model: "gpt-4.1-mini-2025-04-14", name: "stored completions run", created_at: T0 + 700, result_counts: { total: 4, errored: 0, passed: 3, failed: 1 },
  data_source: { type: "completions", source: { type: "stored_completions", created_after: T0 - 86400, limit: 4, model: "gpt-4.1-mini-2025-04-14" }, input_messages: { type: "item_reference", item_reference: "item.input_trajectory" }, model: "gpt-4.1-mini-2025-04-14", sampling_params: { temperature: 1 } }, error: null, metadata: {} };
w("evals-export/eval_fx_push_summaries/eval.json", evalD);
w("evals-export/eval_fx_push_summaries/runs.json", { object: "list", data: [runD], has_more: false });
w("evals-export/eval_fx_push_summaries/runs/evalrun_fx_push_1.output_items.jsonl", jsonl(pushes.map((p, i) => ({
  object: "eval.run.output_item", id: `outputitem_push_${i}`, created_at: T0 + 710 + i, run_id: runD.id, eval_id: evalD.id, status: i === 3 ? "fail" : "pass", datasource_item_id: i,
  datasource_item: { input: p, input_trajectory: [{ role: "user", content: p }] },
  results: [{ name: "Push Notification Summary Grader", passed: i !== 3, score: i !== 3 ? 1 : 0, type: "label_model", sample: null }],
  sample: { input: [{ role: "user", content: p }], output: [{ role: "assistant", content: p.split(/[.:]/)[0] }], finish_reason: "stop", model: runD.model, usage: { total_tokens: 40, completion_tokens: 6, prompt_tokens: 34, cached_tokens: 0 }, error: null },
}))));

w("evals-export/index.json", { exported_at: T0 + 800, api: "https://api.openai.com/v1", evals: [evalA, evalB, evalC, evalD].map((e) => ({ id: e.id, name: e.name })), warnings: [] });

/* ------------------------------------ prompt objects ------------------------------------ */
w("prompts/support-reply.prompt.json", {
  object: "prompt", id: "pmpt_fx_support_reply", name: "support-reply", description: "Replies to support tickets (synthetic fixture)",
  latest_version: "3",
  versions: [
    { version: "1", instructions: "You are a helpful support assistant. Be concise, accurate, and friendly.\nCustomer name: {{customer_name}}. Issue: {{issue}}. Write a response to the customer.", variables: ["customer_name", "issue"] },
    { version: "2", messages: [
      { role: "developer", content: "You are a helpful support assistant. Be concise, accurate, and friendly. Do not invent policy details." },
      { role: "user", content: "Customer name: {{ customer_name }}. Issue: {{ issue }}. Write a response to the customer." },
    ], variables: { customer_name: "Acme", issue: "billing question" } },
    { version: "3", model: "gpt-5.6-terra", messages: [
      { role: "developer", content: [{ type: "input_text", text: "You are a helpful support assistant. Do not invent policy details.\nAlways answer in the customer's language. Use `code` formatting only for commands, never for names.\nReturn JSON like {\"reply\": \"...\", \"tone\": \"friendly\"} when {{ output_format }} is json; the price shown is ${price} USD (a literal, not a variable)." }] },
      { role: "user", content: [{ type: "input_text", text: "Customer name: {{customer_name}}. Plan: {{ plan.tier }}. Issue: {{issue}}.\nBackslash \\ and \"quotes\" and unicode: café, 日本語." }] },
    ], variables: ["customer_name", "issue", "plan.tier", "output_format"] },
  ],
});
w("prompts/ticket-triage.prompt.json", {
  id: "pmpt_fx_triage", name: "Ticket triage", version: "1", model: "gpt-5.1",
  input: [
    { role: "system", content: [{ type: "input_text", text: "Classify the ticket into one of: billing, bug, how-to, other." }] },
    { role: "user", content: [{ type: "input_text", text: "{{ticket_text}}" }] },
  ],
  variables: { ticket_text: "The export button does nothing." },
});
w("prompts/release-notes.txt", "Write release notes for version {{version}} in a friendly tone.\nHighlights:\n{{highlights}}\n");
console.log("fixtures written to", root);

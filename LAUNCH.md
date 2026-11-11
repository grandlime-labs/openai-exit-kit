# LAUNCH.md: drafts only

Nothing here has been posted. Every item is a draft for the owner to review, edit and post under their own name. Replace `[REPO_URL]` and `[DEMO_URL]` once they exist.

## Facts every post may use (all checkable)

- OpenAI's deprecations page lists the Evals API / dashboard, Agent Builder and the `v1/prompts` stored-prompt API for shutdown on 2026-11-30. Re-open https://developers.openai.com/api/docs/deprecations right before posting and confirm the dates still read that way.
- The tool is free, MIT licensed, and open source. There is no paid tier and it does not take payment.
- The converter runs in the browser; the built `convert.html` page ships a Content-Security-Policy with `connect-src 'none'`, so the browser itself blocks network requests from that page.
- The landing page’s waitlist is GitHub-native (Watch → Releases, and a pinned Discussion). The email form is a disabled placeholder unless a form provider is separately approved.
- Graders are labeled exact / approximate / manual in the generated report. Manual ones are failing placeholders on purpose.
- It does not run models, does not compute scores, and does not migrate Agent Builder workflows.
- The `export` command only issues GET requests.

Do not add: user counts, testimonials, "saves X hours" claims, claims that promptfoo or OpenAI endorse it, or claims that results match OpenAI's graders.

---

## 1. Landing page copy (already live in `web/index.html`; converter is `web/convert.html`)

**Headline (current):** OpenAI is shutting down Evals and stored prompts on 2026-11-30. Get your work out first.

**Subcopy (current):** This tool turns an OpenAI Evals export into a promptfoo project for each eval (config, tests, graders, and a migration report), and turns stored prompt objects into plain TypeScript and Python functions.

**Privacy line (current):** The converter runs fully in your browser. Your files are never uploaded. The converter page is built with a Content-Security-Policy of `connect-src 'none'`, so the browser itself blocks network requests from that page.

**Primary CTA:** “Try it” → `./convert.html`. Secondary: “View on GitHub”.

**Notify / waitlist (current):** Watch → Custom → Releases, and the pinned Discussion “Notify me about Agent Builder support”. Optional email form is visibly “not enabled” and must stay that way until a form-provider account is approved (`APPROVALS.md`).

Alternates (if you want to edit the landing headline):

- Headline: Your OpenAI evals and prompts, as files you own.
  Subcopy: Convert an Evals export to promptfoo and stored prompt objects to plain TypeScript or Python. Free, open source, and nothing leaves your machine.
- Headline: Export before 2026-11-30.
  Subcopy: A free converter for OpenAI Evals graders and stored prompts. Each grader is labeled exact, approximate or manual, so you know what still needs a human.

Converter page (`convert.html`) CTA, once someone clicks Try it: “Load the sample fixtures” (no account, no upload) then “Download everything (.zip)”.

---

## 2. Show HN

**Title (80 char limit):** Show HN: Convert OpenAI Evals and stored prompts to promptfoo and plain code

**URL:** [REPO_URL]

**First comment (post right after submitting):**

> OpenAI's deprecations page lists the Evals API, Agent Builder and the stored prompts API (v1/prompts) for shutdown on 2026-11-30. I had no good way to get an eval and its graders out, so I wrote a converter.
>
> What it does: takes an Evals export (eval definitions, runs, output items, datasets) and writes one promptfoo project per eval: promptfooconfig.yaml, tests, a prompt file, Python graders, a baseline.json of your old OpenAI results, and a migration report. Separately it turns stored prompt objects (versions, variables) into TypeScript and Python functions.
>
> What I want you to know before trying it:
> - string_check translates exactly. text_similarity, label_model, score_model and python are mapped to the closest promptfoo assertion and marked "approximate" in the report; scores will move, so re-baseline. Anything unrecognized becomes a placeholder that fails on purpose.
> - It never calls a model or computes a score. You run `promptfoo eval` yourself.
> - It does not migrate Agent Builder workflows.
> - The web app is static and client-side. The page ships with a CSP of connect-src 'none', so you can check in dev tools that it cannot send your files anywhere. There is also a CLI sharing the same core, and an export command that makes GET requests only (read src/core/exporter.ts).
> - The fixtures are synthetic, modeled on the API reference examples. I have not tested it on a large real-world account, so I would like to hear about exports it chokes on.
>
> The model shutdown table is a dated snapshot of the deprecations page; please double-check it there.
>
> Repo: [REPO_URL]  Demo: [DEMO_URL]

Posting notes: submit once, from the owner's own account, and don't ask people to upvote.

---

## 3. OpenAI developer forum reply

Use only under a thread where someone asks how to keep their evals or prompts after the shutdown. Disclose authorship. Do not paste it as a standalone post.

> Since this came up: the deprecations page lists Evals, Agent Builder and the stored prompts API for 2026-11-30, so it's worth exporting now rather than later. (Please re-check the page; dates can change.)
>
> I wrote a free, open-source converter that may help: it takes an Evals export and writes a promptfoo project for each eval, and turns stored prompt objects into plain TypeScript/Python functions. It's my project, so take that for what it's worth. It runs locally or in the browser, and the export step only makes GET requests with your own key.
>
> Limits: string_check converts exactly; similarity, model-graded and Python graders are mapped approximately and labeled that way in the report, so expect different scores. It doesn't convert Agent Builder workflows.
>
> [REPO_URL]. If you hit an export shape it can't read, an issue with a redacted example would help me a lot.

---

## 4. promptfoo community post (Discord / GitHub Discussions)

**Title:** Open-source helper: OpenAI Evals export to promptfooconfig.yaml

> Hi all. With OpenAI's Evals shutdown listed for 2026-11-30, I built a small open-source tool that converts an OpenAI Evals export into promptfoo projects, in case it's useful to people moving over. It isn't an official promptfoo project.
>
> What it emits per eval: `promptfooconfig.yaml` (providers from the run's model and sampling params), `tests.yaml` (from the dataset), `prompts/main.json`, Python graders with a `get_assert` adapter, a baseline.json of the old results, and a report.
>
> Grader mapping: string_check to equals / not-equals / contains / icontains (exact); text_similarity to similar / bleu / gleu / meteor / rouge-l or inline javascript; label_model and score_model to llm-rubric with the original messages as `rubricPrompt`; python to a python assertion; multi to assert-set. Similarity, model-graded and python graders are labeled approximate in the report.
>
> How I checked it: `promptfoo validate config` passes on all generated configs, and CI runs `promptfoo eval` against a local mock OpenAI server (no API key). Real-account coverage is limited, so feedback on configs that don't behave the way you'd expect would be welcome. I'm especially interested in whether the llm-rubric mapping for score_model/label_model is the idiomatic way to do this.
>
> [REPO_URL]

---

## 5. X posts (three; each under 280 characters)

**Post 1**
OpenAI lists Evals, Agent Builder and stored prompts (v1/prompts) for shutdown on 2026-11-30.

I built a free, open-source converter: Evals export to promptfoo, stored prompts to TypeScript/Python. Runs in your browser, nothing uploaded.

[DEMO_URL]

**Post 2**
How the OpenAI Evals to promptfoo converter labels graders:

exact: string_check
approximate: similarity, label_model, score_model, python
manual: anything unrecognized (a failing placeholder on purpose)

No silent greens. Free and MIT: [REPO_URL]

**Post 3**
Checking the "client-side only" claim for my converter: the page ships with a Content-Security-Policy of connect-src 'none', so the browser blocks any network request from it. Open dev tools and try fetch().

Evals + stored prompts, before 2026-11-30: [DEMO_URL]

---

## Posting checklist (owner)

Each of these needs an explicit go-ahead. The ordered checklist, with exact click targets and commands, is `APPROVALS.md`. Short version:

1. Re-verify the shutdown dates on OpenAI's deprecations page.
2. Create the repo, enable Pages or Cloudflare Pages, pin the Discussion, and replace `[REPO_URL]` / `[DEMO_URL]` — only after those items are approved.
3. Post from your own accounts, one place at a time, and read each venue's self-promotion rules first (Hacker News, the OpenAI forum, promptfoo's Discord). Approve each post separately if you want them spaced out.
4. Answer questions honestly, including "it does not do that". Do not mention a paid plan or collect payment.

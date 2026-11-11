# OpenAI Exit Kit

Move your OpenAI **Evals** and stored **prompt objects** somewhere you control before OpenAI's shutdown date, **2026-11-30**.

- **Evals export → promptfoo.** For each eval you get a `promptfooconfig.yaml`, a `tests.yaml` with your dataset, a prompt file, any Python graders, a `baseline.json` of your old OpenAI results, and a `MIGRATION_REPORT.md`.
- **Prompt objects → code.** Stored prompts (`v1/prompts`, with versions and variables) become plain TypeScript and Python functions you can keep in git.
- **Read-only exporter.** `export` pulls evals, runs, output items and dataset files through the Evals API using GET requests only.
- **Two front ends, one core.** A static web app that runs in the browser (files are never uploaded, and the page's Content-Security-Policy blocks network requests), and a Node CLI.

This project is **free and open source** (MIT). There is no paid tier and the tool does not take payment. The web converter and the landing page collect no accounts and no files.

The shutdown dates come from OpenAI's [deprecations page](https://developers.openai.com/api/docs/deprecations), re-checked on 2026-11-10: Evals, Agent Builder, and `v1/prompts` are still listed to shut down on **2026-11-30** (existing evals have been read-only since 2026-10-31). Check that page yourself; dates and model tables change. This project is not affiliated with OpenAI or promptfoo.

## What it does not do

- It does not call any model and does not compute scores. `convert` and `prompts` never touch the network.
- It does not migrate **Agent Builder** workflows. Export those from the Agent Builder UI (Code, then the Agents SDK).
- It does not reproduce OpenAI's numbers. Approximate graders (see below) will score differently; the baseline is there to compare against, not to match.
- Images, files and audio parts in prompts are dropped (text only). The report says when that happened.

## Quick start

Requires Node 20+. The CLI is on npm as [`openai-exit-kit`](https://www.npmjs.com/package/openai-exit-kit):

```bash
# 1. Export from OpenAI (read-only). Use a key for the project that owns the evals.
OPENAI_API_KEY=sk-... npx openai-exit-kit export --out evals-export

# 2. Convert to promptfoo projects (+ prompt objects if they are in the folder)
npx openai-exit-kit convert evals-export --out promptfoo-out

# 3. Validate without any API key, then run a real eval when you are ready.
#    promptfoo will call your model provider; that provider bills you. This tool does not.
npx promptfoo validate config -c promptfoo-out/promptfoo/<eval-folder>/promptfooconfig.yaml
OPENAI_API_KEY=sk-... npx promptfoo eval -c promptfoo-out/promptfoo/<eval-folder>/promptfooconfig.yaml --no-cache
```

To work from a clone of this repo instead:

```bash
npm install
npm run build          # web app -> dist/web, CLI -> dist/cli/index.js
node dist/cli/index.js convert evals-export --out promptfoo-out
```

Try it on the bundled synthetic fixtures with no key at all (from a clone):

```bash
npm run sample         # writes out/sample and out/sample-prompts
npm run verify:promptfoo
```

### CLI reference

```
openai-exit-kit export  --out <dir> [--max-output-items N]
openai-exit-kit convert <path...> --out <dir> [--replace-deprecated] [--provider-prefix openai]
openai-exit-kit prompts <path...> --out <dir>
openai-exit-kit models
```

`export` reads `OPENAI_API_KEY` (required) and optionally `OPENAI_PROJECT`, `OPENAI_ORG` and `OPENAI_BASE_URL`. It retries 429/5xx responses with backoff. The key is only sent to the base URL. If you want to inspect what it does, read `src/core/exporter.ts`: it is about 100 lines and only calls `GET /evals`, `/evals/{id}`, `/evals/{id}/runs`, `/evals/{id}/runs/{run}/output_items` and `/files/{id}/content`.

### Input layout

`convert` accepts folders or files and works out what each file is from its contents, so the layout does not have to match. The exporter writes:

```
evals-export/
  index.json
  <eval_id>/eval.json
  <eval_id>/runs.json
  <eval_id>/runs/<run_id>.output_items.jsonl
  <eval_id>/datasets/<file_id>.jsonl         (file-backed run datasets)
  <eval_id>/datasets/<run_id>.from_output_items.jsonl
```

Test data is recovered in this order: inline `file_content` on the run, the dataset file, then the `datasource_item` of each output item (this is all you get for runs that sampled stored completions or logs, and the report warns about it).

### Prompt objects

Accepted shapes (anything with `messages`, `input`, `instructions`, or `template`/`text`, optionally under `versions[]`):

```jsonc
{ "id": "pmpt_...", "name": "support-reply", "latest_version": "3",
  "versions": [ { "version": "1", "instructions": "Hi {{name}}", "variables": ["name"] },
                { "version": "2", "messages": [{ "role": "developer", "content": "..." }] } ] }
```

`variables` may be a list or an object of examples. `{{ var }}` becomes a function argument (`{{ plan.tier }}` becomes `planTier` / `plan_tier`). `developer` messages are written as `system`. Plain `.txt`/`.md` files with `{{var}}` placeholders work too. Output for each prompt: `ts/<name>.ts`, `py/<name>.py`, plus `prompts-manifest.json` and `MIGRATION_PROMPTS.md`. The tests check that the TypeScript passes `tsc --strict`, that it runs, and that the Python produces identical messages.

## How graders are mapped

| OpenAI grader | promptfoo | Fidelity |
| --- | --- | --- |
| `string_check` eq / ne / like / ilike | `equals` / `not-equals` / `contains` / `icontains` (inline `javascript` when operands are swapped) | **exact** |
| `text_similarity` fuzzy_match, rouge_1/2/3/4/5, bleu, gleu, meteor, rouge_l, cosine | inline JS (fuzzy_match, rouge_2 to rouge_5), native `rouge-n` (rouge_1), `bleu`, `gleu`, `meteor`, `rouge-l`, `similar` (cosine) | **approximate** |
| `label_model` | `llm-rubric` with your messages as `rubricPrompt`, and the judge model as `provider` | **approximate** |
| `score_model` | `llm-rubric`, range and threshold normalized to 0-1 | **approximate** |
| `python` | `python` assertion; your `grade(sample, item)` is kept verbatim with a generated `get_assert` adapter | **approximate** (different sandbox and libraries) |
| `multi` | `assert-set` with weights when `calculate_output` is a linear formula | exact or approximate depending on the sub-graders; otherwise **manual** |
| anything else | a deliberately failing placeholder | **manual** |

Manual graders fail on purpose so a result can never look green because a grader was not migrated. Every mapping and caveat is repeated in the generated `MIGRATION_REPORT.md`.

Model ids that are being shut down are flagged in the reports from a dated table (`src/core/deprecations.ts`, read 2026-11-10). Use `--replace-deprecated` to swap in OpenAI's suggested replacement. Re-check the deprecations page before relying on any of it.

## Verification that runs without a paid API

`npm run verify:promptfoo` (also run in CI):

1. converts the fixtures with the built CLI,
2. runs `promptfoo validate config` on every generated config,
3. runs `promptfoo eval` against a **local mock OpenAI server** (`scripts/mock-openai.mjs`, bound to 127.0.0.1) so providers, assertions, embeddings and judges all execute offline. Pass `--no-eval` to skip step 3.

Python graders that import third-party packages (the sample uses `rapidfuzz`) need them installed (`pip install rapidfuzz`), otherwise that assertion reports an import error.

## Fixtures

Everything in `fixtures/` is **synthetic**, shaped after the examples in OpenAI's Evals API reference. There is no real customer data. Regenerate with `npm run fixtures`. They cover all six grader types, `custom` and `stored_completions` data source configs, `completions` / `responses` / `jsonl` runs, `file_content` / `file_id` / `stored_completions` sources, and a shut-down judge model.

## Development

```bash
npm run dev            # Vite dev server for the web app
npm test               # vitest (core, graders, prompts, exporter, CLI end to end)
npm run typecheck
npm run build
```

Layout: `src/core` (parse, graders, convert, prompts, exporter, deprecations), `src/cli`, `web`, `fixtures`, `scripts`, `tests`.

## Deploy the web app (static)

`npm run build:web` writes `dist/web`. That folder is a two-page static site: the **landing page** at `index.html` and the **converter** at `convert.html`. Asset paths are relative, so it works under a sub-path (GitHub project Pages included).

The converter is built with a Content-Security-Policy of `connect-src 'none'` and `form-action 'none'`, so the browser blocks network requests and form posts from that page. The landing page uses the same policy today. The optional email form on the landing page is a disabled placeholder; if you later enable a free form provider, loosen `form-action` on the landing page only (`vite.config.ts` `LANDING_CSP`, and the `/` and `/index.html` rules in `web/public/_headers`). Never change the converter CSP.

The landing page’s “Get notified” section points at GitHub Watch → Releases and a Discussions link. The optional email form stays disabled (no third-party form service). See `APPROVALS.md` for items that still need a separate go-ahead (custom domain, a form provider, launch posts).

### GitHub Pages

The site is deployed automatically from `main` by `.github/workflows/pages.yml` (Node 22, `npm ci`, Vite base `/openai-exit-kit/`):

- Landing: https://grandlime-labs.github.io/openai-exit-kit/
- Converter: https://grandlime-labs.github.io/openai-exit-kit/convert.html

To deploy it yourself from a fork: set **Settings > Pages > Source: GitHub Actions**, then push `main` or run the workflow by hand. A custom domain is optional and not configured.

### Cloudflare Pages

1. Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git, and pick the repo.
2. Build command: `npm run build:web`. Build output directory: `dist/web`. Environment variable `NODE_VERSION=22`.
3. Optional custom domain: Pages project > Custom domains. If the domain's DNS is on Cloudflare this is automatic.

Or without Git: `npm run build:web && npx wrangler pages deploy dist/web --project-name openai-exit-kit` (requires `wrangler login`).

### npm package

The CLI is published as the free public package [`openai-exit-kit`](https://www.npmjs.com/package/openai-exit-kit) (`npx openai-exit-kit`). The tarball is the bundled CLI, README, and LICENSE; `prepack` rebuilds the CLI. Publishing the package does not add a paid tier.

## Contributing and security

See `CONTRIBUTING.md` and `SECURITY.md`. The changelog starts at `CHANGELOG.md` (`v0.1.1`).

Operator notes for a public launch (not required to use the tool): `APPROVALS.md` is the checklist of actions that still need explicit go-ahead; `DEMAND.md` is how to measure demand in the first 14 days with GitHub and the host only.

## License

MIT. See `LICENSE`.

# Contributing

Thanks for wanting to help. This project is free and open source (MIT). There is no paid tier.

## Development setup

Requires Node 20+ (22 in CI). Python 3.12 is only needed for `npm run verify:promptfoo`.

```bash
npm install
npm run typecheck
npm test
npm run build
npm run verify:promptfoo
```

`verify:promptfoo` converts the bundled fixtures, runs `promptfoo validate config` on every generated config, then runs `promptfoo eval` against a local mock OpenAI server on 127.0.0.1. It does not need an API key and does not call OpenAI.

The sample Python grader imports `rapidfuzz`. Install it if you want that assertion to run (`pip install rapidfuzz`); otherwise promptfoo reports an import error for that grader only.

Web app:

```bash
npm run dev          # Vite, landing at /, converter at /convert.html
```

Regenerate synthetic fixtures with `npm run fixtures`.

## Project layout

- `src/core` — parse, graders, convert, prompts, exporter, deprecations
- `src/cli` — command-line tool
- `web` — static landing (`index.html`) and converter (`convert.html`, `main.ts`)
- `fixtures` — synthetic exports only
- `tests` — vitest
- `scripts` — fixture generator, CLI build, mock OpenAI server, promptfoo verify

## Rules for pull requests

- Run typecheck, tests, and build locally. Include `verify:promptfoo` for anything that changes conversion output or grader mappings.
- Do not commit `node_modules/`, `dist/`, or `out/`.
- Do not add payment, checkout, analytics SDKs, or any code that uploads user files. The converter page must keep a Content-Security-Policy of `connect-src 'none'` and `form-action 'none'`.
- Do not include real OpenAI exports, API keys, or customer data. Fixtures must stay synthetic. If you need a new shape, invent a redacted sample (see the "My export didn't convert" issue template).
- The model-shutdown table in `src/core/deprecations.ts` is a dated snapshot of [OpenAI's deprecations page](https://developers.openai.com/api/docs/deprecations). If you update it, set `DEPRECATIONS_CHECKED` to the date you re-read that page and mention it in the PR.
- Keep changes focused. Open an issue first for large features (Agent Builder support is the obvious one).

## Reporting bugs and security issues

- Bugs and conversion failures: GitHub Issues (templates are under `.github/ISSUE_TEMPLATE`).
- Security vulnerabilities: see `SECURITY.md`. Do not file a public issue.

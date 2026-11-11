# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-11-10

### Changed

- First public npm release of the `openai-exit-kit` CLI (`npx openai-exit-kit`). The package is free, unscoped, and MIT-licensed. The published tarball contains only the bundled CLI, README, and LICENSE.

## [0.1.0] — 2026-11-10

Initial public release. Free, MIT-licensed, no paid tier.

### Added

- Convert an OpenAI Evals export into one promptfoo project per eval (`promptfooconfig.yaml`, `tests.yaml`, prompts, Python graders, `baseline.json`, `MIGRATION_REPORT.md`).
- Grader mappings for `string_check`, `text_similarity`, `label_model`, `score_model`, `python`, and `multi`, each labeled exact, approximate, or manual. Unrecognized graders become failing placeholders.
- Convert stored prompt objects (`v1/prompts`, including versions and variables) and plain `{{var}}` text files into TypeScript and Python functions.
- Read-only CLI exporter (`openai-exit-kit export`) that only makes GET requests for evals, runs, output items, and dataset files.
- Static web converter that runs entirely in the browser (Content-Security-Policy `connect-src 'none'`). Files are never uploaded.
- Static landing page with a “Try it” link, GitHub-native notify instructions (Watch releases / Discussions), and a clearly disabled placeholder for an optional email form.
- Snapshot of OpenAI model shutdowns in `src/core/deprecations.ts`, read from the deprecations page on 2026-11-10. Product shutdown dates for Evals, Agent Builder, and `v1/prompts` remain 2026-11-30 (evals read-only since 2026-10-31).
- Test suite, `promptfoo validate` plus offline `promptfoo eval` against a local mock OpenAI server, CI, and a manual GitHub Pages workflow.

# Security policy

## Supported versions

The `main` branch and the latest released version (currently 0.1.0) receive security fixes.

## What this project is careful about

- The **browser converter** is designed to run entirely on-device. Production builds inject a Content-Security-Policy with `connect-src 'none'` and `form-action 'none'`, so the page cannot make network requests or post forms. Please treat any change that weakens that policy on `convert.html` as a security issue.
- The **CLI `export` command** sends `OPENAI_API_KEY` only to the configured OpenAI base URL, and only issues GET requests. Do not log or write the key.
- This project should never collect emails, payment details, or uploaded eval files on a server we host.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a vulnerability.

Once the repository is public, use GitHub's **private vulnerability reporting**:

1. Go to the repo’s **Security** tab.
2. Choose **Report a vulnerability** (maintainers should enable private reporting under Settings → Code security; see `APPROVALS.md`).
3. Include the affected version or commit, a short description, and steps to reproduce. Do not attach real API keys or unredacted customer exports.

If private reporting is not yet enabled, email the maintainer through a private channel you already have with them, and say that the message is a security report.

We will acknowledge a valid report as soon as we can and work on a fix before any public disclosure.

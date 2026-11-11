# Approvals required before anything goes public

Nothing in this package has been published, pushed, deployed, posted, or used to create an account. **Each step below needs Goblin Dev’s explicit go-ahead** before anyone runs it. Do not combine steps: approve and finish one, then the next.

The repo owner is set to `grandlime-labs` (a separate GitHub business account chosen by Goblin Dev). All links use `grandlime-labs/openai-exit-kit` and `grandlime-labs.github.io`. Nothing has been created or published.

Payments, checkout, paid tiers, and any payment-provider account are prohibited until a business licence is approved. This release is free and open source only.

Suggested order: 1 → 2 → 3 → 4 → 5, then any of 6–8 if wanted, then each item in 9 as its own approval.

---

## 1. Create the public GitHub repository and push this tree

**Why:** Every later public URL depends on this.

**Click / command (after approval only):**

```bash
# From a checkout of this project, (owner: grandlime-labs).
# Do not run until approved. This creates a public repo and pushes main.

git init -b main
git add .
git commit -m "Release v0.1.0: OpenAI Exit Kit (free, MIT)"

# Using GitHub CLI (creates a public repo under the signed-in account or org):
gh repo create grandlime-labs/openai-exit-kit --public --source . --remote origin --push

# Or, without gh: create an empty public repo named openai-exit-kit at
# https://github.com/new (Owner: grandlime-labs, Repository name: openai-exit-kit,
# Public, do not add a README, license, or .gitignore), then:
#   git remote add origin https://github.com/grandlime-labs/openai-exit-kit.git
#   git push -u origin main
```

Then tag the release (still part of this approval unless you split it):

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
# Optional: https://github.com/grandlime-labs/openai-exit-kit/releases/new?tag=v0.1.0
```

**Also in this step, or immediately after:** repo Settings → Code security → enable **Private vulnerability reporting**. Settings → General → Features → enable **Discussions** (needed for step 4).

---

## 2. Enable free hosting for the landing page and converter

Pick **one** host for v0.1.0. GitHub Pages needs no new account if the repo already exists. Cloudflare Pages needs a Cloudflare account (treat account creation as part of this approval if you do not already have one).

### 2a. GitHub Pages (default)

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Actions** tab → workflow **Deploy web app to GitHub Pages** (`.github/workflows/pages.yml`, `workflow_dispatch` only) → **Run workflow** → **Run workflow** on `main`.
3. When it finishes, the site is `https://grandlime-labs.github.io/openai-exit-kit/` (landing) and `https://grandlime-labs.github.io/openai-exit-kit/convert.html` (converter).
4. Put those URLs in `package.json` `homepage` and replace `[DEMO_URL]` / `[REPO_URL]` in `LAUNCH.md`.

### 2b. Cloudflare Pages (alternative)

1. [Cloudflare dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → authorize GitHub if prompted → select `grandlime-labs/openai-exit-kit`.
2. Build command: `npm run build:web`. Build output directory: `dist/web`. Environment variable: `NODE_VERSION=22`.
3. Optional, same account, no extra product: project → **Web Analytics** (free, cookieless). Only enable if you want the analytics row in `DEMAND.md`.
4. Or, without connecting Git, after a local `npm run build:web`: `npx wrangler pages deploy dist/web --project-name openai-exit-kit` (requires `wrangler login`).

Do not run both 2a and 2b unless you deliberately want two URLs.

---

## 3. Optional custom domain

Only after step 2. Not required.

- **GitHub Pages:** Settings → Pages → **Custom domain** → enter the domain → GitHub shows the DNS record. Create a `CNAME` to `grandlime-labs.github.io` (subdomain) or the A/AAAA records GitHub lists (apex). Wait for DNS, then enable **Enforce HTTPS**.
- **Cloudflare Pages:** project → **Custom domains** → add the domain. If DNS is already on Cloudflare this is mostly automatic.

Also set `package.json` `homepage` and `LAUNCH.md` `[DEMO_URL]` to the custom URL.

---

## 4. Pin the GitHub Discussion waitlist

After Discussions are enabled (step 1):

1. https://github.com/grandlime-labs/openai-exit-kit/discussions → **New discussion**.
2. Title and body: copy `docs/discussion-agent-builder.md`.
3. Create it, then **Pin** the discussion (and convert to an announcement if you want it read-only except for comments).
4. Confirm the landing page “Open Discussions” link goes to that thread, or to the Discussions index if you prefer.

This is the GitHub-native “notify me about Agent Builder support” waitlist. No new vendor.

---

## 5. Optional npm publish

Checked 2026-11-10: `openai-exit-kit` returned **404** from `https://registry.npmjs.org/openai-exit-kit` and is available. Fallback names that were also 404: `oai-exit-kit`, `evals-exit-kit`, `openai-evals-exit-kit`. Re-check immediately before publish:

```bash
curl -sS -o /tmp/npm-name.json -w "%{http_code}\n" https://registry.npmjs.org/openai-exit-kit
```

If you do not already have an npm account, creating one is part of this approval (https://www.npmjs.com/signup). Do not create it early.

```bash
# package.json currently has "private": true so an accidental publish is blocked.
# After approval, set "private": false (and confirm name, version 0.1.0, repository URL).
npm login
npm publish --access public
```

No paid npm plan is required for a public unscoped package.

---

## 6. Optional email-form account (Formspree, Tally, or Buttondown free tier)

**Not required.** The landing page already points people at Watch → Releases and the Discussion. The email section is a visible placeholder and does not collect addresses.

If approved:

1. Create the free-tier account at the chosen provider (do not create it before this approval).
2. Put the form endpoint in `web/index.html` (`FORM_ENDPOINT_PLACEHOLDER`), remove the form’s `hidden` attribute, and keep the consent checkbox required.
3. Loosen **only** `LANDING_CSP` in `vite.config.ts` and the `/` and `/index.html` rules in `web/public/_headers` to `form-action https://<provider-origin>`. Do not change the CSP on `convert.html`.
4. Rebuild and redeploy the static site.

Collect nothing without consent. Do not host your own backend.

---

## 7–9. Launch posts (each venue is its own approval)

Drafts live in `LAUNCH.md`. Nothing has been posted. Re-check https://developers.openai.com/api/docs/deprecations immediately before each post. Replace `[REPO_URL]` and `[DEMO_URL]`. Post from Goblin Dev’s own accounts. Do not ask for upvotes.

### 7. Show HN

- https://news.ycombinator.com/submit
- Title and first-comment text: `LAUNCH.md` section 2
- URL: the repo or the landing page (one URL)
- Submit once

### 8. OpenAI developer forum reply

- Only under an existing thread where someone asks how to keep evals or prompts after the shutdown
- Text: `LAUNCH.md` section 3
- Do not open a standalone promo thread

### 9. promptfoo community

- promptfoo Discord and/or GitHub Discussions, per their self-promotion rules
- Title and body: `LAUNCH.md` section 4

### 10–12. X posts (three separate approvals, or one approval that names all three)

- Post 1, 2, and 3 in `LAUNCH.md` section 5, from the owner’s X account
- Approve them individually if you want them spaced out

---

## Explicitly out of scope until a later approval

| Action | Status |
| --- | --- |
| Any payment, checkout, paid tier, or payment-provider account (Lemon Squeezy, Stripe, PayPal, etc.) | Prohibited until a business licence is approved |
| Creating accounts other than those named above | Not approved |
| Analytics beyond GitHub Insights and optional Cloudflare Pages Web Analytics | Not approved |
| Changing the converter Content-Security-Policy | Not approved |
| Emailing people, outreach beyond the drafts in `LAUNCH.md` | Not approved |

---

## After approvals land

Update `package.json` `repository` / `homepage` / `bugs`, the GitHub links in `web/index.html` and `web/convert.html`, `.github/ISSUE_TEMPLATE/config.yml`, and `LAUNCH.md` placeholders, then ship the commit that contains those real URLs with step 1 or as a fast follow-up push.

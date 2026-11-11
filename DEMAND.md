# Demand measurement plan (first 14 days)

Operator notes for the free release. No new accounts beyond GitHub and the chosen host (GitHub Pages or Cloudflare Pages). Do not add analytics SDKs, pixels, or a form provider until that is separately approved.

Start the 14-day window on the calendar day of the first public launch post (or the day the repo becomes public, if that is later). Check metrics on day 3, day 7, and day 14. Write the numbers in a short note; this file is the plan, not the log.

## Metrics, where to read them, and 14-day targets

| Metric | Where to read it (free, no extra accounts) | 14-day target (healthy) | How to read it |
| --- | --- | --- | --- |
| GitHub stars | Repo header, or Insights → Community if available | 25+ stars | A coarse “this is useful” signal. Discount a same-day spike with no traffic or issues; a slow climb plus clones is stronger. |
| Watchers, especially release-watchers | Repo header (Watch count). There is no separate public number for “Releases only” vs “All activity”. | 10+ watchers | Treat this as the GitHub-native waitlist, together with the Discussion below. Do not over-interpret a single digit; some watchers will be defaults. |
| Traffic and clones | Insights → Traffic (owners/maintainers only). Unique visitors, unique cloners, referring sites, popular content. Data lags about a day and covers a rolling 14 days. | 100+ unique visitors **or** 20+ unique cloners | Clones matter more than raw views: they mean someone pulled the tool. Referring sites should show whether HN, the OpenAI forum, or X actually sent people. Popular content should include `convert.html` if the landing CTA works. |
| Issues filed | Issues tab, especially the “My export didn't convert” template | 3+ issues that include a redacted real-world shape **or** a confirmed successful conversion reported in an issue/comment | Quality over volume. Zero issues can mean no users *or* a smooth converter; pair this with clones and comments. A pile of “it crashed on my export” issues is demand plus product work. |
| npm weekly downloads | https://www.npmjs.com/package/openai-exit-kit (only if a publish is approved) | 50+ downloads in the week after publish | Ignore day-of-publish noise and your own installs. A handful of downloads with no clones or issues is not a signal. If npm is not published, skip this row. |
| Host analytics | **Cloudflare Pages:** project → Web Analytics (free, cookieless; enable in the Pages dashboard, no extra account if you already host there). **GitHub Pages:** do not add a third-party script; use Insights → Traffic only. | 100+ unique visitors, with a visible path to `/convert.html` or a “Try it” click-through you can infer from popular content | Cloudflare Web Analytics is optional and only when Pages is the host. Do not enable Google Analytics or any cookie-based tool for this launch. |
| Waitlist signups | (1) Watch count, (2) thumbs-up + subscribers on the pinned “Notify me about Agent Builder support” Discussion, (3) email form submissions — **zero until a form provider is approved and wired** | 15+ combined GitHub signals (watchers + unique Discussion reactions/comments/subscribers) | This is the demand proxy for Agent Builder and for “tell me when it changes.” Email count stays N/A while the placeholder form is disabled. |
| HN / forum / X engagement | HN: points and comment thread on the Show HN. OpenAI forum: replies on the thread you commented in. promptfoo Discord/Discussions: replies. X: replies and quote-posts, not vanity likes. | Show HN 30+ points with 5+ substantive comments, **or** 3+ forum replies from people who tried it | Substantive means “I ran it on an export and …”, a bug, or a concrete limitation. Points without comments are weak. Do not treat your own posts as engagement. |

## Go / kill thresholds (day 14)

Decide using the whole set, not a single vanity number. If the first post went out late, you may extend the window to a full 14 days after that post, once, and then decide.

**Go (keep investing unpaid time: docs, real-export bugfixes, maybe Agent Builder research):** any two of the following, including at least one usage signal (clones, real issues, or “I tried it” comments):

- 25 or more stars
- 20 or more unique cloners, or 100 or more unique visitors with `/convert.html` among popular content
- 3 or more real-export issues or confirmed conversions
- 15 or more GitHub waitlist signals (watchers + unique Discussion participants)
- A Show HN or forum thread that meets the engagement target above
- 50 or more genuine npm downloads in a week (if published)

**Hold (leave it public, fix clear bugs, do not start new features):** some traffic or stars but no usage signal. Recheck 14 days after the November 30 shutdown, when late exporters may arrive, then apply the same bars.

**Kill / archive (stop outreach, freeze feature work, keep the repo up for anyone who still needs it):** after a full 14-day window *and* at least one well-formed launch post in a relevant venue:

- fewer than 5 stars, **and**
- fewer than 20 unique visitors (or no Insights data and no evidence of visits), **and**
- no real-export issue and no third-party “I tried it” report, **and**
- Discussion / Watch signals under 5

A single harsh comment is not a kill. A competitor that already does the conversion *and* no users choosing this tool is a kill.

## Signals that could justify paid features later

Payments, checkout, and paid tiers are **prohibited** until a business licence is approved. Do not build them during this launch. The list below is only so a later, licensed discussion has evidence, not a roadmap in the product.

Paid features would need **more than curiosity**. Look for several independent users and at least one of:

- Repeated, concrete requests for team or CI use (GitHub Action, bulk conversion of many projects, SSO-free private processing) that people say they would fund or that creates a real support burden.
- Strong Agent Builder demand on the pinned Discussion (for example 30+ unique participants) plus people hitting gaps the official Agents SDK export does not cover.
- Maintainers spending ongoing time on one-off conversions for others, with users asking how to pay for support or a hosted option they understand is optional.
- Sustained usage after November 30 (clones or npm downloads that do not drop to zero once the shutdown has passed), which would mean the tool is still doing work, not only deadline traffic.

Stars or a good HN day alone are not enough. If those signals appear, pause and get the licence and payment-rail questions settled before writing any paid code.

## Checkpoint habit

On day 3 / 7 / 14, record: date, stars, watchers, unique visitors, unique cloners, top referrers, issue count (and how many are real exports), Discussion reactions/subscribers, npm downloads if any, and a one-line read (go / hold / not enough data). If weekly usage of the operator’s own tools hits 80%, save that note and stop at the next decent checkpoint rather than mid-count.

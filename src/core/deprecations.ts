/**
 * Model shutdowns taken from OpenAI's deprecations page
 * (https://developers.openai.com/api/docs/deprecations), read on 2026-11-10.
 * This is a snapshot, not a live feed: always re-check the page, and prefer the
 * `shutdown_date` field returned by `GET /v1/models`. The CLI never calls the network for this.
 */
export interface Shutdown {
  ids: string[];
  date: string; // YYYY-MM-DD
  replacement?: string;
}

export const DEPRECATIONS_CHECKED = "2026-11-10";
export const DEPRECATIONS_SOURCE = "https://developers.openai.com/api/docs/deprecations";

export const SHUTDOWNS: Shutdown[] = [
  { ids: ["gpt-4o-2024-08-06", "gpt-4o-2024-11-20", "gpt-4o-mini-2024-07-18", "gpt-4.1-2025-04-14", "gpt-4.1-mini-2025-04-14"], date: "2027-01-14", replacement: "gpt-6-luna" },
  { ids: ["gpt-5", "gpt-5-2025-08-07", "o3", "o3-2025-04-16", "gpt-5-pro", "gpt-5-pro-2025-10-06", "o3-pro", "o3-pro-2025-06-10"], date: "2026-12-11", replacement: "gpt-5.6-sol" },
  { ids: ["gpt-5-mini", "gpt-5-mini-2025-08-07"], date: "2026-12-11", replacement: "gpt-5.6-terra" },
  { ids: ["gpt-5-nano", "gpt-5-nano-2025-08-07"], date: "2026-12-11", replacement: "gpt-5.6-luna" },
  { ids: ["gpt-5.1", "gpt-5.1-2025-11-13", "gpt-5.3-codex"], date: "2027-04-01", replacement: "gpt-6-sol" },
  { ids: ["gpt-5.4-nano", "gpt-5.4-nano-2026-03-17"], date: "2027-04-01", replacement: "gpt-6-luna" },
  { ids: ["tts-1", "tts-1-hd", "gpt-4o-mini-tts", "gpt-4o-mini-tts-2025-03-20", "gpt-4o-mini-tts-2025-12-15"], date: "2027-01-06", replacement: "gpt-realtime-2.1-mini" },
  { ids: ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe", "gpt-4o-transcribe-diarize"], date: "2027-02-26", replacement: "gpt-live-transcribe or gpt-transcribe" },
  { ids: ["gpt-image-1-mini", "gpt-image-1.5", "chatgpt-image-latest"], date: "2026-12-01", replacement: "gpt-image-2.6-sunburst or gpt-image-2.6-flare" },
  { ids: ["gpt-image-2", "gpt-image-2-2026-04-21"], date: "2027-02-10", replacement: "gpt-image-2.6-sunburst or gpt-image-2.6-flare" },
  { ids: ["gpt-5.5-cyber-preview"], date: "2027-02-01" },
  // Already shut down on 2026-10-23 (and earlier):
  { ids: ["gpt-3.5-turbo-0125", "gpt-4-0613", "gpt-4-1106-preview", "gpt-4-turbo", "gpt-4o-2024-05-13", "o1-2024-12-17", "o3-mini-2025-01-31", "o4-mini-2025-04-16"], date: "2026-10-23", replacement: "gpt-5.6-sol (gpt-5.6-terra for mini models)" },
  { ids: ["gpt-4.1-nano", "gpt-4.1-nano-2025-04-14"], date: "2026-10-23", replacement: "gpt-5.6-luna" },
  { ids: ["gpt-3.5-turbo-instruct", "babbage-002", "davinci-002", "gpt-3.5-turbo-1106"], date: "2026-09-28", replacement: "gpt-5.6-terra" },
];

export interface ShutdownInfo {
  model: string;
  date: string;
  replacement?: string;
  alreadyShutDown: boolean;
}

export function lookupShutdown(model: string | undefined, now: Date = new Date()): ShutdownInfo | undefined {
  if (!model) return undefined;
  const m = model.trim();
  for (const s of SHUTDOWNS) {
    if (s.ids.includes(m)) {
      return { model: m, date: s.date, replacement: s.replacement, alreadyShutDown: new Date(s.date + "T00:00:00Z").getTime() <= now.getTime() };
    }
  }
  return undefined;
}

/** First concrete model id inside a replacement string like "a or b" (for --replace-deprecated). */
export function firstReplacementId(replacement?: string): string | undefined {
  if (!replacement) return undefined;
  const m = replacement.match(/[a-z0-9][a-z0-9._-]*/i);
  return m ? m[0] : undefined;
}

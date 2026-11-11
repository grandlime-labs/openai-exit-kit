import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { InputFile } from "../src/core/types";

export const ROOT = resolve(__dirname, "..");
export const FIX = join(ROOT, "fixtures");

export function readDir(dir: string, exts = /\.(json|jsonl|txt|md)$/i): InputFile[] {
  const out: InputFile[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (exts.test(n)) out.push({ name: relative(dir, p), text: readFileSync(p, "utf8") });
    }
  };
  walk(dir);
  return out;
}

export const evalFixtures = () => readDir(join(FIX, "evals-export"));
export const promptFixtures = () => readDir(join(FIX, "prompts"));

/** Run a generated `javascript` assertion body the way promptfoo does (function body with `output` and `context`). */
export function runJsAssertion(body: string, output: unknown, vars: Record<string, unknown>): { pass: boolean; score: number; reason?: string } {
  const fn = new Function("output", "context", body);
  const r = fn(output, { vars });
  return typeof r === "object" ? r : { pass: !!r, score: r ? 1 : 0 };
}

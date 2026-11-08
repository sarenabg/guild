import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { Activity, AgentSpec, Bid, Glyph, Payout, Skill, Tx, WorkStep } from "../types";
import { config } from "../config";

// What the live version keeps off-chain. Money and statuses live in the
// contract; this file holds the words: agent instructions (matched to their
// on-chain fingerprint), offers, each agent's work, the result text, and a
// log of the runner's own transactions.

export type LiveSpec = AgentSpec & { name: string; tagline: string; skill: Skill; glyph: Glyph; hue: number; at: number };

export type LiveJobExtra = {
  bids: Bid[];
  steps: WorkStep[];
  result: string | null;
  attempts: number;
  payouts: Payout[];
  /** The last result_check we already answered (so a restart doesn't answer twice). */
  checkedDelivery?: number;
};

export type LiveState = {
  version: 1;
  specs: Record<string, LiveSpec>;
  jobs: Record<string, LiveJobExtra>;
  txs: Tx[];
  activity: Activity[];
};

type G = { s?: LiveState; queue: Promise<unknown> };
const g = globalThis as unknown as { __guildLive?: G };
const box: G = (g.__guildLive ??= { queue: Promise.resolve() });

const file = () => path.resolve(process.cwd(), config.dataDir, `live-${config.network}-${config.liveContract || "none"}.json`);

export function live(): LiveState {
  if (box.s) return box.s;
  try {
    box.s = JSON.parse(fs.readFileSync(file(), "utf8")) as LiveState;
  } catch {
    box.s = { version: 1, specs: {}, jobs: {}, txs: [], activity: [] };
  }
  return box.s;
}

export function changeLive<T>(fn: (s: LiveState) => T): Promise<T> {
  const run = async () => {
    const s = live();
    const out = fn(s);
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(`${file()}.tmp`, JSON.stringify(s));
    fs.renameSync(`${file()}.tmp`, file());
    return out;
  };
  const p = box.queue.then(run, run);
  box.queue = p.catch(() => undefined);
  return p;
}

export function jobExtra(s: LiveState, id: number): LiveJobExtra {
  return (s.jobs[id] ??= { bids: [], steps: [], result: null, attempts: 0, payouts: [] });
}

export function liveLog(s: LiveState, entry: Omit<Activity, "at">) {
  s.activity.unshift({ at: Date.now(), ...entry });
  s.activity.length = Math.min(s.activity.length, 300);
}

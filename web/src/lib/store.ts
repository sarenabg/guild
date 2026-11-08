import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { Activity, World } from "./types";
import { config } from "./config";
import { seedWorld } from "./seed";

// State lives in "worlds". Every demo visitor gets their own private world
// (keyed by a cookie), saved as data/worlds/<id>.json. Changes to one world go
// through a queue so two requests never interleave a change.

export const WORLD_VERSION = 4;
const MAX_IN_MEMORY = 300;
const DEMO_TTL_MS = 7 * 24 * 3_600_000;

type Slot = { world: World; queue: Promise<unknown>; touched: number };
type G = { worlds: Map<string, Slot>; swept?: number };
const g = globalThis as unknown as { __guildWorlds?: G };
const state: G = (g.__guildWorlds ??= { worlds: new Map() });

export const isWorldId = (id: string) => /^[a-z0-9]{12,40}$/.test(id);

function dir() {
  return path.resolve(process.cwd(), config.dataDir, "worlds");
}
const file = (id: string) => path.join(dir(), `${id}.json`);

function slot(id: string): Slot {
  if (!isWorldId(id)) throw new Error("bad world id");
  let s = state.worlds.get(id);
  if (!s) {
    let world: World | null = null;
    try {
      const w = JSON.parse(fs.readFileSync(file(id), "utf8")) as World;
      if (w.version === WORLD_VERSION) world = w;
    } catch {
      // new visitor, or an old file: start fresh
    }
    s = { world: world ?? seedWorld(), queue: Promise.resolve(), touched: Date.now() };
    state.worlds.set(id, s);
    if (!world) save(id, s.world);
    evict();
  }
  s.touched = Date.now();
  return s;
}

function save(id: string, w: World) {
  fs.mkdirSync(dir(), { recursive: true });
  const tmp = `${file(id)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(w));
  fs.renameSync(tmp, file(id));
}

/** Drop the least recently used worlds from memory (they stay on disk). */
function evict() {
  if (state.worlds.size <= MAX_IN_MEMORY) return;
  const old = [...state.worlds.entries()].sort((a, b) => a[1].touched - b[1].touched);
  for (const [id] of old.slice(0, state.worlds.size - MAX_IN_MEMORY)) state.worlds.delete(id);
  sweep();
}

/** Delete demo worlds nobody has opened for a week. */
function sweep() {
  if (state.swept && Date.now() - state.swept < 3_600_000) return;
  state.swept = Date.now();
  try {
    for (const f of fs.readdirSync(dir())) {
      const p = path.join(dir(), f);
      if (Date.now() - fs.statSync(p).mtimeMs > DEMO_TTL_MS) fs.rmSync(p, { force: true });
    }
  } catch {
    // nothing to sweep yet
  }
}

/** Read-only snapshot of a world. */
export function getWorld(id: string): World {
  return slot(id).world;
}

/** Change a world. Changes are applied one at a time and saved. */
export function mutate<T>(id: string, fn: (w: World) => T): Promise<T> {
  const s = slot(id);
  const run = async () => {
    const out = fn(s.world);
    save(id, s.world);
    return out;
  };
  const p = s.queue.then(run, run);
  s.queue = p.catch(() => undefined);
  return p;
}

export function resetWorld(id: string) {
  const s = slot(id);
  s.world = seedWorld();
  save(id, s.world);
}

export function log(w: World, entry: Omit<Activity, "at">) {
  w.activity.unshift({ at: Date.now(), ...entry });
  w.activity.length = Math.min(w.activity.length, 200);
}

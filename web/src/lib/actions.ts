import "server-only";
import type { Agent, Glyph, Skill, World } from "./types";
import * as L from "./ledger";
import { getWorld, log, mutate, resetWorld } from "./store";
import { config, liveAi } from "./config";
import { ensureRunning, specHash } from "./runtime";
import { fmtNear, near } from "./money";
import { ALLOWED_TOOLS } from "./guardrails";

// What the screens can do. Each action checks its input, then goes through
// the ledger (same rules as the contract) and wakes the runner.

export class InputError extends Error {}

const SKILLS: Skill[] = ["research", "analyze", "write", "translate", "code", "check"];
const GLYPHS: Glyph[] = ["eye", "pen", "lens", "spark", "globe", "chart", "shield", "code", "leaf"];

function num(v: unknown, name: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new InputError(`${name} must be between ${min} and ${max}`);
  return n;
}
function str(v: unknown, name: string, max: number, min = 0): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length < min) throw new InputError(min <= 1 ? `${name} is required` : `${name} needs at least ${min} characters`);
  if (s.length > max) throw new InputError(`${name} must be at most ${max} characters`);
  return s;
}

export async function postJob(wid: string, body: Record<string, unknown>) {
  const title = str(body.title, "Title", 120, 1);
  const brief = str(body.brief, "What you need", 2000, 1);
  const budget = num(body.budget, "Budget", 0.1, 10_000);
  const hours = num(body.hours ?? 24, "Deadline", 0.25, 24 * 30);
  const job = await mutate(wid, (w) => {
    const j = L.postJob(w, config.you, {
      title,
      brief,
      deadline_ms: Date.now() + hours * 3_600_000,
      deposit: near(budget) + L.JOB_STORAGE,
    });
    log(w, { kind: "job", text: `New job "${title}" with ${fmtNear(j.budget)} NEAR held`, job: j.id });
    return j;
  });
  ensureRunning(wid);
  return { id: job.id };
}

export async function jobAction(wid: string, id: number, body: Record<string, unknown>) {
  const action = String(body.action ?? "");
  await mutate(wid, (w) => {
    const j = w.jobs[id];
    if (!j) throw new L.LedgerError("Unknown job");
    if (action === "approve") {
      L.approve(w, id, config.you);
      j.phase = "done";
      log(w, { kind: "pay", text: `"${j.title}" approved: crew paid`, job: id });
    } else if (action === "dispute") {
      L.dispute(w, id, config.you);
      j.phase = "disputed";
      log(w, { kind: "warn", text: `"${j.title}" disputed: the council will decide`, job: id });
    } else if (action === "cancel") {
      L.cancelJob(w, id, config.you);
      j.phase = "refunded";
      log(w, { kind: "job", text: `"${j.title}" cancelled and refunded`, job: id });
    } else if (action === "resolve") {
      // Demo only: the visitor can play the council.
      const bps = num(body.crewBps, "Crew share", 0, 10_000);
      L.resolve(w, id, Math.round(bps));
      j.phase = j.status === "Refunded" ? "refunded" : "done";
      log(w, { kind: "pay", text: `Council settled "${j.title}"`, job: id });
    } else {
      throw new InputError("Unknown action");
    }
  });
  ensureRunning(wid);
}

export async function addAgent(wid: string, body: Record<string, unknown>) {
  const name = str(body.name, "Name", 40, 1);
  const tagline = str(body.tagline ?? "", "Tagline", 60);
  const skill = SKILLS.includes(body.skill as Skill) ? (body.skill as Skill) : "write";
  const glyph = GLYPHS.includes(body.glyph as Glyph) ? (body.glyph as Glyph) : "spark";
  const hue = Math.round(num(body.hue ?? 40, "Colour", 0, 360));
  const instructions = str(body.instructions, "Instructions", 4000, 10);
  const knowledge = str(body.knowledge ?? "", "Knowledge", 20_000);
  const tools = Array.isArray(body.tools) ? body.tools.map(String).slice(0, 8) : [];
  // Unknown tools are allowed through here on purpose: the safety review catches them.
  const fuel = num(body.fuel, "Fuel", 0.1, 1_000);
  const maxPerJob = num(body.maxPerJob ?? 0.5, "Fuel per job", 0.001, 1_000);
  const refuelPct = num(body.refuelPct ?? 20, "Refuel share", 0, 100);
  const creatorPct = num(body.creatorPct ?? 50, "Creator share", 0, 100);
  const spec = { instructions, knowledge, tools };
  const id = await mutate(wid, (w) => {
    const handle = uniqueHandle(w, name);
    L.registerAgent(w, config.you, {
      id: handle,
      name,
      spec_hash: specHash(spec),
      tools,
      max_fuel_per_job: near(maxPerJob),
      refuel_bps: Math.round(refuelPct * 100),
      creator_bps: Math.round(creatorPct * 100),
      deposit: near(fuel) + L.AGENT_STORAGE,
      tagline: tagline || "New agent",
      skill,
      hue,
      glyph,
      spec,
    });
    log(w, { kind: "agent", text: `${name} asked to join the guild`, agent: handle });
    return handle;
  });
  ensureRunning(wid);
  return { id };
}

function uniqueHandle(w: World, name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).padEnd(3, "x");
  let h = base;
  for (let i = 2; w.agents[h]; i++) h = `${base}-${i}`;
  return h;
}

export async function agentAction(wid: string, id: string, body: Record<string, unknown>) {
  const action = String(body.action ?? "");
  return mutate(wid, (w) => {
    const a = w.agents[id];
    if (!a) throw new L.LedgerError("Unknown agent");
    if (action === "fund") {
      const amount = num(body.amount, "Amount", 0.001, 1_000);
      L.fundAgent(w, id, config.you, near(amount));
      log(w, { kind: "fund", text: `You added ${amount} NEAR of fuel to ${a.name}`, agent: id });
    } else if (action === "claim") {
      const got = L.claimEarnings(w, id, config.you);
      log(w, { kind: "pay", text: `You claimed ${fmtNear(got)} NEAR earned by ${a.name}`, agent: id });
    } else if (action === "retire") {
      L.retireAgent(w, id, config.you);
      log(w, { kind: "agent", text: `${a.name} retired`, agent: id });
    } else {
      throw new InputError("Unknown action");
    }
  });
}

export async function reset(wid: string) {
  resetWorld(wid);
  ensureRunning(wid);
}

// ----- Read views -----------------------------------------------------------

export function worldView(wid: string) {
  ensureRunning(wid);
  const w = getWorld(wid);
  const agents = Object.values(w.agents).sort((a, b) => b.created_at_ms - a.created_at_ms);
  const jobs = Object.values(w.jobs).sort((a, b) => b.id - a.id);
  const paid = jobs.filter((j) => j.status === "Paid" || j.status === "Split").reduce((s, j) => s + BigInt(j.budget), 0n);
  return {
    mode: {
      ai: liveAi() ? "near-ai" : "demo",
      chain: "demo-ledger",
      model: config.model,
    },
    you: { account: config.you, balance: w.balances[config.you] ?? "0" },
    stats: {
      agents: agents.filter((a) => a.status === "Active").length,
      jobsDone: jobs.filter((j) => j.status === "Paid" || j.status === "Split").length,
      paid: paid.toString(),
      working: jobs.filter((j) => ["Working", "Delivered", "InReview", "Open"].includes(j.status)).length,
    },
    agents: agents.map(publicAgent),
    jobs: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      status: j.status,
      phase: j.phase,
      budget: j.budget,
      poster: j.poster,
      crew: j.crew.map((c) => c.agent),
      created_at_ms: j.created_at_ms,
    })),
    activity: w.activity.slice(0, 30),
    txs: w.txs.slice(0, 40),
    tools: ALLOWED_TOOLS,
  };
}

export function publicAgent(a: Agent) {
  return a;
}

export function jobView(wid: string, id: number) {
  ensureRunning(wid);
  const w = getWorld(wid);
  const j = w.jobs[id];
  if (!j) return null;
  const ids = new Set([...j.bids.map((b) => b.agent), ...j.crew.map((c) => c.agent)]);
  return {
    job: j,
    agents: Object.fromEntries([...ids].map((a) => [a, w.agents[a]])),
    you: config.you,
    now: Date.now(),
    mode: "demo",
    council: null as string | null,
    txs: w.txs.filter((t) => t.summary.includes(`#${id}`) || t.summary.includes(`"${j.title}"`)).slice(0, 20),
  };
}

export function agentView(wid: string, id: string) {
  ensureRunning(wid);
  const w = getWorld(wid);
  const a = w.agents[id];
  if (!a) return null;
  const jobs = Object.values(w.jobs)
    .filter((j) => j.crew.some((c) => c.agent === id))
    .sort((x, y) => y.id - x.id)
    .map((j) => ({ id: j.id, title: j.title, status: j.status, pay: j.payouts.find((p) => p.agent === id)?.pay ?? null }));
  return {
    agent: a,
    you: config.you,
    mine: a.owner === config.you,
    funding: L.getFunder(w, id, config.you),
    jobs,
    balance: w.balances[config.you] ?? "0",
    txs: w.txs.filter((t) => t.summary.includes(a.name)).slice(0, 20),
  };
}

import "server-only";
import crypto from "node:crypto";
import type { Agent, Glyph, Job, Payout, Phase, Skill, Verdict } from "../types";
import { config, liveProblem } from "../config";
import { specHash } from "../runtime";
import { ALLOWED_TOOLS } from "../guardrails";
import { InputError } from "../actions";
import { balanceOf, view } from "./near";
import { refresh, snapshot, startLive, withSpec, type ChainAgent, type ChainJob, type ChainVerdict } from "./runner";
import { changeLive, live, type LiveSpec } from "./state";

// The live version's read side: the same shapes as the demo views, built from
// the contract (money, statuses) plus the runner's saved text.

const SKILLS: Skill[] = ["research", "analyze", "write", "translate", "code", "check"];
const GLYPHS: Glyph[] = ["eye", "pen", "lens", "spark", "globe", "chart", "shield", "code", "leaf"];
const ms = (ns: number | null | undefined) => (ns ? Math.round(ns / 1e6) : null);

export function liveConfig() {
  startLive();
  const snap = snapshot();
  return {
    enabled: Boolean(config.liveContract),
    network: config.network,
    contract: config.liveContract,
    council: snap.config?.council ?? null,
    runner: snap.config?.runner ?? null,
    problem: liveProblem(),
    model: config.model,
  };
}

function verdict(v: ChainVerdict | null): Verdict | null {
  if (!v) return null;
  return { ...v, by: "ai", verified: v.verified_signer ? { signer: v.verified_signer, kind: "provider_tee" } : null };
}

function phaseOf(j: ChainJob, attempts: number): Phase {
  switch (j.status) {
    case "InReview":
      return "reviewing";
    case "Rejected":
    case "ReviewTimedOut":
      return "rejected";
    case "Open":
      return "bidding";
    case "Working":
      return "working";
    case "Delivered":
      return j.result_check || attempts >= 2 ? "waiting" : "checking";
    case "Disputed":
      return "disputed";
    case "Refunded":
      return "refunded";
    default:
      return "done";
  }
}

/** The contract's payout split, recomputed for display (it pays exactly this). */
function payouts(j: ChainJob, agents: Record<string, ChainAgent>): Payout[] {
  if (j.status !== "Paid") return [];
  const budget = BigInt(j.budget);
  let paid = 0n;
  return j.crew.map((m, i) => {
    const pay = i + 1 === j.crew.length ? budget - paid : (budget * BigInt(m.share_bps)) / 10_000n;
    paid += pay;
    const a = agents[m.agent];
    const refuel = (pay * BigInt(a?.refuel_bps ?? 0)) / 10_000n;
    const creator = ((pay - refuel) * BigInt(a?.creator_bps ?? 0)) / 10_000n;
    return { agent: m.agent, pay: pay.toString(), refuel: refuel.toString(), creator: creator.toString(), funders: (pay - refuel - creator).toString() };
  });
}

function toJob(j: ChainJob, agents: Record<string, ChainAgent>): Job {
  const ex = live().jobs[j.id];
  return {
    id: j.id,
    poster: j.poster,
    title: j.title,
    brief: j.brief,
    budget: j.budget,
    status: j.status as Job["status"],
    created_at_ms: ms(j.created_at_ns)!,
    deadline_ms: ms(j.deadline_ns)!,
    review: verdict(j.review),
    crew: j.crew,
    result_hash: j.result_hash,
    result_check: verdict(j.result_check),
    release_at_ms: ms(j.release_at_ns),
    delivered_at_ms: ms(j.delivered_at_ns),
    disputed_at_ms: ms(j.disputed_at_ns),
    phase: phaseOf(j, ex?.attempts ?? 0),
    bids: ex?.bids ?? [],
    steps: ex?.steps ?? [],
    result: ex?.result ?? null,
    payouts: payouts(j, agents),
    attempts: ex?.attempts ?? 0,
  };
}

/** Agents whose instructions were never shared still show, with a neutral look. */
function toAgent(a: ChainAgent): Agent {
  const spec = live().specs[a.spec_hash];
  const full = withSpec(a, spec);
  if (full) return full;
  const h = parseInt(crypto.createHash("sha256").update(a.id).digest("hex").slice(0, 6), 16);
  return {
    ...(a as unknown as Agent),
    tagline: "Instructions not shared",
    skill: "write",
    hue: h % 360,
    glyph: GLYPHS[h % GLYPHS.length],
    spec: { instructions: "This agent's owner hasn't shared its instructions with this site.", knowledge: "", tools: a.tools },
    created_at_ms: Math.round(a.last_active_ns / 1e6),
    last_active_ms: Math.round(a.last_active_ns / 1e6),
  };
}

export async function liveWorldView(account: string | null) {
  startLive();
  const snap = await refresh();
  const byId = Object.fromEntries(snap.agents.map((a) => [a.id, a]));
  const agents = snap.agents.map(toAgent).sort((a, b) => b.jobs_done - a.jobs_done);
  const jobs = snap.jobs.map((j) => toJob(j, byId));
  const paid = jobs.filter((j) => j.status === "Paid" || j.status === "Split").reduce((s, j) => s + BigInt(j.budget), 0n);
  const s = live();
  return {
    mode: { ai: "near-ai", chain: config.network, contract: config.liveContract, model: config.model, problem: liveProblem(), error: snap.error ?? null },
    you: { account: account ?? "", balance: account ? await balanceOf(account) : "0" },
    stats: {
      agents: agents.filter((a) => a.status === "Active").length,
      jobsDone: jobs.filter((j) => j.status === "Paid" || j.status === "Split").length,
      paid: paid.toString(),
      working: jobs.filter((j) => ["Working", "Delivered", "InReview", "Open"].includes(j.status)).length,
    },
    agents,
    jobs: jobs.map((j) => ({ id: j.id, title: j.title, status: j.status, phase: j.phase, budget: j.budget, poster: j.poster, crew: j.crew.map((c) => c.agent), created_at_ms: j.created_at_ms })),
    activity: s.activity.slice(0, 30),
    txs: s.txs.slice(0, 40),
    tools: ALLOWED_TOOLS,
  };
}

export async function liveJobView(id: number, account: string | null) {
  startLive();
  const snap = await refresh();
  let chainJob = snap.jobs.find((j) => j.id === id);
  if (!chainJob) {
    chainJob = (await view<ChainJob | null>("get_job", { job_id: id })) ?? undefined;
    if (!chainJob) return null;
  }
  const byId = Object.fromEntries(snap.agents.map((a) => [a.id, a]));
  const job = toJob(chainJob, byId);
  const ids = new Set([...job.bids.map((b) => b.agent), ...job.crew.map((c) => c.agent)]);
  return {
    job,
    agents: Object.fromEntries([...ids].filter((a) => byId[a]).map((a) => [a, toAgent(byId[a])])),
    you: account ?? "",
    now: Date.now(),
    mode: "near-ai",
    council: snap.config?.council ?? null,
    txs: live().txs.filter((t) => t.summary.includes(`#${id}`)).slice(0, 20),
  };
}

export async function liveAgentView(id: string, account: string | null) {
  startLive();
  const snap = await refresh();
  const a = snap.agents.find((x) => x.id === id) ?? (await view<ChainAgent | null>("get_agent", { agent_id: id }));
  if (!a) return null;
  const agent = toAgent(a);
  const funding = account ? await view<{ shares: string; claimable: string }>("get_funder", { agent_id: id, account_id: account }).catch(() => ({ shares: "0", claimable: "0" })) : { shares: "0", claimable: "0" };
  const jobs = snap.jobs
    .filter((j) => j.crew.some((c) => c.agent === id))
    .map((j) => ({ id: j.id, title: j.title, status: j.status, pay: null as string | null }));
  return {
    agent,
    you: account ?? "",
    mine: account === a.owner,
    funding,
    jobs,
    balance: account ? await balanceOf(account) : "0",
    txs: live().txs.filter((t) => t.summary.includes(a.name)).slice(0, 20),
  };
}

/**
 * Save an agent's instructions before its owner registers it on-chain.
 * Returns the fingerprint to register with; the reviewer matches the two.
 */
export async function saveSpec(body: Record<string, unknown>) {
  const str = (v: unknown, name: string, max: number, min = 0) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (s.length < min || s.length > max) throw new InputError(`${name} must be ${min} to ${max} characters`);
    return s;
  };
  const spec: LiveSpec = {
    name: str(body.name, "Name", 40, 1),
    tagline: str(body.tagline ?? "", "Tagline", 60) || "New agent",
    skill: SKILLS.includes(body.skill as Skill) ? (body.skill as Skill) : "write",
    glyph: GLYPHS.includes(body.glyph as Glyph) ? (body.glyph as Glyph) : "spark",
    hue: Math.max(0, Math.min(360, Math.round(Number(body.hue ?? 40)))),
    instructions: str(body.instructions, "Instructions", 4000, 10),
    knowledge: str(body.knowledge ?? "", "Knowledge", 20_000),
    tools: Array.isArray(body.tools) ? body.tools.map(String).slice(0, 8) : [],
    at: Date.now(),
  };
  const hash = specHash(spec);
  await changeLive((s) => {
    s.specs[hash] ??= spec;
  });
  const base = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20).padEnd(3, "x");
  const handle = `${base}-${crypto.randomBytes(3).toString("hex")}`;
  return { spec_hash: hash, id: handle, tools: spec.tools };
}

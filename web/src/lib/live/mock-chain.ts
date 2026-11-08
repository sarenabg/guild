import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { Verdict, World } from "../types";
import * as L from "../ledger";
import { config } from "../config";

// A practice chain for the Live version (GUILD_LIVE_MOCK=1). It answers the
// same view and change methods as the Guild contract, in the contract's JSON
// shapes, using the demo ledger's rules (a line-by-line copy of the contract).
// It lets the live runner and the Live screens run end to end with no NEAR
// account. Never used when a real contract is configured without the flag.

const ns = (ms: number | null | undefined) => (ms ? ms * 1_000_000 : null);
const file = () => path.resolve(process.cwd(), config.dataDir, "mock-chain.json");

type G = { w?: World; n: number };
const g = globalThis as unknown as { __guildMock?: G };
const box: G = (g.__guildMock ??= { n: 0 });

function world(): World {
  if (box.w) return box.w;
  try {
    box.w = JSON.parse(fs.readFileSync(file(), "utf8")) as World;
  } catch {
    box.w = { version: 4, created_at: Date.now(), next_job_id: 1, jobs: {}, agents: {}, funders: {}, balances: {}, owed: {}, runner_fuel_earned: "0", txs: [], activity: [] };
  }
  return box.w;
}
function save() {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(box.w));
}
export function resetMock() {
  box.w = undefined;
  fs.rmSync(file(), { force: true });
}

export const MOCK_COUNCIL = "you.mock";

function verdictOut(v: Verdict | null) {
  return v ? { ...L.chainVerdict(v), verified_signer: null } : null;
}
function verdictIn(v: { approved: boolean; checks: { name: string; passed: boolean }[]; summary: string; receipt: string }): Verdict {
  if (v.approved && v.checks.some((c) => !c.passed)) throw new Error("An approval cannot include a failed check");
  return { approved: v.approved, checks: v.checks, summary: v.summary, receipt: v.receipt, by: "ai" };
}

function jobOut(id: number) {
  const j = world().jobs[id];
  if (!j) return null;
  return {
    id: j.id,
    poster: j.poster,
    title: j.title,
    brief: j.brief,
    budget: j.budget,
    status: j.status,
    created_at_ns: ns(j.created_at_ms),
    deadline_ns: ns(j.deadline_ms),
    review: verdictOut(j.review),
    crew: j.crew,
    result_hash: j.result_hash,
    result_check: verdictOut(j.result_check),
    release_at_ns: ns(j.release_at_ms),
    delivered_at_ns: ns(j.delivered_at_ms),
    disputed_at_ns: ns(j.disputed_at_ms),
  };
}
function agentOut(id: string) {
  const a = world().agents[id];
  if (!a) return null;
  return {
    id: a.id,
    owner: a.owner,
    name: a.name,
    spec_hash: a.spec_hash,
    tools: a.tools,
    fuel: a.fuel,
    max_fuel_per_job: a.max_fuel_per_job,
    refuel_bps: a.refuel_bps,
    creator_bps: a.creator_bps,
    status: a.status,
    review: verdictOut(a.review),
    jobs_done: a.jobs_done,
    earned: a.earned,
    funded: a.funded,
    busy_jobs: a.busy_jobs,
    total_shares: a.total_shares,
    funders: a.funders,
    earned_per_share: a.earned_per_share,
    last_active_ns: ns(a.last_active_ms),
  };
}

/** Free read, like an RPC view call. */
export function mockView(method: string, args: Record<string, unknown>): unknown {
  const w = world();
  switch (method) {
    case "get_config":
      return {
        reviewer: config.operatorId,
        runner: config.operatorId,
        council: MOCK_COUNCIL,
        release_after_ns: config.releaseAfterMs * 1_000_000,
        job_count: w.next_job_id - 1,
        agent_count: Object.keys(w.agents).length,
        runner_fuel_earned: w.runner_fuel_earned,
      };
    case "list_jobs":
      return Object.values(w.jobs).sort((a, b) => b.id - a.id).slice(0, Number(args.limit ?? 100)).map((j) => jobOut(j.id));
    case "list_agents":
      return Object.keys(w.agents).slice(Number(args.from_index ?? 0), Number(args.from_index ?? 0) + Number(args.limit ?? 100)).map(agentOut);
    case "get_job":
      return jobOut(Number(args.job_id));
    case "get_agent":
      return agentOut(String(args.agent_id));
    case "get_funder":
      return L.getFunder(w, String(args.agent_id), String(args.account_id));
    case "tee_signers":
      return [];
    case "owed_to":
      return "0";
    default:
      throw new Error(`unknown view ${method}`);
  }
}

const RUNNER_METHODS = new Set(["submit_review", "assign_crew", "charge_fuel", "deliver", "check_delivery"]);

/**
 * A signed call. `signer` is whoever signed; `deposit` is attached yoctoNEAR.
 * Returns the method's return value, or throws with the contract's panic message.
 */
export function mockCall(signer: string, method: string, args: Record<string, unknown>, deposit = 0n): unknown {
  const w = world();
  w.balances[signer] ??= (1000n * 10n ** 24n).toString(); // practice accounts start with 1,000 NEAR
  if (RUNNER_METHODS.has(method) && signer !== config.operatorId) throw new Error(`Only the ${method.includes("review") || method === "check_delivery" ? "reviewer" : "runner"}`);
  if (method === "resolve" && signer !== MOCK_COUNCIL) throw new Error("Only the council");
  let out: unknown = null;
  switch (method) {
    case "post_job": {
      const j = L.postJob(w, signer, {
        title: String(args.title ?? ""),
        brief: String(args.brief ?? ""),
        deadline_ms: Math.round(Number(args.deadline_ns) / 1_000_000),
        deposit,
      });
      out = j.id;
      break;
    }
    case "register_agent":
      L.registerAgent(w, signer, {
        id: String(args.id),
        name: String(args.name),
        spec_hash: String(args.spec_hash),
        tools: (args.tools as string[]) ?? [],
        max_fuel_per_job: BigInt(String(args.max_fuel_per_job)),
        refuel_bps: Number(args.refuel_bps),
        creator_bps: Number(args.creator_bps),
        deposit,
        tagline: "",
        skill: "write",
        hue: 0,
        glyph: "spark",
        spec: { instructions: "", knowledge: "", tools: [] },
      });
      break;
    case "submit_review": {
      const s = args.subject as { Job?: number; Agent?: string };
      const v = verdictIn(args.verdict as Parameters<typeof verdictIn>[0]);
      if (s.Job !== undefined) {
        if (w.jobs[s.Job]?.status !== "InReview") throw new Error("No review is waiting for this");
        L.finishJobReview(w, s.Job, v);
      } else {
        if (w.agents[String(s.Agent)]?.status !== "InReview") throw new Error("No review is waiting for this");
        L.finishAgentReview(w, String(s.Agent), v);
      }
      break;
    }
    case "assign_crew":
      L.assignCrew(w, Number(args.job_id), args.crew as [string, number][]);
      break;
    case "charge_fuel":
      L.chargeFuel(w, Number(args.job_id), String(args.agent_id), BigInt(String(args.amount)), String(args.receipt));
      break;
    case "deliver":
      L.deliver(w, Number(args.job_id), String(args.result_hash));
      break;
    case "check_delivery":
      L.checkDelivery(w, Number(args.job_id), verdictIn(args.verdict as Parameters<typeof verdictIn>[0]), config.releaseAfterMs);
      break;
    case "approve":
      L.approve(w, Number(args.job_id), signer);
      break;
    case "release":
      L.release(w, Number(args.job_id), signer);
      break;
    case "dispute":
      L.dispute(w, Number(args.job_id), signer);
      break;
    case "resolve":
      L.resolve(w, Number(args.job_id), Number(args.crew_bps));
      break;
    case "cancel_job":
      L.cancelJob(w, Number(args.job_id), signer);
      break;
    case "fund_agent":
      L.fundAgent(w, String(args.agent_id), signer, deposit);
      break;
    case "claim_earnings":
      out = L.claimEarnings(w, String(args.agent_id), signer).toString();
      break;
    case "retire_agent":
      L.retireAgent(w, String(args.agent_id), signer);
      break;
    default:
      throw new Error(`unknown method ${method}`);
  }
  save();
  return out;
}

/** A fake transaction hash for the practice chain's log. */
export function mockHash(): string {
  box.n += 1;
  return `mock${Date.now().toString(36)}${box.n}`;
}

export function mockBalance(account: string): string {
  return world().balances[account] ?? (1000n * 10n ** 24n).toString();
}

import type { Agent, ChainArgs, Funder, Glyph, Job, Payout, Tx, Verdict, World } from "./types";
import { BPS, MILLI, add, near, sub } from "./money";

// The demo ledger: a line-by-line TypeScript copy of the Guild contract's rules
// (contracts/swarm/src/lib.rs). Same checks, same error messages, same money
// math, so demo mode behaves exactly like the chain. Every call is recorded as
// a transaction in `world.txs`.

export const JOB_STORAGE = near("0.035");
export const AGENT_STORAGE = near("0.02");
const MIN_AMOUNT = near("0.1");
const SHARE_UNIT = MILLI;
const MAX_CREW = 5;
const FUNDER_STORAGE = near("0.0025");
/** A delivery never checked, or a dispute never settled, splits 50/50 after this. */
export const STALE_AFTER_MS = 7 * 24 * 3_600_000;
/** Anyone may retire an agent that has done nothing for this long. */
export const AGENT_IDLE_RETIRE_MS = 30 * 24 * 3_600_000;

export const ROLES = {
  reviewer: "reviewer.guild.testnet",
  runner: "runner.guild.testnet",
  council: "council.guild.testnet",
};

export class LedgerError extends Error {}
function must(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new LedgerError(msg);
}

/** The contract's Verdict shape (no notes, no UI fields). */
export function chainVerdict(v: Verdict) {
  return {
    approved: v.approved,
    checks: v.checks.slice(0, 8).map((c) => ({ name: c.name.slice(0, 40), passed: c.passed })),
    summary: v.summary.slice(0, 400),
    receipt: v.receipt.slice(0, 128),
  };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function txHash(): string {
  let s = "";
  for (let i = 0; i < 44; i++) s += B58[Math.floor(Math.random() * B58.length)];
  return s;
}

/**
 * Record a transaction, with the exact arguments the real contract method
 * takes, so the demo log shows what would be sent on-chain.
 */
export function record(w: World, signer: string, method: string, summary: string, call?: ChainArgs): Tx {
  const tx: Tx = { hash: txHash(), at: Date.now(), signer, method, summary };
  if (call) tx.args = call.args;
  w.txs.unshift(tx);
  w.txs.length = Math.min(w.txs.length, 400);
  return tx;
}

function balance(w: World, who: string): bigint {
  return BigInt(w.balances[who] ?? "0");
}
function pay(w: World, from: string, amount: bigint) {
  must(balance(w, from) >= amount, "Not enough NEAR in your wallet");
  w.balances[from] = (balance(w, from) - amount).toString();
}
/** Send NEAR from the contract to an account. */
function send(w: World, to: string, amount: bigint) {
  if (amount <= 0n) return;
  w.balances[to] = (balance(w, to) + amount).toString();
}

function job(w: World, id: number): Job {
  const j = w.jobs[id];
  must(j, "Unknown job");
  return j;
}
function agent(w: World, id: string): Agent {
  const a = w.agents[id];
  must(a, "Unknown agent");
  return a;
}

// ----- Jobs -----------------------------------------------------------------

export function postJob(
  w: World,
  poster: string,
  input: { title: string; brief: string; deadline_ms: number; deposit: bigint },
): Job {
  const title = input.title.trim();
  const brief = input.brief.trim();
  must(title.length > 0 && title.length <= 120, "Title must be 1 to 120 characters");
  must(brief.length > 0 && brief.length <= 2000, "Brief must be 1 to 2000 characters");
  must(input.deadline_ms > Date.now(), "Deadline must be in the future");
  must(input.deposit >= JOB_STORAGE + MIN_AMOUNT, "Budget must be at least 0.1 NEAR");
  pay(w, poster, input.deposit);
  const id = w.next_job_id++;
  const j: Job = {
    id,
    poster,
    title,
    brief,
    budget: (input.deposit - JOB_STORAGE).toString(),
    status: "InReview",
    created_at_ms: Date.now(),
    deadline_ms: input.deadline_ms,
    review: null,
    crew: [],
    result_hash: null,
    result_check: null,
    release_at_ms: null,
    delivered_at_ms: null,
    disputed_at_ms: null,
    phase: "reviewing",
    bids: [],
    steps: [],
    result: null,
    payouts: [],
    attempts: 0,
  };
  w.jobs[id] = j;
  record(w, poster, "post_job", `Posted "${title}" and locked the budget`, {
    args: { title, brief, deadline_ns: String(BigInt(input.deadline_ms) * 1_000_000n) },
    deposit: j.budget,
    kind: "job",
    localJob: id,
  });
  return j;
}

export function finishJobReview(w: World, id: number, verdict: Verdict | null) {
  const j = job(w, id);
  if (j.status !== "InReview") return;
  j.review = verdict;
  j.status = verdict === null ? "ReviewTimedOut" : verdict.approved ? "Open" : "Rejected";
  record(w, ROLES.reviewer, "submit_review", verdict?.approved ? `Approved job #${id}` : `Turned down job #${id}`,
    verdict ? { args: { subject: { Job: id }, verdict: chainVerdict(verdict) } } : undefined);
  if (j.status !== "Open") send(w, j.poster, BigInt(j.budget));
}

export function cancelJob(w: World, id: number, caller: string) {
  const j = job(w, id);
  must(caller === j.poster, "Only the poster can cancel");
  must(j.status === "Open", "Only open jobs can be cancelled");
  j.status = "Refunded";
  send(w, j.poster, BigInt(j.budget));
  record(w, caller, "cancel_job", `Cancelled job #${id}, budget returned`, { args: { job_id: id } });
}

export function expireJob(w: World, id: number, caller: string) {
  const j = job(w, id);
  must(j.status === "Open" || j.status === "Working", "Job is not open or in progress");
  must(Date.now() >= j.deadline_ms, "Deadline has not passed");
  j.status = "Refunded";
  for (const c of j.crew) {
    const a = w.agents[c.agent];
    if (a) a.busy_jobs = Math.max(0, a.busy_jobs - 1);
  }
  send(w, j.poster, BigInt(j.budget));
  record(w, caller, "expire_job", `Job #${id} ran out of time, budget returned`, { args: { job_id: id } });
}

export function assignCrew(w: World, id: number, crew: [string, number][]) {
  must(crew.length > 0 && crew.length <= MAX_CREW, "Crew must be 1 to 5 agents");
  must(crew.reduce((s, [, b]) => s + b, 0) === 10_000, "Crew shares must add up to 10000");
  crew.forEach(([a, share], i) => {
    must(share > 0, "Every crew member needs a share");
    must(!crew.slice(0, i).some(([b]) => b === a), "An agent can only appear once in a crew");
    must(agent(w, a).status === "Active", "Every crew agent must be active");
  });
  const j = job(w, id);
  must(j.status === "Open", "Job is not open");
  must(Date.now() < j.deadline_ms, "Job deadline has passed");
  j.crew = crew.map(([a, share_bps]) => ({ agent: a, share_bps, fuel_used: "0" }));
  j.status = "Working";
  for (const [a] of crew) {
    agent(w, a).busy_jobs += 1;
    agent(w, a).last_active_ms = Date.now();
  }
  record(w, ROLES.runner, "assign_crew", `Picked ${crew.length} agents for job #${id}`, { args: { job_id: id, crew } });
}

export function chargeFuel(w: World, id: number, agentId: string, amount: bigint, receipt: string) {
  must(amount > 0n, "Amount must be positive");
  must(receipt.length > 0 && receipt.length <= 128, "Receipt must be 1 to 128 characters");
  const j = job(w, id);
  must(j.status === "Working", "Job is not in progress");
  const m = j.crew.find((c) => c.agent === agentId);
  must(m, "Agent is not in this job's crew");
  const a = agent(w, agentId);
  const jobUsed = j.crew.reduce((s, c) => s + BigInt(c.fuel_used), 0n);
  must(jobUsed + amount <= BigInt(j.budget), "Fuel for one job cannot exceed its budget");
  const used = BigInt(m.fuel_used) + amount;
  must(used <= BigInt(a.max_fuel_per_job), "Over this agent's fuel limit for one job");
  must(amount <= BigInt(a.fuel), "Not enough fuel");
  a.fuel = sub(a.fuel, amount);
  m.fuel_used = used.toString();
  w.runner_fuel_earned = add(w.runner_fuel_earned, amount);
  record(w, ROLES.runner, "charge_fuel", `${a.name} paid fuel for AI work on job #${id}`, {
    args: { job_id: id, agent_id: agentId, amount: amount.toString(), receipt },
  });
}

export function deliver(w: World, id: number, resultHash: string) {
  must(/^[0-9a-f]{64}$/i.test(resultHash), "Result hash must be 64 hex characters");
  const j = job(w, id);
  must(j.status === "Working", "Job is not in progress");
  must(Date.now() < j.deadline_ms, "Job deadline has passed");
  j.result_hash = resultHash;
  j.delivered_at_ms = Date.now();
  j.result_check = null;
  j.release_at_ms = null;
  j.status = "Delivered";
  record(w, ROLES.runner, "deliver", `Handed in the work for job #${id}`, { args: { job_id: id, result_hash: resultHash } });
}

export function checkDelivery(w: World, id: number, verdict: Verdict, releaseAfterMs: number) {
  const j = job(w, id);
  must(j.status === "Delivered", "No delivery to check");
  must(j.result_check === null, "Delivery already checked");
  j.result_check = verdict;
  if (verdict.approved) j.release_at_ms = Date.now() + releaseAfterMs;
  else j.status = "Working";
  record(w, ROLES.reviewer, "check_delivery", verdict.approved ? `Work on job #${id} passed` : `Work on job #${id} sent back`, {
    args: { job_id: id, verdict: chainVerdict(verdict) },
  });
}

export function approve(w: World, id: number, caller: string) {
  const j = job(w, id);
  must(caller === j.poster, "Only the poster can approve");
  must(j.status === "Delivered", "Nothing delivered yet");
  payCrew(w, id, 10_000);
  record(w, caller, "approve", `Approved job #${id} and paid the crew`, { args: { job_id: id } });
}

export function release(w: World, id: number, caller: string) {
  const j = job(w, id);
  const now = Date.now();
  if (j.status === "Delivered" && j.release_at_ms !== null) {
    must(now >= j.release_at_ms, "Release time has not come yet");
    payCrew(w, id, 10_000);
  } else if (j.status === "Delivered") {
    must(now >= (j.delivered_at_ms ?? j.created_at_ms) + STALE_AFTER_MS, "Work has not passed its check");
    payCrew(w, id, 5_000);
  } else if (j.status === "Disputed") {
    must(now >= (j.disputed_at_ms ?? j.created_at_ms) + STALE_AFTER_MS, "The council still has time to decide");
    payCrew(w, id, 5_000);
  } else {
    must(false, "Nothing delivered yet");
  }
  record(w, caller, "release", `Released payment for job #${id}`, { args: { job_id: id } });
}

export function dispute(w: World, id: number, caller: string) {
  const j = job(w, id);
  must(caller === j.poster, "Only the poster can dispute");
  must(j.status === "Delivered", "Nothing delivered to dispute");
  if (j.release_at_ms !== null) must(Date.now() < j.release_at_ms, "Too late: payment already releasable");
  j.status = "Disputed";
  j.disputed_at_ms = Date.now();
  record(w, caller, "dispute", `Disputed job #${id}`, { args: { job_id: id } });
}

export function resolve(w: World, id: number, crewBps: number) {
  must(crewBps >= 0 && crewBps <= 10_000, "crew_bps must be 0 to 10000");
  must(job(w, id).status === "Disputed", "Job is not disputed");
  payCrew(w, id, crewBps);
  record(w, ROLES.council, "resolve", `Council settled job #${id}`, { args: { job_id: id, crew_bps: crewBps } });
}

function payCrew(w: World, id: number, crewBps: number) {
  const j = job(w, id);
  const budget = BigInt(j.budget);
  const crewTotal = (budget * BigInt(crewBps)) / BPS;
  let paid = 0n;
  const payouts: Payout[] = [];
  j.crew.forEach((m, i) => {
    const payAmt = i + 1 === j.crew.length ? crewTotal - paid : (crewTotal * BigInt(m.share_bps)) / BPS;
    paid += payAmt;
    const a = agent(w, m.agent);
    const refuel = (payAmt * BigInt(a.refuel_bps)) / BPS;
    const creator = ((payAmt - refuel) * BigInt(a.creator_bps)) / BPS;
    const toFunders = payAmt - refuel - creator;
    a.fuel = add(a.fuel, refuel);
    a.earned = add(a.earned, payAmt);
    // A full refund by the council does not count as a job done.
    if (crewBps > 0) a.jobs_done += 1;
    a.busy_jobs = Math.max(0, a.busy_jobs - 1);
    a.last_active_ms = Date.now();
    const leftover = shareOut(a, toFunders);
    send(w, a.owner, creator + leftover);
    payouts.push({
      agent: a.id,
      pay: payAmt.toString(),
      refuel: refuel.toString(),
      creator: (creator + leftover).toString(),
      funders: (toFunders - leftover).toString(),
    });
  });
  j.payouts = payouts;
  j.status = crewBps === 10_000 ? "Paid" : crewBps === 0 ? "Refunded" : "Split";
  send(w, j.poster, budget - crewTotal);
}

// ----- Agents ---------------------------------------------------------------

export function registerAgent(
  w: World,
  owner: string,
  input: {
    id: string;
    name: string;
    spec_hash: string;
    tools: string[];
    max_fuel_per_job: bigint;
    refuel_bps: number;
    creator_bps: number;
    deposit: bigint;
    tagline: string;
    skill: Agent["skill"];
    hue: number;
    glyph: Glyph;
    spec: Agent["spec"];
  },
): Agent {
  must(input.id.length >= 3 && input.id.length <= 32, "Handle must be 3 to 32 characters");
  must(/^[a-z0-9-]+$/.test(input.id), "Handle may only contain lowercase letters, digits and '-'");
  must(!w.agents[input.id], "That handle is taken");
  const name = input.name.trim();
  must(name.length > 0 && name.length <= 40, "Name must be 1 to 40 characters");
  must(/^[0-9a-f]{64}$/.test(input.spec_hash), "spec_hash must be 64 hex characters");
  must(input.tools.length <= 8, "At most 8 tools");
  must(input.max_fuel_per_job > 0n, "max_fuel_per_job must be positive");
  must(input.refuel_bps >= 0 && input.refuel_bps <= 10_000, "refuel_bps must be 0 to 10000");
  must(input.creator_bps >= 0 && input.creator_bps <= 10_000, "creator_bps must be 0 to 10000");
  must(input.deposit >= AGENT_STORAGE + MIN_AMOUNT, "Fuel must be at least 0.1 NEAR");
  pay(w, owner, input.deposit);
  const fuel = input.deposit - AGENT_STORAGE;
  const a: Agent = {
    id: input.id,
    owner,
    name,
    spec_hash: input.spec_hash,
    tools: input.tools,
    fuel: fuel.toString(),
    max_fuel_per_job: input.max_fuel_per_job.toString(),
    refuel_bps: input.refuel_bps,
    creator_bps: input.creator_bps,
    status: "InReview",
    review: null,
    jobs_done: 0,
    earned: "0",
    funded: fuel.toString(),
    busy_jobs: 0,
    last_active_ms: Date.now(),
    total_shares: "0",
    funders: 0,
    earned_per_share: "0",
    tagline: input.tagline,
    skill: input.skill,
    hue: input.hue,
    glyph: input.glyph,
    spec: input.spec,
    created_at_ms: Date.now(),
  };
  w.agents[a.id] = a;
  addFunding(w, a.id, owner, fuel);
  record(w, owner, "register_agent", `Added ${name} with ${toShort(fuel)} NEAR of fuel`, {
    args: {
      id: input.id,
      name,
      spec_hash: input.spec_hash,
      tools: input.tools,
      max_fuel_per_job: input.max_fuel_per_job.toString(),
      refuel_bps: input.refuel_bps,
      creator_bps: input.creator_bps,
    },
    deposit: fuel.toString(),
    kind: "agent",
  });
  return a;
}

export function finishAgentReview(w: World, id: string, verdict: Verdict | null) {
  const a = agent(w, id);
  if (a.status !== "InReview") return;
  a.review = verdict;
  a.status = verdict === null ? "ReviewTimedOut" : verdict.approved ? "Active" : "Rejected";
  record(w, ROLES.reviewer, "submit_review", verdict?.approved ? `Approved ${a.name}` : `Turned down ${a.name}`,
    verdict ? { args: { subject: { Agent: id }, verdict: chainVerdict(verdict) } } : undefined);
  if (a.status !== "Active") {
    const fuel = BigInt(a.fuel);
    a.fuel = "0";
    a.total_shares = "0";
    a.funders = 0;
    delete w.funders[`${id}:${a.owner}`];
    send(w, a.owner, fuel);
  }
}

export function fundAgent(w: World, id: string, who: string, attached: bigint) {
  const a = agent(w, id);
  must(a.status === "Active", "Agent is not accepting funding");
  must(a.busy_jobs === 0, "Agent is on a job. Fund it when the job ends");
  // A first-time funder pays for storing their record.
  const storage = w.funders[`${id}:${who}`] ? 0n : FUNDER_STORAGE;
  must(attached >= SHARE_UNIT + storage, "Attach at least 0.001 NEAR");
  pay(w, who, attached);
  const amount = attached - storage;
  a.fuel = add(a.fuel, amount);
  a.funded = add(a.funded, amount);
  addFunding(w, id, who, amount);
  record(w, who, "fund_agent", `Added ${toShort(amount)} NEAR of fuel to ${a.name}`, { args: { agent_id: id }, deposit: amount.toString(), kind: "fund" });
}

export function retireAgent(w: World, id: string, caller: string) {
  const a = agent(w, id);
  must(a.busy_jobs === 0, "Agent is still on a job");
  must(caller === a.owner || Date.now() >= a.last_active_ms + AGENT_IDLE_RETIRE_MS, "Only the owner (or anyone after 30 idle days)");
  must(a.status === "Active", "Only active agents can retire");
  a.status = "Retired";
  const fuel = BigInt(a.fuel);
  a.fuel = "0";
  send(w, a.owner, shareOut(a, fuel));
  record(w, caller, "retire_agent", `Retired ${a.name}; leftover fuel shared with its funders`, { args: { agent_id: id } });
}

export function claimEarnings(w: World, id: string, who: string): bigint {
  const key = `${id}:${who}`;
  const f = w.funders[key];
  must(f, "Not a funder");
  settle(f, BigInt(w.agents[id]?.earned_per_share ?? "0"));
  const amount = BigInt(f.unclaimed);
  must(amount > 0n, "Nothing to claim");
  f.unclaimed = "0";
  send(w, who, amount);
  record(w, who, "claim_earnings", `Claimed ${toShort(amount)} NEAR earned by ${w.agents[id]?.name ?? id}`, { args: { agent_id: id } });
  return amount;
}

export function getFunder(w: World, id: string, who: string): { shares: string; claimable: string } {
  const f: Funder = { ...(w.funders[`${id}:${who}`] ?? { shares: "0", settled_at: "0", unclaimed: "0" }) };
  settle(f, BigInt(w.agents[id]?.earned_per_share ?? "0"));
  return { shares: f.shares, claimable: f.unclaimed };
}

function addFunding(w: World, id: string, who: string, amount: bigint) {
  const a = agent(w, id);
  const key = `${id}:${who}`;
  let f = w.funders[key];
  if (!f) {
    f = { shares: "0", settled_at: "0", unclaimed: "0" };
    w.funders[key] = f;
    a.funders += 1;
  }
  const perShare = BigInt(a.earned_per_share);
  settle(f, perShare);
  const newShares = amount / SHARE_UNIT;
  f.shares = add(f.shares, newShares);
  f.settled_at = (BigInt(f.shares) * perShare).toString();
  a.total_shares = add(a.total_shares, newShares);
}

function shareOut(a: Agent, amount: bigint): bigint {
  const shares = BigInt(a.total_shares);
  if (shares === 0n || amount === 0n) return amount;
  const per = amount / shares;
  a.earned_per_share = add(a.earned_per_share, per);
  return amount - per * shares;
}

function settle(f: Funder, perShare: bigint) {
  const total = BigInt(f.shares) * perShare;
  f.unclaimed = add(f.unclaimed, total - BigInt(f.settled_at));
  f.settled_at = total.toString();
}

function toShort(y: bigint): string {
  return (Number(y / 10n ** 18n) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

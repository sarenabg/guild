import "server-only";
import crypto from "node:crypto";
import type { Agent, Verdict, WorkStep } from "../types";
import { config, liveAi, liveProblem } from "../config";
import { reviewAgent, reviewDelivery, reviewJob } from "../review";
import { fit, pickCrew, specHash } from "../runtime";
import { gatherTools, stepAttempt, think, type Previous } from "../work";
import { chainVerdict } from "../ledger";
import { fmtNear } from "../money";
import { call, view } from "./near";
import { changeLive, jobExtra, live, liveLog, type LiveSpec } from "./state";

// The live runner. It watches the Guild contract and does the runner's and
// the reviewer's part for real: answers reviews (which resumes the paused
// contract call), picks crews, runs agents on NEAR AI, charges each agent's
// fuel with the NEAR AI receipt, hands in the work and checks it, and
// releases payment when the wait is over. Posters approve from their wallet.

export type ChainVerdict = { approved: boolean; checks: { name: string; passed: boolean }[]; summary: string; receipt: string; verified_signer?: string | null };
export type ChainJob = {
  id: number;
  poster: string;
  title: string;
  brief: string;
  budget: string;
  status: string;
  created_at_ns: number;
  deadline_ns: number;
  review: ChainVerdict | null;
  crew: { agent: string; share_bps: number; fuel_used: string }[];
  result_hash: string | null;
  result_check: ChainVerdict | null;
  release_at_ns: number | null;
  delivered_at_ns: number | null;
  disputed_at_ns: number | null;
};
export type ChainAgent = {
  id: string;
  owner: string;
  name: string;
  spec_hash: string;
  tools: string[];
  fuel: string;
  max_fuel_per_job: string;
  refuel_bps: number;
  creator_bps: number;
  status: string;
  review: ChainVerdict | null;
  jobs_done: number;
  earned: string;
  funded: string;
  busy_jobs: number;
  total_shares: string;
  funders: number;
  earned_per_share: string;
  last_active_ns: number;
};
export type ChainConfig = { reviewer: string; runner: string; council: string; release_after_ns: number; job_count: number; agent_count: number };

export type Snapshot = { config: ChainConfig | null; jobs: ChainJob[]; agents: ChainAgent[]; teeSigners: string[]; at: number; error?: string };

type G = { snap: Snapshot; timer?: NodeJS.Timeout; busy: boolean; inflight: Set<string>; lastRefresh: number };
const g = globalThis as unknown as { __guildLiveRun?: G };
const run: G = (g.__guildLiveRun ??= { snap: { config: null, jobs: [], agents: [], teeSigners: [], at: 0 }, busy: false, inflight: new Set(), lastRefresh: 0 });

export const snapshot = () => run.snap;

/** Real NEAR AI whenever a key is set; the practice chain without a key uses the demo AI. */
const realAi = () => liveAi() || !config.liveMock;
/** Which reviewer produced the on-chain verdicts, for the badge on screen. */
export const aiLabel = (): "ai" | "demo-ai" => (realAi() ? "ai" : "demo-ai");

/** Read everything the screens need from the contract (cheap view calls). */
export async function refresh(force = false): Promise<Snapshot> {
  if (!config.liveContract) return run.snap;
  if (!force && Date.now() - run.lastRefresh < Math.min(2500, config.liveTickMs)) return run.snap;
  run.lastRefresh = Date.now();
  try {
    const [cfg, jobs, agents, teeSigners] = await Promise.all([
      view<ChainConfig>("get_config"),
      view<ChainJob[]>("list_jobs", { limit: 100 }),
      listAllAgents(),
      view<string[]>("tee_signers").catch(() => [] as string[]),
    ]);
    run.snap = { config: cfg, jobs, agents, teeSigners: teeSigners.map((s) => s.toLowerCase()), at: Date.now() };
  } catch (e) {
    run.snap = { ...run.snap, error: (e as Error).message.slice(0, 200) };
  }
  return run.snap;
}

async function listAllAgents(): Promise<ChainAgent[]> {
  const out: ChainAgent[] = [];
  for (let from = 0; from < 2000; from += 100) {
    const page = await view<ChainAgent[]>("list_agents", { from_index: from, limit: 100 });
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

/** Start the background loop (once per server). */
export function startLive() {
  if (!config.liveContract || run.timer) return;
  const tick = async () => {
    if (run.busy) return;
    run.busy = true;
    try {
      const snap = await refresh(true);
      if (!liveProblem() && snap.config) await act(snap);
    } catch (e) {
      console.error("[guild live]", e);
    } finally {
      run.busy = false;
    }
  };
  run.timer = setInterval(tick, config.liveTickMs);
  void tick();
}

/** Work on `key` in the background unless it is already being worked on. */
function once(key: string, fn: () => Promise<void>) {
  if (run.inflight.has(key)) return;
  run.inflight.add(key);
  fn()
    .catch((e) => console.error(`[guild live] ${key}:`, e))
    .finally(() => run.inflight.delete(key));
}

async function act(snap: Snapshot) {
  const ops = snap.config!;
  const iAmReviewer = ops.reviewer === config.operatorId;
  const iAmRunner = ops.runner === config.operatorId;
  for (const a of snap.agents) {
    if (a.status === "InReview" && iAmReviewer) once(`agent-review:${a.id}`, () => answerAgentReview(a, snap));
  }
  for (const j of snap.jobs) {
    if (j.status === "InReview" && iAmReviewer) once(`job-review:${j.id}`, () => answerJobReview(j, snap));
    else if (j.status === "Open" && iAmRunner) once(`job-crew:${j.id}`, () => formCrew(j, snap));
    else if (j.status === "Working" && iAmRunner) once(`job-work:${j.id}`, () => doWork(j, snap));
    else if (j.status === "Delivered") {
      const ex = live().jobs[j.id];
      if (!j.result_check && iAmReviewer && ex?.result && (ex.checkedDelivery ?? 0) !== j.delivered_at_ns) {
        once(`job-check:${j.id}`, () => checkWork(j, snap));
      } else if (j.result_check?.approved && j.release_at_ns && Date.now() * 1e6 >= j.release_at_ns) {
        once(`job-release:${j.id}`, () => releaseJob(j));
      }
    }
  }
}

function proofFor(v: Verdict, snap: Snapshot) {
  const p = v.proof;
  if (!p || !snap.teeSigners.includes(p.signing_address.toLowerCase())) return null;
  return p;
}

async function record(method: string, summary: string, sent: { hash: string; url: string; ok: boolean; error?: string }, ref: { job?: number; agent?: string }) {
  await changeLive((s) => {
    s.txs.unshift({ hash: sent.hash || `failed-${crypto.randomBytes(6).toString("hex")}`, at: Date.now(), signer: config.operatorId, method, summary: sent.ok ? summary : `${summary} (failed: ${sent.error})`, url: sent.url || undefined });
    s.txs.length = Math.min(s.txs.length, 500);
    if (!sent.ok) liveLog(s, { kind: "warn", text: `${method} failed: ${sent.error}`, ...ref });
  });
}

// ----- Reviews --------------------------------------------------------------

async function answerAgentReview(a: ChainAgent, snap: Snapshot) {
  const spec = live().specs[a.spec_hash];
  let verdict: Verdict;
  if (!spec) {
    // The owner never shared the instructions behind this fingerprint.
    await sleep(45_000);
    if (live().specs[a.spec_hash]) return; // arrived meanwhile; the next tick reviews it
    verdict = { approved: false, checks: [{ name: "Instructions shared", passed: false }], summary: "Its instructions were never shared with the reviewer, so they can't be checked.", receipt: `rules-${crypto.randomBytes(6).toString("hex")}`, by: "rules" };
  } else if (specHash(spec) !== a.spec_hash) {
    verdict = { approved: false, checks: [{ name: "Matches its fingerprint", passed: false }], summary: "The instructions shared don't match the agent's on-chain fingerprint.", receipt: `rules-${crypto.randomBytes(6).toString("hex")}`, by: "rules" };
  } else {
    verdict = await reviewAgent({ name: a.name, tagline: spec.tagline, spec }, realAi());
  }
  const sent = await call("submit_review", { subject: { Agent: a.id }, verdict: chainVerdict(verdict), proof: proofFor(verdict, snap) }, 60);
  await record("submit_review", `${verdict.approved ? "Approved" : "Turned away"} agent ${a.name}`, sent, { agent: a.id });
  await changeLive((s) => liveLog(s, { kind: verdict.approved ? "review" : "warn", text: verdict.approved ? `${a.name} passed the safety check and joined` : `${a.name} was turned away: ${verdict.summary}`, agent: a.id }));
}

async function answerJobReview(j: ChainJob, snap: Snapshot) {
  const verdict = await reviewJob({ title: j.title, brief: j.brief, budget: j.budget }, realAi());
  const sent = await call("submit_review", { subject: { Job: j.id }, verdict: chainVerdict(verdict), proof: proofFor(verdict, snap) }, 60);
  await record("submit_review", `${verdict.approved ? "Approved" : "Turned down"} job #${j.id}`, sent, { job: j.id });
  await changeLive((s) => {
    jobExtra(s, j.id);
    liveLog(s, { kind: verdict.approved ? "review" : "warn", text: verdict.approved ? `"${j.title}" passed the safety check` : `"${j.title}" was turned down and refunded`, job: j.id });
  });
}

// ----- Crew and work --------------------------------------------------------

/** An on-chain agent with its shared instructions, in the shape the matching code uses. */
export function withSpec(a: ChainAgent, spec: LiveSpec | undefined): Agent | null {
  if (!spec) return null;
  return {
    ...(a as unknown as Agent),
    review: a.review ? { ...a.review, by: aiLabel(), verified: a.review.verified_signer ? { signer: a.review.verified_signer, kind: "provider_tee" } : null } : null,
    tagline: spec.tagline,
    skill: spec.skill,
    hue: spec.hue,
    glyph: spec.glyph,
    spec: { instructions: spec.instructions, knowledge: spec.knowledge, tools: spec.tools },
    created_at_ms: spec.at,
    last_active_ms: Math.round(a.last_active_ns / 1e6),
  };
}

async function formCrew(j: ChainJob, snap: Snapshot) {
  const specs = live().specs;
  const pool = snap.agents
    .filter((a) => a.status === "Active" && BigInt(a.fuel) > 10n ** 20n)
    .map((a) => withSpec(a, specs[a.spec_hash]))
    .filter((a): a is Agent => a !== null);
  const job = { title: j.title, brief: j.brief };
  const bids = pool
    .map((a) => ({ agent: a.id, role: a.skill, fit: fit(a, job), pitch: a.tagline, at: Date.now() }))
    .filter((b) => b.fit >= 30)
    .sort((x, y) => y.fit - x.fit)
    .slice(0, 6);
  if (bids.length === 0) return; // nobody fits yet; try again on the next tick
  await changeLive((s) => {
    jobExtra(s, j.id).bids = bids;
  });
  const agents = Object.fromEntries(pool.map((a) => [a.id, a]));
  const crew = pickCrew(bids, agents);
  const sent = await call("assign_crew", { job_id: j.id, crew }, 50);
  await record("assign_crew", `Picked ${crew.length} agents for job #${j.id}`, sent, { job: j.id });
  if (sent.ok) await changeLive((s) => liveLog(s, { kind: "job", text: `Crew picked for "${j.title}": ${crew.map(([a]) => agents[a].name).join(", ")}`, job: j.id }));
}

async function doWork(j: ChainJob, snap: Snapshot) {
  const specs = live().specs;
  const byId = Object.fromEntries(snap.agents.map((a) => [a.id, a]));
  let ex = jobExtra(live(), j.id);
  // If the reviewer sent the work back, this is a new attempt.
  const attempt = j.result_check && !j.result_check.approved ? Math.max(ex.attempts, 1) : ex.attempts;
  if (attempt !== ex.attempts) await changeLive((s) => (jobExtra(s, j.id).attempts = attempt));
  const feedback = j.result_check && !j.result_check.approved ? j.result_check.checks.filter((c) => !c.passed).map((c) => c.name) : [];

  for (const member of j.crew) {
    ex = jobExtra(live(), j.id);
    if (ex.steps.some((s) => s.agent === member.agent && s.ended_at && stepAttempt(s) === attempt)) continue;
    const agent = withSpec(byId[member.agent], specs[byId[member.agent]?.spec_hash]);
    if (!agent) continue;
    const previous: Previous[] = ex.steps
      .filter((s) => s.ended_at && s.text && stepAttempt(s) === attempt)
      .map((s) => ({ agent: byId[s.agent]?.name ?? s.agent, skill: withSpec(byId[s.agent], specs[byId[s.agent]?.spec_hash])?.skill ?? "write", text: s.text }));
    const index = await changeLive((s) => {
      const e = jobExtra(s, j.id);
      e.steps.push({ agent: agent.id, role: `${agent.skill}#${attempt}`, started_at: Date.now(), ended_at: null, text: "", tools: [], tokens: 0, cost: "0", receipt: "", verified: null });
      return e.steps.length - 1;
    });
    let step: Partial<WorkStep>;
    try {
      const tools = await gatherTools(j, agent, previous);
      const t = await think(j, agent, previous, tools, feedback, realAi());
      const sent = await call("charge_fuel", { job_id: j.id, agent_id: agent.id, amount: t.cost.toString(), receipt: t.receipt.slice(0, 128) }, 30);
      await record("charge_fuel", `${agent.name} paid ${fmtNear(t.cost)} NEAR for AI on job #${j.id}`, sent, { job: j.id, agent: agent.id });
      step = { text: t.text, tools: t.tools, tokens: t.tokens, cost: sent.ok ? t.cost.toString() : "0", receipt: t.receipt, verified: t.verified };
    } catch (e) {
      step = { text: "", receipt: "failed" };
      await changeLive((s) => liveLog(s, { kind: "warn", text: `${agent.name} couldn't finish: ${(e as Error).message.slice(0, 100)}`, job: j.id, agent: agent.id }));
    }
    await changeLive((s) => {
      Object.assign(jobExtra(s, j.id).steps[index], step, { ended_at: Date.now() });
      if (step.text) liveLog(s, { kind: "work", text: `${agent.name} finished its part`, job: j.id, agent: agent.id });
    });
  }

  ex = jobExtra(live(), j.id);
  const last = [...ex.steps].reverse().find((s) => s.ended_at && s.text && stepAttempt(s) === attempt);
  if (!last) return;
  const result = last.text;
  const hash = crypto.createHash("sha256").update(result).digest("hex");
  await changeLive((s) => (jobExtra(s, j.id).result = result));
  const sent = await call("deliver", { job_id: j.id, result_hash: hash }, 30);
  await record("deliver", `Handed in the work for job #${j.id}`, sent, { job: j.id });
}

async function checkWork(j: ChainJob, snap: Snapshot) {
  const ex = jobExtra(live(), j.id);
  if (ex.attempts >= 2) return; // second miss already: the poster decides
  const verdict = await reviewDelivery(j, ex.result ?? "", realAi());
  const sent = await call("check_delivery", { job_id: j.id, verdict: chainVerdict(verdict), proof: proofFor(verdict, snap) }, 60);
  await record("check_delivery", verdict.approved ? `Work on job #${j.id} passed` : `Work on job #${j.id} sent back`, sent, { job: j.id });
  await changeLive((s) => {
    const e = jobExtra(s, j.id);
    e.checkedDelivery = j.delivered_at_ns ?? 0;
    if (!verdict.approved) e.attempts += 1;
    liveLog(s, { kind: verdict.approved ? "review" : "warn", text: verdict.approved ? `The work on "${j.title}" passed the final check` : `The final check sent "${j.title}" back to the crew`, job: j.id });
  });
}

async function releaseJob(j: ChainJob) {
  const sent = await call("release", { job_id: j.id }, 150);
  await record("release", `Released payment for job #${j.id}`, sent, { job: j.id });
  if (sent.ok) await changeLive((s) => liveLog(s, { kind: "pay", text: `Payment for "${j.title}" released to the crew`, job: j.id }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

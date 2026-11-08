import "server-only";
import crypto from "node:crypto";
import type { Agent, Bid, Job, Skill, World } from "./types";
import * as L from "./ledger";
import { getWorld, log, mutate } from "./store";
import { config, liveAi } from "./config";
import { reviewAgent, reviewDelivery, reviewJob } from "./review";
import { findSums } from "./tools";
import { gatherTools, stepAttempt, think, type Thought } from "./work";
import { keyTerms } from "./guardrails";
import { fmtNear } from "./money";

// The swarm runner. It takes each job from review to payment:
//   reviewing → bidding → crewing → working → checking → waiting → done
// Every money step goes through the ledger, which follows the contract's rules.

/** Demo visitors get the demo AI unless GUILD_DEMO_REAL_AI=1. */
const demoAi = () => config.demoRealAi && liveAi();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms * config.pace));

type G = { running: Set<string> };
const g = globalThis as unknown as { __guildRun?: G };
const run: G = (g.__guildRun ??= { running: new Set() });

const ACTIVE_PHASES = new Set(["reviewing", "bidding", "crewing", "working", "checking", "waiting"]);

/** Start (or resume) every job and agent review that isn't running. */
export function ensureRunning(wid: string) {
  const w = getWorld(wid);
  for (const j of Object.values(w.jobs)) {
    if (ACTIVE_PHASES.has(j.phase)) start(`${wid}:job:${j.id}`, () => runJob(wid, j.id));
  }
  for (const a of Object.values(w.agents)) {
    if (a.status === "InReview") start(`${wid}:agent:${a.id}`, () => runAgentReview(wid, a.id));
  }
}

function start(key: string, fn: () => Promise<void>) {
  if (run.running.has(key)) return;
  run.running.add(key);
  fn()
    .catch((e) => console.error(`[guild] ${key} stopped:`, e))
    .finally(() => run.running.delete(key));
}

// ----- Agent review ---------------------------------------------------------

async function runAgentReview(wid: string, id: string) {
  const started = Date.now();
  const agent = getWorld(wid).agents[id];
  const verdict = await reviewAgent(agent, demoAi());
  await sleep(Math.max(0, 2600 - (Date.now() - started)));
  await mutate(wid, (w) => {
    L.finishAgentReview(w, id, verdict);
    const a = w.agents[id];
    log(w, {
      kind: verdict.approved ? "review" : "warn",
      text: verdict.approved ? `${a.name} passed the safety check and joined the guild` : `${a.name} was turned away: ${verdict.summary}`,
      agent: id,
    });
  });
}

// ----- Jobs -----------------------------------------------------------------

async function runJob(wid: string, id: number) {
  for (let guard = 0; guard < 400; guard++) {
    const job = getWorld(wid).jobs[id];
    if (!job) return;
    switch (job.phase) {
      case "reviewing":
        await phaseReview(wid, id);
        break;
      case "bidding":
        await phaseBidding(wid, id);
        break;
      case "crewing":
        await phaseCrew(wid, id);
        break;
      case "working":
        await phaseWork(wid, id);
        break;
      case "checking":
        await phaseCheck(wid, id);
        break;
      case "waiting":
        if (!(await phaseWait(wid, id))) return;
        break;
      default:
        return;
    }
  }
}

async function phaseReview(wid: string, id: number) {
  const started = Date.now();
  const verdict = await reviewJob(getWorld(wid).jobs[id], demoAi());
  await sleep(Math.max(0, 2800 - (Date.now() - started)));
  await mutate(wid, (w) => {
    L.finishJobReview(w, id, verdict);
    const j = w.jobs[id];
    j.phase = j.status === "Open" ? "bidding" : "rejected";
    log(w, {
      kind: verdict.approved ? "review" : "warn",
      text: verdict.approved ? `"${j.title}" passed the safety check` : `"${j.title}" was turned down and refunded`,
      job: id,
    });
  });
}

/** How well an agent fits a job, 0 to 100. */
export function fit(agent: Agent, job: Pick<Job, "title" | "brief">): number {
  const terms = keyTerms(`${job.title} ${job.brief}`);
  const about = `${agent.tagline} ${agent.spec.instructions} ${agent.spec.knowledge}`.toLowerCase();
  const overlap = terms.filter((t) => about.includes(t)).length;
  const text = `${job.title} ${job.brief}`.toLowerCase();
  const wants: Record<Skill, boolean> = {
    research: /\b(compare|research|find|guide|which|best|facts?|sources?|news|market)\b/.test(text),
    analyze: /\b(cost|price|fees?|usd|numbers?|budget|how much|calculate|data|roughly|percent|stats?)\b/.test(text) || findSums(text).length > 0,
    write: /\b(write|guide|posts?|article|draft|copy|summary|summari[sz]e|explain|email|thread|blog|one-page)\b/.test(text),
    translate: /\b(translate|translation|spanish|french|german|japanese|chinese|language)\b/.test(text),
    code: /\b(code|script|function|bug|api|python|javascript|sql|regex)\b/.test(text),
    check: true,
  };
  const base = wants[agent.skill] ? 55 : 15;
  return Math.min(98, base + overlap * 6 + Math.min(agent.jobs_done, 5) * 2);
}

const PITCH: Record<Skill, string[]> = {
  research: ["I'll gather the facts first.", "I can find the sources.", "Research is my thing."],
  analyze: ["I'll run the numbers.", "I can work out the costs.", "Leave the maths to me."],
  write: ["I'll write it up clearly.", "I can draft this fast.", "Happy to write this."],
  translate: ["I can translate the result.", "I'll handle the languages."],
  code: ["I can write the code part.", "I'll script it."],
  check: ["I'll check every claim.", "I can review the final version.", "I'll make sure it's right."],
};

async function phaseBidding(wid: string, id: number) {
  const w = getWorld(wid);
  const job = w.jobs[id];
  const pool = Object.values(w.agents)
    .filter((a) => a.status === "Active" && BigInt(a.fuel) > 10n ** 21n)
    .map((a) => ({ a, f: fit(a, job) }))
    .filter((x) => x.f >= 30)
    .sort((x, y) => y.f - x.f)
    .slice(0, 6);
  for (const { a, f } of pool) {
    if (getWorld(wid).jobs[id].bids.some((b) => b.agent === a.id)) continue;
    await sleep(650);
    await mutate(wid, (w2) => {
      const lines = PITCH[a.skill];
      const bid: Bid = { agent: a.id, role: a.skill, fit: f, pitch: lines[(a.id.length + id) % lines.length], at: Date.now() };
      w2.jobs[id].bids.push(bid);
    });
  }
  await sleep(700);
  await mutate(wid, (w2) => {
    const j = w2.jobs[id];
    if (j.bids.length === 0) {
      // Nobody fits well: invite the best general agents anyway.
      Object.values(w2.agents)
        .filter((a) => a.status === "Active")
        .sort((x, y) => fit(y, j) - fit(x, j))
        .slice(0, 3)
        .forEach((a) => j.bids.push({ agent: a.id, role: a.skill, fit: fit(a, j), pitch: PITCH[a.skill][0], at: Date.now() }));
    }
    j.phase = "crewing";
  });
}

const ORDER: Record<Skill, number> = { research: 0, analyze: 0, write: 1, translate: 1, code: 1, check: 2 };
const WEIGHT = [3_000, 4_500, 2_500];

/** Pick up to one agent per stage: find out → make → check. */
export function pickCrew(bids: Bid[], agents: Record<string, Agent>): [string, number][] {
  const best = [0, 1, 2].map((stage) =>
    bids
      .filter((b) => agents[b.agent] && ORDER[agents[b.agent].skill] === stage)
      .sort((a, b) => b.fit - a.fit)[0],
  );
  const chosen = best.map((b, i) => (b ? { agent: b.agent, w: WEIGHT[i] } : null)).filter(Boolean) as { agent: string; w: number }[];
  if (chosen.length === 0 && bids.length) chosen.push({ agent: bids[0].agent, w: 10_000 });
  const total = chosen.reduce((s, c) => s + c.w, 0);
  const shares = chosen.map((c) => Math.floor((c.w * 10_000) / total));
  shares[shares.length - 1] += 10_000 - shares.reduce((s, x) => s + x, 0);
  return chosen.map((c, i) => [c.agent, shares[i]]);
}

async function phaseCrew(wid: string, id: number) {
  await sleep(900);
  await mutate(wid, (w) => {
    const j = w.jobs[id];
    const crew = pickCrew(j.bids, w.agents);
    try {
      L.assignCrew(w, id, crew);
      j.phase = "working";
      log(w, { kind: "job", text: `Crew picked for "${j.title}": ${crew.map(([a]) => w.agents[a].name).join(", ")}`, job: id });
    } catch (e) {
      j.phase = "bidding";
      j.bids = [];
      log(w, { kind: "warn", text: `Couldn't form a crew: ${(e as Error).message}`, job: id });
    }
  });
}

async function phaseWork(wid: string, id: number) {
  const job = getWorld(wid).jobs[id];
  const attempt = job.attempts;
  for (const member of job.crew) {
    const done = getWorld(wid).jobs[id].steps.some((s) => s.agent === member.agent && s.ended_at && stepAttempt(s) === attempt);
    if (done) continue;
    await runStep(wid, id, member.agent, attempt);
  }
  await mutate(wid, (w) => {
    const j = w.jobs[id];
    const last = [...j.steps].reverse().find((s) => s.ended_at && s.text);
    j.result = last?.text ?? "";
    const hash = crypto.createHash("sha256").update(j.result).digest("hex");
    L.deliver(w, id, hash);
    j.phase = "checking";
    log(w, { kind: "work", text: `The crew handed in "${j.title}"`, job: id });
  });
}


async function runStep(wid: string, id: number, agentId: string, attempt: number) {
  const w = getWorld(wid);
  const job = w.jobs[id];
  const agent = w.agents[agentId];
  const previous = job.steps
    .filter((s) => s.ended_at && s.text && stepAttempt(s) === attempt)
    .map((s) => ({ agent: w.agents[s.agent]?.name ?? s.agent, skill: w.agents[s.agent]?.skill ?? "write", text: s.text }));
  const feedback = attempt > 0 ? job.result_check?.checks.filter((c) => !c.passed).map((c) => c.note ?? c.name) ?? [] : [];

  const stepIndex = await mutate(wid, (w2) => {
    const j = w2.jobs[id];
    j.steps.push({
      agent: agentId,
      role: `${agent.skill}#${attempt}`,
      started_at: Date.now(),
      ended_at: null,
      text: "",
      tools: [],
      tokens: 0,
      cost: "0",
      receipt: "",
      verified: null,
    });
    return j.steps.length - 1;
  });

  const tools = await gatherTools(job, agent, previous);
  if (tools.length) await mutate(wid, (w2) => (w2.jobs[id].steps[stepIndex].tools = [...tools]));

  let thought: Thought;
  try {
    thought = await think(job, agent, previous, tools, feedback, demoAi());
    if (thought.receipt.startsWith("demo-")) {
      // Reveal the text in pieces so the screen shows the agent "typing".
      const text = thought.text;
      const parts = Math.min(10, Math.max(4, Math.round(text.length / 160)));
      for (let k = 1; k <= parts; k++) {
        await sleep(380);
        const upto = Math.round((text.length * k) / parts);
        await mutate(wid, (w2) => (w2.jobs[id].steps[stepIndex].text = text.slice(0, upto)));
      }
    }
  } catch (e) {
    await mutate(wid, (w2) => {
      const s = w2.jobs[id].steps[stepIndex];
      s.text = "";
      s.ended_at = Date.now();
      s.receipt = "failed";
      log(w2, { kind: "warn", text: `${agent.name} couldn't finish: ${(e as Error).message.slice(0, 100)}`, job: id, agent: agentId });
    });
    return;
  }
  const { text, receipt, tokens, cost, verified } = thought;

  await mutate(wid, (w2) => {
    const s = w2.jobs[id].steps[stepIndex];
    s.tools = thought.tools;
    s.text = text;
    s.tokens = tokens;
    s.receipt = receipt;
    s.verified = verified;
    try {
      L.chargeFuel(w2, id, agentId, cost, receipt);
      s.cost = cost.toString();
    } catch (e) {
      log(w2, { kind: "warn", text: `${agent.name}: ${(e as Error).message}`, job: id, agent: agentId });
    }
    s.ended_at = Date.now();
    log(w2, {
      kind: "work",
      text: `${agent.name} finished ${agent.skill === "check" ? "checking" : "its part"} (${fmtNear(s.cost)} NEAR of fuel)`,
      job: id,
      agent: agentId,
    });
  });
}

async function phaseCheck(wid: string, id: number) {
  const started = Date.now();
  const job = getWorld(wid).jobs[id];
  const verdict = await reviewDelivery(job, job.result ?? "", demoAi());
  await sleep(Math.max(0, 2400 - (Date.now() - started)));
  await mutate(wid, (w) => {
    const j = w.jobs[id];
    L.checkDelivery(w, id, verdict, config.releaseAfterMs);
    if (verdict.approved) {
      j.phase = "waiting";
      log(w, { kind: "review", text: `The work on "${j.title}" passed the final check`, job: id });
    } else if (j.attempts < 1) {
      j.attempts += 1;
      j.phase = "working";
      log(w, { kind: "warn", text: `The final check sent "${j.title}" back to the crew`, job: id });
    } else {
      // Second miss: hand it in anyway and let the poster decide.
      L.deliver(w, id, j.result_hash ?? crypto.createHash("sha256").update(j.result ?? "").digest("hex"));
      j.phase = "waiting";
      log(w, { kind: "warn", text: `"${j.title}" didn't pass the check twice; the poster decides`, job: id });
    }
  });
}

/** Wait for the poster, or release by itself when the time comes. Returns false when finished. */
async function phaseWait(wid: string, id: number): Promise<boolean> {
  const j = getWorld(wid).jobs[id];
  if (j.status !== "Delivered") {
    await mutate(wid, (w) => {
      const jj = w.jobs[id];
      if (jj.phase === "waiting") jj.phase = jj.status === "Disputed" ? "disputed" : "done";
    });
    return false;
  }
  if (j.release_at_ms && Date.now() >= j.release_at_ms) {
    await mutate(wid, (w) => {
      L.release(w, id, L.ROLES.runner);
      w.jobs[id].phase = "done";
      log(w, { kind: "pay", text: `Payment for "${w.jobs[id].title}" released to the crew`, job: id });
    });
    return false;
  }
  await new Promise((r) => setTimeout(r, 1000));
  return true;
}

// ----- Actions from the screens ---------------------------------------------

export function specHash(spec: Agent["spec"]): string {
  return crypto.createHash("sha256").update(JSON.stringify({ i: spec.instructions, k: spec.knowledge, t: [...spec.tools].sort() })).digest("hex");
}

export function payoutSummary(w: World, id: number): string {
  const j = w.jobs[id];
  return j.payouts.map((p) => `${w.agents[p.agent]?.name}: ${fmtNear(p.pay)}`).join(", ");
}

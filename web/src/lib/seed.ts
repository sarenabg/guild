import crypto from "node:crypto";
import type { Agent, Glyph, Skill, Verdict, World } from "./types";
import * as L from "./ledger";
import { near } from "./money";

// The demo world Guild starts with: eight agents made by different people,
// and a couple of finished jobs so earnings and history are visible.

const WORLD_VERSION = 4;

const demoVerdict = (checks: string[], summary: string): Verdict => ({
  approved: true,
  checks: checks.map((name) => ({ name, passed: true })),
  summary,
  receipt: `demo-${crypto.randomBytes(8).toString("hex")}`,
  by: "demo-ai",
});

type Seed = {
  id: string;
  name: string;
  owner: string;
  tagline: string;
  skill: Skill;
  glyph: Glyph;
  hue: number;
  tools: string[];
  fuel: number;
  instructions: string;
  knowledge: string;
};

const NEAR_NOTES = `NEAR accounts have readable names like alice.near. Testnet names end in .testnet.

A normal NEAR transfer costs a fraction of a cent. Fees are paid in NEAR.

Popular NEAR wallets: Meteor Wallet (extension and phone), HOT Wallet (inside Telegram), MyNearWallet (web).

Staking: you can lend NEAR to a validator and earn rewards, roughly 5 to 10 percent a year. Unstaking takes about 2 to 3 days.

NEAR Intents lets people swap and pay across many blockchains in one step.`;

const SEEDS: Seed[] = [
  {
    id: "scout",
    name: "Scout",
    owner: "maya.testnet",
    tagline: "Finds the facts fast",
    skill: "research",
    glyph: "eye",
    hue: 38,
    tools: ["web_search", "knowledge"],
    fuel: 6,
    instructions: "You are a quick, careful researcher. List the facts the job needs as short bullet points. Say where each comes from. Never invent numbers; say when something is an estimate.",
    knowledge: NEAR_NOTES,
  },
  {
    id: "quill",
    name: "Quill",
    owner: "jon.testnet",
    tagline: "Clear writing for beginners",
    skill: "write",
    glyph: "pen",
    hue: 265,
    tools: ["knowledge"],
    fuel: 5,
    instructions: "You write for complete beginners: short sentences, friendly tone, headings, and a clear recommendation at the end. Explain any term you have to use.",
    knowledge: "House style: headings in sentence case. Use tables for comparisons. End with a one-line recommendation in bold. Avoid hype words like revolutionary or moon.",
  },
  {
    id: "lens",
    name: "Lens",
    owner: "priya.testnet",
    tagline: "Checks every claim",
    skill: "check",
    glyph: "lens",
    hue: 160,
    tools: ["calculator", "knowledge"],
    fuel: 4,
    instructions: "You are the editor and fact-checker. Compare the draft with the brief and the research. Fix errors, re-do any maths with the calculator, and return the final version followed by a short 'Checked:' line.",
    knowledge: NEAR_NOTES,
  },
  {
    id: "abacus",
    name: "Abacus",
    owner: "leo.testnet",
    tagline: "Runs the numbers",
    skill: "analyze",
    glyph: "chart",
    hue: 12,
    tools: ["calculator", "near_lookup", "knowledge"],
    fuel: 5,
    instructions: "You work out costs, prices and totals. Show each sum, round sensibly, and state your assumptions. You can look up NEAR accounts.",
    knowledge: "Typical international payment costs: bank wire about 25 USD plus 3 percent currency markup; PayPal about 5 percent plus 3.5 percent conversion; USDC on NEAR under 0.01 USD plus about 1 percent to cash out at an exchange.",
  },
  {
    id: "atlas",
    name: "Atlas",
    owner: "maya.testnet",
    tagline: "Market and competitor research",
    skill: "research",
    glyph: "globe",
    hue: 205,
    tools: ["web_search"],
    fuel: 3,
    instructions: "You research markets, products and competitors. Compare options side by side and point out what matters most to the reader.",
    knowledge: "",
  },
  {
    id: "herald",
    name: "Herald",
    owner: "jon.testnet",
    tagline: "Posts that sound human",
    skill: "write",
    glyph: "spark",
    hue: 48,
    tools: [],
    fuel: 3,
    instructions: "You write short social posts and announcements. Warm, local, no hype, no price predictions. Keep each post under 200 characters.",
    knowledge: "",
  },
  {
    id: "lingo",
    name: "Lingo",
    owner: "priya.testnet",
    tagline: "Translates into 30 languages",
    skill: "translate",
    glyph: "leaf",
    hue: 95,
    tools: [],
    fuel: 2,
    instructions: "You translate text faithfully and naturally, keeping formatting. Say which language you translated into.",
    knowledge: "",
  },
  {
    id: "forge",
    name: "Forge",
    owner: "leo.testnet",
    tagline: "Small scripts and code",
    skill: "code",
    glyph: "code",
    hue: 320,
    tools: ["calculator"],
    fuel: 2,
    instructions: "You write small, well-commented scripts and explain how to run them. Prefer simple, safe code with no external services.",
    knowledge: "",
  },
];

function hash(spec: Agent["spec"]) {
  return crypto.createHash("sha256").update(JSON.stringify({ i: spec.instructions, k: spec.knowledge, t: [...spec.tools].sort() })).digest("hex");
}

const HISTORY = [
  {
    title: "Explain NEAR staking in 5 bullet points",
    brief: "Explain staking on NEAR to a beginner in five short bullet points, including how long unstaking takes.",
    budget: 3,
    crew: [["scout", 3000], ["quill", 4500], ["lens", 2500]] as [string, number][],
    result: `# NEAR staking in 5 points

- **What it is**: you lend your NEAR to a validator, a computer that helps run the network.
- **What you get**: rewards, roughly 5–10% a year.
- **Is it safe?** Your NEAR stays yours; the validator can't spend it.
- **Getting it back**: unstaking takes about 2–3 days.
- **How to start**: most wallets have a "Stake" button. Pick a well-known validator.

_Checked: matches the brief, the unstaking time is in the notes._`,
    ago: 26,
  },
  {
    title: "Fee comparison table for a shop",
    brief: "Make a small table comparing what a 20 USD sale costs the shop with a card, PayPal and USDC on NEAR.",
    budget: 2,
    crew: [["abacus", 5000], ["lens", 5000]] as [string, number][],
    result: `| Way to pay | Fee on 20 USD |
|---|---|
| Card (2.9% + 0.30) | 0.88 USD |
| PayPal (3.49% + 0.49) | 1.19 USD |
| USDC on NEAR | under 0.01 USD |

_Checked with the calculator: 20 × 0.029 + 0.30 = 0.88; 20 × 0.0349 + 0.49 = 1.188._`,
    ago: 9,
  },
];

export function seedWorld(): World {
  const w: World = {
    version: WORLD_VERSION,
    created_at: Date.now(),
    next_job_id: 1,
    jobs: {},
    agents: {},
    funders: {},
    balances: {},
    owed: {},
    runner_fuel_earned: "0",
    txs: [],
    activity: [],
  };
  for (const who of ["maya.testnet", "jon.testnet", "priya.testnet", "leo.testnet", "sam.testnet"]) w.balances[who] = near(100).toString();
  w.balances["you.testnet"] = near(50).toString();

  for (const s of SEEDS) {
    const spec = { instructions: s.instructions, knowledge: s.knowledge, tools: s.tools };
    L.registerAgent(w, s.owner, {
      id: s.id,
      name: s.name,
      spec_hash: hash(spec),
      tools: s.tools,
      max_fuel_per_job: near(0.5),
      refuel_bps: 2_000,
      creator_bps: 5_000,
      deposit: near(s.fuel),
      tagline: s.tagline,
      skill: s.skill,
      hue: s.hue,
      glyph: s.glyph,
      spec,
    });
    L.finishAgentReview(w, s.id, demoVerdict(["Safe purpose", "No hidden commands", "Approved tools", "No private data"], "Safe instructions and approved tools."));
    w.agents[s.id].created_at_ms = Date.now() - 1000 * 60 * 60 * 24 * (3 + s.fuel);
  }
  // Other people back agents they like. You back Lens, so you can see earnings arrive.
  L.fundAgent(w, "scout", "sam.testnet", near(2));
  L.fundAgent(w, "lens", "you.testnet", near(2));
  L.fundAgent(w, "quill", "sam.testnet", near(1));

  for (const h of HISTORY) {
    const j = L.postJob(w, "sam.testnet", {
      title: h.title,
      brief: h.brief,
      deadline_ms: Date.now() + 86_400_000,
      deposit: near(h.budget) + L.JOB_STORAGE,
    });
    L.finishJobReview(w, j.id, demoVerdict(["Allowed", "Clear", "Fair price", "No private data"], "A clear, ordinary job."));
    L.assignCrew(w, j.id, h.crew);
    const at = Date.now() - h.ago * 3_600_000;
    j.created_at_ms = at;
    for (const [agent] of h.crew) {
      const cost = near(0.0004);
      L.chargeFuel(w, j.id, agent, cost, `demo-${crypto.randomBytes(8).toString("hex")}`);
      j.steps.push({
        agent,
        role: `${w.agents[agent].skill}#0`,
        started_at: at,
        ended_at: at + 20_000,
        text: agent === h.crew[h.crew.length - 1][0] ? h.result : "Notes handed to the next agent.",
        tools: [],
        tokens: 1400,
        cost: cost.toString(),
        receipt: `demo-${crypto.randomBytes(8).toString("hex")}`,
        verified: null,
      });
    }
    j.bids = h.crew.map(([agent]) => ({ agent, role: w.agents[agent].skill, pitch: "Happy to help.", fit: 80, at }));
    j.result = h.result;
    L.deliver(w, j.id, crypto.createHash("sha256").update(h.result).digest("hex"));
    L.checkDelivery(w, j.id, demoVerdict(["Matches the brief", "Complete", "Safe", "No private data"], "The work answers the brief."), 0);
    L.approve(w, j.id, "sam.testnet");
    j.phase = "done";
  }
  // Seeded history shouldn't flood the transaction list with "now" times.
  const start = Date.now() - 30 * 3_600_000;
  w.txs.reverse().forEach((t, i) => (t.at = start + i * 60_000));
  w.txs.reverse();
  w.activity.push(
    { at: Date.now() - 9 * 3_600_000, kind: "pay", text: `Fee comparison table paid out to Abacus and Lens`, job: 2 },
    { at: Date.now() - 26 * 3_600_000, kind: "pay", text: `Staking explainer paid out to Scout, Quill and Lens`, job: 1 },
  );
  return w;
}

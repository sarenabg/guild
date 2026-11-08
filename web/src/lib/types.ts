// Shared types. Field names follow the Guild contract (contracts/swarm) so the
// demo ledger and the real testnet contract look the same to the screens.

export type Check = { name: string; passed: boolean; note?: string };

export type Verdict = {
  approved: boolean;
  checks: Check[];
  summary: string;
  /** Proof of the AI call that made the decision (NEAR AI completion id). */
  receipt: string;
  /** Set when the NEAR AI TEE signature for `receipt` was fetched and verified. */
  verified?: { signer: string; kind: string } | null;
  /** The TEE signature itself, which the contract can check (live mode). */
  proof?: { text: string; signature: string; signing_address: string };
  /** "rules" = blocked by fixed rules before any AI ran. */
  by: "rules" | "ai" | "demo-ai";
};

export type JobStatus =
  | "InReview"
  | "Open"
  | "Rejected"
  | "ReviewTimedOut"
  | "Working"
  | "Delivered"
  | "Disputed"
  | "Paid"
  | "Refunded"
  | "Split";

export type AgentStatus = "InReview" | "Active" | "Rejected" | "ReviewTimedOut" | "Retired";

export type CrewMember = {
  agent: string;
  share_bps: number;
  /** yoctoNEAR as a decimal string */
  fuel_used: string;
};

export type Job = {
  id: number;
  poster: string;
  title: string;
  brief: string;
  budget: string;
  status: JobStatus;
  created_at_ms: number;
  deadline_ms: number;
  review: Verdict | null;
  crew: CrewMember[];
  result_hash: string | null;
  result_check: Verdict | null;
  release_at_ms: number | null;
  delivered_at_ms: number | null;
  disputed_at_ms: number | null;
  // ---- kept off-chain by the runner ----
  phase: Phase;
  bids: Bid[];
  steps: WorkStep[];
  result: string | null;
  payouts: Payout[];
  attempts: number;
};

/** What the runner is doing right now (finer than the on-chain status). */
export type Phase =
  | "reviewing"
  | "rejected"
  | "bidding"
  | "crewing"
  | "working"
  | "checking"
  | "waiting"
  | "paying"
  | "done"
  | "refunded"
  | "disputed";

export type Bid = {
  agent: string;
  role: string;
  pitch: string;
  /** 0..100: how well the agent fits the job */
  fit: number;
  at: number;
};

export type ToolCall = { tool: string; input: string; output: string };

export type WorkStep = {
  agent: string;
  role: string;
  started_at: number;
  ended_at: number | null;
  text: string;
  tools: ToolCall[];
  tokens: number;
  /** yoctoNEAR charged to the agent's fuel */
  cost: string;
  receipt: string;
  verified: { signer: string; kind: string } | null;
};

export type Payout = {
  agent: string;
  pay: string;
  refuel: string;
  creator: string;
  funders: string;
};

export type AgentSpec = {
  instructions: string;
  knowledge: string;
  tools: string[];
};

export type Agent = {
  id: string;
  owner: string;
  name: string;
  spec_hash: string;
  tools: string[];
  fuel: string;
  max_fuel_per_job: string;
  refuel_bps: number;
  creator_bps: number;
  status: AgentStatus;
  review: Verdict | null;
  jobs_done: number;
  earned: string;
  funded: string;
  busy_jobs: number;
  last_active_ms: number;
  total_shares: string;
  funders: number;
  earned_per_share: string;
  // ---- off-chain ----
  tagline: string;
  skill: Skill;
  hue: number;
  glyph: Glyph;
  spec: AgentSpec;
  created_at_ms: number;
  reviewing_until?: number;
};

/** What an agent is best at. Decides its place in a crew. */
export type Skill = "research" | "analyze" | "write" | "translate" | "code" | "check";

export type Glyph ="eye" | "pen" | "lens" | "spark" | "globe" | "chart" | "shield" | "code" | "leaf";

export type Funder = { shares: string; settled_at: string; unclaimed: string };

export type Tx = {
  hash: string;
  at: number;
  signer: string;
  method: string;
  summary: string;
  /** The contract method's arguments. */
  args?: Record<string, unknown>;
  /** Live mode: link to the real transaction on the explorer. */
  url?: string;
};

/** A contract call as recorded in the demo log. */
export type ChainArgs = {
  args: Record<string, unknown>;
  /** yoctoNEAR attached */
  deposit?: string;
  kind?: "job" | "agent" | "fund";
  localJob?: number;
};

export type Activity = {
  at: number;
  kind: "job" | "agent" | "review" | "work" | "pay" | "fund" | "warn";
  text: string;
  job?: number;
  agent?: string;
};

export type World = {
  version: number;
  created_at: number;
  next_job_id: number;
  jobs: Record<string, Job>;
  agents: Record<string, Agent>;
  funders: Record<string, Funder>;
  balances: Record<string, string>;
  owed: Record<string, string>;
  runner_fuel_earned: string;
  txs: Tx[];
  activity: Activity[];
};

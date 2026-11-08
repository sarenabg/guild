//! # Guild contract (crate `hive-swarm`)
//!
//! A job board where AI agents do the work.
//!
//! - **Jobs.** Anyone posts a job with a budget in NEAR. The budget is held by
//!   this contract. Before the job goes live, the contract *pauses and waits*
//!   for an AI safety review (NEAR's yield/resume). Approved: the job opens.
//!   Rejected, or no answer in time: the budget goes straight back.
//! - **Agents.** Anyone adds an agent: a name, a fingerprint (hash) of its
//!   instructions, knowledge and tools, and some NEAR as its **fuel tank**.
//!   The same safety review runs on every new agent.
//! - **Work.** The swarm runner picks a crew of agents for an open job. Each
//!   AI call an agent makes is paid from its own fuel tank, with a receipt id
//!   from NEAR AI, and never more than the agent's own per-job limit.
//! - **Pay.** The runner delivers the result, the reviewer checks it against
//!   the brief, and the poster approves (or the payment releases by itself
//!   after a short wait). Each crew member's share is split between its
//!   owner's wallet and a top-up of its fuel tank.
//!
//! Who can do what is fixed at deployment:
//! - `reviewer`: the AI safety reviewer. It can only answer reviews.
//! - `runner`: runs the agents. It can only pick crews, charge fuel (capped)
//!   and deliver results. It can never move a job's budget.
//! - `council`: settles disputes. It can only refund, release or split.
//!
//! There is no owner and no upgrade method. Amounts are in yoctoNEAR
//! (1 NEAR = 10^24 yoctoNEAR). Times are nanoseconds since 1970.
//!
//! No money can be stuck forever: every state has a way out that anyone can
//! trigger after a timeout (review timeout, `expire_job`, `release`, and
//! `retire_agent` after a long idle time). See `THREAT_MODEL.md`.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, GasWeight, NearToken, PanicOnDefault, Promise,
    PromiseError, YieldId,
};

/// Gas kept for the review callback that runs when the reviewer answers (or
/// the wait times out). It may send a refund, so it needs room for that.
const GAS_FOR_REVIEW_CALLBACK: Gas = Gas::from_tgas(40);
/// Gas for our callback that checks whether a NEAR transfer worked.
const GAS_FOR_SENT_CALLBACK: Gas = Gas::from_tgas(5);

/// Smallest budget for a job and smallest starting fuel for an agent.
const MIN_AMOUNT: NearToken = NearToken::from_millinear(100);
/// Extra bytes paid for up front on each job / agent, so later additions
/// (verdicts, crew, result) never need another deposit.
const JOB_RESERVE_BYTES: u64 = 3_000;
const AGENT_RESERVE_BYTES: u64 = 2_000;
/// Storage paid by a new funder for their record (key + shares), charged
/// from the attached NEAR so the contract's own balance never pays for it.
const FUNDER_STORAGE_BYTES: u64 = 250;

/// If the reviewer never checks a delivery, or the council never settles a
/// dispute, anyone can settle the job 50/50 after this long (7 days).
const STALE_AFTER_NS: u64 = 7 * 24 * 3_600 * 1_000_000_000;
/// After this long without work (30 days) anyone can retire an agent, so
/// funders' NEAR is never locked by an owner who disappeared.
const AGENT_IDLE_RETIRE_NS: u64 = 30 * 24 * 3_600 * 1_000_000_000;
/// The split used when a stale job is settled by timeout.
const STALE_CREW_BPS: u128 = 5_000;

const MAX_TEE_SIGNERS: usize = 10;
const MAX_PROOF_TEXT: usize = 512;

const MAX_TITLE: usize = 120;
const MAX_BRIEF: usize = 2_000;
const MAX_NAME: usize = 40;
const MAX_TOOLS: usize = 8;
const MAX_TOOL: usize = 32;
const MAX_CHECKS: usize = 8;
const MAX_SUMMARY: usize = 400;
const MAX_RECEIPT: usize = 128;
const MAX_CREW: usize = 5;
const MAX_PAGE: u32 = 100;
const BPS: u128 = 10_000;
/// One funding share = 0.001 NEAR. Keeps share math far from overflow.
const SHARE_UNIT: u128 = 1_000_000_000_000_000_000_000;

const EVENT_STANDARD: &str = "hive";
const EVENT_VERSION: &str = "1.0.0";

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/// One line of a safety review, e.g. `{ "name": "Allowed", "passed": true }`.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Check {
    pub name: String,
    pub passed: bool,
}

/// The reviewer's answer.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Verdict {
    pub approved: bool,
    pub checks: Vec<Check>,
    /// One or two plain sentences explaining the decision.
    pub summary: String,
    /// Proof of the AI call that made the decision (a NEAR AI completion id,
    /// whose signature anyone can fetch and verify).
    pub receipt: String,
    /// Set by the contract (never by the caller) when a `TeeProof` was given
    /// and checked: the Ethereum address of the NEAR AI TEE that signed it.
    #[serde(default)]
    pub verified_signer: Option<String>,
}

/// A NEAR AI Cloud response signature, from
/// `GET https://cloud-api.near.ai/v1/signature/<chat_id>?signing_algo=ecdsa`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TeeProof {
    /// `<model>:<sha256(request)>:<sha256(response)>`
    pub text: String,
    /// 0x + 65 bytes hex (r, s, v), an EIP-191 personal_sign signature.
    pub signature: String,
    /// 0x + 20 bytes hex Ethereum address of the TEE key.
    pub signing_address: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobStatus {
    /// Waiting for the safety review.
    InReview,
    /// Approved and waiting for a crew.
    Open,
    /// Turned down by the review. Budget returned.
    Rejected,
    /// The review did not answer in time. Budget returned.
    ReviewTimedOut,
    /// A crew is working on it.
    Working,
    /// Work handed in. Waiting for the poster (or the release time).
    Delivered,
    /// The poster disputed the work. The council decides.
    Disputed,
    /// Budget paid to the crew.
    Paid,
    /// Budget returned to the poster (cancelled, expired or by the council).
    Refunded,
    /// The council split the budget between crew and poster.
    Split,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CrewMember {
    pub agent: String,
    /// Share of the budget in basis points (10_000 = 100%).
    pub share_bps: u16,
    /// Fuel this agent spent on this job so far.
    pub fuel_used: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Job {
    pub id: u64,
    pub poster: AccountId,
    pub title: String,
    pub brief: String,
    pub budget: U128,
    pub status: JobStatus,
    pub created_at_ns: u64,
    /// The crew must deliver before this time, or anyone can refund the poster.
    pub deadline_ns: u64,
    pub review: Option<Verdict>,
    pub crew: Vec<CrewMember>,
    /// Hash of the delivered work (the full text is kept by the runner).
    pub result_hash: Option<String>,
    /// The reviewer's check of the delivered work against the brief.
    pub result_check: Option<Verdict>,
    /// After this time anyone can release payment, if the work passed the check
    /// and nobody disputed it.
    pub release_at_ns: Option<u64>,
    /// When the work was last handed in.
    pub delivered_at_ns: Option<u64>,
    /// When the poster disputed it.
    pub disputed_at_ns: Option<u64>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentStatus {
    InReview,
    Active,
    Rejected,
    ReviewTimedOut,
    Retired,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Agent {
    /// Short unique handle: lowercase letters, digits and `-`.
    pub id: String,
    pub owner: AccountId,
    pub name: String,
    /// SHA-256 (hex) of the agent's instructions, knowledge and tools. The
    /// runner must run exactly what was reviewed.
    pub spec_hash: String,
    pub tools: Vec<String>,
    /// NEAR available to pay for this agent's AI calls.
    pub fuel: U128,
    /// The most fuel the runner may spend on this agent in one job.
    pub max_fuel_per_job: U128,
    /// Part of each payout that goes back into the fuel tank (basis points).
    pub refuel_bps: u16,
    /// Part of the rest that goes to the agent's creator. Everything else is
    /// shared by the agent's funders, in proportion to what they put in.
    pub creator_bps: u16,
    pub status: AgentStatus,
    pub review: Option<Verdict>,
    pub jobs_done: u32,
    /// Total paid to this agent (owner part + refuel part).
    pub earned: U128,
    /// Total fuel ever added by anyone.
    pub funded: U128,
    /// Jobs this agent is currently working on (not yet paid or refunded).
    pub busy_jobs: u32,
    /// Funding shares (1 share = 0.001 NEAR put in) and how many funders.
    pub total_shares: U128,
    pub funders: u32,
    /// Earnings per share so far, in yoctoNEAR (only ever grows).
    pub earned_per_share: U128,
    /// Last time the agent was approved, picked for a job or finished one.
    pub last_active_ns: u64,
}

/// One funder's stake in one agent.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Funder {
    pub shares: U128,
    /// `shares * earned_per_share` at the last settlement.
    pub settled_at: U128,
    /// Earnings settled but not yet claimed.
    pub unclaimed: U128,
}

/// What `get_funder` returns.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FunderView {
    pub shares: U128,
    /// Earnings ready to claim now.
    pub claimable: U128,
}

/// What is being reviewed. Passed back to the review callback.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Subject {
    Job(u64),
    Agent(String),
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub reviewer: AccountId,
    pub runner: AccountId,
    pub council: AccountId,
    pub release_after_ns: u64,
    pub job_count: u64,
    pub agent_count: u32,
    pub runner_fuel_earned: U128,
    /// See `STALE_AFTER_NS`.
    pub stale_after_ns: u64,
    /// See `AGENT_IDLE_RETIRE_NS`.
    pub agent_idle_retire_ns: u64,
}

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Jobs,
    Agents,
    Yields,
    Owed,
    Funders,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    reviewer: AccountId,
    runner: AccountId,
    council: AccountId,
    /// How long after a passed result check the payment releases by itself.
    release_after_ns: u64,
    next_job_id: u64,
    jobs: IterableMap<u64, Job>,
    agents: IterableMap<String, Agent>,
    /// Open reviews: what is being reviewed -> the yield to resume.
    yields: LookupMap<String, YieldId>,
    /// Transfers that failed and can be claimed with `claim`.
    owed: LookupMap<AccountId, u128>,
    /// Fuel paid to the runner for AI calls it made on agents' behalf.
    runner_fuel_earned: u128,
    /// Funders' stakes, keyed by "agent_id:account_id".
    funders: LookupMap<String, Funder>,
    /// NEAR AI TEE signing addresses (lowercase 0x hex) the council trusts.
    tee_signers: Vec<String>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(reviewer: AccountId, runner: AccountId, council: AccountId, release_after_ns: u64) -> Self {
        Self {
            reviewer,
            runner,
            council,
            release_after_ns,
            next_job_id: 1,
            jobs: IterableMap::new(StorageKey::Jobs),
            agents: IterableMap::new(StorageKey::Agents),
            yields: LookupMap::new(StorageKey::Yields),
            owed: LookupMap::new(StorageKey::Owed),
            runner_fuel_earned: 0,
            funders: LookupMap::new(StorageKey::Funders),
            tee_signers: vec![],
        }
    }

    // ----- Jobs -------------------------------------------------------------

    /// Post a job. Attach the budget (plus a little for storage). The job
    /// waits for the safety review before anyone can work on it.
    #[payable]
    pub fn post_job(&mut self, title: String, brief: String, deadline_ns: u64) -> u64 {
        require!(!title.trim().is_empty() && title.len() <= MAX_TITLE, "Title must be 1 to 120 characters");
        require!(!brief.trim().is_empty() && brief.len() <= MAX_BRIEF, "Brief must be 1 to 2000 characters");
        let now = env::block_timestamp();
        require!(deadline_ns > now, "Deadline must be in the future");

        let id = self.next_job_id;
        self.next_job_id += 1;
        let job = Job {
            id,
            poster: env::predecessor_account_id(),
            title,
            brief,
            budget: U128(0),
            status: JobStatus::InReview,
            created_at_ns: now,
            deadline_ns,
            review: None,
            crew: vec![],
            result_hash: None,
            result_check: None,
            release_at_ns: None,
            delivered_at_ns: None,
            disputed_at_ns: None,
        };
        let storage = self.store_job(job, JOB_RESERVE_BYTES);
        let budget = take_after_storage(storage);
        let job = self.jobs.get_mut(&id).unwrap();
        job.budget = U128(budget);

        self.start_review(Subject::Job(id));
        emit(
            "job_posted",
            json!({ "job_id": id, "poster": env::predecessor_account_id(), "budget": U128(budget) }),
        );
        id
    }

    /// The poster cancels a job nobody is working on yet. Budget returned.
    pub fn cancel_job(&mut self, job_id: u64) {
        let job = self.job_mut(job_id);
        require!(env::predecessor_account_id() == job.poster, "Only the poster can cancel");
        require!(job.status == JobStatus::Open, "Only open jobs can be cancelled");
        job.status = JobStatus::Refunded;
        let (poster, budget) = (job.poster.clone(), job.budget.0);
        self.send(poster, budget);
        emit("job_refunded", json!({ "job_id": job_id, "reason": "cancelled", "amount": U128(budget) }));
    }

    /// Anyone can return the budget of a job whose deadline passed without
    /// a delivery.
    pub fn expire_job(&mut self, job_id: u64) {
        let job = self.job_mut(job_id);
        require!(
            matches!(job.status, JobStatus::Open | JobStatus::Working),
            "Job is not open or in progress"
        );
        require!(env::block_timestamp() >= job.deadline_ns, "Deadline has not passed");
        job.status = JobStatus::Refunded;
        let (poster, budget) = (job.poster.clone(), job.budget.0);
        let crew: Vec<String> = job.crew.iter().map(|c| c.agent.clone()).collect();
        self.free_agents(&crew);
        self.send(poster, budget);
        emit("job_refunded", json!({ "job_id": job_id, "reason": "expired", "amount": U128(budget) }));
    }

    /// Runner: pick the crew for an open job. Shares must add up to 100%.
    pub fn assign_crew(&mut self, job_id: u64, crew: Vec<(String, u16)>) {
        self.assert_runner();
        require!(!crew.is_empty() && crew.len() <= MAX_CREW, "Crew must be 1 to 5 agents");
        let total: u128 = crew.iter().map(|(_, s)| *s as u128).sum();
        require!(total == BPS, "Crew shares must add up to 10000");
        for (i, (agent_id, share)) in crew.iter().enumerate() {
            require!(*share > 0, "Every crew member needs a share");
            require!(
                !crew[..i].iter().any(|(a, _)| a == agent_id),
                "An agent can only appear once in a crew"
            );
            let agent = self.agents.get(agent_id).unwrap_or_else(|| env::panic_str("Unknown agent"));
            require!(agent.status == AgentStatus::Active, "Every crew agent must be active");
        }
        let job = self.job_mut(job_id);
        require!(job.status == JobStatus::Open, "Job is not open");
        require!(env::block_timestamp() < job.deadline_ns, "Job deadline has passed");
        job.crew = crew
            .into_iter()
            .map(|(agent, share_bps)| CrewMember { agent, share_bps, fuel_used: U128(0) })
            .collect();
        job.status = JobStatus::Working;
        let names: Vec<String> = job.crew.iter().map(|c| c.agent.clone()).collect();
        let now = env::block_timestamp();
        for name in &names {
            let agent = self.agents.get_mut(name).unwrap();
            agent.busy_jobs += 1;
            agent.last_active_ns = now;
        }
        emit("crew_assigned", json!({ "job_id": job_id, "crew": names }));
    }

    /// Runner: charge an agent's fuel tank for AI calls it made on a job.
    /// `receipt` is the NEAR AI completion id, so anyone can check the call.
    pub fn charge_fuel(&mut self, job_id: u64, agent_id: String, amount: U128, receipt: String) {
        self.assert_runner();
        require!(amount.0 > 0, "Amount must be positive");
        require!(!receipt.is_empty() && receipt.len() <= MAX_RECEIPT, "Receipt must be 1 to 128 characters");
        let job = self.jobs.get_mut(&job_id).unwrap_or_else(|| env::panic_str("Unknown job"));
        require!(job.status == JobStatus::Working, "Job is not in progress");
        // The whole crew can never burn more fuel on a job than the job pays.
        let job_used: u128 = job.crew.iter().map(|c| c.fuel_used.0).sum();
        require!(job_used + amount.0 <= job.budget.0, "Fuel for one job cannot exceed its budget");
        let member = job
            .crew
            .iter_mut()
            .find(|c| c.agent == agent_id)
            .unwrap_or_else(|| env::panic_str("Agent is not in this job's crew"));
        let agent = self.agents.get_mut(&agent_id).unwrap();
        let used = member.fuel_used.0 + amount.0;
        require!(used <= agent.max_fuel_per_job.0, "Over this agent's fuel limit for one job");
        require!(amount.0 <= agent.fuel.0, "Not enough fuel");
        agent.fuel = U128(agent.fuel.0 - amount.0);
        member.fuel_used = U128(used);
        self.runner_fuel_earned += amount.0;
        emit(
            "fuel_charged",
            json!({ "job_id": job_id, "agent": agent_id, "amount": amount, "receipt": receipt }),
        );
    }

    /// Runner: hand in the finished work (its hash; the text lives with the
    /// runner and is shown to the poster).
    pub fn deliver(&mut self, job_id: u64, result_hash: String) {
        self.assert_runner();
        require!(is_hex_hash(&result_hash), "Result hash must be 64 hex characters");
        let job = self.job_mut(job_id);
        require!(job.status == JobStatus::Working, "Job is not in progress");
        // After the deadline the job belongs to `expire_job`, so a late
        // delivery can never race a refund.
        let now = env::block_timestamp();
        require!(now < job.deadline_ns, "Job deadline has passed");
        job.result_hash = Some(result_hash.clone());
        job.result_check = None;
        job.release_at_ns = None;
        job.delivered_at_ns = Some(now);
        job.status = JobStatus::Delivered;
        emit("job_delivered", json!({ "job_id": job_id, "result_hash": result_hash }));
    }

    /// Reviewer: check the delivered work against the brief. Passed: the
    /// payment releases by itself after `release_after_ns` unless disputed.
    /// Failed: the crew gets the job back to fix it.
    /// `proof` (optional): a NEAR AI TEE signature for the AI call behind the
    /// verdict. If given it must verify, and the signer is saved on the verdict.
    pub fn check_delivery(&mut self, job_id: u64, verdict: Verdict, proof: Option<TeeProof>) {
        require!(env::predecessor_account_id() == self.reviewer, "Only the reviewer");
        assert_valid_verdict(&verdict);
        let mut verdict = verdict;
        verdict.verified_signer = proof.map(|p| self.verify_tee(&p));
        let release_after = self.release_after_ns;
        let job = self.job_mut(job_id);
        require!(job.status == JobStatus::Delivered, "No delivery to check");
        require!(job.result_check.is_none(), "Delivery already checked");
        let passed = verdict.approved;
        job.result_check = Some(verdict);
        if passed {
            job.release_at_ns = Some(env::block_timestamp().saturating_add(release_after));
        } else {
            job.status = JobStatus::Working;
        }
        emit("delivery_checked", json!({ "job_id": job_id, "passed": passed }));
    }

    /// The poster approves the work and pays the crew now.
    pub fn approve(&mut self, job_id: u64) {
        let job = self.job(job_id);
        require!(env::predecessor_account_id() == job.poster, "Only the poster can approve");
        require!(job.status == JobStatus::Delivered, "Nothing delivered yet");
        self.pay_crew(job_id, BPS);
    }

    /// Anyone: release payment once the release time passed (the work passed
    /// its check and nobody disputed it).
    ///
    /// Also the safety exit when a trusted party goes silent: if the reviewer
    /// never checked a delivery, or the council never settled a dispute, for
    /// `STALE_AFTER_NS`, anyone can settle the job 50/50 (crew / poster).
    pub fn release(&mut self, job_id: u64) {
        let job = self.job(job_id);
        let now = env::block_timestamp();
        match job.status {
            JobStatus::Delivered => match job.release_at_ns {
                Some(at) => {
                    require!(now >= at, "Release time has not come yet");
                    self.pay_crew(job_id, BPS);
                }
                None => {
                    let since = job.delivered_at_ns.unwrap_or(job.created_at_ns);
                    require!(now >= since.saturating_add(STALE_AFTER_NS), "Work has not passed its check");
                    emit("job_stale", json!({ "job_id": job_id, "reason": "never checked" }));
                    self.pay_crew(job_id, STALE_CREW_BPS);
                }
            },
            JobStatus::Disputed => {
                let since = job.disputed_at_ns.unwrap_or(job.created_at_ns);
                require!(now >= since.saturating_add(STALE_AFTER_NS), "The council still has time to decide");
                emit("job_stale", json!({ "job_id": job_id, "reason": "dispute not settled" }));
                self.pay_crew(job_id, STALE_CREW_BPS);
            }
            _ => env::panic_str("Nothing delivered yet"),
        }
    }

    /// The poster disputes delivered work before it releases.
    pub fn dispute(&mut self, job_id: u64) {
        let job = self.job_mut(job_id);
        require!(env::predecessor_account_id() == job.poster, "Only the poster can dispute");
        require!(job.status == JobStatus::Delivered, "Nothing delivered to dispute");
        if let Some(at) = job.release_at_ns {
            require!(env::block_timestamp() < at, "Too late: payment already releasable");
        }
        job.status = JobStatus::Disputed;
        job.disputed_at_ns = Some(env::block_timestamp());
        emit("job_disputed", json!({ "job_id": job_id }));
    }

    /// Council: settle a dispute. `crew_bps` of the budget goes to the crew,
    /// the rest back to the poster (10000 = all to crew, 0 = full refund).
    pub fn resolve(&mut self, job_id: u64, crew_bps: u16) {
        require!(env::predecessor_account_id() == self.council, "Only the council");
        require!(crew_bps as u128 <= BPS, "crew_bps must be 0 to 10000");
        let job = self.job(job_id);
        require!(job.status == JobStatus::Disputed, "Job is not disputed");
        self.pay_crew(job_id, crew_bps as u128);
    }

    // ----- Agents -----------------------------------------------------------

    /// Add an agent to the swarm. The attached NEAR (minus storage) fills its
    /// fuel tank. The agent waits for the safety review before it can work.
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn register_agent(
        &mut self,
        id: String,
        name: String,
        spec_hash: String,
        tools: Vec<String>,
        max_fuel_per_job: U128,
        refuel_bps: u16,
        creator_bps: u16,
    ) {
        assert_valid_handle(&id);
        require!(self.agents.get(&id).is_none(), "That handle is taken");
        require!(!name.trim().is_empty() && name.len() <= MAX_NAME, "Name must be 1 to 40 characters");
        require!(is_hex_hash(&spec_hash), "spec_hash must be 64 hex characters");
        require!(tools.len() <= MAX_TOOLS, "At most 8 tools");
        for t in &tools {
            require!(!t.is_empty() && t.len() <= MAX_TOOL, "Tool names must be 1 to 32 characters");
        }
        require!(max_fuel_per_job.0 > 0, "max_fuel_per_job must be positive");
        require!(refuel_bps as u128 <= BPS, "refuel_bps must be 0 to 10000");
        require!(creator_bps as u128 <= BPS, "creator_bps must be 0 to 10000");

        let agent = Agent {
            id: id.clone(),
            owner: env::predecessor_account_id(),
            name,
            spec_hash,
            tools,
            fuel: U128(0),
            max_fuel_per_job,
            refuel_bps,
            creator_bps,
            status: AgentStatus::InReview,
            review: None,
            jobs_done: 0,
            earned: U128(0),
            funded: U128(0),
            busy_jobs: 0,
            total_shares: U128(0),
            funders: 0,
            earned_per_share: U128(0),
            last_active_ns: env::block_timestamp(),
        };
        let before = env::storage_usage();
        self.agents.insert(id.clone(), agent);
        self.agents.flush();
        let bytes = env::storage_usage().saturating_sub(before) + AGENT_RESERVE_BYTES;
        let fuel = take_after_storage(bytes);
        let agent = self.agents.get_mut(&id).unwrap();
        agent.fuel = U128(fuel);
        agent.funded = U128(fuel);
        self.add_funding(&id, env::predecessor_account_id(), fuel);

        self.start_review(Subject::Agent(id.clone()));
        emit(
            "agent_registered",
            json!({ "agent": id, "owner": env::predecessor_account_id(), "fuel": U128(fuel) }),
        );
    }

    /// Anyone can fund an active agent. The NEAR goes into its fuel tank, and
    /// the funder gets a share of the agent's future earnings.
    ///
    /// Only while the agent is not on a job: otherwise someone could buy
    /// shares just before a payout and take earnings from work they did not
    /// fuel. A first-time funder also pays for their record's storage.
    #[payable]
    pub fn fund_agent(&mut self, agent_id: String) {
        let who = env::predecessor_account_id();
        let attached = env::attached_deposit().as_yoctonear();
        let agent = self.agents.get(&agent_id).unwrap_or_else(|| env::panic_str("Unknown agent"));
        require!(agent.status == AgentStatus::Active, "Agent is not accepting funding");
        require!(agent.busy_jobs == 0, "Agent is on a job. Fund it when the job ends");
        let storage = if self.funders.contains_key(&funder_key(&agent_id, &who)) {
            0
        } else {
            env::storage_byte_cost().as_yoctonear() * FUNDER_STORAGE_BYTES as u128
        };
        require!(
            attached >= SHARE_UNIT + storage,
            format!("Attach at least 0.001 NEAR ({} yoctoNEAR incl. storage)", SHARE_UNIT + storage)
        );
        let amount = attached - storage;
        let agent = self.agents.get_mut(&agent_id).unwrap();
        agent.fuel = U128(agent.fuel.0 + amount);
        agent.funded = U128(agent.funded.0 + amount);
        self.add_funding(&agent_id, who.clone(), amount);
        emit("agent_funded", json!({ "agent": agent_id, "by": who, "amount": U128(amount) }));
    }

    /// The owner retires an agent. Its unused fuel is shared back to its
    /// funders (claim with `claim_earnings`). Not allowed while it is on a job.
    /// Anyone may retire an agent that has had no work for 30 days, so
    /// funders can always get their NEAR back.
    pub fn retire_agent(&mut self, agent_id: String) {
        let agent = self.agents.get_mut(&agent_id).unwrap_or_else(|| env::panic_str("Unknown agent"));
        require!(agent.busy_jobs == 0, "Agent is still on a job");
        let idle_long = env::block_timestamp() >= agent.last_active_ns.saturating_add(AGENT_IDLE_RETIRE_NS);
        require!(
            env::predecessor_account_id() == agent.owner || idle_long,
            "Only the owner (or anyone after 30 idle days)"
        );
        require!(agent.status == AgentStatus::Active, "Only active agents can retire");
        agent.status = AgentStatus::Retired;
        let fuel = agent.fuel.0;
        agent.fuel = U128(0);
        let leftover = share_out(agent, fuel);
        let owner = agent.owner.clone();
        self.send(owner, leftover);
        emit(
            "agent_retired",
            json!({ "agent": agent_id, "by": env::predecessor_account_id(), "fuel_returned": U128(fuel) }),
        );
    }

    /// A funder takes the earnings their shares in an agent have collected.
    pub fn claim_earnings(&mut self, agent_id: String) -> Promise {
        let who = env::predecessor_account_id();
        let key = funder_key(&agent_id, &who);
        let per_share = self.agents.get(&agent_id).map(|a| a.earned_per_share.0).unwrap_or(0);
        let mut f = self.funders.get(&key).cloned().unwrap_or_else(|| env::panic_str("Not a funder"));
        settle(&mut f, per_share);
        let amount = f.unclaimed.0;
        require!(amount > 0, "Nothing to claim");
        f.unclaimed = U128(0);
        self.funders.insert(key, f);
        emit("earnings_claimed", json!({ "agent": agent_id, "by": who, "amount": U128(amount) }));
        transfer(who, amount)
    }

    // ----- Reviews (yield / resume) ----------------------------------------

    /// Reviewer: answer a pending review. This resumes the paused contract
    /// call, which then opens (or refunds) the job or agent.
    /// `proof` (optional): a NEAR AI TEE signature for the AI call behind the
    /// verdict. If given it must verify, and the signer is saved on the verdict.
    pub fn submit_review(&mut self, subject: Subject, verdict: Verdict, proof: Option<TeeProof>) {
        require!(env::predecessor_account_id() == self.reviewer, "Only the reviewer");
        assert_valid_verdict(&verdict);
        let mut verdict = verdict;
        verdict.verified_signer = proof.map(|p| self.verify_tee(&p));
        let key = subject_key(&subject);
        let yield_id =
            self.yields.remove(&key).unwrap_or_else(|| env::panic_str("No review is waiting for this"));
        let data = serde_json::to_vec(&verdict).unwrap();
        require!(yield_id.resume(data).is_ok(), "Review already timed out");
    }

    /// Runs when the reviewer answered, or when the wait timed out (about 200
    /// blocks). Only this contract can call it.
    #[private]
    pub fn on_review(&mut self, subject: Subject) {
        let verdict: Option<Verdict> = match env::promise_result_checked(0, 16_384) {
            Ok(bytes) => serde_json::from_slice(&bytes).ok(),
            Err(PromiseError::Failed) | Err(_) => None,
        };
        self.yields.remove(&subject_key(&subject));
        match subject {
            Subject::Job(id) => self.finish_job_review(id, verdict),
            Subject::Agent(id) => self.finish_agent_review(id, verdict),
        }
    }

    // ----- Money out --------------------------------------------------------

    /// Runs after each NEAR transfer. If it failed (for example the account
    /// does not exist), the amount is kept for the receiver to `claim`.
    #[private]
    pub fn on_sent(&mut self, to: AccountId, amount: U128) -> bool {
        let ok = env::promise_results_count() == 1
            && !matches!(env::promise_result_checked(0, 16), Err(PromiseError::Failed));
        if !ok {
            let prev = self.owed.get(&to).copied().unwrap_or(0);
            self.owed.insert(to.clone(), prev + amount.0);
            emit("transfer_failed", json!({ "to": to, "amount": amount }));
        }
        ok
    }

    /// Take money that could not be delivered earlier.
    pub fn claim(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let amount = self.owed.remove(&who).unwrap_or(0);
        require!(amount > 0, "Nothing to claim");
        transfer(who, amount)
    }

    /// Runner: withdraw the fuel it was paid for AI calls.
    pub fn runner_withdraw(&mut self) -> Promise {
        self.assert_runner();
        let amount = self.runner_fuel_earned;
        require!(amount > 0, "Nothing to withdraw");
        self.runner_fuel_earned = 0;
        transfer(self.runner.clone(), amount)
    }

    // ----- TEE signers (council) -------------------------------------------

    /// Council: trust a NEAR AI TEE signing address (0x + 40 hex).
    pub fn add_tee_signer(&mut self, address: String) {
        require!(env::predecessor_account_id() == self.council, "Only the council");
        let address = normalize_address(&address);
        require!(!self.tee_signers.contains(&address), "Signer already added");
        require!(self.tee_signers.len() < MAX_TEE_SIGNERS, "At most 10 signers");
        self.tee_signers.push(address.clone());
        emit("tee_signer_added", json!({ "address": address }));
    }

    /// Council: stop trusting a TEE signing address.
    pub fn remove_tee_signer(&mut self, address: String) {
        require!(env::predecessor_account_id() == self.council, "Only the council");
        let address = normalize_address(&address);
        let before = self.tee_signers.len();
        self.tee_signers.retain(|a| *a != address);
        require!(self.tee_signers.len() < before, "Unknown signer");
        emit("tee_signer_removed", json!({ "address": address }));
    }

    // ----- Views ------------------------------------------------------------

    pub fn tee_signers(&self) -> Vec<String> {
        self.tee_signers.clone()
    }

    pub fn get_config(&self) -> Config {
        Config {
            reviewer: self.reviewer.clone(),
            runner: self.runner.clone(),
            council: self.council.clone(),
            release_after_ns: self.release_after_ns,
            job_count: self.next_job_id - 1,
            agent_count: self.agents.len(),
            runner_fuel_earned: U128(self.runner_fuel_earned),
            stale_after_ns: STALE_AFTER_NS,
            agent_idle_retire_ns: AGENT_IDLE_RETIRE_NS,
        }
    }

    pub fn get_job(&self, job_id: u64) -> Option<Job> {
        self.jobs.get(&job_id).cloned()
    }

    /// Jobs, newest first.
    pub fn list_jobs(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Job> {
        let from = from_index.unwrap_or(0) as u64;
        let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as u64;
        let last = self.next_job_id - 1;
        (0..limit)
            .filter_map(|i| last.checked_sub(from + i).filter(|id| *id > 0))
            .filter_map(|id| self.jobs.get(&id).cloned())
            .collect()
    }

    pub fn get_agent(&self, agent_id: String) -> Option<Agent> {
        self.agents.get(&agent_id).cloned()
    }

    pub fn list_agents(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Agent> {
        let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize;
        self.agents.values().skip(from_index.unwrap_or(0) as usize).take(limit).cloned().collect()
    }

    /// A funder's shares in an agent and what they can claim now.
    pub fn get_funder(&self, agent_id: String, account_id: AccountId) -> FunderView {
        let per_share = self.agents.get(&agent_id).map(|a| a.earned_per_share.0).unwrap_or(0);
        let mut f = self.funders.get(&funder_key(&agent_id, &account_id)).cloned().unwrap_or_default();
        settle(&mut f, per_share);
        FunderView { shares: f.shares, claimable: f.unclaimed }
    }

    pub fn owed_to(&self, account_id: AccountId) -> U128 {
        U128(self.owed.get(&account_id).copied().unwrap_or(0))
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

impl Contract {
    fn assert_runner(&self) {
        require!(env::predecessor_account_id() == self.runner, "Only the runner");
    }

    /// Check a NEAR AI TEE signature (EIP-191 personal_sign over `text`) and
    /// return the signer. Panics unless it verifies and the signer is trusted.
    fn verify_tee(&self, p: &TeeProof) -> String {
        require!(
            !p.text.is_empty() && p.text.len() <= MAX_PROOF_TEXT,
            "Proof text must be 1 to 512 characters"
        );
        let signer = normalize_address(&p.signing_address);
        require!(self.tee_signers.contains(&signer), "Unknown TEE signer");
        let sig = decode_hex(&p.signature)
            .filter(|s| s.len() == 65)
            .unwrap_or_else(|| env::panic_str("Signature must be 65 bytes of hex"));
        let v = match sig[64] {
            0 | 27 => 0,
            1 | 28 => 1,
            _ => env::panic_str("Bad signature recovery byte"),
        };
        let mut msg = format!("\x19Ethereum Signed Message:\n{}", p.text.len()).into_bytes();
        msg.extend_from_slice(p.text.as_bytes());
        let hash = env::keccak256_array(&msg);
        let key =
            env::ecrecover(&hash, &sig[..64], v, true).unwrap_or_else(|| env::panic_str("Bad TEE signature"));
        let recovered = format!("0x{}", to_hex(&env::keccak256_array(key)[12..]));
        require!(recovered == signer, "TEE signature does not match the signer");
        signer
    }

    fn job(&self, job_id: u64) -> &Job {
        self.jobs.get(&job_id).unwrap_or_else(|| env::panic_str("Unknown job"))
    }

    fn job_mut(&mut self, job_id: u64) -> &mut Job {
        self.jobs.get_mut(&job_id).unwrap_or_else(|| env::panic_str("Unknown job"))
    }

    /// Insert a job and return how many bytes it (plus the reserve) uses.
    fn store_job(&mut self, job: Job, reserve: u64) -> u64 {
        let before = env::storage_usage();
        self.jobs.insert(job.id, job);
        self.jobs.flush();
        env::storage_usage().saturating_sub(before) + reserve
    }

    /// Pause here and wait for the reviewer. `on_review` runs when the
    /// reviewer answers through `submit_review`, or after the timeout.
    fn start_review(&mut self, subject: Subject) {
        let args = serde_json::to_vec(&json!({ "subject": subject })).unwrap();
        let (_promise, yield_id) =
            env::promise_yield_create_id("on_review", args, GAS_FOR_REVIEW_CALLBACK, GasWeight(0));
        self.yields.insert(subject_key(&subject), yield_id);
        emit("review_started", json!({ "subject": subject }));
    }

    fn finish_job_review(&mut self, job_id: u64, verdict: Option<Verdict>) {
        let Some(job) = self.jobs.get_mut(&job_id) else { return };
        if job.status != JobStatus::InReview {
            return;
        }
        let approved = verdict.as_ref().map(|v| v.approved);
        job.status = match approved {
            Some(true) => JobStatus::Open,
            Some(false) => JobStatus::Rejected,
            None => JobStatus::ReviewTimedOut,
        };
        job.review = verdict;
        let (poster, budget) = (job.poster.clone(), job.budget.0);
        emit("job_reviewed", json!({ "job_id": job_id, "approved": approved }));
        if approved != Some(true) {
            self.send(poster, budget);
            emit("job_refunded", json!({ "job_id": job_id, "reason": "review", "amount": U128(budget) }));
        }
    }

    fn finish_agent_review(&mut self, agent_id: String, verdict: Option<Verdict>) {
        let Some(agent) = self.agents.get_mut(&agent_id) else { return };
        if agent.status != AgentStatus::InReview {
            return;
        }
        let approved = verdict.as_ref().map(|v| v.approved);
        agent.status = match approved {
            Some(true) => AgentStatus::Active,
            Some(false) => AgentStatus::Rejected,
            None => AgentStatus::ReviewTimedOut,
        };
        agent.review = verdict;
        agent.last_active_ns = env::block_timestamp();
        emit("agent_reviewed", json!({ "agent": agent_id, "approved": approved }));
        if approved != Some(true) {
            let (owner, fuel) = (agent.owner.clone(), agent.fuel.0);
            agent.fuel = U128(0);
            agent.total_shares = U128(0);
            agent.funders = 0;
            self.funders.remove(&funder_key(&agent_id, &owner));
            self.send(owner, fuel);
        }
    }

    /// Pay `crew_bps` of the budget to the crew (split by shares) and the rest
    /// back to the poster. Each member's pay is split between its owner and a
    /// refuel of its tank.
    fn pay_crew(&mut self, job_id: u64, crew_bps: u128) {
        let job = self.jobs.get(&job_id).unwrap().clone();
        let budget = job.budget.0;
        let crew_total = budget * crew_bps / BPS;
        let mut paid = 0u128;
        let mut transfers: Vec<(AccountId, u128)> = vec![];
        let n = job.crew.len();
        for (i, member) in job.crew.iter().enumerate() {
            // The last member takes the rounding remainder.
            let pay =
                if i + 1 == n { crew_total - paid } else { crew_total * member.share_bps as u128 / BPS };
            paid += pay;
            let agent = self.agents.get_mut(&member.agent).unwrap();
            let refuel = pay * agent.refuel_bps as u128 / BPS;
            let creator = (pay - refuel) * agent.creator_bps as u128 / BPS;
            let to_funders = pay - refuel - creator;
            agent.fuel = U128(agent.fuel.0 + refuel);
            agent.earned = U128(agent.earned.0 + pay);
            // A full refund by the council does not count as a job done.
            if crew_bps > 0 {
                agent.jobs_done += 1;
            }
            agent.busy_jobs = agent.busy_jobs.saturating_sub(1);
            agent.last_active_ns = env::block_timestamp();
            // Whatever cannot be split into whole shares goes to the creator.
            let leftover = share_out(agent, to_funders);
            transfers.push((agent.owner.clone(), creator + leftover));
            emit(
                "agent_paid",
                json!({ "job_id": job_id, "agent": member.agent, "amount": U128(pay), "refuel": U128(refuel) }),
            );
        }
        let refund = budget - crew_total;
        let job = self.jobs.get_mut(&job_id).unwrap();
        job.status = match crew_bps {
            BPS => JobStatus::Paid,
            0 => JobStatus::Refunded,
            _ => JobStatus::Split,
        };
        let poster = job.poster.clone();
        for (to, amount) in transfers {
            self.send(to, amount);
        }
        self.send(poster, refund);
        emit("job_paid", json!({ "job_id": job_id, "to_crew": U128(crew_total), "to_poster": U128(refund) }));
    }

    /// Record `amount` of funding from `who` as shares in an agent.
    fn add_funding(&mut self, agent_id: &str, who: AccountId, amount: u128) {
        let agent = self.agents.get_mut(agent_id).unwrap();
        let new_shares = amount / SHARE_UNIT;
        let per_share = agent.earned_per_share.0;
        let key = funder_key(agent_id, &who);
        let mut f = match self.funders.get(&key) {
            Some(f) => f.clone(),
            None => {
                agent.funders += 1;
                Funder::default()
            }
        };
        settle(&mut f, per_share);
        f.shares = U128(f.shares.0 + new_shares);
        f.settled_at = U128(f.shares.0 * per_share);
        agent.total_shares = U128(agent.total_shares.0 + new_shares);
        self.funders.insert(key, f);
    }

    fn free_agents(&mut self, crew: &[String]) {
        for name in crew {
            if let Some(agent) = self.agents.get_mut(name) {
                agent.busy_jobs = agent.busy_jobs.saturating_sub(1);
                agent.last_active_ns = env::block_timestamp();
            }
        }
    }

    /// Send NEAR (nothing if zero), and remember it for `claim` if the
    /// transfer fails.
    fn send(&mut self, to: AccountId, amount: u128) {
        if amount > 0 {
            transfer(to, amount).detach();
        }
    }
}

/// Send NEAR, with a callback that keeps the amount for `claim` on failure.
fn transfer(to: AccountId, amount: u128) -> Promise {
    Promise::new(to.clone()).transfer(NearToken::from_yoctonear(amount)).then(
        Contract::ext(env::current_account_id())
            .with_static_gas(GAS_FOR_SENT_CALLBACK)
            .on_sent(to, U128(amount)),
    )
}

/// Take storage cost out of the attached deposit and return what is left.
fn take_after_storage(bytes: u64) -> u128 {
    let cost = env::storage_byte_cost().as_yoctonear() * bytes as u128;
    let attached = env::attached_deposit().as_yoctonear();
    require!(
        attached >= cost + MIN_AMOUNT.as_yoctonear(),
        format!(
            "Attach at least {} yoctoNEAR ({} for storage + 0.1 NEAR)",
            cost + MIN_AMOUNT.as_yoctonear(),
            cost
        )
    );
    attached - cost
}

/// Spread `amount` over an agent's funding shares. Returns the part that
/// could not be spread (rounding dust, or everything if nobody holds shares).
fn share_out(agent: &mut Agent, amount: u128) -> u128 {
    let shares = agent.total_shares.0;
    if shares == 0 || amount == 0 {
        return amount;
    }
    let per_share = amount / shares;
    agent.earned_per_share = U128(agent.earned_per_share.0 + per_share);
    amount - per_share * shares
}

/// Move a funder's newly earned amount into `unclaimed`.
fn settle(f: &mut Funder, per_share: u128) {
    let total = f.shares.0 * per_share;
    f.unclaimed = U128(f.unclaimed.0 + total - f.settled_at.0);
    f.settled_at = U128(total);
}

fn funder_key(agent_id: &str, who: &AccountId) -> String {
    format!("{agent_id}:{who}")
}

fn subject_key(subject: &Subject) -> String {
    match subject {
        Subject::Job(id) => format!("job:{id}"),
        Subject::Agent(id) => format!("agent:{id}"),
    }
}

fn assert_valid_verdict(v: &Verdict) {
    require!(v.checks.len() <= MAX_CHECKS, "At most 8 checks");
    for c in &v.checks {
        require!(!c.name.is_empty() && c.name.len() <= 40, "Check names must be 1 to 40 characters");
    }
    require!(v.summary.len() <= MAX_SUMMARY, "Summary is too long");
    require!(v.receipt.len() <= MAX_RECEIPT, "Receipt is too long");
    if v.approved {
        require!(v.checks.iter().all(|c| c.passed), "An approval cannot include a failed check");
    }
}

/// Agent handles: 3 to 32 characters, lowercase letters, digits and `-`.
fn assert_valid_handle(id: &str) {
    require!(id.len() >= 3 && id.len() <= 32, "Handle must be 3 to 32 characters");
    require!(
        id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
        "Handle may only contain lowercase letters, digits and '-'"
    );
}

/// `0x` + 40 hex characters, returned in lowercase.
fn normalize_address(a: &str) -> String {
    let lower = a.to_ascii_lowercase();
    let ok =
        lower.len() == 42 && lower.starts_with("0x") && lower[2..].bytes().all(|b| b.is_ascii_hexdigit());
    require!(ok, "Address must be 0x followed by 40 hex characters");
    lower
}

/// Decode hex with an optional `0x` prefix.
fn decode_hex(s: &str) -> Option<Vec<u8>> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok()).collect()
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn is_hex_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Write a NEP-297 event log: `EVENT_JSON:{...}`.
fn emit(event: &str, data: serde_json::Value) {
    let log = json!({
        "standard": EVENT_STANDARD,
        "version": EVENT_VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{log}"));
}

#[cfg(test)]
mod tests;

//! Unit tests. Run with `cargo test`.
//!
//! Results of other receipts (the reviewer's answer arriving through
//! yield/resume, a NEAR transfer succeeding or failing) are simulated by
//! calling our callbacks directly with a fake `PromiseResult`.
//! Outgoing NEAR transfers are read back with `get_created_receipts`.

use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{test_vm_config, testing_env, PromiseResult, RuntimeFeesConfig};

const NOW: u64 = 1_000_000_000_000;
const HOUR: u64 = 3_600_000_000_000;
const DAY: u64 = 24 * HOUR;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MILLI: u128 = NEAR / 1_000;
const HASH: &str = "4f9c2e1a7b3d5f6e8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f";

fn acc(name: &str) -> AccountId {
    name.parse().unwrap()
}
fn contract_id() -> AccountId {
    acc("hive.near")
}
fn reviewer() -> AccountId {
    acc("reviewer.near")
}
fn runner() -> AccountId {
    acc("runner.near")
}
fn council() -> AccountId {
    acc("council.near")
}
fn poster() -> AccountId {
    acc("alice.near")
}
fn maker() -> AccountId {
    acc("bob.near")
}
fn fan() -> AccountId {
    acc("carol.near")
}
fn fan2() -> AccountId {
    acc("dave.near")
}
fn stranger() -> AccountId {
    acc("mallory.near")
}

fn ctx(caller: AccountId, time: u64, deposit: u128) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract_id())
        .predecessor_account_id(caller.clone())
        .signer_account_id(caller)
        .block_timestamp(time)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300))
        .account_balance(NearToken::from_near(1_000_000));
    testing_env!(b.build());
}

fn call(caller: AccountId) {
    ctx(caller, NOW, 0);
}

/// Simulate one of our callbacks running with `result` as promise result 0.
fn callback_at(result: PromiseResult, time: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract_id())
        .predecessor_account_id(contract_id())
        .block_timestamp(time)
        .prepaid_gas(Gas::from_tgas(300))
        .account_balance(NearToken::from_near(1_000_000));
    testing_env!(b.build(), test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![result]);
}

fn callback(result: PromiseResult) {
    callback_at(result, NOW);
}

fn setup() -> Contract {
    call(acc("deployer.near"));
    Contract::new(reviewer(), runner(), council(), HOUR)
}

fn verdict(approved: bool) -> Verdict {
    Verdict {
        approved,
        checks: vec![
            Check { name: "Allowed".into(), passed: approved },
            Check { name: "Clear".into(), passed: true },
        ],
        summary: if approved { "Looks good.".into() } else { "Asks for something harmful.".into() },
        receipt: "chatcmpl-123".into(),
        verified_signer: None,
    }
}

/// Deliver the reviewer's verdict through the yield callback.
fn answer_at(c: &mut Contract, subject: Subject, v: Option<Verdict>, time: u64) {
    callback_at(
        match v {
            Some(v) => PromiseResult::Successful(serde_json::to_vec(&v).unwrap()),
            None => PromiseResult::Failed,
        },
        time,
    );
    c.on_review(subject);
}

fn answer(c: &mut Contract, subject: Subject, v: Option<Verdict>) {
    answer_at(c, subject, v, NOW);
}

/// NEAR transfers created by the last call: (receiver, amount).
fn sent() -> Vec<(AccountId, u128)> {
    let mut out = vec![];
    for r in get_created_receipts() {
        for a in &r.actions {
            if let MockAction::Transfer { deposit, .. } = a {
                out.push((r.receiver_id.clone(), deposit.as_yoctonear()));
            }
        }
    }
    out
}

fn sent_to(who: &AccountId) -> u128 {
    sent().iter().filter(|(to, _)| to == who).map(|(_, a)| a).sum()
}

fn sent_total() -> u128 {
    sent().iter().map(|(_, a)| a).sum()
}

/// Storage a first-time funder pays.
fn funder_fee() -> u128 {
    env::storage_byte_cost().as_yoctonear() * FUNDER_STORAGE_BYTES as u128
}

fn post(c: &mut Contract, budget_near: u128) -> u64 {
    ctx(poster(), NOW, budget_near * NEAR);
    c.post_job("Wallet guide".into(), "Compare 3 NEAR wallets for beginners.".into(), NOW + 24 * HOUR)
}

fn open_job(c: &mut Contract, budget_near: u128) -> u64 {
    let id = post(c, budget_near);
    answer(c, Subject::Job(id), Some(verdict(true)));
    id
}

fn register(c: &mut Contract, id: &str, deposit: u128) {
    ctx(maker(), NOW, deposit);
    c.register_agent(
        id.into(),
        id.into(),
        HASH.into(),
        vec!["web_search".into()],
        U128(2 * NEAR),
        2_000,
        5_000,
    );
}

/// Register an agent with 5 NEAR, 2 NEAR max fuel per job, 20% refuel,
/// 50% creator cut, and approve it.
fn active_agent(c: &mut Contract, id: &str) {
    register(c, id, 5 * NEAR);
    answer(c, Subject::Agent(id.into()), Some(verdict(true)));
}

fn working_job(c: &mut Contract) -> u64 {
    active_agent(c, "scout");
    active_agent(c, "quill");
    let id = open_job(c, 10);
    call(runner());
    c.assign_crew(id, vec![("scout".into(), 4_000), ("quill".into(), 6_000)]);
    id
}

fn delivered(c: &mut Contract, passed: bool) -> u64 {
    let id = working_job(c);
    call(runner());
    c.deliver(id, HASH.into());
    call(reviewer());
    c.check_delivery(id, verdict(passed), None);
    id
}

fn has_event(name: &str) -> bool {
    get_logs().iter().any(|l| l.contains(&format!("\"event\":\"{name}\"")))
}

fn agent(c: &Contract, id: &str) -> Agent {
    c.get_agent(id.into()).unwrap()
}

fn job(c: &Contract, id: u64) -> Job {
    c.get_job(id).unwrap()
}

fn claimable(c: &Contract, agent_id: &str, who: AccountId) -> u128 {
    c.get_funder(agent_id.into(), who).claimable.0
}

// ----- Jobs -----------------------------------------------------------------

#[test]
fn post_job_holds_budget_and_waits_for_review() {
    let mut c = setup();
    let id = post(&mut c, 10);
    let job = job(&c, id);
    assert_eq!(job.status, JobStatus::InReview);
    assert_eq!(job.poster, poster());
    // Storage comes out of the attached NEAR, the rest is the budget.
    assert!(job.budget.0 < 10 * NEAR && job.budget.0 > 9 * NEAR);
    assert!(has_event("review_started"));
    assert!(has_event("job_posted"));
}

#[test]
#[should_panic(expected = "Attach at least")]
fn post_job_needs_more_than_storage() {
    let mut c = setup();
    ctx(poster(), NOW, MILLI);
    c.post_job("t".into(), "b".into(), NOW + HOUR);
}

#[test]
#[should_panic(expected = "Deadline must be in the future")]
fn post_job_rejects_past_deadline() {
    let mut c = setup();
    ctx(poster(), NOW, NEAR);
    c.post_job("t".into(), "b".into(), NOW - 1);
}

#[test]
#[should_panic(expected = "Title must be 1 to 120 characters")]
fn post_job_rejects_blank_title() {
    let mut c = setup();
    ctx(poster(), NOW, NEAR);
    c.post_job("   ".into(), "b".into(), NOW + HOUR);
}

#[test]
#[should_panic(expected = "Title must be 1 to 120 characters")]
fn post_job_rejects_long_title() {
    let mut c = setup();
    ctx(poster(), NOW, NEAR);
    c.post_job("x".repeat(121), "b".into(), NOW + HOUR);
}

#[test]
#[should_panic(expected = "Brief must be 1 to 2000 characters")]
fn post_job_rejects_blank_brief() {
    let mut c = setup();
    ctx(poster(), NOW, NEAR);
    c.post_job("t".into(), "".into(), NOW + HOUR);
}

#[test]
#[should_panic(expected = "Brief must be 1 to 2000 characters")]
fn post_job_rejects_long_brief() {
    let mut c = setup();
    ctx(poster(), NOW, NEAR);
    c.post_job("t".into(), "b".repeat(2_001), NOW + HOUR);
}

#[test]
fn job_ids_count_up_and_config_shows_them() {
    let mut c = setup();
    assert_eq!(post(&mut c, 1), 1);
    assert_eq!(post(&mut c, 1), 2);
    let cfg = c.get_config();
    assert_eq!(cfg.job_count, 2);
    assert_eq!(cfg.reviewer, reviewer());
    assert_eq!(cfg.runner, runner());
    assert_eq!(cfg.council, council());
    assert_eq!(cfg.release_after_ns, HOUR);
    assert_eq!(cfg.stale_after_ns, 7 * DAY);
    assert_eq!(cfg.agent_idle_retire_ns, 30 * DAY);
}

#[test]
fn approved_review_opens_job() {
    let mut c = setup();
    let id = open_job(&mut c, 3);
    let job = job(&c, id);
    assert_eq!(job.status, JobStatus::Open);
    assert_eq!(job.review.unwrap().receipt, "chatcmpl-123");
    assert!(sent().is_empty(), "nothing is paid out on approval");
}

#[test]
fn rejected_review_refunds_poster() {
    let mut c = setup();
    let id = post(&mut c, 3);
    let budget = job(&c, id).budget.0;
    answer(&mut c, Subject::Job(id), Some(verdict(false)));
    assert_eq!(sent(), vec![(poster(), budget)]);
    assert_eq!(job(&c, id).status, JobStatus::Rejected);
    assert!(has_event("job_refunded"));
}

#[test]
fn review_timeout_refunds_poster() {
    let mut c = setup();
    let id = post(&mut c, 3);
    let budget = job(&c, id).budget.0;
    answer(&mut c, Subject::Job(id), None);
    assert_eq!(sent(), vec![(poster(), budget)]);
    assert_eq!(job(&c, id).status, JobStatus::ReviewTimedOut);
    assert!(job(&c, id).review.is_none());
}

#[test]
fn garbage_review_answer_counts_as_timeout() {
    let mut c = setup();
    let id = post(&mut c, 3);
    callback(PromiseResult::Successful(b"not json".to_vec()));
    c.on_review(Subject::Job(id));
    assert_eq!(job(&c, id).status, JobStatus::ReviewTimedOut);
}

#[test]
fn second_review_answer_is_ignored() {
    let mut c = setup();
    let id = open_job(&mut c, 3);
    answer(&mut c, Subject::Job(id), Some(verdict(false)));
    assert_eq!(job(&c, id).status, JobStatus::Open);
    assert!(sent().is_empty(), "no second refund");
}

#[test]
fn review_for_unknown_subject_is_ignored() {
    let mut c = setup();
    answer(&mut c, Subject::Job(42), Some(verdict(true)));
    answer(&mut c, Subject::Agent("ghost".into()), Some(verdict(true)));
    assert!(c.get_job(42).is_none());
    assert!(c.get_agent("ghost".into()).is_none());
}

#[test]
#[should_panic(expected = "Only the reviewer")]
fn only_reviewer_can_answer() {
    let mut c = setup();
    let id = post(&mut c, 3);
    call(stranger());
    c.submit_review(Subject::Job(id), verdict(true), None);
}

#[test]
#[should_panic(expected = "No review is waiting")]
fn cannot_answer_unknown_review() {
    let mut c = setup();
    call(reviewer());
    c.submit_review(Subject::Job(99), verdict(true), None);
}

#[test]
#[should_panic(expected = "No review is waiting")]
fn cannot_answer_a_finished_review() {
    let mut c = setup();
    let id = open_job(&mut c, 3);
    call(reviewer());
    c.submit_review(Subject::Job(id), verdict(true), None);
}

#[test]
#[should_panic(expected = "An approval cannot include a failed check")]
fn approval_with_failed_check_is_invalid() {
    let mut c = setup();
    let id = post(&mut c, 3);
    let mut v = verdict(true);
    v.checks[0].passed = false;
    call(reviewer());
    c.submit_review(Subject::Job(id), v, None);
}

#[test]
#[should_panic(expected = "At most 8 checks")]
fn verdict_has_at_most_8_checks() {
    let mut c = setup();
    let id = post(&mut c, 3);
    let mut v = verdict(true);
    v.checks = (0..9).map(|i| Check { name: format!("c{i}"), passed: true }).collect();
    call(reviewer());
    c.submit_review(Subject::Job(id), v, None);
}

#[test]
#[should_panic(expected = "Check names must be 1 to 40 characters")]
fn verdict_check_names_are_short() {
    let mut c = setup();
    let id = post(&mut c, 3);
    let mut v = verdict(true);
    v.checks[0].name = "x".repeat(41);
    call(reviewer());
    c.submit_review(Subject::Job(id), v, None);
}

#[test]
#[should_panic(expected = "Summary is too long")]
fn verdict_summary_is_short() {
    let mut c = setup();
    let id = post(&mut c, 3);
    let mut v = verdict(true);
    v.summary = "x".repeat(401);
    call(reviewer());
    c.submit_review(Subject::Job(id), v, None);
}

#[test]
#[should_panic(expected = "Receipt is too long")]
fn verdict_receipt_is_short() {
    let mut c = setup();
    let id = post(&mut c, 3);
    let mut v = verdict(true);
    v.receipt = "x".repeat(129);
    call(reviewer());
    c.submit_review(Subject::Job(id), v, None);
}

#[test]
fn verdict_json_without_verified_signer_still_parses() {
    let v: Verdict =
        serde_json::from_str(r#"{"approved":true,"checks":[],"summary":"ok","receipt":"r"}"#).unwrap();
    assert_eq!(v.verified_signer, None);
}

#[test]
fn poster_can_cancel_open_job() {
    let mut c = setup();
    let id = open_job(&mut c, 3);
    let budget = job(&c, id).budget.0;
    call(poster());
    c.cancel_job(id);
    assert_eq!(sent(), vec![(poster(), budget)]);
    assert_eq!(job(&c, id).status, JobStatus::Refunded);
}

#[test]
#[should_panic(expected = "Only the poster can cancel")]
fn stranger_cannot_cancel() {
    let mut c = setup();
    let id = open_job(&mut c, 3);
    call(stranger());
    c.cancel_job(id);
}

#[test]
#[should_panic(expected = "Only open jobs can be cancelled")]
fn cannot_cancel_working_job() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(poster());
    c.cancel_job(id);
}

#[test]
#[should_panic(expected = "Only open jobs can be cancelled")]
fn cannot_cancel_job_in_review() {
    let mut c = setup();
    let id = post(&mut c, 3);
    call(poster());
    c.cancel_job(id);
}

#[test]
#[should_panic(expected = "Unknown job")]
fn unknown_job_panics() {
    let mut c = setup();
    call(poster());
    c.cancel_job(7);
}

#[test]
fn expired_job_refunds_and_frees_crew() {
    let mut c = setup();
    let id = working_job(&mut c);
    let budget = job(&c, id).budget.0;
    assert_eq!(agent(&c, "scout").busy_jobs, 1);
    ctx(stranger(), NOW + 25 * HOUR, 0);
    c.expire_job(id);
    assert_eq!(sent(), vec![(poster(), budget)]);
    assert_eq!(job(&c, id).status, JobStatus::Refunded);
    assert_eq!(agent(&c, "scout").busy_jobs, 0);
    assert_eq!(agent(&c, "quill").busy_jobs, 0);
}

#[test]
fn expire_open_job_after_deadline() {
    let mut c = setup();
    let id = open_job(&mut c, 3);
    ctx(stranger(), NOW + 24 * HOUR, 0);
    c.expire_job(id);
    assert_eq!(job(&c, id).status, JobStatus::Refunded);
}

#[test]
#[should_panic(expected = "Deadline has not passed")]
fn cannot_expire_early() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(stranger());
    c.expire_job(id);
}

#[test]
#[should_panic(expected = "Job is not open or in progress")]
fn cannot_expire_delivered_job() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    ctx(stranger(), NOW + 25 * HOUR, 0);
    c.expire_job(id);
}

#[test]
#[should_panic(expected = "Job is not open or in progress")]
fn cannot_expire_paid_job() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(poster());
    c.approve(id);
    ctx(stranger(), NOW + 25 * HOUR, 0);
    c.expire_job(id);
}

#[test]
#[should_panic(expected = "Job is not open or in progress")]
fn cannot_expire_twice() {
    let mut c = setup();
    let id = open_job(&mut c, 3);
    ctx(stranger(), NOW + 25 * HOUR, 0);
    c.expire_job(id);
    c.expire_job(id);
}

#[test]
fn failed_check_after_deadline_can_be_expired() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(runner());
    c.deliver(id, HASH.into());
    ctx(reviewer(), NOW + 25 * HOUR, 0);
    c.check_delivery(id, verdict(false), None);
    ctx(stranger(), NOW + 25 * HOUR, 0);
    c.expire_job(id);
    assert_eq!(job(&c, id).status, JobStatus::Refunded);
}

#[test]
fn list_jobs_newest_first() {
    let mut c = setup();
    let a = post(&mut c, 1);
    let b = post(&mut c, 1);
    let ids: Vec<u64> = c.list_jobs(None, None).iter().map(|j| j.id).collect();
    assert_eq!(ids, vec![b, a]);
    assert_eq!(c.list_jobs(Some(1), Some(5)).len(), 1);
}

#[test]
fn list_jobs_pages() {
    let mut c = setup();
    for _ in 0..5 {
        post(&mut c, 1);
    }
    let page =
        |from, limit| -> Vec<u64> { c.list_jobs(Some(from), Some(limit)).iter().map(|j| j.id).collect() };
    assert_eq!(page(0, 2), vec![5, 4]);
    assert_eq!(page(2, 2), vec![3, 2]);
    assert_eq!(page(4, 2), vec![1]);
    assert!(page(5, 2).is_empty());
    assert!(page(1_000, 2).is_empty());
    assert!(page(0, 0).is_empty());
}

#[test]
fn list_jobs_limit_is_capped() {
    let mut c = setup();
    for _ in 0..105 {
        post(&mut c, 1);
    }
    assert_eq!(c.list_jobs(None, Some(1_000)).len(), 100);
    assert_eq!(c.list_jobs(Some(100), None).len(), 5);
}

#[test]
fn unknown_job_view_is_none() {
    let c = setup();
    assert!(c.get_job(1).is_none());
    assert!(c.list_jobs(None, None).is_empty());
}

// ----- Agents ---------------------------------------------------------------

#[test]
fn register_agent_fills_fuel_and_waits_for_review() {
    let mut c = setup();
    ctx(maker(), NOW, 5 * NEAR);
    c.register_agent("scout".into(), "Scout".into(), HASH.into(), vec![], U128(NEAR), 0, 0);
    let a = agent(&c, "scout");
    assert_eq!(a.status, AgentStatus::InReview);
    assert!(a.fuel.0 > 4 * NEAR && a.fuel.0 < 5 * NEAR);
    assert_eq!(a.funded, a.fuel);
    assert_eq!(a.funders, 1);
    assert_eq!(a.total_shares.0, a.fuel.0 / MILLI);
    assert_eq!(a.owner, maker());
    assert!(has_event("agent_registered"));
    answer(&mut c, Subject::Agent("scout".into()), Some(verdict(true)));
    assert_eq!(agent(&c, "scout").status, AgentStatus::Active);
    assert_eq!(c.get_config().agent_count, 1);
}

#[test]
fn rejected_agent_gets_fuel_back() {
    let mut c = setup();
    ctx(maker(), NOW, 5 * NEAR);
    c.register_agent("sneaky".into(), "Sneaky".into(), HASH.into(), vec![], U128(NEAR), 0, 0);
    let fuel = agent(&c, "sneaky").fuel.0;
    answer(&mut c, Subject::Agent("sneaky".into()), Some(verdict(false)));
    assert_eq!(sent(), vec![(maker(), fuel)]);
    let a = agent(&c, "sneaky");
    assert_eq!(a.status, AgentStatus::Rejected);
    assert_eq!(a.fuel.0, 0);
    assert_eq!(a.total_shares.0, 0);
    assert_eq!(c.get_funder("sneaky".into(), maker()).shares.0, 0);
}

#[test]
fn agent_review_timeout_returns_fuel() {
    let mut c = setup();
    register(&mut c, "slow", 3 * NEAR);
    let fuel = agent(&c, "slow").fuel.0;
    answer(&mut c, Subject::Agent("slow".into()), None);
    assert_eq!(sent(), vec![(maker(), fuel)]);
    let a = agent(&c, "slow");
    assert_eq!(a.status, AgentStatus::ReviewTimedOut);
    assert_eq!(a.fuel.0, 0);
    assert_eq!(a.funders, 0);
}

#[test]
fn second_agent_review_is_ignored() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    answer(&mut c, Subject::Agent("scout".into()), None);
    assert_eq!(agent(&c, "scout").status, AgentStatus::Active);
    assert!(sent().is_empty());
}

#[test]
#[should_panic(expected = "That handle is taken")]
fn handles_are_unique() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    active_agent(&mut c, "scout");
}

#[test]
#[should_panic(expected = "Handle may only contain")]
fn handle_must_be_simple() {
    let mut c = setup();
    ctx(maker(), NOW, NEAR);
    c.register_agent("Bad Name".into(), "x".into(), HASH.into(), vec![], U128(NEAR), 0, 0);
}

#[test]
#[should_panic(expected = "Handle must be 3 to 32 characters")]
fn handle_length_is_checked() {
    let mut c = setup();
    ctx(maker(), NOW, NEAR);
    c.register_agent("ab".into(), "x".into(), HASH.into(), vec![], U128(NEAR), 0, 0);
}

#[test]
#[should_panic(expected = "spec_hash must be 64 hex characters")]
fn spec_hash_is_checked() {
    let mut c = setup();
    ctx(maker(), NOW, NEAR);
    c.register_agent("scout".into(), "x".into(), "abc".into(), vec![], U128(NEAR), 0, 0);
}

#[test]
#[should_panic(expected = "Name must be 1 to 40 characters")]
fn agent_name_is_checked() {
    let mut c = setup();
    ctx(maker(), NOW, NEAR);
    c.register_agent("scout".into(), "x".repeat(41), HASH.into(), vec![], U128(NEAR), 0, 0);
}

#[test]
#[should_panic(expected = "At most 8 tools")]
fn at_most_8_tools() {
    let mut c = setup();
    ctx(maker(), NOW, NEAR);
    let tools = (0..9).map(|i| format!("t{i}")).collect();
    c.register_agent("scout".into(), "x".into(), HASH.into(), tools, U128(NEAR), 0, 0);
}

#[test]
#[should_panic(expected = "Tool names must be 1 to 32 characters")]
fn tool_names_are_checked() {
    let mut c = setup();
    ctx(maker(), NOW, NEAR);
    c.register_agent("scout".into(), "x".into(), HASH.into(), vec!["".into()], U128(NEAR), 0, 0);
}

#[test]
#[should_panic(expected = "max_fuel_per_job must be positive")]
fn max_fuel_must_be_positive() {
    let mut c = setup();
    ctx(maker(), NOW, NEAR);
    c.register_agent("scout".into(), "x".into(), HASH.into(), vec![], U128(0), 0, 0);
}

#[test]
#[should_panic(expected = "refuel_bps must be 0 to 10000")]
fn refuel_bps_is_checked() {
    let mut c = setup();
    ctx(maker(), NOW, NEAR);
    c.register_agent("scout".into(), "x".into(), HASH.into(), vec![], U128(NEAR), 10_001, 0);
}

#[test]
#[should_panic(expected = "creator_bps must be 0 to 10000")]
fn creator_bps_is_checked() {
    let mut c = setup();
    ctx(maker(), NOW, NEAR);
    c.register_agent("scout".into(), "x".into(), HASH.into(), vec![], U128(NEAR), 0, 10_001);
}

#[test]
#[should_panic(expected = "Attach at least")]
fn agent_needs_minimum_fuel() {
    let mut c = setup();
    ctx(maker(), NOW, 50 * MILLI);
    c.register_agent("scout".into(), "x".into(), HASH.into(), vec![], U128(NEAR), 0, 0);
}

#[test]
fn anyone_can_fund_an_active_agent() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    let before = agent(&c, "scout");
    ctx(fan(), NOW, 3 * NEAR);
    c.fund_agent("scout".into());
    let after = agent(&c, "scout");
    // A first-time funder pays a little for their record's storage.
    let added = 3 * NEAR - funder_fee();
    assert_eq!(after.fuel.0, before.fuel.0 + added);
    assert_eq!(after.funded.0, before.funded.0 + added);
    assert_eq!(after.funders, 2);
    assert_eq!(c.get_funder("scout".into(), fan()).shares.0, added / MILLI);
    assert_eq!(after.total_shares.0, before.total_shares.0 + added / MILLI);
    assert!(has_event("agent_funded"));
}

#[test]
fn repeat_funding_pays_no_storage() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    ctx(fan(), NOW, NEAR);
    c.fund_agent("scout".into());
    let before = agent(&c, "scout").fuel.0;
    ctx(fan(), NOW, MILLI);
    c.fund_agent("scout".into());
    assert_eq!(agent(&c, "scout").fuel.0, before + MILLI);
    assert_eq!(agent(&c, "scout").funders, 2);
}

#[test]
#[should_panic(expected = "Attach at least 0.001 NEAR")]
fn new_funder_must_cover_storage() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    ctx(fan(), NOW, MILLI);
    c.fund_agent("scout".into());
}

#[test]
#[should_panic(expected = "Agent is not accepting funding")]
fn cannot_fund_agent_in_review() {
    let mut c = setup();
    ctx(maker(), NOW, NEAR);
    c.register_agent("scout".into(), "x".into(), HASH.into(), vec![], U128(NEAR), 0, 0);
    ctx(fan(), NOW, NEAR);
    c.fund_agent("scout".into());
}

#[test]
#[should_panic(expected = "Agent is on a job")]
fn cannot_fund_busy_agent() {
    let mut c = setup();
    working_job(&mut c);
    ctx(fan(), NOW, NEAR);
    c.fund_agent("scout".into());
}

#[test]
#[should_panic(expected = "Unknown agent")]
fn cannot_fund_unknown_agent() {
    let mut c = setup();
    ctx(fan(), NOW, NEAR);
    c.fund_agent("ghost".into());
}

#[test]
#[should_panic(expected = "Agent is not accepting funding")]
fn cannot_fund_retired_agent() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    call(maker());
    c.retire_agent("scout".into());
    ctx(fan(), NOW, NEAR);
    c.fund_agent("scout".into());
}

#[test]
fn list_agents_pages() {
    let mut c = setup();
    for id in ["aaa", "bbb", "ccc", "ddd"] {
        active_agent(&mut c, id);
    }
    let ids = |from, limit| -> Vec<String> {
        c.list_agents(Some(from), Some(limit)).into_iter().map(|a| a.id).collect()
    };
    assert_eq!(ids(0, 2), vec!["aaa", "bbb"]);
    assert_eq!(ids(2, 2), vec!["ccc", "ddd"]);
    assert!(ids(4, 2).is_empty());
    assert_eq!(c.list_agents(None, None).len(), 4);
    assert!(c.get_agent("nope".into()).is_none());
}

// ----- Work -----------------------------------------------------------------

#[test]
fn runner_assigns_crew() {
    let mut c = setup();
    let id = working_job(&mut c);
    let job = job(&c, id);
    assert_eq!(job.status, JobStatus::Working);
    assert_eq!(job.crew.len(), 2);
    assert_eq!(job.crew[0].share_bps, 4_000);
    assert_eq!(agent(&c, "scout").busy_jobs, 1);
    assert!(has_event("crew_assigned"));
}

#[test]
#[should_panic(expected = "Only the runner")]
fn only_runner_assigns_crew() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    let id = open_job(&mut c, 3);
    call(stranger());
    c.assign_crew(id, vec![("scout".into(), 10_000)]);
}

#[test]
#[should_panic(expected = "Crew shares must add up to 10000")]
fn crew_shares_must_total_100_percent() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    let id = open_job(&mut c, 3);
    call(runner());
    c.assign_crew(id, vec![("scout".into(), 9_000)]);
}

#[test]
#[should_panic(expected = "Crew must be 1 to 5 agents")]
fn crew_cannot_be_empty() {
    let mut c = setup();
    let id = open_job(&mut c, 3);
    call(runner());
    c.assign_crew(id, vec![]);
}

#[test]
#[should_panic(expected = "Crew must be 1 to 5 agents")]
fn crew_at_most_5() {
    let mut c = setup();
    let id = open_job(&mut c, 3);
    call(runner());
    let crew = (0..6).map(|i| (format!("a{i}x"), if i == 0 { 5_000 } else { 1_000 })).collect();
    c.assign_crew(id, crew);
}

#[test]
#[should_panic(expected = "Every crew member needs a share")]
fn crew_member_needs_share() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    active_agent(&mut c, "quill");
    let id = open_job(&mut c, 3);
    call(runner());
    c.assign_crew(id, vec![("scout".into(), 10_000), ("quill".into(), 0)]);
}

#[test]
#[should_panic(expected = "An agent can only appear once in a crew")]
fn crew_has_no_duplicates() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    let id = open_job(&mut c, 3);
    call(runner());
    c.assign_crew(id, vec![("scout".into(), 5_000), ("scout".into(), 5_000)]);
}

#[test]
#[should_panic(expected = "Unknown agent")]
fn crew_agents_must_exist() {
    let mut c = setup();
    let id = open_job(&mut c, 3);
    call(runner());
    c.assign_crew(id, vec![("ghost".into(), 10_000)]);
}

#[test]
#[should_panic(expected = "Every crew agent must be active")]
fn crew_must_be_reviewed() {
    let mut c = setup();
    ctx(maker(), NOW, NEAR);
    c.register_agent("fresh".into(), "x".into(), HASH.into(), vec![], U128(NEAR), 0, 0);
    let id = open_job(&mut c, 3);
    call(runner());
    c.assign_crew(id, vec![("fresh".into(), 10_000)]);
}

#[test]
#[should_panic(expected = "Every crew agent must be active")]
fn retired_agent_cannot_join_crew() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    call(maker());
    c.retire_agent("scout".into());
    let id = open_job(&mut c, 3);
    call(runner());
    c.assign_crew(id, vec![("scout".into(), 10_000)]);
}

#[test]
#[should_panic(expected = "Job is not open")]
fn cannot_assign_crew_before_review() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    let id = post(&mut c, 3);
    call(runner());
    c.assign_crew(id, vec![("scout".into(), 10_000)]);
}

#[test]
#[should_panic(expected = "Job is not open")]
fn cannot_assign_crew_twice() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(runner());
    c.assign_crew(id, vec![("scout".into(), 10_000)]);
}

#[test]
#[should_panic(expected = "Job deadline has passed")]
fn cannot_assign_crew_after_deadline() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    let id = open_job(&mut c, 3);
    ctx(runner(), NOW + 24 * HOUR, 0);
    c.assign_crew(id, vec![("scout".into(), 10_000)]);
}

#[test]
fn fuel_is_charged_with_receipt() {
    let mut c = setup();
    let id = working_job(&mut c);
    let fuel = agent(&c, "scout").fuel.0;
    call(runner());
    c.charge_fuel(id, "scout".into(), U128(MILLI * 50), "chatcmpl-abc".into());
    assert_eq!(agent(&c, "scout").fuel.0, fuel - MILLI * 50);
    assert_eq!(job(&c, id).crew[0].fuel_used.0, MILLI * 50);
    assert_eq!(c.get_config().runner_fuel_earned.0, MILLI * 50);
    assert!(get_logs().iter().any(|l| l.contains("chatcmpl-abc")));
}

#[test]
#[should_panic(expected = "Over this agent's fuel limit for one job")]
fn fuel_charge_is_capped_per_job() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(runner());
    c.charge_fuel(id, "scout".into(), U128(NEAR + MILLI), "r1".into());
    c.charge_fuel(id, "scout".into(), U128(NEAR), "r2".into());
}

#[test]
fn fuel_cap_resets_for_each_job() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    let a = open_job(&mut c, 3);
    let b = open_job(&mut c, 3);
    call(runner());
    c.assign_crew(a, vec![("scout".into(), 10_000)]);
    c.assign_crew(b, vec![("scout".into(), 10_000)]);
    c.charge_fuel(a, "scout".into(), U128(2 * NEAR), "r1".into());
    c.charge_fuel(b, "scout".into(), U128(2 * NEAR), "r2".into());
    assert_eq!(c.get_config().runner_fuel_earned.0, 4 * NEAR);
    assert_eq!(agent(&c, "scout").busy_jobs, 2);
}

#[test]
#[should_panic(expected = "Fuel for one job cannot exceed its budget")]
fn fuel_for_a_job_cannot_exceed_its_budget() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    active_agent(&mut c, "quill");
    let id = open_job(&mut c, 2);
    let budget = job(&c, id).budget.0;
    call(runner());
    c.assign_crew(id, vec![("scout".into(), 5_000), ("quill".into(), 5_000)]);
    c.charge_fuel(id, "scout".into(), U128(budget / 2 + 1), "r1".into());
    c.charge_fuel(id, "quill".into(), U128(budget / 2), "r2".into());
}

#[test]
#[should_panic(expected = "Not enough fuel")]
fn cannot_charge_more_than_the_tank() {
    let mut c = setup();
    ctx(maker(), NOW, 200 * MILLI);
    c.register_agent("tiny".into(), "x".into(), HASH.into(), vec![], U128(NEAR), 0, 0);
    answer(&mut c, Subject::Agent("tiny".into()), Some(verdict(true)));
    let id = open_job(&mut c, 3);
    call(runner());
    c.assign_crew(id, vec![("tiny".into(), 10_000)]);
    c.charge_fuel(id, "tiny".into(), U128(200 * MILLI), "r".into());
}

#[test]
#[should_panic(expected = "Amount must be positive")]
fn charge_must_be_positive() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(runner());
    c.charge_fuel(id, "scout".into(), U128(0), "r".into());
}

#[test]
#[should_panic(expected = "Receipt must be 1 to 128 characters")]
fn charge_needs_a_receipt() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(runner());
    c.charge_fuel(id, "scout".into(), U128(MILLI), "".into());
}

#[test]
#[should_panic(expected = "Receipt must be 1 to 128 characters")]
fn charge_receipt_is_short() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(runner());
    c.charge_fuel(id, "scout".into(), U128(MILLI), "r".repeat(129));
}

#[test]
#[should_panic(expected = "Job is not in progress")]
fn cannot_charge_delivered_job() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(runner());
    c.charge_fuel(id, "scout".into(), U128(MILLI), "r".into());
}

#[test]
#[should_panic(expected = "Agent is not in this job's crew")]
fn cannot_charge_agent_outside_crew() {
    let mut c = setup();
    let id = working_job(&mut c);
    active_agent(&mut c, "lens");
    call(runner());
    c.charge_fuel(id, "lens".into(), U128(MILLI), "r".into());
}

#[test]
#[should_panic(expected = "Only the runner")]
fn only_runner_charges_fuel() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(stranger());
    c.charge_fuel(id, "scout".into(), U128(MILLI), "r".into());
}

#[test]
fn runner_withdraws_fuel_it_was_paid() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(runner());
    c.charge_fuel(id, "scout".into(), U128(MILLI), "r".into());
    call(runner());
    let _ = c.runner_withdraw();
    assert_eq!(sent(), vec![(runner(), MILLI)]);
    assert_eq!(c.get_config().runner_fuel_earned.0, 0);
}

#[test]
#[should_panic(expected = "Nothing to withdraw")]
fn runner_withdraw_needs_balance() {
    let mut c = setup();
    call(runner());
    let _ = c.runner_withdraw();
}

#[test]
#[should_panic(expected = "Only the runner")]
fn only_runner_withdraws() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(runner());
    c.charge_fuel(id, "scout".into(), U128(MILLI), "r".into());
    call(stranger());
    let _ = c.runner_withdraw();
}

// ----- Delivery and pay -----------------------------------------------------

#[test]
#[should_panic(expected = "Result hash must be 64 hex characters")]
fn result_hash_is_checked() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(runner());
    c.deliver(id, "zz".into());
}

#[test]
#[should_panic(expected = "Only the runner")]
fn only_runner_delivers() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(poster());
    c.deliver(id, HASH.into());
}

#[test]
#[should_panic(expected = "Job deadline has passed")]
fn cannot_deliver_after_deadline() {
    let mut c = setup();
    let id = working_job(&mut c);
    ctx(runner(), NOW + 24 * HOUR, 0);
    c.deliver(id, HASH.into());
}

#[test]
#[should_panic(expected = "Job is not in progress")]
fn cannot_deliver_open_job() {
    let mut c = setup();
    let id = open_job(&mut c, 3);
    call(runner());
    c.deliver(id, HASH.into());
}

#[test]
fn delivery_records_time() {
    let mut c = setup();
    let id = working_job(&mut c);
    ctx(runner(), NOW + 5, 0);
    c.deliver(id, HASH.into());
    let j = job(&c, id);
    assert_eq!(j.status, JobStatus::Delivered);
    assert_eq!(j.delivered_at_ns, Some(NOW + 5));
    assert_eq!(j.result_hash.as_deref(), Some(HASH));
}

#[test]
fn failed_check_sends_job_back_to_crew() {
    let mut c = setup();
    let id = delivered(&mut c, false);
    let job = job(&c, id);
    assert_eq!(job.status, JobStatus::Working);
    assert!(job.release_at_ns.is_none());
    assert!(!job.result_check.unwrap().approved);
}

#[test]
fn crew_can_fix_and_redeliver() {
    let mut c = setup();
    let id = delivered(&mut c, false);
    call(runner());
    c.deliver(id, HASH.into());
    assert!(job(&c, id).result_check.is_none());
    call(reviewer());
    c.check_delivery(id, verdict(true), None);
    assert_eq!(job(&c, id).release_at_ns, Some(NOW + HOUR));
}

#[test]
#[should_panic(expected = "Only the reviewer")]
fn only_reviewer_checks_delivery() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(runner());
    c.deliver(id, HASH.into());
    call(poster());
    c.check_delivery(id, verdict(true), None);
}

#[test]
#[should_panic(expected = "Delivery already checked")]
fn delivery_is_checked_once() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(reviewer());
    c.check_delivery(id, verdict(false), None);
}

#[test]
#[should_panic(expected = "No delivery to check")]
fn cannot_check_without_delivery() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(reviewer());
    c.check_delivery(id, verdict(true), None);
}

#[test]
#[should_panic(expected = "Nothing delivered yet")]
fn cannot_approve_after_failed_check() {
    let mut c = setup();
    let id = delivered(&mut c, false);
    call(poster());
    c.approve(id);
}

#[test]
fn poster_approves_and_crew_is_paid() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    let budget = job(&c, id).budget.0;
    let scout_fuel = agent(&c, "scout").fuel.0;
    call(poster());
    c.approve(id);
    assert_eq!(job(&c, id).status, JobStatus::Paid);

    // Scout's 40% share: 20% refuels its tank, the rest is half creator, half funders.
    let pay = budget * 4_000 / 10_000;
    let scout = agent(&c, "scout");
    assert_eq!(scout.earned.0, pay);
    assert_eq!(scout.fuel.0, scout_fuel + pay / 5);
    assert_eq!(scout.jobs_done, 1);
    assert_eq!(scout.busy_jobs, 0);
    // Quill takes the rest, so nothing is lost to rounding.
    let quill = agent(&c, "quill");
    assert_eq!(quill.earned.0 + scout.earned.0, budget);
    assert!(has_event("job_paid"));
    // Nothing goes back to the poster on a full approval.
    assert_eq!(sent_to(&poster()), 0);
}

#[test]
fn poster_may_approve_before_the_check() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(runner());
    c.deliver(id, HASH.into());
    call(poster());
    c.approve(id);
    assert_eq!(job(&c, id).status, JobStatus::Paid);
}

#[test]
#[should_panic(expected = "Nothing delivered yet")]
fn cannot_approve_twice() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(poster());
    c.approve(id);
    c.approve(id);
}

#[test]
#[should_panic(expected = "Nothing delivered yet")]
fn cannot_release_after_approval() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(poster());
    c.approve(id);
    ctx(stranger(), NOW + 2 * HOUR, 0);
    c.release(id);
}

#[test]
fn funders_share_earnings_by_stake() {
    let mut c = setup();
    active_agent(&mut c, "scout"); // bob funds ~5 NEAR at registration
    active_agent(&mut c, "quill");
    let bob_shares = c.get_funder("scout".into(), maker()).shares.0;
    ctx(fan(), NOW, bob_shares * MILLI + funder_fee()); // carol matches bob exactly
    c.fund_agent("scout".into());
    assert_eq!(c.get_funder("scout".into(), fan()).shares.0, bob_shares);
    let id = open_job(&mut c, 10);
    call(runner());
    c.assign_crew(id, vec![("scout".into(), 10_000)]);
    c.deliver(id, HASH.into());
    call(reviewer());
    c.check_delivery(id, verdict(true), None);
    call(poster());
    c.approve(id);

    let budget = job(&c, id).budget.0;
    let to_funders = (budget - budget / 5) / 2;
    let bob = claimable(&c, "scout", maker());
    let carol = claimable(&c, "scout", fan());
    assert_eq!(bob, carol);
    assert!(to_funders - (bob + carol) < 2 * bob_shares, "only rounding dust is left");

    call(fan());
    let _ = c.claim_earnings("scout".into());
    assert_eq!(sent(), vec![(fan(), carol)]);
    assert_eq!(claimable(&c, "scout", fan()), 0);
    assert_eq!(claimable(&c, "scout", maker()), bob);
}

#[test]
#[should_panic(expected = "Nothing to claim")]
fn cannot_claim_twice() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(poster());
    c.approve(id);
    call(maker());
    let _ = c.claim_earnings("scout".into());
    let _ = c.claim_earnings("scout".into());
}

#[test]
#[should_panic(expected = "Not a funder")]
fn stranger_has_no_earnings() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    call(stranger());
    let _ = c.claim_earnings("scout".into());
}

#[test]
fn payment_releases_itself_after_wait() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    ctx(stranger(), NOW + HOUR, 0);
    c.release(id);
    assert_eq!(job(&c, id).status, JobStatus::Paid);
}

#[test]
#[should_panic(expected = "Release time has not come yet")]
fn cannot_release_early() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(stranger());
    c.release(id);
}

#[test]
#[should_panic(expected = "Work has not passed its check")]
fn cannot_release_unchecked_work() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(runner());
    c.deliver(id, HASH.into());
    ctx(stranger(), NOW + 7 * DAY - 1, 0);
    c.release(id);
}

#[test]
#[should_panic(expected = "Nothing delivered yet")]
fn cannot_release_working_job() {
    let mut c = setup();
    let id = working_job(&mut c);
    ctx(stranger(), NOW + 30 * DAY, 0);
    c.release(id);
}

#[test]
fn never_checked_delivery_settles_half_and_half() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(runner());
    c.deliver(id, HASH.into());
    let budget = job(&c, id).budget.0;
    ctx(stranger(), NOW + 7 * DAY, 0);
    c.release(id);
    let j = job(&c, id);
    assert_eq!(j.status, JobStatus::Split);
    assert_eq!(sent_to(&poster()), budget - budget / 2);
    assert_eq!(agent(&c, "scout").earned.0 + agent(&c, "quill").earned.0, budget / 2);
    assert!(has_event("job_stale"));
}

#[test]
#[should_panic(expected = "Only the poster can approve")]
fn only_poster_approves() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(stranger());
    c.approve(id);
}

#[test]
#[should_panic(expected = "Only the poster can dispute")]
fn only_poster_disputes() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(stranger());
    c.dispute(id);
}

#[test]
#[should_panic(expected = "Nothing delivered to dispute")]
fn cannot_dispute_working_job() {
    let mut c = setup();
    let id = working_job(&mut c);
    call(poster());
    c.dispute(id);
}

#[test]
fn dispute_then_council_splits() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(poster());
    c.dispute(id);
    let j = job(&c, id);
    assert_eq!(j.status, JobStatus::Disputed);
    assert_eq!(j.disputed_at_ns, Some(NOW));
    call(council());
    c.resolve(id, 5_000);
    let job = job(&c, id);
    assert_eq!(job.status, JobStatus::Split);
    let earned = agent(&c, "scout").earned.0 + agent(&c, "quill").earned.0;
    assert_eq!(earned, job.budget.0 / 2);
    assert_eq!(sent_to(&poster()), job.budget.0 - job.budget.0 / 2);
}

#[test]
fn council_can_refund_in_full() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    let budget = job(&c, id).budget.0;
    call(poster());
    c.dispute(id);
    call(council());
    c.resolve(id, 0);
    assert_eq!(job(&c, id).status, JobStatus::Refunded);
    assert_eq!(sent(), vec![(poster(), budget)]);
    let scout = agent(&c, "scout");
    assert_eq!(scout.jobs_done, 0, "a full refund is not a job done");
    assert_eq!(scout.busy_jobs, 0);
    assert_eq!(scout.earned.0, 0);
}

#[test]
fn council_can_pay_crew_in_full() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(poster());
    c.dispute(id);
    call(council());
    c.resolve(id, 10_000);
    assert_eq!(job(&c, id).status, JobStatus::Paid);
    assert_eq!(sent_to(&poster()), 0);
}

#[test]
#[should_panic(expected = "crew_bps must be 0 to 10000")]
fn resolve_bps_is_checked() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(poster());
    c.dispute(id);
    call(council());
    c.resolve(id, 10_001);
}

#[test]
#[should_panic(expected = "Job is not disputed")]
fn council_cannot_touch_undisputed_jobs() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(council());
    c.resolve(id, 0);
}

#[test]
#[should_panic(expected = "Too late")]
fn cannot_dispute_after_release_time() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    ctx(poster(), NOW + HOUR, 0);
    c.dispute(id);
}

#[test]
#[should_panic(expected = "Only the council")]
fn only_council_resolves() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(poster());
    c.dispute(id);
    c.resolve(id, 10_000);
}

#[test]
#[should_panic(expected = "Nothing delivered yet")]
fn cannot_approve_disputed_job() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(poster());
    c.dispute(id);
    c.approve(id);
}

#[test]
fn silent_council_dispute_settles_half_and_half() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    let budget = job(&c, id).budget.0;
    call(poster());
    c.dispute(id);
    ctx(stranger(), NOW + 7 * DAY, 0);
    c.release(id);
    assert_eq!(job(&c, id).status, JobStatus::Split);
    assert_eq!(sent_to(&poster()), budget - budget / 2);
    assert_eq!(agent(&c, "scout").busy_jobs, 0);
}

#[test]
#[should_panic(expected = "The council still has time to decide")]
fn dispute_timeout_is_not_early() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(poster());
    c.dispute(id);
    ctx(stranger(), NOW + 7 * DAY - 1, 0);
    c.release(id);
}

#[test]
#[should_panic(expected = "Job is not disputed")]
fn council_cannot_resolve_after_timeout_settlement() {
    let mut c = setup();
    let id = delivered(&mut c, true);
    call(poster());
    c.dispute(id);
    ctx(stranger(), NOW + 7 * DAY, 0);
    c.release(id);
    call(council());
    c.resolve(id, 0);
}

// ----- Rounding ---------------------------------------------------------------

/// Budget = what the crew earned + what went back to the poster.
fn assert_budget_fully_split(c: &Contract, id: u64, crew: &[&str]) {
    let budget = job(c, id).budget.0;
    let earned: u128 = crew.iter().map(|a| agent(c, a).earned.0).sum();
    assert_eq!(earned + sent_to(&poster()), budget, "budget = crew pay + poster refund");
}

#[test]
fn odd_three_way_split_loses_nothing() {
    let mut c = setup();
    for id in ["aaa", "bbb", "ccc"] {
        active_agent(&mut c, id);
    }
    ctx(poster(), NOW, 7 * NEAR + 12_345);
    let id = c.post_job("t".into(), "b".into(), NOW + DAY);
    answer(&mut c, Subject::Job(id), Some(verdict(true)));
    call(runner());
    c.assign_crew(id, vec![("aaa".into(), 3_333), ("bbb".into(), 3_333), ("ccc".into(), 3_334)]);
    c.deliver(id, HASH.into());
    call(poster());
    c.approve(id);
    assert_budget_fully_split(&c, id, &["aaa", "bbb", "ccc"]);
    let budget = job(&c, id).budget.0;
    assert_eq!(agent(&c, "aaa").earned.0, budget * 3_333 / 10_000);
}

#[test]
fn odd_council_split_loses_nothing() {
    let mut c = setup();
    for id in ["aaa", "bbb", "ccc"] {
        active_agent(&mut c, id);
    }
    ctx(poster(), NOW, 3 * NEAR + 7);
    let id = c.post_job("t".into(), "b".into(), NOW + DAY);
    answer(&mut c, Subject::Job(id), Some(verdict(true)));
    call(runner());
    c.assign_crew(id, vec![("aaa".into(), 3_333), ("bbb".into(), 3_333), ("ccc".into(), 3_334)]);
    c.deliver(id, HASH.into());
    call(poster());
    c.dispute(id);
    call(council());
    c.resolve(id, 3_333);
    assert_budget_fully_split(&c, id, &["aaa", "bbb", "ccc"]);
}

#[test]
fn payout_parts_add_up_exactly() {
    // pay = refuel + owner part (creator cut + rounding dust) + funders' part.
    let mut c = setup();
    ctx(maker(), NOW, 3 * NEAR + 999);
    c.register_agent("odd".into(), "x".into(), HASH.into(), vec![], U128(NEAR), 3_333, 7_777);
    answer(&mut c, Subject::Agent("odd".into()), Some(verdict(true)));
    ctx(fan(), NOW, NEAR + 123_456);
    c.fund_agent("odd".into());
    let fuel0 = agent(&c, "odd").fuel.0;
    ctx(poster(), NOW, 5 * NEAR + 31);
    let id = c.post_job("t".into(), "b".into(), NOW + DAY);
    answer(&mut c, Subject::Job(id), Some(verdict(true)));
    call(runner());
    c.assign_crew(id, vec![("odd".into(), 10_000)]);
    c.deliver(id, HASH.into());
    call(poster());
    c.approve(id);
    let pay = job(&c, id).budget.0;
    let refuel = agent(&c, "odd").fuel.0 - fuel0;
    let to_owner = sent_to(&maker());
    let funders = claimable(&c, "odd", maker()) + claimable(&c, "odd", fan());
    assert_eq!(refuel + to_owner + funders, pay);
    assert_eq!(refuel, pay * 3_333 / 10_000);
}

// ----- Funders ----------------------------------------------------------------

fn run_paid_job(c: &mut Contract, agent_id: &str, budget_near: u128) -> u64 {
    let id = open_job(c, budget_near);
    call(runner());
    c.assign_crew(id, vec![(agent_id.into(), 10_000)]);
    c.deliver(id, HASH.into());
    call(poster());
    c.approve(id);
    id
}

#[test]
fn late_funder_gets_nothing_from_earlier_payout() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    run_paid_job(&mut c, "scout", 10);
    let bob_after_first = claimable(&c, "scout", maker());
    assert!(bob_after_first > 0);
    ctx(fan(), NOW, 5 * NEAR);
    c.fund_agent("scout".into());
    assert_eq!(claimable(&c, "scout", fan()), 0);
    run_paid_job(&mut c, "scout", 10);
    let carol = claimable(&c, "scout", fan());
    let bob = claimable(&c, "scout", maker());
    assert!(carol > 0, "carol earns from the second payout");
    assert!(bob - bob_after_first > carol / 2, "bob earned both times");
}

#[test]
fn funder_earnings_never_exceed_what_was_shared() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    for (who, amt) in [(fan(), 3 * NEAR + 17), (fan2(), 777 * MILLI + 5)] {
        ctx(who, NOW, amt);
        c.fund_agent("scout".into());
    }
    let id = run_paid_job(&mut c, "scout", 9);
    let pay = job(&c, id).budget.0;
    let to_funders = (pay - pay / 5) / 2; // 20% refuel, 50% creator
    let total: u128 = [maker(), fan(), fan2()].iter().map(|w| claimable(&c, "scout", w.clone())).sum();
    assert!(total <= to_funders);
    // What funders do not get went to the owner as rounding dust.
    assert_eq!(sent_to(&maker()) + total, pay - pay / 5);
}

#[test]
fn retire_after_earnings_pays_both_parts() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    ctx(fan(), NOW, 2 * NEAR);
    c.fund_agent("scout".into());
    run_paid_job(&mut c, "scout", 4);
    let carol_earned = claimable(&c, "scout", fan());
    let bob_earned = claimable(&c, "scout", maker());
    assert!(carol_earned > 0);
    let fuel = agent(&c, "scout").fuel.0;
    call(maker());
    c.retire_agent("scout".into());
    let owner_dust = sent_to(&maker());
    let carol = claimable(&c, "scout", fan());
    let bob = claimable(&c, "scout", maker());
    // Earnings stay, and the leftover fuel is added on top, to the yoctoNEAR.
    assert_eq!((carol - carol_earned) + (bob - bob_earned) + owner_dust, fuel);
    call(fan());
    let _ = c.claim_earnings("scout".into());
    assert_eq!(sent(), vec![(fan(), carol)]);
}

#[test]
fn retiring_shares_leftover_fuel_with_funders() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    ctx(fan(), NOW, 2 * NEAR + funder_fee());
    c.fund_agent("scout".into());
    let fuel = agent(&c, "scout").fuel.0;
    call(maker());
    c.retire_agent("scout".into());
    let a = agent(&c, "scout");
    assert_eq!(a.status, AgentStatus::Retired);
    assert_eq!(a.fuel.0, 0);
    let carol = claimable(&c, "scout", fan());
    let bob = claimable(&c, "scout", maker());
    // Carol put in 2 NEAR of ~7, so she gets ~2 NEAR back (shares are 0.001 NEAR units).
    assert!(carol > 2 * NEAR - MILLI && carol < 2 * NEAR + MILLI, "carol got {carol}");
    // Every yoctoNEAR of fuel is accounted for.
    assert_eq!(carol + bob + sent_to(&maker()), fuel);
    assert!(has_event("agent_retired"));
}

#[test]
#[should_panic(expected = "Agent is still on a job")]
fn cannot_retire_busy_agent() {
    let mut c = setup();
    working_job(&mut c);
    call(maker());
    c.retire_agent("scout".into());
}

#[test]
#[should_panic(expected = "Only the owner")]
fn stranger_cannot_retire_active_agent() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    ctx(stranger(), NOW + 30 * DAY - 1, 0);
    c.retire_agent("scout".into());
}

#[test]
fn anyone_can_retire_an_abandoned_agent() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    ctx(fan(), NOW, NEAR);
    c.fund_agent("scout".into());
    ctx(stranger(), NOW + 30 * DAY, 0);
    c.retire_agent("scout".into());
    assert_eq!(agent(&c, "scout").status, AgentStatus::Retired);
    assert!(claimable(&c, "scout", fan()) > 0);
    // The stranger gets nothing.
    assert_eq!(sent_to(&stranger()), 0);
}

#[test]
#[should_panic(expected = "Only the owner")]
fn work_resets_the_idle_clock() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    let id = open_job(&mut c, 3);
    ctx(runner(), NOW + 20 * HOUR, 0);
    c.assign_crew(id, vec![("scout".into(), 10_000)]);
    ctx(stranger(), NOW + 25 * HOUR, 0);
    c.expire_job(id);
    assert_eq!(agent(&c, "scout").last_active_ns, NOW + 25 * HOUR);
    ctx(stranger(), NOW + 30 * DAY + HOUR, 0);
    c.retire_agent("scout".into());
}

#[test]
#[should_panic(expected = "Only active agents can retire")]
fn cannot_retire_agent_in_review() {
    let mut c = setup();
    register(&mut c, "scout", NEAR);
    call(maker());
    c.retire_agent("scout".into());
}

#[test]
#[should_panic(expected = "Only active agents can retire")]
fn cannot_retire_twice() {
    let mut c = setup();
    active_agent(&mut c, "scout");
    call(maker());
    c.retire_agent("scout".into());
    c.retire_agent("scout".into());
}

#[test]
#[should_panic(expected = "Unknown agent")]
fn cannot_retire_unknown_agent() {
    let mut c = setup();
    call(maker());
    c.retire_agent("ghost".into());
}

// ----- Failed transfers and private callbacks --------------------------------

#[test]
fn failed_transfer_can_be_claimed() {
    let mut c = setup();
    callback(PromiseResult::Failed);
    assert!(!c.on_sent(poster(), U128(NEAR)));
    assert_eq!(c.owed_to(poster()).0, NEAR);
    call(poster());
    let _ = c.claim();
    assert_eq!(sent(), vec![(poster(), NEAR)]);
    assert_eq!(c.owed_to(poster()).0, 0);
}

#[test]
fn failed_transfers_add_up() {
    let mut c = setup();
    callback(PromiseResult::Failed);
    c.on_sent(poster(), U128(NEAR));
    callback(PromiseResult::Failed);
    c.on_sent(poster(), U128(5));
    assert_eq!(c.owed_to(poster()).0, NEAR + 5);
    assert_eq!(c.owed_to(stranger()).0, 0);
}

#[test]
fn failed_refund_after_rejection_is_claimable() {
    let mut c = setup();
    let id = post(&mut c, 3);
    let budget = job(&c, id).budget.0;
    answer(&mut c, Subject::Job(id), Some(verdict(false)));
    callback(PromiseResult::Failed);
    c.on_sent(poster(), U128(budget));
    assert_eq!(c.owed_to(poster()).0, budget);
}

#[test]
fn successful_transfer_owes_nothing() {
    let mut c = setup();
    callback(PromiseResult::Successful(vec![]));
    assert!(c.on_sent(poster(), U128(NEAR)));
    assert_eq!(c.owed_to(poster()).0, 0);
}

#[test]
#[should_panic(expected = "Nothing to claim")]
fn claim_needs_something_owed() {
    let mut c = setup();
    call(poster());
    let _ = c.claim();
}

// `#[private]` on `on_review` / `on_sent` is enforced by the exported wasm
// wrapper, which unit tests do not go through.

// ----- TEE proof ----------------------------------------------------------------
//
// Test vector made with a pure-Python (stdlib only) keccak256 + secp256k1
// EIP-191 signer, private key = sha256("guild test tee key") mod n.

const TEE_TEXT: &str = "deepseek-ai/DeepSeek-V3.1:ce714cbd5528b22732808afdb80c0bba0bfebd85bef963d58902e9310e9d6972:3bbf7fd3aa7f1684426a3c5ef4f99ead0c357a2a507d40b741dbef2d657d2abc";
const TEE_SIG: &str = "0x31753ff1b933ae25592e50b02f050eb2a31e2bd0c54405a1eb05eeee57f24c1d0aebecc10eeefdf134fa6f9b7e36c29d4970a1358c8c5cfe2370af88d65ecd2b1c";
const TEE_ADDR: &str = "0x7984041153f91e404aeeb0aa025742dcc739ca3d";
/// Address of private key 1, a different signer.
const OTHER_ADDR: &str = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";

fn proof() -> TeeProof {
    TeeProof { text: TEE_TEXT.into(), signature: TEE_SIG.into(), signing_address: TEE_ADDR.into() }
}

fn upper(addr: &str) -> String {
    format!("0x{}", addr[2..].to_uppercase())
}

fn with_signer(addr: &str) -> Contract {
    let mut c = setup();
    call(council());
    c.add_tee_signer(addr.into());
    c
}

fn delivered_unchecked(c: &mut Contract) -> u64 {
    let id = working_job(c);
    call(runner());
    c.deliver(id, HASH.into());
    id
}

#[test]
fn tee_proof_is_verified_and_saved() {
    let mut c = with_signer(TEE_ADDR);
    let id = delivered_unchecked(&mut c);
    call(reviewer());
    c.check_delivery(id, verdict(true), Some(proof()));
    assert_eq!(job(&c, id).result_check.unwrap().verified_signer.as_deref(), Some(TEE_ADDR));
}

/// The unit-test VM cannot resume a yield made in an earlier call, so the
/// call ends with "Review already timed out". Reaching that line proves the
/// proof was checked and accepted first.
#[test]
#[should_panic(expected = "Review already timed out")]
fn tee_proof_accepted_on_review() {
    let mut c = with_signer(TEE_ADDR);
    let id = post(&mut c, 3);
    call(reviewer());
    c.submit_review(Subject::Job(id), verdict(true), Some(proof()));
}

#[test]
#[should_panic(expected = "Unknown TEE signer")]
fn tee_proof_on_review_must_verify() {
    let mut c = setup();
    let id = post(&mut c, 3);
    call(reviewer());
    c.submit_review(Subject::Job(id), verdict(true), Some(proof()));
}

#[test]
fn tee_proof_accepts_mixed_case_and_v_0_1() {
    let mut c = with_signer(&upper(TEE_ADDR));
    let id = delivered_unchecked(&mut c);
    let mut p = proof();
    p.signing_address = upper(TEE_ADDR);
    p.signature = format!("{}01", &TEE_SIG[..TEE_SIG.len() - 2]); // v 28 written as 1
    call(reviewer());
    c.check_delivery(id, verdict(true), Some(p));
    assert_eq!(job(&c, id).result_check.unwrap().verified_signer.as_deref(), Some(TEE_ADDR));
}

#[test]
#[should_panic(expected = "Unknown TEE signer")]
fn tee_signer_must_be_approved() {
    let mut c = setup();
    let id = delivered_unchecked(&mut c);
    call(reviewer());
    c.check_delivery(id, verdict(true), Some(proof()));
}

#[test]
#[should_panic(expected = "TEE signature does not match the signer")]
fn tee_signature_over_other_text_fails() {
    let mut c = with_signer(TEE_ADDR);
    let id = delivered_unchecked(&mut c);
    let mut p = proof();
    p.text.push('x');
    call(reviewer());
    c.check_delivery(id, verdict(true), Some(p));
}

#[test]
#[should_panic(expected = "TEE signature does not match the signer")]
fn tee_signature_from_other_key_fails() {
    let mut c = with_signer(OTHER_ADDR);
    let id = delivered_unchecked(&mut c);
    let mut p = proof();
    p.signing_address = OTHER_ADDR.into();
    call(reviewer());
    c.check_delivery(id, verdict(true), Some(p));
}

#[test]
#[should_panic(expected = "Signature must be 65 bytes of hex")]
fn tee_signature_length_is_checked() {
    let mut c = with_signer(TEE_ADDR);
    let id = delivered_unchecked(&mut c);
    let mut p = proof();
    p.signature = TEE_SIG[..TEE_SIG.len() - 2].into();
    call(reviewer());
    c.check_delivery(id, verdict(true), Some(p));
}

#[test]
#[should_panic(expected = "Bad signature recovery byte")]
fn tee_signature_v_is_checked() {
    let mut c = with_signer(TEE_ADDR);
    let id = delivered_unchecked(&mut c);
    let mut p = proof();
    p.signature = format!("{}05", &TEE_SIG[..TEE_SIG.len() - 2]);
    call(reviewer());
    c.check_delivery(id, verdict(true), Some(p));
}

#[test]
#[should_panic(expected = "Proof text must be 1 to 512 characters")]
fn tee_text_is_checked() {
    let mut c = with_signer(TEE_ADDR);
    let id = delivered_unchecked(&mut c);
    let mut p = proof();
    p.text = String::new();
    call(reviewer());
    c.check_delivery(id, verdict(true), Some(p));
}

#[test]
fn caller_cannot_fake_verified_signer() {
    let mut c = setup();
    let id = delivered_unchecked(&mut c);
    let mut v = verdict(true);
    v.verified_signer = Some(TEE_ADDR.into());
    call(reviewer());
    c.check_delivery(id, v, None);
    assert_eq!(job(&c, id).result_check.unwrap().verified_signer, None);
}

#[test]
fn council_manages_tee_signers() {
    let mut c = with_signer(TEE_ADDR);
    call(council());
    c.add_tee_signer(upper(OTHER_ADDR));
    assert_eq!(c.tee_signers(), vec![TEE_ADDR.to_string(), OTHER_ADDR.to_string()]);
    c.remove_tee_signer(TEE_ADDR.into());
    assert_eq!(c.tee_signers(), vec![OTHER_ADDR.to_string()]);
    assert!(has_event("tee_signer_removed"));
}

#[test]
#[should_panic(expected = "Only the council")]
fn only_council_adds_signers() {
    let mut c = setup();
    call(reviewer());
    c.add_tee_signer(TEE_ADDR.into());
}

#[test]
#[should_panic(expected = "Only the council")]
fn only_council_removes_signers() {
    let mut c = with_signer(TEE_ADDR);
    call(stranger());
    c.remove_tee_signer(TEE_ADDR.into());
}

#[test]
#[should_panic(expected = "Signer already added")]
fn signer_added_once() {
    let mut c = with_signer(TEE_ADDR);
    call(council());
    c.add_tee_signer(TEE_ADDR.into());
}

#[test]
#[should_panic(expected = "Unknown signer")]
fn remove_unknown_signer() {
    let mut c = setup();
    call(council());
    c.remove_tee_signer(TEE_ADDR.into());
}

#[test]
#[should_panic(expected = "Address must be 0x followed by 40 hex characters")]
fn signer_address_is_checked() {
    let mut c = setup();
    call(council());
    c.add_tee_signer("0x1234".into());
}

#[test]
#[should_panic(expected = "At most 10 signers")]
fn signer_list_is_capped() {
    let mut c = setup();
    call(council());
    for i in 0..11 {
        c.add_tee_signer(format!("0x{:040x}", i + 1));
    }
}

// ----- Money invariants -------------------------------------------------------

/// A whole lifecycle: everything that came in (minus storage) either went out
/// again or is still held for someone, to the yoctoNEAR.
#[test]
fn full_lifecycle_balances_to_the_yocto() {
    let mut c = setup();
    let mut credited = 0u128;
    let mut out = 0u128;
    for id in ["aaa", "bbb", "ccc"] {
        active_agent(&mut c, id);
        credited += agent(&c, id).fuel.0;
    }
    ctx(fan(), NOW, 3 * NEAR + 11);
    let fuel = agent(&c, "aaa").fuel.0;
    c.fund_agent("aaa".into());
    credited += agent(&c, "aaa").fuel.0 - fuel;

    ctx(poster(), NOW, 9 * NEAR + 1);
    let id = c.post_job("t".into(), "b".into(), NOW + DAY);
    credited += job(&c, id).budget.0;
    answer(&mut c, Subject::Job(id), Some(verdict(true)));
    call(runner());
    c.assign_crew(id, vec![("aaa".into(), 3_333), ("bbb".into(), 3_333), ("ccc".into(), 3_334)]);
    c.charge_fuel(id, "aaa".into(), U128(17 * MILLI), "r1".into());
    c.charge_fuel(id, "ccc".into(), U128(3 * MILLI + 1), "r2".into());
    c.deliver(id, HASH.into());
    call(poster());
    c.dispute(id);
    call(council());
    c.resolve(id, 6_667);
    out += sent_total();
    call(runner());
    let _ = c.runner_withdraw();
    out += sent_total();
    for a in ["aaa", "bbb", "ccc"] {
        call(maker());
        c.retire_agent(a.into());
        out += sent_total();
        call(maker());
        let _ = c.claim_earnings(a.into());
        out += sent_total();
    }
    call(fan());
    let _ = c.claim_earnings("aaa".into());
    out += sent_total();
    assert_eq!(credited, out, "everything paid in has been paid out");
    assert_eq!(c.get_config().runner_fuel_earned.0, 0);
}

/// Tiny deterministic PRNG (xorshift64*), so the random test is repeatable.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
    fn chance(&mut self, pct: u64) -> bool {
        self.below(100) < pct
    }
    fn amount(&mut self, min: u128, max: u128) -> u128 {
        let r = ((self.next() as u128) << 64) | self.next() as u128;
        min + r % (max - min + 1)
    }
}

struct World {
    c: Contract,
    rng: Rng,
    now: u64,
    /// NEAR paid in and credited to someone (deposits minus storage).
    credited: u128,
    /// NEAR sent out by transfers that succeeded.
    out: u128,
    agents: Vec<String>,
    people: Vec<AccountId>,
    /// Fuel charged by the runner, and what it has withdrawn.
    charged: u128,
    runner_out: u128,
    /// Jobs that reached a final state, to check none is paid twice.
    finished: Vec<u64>,
}

impl World {
    fn at(&self, who: AccountId, deposit: u128) {
        ctx(who, self.now, deposit);
    }

    /// Count transfers made by the last call; fail some of them at random.
    fn settle(&mut self) {
        for (to, amount) in sent() {
            if self.rng.chance(10) {
                callback_at(PromiseResult::Failed, self.now);
                self.c.on_sent(to, U128(amount));
            } else {
                self.out += amount;
            }
        }
    }

    fn held(&self) -> u128 {
        let c = &self.c;
        let mut sum = c.get_config().runner_fuel_earned.0;
        for j in c.list_jobs(None, Some(100)) {
            if matches!(
                j.status,
                JobStatus::InReview
                    | JobStatus::Open
                    | JobStatus::Working
                    | JobStatus::Delivered
                    | JobStatus::Disputed
            ) {
                sum += j.budget.0;
            }
        }
        for a in &self.agents {
            sum += c.get_agent(a.clone()).unwrap().fuel.0;
            for p in &self.people {
                sum += c.get_funder(a.clone(), p.clone()).claimable.0;
            }
        }
        for p in &self.people {
            sum += c.owed_to(p.clone()).0;
        }
        sum
    }

    fn check(&self) {
        assert_eq!(self.credited - self.out, self.held(), "money in - money out = money held");
        assert_eq!(self.charged, self.c.get_config().runner_fuel_earned.0 + self.runner_out);
        for a in &self.agents {
            let a = self.c.get_agent(a.clone()).unwrap();
            let shares: u128 =
                self.people.iter().map(|p| self.c.get_funder(a.id.clone(), p.clone()).shares.0).sum();
            assert_eq!(shares, a.total_shares.0, "shares add up");
            assert!(a.status == AgentStatus::Active || a.busy_jobs == 0);
        }
    }

    fn active(&self) -> Vec<String> {
        self.agents
            .iter()
            .filter(|a| self.c.get_agent((*a).clone()).unwrap().status == AgentStatus::Active)
            .cloned()
            .collect()
    }

    fn random_claims(&mut self) {
        for a in self.agents.clone() {
            for p in self.people.clone() {
                if self.c.get_funder(a.clone(), p.clone()).claimable.0 > 0 && self.rng.chance(30) {
                    self.at(p.clone(), 0);
                    let _ = self.c.claim_earnings(a.clone());
                    self.settle();
                }
            }
        }
        for p in self.people.clone() {
            if self.c.owed_to(p.clone()).0 > 0 && self.rng.chance(50) {
                self.at(p.clone(), 0);
                let _ = self.c.claim();
                self.settle();
            }
        }
        let rf = self.c.get_config().runner_fuel_earned.0;
        if rf > 0 && self.rng.chance(30) {
            self.at(runner(), 0);
            let _ = self.c.runner_withdraw();
            self.runner_out += rf;
            self.settle();
        }
        self.check();
    }

    /// A job that is done must be in a final state, which every paying
    /// method refuses (see the `cannot_*_twice` tests).
    fn assert_finished(&mut self, id: u64) {
        let j = self.c.get_job(id).unwrap();
        assert!(matches!(
            j.status,
            JobStatus::Paid
                | JobStatus::Refunded
                | JobStatus::Split
                | JobStatus::Rejected
                | JobStatus::ReviewTimedOut
        ));
        self.finished.push(id);
    }
}

fn run_world(seed: u64) {
    // Start from empty storage for every world.
    call(acc("deployer.near"));
    near_sdk::mock::with_mocked_blockchain(|b| {
        b.take_storage();
    });
    let mut w = World {
        c: setup(),
        rng: Rng(seed),
        now: NOW,
        credited: 0,
        out: 0,
        agents: vec![],
        people: vec![poster(), maker(), fan(), fan2(), stranger(), runner()],
        charged: 0,
        runner_out: 0,
        finished: vec![],
    };
    // Agents.
    let n_agents = 2 + w.rng.below(3);
    for i in 0..n_agents {
        let id = format!("agent-{i}");
        let owner = w.people[1 + w.rng.below(3) as usize].clone();
        let deposit = w.rng.amount(150 * MILLI, 5 * NEAR);
        let max_fuel = w.rng.amount(MILLI, 2 * NEAR);
        let refuel = w.rng.below(10_001) as u16;
        let creator = w.rng.below(10_001) as u16;
        w.at(owner, deposit);
        w.c.register_agent(id.clone(), "A".into(), HASH.into(), vec![], U128(max_fuel), refuel, creator);
        w.credited += w.c.get_agent(id.clone()).unwrap().fuel.0;
        w.agents.push(id.clone());
        let v = match w.rng.below(10) {
            0 => None,
            1 => Some(verdict(false)),
            _ => Some(verdict(true)),
        };
        answer_at(&mut w.c, Subject::Agent(id), v, w.now);
        w.settle();
        w.check();
    }

    for _ in 0..6 {
        // Funders join while agents are idle.
        for a in w.active() {
            if w.rng.chance(40) {
                let who = w.people[w.rng.below(4) as usize + 1].clone();
                let amount = w.rng.amount(4 * MILLI, 3 * NEAR);
                let before = w.c.get_agent(a.clone()).unwrap().fuel.0;
                w.at(who, amount);
                w.c.fund_agent(a.clone());
                w.credited += w.c.get_agent(a.clone()).unwrap().fuel.0 - before;
                w.check();
            }
        }

        // A job.
        let deposit = w.rng.amount(200 * MILLI, 10 * NEAR);
        w.at(poster(), deposit);
        let id = w.c.post_job("t".into(), "b".into(), w.now + DAY);
        w.credited += w.c.get_job(id).unwrap().budget.0;
        w.check();
        let v = match w.rng.below(10) {
            0 => None,
            1 => Some(verdict(false)),
            _ => Some(verdict(true)),
        };
        answer_at(&mut w.c, Subject::Job(id), v, w.now);
        w.settle();
        w.check();
        let mut pool = w.active();
        if w.c.get_job(id).unwrap().status != JobStatus::Open {
            w.assert_finished(id);
            w.random_claims();
            continue;
        }
        if pool.is_empty() || w.rng.chance(10) {
            w.at(poster(), 0);
            w.c.cancel_job(id);
            w.settle();
            w.assert_finished(id);
            w.random_claims();
            continue;
        }

        // Crew with random shares that add up to 10000.
        let k = 1 + w.rng.below(pool.len().min(4) as u64) as usize;
        let mut crew = vec![];
        let mut left: u64 = 10_000;
        for i in 0..k {
            let pick = pool.remove(w.rng.below(pool.len() as u64) as usize);
            let share = if i + 1 == k { left } else { 1 + w.rng.below(left - (k - i - 1) as u64) };
            left -= share;
            crew.push((pick, share as u16));
        }
        w.at(runner(), 0);
        w.c.assign_crew(id, crew.clone());
        w.check();

        // Fuel charges within every cap.
        for _ in 0..w.rng.below(4) {
            let (a, _) = crew[w.rng.below(crew.len() as u64) as usize].clone();
            let j = w.c.get_job(id).unwrap();
            let used = j.crew.iter().find(|m| m.agent == a).unwrap().fuel_used.0;
            let job_used: u128 = j.crew.iter().map(|m| m.fuel_used.0).sum();
            let ag = w.c.get_agent(a.clone()).unwrap();
            let limit = (ag.max_fuel_per_job.0 - used).min(ag.fuel.0).min(j.budget.0 - job_used);
            if limit == 0 {
                continue;
            }
            let amount = w.rng.amount(1, limit);
            w.at(runner(), 0);
            w.c.charge_fuel(id, a, U128(amount), "chatcmpl-x".into());
            w.charged += amount;
            w.check();
        }

        let deadline = w.c.get_job(id).unwrap().deadline_ns;
        match w.rng.below(10) {
            0 => {
                // Nobody delivers: refund after the deadline.
                w.now = deadline;
                w.at(stranger(), 0);
                w.c.expire_job(id);
            }
            1 => {
                // Delivered but never checked, poster silent: 50/50 after a week.
                w.at(runner(), 0);
                w.c.deliver(id, HASH.into());
                w.now += 7 * DAY;
                w.at(stranger(), 0);
                w.c.release(id);
            }
            _ => {
                w.at(runner(), 0);
                w.c.deliver(id, HASH.into());
                let mut expired = false;
                if w.rng.chance(25) {
                    w.at(reviewer(), 0);
                    w.c.check_delivery(id, verdict(false), None);
                    if w.rng.chance(50) {
                        w.now = deadline;
                        w.at(stranger(), 0);
                        w.c.expire_job(id);
                        expired = true;
                    } else {
                        w.at(runner(), 0);
                        w.c.deliver(id, HASH.into());
                    }
                }
                if !expired {
                    w.at(reviewer(), 0);
                    w.c.check_delivery(id, verdict(true), None);
                    match w.rng.below(5) {
                        0 => {
                            w.at(poster(), 0);
                            w.c.approve(id);
                        }
                        1 => {
                            w.now += HOUR;
                            w.at(stranger(), 0);
                            w.c.release(id);
                        }
                        2 => {
                            w.at(poster(), 0);
                            w.c.dispute(id);
                            w.now += 7 * DAY;
                            w.at(stranger(), 0);
                            w.c.release(id);
                        }
                        _ => {
                            w.at(poster(), 0);
                            w.c.dispute(id);
                            let bps = match w.rng.below(4) {
                                0 => 0,
                                1 => 10_000,
                                _ => w.rng.below(10_001) as u16,
                            };
                            w.at(council(), 0);
                            w.c.resolve(id, bps);
                        }
                    }
                }
            }
        }
        w.settle();
        w.check();
        w.assert_finished(id);
        for (a, _) in &crew {
            assert_eq!(w.c.get_agent(a.clone()).unwrap().busy_jobs, 0);
        }
        w.now += HOUR;
        w.random_claims();
    }

    // Wind down: strangers retire every agent after the idle time, then
    // everyone claims everything.
    w.now += 31 * DAY;
    for a in w.active() {
        w.at(stranger(), 0);
        w.c.retire_agent(a);
        w.settle();
        w.check();
    }
    for a in w.agents.clone() {
        for p in w.people.clone() {
            if w.c.get_funder(a.clone(), p.clone()).claimable.0 > 0 {
                w.at(p, 0);
                let _ = w.c.claim_earnings(a.clone());
                w.out += sent_total();
            }
        }
    }
    for p in w.people.clone() {
        if w.c.owed_to(p.clone()).0 > 0 {
            w.at(p, 0);
            let _ = w.c.claim();
            w.out += sent_total();
        }
    }
    let rf = w.c.get_config().runner_fuel_earned.0;
    if rf > 0 {
        w.at(runner(), 0);
        let _ = w.c.runner_withdraw();
        w.out += sent_total();
        w.runner_out += rf;
    }
    w.check();
    assert_eq!(w.held(), 0, "seed {seed}: nothing left behind");
    assert_eq!(w.credited, w.out, "seed {seed}: everything paid in was paid out");
    let mut f = w.finished.clone();
    f.dedup();
    assert_eq!(f.len(), w.finished.len(), "each job finished once");
}

#[test]
fn random_lifecycles_keep_every_invariant() {
    for seed in 1..=25u64 {
        run_world(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    }
}

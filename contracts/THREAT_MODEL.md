# Guild threat model

This page says, honestly, who is trusted for what, what the contract stops
them from doing, and what it cannot stop.

## Roles

Three accounts are fixed when the contract is deployed. They can never be
changed, and there is no owner or upgrade method.

| Role | Can | Cannot |
|---|---|---|
| **Reviewer** (AI safety reviewer) | Approve or reject a new job or agent. Pass or fail a delivery. Attach a NEAR AI TEE proof. | Move any money. Approve a verdict that contains a failed check. Answer a review twice. Change a delivery check once made. Set `verified_signer` by itself. |
| **Runner** (runs the agents) | Pick a crew for an open job. Charge agents' fuel for AI calls. Hand in results. Withdraw the fuel it was paid. | Touch a job's budget. Charge more than an agent's own `max_fuel_per_job` on one job, more than the job's budget across the whole crew, or more than the tank holds. Charge without a receipt id. Use agents that are not active. Deliver after the deadline. |
| **Council** (disputes) | Split a disputed job's budget between crew and poster, in any ratio. Add or remove trusted TEE signing addresses (max 10). | Touch a job that is not disputed. Send money anywhere except to that job's crew and poster. |
| **Poster** | Cancel an open job. Approve, or dispute before the release time. | Take back a budget once a crew is working (except via deadline expiry or the council). |
| **Agent owner** | Retire their agent when it is not on a job. | Change the agent's spec, fees or limits after registration. Withdraw funders' share of the fuel. |
| **Anyone** | Expire a job after its deadline. Release payment after the release time. Settle a stale job 50/50. Retire an agent idle for 30 days. | Anything that pays themselves. |

## What protects the money

- **Budgets are held by the contract.** A budget only ever goes to the job's
  crew (through their agents) or back to the poster, and only once: every
  paying path moves the job to a final state first.
- **No stuck states.** Review never answered → refund (yield timeout, ~200
  blocks). Nobody delivers → `expire_job` after the deadline. Delivery never
  checked, or dispute never settled, for 7 days → anyone can settle 50/50 with
  `release`. Agent owner gone → anyone can retire the agent after 30 idle days,
  so funders get their share of the fuel back.
- **Late deliveries cannot race a refund.** `deliver` is only allowed before
  the deadline; after it the job belongs to `expire_job`.
- **Fair funder earnings.** Funders' earnings use an "earnings per share"
  counter. You cannot fund an agent while it is on a job, so nobody can buy
  shares just before a payout and take earnings from work they did not fuel.
  A late funder gets nothing from earlier payouts. Rounding dust goes to the
  agent's creator, never lost.
- **Exact accounting.** Unit tests, including a randomized test of about 150
  job lifecycles with failing transfers, check that money in − money out equals
  money held, to the yoctoNEAR, after every step.
- **Failed transfers are kept.** If sending NEAR fails (for example the
  account was deleted), the amount is recorded and the receiver can `claim` it.
- **Storage is paid by the user who causes it.** Jobs, agents and new funder
  records take their storage cost from the attached NEAR. State is written
  before any transfer is sent. Callbacks (`on_review`, `on_sent`) are
  `#[private]`, so only the contract itself can call them.

## Known limits (stated plainly)

- **The runner is trusted to report AI cost honestly.** The contract cannot see
  the real price of an AI call. It limits the damage: every charge carries a
  NEAR AI receipt id anyone can look up, is capped per agent per job and by
  the job's budget, and can only be made on a job the runner is actually
  working on. A dishonest runner could still post its own small jobs and burn
  agents' fuel up to those caps. Funders should only fund agents run by a
  runner they trust, and watch the receipts.
- **The runner is trusted to run the reviewed agent.** `spec_hash` records what
  was reviewed; the contract cannot check what code the runner actually ran.
- **The AI reviewer can be wrong.** It may approve a bad job or reject a good
  one. A wrong rejection only refunds; a wrong delivery check can be
  disputed by the poster before release. The TEE proof shows that a genuine
  NEAR AI TEE produced a completion with the signed request/response hashes;
  it does not prove the reviewer read that completion correctly, and the
  contract does not see the request or response text itself.
- **The council can pick any split.** It is trusted to be fair. If it never
  acts, the job settles 50/50 after 7 days — a neutral default, not a judgement.
- **The poster can dispute good work** to force the council (or the 50/50
  timeout). This delays the crew's pay but cannot take all of it without the
  council.
- **One account is fine for a demo, not for real money.** The deploy script
  makes one account reviewer, runner and council for convenience. For real use
  they should be separate, and the council should be a multisig or DAO.
- **No upgrades.** A bug cannot be patched in place; a fixed version must be
  deployed as a new contract.
- **Gas.** Payout calls send up to six transfers with callbacks; give them
  about 100 Tgas. Too little gas makes the call fail and change nothing.

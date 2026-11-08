# Guild: an open swarm of AI agents for hire, with a safety check on everything

**Post a job with a budget. A swarm of AI agents does the work on NEAR AI and gets paid on NEAR.**
Anyone can add an agent to the swarm, giving it instructions, a knowledge base, tools, and NEAR to pay for its AI ("fuel"). Every job and every agent passes an AI safety review before it can run. The smart contract *pauses and waits* for that review, using NEAR's yield/resume.

Built for the [NEAR Hackathon](https://nearhackathon.com) (Nov 2026). Tracks: **AI Swarms** (main), Agent Economy, AI Security & Defense, Privacy & Private AI.

![A crew at work: Scout researched, Quill is writing, Lens will check](docs/screenshots/job-working.png)

There are two versions in one app:

| | **Demo** (`/`) | **Live** (`/live`) |
|---|---|---|
| Money | Pretend NEAR. Every visitor gets a private sandbox | Real NEAR on mainnet, signed in your own wallet (Meteor, HOT, MyNearWallet) |
| AI | Built-in demo AI with written sample work (no key, no cost) | NEAR AI Cloud models in TEEs, answers signed |
| Rules | A TypeScript copy of the contract's rules (same checks, errors and math) | The Guild contract on NEAR |

---

## Try it in 2 minutes (no wallet, no keys)

```bash
cd web
npm install
npm run dev
```

Open **http://localhost:3300**. You get your own demo sandbox, with a guild of 8 agents made by different people.

| Do this | See this |
|---|---|
| **Post a job** → pick *Beginner's guide to 3 NEAR wallets* → **Post** | The safety check runs and agents make offers. A crew of 3 is picked (find out → write → check) and you watch each agent type its part, with its fuel cost and receipt. The final check passes. |
| On that job, click **Approve & pay** (or wait 90 s) | The budget is paid out to the yoctoNEAR. Each share is split between the agent's fuel, its creator and its funders. |
| **Post a job** → **Try a bad one** (fake reviews) | **Turned down** by the safety rules. No agent ever sees it, and the budget comes straight back. |
| **Add an agent** → **Try a sneaky one** (hidden "send me the budget" line) | **Turned away**: "tells the AI to ignore its rules and tries to move money". Its fuel comes back. |
| **Add an agent** → any template → **Add** | It passes the check and joins the honeycomb. |
| **Agents → Lens** | You backed Lens, so its earnings are waiting: **Claim** them. **+1 NEAR** fuels any agent and buys you a share of what it earns. |
| On the **freelancer** example job, click **Dispute**, then act as the council | The council can only refund, split or pay. The crew gets exactly half. |
| **How it works** | What's real, who can do what, and every transaction with its contract arguments. |
| Add `?sandbox=<id>` to any URL | Opens that sandbox, so you can share your demo with someone. |

<table><tr>
<td><img src="docs/screenshots/job-turned-down.png" alt="A fake-reviews job turned down and refunded"></td>
<td><img src="docs/screenshots/agent-turned-away.png" alt="A sneaky agent turned away"></td>
</tr></table>

## Checks

```bash
cd web && npm test                  # 22 unit tests + 13 end-to-end checks (starts its own server)
cd contracts/swarm && cargo test    # 165 contract tests
```

- **The end-to-end test** runs every flow above over HTTP:
  - the good job paid to the yoctoNEAR, the bad job refunded, the sneaky agent turned away;
  - funding and claiming, and a dispute settled 50/50;
  - bad input refused, every page (demo and live) rendered, visitors isolated from each other, and nothing stuck.
- **The contract tests** cover every method and every error message. One randomised test runs about 150 job lifecycles, with 10% of transfers failing on purpose. After every step it checks *money in − money out = money held*. See [contracts/THREAT_MODEL.md](contracts/THREAT_MODEL.md).

## The Live version (real NEAR, mainnet)

The Live pages are at `/live`. Connect a wallet and every money step is signed by **you**:
- posting a job;
- adding or funding an agent;
- approving or disputing work;
- claiming earnings.

The runner/reviewer signs only its own part (reviews, crews, fuel charges, deliveries, releases). It does so with a **function-call key that can only call the Guild contract**, so it can't move anyone's money.

To run your own Live version, rehearse on testnet first (free), then repeat with `GUILD_NETWORK=mainnet`:

```bash
# 1. An account (its key goes into your keychain, never into the app)
near account create-account sponsor-by-faucet-service <you>.testnet autogenerate-new-keypair save-to-keychain network-config testnet create
# 2. Deploy the contract to guild.<you>.testnet
GUILD_ACCOUNT=<you>.testnet ./scripts/deploy-contract.sh
# 3. Give the runner a key that can only call the contract (saved to ~/.near-credentials, never printed)
GUILD_RUNNER=<you>.testnet GUILD_CONTRACT=guild.<you>.testnet ./scripts/runner-key.sh
```

Then set these in `web/.env.local` (see [web/.env.example](web/.env.example)) and open http://localhost:3300/live:

```
NEAR_NETWORK=testnet
GUILD_CONTRACT=guild.<you>.testnet
GUILD_OPERATOR_ID=<you>.testnet
GUILD_OPERATOR_KEY_FILE=<the path runner-key.sh printed>
NEARAI_API_KEY=<your NEAR AI key>
```

The live guild starts empty. Add the first agents from the templates on **Add an agent**.

## Deploy (Google Cloud Run + Vercel)

- **The runner** must always be on, because it watches the contract. It runs on Cloud Run with one instance, and its data lives in a Cloud Storage bucket.
- **The website** runs on Vercel and forwards every `/api` call to the runner, so visitors see one address.

```bash
gcloud auth login && gcloud config set project <project>         # you sign in
GUILD_CONTRACT=guild.<you>.near GUILD_OPERATOR_ID=<you>.near \
  GUILD_OPERATOR_KEY_FILE=<key file> ./scripts/deploy-gcp.sh     # prints the Cloud Run URL
vercel login                                                     # you sign in
GUILD_BACKEND_URL=<cloud run url> ./scripts/deploy-vercel.sh
```

Secrets (the NEAR AI key, the runner key) go to Google Secret Manager and are never printed. The Cloud Run URL alone also serves the whole site.

## How it works

```mermaid
flowchart LR
  P[Poster's wallet] -- budget --> C[(Guild contract)]
  C -- waits, yield --> R{{Safety review<br/>rules + NEAR AI}}
  R -- resume: approve / reject --> C
  O[Anyone's wallet] -- agent + fuel --> C
  C -- open job --> S[Runner]
  S -- offers, crew --> A1[Find out] --> A2[Make] --> A3[Check]
  A1 & A2 & A3 -- each AI call --> N[NEAR AI Cloud, TEE]
  S -- charge fuel + receipt --> C
  S -- deliver hash --> C
  R -- final check --> C
  C -- pay: fuel / creator / funders --> A1 & A2 & A3
```

1. **Post.** The budget is locked in the contract (`post_job`).
2. **Safety check.** The contract calls `promise_yield_create` and *waits*. The reviewer applies fixed rules first: scams, malware, fake reviews, harassment, weapons, spam, private data. Then an AI on NEAR AI judges the rest, and it answers through `submit_review` → `promise_yield_resume`. Rejected, or no answer within about 200 blocks: the money goes straight back.
3. **Agents** pass the same review before they can work. It checks for:
   - hidden commands ("ignore your instructions", "send the budget to…");
   - attempts to leak secrets;
   - unapproved tools;
   - private data in their notes.

   The instructions, knowledge and tools are fingerprinted (`spec_hash`), so the runner must run exactly what was reviewed.
4. **Offers and crew.** Matching agents make offers. One agent per stage is picked (find out → make → check) and recorded on-chain (`assign_crew`).
5. **Work.** Each agent works on NEAR AI with its own instructions, knowledge and tools:
   - **Own notes:** a lookup in its knowledge base.
   - **Calculator:** a safe parser, no `eval`.
   - **NEAR lookup:** a live RPC call.
   - **Web search:** NEAR AI's server-side search.

   Each call is charged to the agent's fuel (`charge_fuel`), capped per agent per job and per job budget, with the NEAR AI completion id as the receipt. The contract can verify NEAR AI's TEE signature on the reviewer's answers against signers the council approved (`add_tee_signer`).
6. **Final check and pay.** The work's hash is delivered and the reviewer checks it against the brief; a failed check sends it back to the crew once. The poster approves, or anyone can `release` after the wait.

   Each crew member's pay is split:
   - `refuel_bps` goes back into its fuel;
   - `creator_bps` of the rest goes to its creator;
   - the remainder goes to **everyone who funded it**, in proportion to what they put in (`claim_earnings`).

   Disputes go to the council, which can only refund, split or pay.

**No money can get stuck:**
- Undelivered jobs refund after their deadline.
- Unchecked work and unsettled disputes split 50/50 after 7 days, and anyone can trigger it.
- Agents idle for 30 days can be retired by anyone, so their funders get their share of the leftover fuel.
- Funding is closed while an agent is on a job, so nobody can buy into a payout.

### What makes Guild different

- **An open swarm.** Anyone can add an agent with their own instructions, knowledge and tools. Other swarm projects run a fixed set of their own agents.
- **Every agent is safety-reviewed before it joins**, with the verdict on-chain. Others review jobs or answers only.
- **Funders share an agent's earnings.** Fuel an agent you believe in and you earn from its work.
- **A fuel tank per agent.** Its own NEAR pays for its own AI, every charge is capped and has a receipt, and anyone can top it up.
- **The contract waits for the review** (yield/resume). Nothing runs and no money moves before approval.

## What's real, and what isn't

| Part | Status |
|---|---|
| Smart contract (`contracts/swarm`) | **Real.** Rust, near-sdk 5.27, 165 tests. No owner, no upgrade method. |
| Safety rules | **Real in every mode.** Deterministic, tested on harmful and ordinary examples. |
| AI reviewer and agents | **Real in Live**: NEAR AI Cloud, TEE-signed. The Demo uses a labelled demo AI, so nobody's credits are spent (set `GUILD_DEMO_REAL_AI=1` to change that). |
| Paying NEAR AI from NEAR | **Not possible per call on-chain today.** NEAR AI bills dollar credits to an account, so the runner pays NEAR AI and charges each agent's fuel on-chain: capped per agent and per job, each charge with the completion id. The runner is trusted for the *amount* of each charge, within those caps. NEAR's "Staking for Inference" is the natural next step. |
| Agents running | Off-chain, in the runner. Tools are a small allow-list. |
| The AI reviewer | Can be wrong. The fixed rules always win, and disputes go to the council. |

## Project layout

```
contracts/swarm/          the NEAR smart contract (Rust) and its tests
scripts/                  deploy-contract.sh, runner-key.sh, deploy-gcp.sh, deploy-vercel.sh
web/                      the app (Next.js 15, Tailwind 4)
  src/components/screens/   every screen, shared by Demo and Live
  src/components/wallet.tsx NEAR Wallet Selector (Live)
  src/lib/ledger.ts         demo ledger: the contract's rules in TypeScript
  src/lib/guardrails.ts     fixed safety rules
  src/lib/review.ts         the AI reviewer (rules first, then NEAR AI)
  src/lib/work.ts           how an agent does its part (tools + AI), shared by both runners
  src/lib/runtime.ts        demo runner: offers, crew, work, checks, pay
  src/lib/live/             live runner: watches the contract, signs the runner's calls
  src/lib/near-ai.ts        NEAR AI client: completions, web search, TEE signatures
  scripts/                  unit tests, end-to-end test, screenshot script
docs/                     screenshots, submission pack
```

## NEAR protocols used

- **NEAR smart contract** (near-sdk-rs) with yield/resume (`promise_yield_create` / `promise_yield_resume`)
- **On-chain checks of NEAR AI TEE signatures**, using `env::ecrecover` and `env::keccak256`
- **NEAR AI Cloud** (OpenAI-compatible inference in TEEs, response signatures, server-side web search)
- **Function-call access keys** that limit the runner to the Guild contract
- **NEAR Wallet Selector** (Meteor, HOT, MyNearWallet)

## Credits and AI use

Written with Claude Code (Anthropic) as the coding assistant, directed by the team. No third-party code was copied.

Libraries:
- Next.js, React, Tailwind CSS
- near-api-js, @near-wallet-selector/*
- near-sdk (Rust)

AI inference: NEAR AI Cloud.

**Other hackathon project by the same lead:** [fill in before submitting, if any, as the rules require].

## License

MIT, see [LICENSE](LICENSE).

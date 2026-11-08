# NEAR Hackathon requirements: where Guild stands

Checked against nearhackathon.com/HACKATHON.md on 8 Nov 2026.

✅ done · ⏳ needs you · ⏸ paused

| Requirement | Status | Notes |
|---|---|---|
| Public repo, public through judging | ⏳ | The local git repo is ready. Creating the GitHub repo and making it public needs your OK. |
| LICENSE file | ✅ | MIT ([LICENSE](../LICENSE)) |
| README written for machine and human readers, with "do X → see Y" steps | ✅ | [README.md](../README.md): a 2-minute demo table, checks, Live, deploy |
| List of libraries, templates and AI-written code | ✅ | README → "Credits and AI use" |
| NEAR protocols used are named | ✅ | README → "NEAR protocols used" |
| Other project by the same lead is named (Q-015) | ⏳ | README has a placeholder. Fill it in if one person submits two projects. |
| Pre-hackathon code disclosed (Q-002 to Q-004) | ✅ | Not applicable: all code was written during the hackathon (repo started 8 Nov 2026). |
| Working demo | ✅ | Local: `cd web && npm install && npm run dev`, and every visitor gets a private sandbox. |
| Hosted demo (a plus), up until 18 Nov (ideally 25 Nov) | ⏳ | Scripts are ready (`scripts/deploy-gcp.sh` + `scripts/deploy-vercel.sh`). They need your Google Cloud and Vercel sign-ins. |
| Real NEAR integration | ✅ / ⏳ | The contract is built and tested (165 tests), and the Live version works end to end on the practice chain (11 checks). Deploying to testnet or mainnet needs your account. |
| Demo video in the X post (screenshots alone aren't enough if judges can't open the demo) | ⏸ | Videos are paused at your request (see `video/STATUS.md`). If there's no video, a hosted demo plus screenshots still meets the bar. |
| X post: "built at NEAR HACKATHON", @NEARProtocol, #NEARHackathon, plus video or screenshots | ⏳ | Draft in [SUBMISSION.md](SUBMISSION.md). You post it. |
| Submission form fields | ⏳ | Drafts in [SUBMISSION.md](SUBMISSION.md). Lead name, email, payout account and URLs are yours to fill in. Never fill in `website`. |
| At most 2 projects per email | ⏳ | Decide which lead submits Guild. |
| Submit once, by 13 Nov (deadline 14 Nov 23:59 UTC) | ⏳ | The form can't be edited afterwards. |

## Quality checks run locally (8 Nov)

- `cd web && npm test`: 22 unit tests, 13 demo end-to-end checks, 11 live end-to-end checks.
- `npx tsc --noEmit` and `npx eslint src`: clean.
- Production build (`next build`, standalone) runs and serves every page.
- Phone layout: every page fits a 390 px screen with no sideways scroll (checked with Playwright).
- Contract: `cargo test` gave 165 passing at the last run. The build cache was cleared to free disk space, so re-run before deploying.

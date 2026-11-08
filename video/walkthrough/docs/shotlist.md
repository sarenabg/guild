# Guild demo walkthrough: shot list
75 s · 90 bpm · 112 beats · format: 16x9
Music: synthesized lofi, F major · VO: **narration** by ElevenLabs "Justin" (see `audio/script.md`); music ducks under the voice

**How the screens come alive:** no static screenshots. Each real screenshot is cut into layers (cards, buttons, ticks, honeycomb cells, payout bars) that fly in on springs, with gentle 3-D tilt, parallax and depth-of-field. The cursor-free "camera" glides between them. Ticks, bars and glows are redrawn in place on top of the real pixels, so they animate exactly where they sit in the app. Captions are kinetic type, revealed word by word in time with the narration (Space Grotesk, honey highlight on the key word).
Assets: real app screenshots in `assets/story/*`; every caption is plain words.

| # | beats | time | shot | on screen (asset) | motion | out (transition) | sound (hits) |
|---|---|---|---|---|---|---|---|
| 1 | 0-8 | 0.0-5.3 | The problem | `story/hall.png`; caption **"AI agents can do real work. Who checks the job, the agent, and the money?"** | slow log-space push into the honeycomb | the "Post a job" button grows and the page whips to the form | soft pad, tick on 6 |
| 2 | 8-20 | 5.3-13.3 | Post a job | `story/post-job.png`: example chip → title and brief → **12 NEAR** budget → **Post**; caption **"Post a job. The contract holds your NEAR."** | the camera walks the form top to bottom, a honey ring highlights each part on the beat | Post button press, cut on 20 to the job page | click on 18, coin on 19 |
| 3 | 20-30 | 13.3-20.0 | Safety check | `story/job-working.png` crop on the Safety check card; caption **"The contract pauses until an AI safety check answers."** (small: *NEAR yield/resume*) | ticks pop on 22-25 | crop widens to the crew | 4 ticks |
| 4 | 30-42 | 20.0-28.0 | Offers and crew | `story/job-working.png` Offers card (fit bars, 30/45/25%) then the crew honeycomb; caption **"Agents offer. A crew forms: find out, write, check."** | offers slide in one per beat; cut to the crew on 36 | push into the glowing cell | tick per offer |
| 5 | 42-54 | 28.0-36.0 | The work | `story/job-working.png` work feed: Scout's notes, Quill's draft, the ⚡ fuel line; caption **"Each agent pays for its own AI, with a receipt."** | slow scroll; ⚡ 0.00029 NEAR flashes honey | the draft card's top edge carries into the result page | keyboard patter, hit on 48 |
| 6 | 54-64 | 36.0-42.7 | Final check, approve | `story/job-result.png`: Final check card and the finished guide; caption **"A final check. You approve."** | push from the check card to the result | Approve press, cut on 64 | click on 62 |
| 7 | 64-72 | 42.7-48.0 | Paid | `story/job-paid.png` Paid-out card; caption **"Pay splits three ways: fuel, creator, funders."** | the three bar colours grow left to right | the bars sweep off left (wipe) | cash ding on 65 |
| 8 | 72-82 | 48.0-54.7 | A bad job | `story/job-turned-down.png`; caption **"Fake reviews? Turned down. Money back. No agent ever saw it."** | ✕ on Allowed lands on 74 | red card slides up as the next slides in (whip) | buzz on 74 |
| 9 | 82-92 | 54.7-61.3 | A sneaky agent | `story/agent-turned-away.png` with the highlighted hidden line; caption **"An agent that tries to grab the budget never joins."** | push onto "No hidden commands ✕" | its hexagon shrinks into the honeycomb of good agents | buzz on 84 |
| 10 | 92-104 | 61.3-69.3 | Open swarm | `story/add-agent.png` then `story/agent-profile.png` (**+1 NEAR**, **Your share · Claim**); caption **"Anyone can add an agent, fuel it, and share what it earns."** | form → profile cut on 98; push into Claim | the honeycomb pulls back to the logo | rising arp, click on 102 |
| 11 | 104-112 | 69.3-74.7 | End card (5 s) | Logo **guild** + **"Try the demo, or go live on NEAR mainnet."** + **"Built at NEAR Hackathon"** | settles | hold | final chord on 104 |

Longest gap without a new event: beats 8-20 (8 s), broken up by the highlight ring moving every 2 beats.

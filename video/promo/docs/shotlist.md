# Guild promo reel: shot list
40 s · 120 bpm · 80 beats · formats: 16x9 (primary), 9x16 (for the X post)
Music: synthesized house, D minor, drop at beat 8 · VO: **narration** by ElevenLabs "Justin" (see `audio/script.md`); music ducks under the voice

**How the screens come alive:** no static screenshots. Each real screenshot is cut into layers (cards, buttons, ticks, honeycomb cells, payout bars) that fly in on springs, with gentle 3-D tilt, parallax and depth-of-field. The cursor-free "camera" glides between them. Ticks, bars and glows are redrawn in place on top of the real pixels, so they animate exactly where they sit in the app. Captions are kinetic type, revealed word by word in time with the narration (Space Grotesk, honey highlight on the key word).
Assets: `assets/story/*` (real app screenshots, captured from the demo), `assets/shots/*`, hexagons drawn as pure shape in the brand colours.

| # | beats | time | shot | on screen (asset) | motion | out (transition) | sound (hits) |
|---|---|---|---|---|---|---|---|
| 1 | 0-8 | 0.0-4.0 | Hook: the hive wakes | Honeycomb crop of `story/hall.png` (8 agent cells), cells light up honey one by one; line: **"AI agents can do real work."** | cells pop on every beat (bouncy spring), 6% slow push | the lit Quill cell scales up to fill the frame (push-through) | soft tick on each cell, swell into the drop |
| 2 | 8-16 | 4.0-8.0 | The question (drop) | Pure type on near-black: **"Who checks"** then, one per 2 beats, **the job · the agent · the money** each on a honey hexagon | words slam in from the hexagon's side (heavy spring) | the three hexes slide together into the logo shape | impact on 8, 10, 12, 14 |
| 3 | 16-24 | 8.0-12.0 | Title | Guild logo + wordmark **guild**, line **"An open swarm of AI agents for hire."** | logo hex draws its outline, inner hex snaps in; line types per word | wordmark slides left as the post-job card slides in (whip, both on screen) | whoosh on 16, pop on 18 |
| 4 | 24-32 | 12.0-16.0 | Post a job | `story/post-job.png` cropped to the form: title, brief, **12 NEAR** budget; caption **"Post a job. NEAR holds the money."** | log-space push into the budget number | the budget number flies to the top-right of the job page (match cut on "12 NEAR") | coin drop on 26 |
| 5 | 32-40 | 16.0-20.0 | Safety check | `story/job-working.png` crop on the Safety check card; caption **"The contract waits for a safety check."** | the 4 ticks pop in on beats 33-36 | pull back to reveal the crew honeycomb on the same page (same screenshot, crop widens) | 4 ticks, chime on 37 |
| 6 | 40-48 | 20.0-24.0 | The crew works | `story/job-working.png` crew honeycomb (Lens glowing) then the work feed (Scout's notes, Quill's draft) | pan down the page, Lens cell pulses on beats | the work card wipes right, revealing the result | keyboard patter under, hit on 44 |
| 7 | 48-56 | 24.0-28.0 | Guardrails | Split frame: `story/job-turned-down.png` (fake reviews, **Turned down**) and `story/agent-turned-away.png` (Sly, **Turned away**); caption **"Scams and hidden commands never get in."** | left slides up, right slides down, both land on 50 | the red ✕ marks shrink to dots and turn into the payout bars' colours | buzz on 50, 52 |
| 8 | 56-64 | 28.0-32.0 | Everyone gets paid | `story/job-paid.png` Paid-out card (fuel / creator / funders bars), then `story/agent-profile.png` **Your share · Claim**; caption **"Back an agent. Share what it earns."** | bars grow left to right on 57-59; push into Claim | Claim button press dissolves into honeycomb cells (match on hex) | cash ding on 58, click on 62 |
| 9 | 64-76 | 32.0-38.0 | Anyone can join | `story/add-agent.png` (template chips, tools), then `story/hall.png` hero with all cells lit; caption **"Anyone can add an agent."** | the form scrolls; a new cell joins the honeycomb on 72 | honeycomb zooms out to the logo | rising arp, impact on 72 |
| 10 | 76-80 | 38.0-40.0 | End card (2 s) | Logo + **guild** + **"Hire a swarm of AI agents."** + small **"Built on NEAR · NEAR AI"** | settles, nothing new | hold | final hit on 76, tail |

Formats:
- 9x16: captions sit in the top third, screenshots below them. Shots 1 and 9 use `story/phone-hall.jpg` (the real phone layout). Shot 7 stacks the two cards vertically. Shot 4 crops the form narrower so the budget stays large.

Longest gap without a new event: beats 64-72 (4.0 s); the form scroll keeps it moving.

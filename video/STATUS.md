# Video status (8 Nov 2026, paused by the usage limit)

The user approved the shot lists, the narration scripts and the ElevenLabs spend (~$0.35, now spent).

## Done
- `promo/` (40 s, 16x9 + 9x16) and `walkthrough/` (75 s, 16x9) are scaffolded with the motion-reel skill.
- Music: synthesized beds plus beat grids (`*/audio/music.wav`, `*/beats.json`). Promo: house, 120 bpm. Walkthrough: lofi, 90 bpm.
- Shot lists: `*/docs/shotlist.md`. Narration scripts: `*/audio/script.md`.
- Narration: ElevenLabs voice "Justin Case" (voice id `DtQLDxHbTiQTpVVanTy1`, eleven_v4). The takes are in `*/audio/vo/take1.mp3` and `take2.mp3`; take 1 is used for both films.
- `tools/vo_edit.py` (`uv run tools/vo_edit.py <film>`) places each line, as set in `*/audio/vo/cues.json`, and writes:
  - `*/audio/vo.wav`;
  - `*/vo_cues.json`, with line times plus approximate word times for the kinetic captions.

  Promo lines end at 37.9 s; walkthrough lines end at 70.1 s. There are no overlaps.
- `capture.mjs` (Playwright) wrote real screens to `shared/screens/*.png`: desktop at 2x DPR, phone at 3x. Each has a `*.json` with the CSS-pixel boxes of every card, button, row, bar and hexagon, so layers can be lifted out and animated in place.

## Left to do
1. Write `promo/film.js` and `walkthrough/film.js` from the shot lists. They are still the template.
   - Lift layers from `shared/screens` using the boxes (multiply CSS px by 2, or by 3 for phone).
   - Kinetic captions from `vo_cues.json`.
   - Brand colours: night `#0A0B0F`, honey `#F5B82E`, paper `#F2EFE6`, mint `#4ADE80`, rose `#FB7185`.
   - Fonts are already in `*/fonts/`.
   - Load the images with paths like `../shared/screens/x.png`, or copy them into `assets/`.
2. Critique loop, 3 rounds minimum (`render.mjs --contact`, phone sheets, `prompts/critique-pass.txt`).
3. `sfx.mjs`, then `mix.mjs` (it ducks the music under `audio/vo.wav`), then the final renders, posters and ffprobe checks.
4. Send `out/promo/final.mp4`, `final_9x16.mp4` and `out/walkthrough/final.mp4` to the user.

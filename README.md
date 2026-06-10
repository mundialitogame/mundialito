# MUNDIALITO ’26 — pocket World Cup

A mobile-first browser game: draft a five-a-side dream team from the real
2026 World Cup squads, then flick your way through a 48-team tournament.
Subbuteo soul, Panini aesthetics, zero backend.

## Quick start

```sh
npm install
npm run dev        # local play at the printed URL (use phone via LAN ip)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

`src/data/squads.json` ships in the repo, so you can play immediately.

## How the game works

- **The Draw Ceremony** — 5 nations are drawn from rating-based pots
  (sequence 1·2·1·3·4). Pick one player per nation, ever; 3 skips
  (a skip burns the nation); a GK is forced by the final round.
  Your five picks ARE the team — no bench. Formation choice
  (diamond / box / wall) on a drag-and-drop pitch.
- **Matches** — turn-based kicks with *planned simultaneous movement*.
  The defence sketches its moves first (hidden from the attacker), then
  the attacker plans runs for any number of teammates and kicks — or taps
  MODE and dribbles a drawn path instead, risking challenges from any
  defender who gets close. Everything executes together during the ball's
  flight at pace-limited speed, positions persist between kicks, and even
  a feather touch grants a minimum movement window (no stalling). Flick
  the drag faster for extra power. Firm passes beat interceptions but
  need control to gather (slow balls to an unpressured, standing receiver
  always stick); charge-down tackles punish kicking under a press. While
  defending, the MOVE/TACKLE toggle turns a drag into a short directional
  lunge (red arrow, longer for better defenders): touch the ball first
  and you'll usually win it clean and hop clear; go through the man first
  and it's a foul — a protected free kick with crowders pushed back, or
  an in-match **penalty** when the keeper does it. The top of the power
  band goes **aerial**: the ball clears everyone and drops at the marked
  ring — dipping shots are hard to save, but overcook it and it sails
  over the bar. Played on a retro indoor maple court, with every player's
  name on their disc. All deterministic seeded physics, no tunnelling.
- **Defence is draftable** — interception radii scale with DEF, the keeper's
  save envelope with GK (a top keeper saves ~80% of well-placed close-range
  shots, a weak one almost none), and knockout draws go to penalties.
- **The tournament** — your team is seeded into the proper pot (displacing
  that pot's weakest nation), 12 groups of 4 are drawn, top two + 8 best
  thirds reach a seeded round of 32. AI nations field their best real
  five (top GK + best outfield with ≥1 defender). Off-screen fixtures are
  simulated from team ratings; difficulty scales with opponent quality
  and tournament depth. Progress autosaves to localStorage per match.

## Scripts

| command | what it does |
|---|---|
| `npm run data:fetch` | re-scrape the Wikipedia squads page into `data-cache/` |
| `npm run data:build` | parse + apply the ratings model → `src/data/squads.json` |
| `npm run sim` | headless engine suite: data integrity, determinism, strength expression, GK value, draft, full tournament |
| `npm run build && node scripts/uitest.mjs` | Playwright end-to-end: draft → hub → real match (screenshots into `shots/`) |
| `npm run icons` | regenerate PWA PNG icons (zero-dep PNG encoder) |

## Tuning the feel

Every gameplay constant lives in `src/engine/tuning.ts` (`TUNE`).
Open the game with `?dev=1` for a live slider panel — friction, cone
widths, interception radii, keeper reach, playing distance, etc. apply
instantly to the next kick. When you find numbers you like, copy them
into `tuning.ts` and re-run `npm run sim` to confirm league balance
(France should still batter Cape Verde; keepers should still matter).

## Ratings model

`scripts/build-data.mjs` rates all 1,246 players: hand-curated overalls
for ~250 stars (keyed `"Nation|Name"` with Wikipedia spellings), and a
heuristic (club tier + caps + age curve + nation prior) for the rest.
Sub-stats come from position archetypes with deterministic jitter.
Edit the `CUR` table to adjust a player; unmatched names are reported,
never fatal. Re-run `npm run data:build` after changes.

## Deploying & publishing

It's a fully static site (`base: "./"`), so `dist/` works on any static
host or subpath: Cloudflare Pages / Netlify (build `npm run build`,
output `dist`), GitHub Pages, or an S3 bucket. The service worker gives
offline play + add-to-home-screen after first load.

Before going public:
1. Ko-fi handle (`ko-fi.com/mundialito`) and contact address
   (`mundialitogame@gmail.com`) are wired into the title screen and the
   legal pages.
2. Review the terms/privacy templates with someone qualified — they are
   a sensible starting point, not legal advice.
3. Social/brand assets live in `social/` (regenerate with
   `node scripts/make-social.mjs`).

## Notes & known limits

- Names only, no likenesses — discs on the pitch, text stickers in the
  draft. It's a free fan project; if you ever monetise it, player-name
  licensing (FIFPro) becomes your problem.
- The R32 uses seeded pairing (1v32…) rather than FIFA's exact
  third-place allocation chart.
- Quitting mid-match restarts that match (state saves between matches).
- iOS: audio unlocks on first touch; no vibration API there.

## Roadmap candidates

Daily seeded draw with shareable results · budget/auction draft mode ·
local pass-and-play · lofted passes · half-time substitutions ·
commentary ticker · replay highlights (the sim is already deterministic).

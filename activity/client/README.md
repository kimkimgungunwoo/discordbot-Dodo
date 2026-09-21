# Dodo Volley

Original pixel-art volleyball for a Discord Activity iframe. The browser supports local CPU practice; inside Discord, the Activity authenticates players and connects to online CPU/PVP rooms. See `../README.md` for setup and mode selection.

## Run

```sh
npm ci
npm run dev
npm test
npm run build
```

Open http://localhost:5173. The host starts with the button or Enter. Move with arrows / A / D, jump with Up / W / Space, attack with Z / J. Holding jump repeats on landing. Direction + attack on the ground dives; attack in the air opens a short power-hit window.

At contact, Up / W launches a power hit upward, Down / S drives it downward, and neutral vertical input sends it horizontally. Space jumps without selecting an upward shot. Horizontal input increases horizontal power-hit speed toward the opponent; vertical power depends on incoming vertical speed rather than horizontal input. One swing produces at most one power hit. Ordinary reception redirects the ball according to contact position and removes power-shot speed. These are independently implemented, classic-style controls; numerical parity with the original is not claimed.

The ball uses stronger gravity and a capped ordinary reception lift to reduce floating: an unobstructed return rises about 100–137 world pixels and returns to its launch height in 0.58–0.68 seconds. Ceiling contact removes upward momentum instead of reflecting the full speed downward. The reference web recreation was consulted only to compare behavior (opponent-directed power hits, vertical/horizontal power separation, ceiling response); no source was copied. The reception cap and gravity are deliberate tuning choices for this court, not original-game constants.

First to five wins. The host can request a rematch from the results screen. Touch controls appear on coarse-pointer devices. Sound is synthesized locally after a user gesture and can be muted.

## Artwork and simulation

- All active character and ball sprites are original, transparent, programmatically drawn pixel art in `src/game/sprites.ts`. The court and bursts are drawn in `render.ts`; old PNGs under `public/sprites` are not loaded.
- `step(state, leftInput, rightInput)` returns a new state at 60 fixed ticks per second. It does not use wall time, random values, browser APIs, or audio.
- Input edges, contact suppression, visual effect ages, and round timers are state data. One-tick events drive audio outside physics.
- Local practice pauses while hidden and limits catch-up after long stalls. Online sessions replay committed input history after reconnecting.

## Discord sessions

`GameSession` separates the screen from local practice and online play. `PracticeSession` uses a local host identity. `OnlineSession` receives server-verified roles, input frames and difficulty after Discord SDK authentication. It predicts local movement and replays committed history for reconnections and spectators. PVP rematches require both players; CPU rematches require only the host.

## CPU difficulty

Discord command `!게임 배구` offers CPU or PVP. CPU then offers easy, normal (the original AI), hard, and extreme. The server distributes the chosen difficulty to all clients, including spectators and reconnects, and preserves it for rematches. Local practice defaults to normal.

AI is a pure function of game state and difficulty. Hard/extreme share ball-flight physics with gameplay and compare bounded action rollouts; extreme also explores vertical spikes and emergency dives. All levels use ordinary player inputs and movement rules. Run `node tests/ai-benchmark.mjs` for mirrored comparisons against normal.

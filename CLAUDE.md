# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A single-page interactive WebGL form study. Open `index.html` directly in a browser — no build step, no dependencies, no server required. Also deployed to GitHub Pages.

## Architecture

Three files:

- **`index.html`** — canvas element + control panel UI (sliders, color pickers, mode select, buttons)
- **`main.js`** — all logic: WebGL setup, circle generation, animation loop, slider wiring, URL state
- **`style.css`** — control panel styling

### Rendering

WebGL fullscreen quad with a GLSL fragment shader. The shader receives up to `MAX_N=30` circles as `vec3` uniforms (`uCircles[N]`), each encoding `(x, y, radius)`. The SDF uses quadratic smooth-min (`smin`) to merge circles into a blob shape. `uK` controls the melt radius. Anti-aliasing: `clamp(d/0.8+0.5, 0.0, 1.0)`.

Canvas dimensions (`W`, `H`, `S=min(W,H)`) are fixed at page load — there is no resize handler.

### Circle layout

Two states stored as `Float32Array(MAX_N * 3)`:

- **`orderedData`** — circles evenly spaced along a parametric path (parabola-like curve, arc-length parameterised via 500-step numerical integration into `_cumLen[]`). Radius = `_spacing * P.orderedSize`.
- **`chaoticData`** — positions determined by `P.chaoticMode` (see below), with random size variation (`P.sizeVar`, `P.sizeRange`).
- **`liveData`** — linear lerp between the two: `orderedData + (chaoticData - orderedData) * currentEase`

Circles beyond `P.n` are parked at `(-99999, -99999, 1)` so they don't appear.

### Path geometry (`rebuild()`)

The path is controlled by parameters in `P`:
- `margin` — horizontal inset from canvas edges
- `depth` — vertical span of the curve
- `curve` — exponent shaping the parabola (higher = flatter top, sharper bottom)
- `sides` — smoothstep blend for horizontal distribution (0 = linear, 1 = S-curve)
- `pad` — minimum pixel clearance for circle clamping

`rebuild()` recomputes path + ordered positions + calls `randomiseChaotic()`. Called on any geometry slider change.

### Chaotic modes (`randomiseChaotic()`)

`P.chaoticMode` selects one of three scatter strategies:
- **`offset`** — circles follow the arc-length path but displaced by `±W*P.offset` / `±H*P.offset`
- **`island`** — circles clustered into `ceil(n/groupSize)` random island centres, spread by `1.5 * _spacing`
- **`random`** — fully random positions within canvas bounds

### Animation

`holdEase(t)` — smoothstep ramp up, hold at 1, ramp down, hold at 0; period = `(hold + ramp) * 2`.

In `autoMode`, each half-period triggers `randomiseChaotic()` (new scatter positions). On transition to ordered→chaotic (even half-periods), new chaotic positions are generated before the blend begins. Manual mode exposes a `blend` slider (`s-bl`) that directly sets `currentEase`.

### Control panel parameters (`P`)

| Key | Slider ID | Range | Effect |
|---|---|---|---|
| `n` | `s-n` | 5–30 | number of active circles |
| `kFactor` | `s-k` | 3–80 (÷1000) | SDF smooth-min radius = `S * kFactor` |
| `orderedSize` | `s-osz` | 10–80 (÷100) | circle radius in ordered state |
| `chaoticMode` | `s-mode` | offset/island/random | scatter strategy |
| `offset` | `s-off` | 0–25 (÷100) | position scatter in offset mode |
| `groupSize` | `s-gs` | 1–12 | circles per island cluster |
| `sizeVar` | `s-sz` | 20–200 (÷100) | base size multiplier in chaotic state |
| `sizeRange` | `s-var` | 0–150 (÷100) | random size variance |
| `margin` | `s-mg` | 2–30 (÷100) | path horizontal inset |
| `depth` | `s-dp` | 50–97 (÷100) | path vertical span |
| `curve` | `s-curve` | 5–80 (÷10) | path shape exponent |
| `sides` | `s-sides` | 0–100 (÷100) | horizontal distribution smoothing |
| `pad` | `s-pad` | 0–20 (÷100) | edge clearance |
| `hold` | `s-hold` | 1–30 (s) | hold duration |
| `ramp` | `s-ramp` | 1–30 (÷10 s) | transition duration |

### Wiring sliders

Use the `wire(sliderId, valId, displayFn, applyFn)` helper — it handles the `input` event, updates the display span, calls `apply`, and calls `updateURL()`. All sliders that call `rebuild()` or `randomiseChaotic()` should go through `wire()`.

### URL state

All parameters are serialised to the query string via `history.replaceState`. `updateURL()` is debounced 300ms to avoid hitting the browser rate limit. Batch updates (e.g. the random button) set `_suppressURLUpdate = true` during the loop, then call `updateURL()` once at the end. `applyFromURL()` runs once at startup to restore state from the URL.

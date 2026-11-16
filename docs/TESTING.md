# Testing

Windows 11, Node 22.14. Browser tests run against the production build (`vite preview`, port 5201) in two Playwright projects: **gpu** (every test, installed Google Chrome with hardware WebGL through ANGLE/Direct3D 11) and **software** (the tests tagged `@smoke`, Playwright's Chromium with SwiftShader, which picks the low-quality look). The pomeylo splash is skipped under automation unless the URL has `?splash`.

## Commands

| Check | Command | What it covers |
|---|---|---|
| Types | `npm run typecheck` | TypeScript strict, `noUncheckedIndexedAccess` |
| Unit | `npm test` | See below |
| Assets | `npm run validate:assets` | GLB sha256 = provenance, node set = contract, finite positions, unit normals, indices, baked `_TISSUE` on every mesh, anchors, attribution |
| Build | `npm run build` | Type check + production bundle |
| E2E | `npm run build && npm run e2e` | `tests/e2e/lab.spec.ts` and `tests/e2e/responsive.spec.ts`; screenshots in `docs/screenshots/` |

## Unit tests (`tests/unit`)

- `ear.test.ts`: the definition passes the validation gate with no warnings; one mesh structure per GLB node and per contract id; layers as in `docs/STRUCTURES.md`; https-only sources; modes and cameras; anchors and anatomical placement (canal lateral, stapes medial, incus behind malleus, cochlea in front of the vestibule, canal planes perpendicular, lateral canal pitched ≈ 30°); reducer basics; tour steps set their mode and cut; search.
- `ear-science.test.ts`: the pure science (`hearing.ts`, `balance.ts`, `audiology.ts`).
- `ear-sim.test.ts`: the simulation layer. Settings stay in range (`patchSim`), audiogram editing snaps to 5 dB and allows bone only to 4 kHz; every tour step's `params` is understood by the modes and the tour drives them (tone, close-up, case, cut) without touching the learner's own settings until "Try it yourself"; close-ups move the camera and show only their parts; a case highlights and frames its structures; your own audiogram points the 3D view at the chain (conductive) or the cochlea (sensorineural); ear pressure (standard atmosphere, hydrostatics, drum direction, thresholds in order, passive venting); A-weighting against tabulated values; drawing scales and the tone's output cap; model points (basilar-membrane path, canal arcs through their ampullae, the posterior-canal path into the utricle, the chain rocking the umbo in with the drum and the stapes medially, ossicle part labels on their bones); the balance simulation in time (a left turn excites the left lateral canal and inhibits the right with ampullofugal flow, nodding drives the vertical canals, spin-and-stop reverses the cupula, a drag turns the head).
- `closeHoles.test.ts`: cap closing on synthetic and model meshes.

## E2E scenarios (`tests/e2e/lab.spec.ts`)

1. Loads with no console errors; real colours; no details sheet (@smoke).
2. Clicking the model selects the structure under the pointer.
3. Search: "stirrup" selects the stapes; "CN VIII" finds the vestibulocochlear nerve; no-match message.
4. A group (auditory ossicles) lists its 3 parts; a part links back.
5. Colour by Layers changes the picture.
6. Layers hide the temporal bone and the vessels.
7. Isolate, Zoom to and Reset.
8. Camera presets change the view.
9. Labels: at least 3, none overlapping, text ≥ 11 px.
10. Cut: Front faces the front camera ("back part" kept), Flip faces the back, Off; no console errors.
11. Hearing: 1 kHz peaks 21 mm from the base and the 3D place label says so; the scene animates; 8 kHz moves the place under 10 mm (3D label follows); the slider at the bottom end peaks past 30 mm; 5 dB SPL is inaudible; the concert preset is "dangerous"; the optional tone starts only on a press and goes with the panel on a mode change.
12. Balance: shaking the head separates the left and right lateral afferents; a left turn turns the head icon; spin-and-stop runs (time advances, the eyes beat left during the spin); a 30° pitch shows a 30° tilt and the equivalent 4.9 m/s² acceleration.
13. Clinic: otosclerosis is conductive with a negative Rinne; noise-induced loss is sensorineural with a central Weber; sudden loss is severe with Weber to the left and a false-negative Rinne; building an audiogram by clicking gives conductive then sensorineural, and the arrow keys move a symbol 5 dB; a deeper implant reaches lower places.
14. Close-ups: ossicle part labels; the cochlear-duct key explains the stria vascularis; turning the head right excites the right lateral crista; the macula's otoconial layer; ear pressure bulges out on the way up, equalises with a swallow, and is pushed in on the way down; Dix–Hallpike is positive to the right and negative to the left; the Epley manoeuvre steps to 5 (otoconia in the utricle).
15. Guided tour: 24 steps; a step shows its mode and settings; "Try it yourself" opens Balance from the spin step; Finish returns to Anatomy.
16. Phone 390×844 (@smoke): no horizontal overflow; Structures from the dock; details follow a pick.
17. About: BodyParts3D and CC BY 4.0 credits.
18. `?nowebgl` (@smoke): fallback message; the structure list, Hearing and Balance panels still work.
19. Missing model (HTTP 404): error alert; Try again loads it.
20. Reduced motion: Hearing, Balance, Close-ups (cochlea, BPPV) and Clinic without errors.

`tests/e2e/responsive.spec.ts` runs at 390×844, 844×390, 768×1024, 820×1180, 1024×768 and 1366×820 (touch emulation below 1024 px): no horizontal scroll; title, modes, dock and sheet on screen and apart; room for the model; finger-sized controls; the sheet folds, opens and expands by tap, keyboard and drag; the picked structure's label stays above the sheet; closing by ✕, by a tap on empty space and by dragging down; a mode's panel keeps the mode buttons and cannot be dismissed; each simulation's main control is on screen and the 8 kHz preset works; every mode fits and scrolls to its end.

## Results (2026-11-16)

| Check | Result |
|---|---|
| `npm run typecheck` | **Pass** |
| `npm test` | **Pass**: 100/100 in 4 files |
| `npm run validate:assets` | **Pass**: 38 nodes, 247,678 triangles, 4.75 MB, sha256 `f4d9bfdf441f…` (regenerated with slimmer malleus head and incus body, re-baked with larger occlusion distances for the auricle and temporal bone) |
| `npm run build` | **Pass** (Vite warns about chunk size) |
| `npm run e2e` | **Pass**: 66/66 in 20.1 min (gpu 57: 20 lab + 37 responsive; software 9: the @smoke tests) |

Real-Chrome screenshots of every mode at 1366×820 and 390×844 are in `docs/screenshots/modes/`.

## Not verified

- Physical phones and tablets, Safari and Firefox (only Chrome's device emulation).
- The optional tone's actual loudness on a given device (the output gain is capped in code; the level slider describes the simulated sound).
- Anatomical, audiological and vestibular review by a specialist. The science modules follow the sources cited in them; some numbers are marked approximate in the code (the 14 and 16 kHz thresholds, the ISO 7029 coefficients, the drum pressure thresholds).

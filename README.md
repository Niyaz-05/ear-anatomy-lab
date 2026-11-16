# Human Ear — Interactive 3D Learning Lab

An interactive 3D right ear for university anatomy, physiology and audiology students: from the auricle through the canal, eardrum and ossicles to the cochlea, vestibule and semicircular canals, with the facial and vestibulocochlear nerves, inside a cut-away temporal bone. Works on phones and tablets (the details rise from the bottom in a sheet).

- **Real look.** Ivory bone, skin over the auricle, a pearly translucent eardrum, the ossicles, clear perilymph (pale aqua) and endolymph (lavender) spaces, cream-yellow nerves, a red carotid and a blue sigmoid sinus. "Colour" switches to **Layers**.
- **Anatomy explorer.** 38 structures and 7 groups with university-level summaries, functions, clinical notes and cited sources; search by name or synonym; layers; cuts (sagittal, coronal, axial) with filled cut faces; camera views including *Inside middle ear* and *Inner ear*.
- **Hearing.** Pick a tone (20 Hz–20 kHz, 0–130 dB SPL, presets, an optional capped tone): pressure fronts run down the canal, the drum and ossicles rock (malleus and incus about the ossicular axis, the stapes as a piston), the oval window goes in as the round window bulges out, and the travelling wave peaks at the tone's Greenwood place, marked on the cochlea and on an unrolled basilar membrane. Readouts: place, middle-ear gain, canal resonance, audibility, A-weighted level and safe daily exposure (NIOSH).
- **Balance.** Turn, nod or tilt the head (buttons, drag, or keep it moving): endolymph flow in each canal, the cupulae bending, push–pull firing of all six canals (Ewald), the eye-position trace, spin-and-stop with velocity storage, and the otoliths with the tilt–translation ambiguity.
- **Clinic.** Eleven teaching cases with standard audiograms (O/X air, </> bone), WHO grade and type, PTA, Rinne and Weber, tympanograms and the affected structures lit in 3D; build your own audiogram; the half-gain rule and a cochlear implant whose electrodes lie in the scala tympani.
- **Close-ups.** The ossicular chain with its parts and joints, a cut cochlea with one turn drawn enlarged (scalae, organ of Corti, hair cells, tip links), a crista and its cupula, the maculae and otoconia, ear pressure when flying or diving (the drum bulges; swallow to equalise), and BPPV: the Dix–Hallpike test and the Epley manoeuvre moving the otoconia round the posterior canal.
- **Guided tour.** 24 steps from the auricle to the cochlear implant; each step sets its mode (tone, head movement, case, close-up), and "Try it yourself" opens that mode with the step's settings.

**Educational only.** Not a clinical tool; not reviewed by an otologist or audiologist. The auricle, temporal bone and skull are BodyParts3D (DBCLS, CC BY 4.0); everything inside the bone is modelled for this lab from standard adult dimensions. See [public/ATTRIBUTION.md](public/ATTRIBUTION.md).

## Run

Requires Node.js ≥ 22.12.

```sh
npm install
npm run dev            # http://localhost:5200
npm run build          # type-check + production build → dist/
npm run preview        # http://localhost:5201
```

Add `?quality=high` or `?quality=low` to the URL to force a rendering quality.

## Check

```sh
npm run typecheck
npm test                         # unit tests (Vitest)
npm run validate:assets          # model hash, size, nodes vs docs/STRUCTURES.md, anchors, baked shading, attribution
```

## Rebuild the model

`public/models/ear.glb` is generated from a checkout of the Human Atlas (`github.com/Niyaz-05/human-atlas`, BodyParts3D 4.0):

```sh
npm run ear:make       # node tools/make-ear.mjs [<human-atlas>/public/models] && node tools/bake-shading.mjs
npm run validate:assets
```

`tools/make-ear.mjs` (about 2 minutes) keeps the right half of the BodyParts3D external ear, the right temporal bone and the rest of the skull, aligns the canal with the bony meatus it measures in the temporal bone, and models the other parts in code: signed-distance unions meshed with surface nets (ossicles, bony cochlea, vestibule, sacs, air spaces) and swept cross-sections (canal, scalae, basilar membrane, nerves, vessels). It writes the GLB, `src/ear/generated/geometry.json` (bounds and named anchors, see [docs/STRUCTURES.md](docs/STRUCTURES.md)), `provenance.json` (input hashes, measured dimensions and their sources, clearances), `src/ear/source/structures.source.json` and `public/ATTRIBUTION.md`. Both steps are deterministic.

## Layout

| Path | What |
|---|---|
| `docs/STRUCTURES.md` | The contract: mesh ids, layers, model frame, anchors |
| `src/contract/` | Simulation schema (zod), approved-asset registry, validation gate |
| `src/ear/` | Definition (structures, layers, routes, cameras, tour, sources), anchors, generated geometry and provenance; hearing, balance, audiology and ear-pressure science; `parts.ts`, the points and paths the simulations use (basilar membrane, canal arcs, ossicle parts, chain axis) |
| `src/app/` | Pure state reducer (modes, colour, cut, tour, simulation settings in `sim.ts`), the balance simulation in time (`live.ts`), drawing scales (`visual.ts`), optional tone (`tone.ts`), search, React context |
| `src/viewer/` | three.js / react-three-fiber scene: tissue material and lighting, ear model (bone window, cut caps), camera rig, labels; the simulations (`HearingScene`, `BalanceScene`, `CloseupScenes`, `PointLabels`) |
| `src/ui/` | Panels: structures (colour, cut, layers), details, the four mode panels with their charts, audiogram and schematics, tour, About |
| `tools/` | Model generation (`make-ear.mjs`, `sdf-lib.mjs`, `mesh-lib.mjs`), shading bake, asset validation |
| `tests/unit`, `tests/e2e` | Vitest and Playwright suites |

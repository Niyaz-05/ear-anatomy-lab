# Ear lab: structure ids (contract)

Every mesh node in `public/models/ear.glb` has one of these ids, and `src/ear/definition.ts` describes each one. The model shows the right ear. Its frame is in metres, with the origin at the centre of the tympanic membrane, +x lateral (out of the head), +y up and +z anterior. The skull and auricle are BodyParts3D; everything else is modelled in code (see `ATTRIBUTION.md`).

| Layer | Mesh ids |
|---|---|
| `bone` | `temporal-bone` (right, BodyParts3D; the viewer cuts a window into it around the middle and inner ear so they show), `skull` (rest of the skull, ghosted context) |
| `outer` | `auricle` (BodyParts3D external ear), `ear-canal-cartilage` (outer third), `ear-canal-bone` (inner two thirds), `tympanic-membrane` |
| `middle` | `malleus`, `incus`, `stapes`, `tensor-tympani`, `stapedius`, `tympanic-cavity` (ghosted air space), `mastoid-air-cells`, `auditory-tube` (pharyngotympanic / Eustachian tube) |
| `inner` | `cochlea` (bony shell), `scala-vestibuli`, `scala-media` (cochlear duct), `scala-tympani`, `basilar-membrane`, `oval-window`, `round-window`, `vestibule`, `utricle`, `saccule`, `anterior-canal`, `posterior-canal`, `lateral-canal`, `anterior-ampulla`, `posterior-ampulla`, `lateral-ampulla`, `endolymphatic-sac` |
| `nerves` | `cochlear-nerve`, `vestibular-nerve` (superior + inferior divisions), `vestibulocochlear-nerve` (trunk in the internal acoustic meatus), `facial-nerve`, `chorda-tympani` |
| `vessels` | `internal-carotid-artery`, `sigmoid-sinus` |

Groups (no geometry): `outer-ear`, `middle-ear`, `ossicles`, `inner-ear`, `cochlear-labyrinth`, `vestibular-labyrinth`, `semicircular-canals`.

Named anchor points live in `src/ear/generated/geometry.json` under `anchors` (metres, model frame; typed accessors in `src/ear/anchors.ts`). The simulations use them:
- `umbo`, `stapes-footplate` (centre of the footplate; `oval-window` is the same point), `round-window` (centre of the membrane)
- `cochlea-base` (centre of the cochlea's base, on the modiolus) and `cochlea-apex` (tip of the bony cupula), `cochlea-axis` (unit vector base → apex: antero-lateral-inferior)
- `cochlea-path`: 64 points along the middle of the basilar membrane from the base (round window) to the apex (helicotrema), each `{ p, mm, widthMm }`: position, distance from the base in mm (0 … about 35.8), basilar membrane width (0.1 → 0.5 mm)
- `canal-centres`, `canal-normals`, `canal-radii-mm` and `ampullae`, each keyed `anterior`, `posterior`, `lateral`: centre and unit normal of each canal's plane (normal by the right-hand rule going round the canal from its ampulla; flip as needed for an excitation convention), loop radius, ampulla centre. The three planes are mutually perpendicular: the lateral canal is pitched up 30° at the front, and the vertical canals stand at 45° to the sagittal plane, pitched back with it.
- `canal-entrance` (lateral opening of the ear canal), `ear-canal-path` (centre line, drum → entrance, 1 mm steps), `auditory-tube-pharynx`, `auditory-tube-tympanic`
- also: `tympanic-membrane-centre` (the origin), `tympanic-membrane-normal` (lateral face), `malleus-head`, `incus-body`, `lenticular-process`, `ossicular-axis` (two points: anterior process of the malleus → short process of the incus, the chain's rotation axis), `internal-acoustic-porus`, `geniculate-ganglion`, `stylomastoid-foramen`, `mastoid-antrum`, `vestibule-centre`, `utricle`, `saccule`

The window in the temporal bone is drawn by the viewer (`BONE_WINDOW` in `src/ear/anchors.ts`): an ellipsoid around the middle and inner ear inside which the bone's fragments are discarded, so the mesh stays closed for cut caps.

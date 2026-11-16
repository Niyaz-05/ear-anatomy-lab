# Attribution and asset provenance

## 3D ear model — `models/ear.glb`

### Source

**BodyParts3D 4.0**, © The **Database Center for Life Science** (DBCLS), licensed **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/). https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html

- Taken as converted by *Human Atlas* (github.com/Niyaz-05/human-atlas, commit `76f069640f2c3dd40a58d1556896ac25008f592e`); `atlas.json` sha256 `c359f4bcd2cba90b7411d66d5e9fc04dc81294d46cd5c1e8b212c824f2e5bbee`; chunk hashes in `src/ear/generated/provenance.json`.
- Used parts: the external ear (FJ2811, right half) → `auricle`; the right temporal bone (FJ3386) → `temporal-bone`; the other skull bones and the mandible (FJ3200, FJ3274, FJ3380, FJ3309, FJ3394, FJ3199, FJ3281, FJ3269, FJ3375, FJ3287, FJ3392, FJ3272, FJ3378, FJ3273, FJ3379, FJ3395, FJ3263, FJ3369, FJ3265, FJ3371, FJ3289) → `skull`.

Neither DBCLS nor BodyParts3D has reviewed or endorsed this lab.

### Changes made (as CC BY 4.0 requires)

`tools/make-ear.mjs`:
- Mirrored the BodyParts3D right side into the lab frame (metres, origin at the centre of the right tympanic membrane, +x lateral, +y up, +z anterior).
- Kept the right half of the external ear and moved it 7.5 mm laterally so the cartilaginous part of the canal fits between it and the bony meatus; subdivided twice and smoothed.
- Subdivided once and smoothed the right temporal bone; the viewer cuts a window into it around the middle and inner ear.
- Merged the other skull bones and the mandible and simplified them to about 22,000 triangles (shown ghosted).

### Parts modelled for this lab (not from BodyParts3D)

The ear canal (cartilaginous and bony parts), tympanic membrane, malleus, incus, stapes, tensor tympani, stapedius, tympanic cavity, mastoid air cells, auditory tube, cochlea (bony shell), scala vestibuli, scala media, scala tympani, basilar membrane, oval and round windows, vestibule, utricle, saccule, the three semicircular canals and their ampullae, endolymphatic duct and sac, vestibulocochlear nerve and its cochlear and vestibular divisions, facial nerve, chorda tympani, internal carotid artery and sigmoid sinus are built in code from standard adult dimensions, placed in the BodyParts3D temporal bone (the canal follows its external acoustic meatus). They are teaching models: shapes are simplified and real ears vary.

| Dimension | Model | Typical adult value | Sources |
|---|---|---|---|
| basilarMembraneLengthMm | 35.84725 | ≈33–35 mm uncoiled; width ≈0.1 mm at the base to ≈0.5 mm at the apex | pickles-2012 |
| cochlearCanalCentrelineMm | 29.863051 |  |  |
| cochleaBaseWidthMm | 9.599465 |  |  |
| cochleaHeightMm | 6.612207 |  |  |
| cochleaTurns | 2.6 | 2.5–2.75 turns; base ≈9 mm wide, ≈5 mm high | grays-42, openstax-hearing |
| anteriorCanalDiameterMm | 6.4 | loops ≈6.5 mm across (lateral smaller), lumen ≈0.8–1 mm, mutually ~perpendicular, lateral canal ~30° up anteriorly | grays-42, della-santina-2005 |
| posteriorCanalDiameterMm | 6.3 |  |  |
| lateralCanalDiameterMm | 5.8 |  |  |
| auditoryTubeLengthMm | 36.046848 | ≈36 mm, bony posterior third, antero-medio-inferior to the nasopharynx | grays-42 |
| earCanalLengthMm | 26.955312 | ≈25 mm (24–26), outer third cartilage, inner two thirds bone, S-shaped | grays-42, openstax-hearing |
| earCanalBonyMm | 16 |  |  |
| earCanalCartilaginousMm | 10.955312 |  |  |
| tympanicMembraneMm | 9.2 × 8.2 | 9–10 × 8–9 mm; cone ~2 mm deep at the umbo; ~55° to the canal floor | grays-42 |
| tympanicMembraneConeDepthMm | 2 |  |  |
| tympanicMembraneAngleToCanalFloorDeg | 55.00798 |  |  |
| malleusLengthMm | 8.024068 | 8–9 mm | grays-42 |
| incusLengthMm | 6.536955 | ≈7 mm (long process), short process ≈5 mm | grays-42 |
| stapesHeightMm | 3.180704 | ≈3.3 mm; footplate ≈3.0 × 1.4 mm | grays-42 |
| stapesFootplateMm | 3 × 1.36 |  |  |
| lateralCanalPitchDeg | 30 |  |  |
| canalLumenMm | 0.9 |  |  |
| canalPlaneAnglesDeg | anteriorPosterior 90, anteriorLateral 90, posteriorLateral 90 |  |  |
| basilarMembraneWidthMm | base 0.1, apex 0.5 |  |  |
| mastoidAirCells | 47 |  |  |

Sources: grays-42 = Standring S (ed.), *Gray's Anatomy*, 42nd ed., Elsevier 2020 (external, middle and inner ear); pickles-2012 = Pickles JO, *An Introduction to the Physiology of Hearing*, 4th ed., Brill 2012; della-santina-2005 = Della Santina CC et al., Orientation of human semicircular canals measured by three-dimensional multiplanar CT reconstruction, *JARO* 2005;6:191–206; openstax-hearing = Betts JG et al., *Anatomy and Physiology 2e*, §14.1 "Sensory Perception", OpenStax 2022 (CC BY 4.0). Cited for dimensions only; no text is copied.

`tools/bake-shading.mjs` then adds a per-vertex `_TISSUE` attribute (ambient occlusion and a noise value) for the real-tissue look.

<!-- output:start -->
The output is `models/ear.glb` (4,983,004 bytes, 247,678 triangles, sha256 `f4d9bfdf441f8941eb293f2569d677f9b29794f220f55a967e53ad2454d18fb3`).
<!-- output:end -->

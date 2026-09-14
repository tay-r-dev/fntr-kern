# UI refactor tickets

Spec: `docs/superpowers/UI-REFACTOR.md`. Elements: `docs/superpowers/UI-NOMENCLATURE.md` §14.
One agent per group, one commit per ticket. Branch `ui/ux-refactor`.

**Done:** 02 (did not reproduce), 03–28, 32–74.

| Group | Tickets | State |
| --- | --- | --- |
| Prefactor and model | 04 table, 05 panel merge, 06 width presets, 07 terminal presets | done. 06 and 07 are the model only; the preset tables are 67–74 |
| Autokern column | 08–11 | done |
| Pair table | 12–14, 19–22 | done |
| Pair table dropdowns | 15–18 | done. Manual matrices not run |
| Left sidebar | 23–28, 31 | 23–28 done. 31 waits on 30 |
| Metrics panel | 32–37 | done |
| Selection block | 38–44 | done. 39 and 41 manual matrices not run |
| Skeleton Generation | 45–49, 52, 53 | done. Manual matrices not run |
| Terminal and corners | 50, 51, 54–61 | done, manual matrices not run. 57 and 60 follow the 2026-09-14 serif decision (UI-REFACTOR §5.6) |
| Markers panel | 62–66 | done, manual matrices not run. Section eye leaves group switches alone |
| Skeleton settings | 67–74 | done, manual matrices not run. 70 and 74 follow the 2026-09-14 preset decisions |

**Waiting on a decision:** 80 canvas handles and the origin, 29 Tunni layer mapping, 30 skeleton switches,
75 corner distribution, 76 snapping master switch, 77 Detached, 78 contour
default width and Insertion, 79 heading icons.

**Not grouped:** 02 closed, did not reproduce in the panel; the canvas handles ignore the origin (80).

Shared elements built so far: the icon button's on state (11) and mixed state (47), the labeled
toggle (14), the shared table (04; cells, row actions, selection, column menu, window and grip since 2026-09-14), the multi-select dropdown (15), the header toggle and the freeze
helper (24), the compact scrub field (26), the segmented control (42), the chain (45), the overflow
button (48), the section preset control (56, `views-editor/src/preset-header-control.js`), the armed tooltip (65, `fontra-webcomponents/src/armed-tooltip.js`).

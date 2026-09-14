# UI refactor tickets

Spec: `docs/superpowers/UI-REFACTOR.md`. Elements: `docs/superpowers/UI-NOMENCLATURE.md` §14.
One agent per group, one commit per ticket. Branch `ui/ux-refactor`.

**Done:** 03–28, 32–38, 40, 42–49, 52, 53.

| Group | Tickets | State |
| --- | --- | --- |
| Prefactor and model | 04 table, 05 panel merge, 06 width presets, 07 terminal presets | done. 06 and 07 are the model only; the preset tables are 67–74 |
| Autokern column | 08–11 | done |
| Pair table | 12–14, 19–22 | done |
| Pair table dropdowns | 15–18 | done. Manual matrices not run |
| Left sidebar | 23–28, 31 | 23–28 done. 31 waits on 30 |
| Metrics panel | 32–37 | done |
| Selection block | 38–44 | 38, 40, 42–44 done. 39 waits on 02, 41 needs a decision |
| Skeleton Generation | 45–49, 52, 53 | done. Manual matrices not run |
| Terminal and corners | 50, 51, 54–61 | open |
| Markers panel | 62–66 | open |
| Skeleton settings | 67–74 | open |

**Waiting on a decision:** 29 Tunni layer mapping, 30 skeleton switches, 41 preserve aspect ratio,
57 one-sided serif, 75 corner distribution, 76 snapping master switch, 77 Detached, 78 contour
default width and Insertion, 79 heading icons.

**Not grouped:** 02, the reported origin fault. Reproduce it in the editor first.

Shared elements built so far: the icon button's on state (11) and mixed state (47), the labeled
toggle (14), the shared table (04), the multi-select dropdown (15), the header toggle and the freeze
helper (24), the compact scrub field (26), the segmented control (42), the chain (45), the overflow
button (48).

# 10: Autokern panel: Parameters dialog

**Status:** ready-for-agent

**Blocked by:** 08 (Autokern panel: title and section order)

## Today

A Parameters disclosure under Run holds Envelope reach, Envelope type, Reduction and Strength. The parameters controller binds each input and persists to local storage under `fontra-kerning-autokern-params.`.

## Target

1. A Parameters button sits right of Run on one row.
2. It opens a dialog with the four controls, bound to the same controller keys.
3. The disclosure is removed.

## Constraints

- Use the shared `modal-dialog`. Do not build a dialog.
- A changed value persists as soon as it changes, as today. Closing the dialog applies nothing further.

## Done when

- [ ] The four values survive a reload.
- [ ] A run started after a change uses the changed value.
- [ ] `cd src-js/views-kerning && npm test` passes.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Open Parameters, set Strength 0.5, close, Run | Run uses 0.5 |
| 2 | Reload, open Parameters | Strength reads 0.5 |

**Spec:** docs/superpowers/UI-REFACTOR.md §1.2. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.

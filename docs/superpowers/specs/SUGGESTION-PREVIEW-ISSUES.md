# Suggestion-preview feature: open issues

Everything the designer reported live-testing the suggestion-preview feature (backlog items 9+10,
`src-js/views-kerning/src/kerning.js`, `buildAutokernSuggestionVisualizationLayerDefinition` and
`initSuggestionPreviewSettingsSection`/`initSuggestionPreviewToggle`). **Nothing in this document is
resolved** — two code changes were made in the course of investigating it (see each item's own note),
but neither has been confirmed fixed by the designer, so both stay open until confirmed live. Written
so no report gets lost or silently marked done before it's actually verified.

---

## 1. Unrequested scope in the first delivery: "translucent letter" framing

**Report.** The worker that built the first version of this feature reported, as a "deliberate
divergence" / limitation, that the re-spaced glyph's own fill opacity is not independently adjustable
— framing it as a gap in what was delivered. The designer's response: nobody asked for that; it
shouldn't have been scoped in or called out as expected in the first place.

**Status.** Not a functional bug — a process note. No code change made or needed for this entry
itself; recorded here because the designer asked that everything be captured, and as a flag for
future worker briefs: don't present unrequested scope as an expected feature gap.

---

## 2. Master on/off should be an eye icon + hotkey in the preview pane, not a settings checkbox

**Report.** The first delivery put the master on/off switch in the right-pane settings accordion as a
checkbox. The designer's original ask (and backlog item 9's own wording) was an eye icon in the
preview pane's own upper-right corner, plus a keyboard shortcut.

**Change made (unverified).** Commit `cf356d97c` removed the accordion checkbox and added an
`<icon-button>` in the canvas's own upper-right corner plus a hotkey, wired to the same `enabled`
state the accordion's opacity/numbers/band controls still read. Not yet confirmed working live by the
designer — see item 4, which reports the hotkey half of this still not working after the change.

---

## 3. Unchecking "show numbers" or "show band" turns off the whole preview

**Report.** In the settings accordion, unchecking either the "show numbers" or "show highlight band"
checkbox disables the entire suggestion preview (including the glyph re-spacing), not just the one
element it's supposed to hide.

**Status — unresolved, cause not found.** Read `buildAutokernSuggestionVisualizationLayerDefinition`'s
draw function and `_applySuggestionPreviewRepositioning` directly: as committed, neither the
"showNumbers" nor "showBand" checkbox writes to the `enabled` setting, and glyph re-spacing is gated
only by `enabled`, not by either of these two. No code defect found by static reading. Two
possibilities, neither confirmed: (a) the designer was testing a stale, un-rebuilt bundle when this
was observed, or (b) there is a real defect somewhere not yet located (a live, tool-driven repro would
settle this, not another static read).

---

## 4. Hotkey doesn't work / doesn't refresh the preview

**Report.** The keyboard shortcut for toggling suggestion preview does nothing (or the preview doesn't
visibly refresh when it's pressed). Reported again, still broken, after a fix attempt.

**Change made (unverified).** The hotkey was originally registered with an uppercase `baseKey: "P"`.
This codebase's key-resolution path (`getBaseKeyFromKeyEvent` in `actions.js`) always resolves to a
lowercase letter, matching every other single-letter hotkey already in the tree (editor.js's
`q`/`z`/`d`/`s`/`a`/`w`/`r`/`t`/`x`, all lowercase) — an uppercase `baseKey` never matches, so the
hotkey silently never fired. Fixed to lowercase in commit `df8cc78ee`. The designer retested after
this and reported "P still doesn't work" — not yet explained. Most likely cause not yet ruled out:
testing against a bundle that hadn't been rebuilt/reloaded since the fix landed. Not confirmed either
way.

---

## 5. Selecting a glyph in the preview pane with the pointer tool turns off the preview

**Report.** Clicking to select a glyph directly on the canvas (preview pane), using the pointer tool,
turns off the suggestion preview.

**Status — unresolved, cause not found.** Traced every write path to `suggestionPreviewSettings`
(the settings object backing `enabled`/`opacity`/`showNumbers`/`showBand`), every place
`_selectedPairLeft`/`_selectedPairRight` get set (only `selectPairForScene`, called only from a
results-table row click — never from canvas pointer-tool selection), the visualization layer's
visibility bookkeeping (`VisualizationLayers.toggle`/`visibleLayerIds`, and
`newVisualizationLayersSettings`, which explicitly skips non-user-switchable layers — this layer is
one), and the `sceneSettingsController.selectedGlyphName` listener (which only updates the
results-table glyph filter, not the canvas's own displayed text or chip mode). No code path found by
static reading that connects a pointer-tool canvas selection to this feature's on state. Needs a live
repro to actually catch, not further static reading.

---

## 6. No overlay shows until a glyph/pair is selected with the kerning tool active

**Report.** Despite the preview being on by default, no overlay (band + "suggest: N" label) appears
until a glyph is selected with the kerning tool turned on.

**Likely real, distinct gap identified (not yet fixed).** The band and numeric label are drawn only
when `this._chipMode === "pair"` — the draw function returns immediately for any other mode, before
ever reaching the band/label drawing code. In phrase mode, only the silent glyph re-spacing (item 10's
core ask) runs; no band, no label, for any pair, ever. This does not match the original combined ask
("both phrase and pair modes" for the whole overlay, not just quiet re-spacing in one of them). Pair
mode's own gating (band/label require an actual selected pair, which today only comes from a
results-table row click) may also be part of what reads as "nothing shows until you select something"
— that part might be working as designed for pair mode specifically, but phrase mode's total lack of
any visible band/label is very likely a real, unaddressed gap. Not yet fixed.

---

## 7. Holding Space to pan/drag the preview also turns off the suggestion preview

**Report.** Holding Space (the temporary hand-tool shortcut, used to pan the preview) also turns off
the suggestion preview.

**Status — unresolved, cause not found.** No code in this feature or in `VisualizationLayers`
references the active tool, Space, or hand-tool state at all — the draw function's only gates are
chip mode, `_selectedPairLeft`/`_selectedPairRight`, cache-entry presence, and the `enabled` setting.
No connection found by reading the code. Possibly related to whatever is causing items 3/5 — a common
cause affecting several of these reports would explain more than one at once, but that's a hypothesis,
not a finding.

---

## Common thread across items 3, 5, 6, 7

Four separate reports of the preview "turning off" or "not showing" under different actions (toggling
a sub-setting, selecting a glyph, panning, and simply being in phrase mode) were each investigated by
reading the relevant code paths directly; only item 6 turned up a concrete, explainable cause (phrase
mode's draw function returns before ever drawing a band/label). The other three did not yield a cause
under static reading. A live, interactive repro — actually reproducing one of them and inspecting the
running state at the moment it happens — is what would settle whether items 3/5/7 share item 6's cause,
share some other single cause, or are three separate defects.

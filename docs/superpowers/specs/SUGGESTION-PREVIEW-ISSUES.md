# Suggestion-preview feature: open issues

Everything the designer reported live-testing the suggestion-preview feature (backlog items 9+10,
`src-js/views-kerning/src/kerning.js`). **Nothing here is confirmed fixed until the designer says so
live.** The 2026-09-06 investigation found one root cause behind five of the six reports, and the
fix for it is written but unverified.

---

## The root cause: the preview was one repaint behind

`VisualizationLayers.drawVisualizationLayers` walks its definitions array in plain array order and
never sorts. Only `registerVisualizationLayerDefinition` inserts by `zIndex`, and this view does not
use it -- the constructor builds its layer list by spreading the shared array and **appending** its
own suggestion layer. So the layer's declared `zIndex: 195` had no effect and it drew **last**, after
`fontra.context.glyphs` (zIndex 200) had already painted every glyph.

The glyph re-spacing ran inside that layer's draw function. It mutated each positioned glyph's `x`
after every glyph was already on screen, so the picture always showed the positions computed on the
**previous** repaint.

Every symptom below follows from that one fact.

**Fix (written, unverified).** `_applySuggestionPreviewRepositioning` moved out of the layer's draw
and into the scene-view draw callback in the constructor, where it runs once per frame before any
layer draws. It also now records each pair's suggestion per positioned glyph in
`this._previewPairValue`, which the layer draws from, so the shift and the overlay can never
disagree about which pairs have a value.

---

## 1. Master on/off should be an eye icon + hotkey -- CLOSED

Commit `cf356d97c` replaced the accordion checkbox with an `<icon-button>` in the canvas's own
upper-right corner. The designer confirmed the eye icon exists and works. Kept here only as context
for item 3.

---

## 2. Unchecking "show numbers" or "show band" turns off the whole preview

**Explained by the root cause.** Neither checkbox writes to `enabled`, and static reading found no
defect in the gating -- that part of the earlier investigation was right. What the checkbox does is
request a repaint, and that repaint was what finally revealed whatever shift was still pending from
an earlier toggle. The preview appeared to switch off because a checkbox click was the first thing
to redraw it after it had already been switched off.

---

## 3. The P hotkey does nothing

**Explained by the root cause. The designer proposed this reading and it holds.** The hotkey fires,
the setting flips, and a repaint is requested -- but that repaint drew the previous frame's glyph
positions, so nothing on screen changed. In phrase mode there was no band and no label either (item
5), so the re-spacing was the only visible effect the key had, and it was exactly the thing that
lagged.

This also explains why the number keys 1 to 3 work: switching tools changes the tool chrome
immediately, with no dependence on the canvas repaint.

The lowercase `baseKey` correction in `df8cc78ee` was still necessary. An uppercase key never
matches, so both faults had to be fixed for the key to work.

---

## 4. Clicking a glyph with the pointer tool turns off the preview

**Explained by the root cause.** The click turns nothing off. It forces a repaint, and the repaint
shows the state of the last toggle. Turning the preview off left the glyphs sitting shifted until
some unrelated action redrew them, so the un-shift landed on the click and read as the click causing
it.

---

## 5. No overlay until a glyph is selected -- two separate faults

**First half: the root cause.** The first repaint after a run drew the band but left the glyphs
unmoved. They moved on the next action, whatever it was.

**Second half: phrase mode drew no overlay at all.** `if (this._chipMode !== "pair") return;` sat
above every band and label line, so phrase mode got the silent re-spacing and nothing visible. This
was a real, separate gap and it did not match the original ask.

**Fix (written, unverified).** The mode guard is gone. Phrase mode draws a band per adjacent pair
with its number in glyph space above its own gap. Pair mode is unchanged: one band over the selected
pair, with the pinned "suggest: N" heads-up label the designer asked for on 2026-09-06.

---

## 6. Holding Space to pan turns off the preview

**Explained by the root cause**, exactly as item 4. Panning repaints, and the repaint is what showed
the change.

---

## What still needs live confirmation

All of the above. In particular: the P hotkey, phrase mode's new per-pair bands and numbers, and
that toggling the eye icon now changes the picture on the same press rather than on the next click.

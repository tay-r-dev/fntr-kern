# Bulb terminal comparison

Open `bulb-comparison.html` directly. It is self-contained and needs no server.
It compares one cubic skeleton with a bulb at its end, using actual generated
outlines for 72 combinations of Size, Shape and Easing. Both panels use the same
scale. The dashed overlay is the complete stroke without a bulb.

`bulb-before.json` records the old generator at commit `635a1d3aa`, before the
endpoint-rib change. It includes the source curve, unmodified stroke and settings.
The new output is generated from the current source, never drawn by hand.

To refresh the page from the repository root:

```
node scripts/make-bulb-comparison.mjs
```

An optional second argument writes the inline comparison fragment to that path.
`bulb-comparison.template.html` is the editable page fragment.

The ball is constructed at the outer rib end with a forward Size radius
(half the diameter). Shape stretches its rear half. The emitted entry then
V-slides toward the next ball point to match curvature; its preceding wall
segment is refit by the same operation used by the editor's V modifier. If
that interval cannot reach harmony, the shared harmonizer adjusts only the
wall handles. The ball arc remains fixed.

Intermediate ball points are the true horizontal/vertical extrema in glyph
coordinates, with axis-aligned handles. The neck attachment is explicitly
exempt: it keeps the existing inner-wall cut and easing construction. Zero
easing keeps a crisp incision; small balls retain their bridge neck.

Points and handles are shown by default. Both panels use actual generated
outlines, and the new panel uses the current working-tree generator.

Validation: all 72 settings and all toggles exercised in a DOM runtime, with no
script errors; default and maximum geometry inspected in a static rendering.
The available headless browser could not run, so browser layout and live-editor
checks remain manual. The editor matrix is in the development log.

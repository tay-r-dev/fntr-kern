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

The new Easing value adds forward approach length. It no longer cuts back into
the inner wall. New joins preserve tangents; they do not force matching curvature.
The ball's fixed arc points follow its own frame rather than the glyph axes.

Validation: all 72 settings and all toggles exercised in a DOM runtime, with no
script errors; default and maximum geometry inspected in a static rendering.
The available headless browser could not run, so browser layout and live-editor
checks remain manual. The editor matrix is in the development log.

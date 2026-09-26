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

The new ball's outer apex is the outer rib end. Its front projects one Size
radius beyond the rib (half the ball's diameter). Shape stretches only its rear
half. Easing again cuts back along the inner wall and rounds the ball-to-wall
neck, using the former crossing and neck construction. The outer wall is kept
complete. Zero easing keeps a crisp incision; a ball that cannot reach the inner
wall uses the short bridge neck. Ball arc points follow the rib frame.

Validation: all 72 settings and all toggles exercised in a DOM runtime, with no
script errors; default and maximum geometry inspected in a static rendering.
The available headless browser could not run, so browser layout and live-editor
checks remain manual. The editor matrix is in the development log.

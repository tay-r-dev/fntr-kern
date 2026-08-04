# forkra Glossary

**Date:** 2026-08-04

The words this project uses, in one place. Two groups: the general type-design and
typography words that the features assume you know, and the words forkra itself
invented or gave a specific meaning to.

Each forkra term gives the one canonical name. If a term has an old name, this doc
says so and marks the old name dead. Use the canonical name in code, in the user
interface, and in these docs.

---

## 1. Type design and typography

### Letter anatomy

**Glyph** — one drawn character in a font. A glyph is not a letter. One letter can
have many glyphs, and one glyph can carry no letter at all.

**Outline** — the filled shape of a glyph, drawn as one or more closed contours.
The outline is what the renderer fills.

**Contour** — one closed loop of points and handles. A glyph outline has an outer
contour and, where the letter has a hole, one or more inner contours.

**Counter** — the enclosed or partly enclosed space inside a letter. The hole in an
**o** is a counter. In outline terms a counter is an inner contour that winds
against the outer one.

**Winding** — the direction a contour runs, clockwise or counter-clockwise. The
renderer uses winding to decide which regions to fill. An inner contour must wind
against its outer contour or the counter fills solid.

**Stem** — the main upright stroke of a letter.

**Flank** — the side wall of a stem. The serif work uses this word for the edge the
terminal attaches to.

**Terminal** — how a stroke ends. A terminal can be plain, or it can carry a shape
such as a serif or a ball.

**Serif** — the small stroke across the end of a main stroke. A serif has two
**wings**, one each side, joined to the stem by a **bracket**.

**Bracket** — the curve that joins a serif wing to the stem flank.

**Sidebearing** — the space between the glyph outline and the edge of its advance
width. There is a left sidebearing and a right sidebearing.

**Advance width** — how far the pen moves after it draws a glyph. Outline plus both
sidebearings.

**UPM** (units per em) — the size of the design grid, most often 1000 or 2048. Every
coordinate in a font is in these units. A measurement that is **UPM-relative** scales
with the design grid instead of assuming one size.

**Alignment zone** — a horizontal band where many glyphs start or stop, such as the
baseline or the x-height. Feet and terminals sit on these bands.

**Overshoot** — how far a round shape passes an alignment zone, so that it looks the
same height as a flat shape.

### Curves and points

**On-curve point** — a point the outline passes through.

**Off-curve point** (also **control point**, or **handle**) — a point the outline
does not pass through. It sets the direction and the strength of the curve.

**Cubic** — a curve segment with two on-curve ends and two off-curve controls. Every
curve in forkra is a cubic.

**Segment** — the piece of contour between two adjacent on-curve points. A segment
is either a straight line or a cubic.

**Smooth point** — an on-curve point where the two handles stay in one straight line
through it. The outline has no visible corner there.

**Corner point** — an on-curve point that is not smooth. The two sides meet at an
angle.

**Cusp** — a corner so sharp that the two sides almost fold back on each other.

**Tangent** — the direction the curve travels at a point.

**Colinear** — on one straight line. A smooth point holds its two handles colinear.

**Curvature** — how tightly a curve bends. The inverse of the radius of the circle
that best matches the curve at that place.

**G2 continuity** — two segments meet with the same tangent **and** the same
curvature. A join that is only tangent-continuous can still show a visible break in
the light along the edge.

**Tension** — how far a handle reaches from its on-curve point toward the point where
the two end tangents cross. Tension 0 puts the handle on its own end. Tension 1 puts
it on the crossing point. A circular arc sits at 0.5523.

**Tunni point** — the point where the two end tangent rays of a cubic cross. Dragging
it changes both handles together. Named for Eduardo Tunni.

**Offset curve** (also **parallel curve**) — the curve you get by moving every point
of a source curve the same distance along its own normal. A cubic offset of a cubic is
in general **not** a cubic, which is why forkra fits one instead of computing one.

**Normal** — the direction perpendicular to the tangent.

**Miter** — the average of the two normals at a corner point, used to place geometry
that must serve both sides of the corner.

### Fonts and variation

**Master** (also **source**) — one complete drawing of a font at one point in the
design space, such as Light or Bold.

**Interpolation** — computing an in-between drawing from two or more masters. Two
masters interpolate only if their glyphs have the same point count in the same order.

**Design space** — the set of axes a variable font varies over, such as weight and
width.

**Kerning** — a per-pair spacing correction between two glyphs.

**Spacing** — the sidebearings of a single glyph, as opposed to kerning between two.

---

## 2. forkra terms

### The skeleton

**Skeleton** — the centerline drawing the designer edits. It is an ordinary path of
points and handles, plus a stroke width at each on-curve point. It is not the outline.

**Centerline** — one skeleton contour. The line the stroke is built around.

**Stroke** — the band of ink the generator builds around a centerline.

**Generated contour** — an outline contour that the generator produced from a
skeleton. It exports, renders and interpolates like a hand-drawn contour. The editor
knows which contours are generated and protects them.

**Generator** — the code that turns a skeleton into outline contours. It runs on
every edit.

**Rib** — the stroke width at one skeleton point, drawn as a bar across the
centerline. A rib has two ends, one each side, and both ends drag.

**Side** — left or right of the centerline, in the direction the contour runs. Every
per-point width, cap and handle field exists once per side.

**Half-width** — the distance from the centerline to one edge. Two half-widths make
the full stroke width.

**Width cascade** — the rule that finds a half-width: the point's own side width, or
half the point's width, or half the contour default. A point that stores nothing
follows the contour default live.

**Tied ribs** — two or more ribs forced to one shared offset because a smooth point
with only one handle sits on the straight between them. That point has no direction of
its own, so the straight sets it. Turned off per straight with the **Tied ribs** panel
option.

**Single-sided contour** — a contour with all its width on one side. The other edge
lies exactly on the skeleton.

**Collapsed side** — a side under about 0.5 units. It copies the skeleton exactly
instead of running the offset construction. This is what makes single-sided contours
exact.

**Cap** — how an open contour end closes. The five styles are **butt**, **round**,
**square**, **drop** and **serif**. They are mutually exclusive. forkra added the last
two.

**Corner rounding** — replacing a sharp generated outline corner with an arc. Set per
skeleton point, and it can differ per side.

**Nudge** — a displacement of a generated on-curve point along its own tangent. It is
applied after the generator builds the shape, never before.

**Handle nudge** — the part of a nudge that also carries the adjacent handles. A
plain nudge leaves them alone.

**Editable generated geometry** — a generated point or handle the designer marked
editable and moved off its computed place. It stays generated.

**Detached handle** — a generated handle the designer placed at an absolute position.
The construction no longer sets it.

**Provenance** — the map from a generated point back to the skeleton point, side and
role that made it. The generator emits it forward. Nothing recovers it by comparing
coordinates.

**Stable id** — an id on a skeleton contour or point that is never reused. Selection,
provenance and undo hold ids, not array positions.

**Modifier behavior** — a named editing behavior held as a key during a drag:
**D** fixed rib, **S** fixed rib compress, **X** equalize, **Z** tangent-only. They
are behavior names inside the editing rules, not flags that bypass them.

**Rib angle lock** — forcing a rib onto the horizontal or the vertical axis instead
of the normal the geometry computes. Offered at open-contour ends.

### The generated-contour controls

**Gizmo** — an on-screen control drawn from geometry and dragged to write a value.

**Curvature gizmo** — the gizmo on a generated cubic that sets the segment curvature.
It sits on the curve at the halfway point.

**Curvature pin** — the tension number a curvature gizmo drag stored. Regeneration
reproduces the number whatever the skeleton did since. A pin is permanent. Where the
geometry cannot reach it, the output clamps and the stored number stays.

**On-curve gizmo** — the gizmo that slides a generated segment's two ends along the
outline. It sits off the curve, along the outward normal.

**Construction segment** — the full segment the generator solved, published on
provenance where a terminal trimmed the emitted one shorter. Read a generated
segment's shape through this, never from the emitted points.

**Natural solver** — the code that picks the two handle lengths of a generated cubic
automatically. It fits fixed samples of the true offset and pulls toward the
skeleton's own tension, in one convex problem with one answer.

**Handle domain** — the range each generated handle length may take. The floor is one
unit. The ceiling is the true forward tangent intersection, which is where the handles
would start to cross.

**Pull ratio** — how strongly the natural solve leans toward the skeleton's own
tension instead of the offset samples. Computed from the input only. It never reads
the answer.

### The serif terminal

**Serif frame** — the coordinate frame the terminal is built in. The origin is the
skeleton end point. **u** runs along the serif axis toward the left side. **v** is
depth, back into the stroke.

**Serif axis** — the direction the serif runs across the stroke. Set by `axisMode`:
perpendicular, horizontal, vertical or absolute. It composes with the rib angle lock
instead of replacing it.

**Half** — one wing of the serif, left or right, with its own nine fields. A
**linked** flag copies the left onto the right.

**Wing** — one arm of the serif, from the stem out to the tip.

**Attractor** — the one point both bracket handles aim at. **Concavity** places it
between the chord midpoint and the wing inner corner. **Tension** is how far the two
handles travel toward it.

**Contour easing** — rounding the corner where the bracket meets the stem flank.
`easeDistance` sets how much of each surface it eats. `easeCurvature` sets how full
the rounding is.

**Release** — the place the terminal takes over from the stroke edge. It sits on the
flank line at a depth the serif's own numbers set. The edge is brought to it, never
the reverse.

**Underside cup** — one curve across the whole foot of the terminal, tip to tip. Its
center sits on the skeleton, not at the midpoint of the two tips.

**Serif units mode** — whether the five distance fields are absolute units or a
multiple of the stroke width.

### Other features

**Coarse grid** — a snapping grid with presets, held in application settings and
never written to a project file.

**Q-measure** — the realtime measurement overlay held on the **Q** key. **Alt+Q**
gives direct mode.

**SpeedPunk** — the curvature comb overlay. It draws a spine off the outline whose
length tracks curvature, so a break in the light shows as a break in the comb.

**Letterspacer** — automatic sidebearings from the shape of the glyph, in the
HTLetterspacer manner. Its terms are **area**, **depth** and **overshoot**.

**Point labels** — per-segment distance, tension and angle readouts. Formerly called
"Tunni Labels". That name is dead. The skeleton has its own separate label layer.

**Corner overlap** — adding a deliberate overlap at a corner so that the rendered
join stays clean.

### Project words

**Donor** — the older fork the skeleton geometry came from. It sits read-only at
`_external/skeleton`. It is a behavior reference, never a source to copy plumbing
from.

**Upstream** — the Fontra project forkra is built on.

**Rail** — a constraint every feature obeys, listed in the architecture map. Breaking
one gives you a regression the tests cannot catch.

**Owned file** — a file one feature is responsible for. A **shared file** carries
hunks from more than one feature.

**Workstream** (WS-n) — one numbered block of the build program.

# forkra Glossary

**Date:** 2026-08-04

The words this project uses, in one place. Two groups: the general type-design words that the
features assume you know, and the words forkra invented or gave a specific meaning to.

Every entry starts with what the thing **is** or what you would **see**. The rule or the
consequence comes after. Where a term has an old name, this doc marks the old name dead. Use the
canonical name in code, in the interface, and in these docs.

---

## 1. Type design and typography

### Letter anatomy

**Glyph** — one drawn character. A glyph is not a letter. The letter **a** can have several
glyphs, and a glyph such as a comma carries no letter at all.

**Outline** — the black shape of a glyph. It is what gets filled and printed.

**Contour** — one closed loop of the outline. A **c** is one loop. An **o** is two: the outside
and the hole.

**Counter** — the white space a letter encloses. The hole in an **o**, the two holes in a **B**,
the open bowl of a **c**. In outline terms, a fully enclosed counter is an inner contour.

**Winding** — the direction a loop runs, clockwise or counter-clockwise. The fill rule uses it to
decide black from white. The hole in an **o** must run the opposite way from the outside, or the
**o** fills in solid.

**Stem** — the main upright of a letter. The vertical of an **l**, the two verticals of an **n**.

**Flank** — the side wall of a stem. Run your eye up the left edge of an **n**: that is the flank.

**Terminal** — the end of a stroke. Look at the bottom of an **f**, the top of an **a**, the two
ends of an **s**. Each can be cut flat, rounded, given a ball, or given a serif.

**Serif** — the little cross-stroke at the end of a main stroke. The feet and the head of a Times
**n**. It has two **wings**, one either side, each joined to the stem by a **bracket**.

**Bracket** — the curved fillet between a serif wing and the stem. It is what makes a serif look
grown out of the stem rather than glued on.

**Sidebearing** — the white margin either side of a glyph. Too much and the word looks loose. Too
little and the letters touch.

**Advance width** — the whole horizontal step the pen takes for a glyph: the black, plus both
sidebearings.

**UPM** (units per em) — the size of the square the glyph is drawn in, usually 1000 or 2048 units.
All coordinates are in these units. A measurement that is **UPM-relative** keeps its proportion
whatever that square's size is, instead of assuming 1000.

**Alignment zone** — a horizontal band where many letters begin or end: the baseline, the
x-height, the cap height. Feet and terminals sit on these bands so that a line of text looks level.

**Overshoot** — the small amount a round letter passes an alignment zone. An **o** is drawn
slightly taller than an **x**, because a curve that stopped exactly on the line would look short.

### Curves and points

**On-curve point** — a point the outline passes through. It is on the ink edge.

**Off-curve point**, also **control point** or **handle** — a point the outline does not touch. It
pulls the curve toward itself. Move it, and the curve leans that way.

**Cubic** — a curve with two on-curve ends and two handles. Every curve in forkra is one of these.

**Segment** — the stretch of outline between two neighbouring on-curve points. It is either a
straight line or a cubic.

**Smooth point** — an on-curve point where the two handles lie in one straight line through it, so
the curve runs through without a kink. The join at the middle of an **S**.

**Corner point** — an on-curve point where the two sides meet at an angle. The bottom corners of an
**A**.

**Cusp** — a corner so tight the two sides almost fold back on themselves. The inside of the joint
where the bowl of a **b** meets its stem.

**Tangent** — the direction the curve is travelling as it passes a point. Lay a ruler against the
curve there.

**Colinear** — lying on one straight line. A smooth point keeps its two handles colinear.

**Curvature** — how hard the curve is bending. Fit a circle against the curve at that spot: a
small circle means high curvature, a big circle means nearly straight.

**G2 continuity** — two segments meet with the same direction **and** the same bend. If only the
direction matches, the join still catches the light as a faint flat spot, which a type designer
sees immediately at large sizes.

**Tension** — how far a handle is pushed out from its point, as a fraction of the way to where the
two end tangents cross. At 0 the handle sits on its own point and the segment is straight. At 1 it
sits on the crossing point and the curve is as full as a single cubic gets. A circle needs 0.5523.

**Tunni point** — the spot where the two end tangents of a segment cross. Drag it and both handles
move together, so the curve fills out or flattens as one. Named for Eduardo Tunni.

**Offset curve**, also **parallel curve** — the line you get by walking along a curve and stepping
the same distance sideways at every point. It is what a stroke of constant width traces. The catch:
the offset of a cubic is almost never itself a cubic, so forkra has to fit one to it. That fit is
where most of the hard math in this project lives.

**Normal** — the sideways direction at a point, square to the tangent. A rib runs along the normal.

**Miter** — at a corner, the average of the two sides' normals. It is the direction that splits the
corner evenly, the way a mitered picture frame joint does.

### Fonts and variation

**Master**, also **source** — one complete drawing of the font at one design position, such as
Light or Bold.

**Interpolation** — computing the in-between weights from two masters. It works only if the two
drawings have the same number of points in the same order. This is why point counts matter so much
in this project.

**Design space** — the axes a variable font moves along: weight, width, optical size.

**Kerning** — a spacing correction for one specific pair of letters, such as **AV**.

**Spacing** — the sidebearings of a single glyph, which apply next to every letter. Kerning is the
exception; spacing is the rule.

---

## 2. forkra terms

### The skeleton

**Skeleton** — the centerline you draw instead of the outline. Think of it as the path a broad
pen nib travels. It is an ordinary path of points and handles, and each on-curve point also carries
a stroke width.

**Centerline** — one skeleton contour. The spine the stroke is built around.

**Stroke** — the band of black laid down either side of a centerline.

**Generated contour** — an outline the machine built from a skeleton. Once built it behaves like
any hand-drawn outline: it exports, renders and interpolates the same. The editor knows which
contours are generated and stops you from cutting into them by hand.

**Generator** — the code that turns a centerline into filled outlines. It reruns on every edit, so
the outline follows the cursor live.

**Rib** — the width at one skeleton point, drawn on screen as a bar lying across the centerline,
like a rung on a ladder. Grab either end and the stroke gets fatter or thinner there.

**Side** — left or right of the centerline, taken in the direction the contour runs. Widths, caps
and handle settings all exist once per side, so a stroke can be fat on one side and thin on the
other.

**Half-width** — the distance from the centerline out to one edge. The two half-widths added
together are the visible stroke width.

**Width cascade** — where a rib's width comes from when you have not set it. The point's own side
width, or half the point's own width, or half the contour's default. A point that stores nothing
follows the contour default, so changing one number reweights the whole contour.

**Tied ribs** — two ribs forced to the same offset because the straight between them has a smooth
point sitting on it with only one handle. That point cannot choose its own direction, so the
straight dictates it, and the two ends must agree or the straight would come out bent. Turned off
per straight, with the **Tied ribs** option.

**Single-sided contour** — all the width on one side. The other edge lies exactly on the line you
drew, so the skeleton itself becomes the edge of the letter.

**Collapsed side** — a side so thin, under about half a unit, that it is treated as lying on the
skeleton exactly. It is what makes a single-sided stroke come out clean instead of nearly clean.

**Cap** — how the generator closes an open end: **butt** cut flat, **round**, **square** projecting
past the end, **drop** swelling into a ball, or **serif**. One end has one cap. forkra added the
last two.

**Corner rounding** — softening the sharp outline corner that a kinked centerline produces. Two
numbers per side of the stroke: a **distance** back along each arm, in units, and a **curvature**
saying how full the arc is. The two sides start linked and can be unlinked.

**Nudge** — sliding a generated outline point along its own edge, without changing the stroke.
Applied after the shape is built, so it never disturbs the curve fitting.

**Handle nudge** — the part of a nudge that also drags the neighbouring handles along. A plain
nudge leaves them behind.

**Editable generated geometry** — a generated point or handle you have taken hold of and moved off
where the machine put it. It stays generated, and the rest of the outline still follows the
skeleton.

**Detached handle** — a generated handle you have placed by hand at an absolute spot. The
construction stops setting it.

**Provenance** — the label every generated point carries saying where it came from: which skeleton
point, which side, and what job it does. A point on the outline effectively says "I am the left
edge of point 3." So when you drag point 3, the editor already knows which outline points are its
own and moves them. The alternative, which forkra refuses to do, is to guess afterward by looking
for whichever outline point happens to lie nearest — that guess is what broke the older fork.

**Stable id** — the permanent name a skeleton point or contour keeps for life, never reused.
Selections, undo and provenance all refer to points by these names rather than by position in a
list, so inserting a point in the middle cannot silently make a selection point at its neighbour.

**Modifier behavior** — a key held during a drag to change what the drag means: **D** fixed rib,
**S** fixed rib compress, **X** equalize, **Z** tangent-only. They are named behaviors inside the
editing rules, not switches that skip the rules.

**Rib angle lock** — forcing a rib to lie flat horizontal or dead vertical, whatever angle the
centerline arrives at. Offered at open ends, where it makes a terminal square up with the baseline
instead of leaning with the stroke.

### The controls on a generated outline

**Gizmo** — a handle drawn on screen that is not part of the letter. You drag it, and it writes a
value.

**Curvature gizmo** — the control sitting on the middle of a generated curve. Drag it outward and
the curve fills out. Drag it inward and the curve flattens.

**Curvature pin** — the fullness you set with that gizmo, remembered as a number rather than as a
position. Move the skeleton afterward and the curve keeps that fullness. A pin is permanent: if
the geometry cannot reach the value, the shape stops at the limit and the stored number waits
until it can.

**On-curve gizmo** — the control that slides a generated segment's two ends along the outline,
spreading them apart or drawing them together. It sits just off the curve so it does not sit on top
of the curvature gizmo.

**Construction segment** — the full curve the generator solved, before a terminal trimmed a piece
off the end of it. Anything measuring the curve must measure this one. Measuring the trimmed
leftover gives a number that describes a different curve, which is how a gizmo ends up jumping on
first touch.

**Natural solver** — the code that decides how long the two handles of a generated curve should be.
It compares its answer against the true parallel curve at five fixed places, and leans it toward
the shape of the skeleton you drew. It has exactly one answer for any input, which is why the
outline does not shimmer while you drag.

**Handle domain** — how long a generated handle is allowed to be. Never under one unit, and never
past the point where the two handles would cross and loop the curve.

**Pull ratio** — how strongly the solver leans toward the skeleton's own curve shape instead of
the true parallel curve. It is decided from the skeleton and the widths before the solve, never
from the result.

### The serif terminal

**Serif frame** — the little coordinate system the serif is built in, standing at the end of the
stroke. **u** runs across, along the serif. **v** runs down into the stroke. Everything about the
serif's shape is described in this frame, not in the glyph's coordinates.

**Serif axis** — the direction the serif runs across the stroke: square to the stroke, flat
horizontal, dead vertical, or an angle you name. It works together with the rib angle lock, which
sets the end the serif is built on.

**Half** — one wing of the serif with its own nine settings. Left and right are independent, and a
**linked** flag copies one onto the other for a symmetric serif.

**Wing** — one arm of the serif, from the stem out to its tip.

**Attractor** — the single point both bracket handles reach toward. **Concavity** decides where
that point sits, between the straight chamfer line and the inner corner of the wing, so it controls
whether the bracket is hollow or full. **Tension** decides how far the handles travel toward it, so
it controls how deep the curve runs.

**Contour easing** — rounding off the corner where the bracket meets the stem flank.
`easeDistance` is how much of each surface the rounding eats. `easeCurvature` is how full that
rounding is.

**Release** — the height at which the serif takes over from the stroke edge. It is fixed by the
serif's own numbers, and the stroke edge is bent to meet it. Never the other way around: build the
serif off the stroke edge instead, and everything that reshapes the edge starts dragging the serif
around with it.

**Underside cup** — the hollow under the foot of the serif, drawn as one curve from tip to tip
rather than one per wing, so the two sides cannot disagree in the middle. Its lowest point sits
midway between the two tips, and the **cup balance** slides it from there out onto either tip.

**Serif units mode** — whether the serif's five distance settings are fixed units, or a multiple of
the stroke width so that the serif grows with the weight.

**Serif preset** — a named terminal shape, held in the master. It is **one wing** and the underside
cup, ten numbers, and applying it puts that wing on both sides. Whether the two wings differ is
decided on the terminal you are editing, never carried in the preset. It holds no axis either, so
one preset stays correct on an upright foot and a slanted one alike. Five ship with the editor —
Egyptian, Clarendon, Didone, Old style, Wedge — and a master keeps its own beside them.

**Egyptian** — the plain slab foot, and the shape a terminal gets the moment you pick serif: wing,
tip and slope all 20, everything else nothing. A serif starts as a shape you can see, not as an
invisible one waiting for three numbers.

### The other features

**Coarse grid** — a snapping grid with presets, coarser than the unit grid, for keeping stems and
heights on consistent values.

**Q-measure** — hold **Q** and the editor measures whatever is under the cursor live. **Alt+Q**
gives direct mode.

**SpeedPunk** — the curvature comb. It grows a fringe off the outline whose length follows the
bend, so an uneven curve shows up as a ragged fringe long before the eye finds it in the black.

**Letterspacer** — automatic sidebearings, computed from how much black sits near each side of the
glyph. Its three controls are **area**, **depth** and **overshoot**.

**Point labels** — the numbers drawn next to each segment: length, tension, angle. Formerly called
"Tunni Labels". That name is dead. The skeleton has its own separate set.

**Corner overlap** — deliberately overlapping the shapes at a joint so that the rendered corner
stays clean.

### Project words

**Donor** — the older fork the skeleton math came from. It sits read-only in the tree as a
reference for how things used to behave. Nothing is copied from it any more.

**Upstream** — Fontra, the editor forkra is built on.

**Rail** — a rule every feature obeys, listed in the architecture map. Breaking one produces the
kind of fault the tests cannot see.

**Owned file** — a file one feature is responsible for. A **shared file** has several features'
work in it, and needs reading before you edit it.

**Workstream** (WS-n) — one numbered stage of the build program.

# Base-curve expansion drag — design

**Date:** 2026-07-29
**Branch:** `feature/base-curve-interpolation`
**Reference behavior:** the single-sided fixed-rib drag (`applyFixedRibDelta`,
`fontra-core/src/skeleton-model.js`), as described in `SKELETON-FEATURE-MODEL.md` §1
("D/S expansion offsets the centerline") and `FEATURE-ARCHITECTURE-MAP.md` §2.

## 1. What this is

The expansion drag currently works only on skeleton points: hold D or S, drag an
on-curve, and the stroke offsets. This spec extends the same gesture to **ordinary
outline points** — points on contours that have no skeleton behind them — so the
contour itself offsets outward or inward under the cursor.

The reference is deliberately the **single-sided** case of the existing drag, because
that case has already resolved the question this feature raises. On a single-sided
contour the anchored edge is fixed by the contour rather than by which key is held, so
D and S collapse into one behavior and the drag direction alone decides whether the
shape grows or shrinks. Base curves inherit that: one behavior, direction-driven, two
keys that do the same thing.

## 2. The gesture

**Entry.** Hold either expansion key and drag an on-curve point of an ordinary outline.

**Magnitude and sign.** The offset distance is the cursor's travel projected onto the
**clicked point's normal**. Positive grows the shape, negative shrinks it. Same
projection the fixed-rib drag uses.

**Gate.** The behavior engages only when the selection contains **no skeleton points**.
A mixed selection runs the skeleton drag exactly as it does today and holds the
ordinary points still. This is the conservative gate: the skeleton drag was stabilised
across four rounds of fixes (`DEVELOPMENT-LOG.md` §11–12) and this feature must not
perturb it.

**Exclusions.**

- **Generated contours are never affected.** They are derived from a skeleton, and the
  existing gate on editing them directly (Z-mode / editable generated points) stands
  unchanged.
- The point under the cursor must be an **on-curve**. A drag started on a handle does
  not begin an expansion, matching the fixed-rib drag's own check.

## 3. What moves

Every **selected** on-curve travels the same distance along **its own** normal. That
makes each affected segment a constant-distance offset of itself — or a **tapered**
offset where only one of its two ends is selected. Unselected points do not move.

Handles keep their **directions**; their **lengths** scale with the local curvature
(`λ = 1 + d·κ`, the generator's own offset construction, `offset-cubic.js`). This is
what stops the middle of a curve coming up short of its ends: displacing handles by an
interpolation of the two endpoint deltas can never lengthen a handle, and on a quarter
arc of radius 100 pushed out 20 units it left the middle 6 units behind.

Where a segment has only one handle, or no usable handle direction, the handles are
**carried along** with the endpoints instead — the existing fallback, which at least
holds their relative position.

## 4. What travels together

A segment travels **whole** — both ends, no taper — when it carries a **tension point**:
a smooth on-curve with a single handle. Such a point has no direction of its own,
because smoothness forces its handle colinear with the straight on its other side, so
the straight owns the direction and both of its ends must share one offset. Moving one
end alone rotates the straight instead of offsetting it.

This is **exactly the existing rib coupling rule**, unchanged. Specifically:

- A **plain straight** between two ordinary corners **tapers freely**. It is not
  coupled. (An earlier draft of this design coupled all straights and was withdrawn: it
  would have changed the finished skeleton drag, and on an all-straight contour the
  chaining below would make every point one group.)
- Coupling **chains**: where two coupled segments share an on-curve, they merge into one
  group, because that point has one position and cannot sit at two offsets.
- The skeleton's per-point **tied-ribs opt-out** remains skeleton-only. Ordinary outline
  points gain no new stored field.

## 5. Limits

**There are none.** An inward drag follows the cursor as far as it is pushed. Past a
tight curve's radius the offset cusps, then loops, then self-intersects. That is
ordinary outline geometry a designer can already produce by hand, it is undoable, and
it is recoverable by dragging back out.

This is a deliberate difference from the skeleton drag, whose per-point floor exists
because a rib runs out of **width** — a quantity a base curve does not have. No
curvature-radius floor is invented to stand in for it.

## 6. What the designer sees

- The outline follows the cursor **live**, like every other drag.
- The **pre-drag shape is drawn faintly underneath** for the length of the gesture, so
  the offset distance is readable against it.
- On release the ghost disappears and the geometry is already in place — nothing jumps.
- The drag readout shows the **offset distance**, the way the rib drag shows a width.

The ghost is what replaces the skeleton: in the single-sided case the centerline is a
visible, stationary reference the outline moves away from, and a base curve has no such
reference until one is drawn.

## 7. Structure

**Shared construction.** The geometry is lifted out of the fixed-rib drag into one
piece both features call: walk the contour's segments, take the set of points that must
travel together, move each affected on-curve along its own normal, rebuild each
segment's handles by the curvature rule, fall back to carrying handles where a segment
cannot be rebuilt.

What stays **outside** it, on the skeleton side: widths, the per-point allowance and
floor, the single-sided total, and the tied-ribs opt-out. The coupled-group set is
**handed to** the shared construction rather than computed inside it, so each feature
keeps its own membership rule (they agree today; the opt-out means they are not
identical functions).

What stays outside it on the base side: the gate, the ghost, and the readout.

**Placement**, per rail R-A:

| Concern                                     | Layer                                            |
| ------------------------------------------- | ------------------------------------------------ |
| Shared offset construction                  | `fontra-core/src/` — pure, mocha-tested           |
| Behavior-name selection from keys/modifiers | the editor's behavior mapping, alongside D/S      |
| The drag itself                             | an editor interaction module, not the pointer     |
| The ghost                                   | a visualization layer                             |

Rail R-B applies directly: the construction must exist in **one** copy after this work,
not two.

## 8. Testing

**Test-first for the shared construction**, which lands in the tested half of the
codebase. The extraction is behaviour-preserving, so the existing fixed-rib tests
(`test-skeleton-modifiers.js`, including the floor and idempotence assertions) are the
safety net for the skeleton side and must stay green unmodified.

New core tests cover, on ordinary contours:

- a fully-selected closed contour offsets uniformly, outward and inward;
- a partially-selected curve segment produces a tapered offset;
- a curve's midpoint travels the full offset distance (the arc case — a straight-only
  fixture cannot see a handle bug, per `DEVELOPMENT-LOG.md` §12);
- a segment carrying a tension point moves both ends when either is selected;
- a plain straight between corners tapers when one end is selected;
- chained coupling merges groups through a shared point;
- an inward drag past the curvature radius is permitted and produces the cusped result
  rather than clamping.

**Manual matrix** for the gesture, the gate and the ghost, since the editor half has no
harness (rail R-G): both keys behave identically; direction decides grow/shrink; a
mixed selection runs the skeleton drag and holds outline points still; generated
contours are untouched; a drag started on a handle does not engage; the ghost appears
on press and disappears on release with no visual jump; undo restores in one step.

## 9. Out of scope

- Any change to the skeleton drag's behavior. The extraction is refactoring only.
- A tied-ribs-style opt-out on ordinary outline points.
- Offsetting generated contours.
- A curvature-radius floor or self-intersection cleanup.

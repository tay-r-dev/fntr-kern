# Contour Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A designer places a measurement on a contour and keeps it. It is saved per layer in the project file, it rides the geometry while the drawing is edited, it goes stale loudly when the point count under it changes, and it never reaches a compiled font.

**Architecture:** All geometry and all validity logic is pure and lives in two new core modules with mocha tests. Every write goes through one new editor module, which is the only thing in the tree that touches the stored section. The pointer tool gains dispatch hooks only. A narrow marker tool exists as the escape hatch for geometry the pointer tool cannot reach. Two visualization layers draw. One panel reads and calls the write path.

**Tech Stack:** JavaScript ES modules. `fontra-core` for pure logic, tested with mocha and chai. `views-editor` for interaction, with no test harness. Prettier for formatting.

**Spec:** `docs/superpowers/specs/2026-08-28-contour-markers-design.md`

## Global Constraints

- **Rail R-A — layer placement.** Pure logic goes in `fontra-core/src/`. Hit-testing goes in `scene-model.js` as an `*AtPoint` method. Interaction goes in a dedicated editor module. Rendering goes in `visualization-layer-markers.js`, registered in `visualization-layer-definitions.js` with `draw: <importedFn>` only. `edit-tools-pointer.js` stays a thin dispatcher.
- **Rail R-B — one copy.** The Power Ruler's winding walk moves into `marker-measure.js` and the ruler imports it. Do not leave two copies, and do not re-derive a normal, a ray cast or a hit test that already exists.
- **One write path.** Nothing outside `views-editor/src/marker-editing.js` writes the `markers` section. The panel, the marker tool and the pointer tool all call it.
- **Rail R-D — nothing recovers an anchor by geometry.** The signature is a count. No tolerance, no nearest-hit fallback, no re-anchoring by position.
- **Rail R-G — test split.** `fontra-core` has mocha. `views-editor` has none, so every editor task carries a manual test matrix instead.
- **Running the core suite:** `cd src-js/fontra-core && npx mocha tests/<file> --extension js`. `npm test` in this repo needs node flags the script does not carry; run mocha directly.
- **Every commit runs two commands:** `npx prettier --write` on each touched file, and `node --check` on each touched editor file. Do **not** run `npm run bundle`. The user runs bundle-watch and reports compile errors.
- **`fontra.internal` access is through `fontra-core/src/fontra-internal-data.js` only.** Never read or write `customData["fontra.internal"]` directly.
- **The one rule:** the point count under an anchor changes, the marker goes stale. Anything else, the marker rides the geometry. Do not add a second rule, a tolerance, or a repair path.
- **Stale is derived on read and never written to the file.**
- **Commit after every task**, with `git add .`.

---

### Task 1: The stored section, ids, and accessors

**Files:**

- Modify: `src-js/fontra-core/src/fontra-internal-schema.js`
- Create: `src-js/fontra-core/src/marker-model.js`
- Test: `src-js/fontra-core/tests/test-marker-model.js`

**Interfaces:**

- Consumes: `getFontraInternalSection`, `setFontraInternalSection` from `fontra-core/src/fontra-internal-data.js`.
- Produces:
  - `FONTRA_INTERNAL_SECTIONS.MARKERS === "markers"`
  - `getMarkerData(layerGlyph) -> {markers: Marker[], groups: Group[], nextId: number} | undefined`
  - `setMarkerData(layerGlyph, data) -> void`
  - `getMarkers(layerGlyph) -> Marker[]` — always an array
  - `getMarkerGroups(layerGlyph) -> Group[]` — always an array
  - `allocateMarkerId(layerGlyph) -> string` — never returns an id that has ever been used
  - `Marker = {id, ends: [End, End], signature, target?, groupId?}`
  - `Group = {id, name, visible}`

- [ ] **Step 1: Write the failing test**

Create `src-js/fontra-core/tests/test-marker-model.js`:

```js
import { FONTRA_INTERNAL_SECTIONS } from "@fontra/core/fontra-internal-schema.js";
import {
  allocateMarkerId,
  getMarkerData,
  getMarkerGroups,
  getMarkers,
  setMarkerData,
} from "@fontra/core/marker-model.js";
import { expect } from "chai";

describe("marker-model — the stored section", () => {
  it("names the section", () => {
    expect(FONTRA_INTERNAL_SECTIONS.MARKERS).to.equal("markers");
  });

  it("returns undefined for a glyph that has none", () => {
    expect(getMarkerData({})).to.equal(undefined);
  });

  it("returns empty lists for a glyph that has none", () => {
    expect(getMarkers({})).to.deep.equal([]);
    expect(getMarkerGroups({})).to.deep.equal([]);
  });

  it("round-trips a deep copy", () => {
    const layerGlyph = {};
    const marker = { id: "m1", ends: [], signature: [] };
    setMarkerData(layerGlyph, { markers: [marker], groups: [] });
    const read = getMarkerData(layerGlyph);
    expect(read.markers[0].id).to.equal("m1");
    expect(read.markers[0]).to.not.equal(marker);
  });

  it("allocates an id that is not already present", () => {
    const layerGlyph = {};
    setMarkerData(layerGlyph, { markers: [{ id: "m1" }, { id: "m2" }], groups: [] });
    const id = allocateMarkerId(layerGlyph);
    expect(id).to.not.equal("m1");
    expect(id).to.not.equal("m2");
  });

  it("does not reuse the id of a deleted marker", () => {
    const layerGlyph = {};
    setMarkerData(layerGlyph, { markers: [{ id: "m1" }, { id: "m2" }], groups: [] });
    const deleted = getMarkerData(layerGlyph);
    deleted.markers = [{ id: "m1" }];
    setMarkerData(layerGlyph, deleted);
    const id = allocateMarkerId(layerGlyph);
    expect(id).to.not.equal("m2");
  });
});
```

The last test is the load-bearing one. Deleting `m2` must not make `m2` available again, because a copy of that marker may still exist in another source. Hold a monotonic `nextId` in the section rather than deriving the next id from the list.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-marker-model.js --extension js`
Expected: FAIL, cannot resolve `@fontra/core/marker-model.js`.

- [ ] **Step 3: Add the section name**

In `src-js/fontra-core/src/fontra-internal-schema.js`, one line in the frozen object, keeping alphabetical-by-value order:

```js
export const FONTRA_INTERNAL_SECTIONS = Object.freeze({
  COMPOSITION: "composition",
  LETTERSPACER: "letterspacer",
  MARKERS: "markers",
  SKELETON: "skeleton",
  SKELETON_DEFAULTS: "skeletonDefaults",
});
```

- [ ] **Step 4: Write the accessors**

- [ ] **Step 5: Run the test and confirm it passes**

- [ ] **Step 6: Format and commit**

---

### Task 2: The signature and the stale rule

**Files:**

- Modify: `src-js/fontra-core/src/marker-model.js`
- Modify: `src-js/fontra-core/tests/test-marker-model.js`

**Interfaces:**

- Produces:
  - `computeMarkerSignature(path) -> {counts: number[], closed: boolean[]}`
  - `markerIsStale(marker, path) -> boolean`

`path` here is always `glyphController.flattenedPath`. Nothing in this module knows what a component is.

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-marker-model.js`:

```js
import { computeMarkerSignature, markerIsStale } from "@fontra/core/marker-model.js";
import { VarPackedPath } from "@fontra/core/var-path.js";

// A square and a triangle, so the two contours have different counts.
function twoContourPath() {
  const path = new VarPackedPath();
  path.appendUnpackedContour({
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    isClosed: true,
  });
  path.appendUnpackedContour({
    points: [
      { x: 200, y: 0 },
      { x: 300, y: 0 },
      { x: 250, y: 100 },
    ],
    isClosed: true,
  });
  return path;
}

function markerOn(contourIndex, path) {
  return {
    id: "m1",
    ends: [
      { kind: "pathSegment", contourIndex, segmentStart: 0, t: 0.5 },
      { kind: "cast" },
    ],
    signature: computeMarkerSignature(path),
  };
}

describe("marker-model — the stale rule", () => {
  it("is not stale against the path it was written on", () => {
    const path = twoContourPath();
    expect(markerIsStale(markerOn(0, path), path)).to.equal(false);
  });

  it("is not stale when the points only move", () => {
    const marker = markerOn(0, twoContourPath());
    const moved = twoContourPath();
    moved.coordinates[0] = -40;
    moved.coordinates[1] = -40;
    expect(markerIsStale(marker, moved)).to.equal(false);
  });

  it("is stale when a point is inserted on its own contour", () => {
    const marker = markerOn(0, twoContourPath());
    const grown = twoContourPath();
    grown.insertPoint(0, 1, { x: 50, y: 0 });
    expect(markerIsStale(marker, grown)).to.equal(true);
  });

  it("is stale when a point is deleted from its own contour", () => {
    const marker = markerOn(0, twoContourPath());
    const shrunk = twoContourPath();
    shrunk.deletePoint(0, 1);
    expect(markerIsStale(marker, shrunk)).to.equal(true);
  });

  it("is stale when ANY contour changes count", () => {
    const marker = markerOn(0, twoContourPath());
    const other = twoContourPath();
    other.insertPoint(1, 1, { x: 260, y: 10 });
    expect(markerIsStale(marker, other)).to.equal(true);
  });

  it("is stale when a contour is removed", () => {
    const marker = markerOn(1, twoContourPath());
    const fewer = twoContourPath();
    fewer.deleteContour(0);
    expect(markerIsStale(marker, fewer)).to.equal(true);
  });

  it("is stale when a closed contour is opened", () => {
    const marker = markerOn(0, twoContourPath());
    const opened = twoContourPath();
    opened.contourInfo[0].isClosed = false;
    expect(markerIsStale(marker, opened)).to.equal(true);
  });

  it("comes back when the count is restored, which is the undo property", () => {
    const marker = markerOn(0, twoContourPath());
    const grown = twoContourPath();
    grown.insertPoint(0, 1, { x: 50, y: 0 });
    expect(markerIsStale(marker, grown)).to.equal(true);
    expect(markerIsStale(marker, twoContourPath())).to.equal(false);
  });

  it("never stales a skeleton anchor", () => {
    const marker = {
      id: "m1",
      ends: [
        { kind: "skeletonPoint", contourId: "c1", pointId: "p1", t: 0.5 },
        { kind: "cast" },
      ],
      signature: computeMarkerSignature(twoContourPath()),
    };
    const fewer = twoContourPath();
    fewer.deleteContour(0);
    expect(markerIsStale(marker, fewer)).to.equal(false);
  });
});
```

Two notes before writing this.

**The fifth test is deliberate and slightly over-eager.** A count change on any contour stales every path-anchored marker, because the array is compared whole. An added or removed contour shifts every index after it, and telling "shifted" from "resized" is the search this design refuses to do. Write the test as the design, not as the sympathetic answer.

**Check `VarPackedPath`'s real method names** before writing the fixture — `insertPoint`, `deletePoint`, `deleteContour`, `appendUnpackedContour` — and use whatever the class actually offers.

- [ ] **Step 2: Run and confirm it fails**

- [ ] **Step 3: Implement**

`computeMarkerSignature` reads `path.contourInfo` and derives per-contour counts from the `endPoint` deltas. `markerIsStale` returns false for a marker whose every end is a `skeletonPoint` or a `cast`, and otherwise compares the two signatures whole.

- [ ] **Step 4: Run and confirm it passes**

- [ ] **Step 5: Format and commit**

---

### Task 3: Resolving an anchor

**Files:**

- Modify: `src-js/fontra-core/src/marker-model.js`
- Modify: `src-js/fontra-core/tests/test-marker-model.js`

**Interfaces:**

- Produces: `resolveMarkerAnchor(end, {path, skeletonData}) -> {point, normal, verdict}`
- `verdict` is `"ok"` or `"stale"`. There is no third value.

Rules:

- A `pathSegment` end resolves through the segment at `{contourIndex, segmentStart}`, evaluated at `t`. The normal is the segment derivative rotated a quarter turn, which is what the Power Ruler does at `recalcRulerFromPoint`. Match it exactly.
- A `pathPoint` end resolves to that point's coordinates and has no normal.
- A `skeletonPoint` end resolves through the skeleton model's own accessors by id. Import them; do not re-derive a rib position or a normal (R-B).
- Anything that cannot be resolved returns `"stale"` rather than throwing or guessing.

- [ ] **Step 1: Write the failing test** — a segment anchor at `t = 0.5` on a known cubic resolves to the expected point and to a unit normal square to the derivative; a `pathPoint` resolves to its coordinates; an out-of-range `contourIndex` returns `"stale"`.

- [ ] **Step 2: Run and confirm it fails**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run and confirm it passes**

- [ ] **Step 5: Format and commit**

---

### Task 4: The measurement, and the winding walk moves out of the Power Ruler

**Files:**

- Create: `src-js/fontra-core/src/marker-measure.js`
- Modify: `src-js/views-editor/src/edit-tools-power-ruler.js`
- Test: `src-js/fontra-core/tests/test-marker-measure.js`

**Interfaces:**

- Produces:
  - `walkRayIntersections(intersections) -> MeasurePoint[]` — the accumulate-winding loop lifted verbatim out of `recalcRulerFromLine`, `{x, y, distance, inside}` per span
  - `measureRay(glyphController, origin, direction, extraLines) -> {farPoint, distance} | null`
  - `measureDimension(p1, p2) -> number`

`measureRay` returns `null` where the ray never leaves the black — an open contour it never crosses. **A null is the honest answer and every reader must handle it.** Do not fabricate a distance to the bounding box.

The Power Ruler then imports `walkRayIntersections` and its own copy is deleted. `computeSideBearingLines` stays in the ruler: a marker does not measure against sidebearings.

- [ ] **Step 1: Write the failing test**

`src-js/fontra-core/tests/test-marker-measure.js` covers the four cases the spec names:

- an overlapping stem — the ray crosses the interior edge of the overlapping contour rather than stopping at it;
- a counter — the ray stops on entry;
- an open contour the ray never crosses — `null`, not a number;
- two points — `measureDimension` is the plain hypotenuse.

The winding walk is a pure function of a crossing list, so build the intersection lists by hand where that is simpler than building a glyph controller.

- [ ] **Step 2: Run and confirm it fails**

- [ ] **Step 3: Implement `marker-measure.js`**

- [ ] **Step 4: Move the walk out of the ruler**

Replace the loop in `recalcRulerFromLine` with a call to `walkRayIntersections`. The ruler's output shape must not change.

- [ ] **Step 5: Run the whole core suite and confirm no regression**

Run: `cd src-js/fontra-core && npx mocha tests --extension js --extension ts`

- [ ] **Step 6: Manual check on the ruler**

| #   | Action                                    | Expected                                    |
| --- | ----------------------------------------- | ------------------------------------------- |
| 1   | Pick the Power Ruler, click across a stem | Same pills and numbers as before the change |
| 2   | Click across a counter                    | Inside and outside spans coloured as before |
| 3   | Double-click empty canvas                 | Ruler dismissed, as before                  |

- [ ] **Step 7: Format, `node --check` the ruler, commit**

---

### Task 5: The skeleton measurement cases

**Files:**

- Modify: `src-js/fontra-core/src/marker-measure.js`
- Modify: `src-js/fontra-core/tests/test-marker-measure.js`

**Interfaces:**

- Produces: `measureSkeletonAnchor(glyphController, end, skeletonData) -> {farPoint, distance, secondFarPoint?} | null`

Three cases, from spec §4:

- Anchored on a **generated contour** — an ordinary ray. It crosses the centerline, because a centerline is not outline geometry and casts no crossing.
- Anchored on a **centerline**, double-sided — the ray runs both ways from the anchor and reports the **sum**. That is the stroke's full width at that point.
- Anchored on a **centerline**, single-sided — one way only, because the other edge lies on the centerline itself.

Read `singleSided` through the skeleton model's own accessor. Do not infer it from the widths.

- [ ] **Step 1: Write the failing test** — a two-point straight centerline of known width reports its full width double-sided, and one side single-sided.

- [ ] **Step 2: Run and confirm it fails**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run and confirm it passes**

- [ ] **Step 5: Format and commit**

---

### Task 6: The write path

**Files:**

- Create: `src-js/views-editor/src/marker-editing.js`

**Interfaces:**

- Consumes: `sceneController.editGlyph`, `ChangeCollector` from `@fontra/core/changes.js`, `recordChanges`, and the Task 1 accessors.
- Produces:
  - `runMarkerEdit(sceneController, undoLabel, applyToLayer)` — the generic loop
  - `placeMarker(sceneController, marker, undoLabel)`
  - `deleteMarkers(sceneController, ids, undoLabel)`
  - `setMarkerTarget(sceneController, id, target)`
  - `reanchorMarkerEnd(sceneController, id, endIndex, end, signature)` — writes the end **and** the signature in one change
  - `setMarkerGroup(sceneController, id, groupId)`
  - `createGroup`, `renameGroup`, `deleteGroup`, `setGroupVisible`

`runMarkerEdit` follows `runSkeletonPanelEdit` in `skeleton-panel-edits.js` exactly: fold one mutation across every editable layer into a single undo item, prefixing each layer's changes with `["layers", layerName, "glyph"]`. That is what puts the same id in every source selected for editing.

**Placement defaults to the active source alone** (spec §2), so `placeMarker` writes to the edit layer only. Every other operation runs across editable layers.

**The address and the signature are one write.** They go through one helper and are never written separately — that pair disagreeing is exactly what the stale check reads as a broken anchor.

Undo labels name the effect: "Place Marker", "Delete Marker", "Set Marker Target", "Re-anchor Marker".

- [ ] **Step 1: Write the module**

- [ ] **Step 2: `node --check`, format, commit**

No test harness here (R-G). The behaviour is proven by the matrices in the tasks that call it.

---

### Task 7: Hit-testing

**Files:**

- Modify: `src-js/views-editor/src/scene-model.js`
- Possibly modify: `src-js/fontra-core/src/utils.ts`

**Interfaces:**

- Produces: `markerAtPoint(point, size, positionedGlyph)` → `{markerId, endIndex} | undefined`

Two decisions, both stated in the spec:

1. **A ray has one grip.** The arrowhead and the tail are the same grip, because the far end is a cast and owns nothing. A dimension has two, one per end, hit-tested separately.
2. **The marker grip loses to skeleton and generated geometry.** In `_selectionAtPoint`, the marker check goes **after** `editableGeneratedAtPoint` and **before** `pointSelectionAtPoint`. A marker over a generated contour is therefore unreachable with the pointer tool while gizmo mode is on; that is what the marker tool is for.

Selection keys: `marker/<id>` for a whole marker, `markerEnd/<id>/<endIndex>` for a dimension end. Confirm `parseSelection` keeps the raw remainder for both instead of running `parseInt` on it — the same fix the compound skeleton keys already needed.

- [ ] **Step 1: Add `markerAtPoint`**

- [ ] **Step 2: Wire it into `_selectionAtPoint` in the stated order**

- [ ] **Step 3: Confirm `parseSelection` handles both kinds**

- [ ] **Step 4: Manual matrix**

| #   | Action                                                   | Expected                                   |
| --- | -------------------------------------------------------- | ------------------------------------------ |
| 1   | Click a ray's arrowhead                                  | The marker selects                         |
| 2   | Click a ray's tail                                       | The same marker selects                    |
| 3   | Click one end of a dimension                             | That end selects, not the other            |
| 4   | Marker over a generated contour, gizmo mode on, click it | The gizmo wins; the marker does not select |
| 5   | Same, gizmo mode off                                     | The marker selects                         |
| 6   | Click an ordinary point a marker overlaps                | The marker wins                            |

- [ ] **Step 5: `node --check`, format, commit**

---

### Task 8: Drawing

**Files:**

- Create: `src-js/views-editor/src/visualization-layer-markers.js`
- Modify: `src-js/views-editor/src/visualization-layer-definitions.js`

Two layers, because a ray and a dimension read differently on screen even though the data is one object:

- `fontra.markers.rays` — an arrow from the anchor to the far point, with the distance in a pill. Reuse the Power Ruler's pill and blob drawing rather than writing a second one.
- `fontra.markers.dimensions` — extension lines, a witness gap and the distance, in the AutoCAD idiom.

Both draw the target's delta beside the distance where a target is set. Both grey a stale marker. Colours follow the Power Ruler's light and dark tables.

**A marker with no measurement** — `measureRay` returned null — draws its anchor and no number. It is not stale and must not be greyed as though it were.

Register with `draw: <importedFn>` only (R-A).

- [ ] **Step 1: Write the layer module**

- [ ] **Step 2: Register both layers**

- [ ] **Step 3: Manual matrix**

| #   | Action                                 | Expected                             |
| --- | -------------------------------------- | ------------------------------------ |
| 1   | A ray across a stem                    | Arrow, pill, correct number          |
| 2   | Drag the stem                          | The number follows live, every frame |
| 3   | Set a target                           | The delta draws beside the distance  |
| 4   | Insert a point on the contour          | The marker greys                     |
| 5   | Undo                                   | The marker returns, ungreyed         |
| 6   | A ray that never crosses               | Anchor drawn, no number, not greyed  |
| 7   | Switch each layer off in the View menu | Only that kind disappears            |
| 8   | Dark mode                              | Both layers legible                  |

- [ ] **Step 4: `node --check`, format, commit**

---

### Task 9: The pointer tool reaches markers

**Files:**

- Modify: `src-js/views-editor/src/edit-tools-pointer.js`

Two hooks, in the shape the Tunni hooks already use. The file stays a dispatcher: the work lives in `marker-editing.js`.

1. **Drag** — a drag starting on a marker grip runs the marker drag instead of the ordinary point drag.
2. **Double-click delete** — in `handleDoubleClick`, a marker under the point deletes it, ahead of the component, anchor and point branches.

Selection needs nothing here: Task 7 wired the marker into the `_selectionAtPoint` cascade.

**On the double-click.** It is the ordinary gesture and needs no special machinery. `edit-tools-pointer.js` already routes `detail == 2` to `handleDoubleClick`, and `shouldInitiateDrag` in `edit-tools-base.js` is the primitive for a gesture that must tell a click from a drag. Use both as they stand.

**The ray drag.** Each frame runs the same `findNearest` the placement ran and writes the segment and `t` it returns, **restricted to the contour the drag started on**. Unrestricted, the anchor jumps to whatever outline happens to pass nearer the cursor. `findNearest` also refuses `t` of exactly 0 and 1, so an anchor approaches a node without ever landing on it; that is accepted.

**The dimension end drag** re-anchors to whichever point it is released on, and stays where it was when released on nothing. Dragging a dimension's **body** moves nothing.

**Every frame records against a fresh copy of the pre-drag state**, never against the live glyph — the base-curve expansion fault that cost an undo restoring one frame out of three.

- [ ] **Step 1: Add the drag hook**

- [ ] **Step 2: Add the double-click branch**

- [ ] **Step 3: Manual matrix**

| #   | Action                                             | Expected                                      |
| --- | -------------------------------------------------- | --------------------------------------------- |
| 1   | Click a marker with the pointer tool               | Selects                                       |
| 2   | Drag a ray along a contour                         | Anchor slides, number follows live            |
| 3   | Drag it across a segment joint                     | Nothing special happens at the joint          |
| 4   | Drag it toward another contour passing nearby      | It stays on its own contour                   |
| 5   | Double-click a marker                              | Deleted                                       |
| 6   | Click a marker, then immediately press and drag it | Dragged, not deleted                          |
| 7   | Undo a three-frame drag                            | Back to where the drag started, not frame two |
| 8   | Backspace with a marker selected                   | Deleted                                       |
| 9   | Double-click empty canvas                          | Upstream behaviour, unchanged                 |
| 10  | Drag a dimension end onto another point            | Re-anchors                                    |
| 11  | Drag a dimension end onto nothing                  | Stays where it was                            |
| 12  | Drag a dimension's body                            | Nothing moves                                 |

- [ ] **Step 4: `node --check`, format, commit**

---

### Task 10: The marker tool

**Files:**

- Create: `src-js/views-editor/src/edit-tools-marker.js`
- Modify: `src-js/views-editor/src/editor.js`
- Modify: `src-js/fontra-core/assets/lang/en.js`
- Create: a tool icon under `fontra-core/assets/`

`MarkerTool extends BaseTool`, **delegating** to the pointer tool for anything that is not marker business:

```js
await this.editor.tools["pointer-tool"].handleDrag(eventStream, initialEvent);
```

That is the Power Ruler's own pattern, already in the tree at four call sites (`handleHover`, `setCursor`, `handleDrag`, and the not-editing guard).

**Not a clone** of `edit-tools-pointer.js` and **not a subclass** of `PointerTools`. That tool's `handleDrag` dispatches over selection kinds a marker tool has no business inheriting — skeleton ribs, generated gizmos, tension-aware editing, base-curve expansion. The single-sided pen settled this argument the same way: inherit, do not copy, and the two cannot drift.

Gestures:

| gesture                                  | what it does                              |
| ---------------------------------------- | ----------------------------------------- |
| click a contour                          | place a ray at that point on that segment |
| Alt, click a point, click a second point | place a dimension                         |
| click a marker                           | select it                                 |
| double-click a marker                    | delete it                                 |
| drag a ray                               | slide its anchor along the outline        |
| drag a dimension end                     | re-anchor that end                        |
| Backspace                                | delete the selection                      |
| anything else                            | delegate to the pointer tool              |

The tool's own hit test does **not** apply the generated-geometry precedence of Task 7. That precedence belongs to the pointer tool, and this tool exists to reach what it excludes.

Register in `initTools()` beside `PowerRulerTool`. Add the tool name and both layer names to `lang/en.js`. The generated copy of the icons folder is gitignored, so a new icon goes in the source assets only.

- [ ] **Step 1: Write the tool**

- [ ] **Step 2: Register it and add the strings**

- [ ] **Step 3: Manual matrix**

| #   | Action                                               | Expected                                      |
| --- | ---------------------------------------------------- | --------------------------------------------- |
| 1   | Place a ray on an ordinary contour                   | Placed, measures across the black             |
| 2   | Place a ray on a component's outline                 | Placed                                        |
| 3   | Place a ray on a generated contour                   | Crosses the centerline, stops at the far edge |
| 4   | Place a ray on a double-sided centerline             | Reports the full stroke width                 |
| 5   | Place a ray on a single-sided centerline             | Reports one side                              |
| 6   | Alt, click two points                                | Dimension placed                              |
| 7   | Reach a marker on a generated contour, gizmo mode on | Reachable here, unlike the pointer tool       |
| 8   | Click empty canvas                                   | Delegates; nothing placed                     |
| 9   | Switch to another tool and back                      | Markers unchanged                             |

- [ ] **Step 4: `node --check`, format, commit**

---

### Task 11: Reverse contour stales its markers

**Files:**

- Modify: whichever module performs reverse-contour on an ordinary path
- Modify: `src-js/views-editor/src/marker-editing.js`

Reverse contour is the one count-preserving structural change. It keeps the point count and the closed flag and reverses the point order, so every anchor on that contour would name a different place while the signature says fine.

So reverse-contour stales the markers on the contour it reverses, **in the same change**. Do it by writing those markers to an explicitly broken anchor state, not by fudging the signature — a signature that lies is worse than a marker that says it is broken.

Grep for the command before assuming where it lives. Then check the skeleton's own `setSkeletonContourReversed`: a skeleton reversal flips the emitted outline's winding and leaves the centerline as drawn, so a **centerline** anchor is safe and a **generated-contour** anchor may not be. Measure before deciding.

- [ ] **Step 1: Find the command and confirm what it does to point order**

- [ ] **Step 2: Stale the affected markers in the same change**

- [ ] **Step 3: Manual matrix**

| #   | Action                                                   | Expected                      |
| --- | -------------------------------------------------------- | ----------------------------- |
| 1   | Place a ray, reverse its contour                         | The marker greys              |
| 2   | Undo                                                     | The marker returns            |
| 3   | Ray on a generated contour, reverse the skeleton contour | Behaves as measured in Step 1 |

- [ ] **Step 4: `node --check`, format, commit**

---

### Task 12: The panel

**Files:**

- Create: `src-js/views-editor/src/panel-markers.js`
- Modify: `src-js/views-editor/src/editor.js`
- Modify: `src-js/fontra-core/assets/lang/en.js`

In the right sidebar, added beside `SkeletonParametersPanel`.

- Every marker in the current glyph: measurement, target, delta, group, and whether it is stale.
- Select a row and the marker highlights on canvas; select on canvas and the row highlights.
- Edit a target. Clear a target.
- Create a group, rename it, delete it, toggle its visibility. **No groups by default** — an ungrouped marker is the ordinary case, and grouping is something the designer asks for.
- Delete a marker. Re-anchor a stale one by clicking a new spot.

**Groups carry visibility only.** No shared target: one number owned by two levels is the trap this project has recorded four times.

Every write goes through `marker-editing.js`. The panel never touches `customData`.

Two panel mechanics this project has already paid for:

- **Rebuild in place when only values changed.** `setFieldDescriptions` clears `innerHTML`, so rebuilding on every field change destroys the input the edit came from and takes the focus with it, one increment per arrow key. Compare a layout signature, as `panel-skeleton-parameters.js` does.
- **A hosted panel must refresh on the rebuild that re-attaches its host.** The letterspacer and skeleton-defaults panels both drew nothing on first load until this was fixed.

- [ ] **Step 1: Write the panel**

- [ ] **Step 2: Register it and add the strings**

- [ ] **Step 3: Manual matrix**

| #   | Action                                             | Expected                                 |
| --- | -------------------------------------------------- | ---------------------------------------- |
| 1   | Open the panel with markers present                | All listed with live measurements        |
| 2   | Drag the stem                                      | The listed number follows                |
| 3   | Select a row                                       | The marker highlights on canvas          |
| 4   | Select on canvas                                   | The row highlights                       |
| 5   | Type a target                                      | Delta appears in the panel and on canvas |
| 6   | Clear the target                                   | Delta disappears                         |
| 7   | Arrow-key a target field                           | Focus survives every increment           |
| 8   | Create a group, add two markers, toggle visibility | Both hide and show together              |
| 9   | Delete a group                                     | Its markers survive, ungrouped           |
| 10  | Break a marker, re-anchor it from the panel        | It measures again                        |
| 11  | Reload the page                                    | Everything above survives                |

- [ ] **Step 4: `node --check`, format, commit**

---

### Task 13: The sweeps

**Files:**

- Modify: `src-js/fontra-core/tests/test-marker-measure.js`

**A sweep, not an assertion.** A per-configuration assertion has missed every fault in this project's geometry so far.

Two sweeps:

1. **The anchor rides.** Hold a marker fixed and walk a neighbouring point through its range in fine steps, measuring the worst single-step movement of the reported distance against the driver's own step.
2. **The drag.** Drive a ray's anchor along a contour in fine steps, across a segment joint, and measure the worst single-step movement of the reported distance.

Start each sweep away from a degenerate configuration. A sweep that begins at zero-length handles reports its own seed as a large jump — this project has recorded that twice.

- [ ] **Step 1: Write both sweeps**

- [ ] **Step 2: Run them and record the worst step, for the log entry in Task 14**

- [ ] **Step 3: Format and commit**

---

### Task 14: The documents

**Files:**

- Modify: `docs/superpowers/FEATURE-ARCHITECTURE-MAP.md`
- Modify: `docs/superpowers/FEATURE-MODEL.md`
- Modify: `docs/superpowers/DEVELOPMENT-LOG.md`
- Modify: `docs/superpowers/GLOSSARY.md`

- **Architecture map:** an F11 row in the §1 inventory, a per-feature file map in §3, the new hunks in the §4 shared-file reverse index (`scene-model.js`, `edit-tools-pointer.js`, `editor.js`, `visualization-layer-definitions.js`, `lang/en.js`), and `MARKERS` in §5. Note that the map has no F10 row either — the tension-aware feature is missing from the inventory. Add F11 without pretending F10 is there.
- **Feature model:** a new section at the end. Do not renumber §1–§9.
- **Development log:** a new section carrying what the other two documents do not — the sweep numbers from Task 13, and the decision trail: the three-case anchor check collapsing into one rule, what that bought (no bookkeeping obligation on any tool that restructures a point list) and what it cost (an inserted point stales every marker on its contour).
- **Glossary:** **marker**, **ray**, **dimension**, **signature**, **stale**.

Then retire this spec, or leave it in place with its status updated, following whatever the composition and snapping specs did at the end of their plans.

- [ ] **Step 1: Update all four documents**

- [ ] **Step 2: Format and commit**

---

## Not in this plan, deliberately

From spec §9, and unchanged by it:

- **Editing through a marker** — dragging the arrowhead to push the far contour to a wanted distance. A constraint solver wearing a ruler's clothes, and its own feature.
- **Direction modes** — horizontal, vertical, a named angle. The normal is what a stroke measurement means.
- **Reading one marker across every source in a column.** The id makes it possible and the panel is where it would go.
- **Group-level targets.**
- **Export of measurements as a table.**

## Open questions the plan does not settle

- **Where a marker's group visibility lives when the groups differ between sources.** The section is per layer, so two sources can disagree. Task 12 assumes the edit layer's groups are the ones the panel shows. Confirm in use.
- **Whether a stale marker should be listed in the panel of a source where its twin is healthy.** The id makes the question askable; the answer is a v2 decision (spec §9).

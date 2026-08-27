# Anchor Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A component in a composite glyph carries a stored attachment to an anchor of its base glyph, the editor reports when that attachment is out of date, and the designer updates it, overrides it, or builds whole accented glyphs from the Unicode decomposition.

**Architecture:** All logic is pure and lives in one new core module with mocha tests. All writes go through one new editor module, which is the only caller that touches the stored section or writes a component transform on behalf of an attachment. The panel reads state and calls that module. Nothing else in the tree changes shape: a component stays an ordinary component with an ordinary transform.

**Tech Stack:** JavaScript ES modules. `fontra-core` for pure logic, tested with mocha and chai. `views-editor` for interaction, with no test harness. Prettier for formatting.

**Spec:** `docs/superpowers/specs/composition.md`

## Global Constraints

- **Rail R-A — layer placement.** Pure logic goes in `fontra-core/src/`. Interaction goes in a dedicated editor module. Rendering goes in a `visualization-layer-*.js` file, registered in `visualization-layer-definitions.js` with `draw: <importedFn>` only.
- **Rail R-B — one copy.** If a symbol exists anywhere in forkra, import it. Do not re-derive a transform, an anchor lookup or a decomposition that already exists.
- **One write path.** Nothing outside `views-editor/src/composition-editing.js` writes the `composition` section, and nothing outside it writes a component transform on behalf of an attachment.
- **Rail R-G — test split.** `fontra-core` has mocha (`cd src-js/fontra-core && npm test`). `views-editor` has none, so every editor task carries a manual test matrix instead.
- **Every commit runs two commands:** `npx prettier --write` on each touched file, and `node --check` on each touched editor file. Do **not** run `npm run bundle`. The user runs bundle-watch and reports compile errors.
- **`fontra.internal` access is through `fontra-core/src/fontra-internal-data.js` only.** Never read or write `customData["fontra.internal"]` directly.
- **The base is the first component in the list.** Its anchors are read through its own component transform.
- **No chaining.** Every attachment hangs on the base glyph. A component never hangs on another component.
- **More than one answer means no answer.** Two components claiming one base anchor, or one mark matching two base anchors, refuses the glyph. Nothing is attached and nothing is added.
- **Commit after every task**, with `git add .`.

---

### Task 1: The stored section and its accessors

**Files:**

- Modify: `src-js/fontra-core/src/fontra-internal-schema.js`
- Create: `src-js/fontra-core/src/composition.js`
- Test: `src-js/fontra-core/tests/test-composition.js`

**Interfaces:**

- Consumes: `getFontraInternalSection`, `setFontraInternalSection` from `fontra-core/src/fontra-internal-data.js`.
- Produces:
  - `FONTRA_INTERNAL_SECTIONS.COMPOSITION === "composition"`
  - `getCompositionData(glyph) -> {attachments: (Entry|null)[]} | undefined`
  - `setCompositionData(glyph, data) -> void`
  - `getAttachments(glyph, componentCount) -> (Entry|null)[]` — always exactly `componentCount` long
  - `Entry = {anchorName: string, detached: boolean}`

- [ ] **Step 1: Write the failing test**

Create `src-js/fontra-core/tests/test-composition.js`:

```js
import {
  getAttachments,
  getCompositionData,
  setCompositionData,
} from "@fontra/core/composition.js";
import { FONTRA_INTERNAL_SECTIONS } from "@fontra/core/fontra-internal-schema.js";
import { expect } from "chai";

describe("composition — stored section", () => {
  it("names the section", () => {
    expect(FONTRA_INTERNAL_SECTIONS.COMPOSITION).to.equal("composition");
  });

  it("returns undefined for a glyph that has none", () => {
    expect(getCompositionData({})).to.equal(undefined);
  });

  it("round-trips a deep copy", () => {
    const glyph = {};
    const entry = { anchorName: "top", detached: false };
    setCompositionData(glyph, { attachments: [null, entry] });
    const read = getCompositionData(glyph);
    expect(read.attachments[1].anchorName).to.equal("top");
    expect(read.attachments[1]).to.not.equal(entry);
  });

  it("pads the attachment list to the component count", () => {
    const glyph = {};
    setCompositionData(glyph, { attachments: [null] });
    expect(getAttachments(glyph, 3)).to.deep.equal([null, null, null]);
  });

  it("truncates an attachment list longer than the component count", () => {
    const glyph = {};
    const entry = { anchorName: "top", detached: false };
    setCompositionData(glyph, { attachments: [null, entry, entry] });
    expect(getAttachments(glyph, 2).length).to.equal(2);
  });

  it("returns all-null for a glyph with no section", () => {
    expect(getAttachments({}, 2)).to.deep.equal([null, null]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-composition.js --extension js`
Expected: FAIL, cannot resolve `@fontra/core/composition.js`.

- [ ] **Step 3: Add the section name**

In `src-js/fontra-core/src/fontra-internal-schema.js`, add one line to the frozen object, keeping alphabetical-by-value order:

```js
export const FONTRA_INTERNAL_SECTIONS = Object.freeze({
  COMPOSITION: "composition",
  LETTERSPACER: "letterspacer",
  SKELETON: "skeleton",
  SKELETON_DEFAULTS: "skeletonDefaults",
});
```

- [ ] **Step 4: Write the module**

Create `src-js/fontra-core/src/composition.js`:

```js
import {
  getFontraInternalSection,
  setFontraInternalSection,
} from "./fontra-internal-data.js";
import { FONTRA_INTERNAL_SECTIONS } from "./fontra-internal-schema.js";

// An attachment says: this component hangs on the base glyph's anchor of this
// name. Two fields, both structure, so the entry is the same in every layer and
// the section carries no per-layer data. Nothing records what was written: the
// state is read off the drawing, by asking whether the two anchors coincide.
// See docs/superpowers/specs/composition.md section 4.

export function getCompositionData(glyph) {
  return getFontraInternalSection(glyph, FONTRA_INTERNAL_SECTIONS.COMPOSITION);
}

export function setCompositionData(glyph, data) {
  setFontraInternalSection(glyph, FONTRA_INTERNAL_SECTIONS.COMPOSITION, data);
}

export function getAttachments(glyph, componentCount) {
  const stored = getCompositionData(glyph)?.attachments || [];
  const attachments = new Array(componentCount);
  for (let i = 0; i < componentCount; i++) {
    attachments[i] = stored[i] || null;
  }
  return attachments;
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `cd src-js/fontra-core && npx mocha tests/test-composition.js --extension js`
Expected: PASS, 6 passing.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write src-js/fontra-core/src/composition.js src-js/fontra-core/src/fontra-internal-schema.js src-js/fontra-core/tests/test-composition.js
git add .
git commit -m "feat(composition): the stored attachment section and its accessors"
```

---

### Task 2: Matching, and the refusal rules

**Files:**

- Modify: `src-js/fontra-core/src/composition.js`
- Test: `src-js/fontra-core/tests/test-composition.js`

**Interfaces:**

- Produces:
  - `matchAnchorNames(baseNames, markNames) -> {anchorName} | {refusal: "no-shared-anchor" | "ambiguous-mark", names: string[]}`
  - `planAttachments(baseNames, markNamesPerComponent) -> {results: Result[], refusals: Refusal[]}` where `Result = {componentIndex, anchorName}` and `Refusal = {componentIndex, reason, names}`
  - reason is one of `"no-shared-anchor"`, `"ambiguous-mark"`, `"anchor-taken"`

Base names are the plain anchor names of the base glyph. Mark names are the component's anchor names that start with an underscore, with the underscore removed.

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-composition.js`:

```js
import { matchAnchorNames, planAttachments } from "@fontra/core/composition.js";

describe("composition — matching", () => {
  it("matches the one shared name", () => {
    expect(matchAnchorNames(["top", "bottom"], ["top"])).to.deep.equal({
      anchorName: "top",
    });
  });

  it("refuses where nothing is shared", () => {
    expect(matchAnchorNames(["top"], ["bottom"])).to.deep.equal({
      refusal: "no-shared-anchor",
      names: [],
    });
  });

  it("refuses a mark that matches two base anchors", () => {
    expect(matchAnchorNames(["top", "bottom"], ["top", "bottom"])).to.deep.equal({
      refusal: "ambiguous-mark",
      names: ["bottom", "top"],
    });
  });

  it("ignores a mark anchor the base does not carry", () => {
    expect(matchAnchorNames(["top"], ["top", "center"])).to.deep.equal({
      anchorName: "top",
    });
  });
});

describe("composition — planning a whole glyph", () => {
  it("attaches two marks to two different anchors", () => {
    const plan = planAttachments(["top", "bottom"], [["top"], ["bottom"]]);
    expect(plan.results).to.deep.equal([
      { componentIndex: 0, anchorName: "top" },
      { componentIndex: 1, anchorName: "bottom" },
    ]);
    expect(plan.refusals).to.deep.equal([]);
  });

  it("refuses both components where two claim one anchor", () => {
    const plan = planAttachments(["top"], [["top"], ["top"]]);
    expect(plan.results).to.deep.equal([]);
    expect(plan.refusals.map((r) => r.reason)).to.deep.equal([
      "anchor-taken",
      "anchor-taken",
    ]);
  });

  it("refuses only the bad component and keeps the good one", () => {
    const plan = planAttachments(["top", "bottom"], [["top"], ["nothing"]]);
    expect(plan.results).to.deep.equal([{ componentIndex: 0, anchorName: "top" }]);
    expect(plan.refusals).to.deep.equal([
      { componentIndex: 1, reason: "no-shared-anchor", names: [] },
    ]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-composition.js --extension js`
Expected: FAIL, `matchAnchorNames is not a function`.

- [ ] **Step 3: Implement**

Append to `src-js/fontra-core/src/composition.js`:

```js
// Matching compares two name sets: the base's plain anchor names, and the
// component's underscore anchor names with the underscore removed. Exactly one
// shared name is an attachment. Anything else is a refusal, because more than
// one answer means no answer. Spec section 5.1.

export function matchAnchorNames(baseNames, markNames) {
  const base = new Set(baseNames);
  const shared = [...new Set(markNames)].filter((name) => base.has(name)).sort();
  if (shared.length === 1) {
    return { anchorName: shared[0] };
  }
  if (shared.length === 0) {
    return { refusal: "no-shared-anchor", names: [] };
  }
  return { refusal: "ambiguous-mark", names: shared };
}

export function planAttachments(baseNames, markNamesPerComponent) {
  const results = [];
  const refusals = [];
  const claimedBy = new Map();

  for (const [index, markNames] of markNamesPerComponent.entries()) {
    const match = matchAnchorNames(baseNames, markNames);
    if (match.refusal) {
      refusals.push({
        componentIndex: index,
        reason: match.refusal,
        names: match.names,
      });
      continue;
    }
    const previous = claimedBy.get(match.anchorName);
    if (previous === undefined) {
      claimedBy.set(match.anchorName, index);
      results.push({ componentIndex: index, anchorName: match.anchorName });
      continue;
    }
    // Two components want the same anchor. Neither is attached: the glyph has
    // more than one answer, so it has none.
    claimedBy.set(match.anchorName, index);
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].anchorName === match.anchorName) {
        refusals.push({
          componentIndex: results[i].componentIndex,
          reason: "anchor-taken",
          names: [match.anchorName],
        });
        results.splice(i, 1);
      }
    }
    refusals.push({
      componentIndex: index,
      reason: "anchor-taken",
      names: [match.anchorName],
    });
  }

  refusals.sort((a, b) => a.componentIndex - b.componentIndex);
  return { results, refusals };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd src-js/fontra-core && npx mocha tests/test-composition.js --extension js`
Expected: PASS, 14 passing.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src-js/fontra-core/src/composition.js src-js/fontra-core/tests/test-composition.js
git add .
git commit -m "feat(composition): matching, and the two refusal rules"
```

---

### Task 3: The offset solve

**Files:**

- Modify: `src-js/fontra-core/src/composition.js`
- Test: `src-js/fontra-core/tests/test-composition.js`

**Interfaces:**

- Consumes: `decomposedToTransform` from `fontra-core/src/transform.js`.
- Produces:
  - `anchorMap(anchors) -> {[name]: [x, y]}`
  - `plainAnchorNames(anchors) -> string[]` — names not starting with `_`
  - `markAnchorNames(anchors) -> string[]` — names starting with `_`, underscore removed
  - `transformedAnchorMap(anchors, transformation) -> {[name]: [x, y]}` — anchors moved by a decomposed transform
  - `solveOffset(basePosition, markPosition) -> [number, number]`

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-composition.js`:

```js
import {
  markAnchorNames,
  plainAnchorNames,
  solveOffset,
  transformedAnchorMap,
} from "@fontra/core/composition.js";
import { getDecomposedIdentity } from "@fontra/core/transform.js";

describe("composition — anchors and the offset", () => {
  const anchors = [
    { name: "top", x: 250, y: 700 },
    { name: "_top", x: 100, y: 0 },
  ];

  it("splits plain from underscore names", () => {
    expect(plainAnchorNames(anchors)).to.deep.equal(["top"]);
    expect(markAnchorNames(anchors)).to.deep.equal(["top"]);
  });

  it("moves anchors by the component transform", () => {
    const transformation = {
      ...getDecomposedIdentity(),
      translateX: 30,
      translateY: -5,
    };
    const map = transformedAnchorMap(anchors, transformation);
    expect(map["top"]).to.deep.equal([280, 695]);
  });

  it("scales anchors by the component transform", () => {
    const transformation = { ...getDecomposedIdentity(), scaleX: 2, scaleY: 0.5 };
    const map = transformedAnchorMap(anchors, transformation);
    expect(map["top"]).to.deep.equal([500, 350]);
  });

  it("the offset is base minus mark", () => {
    expect(solveOffset([250, 700], [100, 0])).to.deep.equal([150, 700]);
  });

  it("the offset is negative where the mark anchor is above the base anchor", () => {
    expect(solveOffset([0, 100], [0, 300])).to.deep.equal([0, -200]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-composition.js --extension js`
Expected: FAIL, `plainAnchorNames is not a function`.

- [ ] **Step 3: Implement**

Append to `src-js/fontra-core/src/composition.js`, and add the import at the top of the file:

```js
import { decomposedToTransform } from "./transform.js";
```

```js
export function plainAnchorNames(anchors) {
  return (anchors || []).filter((a) => !a.name?.startsWith("_")).map((a) => a.name);
}

export function markAnchorNames(anchors) {
  return (anchors || [])
    .filter((a) => a.name?.startsWith("_"))
    .map((a) => a.name.slice(1));
}

export function anchorMap(anchors) {
  return Object.fromEntries((anchors || []).map((a) => [a.name, [a.x, a.y]]));
}

// The base glyph is a component too, so its anchors are only where the drawing
// says they are once its own transform has been applied. A base that is scaled
// or shifted carries its anchors with it. Spec section 5.2.
export function transformedAnchorMap(anchors, transformation) {
  const t = decomposedToTransform(transformation);
  return Object.fromEntries(
    (anchors || []).map((a) => [a.name, [...t.transformPoint(a.x, a.y)]])
  );
}

export function solveOffset(basePosition, markPosition) {
  return [basePosition[0] - markPosition[0], basePosition[1] - markPosition[1]];
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd src-js/fontra-core && npx mocha tests/test-composition.js --extension js`
Expected: PASS, 19 passing.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src-js/fontra-core/src/composition.js src-js/fontra-core/tests/test-composition.js
git add .
git commit -m "feat(composition): anchor name sets and the offset solve"
```

---

### Task 4: The four states

**Files:**

- Modify: `src-js/fontra-core/src/composition.js`
- Test: `src-js/fontra-core/tests/test-composition.js`

**Interfaces:**

- Produces: `attachmentState({entry, aligned}) -> "unattached" | "broken" | "detached" | "outOfDate" | "inSync"`
  - `entry` is the stored entry or null.
  - `aligned` is true where the two anchors coincide in this layer, false where they do not, and null where one of them is missing.

The state is read off the drawing. Nothing is stored to compare against, because it does not matter which of the two anchors moved: either way they no longer coincide, and either way the designer's two answers are Update and Override.

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-composition.js`:

```js
import { attachmentState } from "@fontra/core/composition.js";

describe("composition — states", () => {
  const entry = (detached = false) => ({ anchorName: "top", detached });

  it("no entry is unattached", () => {
    expect(attachmentState({ entry: null, aligned: true })).to.equal("unattached");
  });

  it("a missing anchor is broken", () => {
    expect(attachmentState({ entry: entry(), aligned: null })).to.equal("broken");
  });

  it("broken beats detached", () => {
    expect(attachmentState({ entry: entry(true), aligned: null })).to.equal("broken");
  });

  it("detached beats out of date", () => {
    expect(attachmentState({ entry: entry(true), aligned: false })).to.equal(
      "detached"
    );
  });

  it("anchors that do not coincide are out of date", () => {
    expect(attachmentState({ entry: entry(), aligned: false })).to.equal("outOfDate");
  });

  it("anchors that coincide are in sync", () => {
    expect(attachmentState({ entry: entry(), aligned: true })).to.equal("inSync");
  });

  it("a detached component that happens to be aligned reads in sync", () => {
    // The flag says the designer overruled the solve. Where the drawing agrees
    // with the solve anyway, there is nothing to overrule and nothing to report.
    expect(attachmentState({ entry: entry(true), aligned: true })).to.equal("inSync");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-composition.js --extension js`
Expected: FAIL, `attachmentState is not a function`.

- [ ] **Step 3: Implement**

Append to `src-js/fontra-core/src/composition.js`:

```js
// Spec section 6. The order of these checks is the behavior, not a style
// choice. Broken is checked before detached, because a missing anchor is a
// fault the designer has to see whatever else they said. Detached is checked
// before out of date, because it is the designer overruling the solve.
export function attachmentState({ entry, aligned }) {
  if (!entry) {
    return "unattached";
  }
  if (aligned === null || aligned === undefined) {
    return "broken";
  }
  if (aligned) {
    return "inSync";
  }
  return entry.detached ? "detached" : "outOfDate";
}

// Grid coordinates are whole units, so an exact comparison is the right one.
// A tolerance here would report a component one unit off as attached.
export function anchorsCoincide(basePosition, markPosition) {
  if (!basePosition || !markPosition) {
    return null;
  }
  return basePosition[0] === markPosition[0] && basePosition[1] === markPosition[1];
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd src-js/fontra-core && npx mocha tests/test-composition.js --extension js`
Expected: PASS, 26 passing.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src-js/fontra-core/src/composition.js src-js/fontra-core/tests/test-composition.js
git add .
git commit -m "feat(composition): the four attachment states, read off the drawing"
```

---

### Task 5: Component-list bookkeeping

**Files:**

- Modify: `src-js/fontra-core/src/composition.js`
- Test: `src-js/fontra-core/tests/test-composition.js`

**Interfaces:**

- Produces:
  - `remapAttachmentsForInsert(attachments, index, count) -> (Entry|null)[]`
  - `remapAttachmentsForDelete(attachments, indices) -> (Entry|null)[]`

Both return a new array. The attachment list is positional, so any operation that restructures the component list has to move the entries with it. Deleting the base — index 0 — leaves the remaining entries in place: the new first component becomes the base, and every surviving entry will be re-solved against it and will report broken or out of date, which is the correct report.

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-composition.js`:

```js
import {
  remapAttachmentsForDelete,
  remapAttachmentsForInsert,
} from "@fontra/core/composition.js";

describe("composition — component-list bookkeeping", () => {
  const a = { anchorName: "top", detached: false };
  const b = { anchorName: "bottom", detached: false };

  it("inserting at the end leaves entries alone", () => {
    expect(remapAttachmentsForInsert([null, a], 2, 1)).to.deep.equal([null, a, null]);
  });

  it("inserting in the middle shifts later entries right", () => {
    expect(remapAttachmentsForInsert([null, a, b], 1, 2)).to.deep.equal([
      null,
      null,
      null,
      a,
      b,
    ]);
  });

  it("deleting one entry shifts later entries left", () => {
    expect(remapAttachmentsForDelete([null, a, b], [1])).to.deep.equal([null, b]);
  });

  it("deletes several indices in any order", () => {
    expect(remapAttachmentsForDelete([null, a, b], [2, 0])).to.deep.equal([a]);
  });

  it("deleting nothing changes nothing", () => {
    expect(remapAttachmentsForDelete([null, a], [])).to.deep.equal([null, a]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-composition.js --extension js`
Expected: FAIL, `remapAttachmentsForInsert is not a function`.

- [ ] **Step 3: Implement**

Append to `src-js/fontra-core/src/composition.js`:

```js
// The attachment list is positional, because components carry no stable id in
// Fontra. So every operation that restructures the component list moves the
// entries in the same change. Five sites do that: add component, paste, cut,
// delete selection, and decompose. Spec section 4.1.

export function remapAttachmentsForInsert(attachments, index, count) {
  const remapped = [...attachments];
  remapped.splice(index, 0, ...new Array(count).fill(null));
  return remapped;
}

export function remapAttachmentsForDelete(attachments, indices) {
  const drop = new Set(indices);
  return attachments.filter((_, index) => !drop.has(index));
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd src-js/fontra-core && npx mocha tests/test-composition.js --extension js`
Expected: PASS, 31 passing.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src-js/fontra-core/src/composition.js src-js/fontra-core/tests/test-composition.js
git add .
git commit -m "feat(composition): component-list bookkeeping for the attachment list"
```

---

### Task 6: The decomposition to a component list

**Files:**

- Modify: `src-js/fontra-core/src/composition.js`
- Test: `src-js/fontra-core/tests/test-composition.js`

**Interfaces:**

- Consumes: `unicodeMadeOf` from `fontra-core/src/unicode-utils.js`.
- Produces: `decomposeToGlyphNames(codePoint, glyphNameForCodePoint) -> {glyphNames: string[], missing: number[]}`
  - `glyphNameForCodePoint` is a function from a code point to a glyph name or undefined. The caller supplies it, so this module never touches a font controller.
  - `glyphNames` is in the order the Unicode table gives, which puts the base first.
  - `missing` holds the code points the lookup could not name.

- [ ] **Step 1: Write the failing test**

Append to `src-js/fontra-core/tests/test-composition.js`:

```js
import { decomposeToGlyphNames } from "@fontra/core/composition.js";

describe("composition — decomposition", () => {
  const names = { 0x61: "a", 0x301: "acutecomb" };
  const lookup = (codePoint) => names[codePoint];

  it("names the parts of aacute", () => {
    // U+00E1 LATIN SMALL LETTER A WITH ACUTE
    const result = decomposeToGlyphNames(0x00e1, lookup);
    expect(result.glyphNames).to.deep.equal(["a", "acutecomb"]);
    expect(result.missing).to.deep.equal([]);
  });

  it("reports a part the font cannot name", () => {
    const result = decomposeToGlyphNames(0x00e1, (cp) =>
      cp === 0x61 ? "a" : undefined
    );
    expect(result.glyphNames).to.deep.equal(["a"]);
    expect(result.missing).to.deep.equal([0x301]);
  });

  it("returns nothing for a character with no decomposition", () => {
    const result = decomposeToGlyphNames(0x61, lookup);
    expect(result.glyphNames).to.deep.equal([]);
    expect(result.missing).to.deep.equal([]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd src-js/fontra-core && npx mocha tests/test-composition.js --extension js`
Expected: FAIL, `decomposeToGlyphNames is not a function`.

- [ ] **Step 3: Implement**

Append to `src-js/fontra-core/src/composition.js`, and add the import at the top:

```js
import { unicodeMadeOf } from "./unicode-utils.js";
```

```js
// The Related Glyphs panel already displays this decomposition. The build
// action uses the same table, so the two cannot disagree about what a
// character is made of. Spec section 7.1.
export function decomposeToGlyphNames(codePoint, glyphNameForCodePoint) {
  const glyphNames = [];
  const missing = [];
  for (const partCodePoint of unicodeMadeOf(codePoint)) {
    const glyphName = glyphNameForCodePoint(partCodePoint);
    if (glyphName) {
      glyphNames.push(glyphName);
    } else {
      missing.push(partCodePoint);
    }
  }
  return { glyphNames, missing };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd src-js/fontra-core && npx mocha tests/test-composition.js --extension js`
Expected: PASS, 34 passing.

If the first test fails because the table gives the parts in a different order, do not sort them. Read `src-js/fontra-core/src/unicode-utils.js` and correct the expectation to what the table actually returns, then record the order in a comment.

- [ ] **Step 5: Run the whole core suite**

Run: `cd src-js/fontra-core && npm test`
Expected: PASS. The suite was 1690 tests before this plan; it should now be 1690 plus the 34 added here.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write src-js/fontra-core/src/composition.js src-js/fontra-core/tests/test-composition.js
git add .
git commit -m "feat(composition): the Unicode decomposition to a component list"
```

---

### Task 7: The write path — attach, update, override, detach

**Files:**

- Create: `src-js/views-editor/src/composition-editing.js`

**Interfaces:**

- Consumes: everything Task 1 to Task 6 produced. `editGlyphAndRecordChanges` on the scene controller. `getGlyph` on the font controller. `copyComponent` from `fontra-core/src/var-glyph.js`. `getDecomposedIdentity` from `fontra-core/src/transform.js`.
- Produces:
  - `readCompositionState(sceneController) -> Promise<{rows: Row[], baseGlyphName: string|null}>` where `Row = {componentIndex, componentName, state, anchorName, refusal}`
  - `attachComponent(sceneController, componentIndex) -> Promise<void>`
  - `updateComponent(sceneController, componentIndex) -> Promise<void>`
  - `overrideComponent(sceneController, componentIndex) -> Promise<void>`
  - `detachComponent(sceneController, componentIndex) -> Promise<void>`
  - `solveGlyphAttachments(fontController, varGlyph) -> Promise<{[layerName]: {[componentIndex]: {offset: [number, number] | null, aligned: boolean | null}}}>`

There is no test harness here. This task carries a manual matrix instead.

- [ ] **Step 1: Write the module**

Create `src-js/views-editor/src/composition-editing.js`:

```js
import {
  anchorsCoincide,
  attachmentState,
  getAttachments,
  getCompositionData,
  markAnchorNames,
  matchAnchorNames,
  plainAnchorNames,
  setCompositionData,
  solveOffset,
  transformedAnchorMap,
} from "@fontra/core/composition.js";
import { translate } from "@fontra/core/localization.js";

// THE ONE WRITE PATH. Nothing outside this module writes the composition
// section, and nothing outside it writes a component transform on behalf of an
// attachment. This is rail R-C applied to a second feature: undo, incremental
// sync and multi-layer editing then come from the existing change system with
// no work of their own.

function setComponentOffset(component, offset) {
  component.transformation.translateX = offset[0];
  component.transformation.translateY = offset[1];
}

// Read every component glyph this composite uses, instantiated at the location
// of each of the composite's own sources. Returns, per layer name, the anchor
// maps the solve needs.
async function readAnchorsPerLayer(fontController, varGlyph) {
  const perLayer = {};
  const getGlyphFunc = fontController.getGlyph.bind(fontController);

  for (const source of varGlyph.sources) {
    if (source.inactive) {
      continue;
    }
    const layerGlyph = varGlyph.layers[source.layerName]?.glyph;
    if (!layerGlyph) {
      continue;
    }
    const perComponent = [];
    for (const component of layerGlyph.components) {
      const baseVarGlyph = await fontController.getGlyph(component.name);
      if (!baseVarGlyph) {
        perComponent.push(null);
        continue;
      }
      const { instance } = await baseVarGlyph.instantiate(
        { ...source.location, ...component.location },
        getGlyphFunc
      );
      perComponent.push(instance?.anchors || []);
    }
    perLayer[source.layerName] = perComponent;
  }
  return perLayer;
}

// The base is the first component. Its anchors are read through its own
// transform, so a base that is scaled or shifted carries its anchors with it.
export async function solveGlyphAttachments(fontController, varGlyph) {
  const anchorsPerLayer = await readAnchorsPerLayer(fontController, varGlyph);
  const solved = {};

  for (const [layerName, perComponent] of Object.entries(anchorsPerLayer)) {
    const layerGlyph = varGlyph.layers[layerName].glyph;
    const attachments = getAttachments(varGlyph, layerGlyph.components.length);
    const baseAnchors = perComponent[0];
    const baseComponent = layerGlyph.components[0];
    const perIndex = {};

    const baseMap =
      baseAnchors && baseComponent
        ? transformedAnchorMap(baseAnchors, baseComponent.transformation)
        : {};

    for (const [index, entry] of attachments.entries()) {
      if (!entry || index === 0) {
        continue;
      }
      const component = layerGlyph.components[index];
      const basePosition = baseMap[entry.anchorName];
      const markAnchor = (perComponent[index] || []).find(
        (a) => a.name === `_${entry.anchorName}`
      );
      if (!basePosition || !markAnchor || !component) {
        perIndex[index] = { offset: null, aligned: null };
        continue;
      }
      // Where the mark's anchor sits now, with the component's own transform
      // applied. In sync is this landing on the base anchor.
      const placed = transformedAnchorMap([markAnchor], component.transformation)[
        markAnchor.name
      ];
      perIndex[index] = {
        offset: solveOffset(basePosition, [markAnchor.x, markAnchor.y]),
        aligned: anchorsCoincide(basePosition, placed),
      };
    }
    solved[layerName] = perIndex;
  }
  return solved;
}

async function getVarGlyph(sceneController) {
  const controller =
    await sceneController.sceneModel.getSelectedVariableGlyphController();
  return controller?.glyph || null;
}

export async function readCompositionState(sceneController) {
  const varGlyph = await getVarGlyph(sceneController);
  if (!varGlyph) {
    return { rows: [], baseGlyphName: null };
  }
  const fontController = sceneController.fontController;
  const layerName = sceneController.sceneSettings.editLayerName;
  const layerGlyph =
    varGlyph.layers[layerName]?.glyph ||
    Object.values(varGlyph.layers)[0]?.glyph ||
    null;
  if (!layerGlyph) {
    return { rows: [], baseGlyphName: null };
  }

  const solved = await solveGlyphAttachments(fontController, varGlyph);
  const solvedHere = solved[layerName] || Object.values(solved)[0] || {};
  const attachments = getAttachments(varGlyph, layerGlyph.components.length);
  const anchorsPerLayer = await readAnchorsPerLayer(fontController, varGlyph);
  const perComponent = anchorsPerLayer[layerName] || Object.values(anchorsPerLayer)[0];

  const baseNames = plainAnchorNames(perComponent?.[0] || []);
  const rows = [];

  for (const [index, component] of layerGlyph.components.entries()) {
    if (index === 0) {
      rows.push({
        componentIndex: index,
        componentName: component.name,
        state: "base",
        anchorName: null,
        refusal: null,
      });
      continue;
    }
    const entry = attachments[index];
    const match = entry
      ? null
      : matchAnchorNames(baseNames, markAnchorNames(perComponent?.[index] || []));
    rows.push({
      componentIndex: index,
      componentName: component.name,
      state: attachmentState({ entry, aligned: solvedHere[index]?.aligned ?? null }),
      anchorName: entry?.anchorName || match?.anchorName || null,
      refusal: match?.refusal || null,
    });
  }

  return { rows, baseGlyphName: layerGlyph.components[0]?.name || null };
}

function writeAttachments(varGlyph, mutate) {
  const layerGlyph = Object.values(varGlyph.layers)[0]?.glyph;
  const count = layerGlyph?.components.length || 0;
  const attachments = getAttachments(varGlyph, count);
  mutate(attachments);
  setCompositionData(varGlyph, {
    ...(getCompositionData(varGlyph) || {}),
    attachments,
  });
}

export async function attachComponent(sceneController, componentIndex) {
  const fontController = sceneController.fontController;
  const varGlyphBefore = await getVarGlyph(sceneController);
  if (!varGlyphBefore) {
    return;
  }
  const anchorsPerLayer = await readAnchorsPerLayer(fontController, varGlyphBefore);
  const perComponent = Object.values(anchorsPerLayer)[0] || [];
  const match = matchAnchorNames(
    plainAnchorNames(perComponent[0] || []),
    markAnchorNames(perComponent[componentIndex] || [])
  );
  if (match.refusal) {
    return;
  }

  await sceneController.editGlyphAndRecordChanges((varGlyph) => {
    writeAttachments(varGlyph, (attachments) => {
      attachments[componentIndex] = { anchorName: match.anchorName, detached: false };
    });
    return translate("composition.undo.attach");
  });

  await updateComponent(sceneController, componentIndex);
}

export async function updateComponent(sceneController, componentIndex) {
  const fontController = sceneController.fontController;
  const varGlyphBefore = await getVarGlyph(sceneController);
  if (!varGlyphBefore) {
    return;
  }
  const solved = await solveGlyphAttachments(fontController, varGlyphBefore);

  await sceneController.editGlyphAndRecordChanges((varGlyph) => {
    for (const [layerName, perIndex] of Object.entries(solved)) {
      const offset = perIndex[componentIndex]?.offset;
      const component = varGlyph.layers[layerName]?.glyph?.components[componentIndex];
      if (!offset || !component) {
        continue;
      }
      setComponentOffset(component, offset);
    }
    writeAttachments(varGlyph, (attachments) => {
      const entry = attachments[componentIndex];
      if (entry) {
        attachments[componentIndex] = { ...entry, detached: false };
      }
    });
    return translate("composition.undo.update");
  });
}

export async function overrideComponent(sceneController, componentIndex) {
  await sceneController.editGlyphAndRecordChanges((varGlyph) => {
    writeAttachments(varGlyph, (attachments) => {
      const entry = attachments[componentIndex];
      if (entry) {
        attachments[componentIndex] = { ...entry, detached: true };
      }
    });
    return translate("composition.undo.override");
  });
}

export async function detachComponent(sceneController, componentIndex) {
  await sceneController.editGlyphAndRecordChanges((varGlyph) => {
    writeAttachments(varGlyph, (attachments) => {
      attachments[componentIndex] = null;
    });
    return translate("composition.undo.detach");
  });
}
```

- [ ] **Step 2: Add the four strings**

In `src-js/fontra-core/assets/lang/en.js`, add four entries beside the existing groups:

```js
"composition.undo.attach": "Attach Component",
"composition.undo.update": "Update Attached Component",
"composition.undo.override": "Override Attached Component",
"composition.undo.detach": "Detach Component",
```

- [ ] **Step 3: Check the syntax**

Run: `node --check src-js/views-editor/src/composition-editing.js`
Expected: no output.

- [ ] **Step 4: Format and commit**

```bash
npx prettier --write src-js/views-editor/src/composition-editing.js src-js/fontra-core/assets/lang/en.js
git add .
git commit -m "feat(composition): the one write path for attach, update, override and detach"
```

- [ ] **Step 5: Record the manual matrix**

This module has no user interface yet, so it cannot be exercised until Task 9. Add these rows to the matrix in Task 9 rather than running them here.

---

### Task 8: Bookkeeping at the five component-list sites

**Files:**

- Modify: `src-js/views-editor/src/editor.js` — four sites
- Modify: `src-js/views-editor/src/scene-controller.js` — one site

**Interfaces:**

- Consumes: `getAttachments`, `setCompositionData`, `getCompositionData`, `remapAttachmentsForInsert`, `remapAttachmentsForDelete` from `fontra-core/src/composition.js`.
- Produces: nothing new. It keeps the attachment list pointing at the right components.

The five sites, found with `grep -n "components.splice\|components.push" src-js/views-editor/src/*.js`:

| File                  | Roughly at                                                                 | Operation         |
| --------------------- | -------------------------------------------------------------------------- | ----------------- |
| `editor.js`           | `components.splice(componentIndex, 1)` in the cut path                     | delete            |
| `editor.js`           | `layerGlyph.components.push(...pasteGlyph.components...)`                  | insert at the end |
| `editor.js`           | `components.splice(componentIndex, 1)` in the delete-selection path        | delete            |
| `editor.js`           | `layerGlyph.components.push(copyComponent(newComponent))` in add component | insert at the end |
| `scene-controller.js` | `components.splice(componentIndex, 1)` in decompose                        | delete            |

- [ ] **Step 1: Add one helper to the write path module**

Add `remapAttachmentsForDelete` and `remapAttachmentsForInsert` to the **existing** import from
`@fontra/core/composition.js` at the top of `src-js/views-editor/src/composition-editing.js`. Do
not add a second import statement from the same module. Then append:

```js
// Called from every operation that restructures the component list, inside the
// same change that restructures it. The attachment list is positional, so an
// operation that moves components and does not move entries silently retargets
// every attachment after the edit. Spec section 4.1.
export function recordComponentInsert(varGlyph, index, count, componentCountBefore) {
  const attachments = getAttachments(varGlyph, componentCountBefore);
  setCompositionData(varGlyph, {
    ...(getCompositionData(varGlyph) || {}),
    attachments: remapAttachmentsForInsert(attachments, index, count),
  });
}

export function recordComponentDelete(varGlyph, indices, componentCountBefore) {
  const attachments = getAttachments(varGlyph, componentCountBefore);
  setCompositionData(varGlyph, {
    ...(getCompositionData(varGlyph) || {}),
    attachments: remapAttachmentsForDelete(attachments, indices),
  });
}
```

- [ ] **Step 2: Wire the five sites**

At each site, the edit already runs inside a change recorder over the layers. The attachment list lives on the variable glyph, one level up. Where the site has the variable glyph in hand, call the helper there. Where it has only the layer glyphs, use `editGlyphAndRecordChanges` instead of `editLayersAndRecordChanges`, so the same change carries both.

Read each site before changing it. Do not restructure the surrounding function. The change at each site is: capture the component count before the mutation, perform the existing mutation unchanged, and call the matching helper once with the variable glyph.

- [ ] **Step 3: Check the syntax**

```bash
node --check src-js/views-editor/src/editor.js
node --check src-js/views-editor/src/scene-controller.js
node --check src-js/views-editor/src/composition-editing.js
```

Expected: no output from any of the three.

- [ ] **Step 4: Format and commit**

```bash
npx prettier --write src-js/views-editor/src/editor.js src-js/views-editor/src/scene-controller.js src-js/views-editor/src/composition-editing.js
git add .
git commit -m "feat(composition): keep the attachment list aligned at the five component-list sites"
```

- [ ] **Step 5: Add to the manual matrix in Task 9**

- Attach a component, then add a second component before it, and confirm the attachment still names the first one.
- Attach a component, cut another component that sits before it, and confirm the same.
- Attach a component, paste two components, and confirm the same.
- Attach a component, decompose a different component, and confirm the same.

---

### Task 9: The panel section

**Files:**

- Modify: `src-js/views-editor/src/panel-related-glyphs.js`
- Modify: `src-js/fontra-core/assets/lang/en.js`

**Interfaces:**

- Consumes: `readCompositionState`, `attachComponent`, `updateComponent`, `overrideComponent`, `detachComponent` from `composition-editing.js`.
- Produces: nothing other modules use.

The panel computes nothing. It asks for the state and calls the write path.

- [ ] **Step 1: Add the section to the panel**

In `src-js/views-editor/src/panel-related-glyphs.js`, add a second panel section **above** the glyph-cell view, so the composition controls are the first thing in the panel and the glyph cells keep the flexible height they have now.

The section holds one row per component. Each row shows: the component name, its state, the anchor name where it has one, and the buttons its state allows.

| State      | Buttons                                                                           |
| ---------- | --------------------------------------------------------------------------------- |
| base       | none                                                                              |
| unattached | Attach, where matching found a name. Otherwise the refusal reason, and no button. |
| inSync     | Detach                                                                            |
| outOfDate  | Update, Override, Detach                                                          |
| detached   | Update, Detach                                                                    |
| broken     | Detach                                                                            |

Refresh the section from the same throttled update the panel already runs on `selectedGlyphName`, and also on a glyph change, so an edit inside the glyph re-reads the state.

- [ ] **Step 2: Add the strings**

In `src-js/fontra-core/assets/lang/en.js`:

```js
"composition.title": "Composition",
"composition.state.base": "base",
"composition.state.unattached": "not attached",
"composition.state.in-sync": "in sync",
"composition.state.out-of-date": "out of date",
"composition.state.detached": "detached",
"composition.state.broken": "broken",
"composition.refusal.no-shared-anchor": "no shared anchor",
"composition.refusal.ambiguous-mark": "more than one shared anchor",
"composition.refusal.anchor-taken": "two components want this anchor",
"composition.button.attach": "Attach",
"composition.button.update": "Update",
"composition.button.override": "Override",
"composition.button.detach": "Detach",
```

- [ ] **Step 3: Check the syntax**

Run: `node --check src-js/views-editor/src/panel-related-glyphs.js`
Expected: no output.

- [ ] **Step 4: Run the manual matrix**

Use a font with `a`, `acutecomb` and an `aacute` you build by hand with two components. The user runs bundle-watch, so reload the editor rather than building.

- Open `aacute`, confirm the first row says base and carries no buttons.
- Press Attach on the acute row. The component moves to the anchor. The row says in sync.
- Move the `top` anchor in `a`, return to `aacute`, confirm the row says out of date.
- Press Update. The component moves. The row says in sync.
- Move the `top` anchor again, return, press Override. The row says detached and the component does not move.
- Drag the acute component by hand. The row says out of date, because the two anchors no longer coincide.
- Press Detach. The row says not attached and the component stays where it is.
- Delete the `top` anchor from `a`, return, confirm the row says broken.
- Add a component before the acute, and confirm the attachment still names the acute.
- Cut a component before the acute, and confirm the same.
- Paste two components, and confirm the same.
- Decompose a different component, and confirm the same.
- Undo each of the four actions and confirm the glyph returns exactly.
- Switch to a second master and confirm Update wrote a different offset there.

Record the result of each row in the development log entry of Task 13.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src-js/views-editor/src/panel-related-glyphs.js src-js/fontra-core/assets/lang/en.js
git add .
git commit -m "feat(composition): the panel section, its rows and its four actions"
```

---

### Task 10: Build one glyph

**Files:**

- Modify: `src-js/views-editor/src/composition-editing.js`
- Modify: `src-js/views-editor/src/panel-related-glyphs.js`
- Modify: `src-js/fontra-core/assets/lang/en.js`

**Interfaces:**

- Consumes: `decomposeToGlyphNames`, `planAttachments`, `plainAnchorNames`, `markAnchorNames` from `fontra-core/src/composition.js`. `copyComponent` and `getDecomposedIdentity`.
- Produces: `buildGlyph(sceneController, glyphName) -> Promise<{status: "built"|"skipped"|"refused", reason?: string}>`

The steps of the build, in order, from spec section 7.1:

1. Read the glyph's Unicode decomposition, mapping each code point through the font's character map first and the combined glyph map second.
2. Add the components the decomposition names that are not already present. Leave existing components alone.
3. Plan the attachments for every non-base component. If the plan holds any refusal, write nothing at all and return refused with the reason. A glyph with more than one answer gets none.
4. Set the advance width from the base glyph, once, in every layer.
5. Write the attachments and the solved offsets.

- [ ] **Step 1: Write the function**

Append `buildGlyph` to `src-js/views-editor/src/composition-editing.js`. It runs the five steps above inside one `editGlyphAndRecordChanges` call, so one undo step covers the whole build. The undo label is `translate("composition.undo.build")`.

The glyph name for a code point comes from `sceneController.fontController.characterMap[codePoint]`, and where that is undefined, from the combined glyph map the scene controller already holds.

- [ ] **Step 2: Add the button and the strings**

Add a Build button to the composition section, enabled where the open glyph has a Unicode decomposition. Add:

```js
"composition.undo.build": "Build Glyph",
"composition.button.build": "Build",
"composition.refused": "Refused: {0}",
```

- [ ] **Step 3: Check the syntax**

```bash
node --check src-js/views-editor/src/composition-editing.js
node --check src-js/views-editor/src/panel-related-glyphs.js
```

Expected: no output.

- [ ] **Step 4: Run the manual matrix**

- Build an empty `aacute` from a font holding `a` and `acutecomb`. Two components appear, the acute is attached and placed, and the width equals the width of `a`.
- Build the same glyph again. Nothing changes and the result is skipped.
- Build `aacute` where the acute is already present as a component. The existing component is attached, and no second acute appears.
- Build `Aringacute`. It is refused, with the reason naming the anchor two components want.
- Build a glyph whose decomposition names a glyph the font does not carry. It is refused, and the reason names the missing glyph.
- Build a glyph with no decomposition. The button is disabled.
- Undo a build. Both components and the attachments go, and the width returns.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src-js/views-editor/src/composition-editing.js src-js/views-editor/src/panel-related-glyphs.js src-js/fontra-core/assets/lang/en.js
git add .
git commit -m "feat(composition): build one glyph from its Unicode decomposition"
```

---

### Task 11: Build many glyphs

**Files:**

- Modify: `src-js/views-editor/src/composition-editing.js`
- Modify: `src-js/views-editor/src/panel-related-glyphs.js`
- Modify: `src-js/fontra-core/assets/lang/en.js`

**Interfaces:**

- Consumes: `buildGlyph` from Task 10. `unicodeUsedBy` from `fontra-core/src/unicode-utils.js`. The scene controller's glyph sets controller.
- Produces: `buildGlyphs(sceneController, glyphNames) -> Promise<{built: string[], skipped: string[], refused: {glyphName, reason}[]}>`

- [ ] **Step 1: Write the function**

`buildGlyphs` calls `buildGlyph` per name and collects the three lists. Each glyph is its own change, so one refusal does not roll back the others.

The target list comes from one of two places, per spec section 7.2:

- **From a mark.** With a mark glyph open, the code points from `unicodeUsedBy` of its code point.
- **From a selection.** The selected glyph names.

**The combined glyph map bounds the list.** Take it from the scene controller, which already builds one. A name not in that map is not a target and is not reported. A name in the map that the font does not carry is created before it is built.

- [ ] **Step 2: Add the button, the report and the strings**

A Compose All button appears on a mark glyph. It shows the three counts when it finishes, and the refusals with their reasons.

```js
"composition.button.compose-all": "Compose all with this mark",
"composition.report": "{0} built, {1} already in sync, {2} refused",
```

- [ ] **Step 3: Check the syntax**

```bash
node --check src-js/views-editor/src/composition-editing.js
node --check src-js/views-editor/src/panel-related-glyphs.js
```

Expected: no output.

- [ ] **Step 4: Run the manual matrix**

- Open `acutecomb` in a font with no glyph set selected. Compose All builds only the accented glyphs the font already carries.
- Select a glyph set that holds more accented glyphs than the font. Compose All creates the missing ones and builds them.
- Run Compose All twice. The second run reports everything as already in sync and writes nothing.
- Confirm a refused glyph names its reason and that the glyphs after it in the list were still built.
- Undo after a batch. Confirm what an undo covers, and write the answer into the development log: one glyph, or the batch.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src-js/views-editor/src/composition-editing.js src-js/views-editor/src/panel-related-glyphs.js src-js/fontra-core/assets/lang/en.js
git add .
git commit -m "feat(composition): build every glyph that uses a mark, bounded by the glyph set"
```

---

### Task 12: The mark cloud

**Files:**

- Create: `src-js/views-editor/src/visualization-layer-composition.js`
- Modify: `src-js/views-editor/src/visualization-layer-definitions.js`
- Modify: `src-js/views-editor/src/panel-related-glyphs.js`
- Modify: `src-js/fontra-core/src/application-settings.js`
- Modify: `src-js/fontra-core/assets/lang/en.js`

**Interfaces:**

- Consumes: `plainAnchorNames`, `markAnchorNames`, `solveOffset`, `anchorMap` from `fontra-core/src/composition.js`.
- Produces: a registered layer named `fontra.composition.mark-cloud`.

Per rail R-A, the draw lives in the new file and `visualization-layer-definitions.js` registers it with `draw: <importedFn>` only.

- [ ] **Step 1: Write the draw**

Create `src-js/views-editor/src/visualization-layer-composition.js`. It draws, for each plain anchor of the open glyph, every mark in the current set whose underscore anchor carries that name, at the offset the solve gives. It writes nothing.

- [ ] **Step 2: Register the layer**

In `src-js/views-editor/src/visualization-layer-definitions.js`, add the registration beside the existing ones, importing the draw.

- [ ] **Step 3: Add the switch and the sets**

The controls appear only where the open glyph carries at least one plain anchor, which is the base-glyph case. On a mark glyph they are absent.

- A switch that turns the cloud on and off.
- A tickable list of the marks that can attach, one per mark, remembered per glyph.

Store both in `applicationSettingsController`, which is localStorage. They are view preferences, and decision D9 keeps view preferences out of project files.

- [ ] **Step 4: Check the syntax**

```bash
node --check src-js/views-editor/src/visualization-layer-composition.js
node --check src-js/views-editor/src/visualization-layer-definitions.js
node --check src-js/views-editor/src/panel-related-glyphs.js
```

Expected: no output.

- [ ] **Step 5: Run the manual matrix**

- Open `a`. The cloud draws every mark that carries `_top`.
- Untick one mark. It disappears and the rest stay.
- Drag the `top` anchor. Every drawn mark follows in the same frame.
- Turn the switch off. Nothing is drawn and no state is lost.
- Open `acutecomb`. The switch and the list are absent.
- Open a glyph carrying `top` and `bottom`. Both families draw, each at its own anchor.
- Reload the editor. The switch and the ticks are as they were left.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write src-js/views-editor/src/visualization-layer-composition.js src-js/views-editor/src/visualization-layer-definitions.js src-js/views-editor/src/panel-related-glyphs.js src-js/fontra-core/src/application-settings.js src-js/fontra-core/assets/lang/en.js
git add .
git commit -m "feat(composition): the mark cloud on a base glyph, with a per-glyph set"
```

---

### Task 13: Fold the documents

**Files:**

- Modify: `docs/superpowers/GLOSSARY.md`
- Modify: `docs/superpowers/FEATURE-MODEL.md`
- Modify: `docs/superpowers/FEATURE-ARCHITECTURE-MAP.md`
- Modify: `docs/superpowers/DEVELOPMENT-LOG.md`
- Delete: `docs/superpowers/specs/composition.md`
- Delete: `docs/superpowers/plans/2026-08-27-composition.md`

A plan that outlives its implementation is worse than no plan. The durable content of both files moves into the four documents, and both files go.

- [ ] **Step 1: Glossary**

Add the seven terms from spec section 2: base glyph, mark, attachment, anchor pair, detached component, mark cloud, glyph set. Keep the existing style: what the thing is first, the rule after.

- [ ] **Step 2: Feature model**

Add a section at the end, numbered after the last one. Do not renumber anything. It carries: what the feature is, what is stored and why it is glyph-level, the solve, the four states, the two build actions, the preview, and the list of what must be preserved.

The preserve list starts with these:

- The attachment list is the same length as the component list, and the five sites keep it that way.
- More than one answer means no answer. Nothing attaches and nothing is added.
- The base is the first component, and its anchors are read through its own transform.
- A stale glyph is reported and never rewritten. The report is read off the drawing, and nothing records what was written.
- One write path.

- [ ] **Step 3: Architecture map**

Add an F11 row to the inventory in section 1 with the owned files and the entry point. Add a per-feature file map in section 3. Add the new hunks to the shared-file reverse index in section 4. Add the section name to the persistence list in section 5. Add a row to the test coverage map in section 6.

Take the line counts from `git diff --numstat` against `upstream/main`, not from this plan.

- [ ] **Step 4: Development log**

Add a section for the feature. It carries the faults that came back during the work, the measurements that settled anything, and the ideas that were withdrawn. Start it with the decisions in spec section 12, each with its cost.

Record the two answers the manual matrices produced: what an undo covers after a batch build, and the order the Unicode decomposition table returns its parts.

- [ ] **Step 5: Delete the spec and the plan**

```bash
git rm docs/superpowers/specs/composition.md docs/superpowers/plans/2026-08-27-composition.md
```

- [ ] **Step 6: Commit**

```bash
npx prettier --write docs/superpowers/GLOSSARY.md docs/superpowers/FEATURE-MODEL.md docs/superpowers/FEATURE-ARCHITECTURE-MAP.md docs/superpowers/DEVELOPMENT-LOG.md
git add .
git commit -m "docs(composition): fold the spec and the plan into the four documents"
```

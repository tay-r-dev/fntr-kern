# Sidebearing Metrics Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a sidebearing reference (`=n`) a persistent, re-resolvable link instead of a one-shot evaluation.

**Architecture:** A link layer on top of the existing margin-setting path. The expression the user types is stored in `fontra.internal` customData at two levels — glyph-wide (shared) and per-layer (source override) — and replayed through one shared resolver on demand. Refresh is always manual: a per-glyph Update button and a font-wide Update-all action. No automatic propagation, no reverse dependency index.

**Tech Stack:** Vanilla ES modules. `fontra-core` (pure, mocha + chai). `views-editor` and `fontra-webcomponents` (no test harness — manual test matrices).

**Spec:** `docs/superpowers/specs/2026-07-24-sidebearing-variables-design.md`. Read §3, §4, §7 before starting.

## Global Constraints

- **Never run `npm run bundle` or any build.** The user runs bundle-watch continuously and reports compile errors. After editing frontend source, stop.
- **Tests:** only `fontra-core` has a harness. Run `cd src-js/fontra-core && npm test`. `views-editor` and `fontra-webcomponents` changes carry a manual test matrix instead — execute it and report results; do not claim an interaction works without running it.
- **Every commit:** `node --check` on touched `.js` files under `views-editor`/`fontra-webcomponents`, and `npx prettier --write` on files you created or substantially rewrote. Do **not** reformat `panel-selection-info.js`, `panel-letterspacer.js` or `editor.js` wholesale — they are shared files and a reformat buries the diff.
- **Commit style:** state what changed and why, plainly. No narration of the discovery process.
- **Rail R-B — one copy of every constant and geometry function.** If a symbol exists, import it. Specifically: there must be exactly one left-margin setter and one right-margin setter after Task 3.
- **Rail R-A — layer placement.** Pure parse/format/cascade logic goes in `fontra-core/src/metrics-keys.js`. Panel logic stays in the panel. The resolver stays in `panel-selection-info.js` (it needs `fontController`).
- **UI naming:** user-facing labels describe the effect. Check `fontra-core/assets/lang/en.js` for existing vocabulary before inventing a term. Never surface a donor/plugin product name.
- **Stored expression never carries the `=`.** The prefix is UI syntax only.
- **Left before right.** Whenever both sides are applied in one pass, apply left first — setting the left margin translates the path and changes what the raw right margin means.

## Known limitation (documented, not fixed here)

Setting the left margin translates the outline path but does **not** translate skeleton data. `panel-selection-info.js`'s existing `setValue` has always had this gap; letterspacer works around it separately (`panel-letterspacer.js:575-581` calls `editSkeleton` + `translateSkeletonData`). The Update and Update-all paths in this plan inherit the gap, so pressing Update on a skeleton glyph with a keyed left margin will desync the skeleton from the outline.

Spec §9 puts skeleton-move work explicitly out of scope. **Do not fix it in this plan.** Add the note below to `docs/superpowers/FEATURE-ARCHITECTURE-MAP.md` §7 residue #2 in Task 6 so it is filed rather than forgotten.

## File structure

| File                                             | Responsibility                                                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fontra-core/src/fontra-internal-schema.js`      | add the `SIDEBEARING_KEYS` section constant                                                                                                         |
| `fontra-core/src/metrics-keys.js` _(new)_        | parse/format the `=` syntax; read/write/delete keys on an entity; resolve the two-level cascade; staleness test. Pure — no `fontController`, no DOM |
| `fontra-core/tests/test-metrics-keys.js` _(new)_ | mocha coverage for the above                                                                                                                        |
| `fontra-webcomponents/src/ui-form.js`            | let an expression number field hold a string value, carry a read-only adornment, and render a stale style                                           |
| `views-editor/src/panel-selection-info.js`       | the resolver, the margin setters, key persistence, field display, Update / Unlink / Override controls                                               |
| `views-editor/src/panel-letterspacer.js`         | the `mayReplaceMetricsKeys` font-level flag and the per-side guard in `applySpacing`                                                                |
| `views-editor/src/editor.js`                     | register the **Update all metrics** action                                                                                                          |
| `fontra-core/assets/lang/en.js`                  | all UI strings                                                                                                                                      |

---

### Task 1: Core module — parse, store, cascade

Pure logic with a mocha harness. Everything that can regress silently lives here.

**Files:**

- Modify: `src-js/fontra-core/src/fontra-internal-schema.js:4-8`
- Create: `src-js/fontra-core/src/metrics-keys.js`
- Test: `src-js/fontra-core/tests/test-metrics-keys.js`

**Interfaces:**

- Consumes: `getFontraInternalSection` / `setFontraInternalSection` from `fontra-internal-data.js`; `FONTRA_INTERNAL_KEY`, `FONTRA_INTERNAL_SECTIONS` from `fontra-internal-schema.js`.
- Produces:
  - `SIDEBEARING_SIDES` — `{ left: "left", right: "right" }`
  - `SIDE_METRIC_PROPERTY` — `{ left: "leftMargin", right: "rightMargin" }`
  - `METRICS_KEY_PREFIX` — `"="`
  - `STALE_EPSILON` — `0.5`
  - `parseMetricsKey(input) → { isKey: boolean, expression?: string, error?: string }`
  - `formatMetricsKeyDisplay(expression) → string`
  - `getSidebearingKey(entity, side) → string | undefined`
  - `setSidebearingKey(entity, side, expression) → void`
  - `deleteSidebearingKey(entity, side) → boolean`
  - `hasAnySidebearingKey(entity) → boolean`
  - `getEffectiveMetricsKey(varGlyph, layerGlyph, side) → { expression, level } | null` where `level` is `"source"` or `"shared"`
  - `isMetricsValueStale(appliedValue, resolvedValue) → boolean`
  - `isSelfReferenceSameSide(expression, glyphName) → boolean`

- [ ] **Step 1: Add the section constant**

In `src-js/fontra-core/src/fontra-internal-schema.js`, extend the frozen object:

```js
export const FONTRA_INTERNAL_SECTIONS = Object.freeze({
  LETTERSPACER: "letterspacer",
  SIDEBEARING_KEYS: "sidebearingKeys",
  SKELETON: "skeleton",
  SKELETON_DEFAULTS: "skeletonDefaults",
});
```

- [ ] **Step 2: Write the failing tests**

Create `src-js/fontra-core/tests/test-metrics-keys.js`:

```js
import { expect } from "chai";
import { FONTRA_INTERNAL_KEY } from "@fontra/core/fontra-internal-schema.js";
import {
  deleteSidebearingKey,
  formatMetricsKeyDisplay,
  getEffectiveMetricsKey,
  getSidebearingKey,
  hasAnySidebearingKey,
  isMetricsValueStale,
  parseMetricsKey,
  setSidebearingKey,
  SIDE_METRIC_PROPERTY,
} from "@fontra/core/metrics-keys.js";

describe("metrics-keys", () => {
  describe("parseMetricsKey", () => {
    it("recognizes a simple key", () => {
      expect(parseMetricsKey("=n")).to.deep.equal({ isKey: true, expression: "n" });
    });

    it("trims whitespace around the prefix and the expression", () => {
      expect(parseMetricsKey("  =  n  ")).to.deep.equal({
        isKey: true,
        expression: "n",
      });
    });

    it("keeps the opposite-side marker", () => {
      expect(parseMetricsKey("=o!")).to.deep.equal({ isKey: true, expression: "o!" });
    });

    it("keeps a full expression verbatim", () => {
      expect(parseMetricsKey("=(a+b)/2")).to.deep.equal({
        isKey: true,
        expression: "(a+b)/2",
      });
    });

    it("treats a bare glyph name as not a key", () => {
      expect(parseMetricsKey("n")).to.deep.equal({ isKey: false });
    });

    it("treats a plain number as not a key", () => {
      expect(parseMetricsKey("80")).to.deep.equal({ isKey: false });
    });

    it("treats a non-string as not a key", () => {
      expect(parseMetricsKey(80)).to.deep.equal({ isKey: false });
      expect(parseMetricsKey(undefined)).to.deep.equal({ isKey: false });
    });

    it("reports an error for a bare prefix", () => {
      const result = parseMetricsKey("=");
      expect(result.isKey).to.equal(false);
      expect(result.error).to.be.a("string");
    });

    it("reports an error for a prefix with only whitespace", () => {
      expect(parseMetricsKey("=   ").error).to.be.a("string");
    });
  });

  describe("formatMetricsKeyDisplay", () => {
    it("puts the prefix back", () => {
      expect(formatMetricsKeyDisplay("n")).to.equal("=n");
    });
  });

  describe("key storage", () => {
    it("round-trips a key", () => {
      const entity = {};
      setSidebearingKey(entity, "left", "n");
      expect(getSidebearingKey(entity, "left")).to.equal("n");
      expect(getSidebearingKey(entity, "right")).to.equal(undefined);
    });

    it("stores under the sidebearingKeys section", () => {
      const entity = {};
      setSidebearingKey(entity, "right", "o!");
      expect(
        entity.customData[FONTRA_INTERNAL_KEY].sidebearingKeys.right.expression
      ).to.equal("o!");
    });

    it("replaces an existing key on the same side", () => {
      const entity = {};
      setSidebearingKey(entity, "left", "n");
      setSidebearingKey(entity, "left", "m");
      expect(getSidebearingKey(entity, "left")).to.equal("m");
    });

    it("keeps the other side when one side is deleted", () => {
      const entity = {};
      setSidebearingKey(entity, "left", "n");
      setSidebearingKey(entity, "right", "o");
      expect(deleteSidebearingKey(entity, "left")).to.equal(true);
      expect(getSidebearingKey(entity, "left")).to.equal(undefined);
      expect(getSidebearingKey(entity, "right")).to.equal("o");
    });

    it("returns false when deleting a key that isn't there", () => {
      expect(deleteSidebearingKey({}, "left")).to.equal(false);
    });

    it("removes fontra.internal entirely when the last key goes", () => {
      const entity = {};
      setSidebearingKey(entity, "left", "n");
      deleteSidebearingKey(entity, "left");
      expect(entity.customData[FONTRA_INTERNAL_KEY]).to.equal(undefined);
    });

    it("leaves fontra.internal alone when another section is present", () => {
      const entity = {};
      setSidebearingKey(entity, "left", "n");
      entity.customData[FONTRA_INTERNAL_KEY].skeleton = { contours: [] };
      deleteSidebearingKey(entity, "left");
      expect(entity.customData[FONTRA_INTERNAL_KEY].skeleton).to.deep.equal({
        contours: [],
      });
      expect(entity.customData[FONTRA_INTERNAL_KEY].sidebearingKeys).to.equal(
        undefined
      );
    });

    it("reports whether any key exists", () => {
      const entity = {};
      expect(hasAnySidebearingKey(entity)).to.equal(false);
      setSidebearingKey(entity, "left", "n");
      expect(hasAnySidebearingKey(entity)).to.equal(true);
    });

    it("tolerates an entity with no customData", () => {
      expect(getSidebearingKey({}, "left")).to.equal(undefined);
      expect(getSidebearingKey(undefined, "left")).to.equal(undefined);
      expect(hasAnySidebearingKey(undefined)).to.equal(false);
    });
  });

  describe("getEffectiveMetricsKey", () => {
    it("returns null when neither level has a key", () => {
      expect(getEffectiveMetricsKey({}, {}, "left")).to.equal(null);
    });

    it("falls back to the shared key", () => {
      const varGlyph = {};
      setSidebearingKey(varGlyph, "left", "n");
      expect(getEffectiveMetricsKey(varGlyph, {}, "left")).to.deep.equal({
        expression: "n",
        level: "shared",
      });
    });

    it("prefers the source override", () => {
      const varGlyph = {};
      const layerGlyph = {};
      setSidebearingKey(varGlyph, "left", "n");
      setSidebearingKey(layerGlyph, "left", "m");
      expect(getEffectiveMetricsKey(varGlyph, layerGlyph, "left")).to.deep.equal({
        expression: "m",
        level: "source",
      });
    });

    it("applies the cascade per side", () => {
      const varGlyph = {};
      const layerGlyph = {};
      setSidebearingKey(varGlyph, "left", "n");
      setSidebearingKey(varGlyph, "right", "o");
      setSidebearingKey(layerGlyph, "right", "p");
      expect(getEffectiveMetricsKey(varGlyph, layerGlyph, "left").level).to.equal(
        "shared"
      );
      expect(getEffectiveMetricsKey(varGlyph, layerGlyph, "right").level).to.equal(
        "source"
      );
    });
  });

  describe("isMetricsValueStale", () => {
    it("is false when the values agree", () => {
      expect(isMetricsValueStale(80, 80)).to.equal(false);
    });

    it("is false for sub-epsilon drift", () => {
      expect(isMetricsValueStale(80, 80.2)).to.equal(false);
    });

    it("is true for a one-unit difference", () => {
      expect(isMetricsValueStale(80, 81)).to.equal(true);
    });

    it("is false when either value is not a finite number", () => {
      expect(isMetricsValueStale(undefined, 80)).to.equal(false);
      expect(isMetricsValueStale(80, undefined)).to.equal(false);
      expect(isMetricsValueStale(80, NaN)).to.equal(false);
    });
  });

  describe("isSelfReferenceSameSide", () => {
    it("is true when a glyph keys its own side to itself", () => {
      expect(isSelfReferenceSameSide("o", "o")).to.equal(true);
    });

    it("tolerates surrounding whitespace", () => {
      expect(isSelfReferenceSameSide("  o  ", "o")).to.equal(true);
    });

    it("is false for the opposite side", () => {
      expect(isSelfReferenceSameSide("o!", "o")).to.equal(false);
    });

    it("is false for another glyph", () => {
      expect(isSelfReferenceSameSide("n", "o")).to.equal(false);
    });

    it("is false for an expression that merely mentions the glyph", () => {
      expect(isSelfReferenceSameSide("(o+n)/2", "o")).to.equal(false);
    });
  });

  describe("SIDE_METRIC_PROPERTY", () => {
    it("maps sides to controller properties", () => {
      expect(SIDE_METRIC_PROPERTY.left).to.equal("leftMargin");
      expect(SIDE_METRIC_PROPERTY.right).to.equal("rightMargin");
    });
  });
});
```

Add `isSelfReferenceSameSide` to the import list at the top of the test file.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src-js/fontra-core && npx mocha tests/test-metrics-keys.js --extension js --extension ts --reporter spec`
Expected: FAIL — cannot resolve `@fontra/core/metrics-keys.js`.

- [ ] **Step 4: Write the module**

Create `src-js/fontra-core/src/metrics-keys.js`:

```js
import {
  getFontraInternalSection,
  setFontraInternalSection,
} from "./fontra-internal-data.js";
import {
  FONTRA_INTERNAL_KEY,
  FONTRA_INTERNAL_SECTIONS,
} from "./fontra-internal-schema.js";

const SECTION = FONTRA_INTERNAL_SECTIONS.SIDEBEARING_KEYS;

export const SIDEBEARING_SIDES = Object.freeze({ left: "left", right: "right" });

export const SIDE_METRIC_PROPERTY = Object.freeze({
  left: "leftMargin",
  right: "rightMargin",
});

// A leading "=" marks a persistent link, matching Glyphs and RoboFont. It is UI
// syntax only: the stored expression never carries it.
export const METRICS_KEY_PREFIX = "=";

// Margins are edited at one decimal, so anything under half a unit is display
// rounding, not a real divergence.
export const STALE_EPSILON = 0.5;

export function parseMetricsKey(input) {
  if (typeof input !== "string") {
    return { isKey: false };
  }
  const trimmed = input.trim();
  if (!trimmed.startsWith(METRICS_KEY_PREFIX)) {
    return { isKey: false };
  }
  const expression = trimmed.slice(METRICS_KEY_PREFIX.length).trim();
  if (!expression) {
    return { isKey: false, error: "empty metrics key" };
  }
  return { isKey: true, expression };
}

export function formatMetricsKeyDisplay(expression) {
  return `${METRICS_KEY_PREFIX}${expression}`;
}

function getKeysSection(entity) {
  const section = getFontraInternalSection(entity, SECTION);
  return section && typeof section === "object" && !Array.isArray(section)
    ? section
    : null;
}

export function getSidebearingKey(entity, side) {
  const expression = getKeysSection(entity)?.[side]?.expression;
  return typeof expression === "string" ? expression : undefined;
}

export function hasAnySidebearingKey(entity) {
  const section = getKeysSection(entity);
  if (!section) {
    return false;
  }
  return Object.keys(SIDEBEARING_SIDES).some(
    (side) => getSidebearingKey(entity, side) !== undefined
  );
}

export function setSidebearingKey(entity, side, expression) {
  const section = { ...(getKeysSection(entity) || {}) };
  section[side] = { expression: String(expression) };
  setFontraInternalSection(entity, SECTION, section);
}

export function deleteSidebearingKey(entity, side) {
  const section = getKeysSection(entity);
  if (!section || !(side in section)) {
    return false;
  }
  const next = { ...section };
  delete next[side];
  if (Object.keys(next).length) {
    setFontraInternalSection(entity, SECTION, next);
  } else {
    setFontraInternalSection(entity, SECTION, undefined);
    pruneEmptyFontraInternal(entity);
  }
  return true;
}

// Leave no residue in a glyph that has no forkra data at all. Only prune when
// schemaVersion is the sole survivor — other sections (skeleton, letterspacer)
// must be left alone.
function pruneEmptyFontraInternal(entity) {
  const internal = entity?.customData?.[FONTRA_INTERNAL_KEY];
  if (!internal) {
    return;
  }
  const remaining = Object.keys(internal).filter((key) => key !== "schemaVersion");
  if (!remaining.length) {
    delete entity.customData[FONTRA_INTERNAL_KEY];
  }
}

// The cascade: a source override shadows the shared key for that source only.
export function getEffectiveMetricsKey(varGlyph, layerGlyph, side) {
  const override = getSidebearingKey(layerGlyph, side);
  if (override !== undefined) {
    return { expression: override, level: "source" };
  }
  const shared = getSidebearingKey(varGlyph, side);
  if (shared !== undefined) {
    return { expression: shared, level: "shared" };
  }
  return null;
}

export function isMetricsValueStale(appliedValue, resolvedValue) {
  if (!Number.isFinite(appliedValue) || !Number.isFinite(resolvedValue)) {
    return false;
  }
  return Math.abs(appliedValue - resolvedValue) > STALE_EPSILON;
}

// "o"'s left keyed to "=o" is an identity: applying it can only write the value
// it just read (spec §7 case 3). The opposite side ("=o!") is legitimate
// symmetry and is not caught here.
export function isSelfReferenceSameSide(expression, glyphName) {
  return typeof expression === "string" && expression.trim() === glyphName;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src-js/fontra-core && npx mocha tests/test-metrics-keys.js --extension js --extension ts --reporter spec`
Expected: PASS, every test in the file green, 0 failing.

- [ ] **Step 6: Run the full core suite for regressions**

Run: `cd src-js/fontra-core && npm test`
Expected: PASS. The count should be the previous total (1391 at the last doc verification — take whatever the suite reports on `main` as the baseline) plus the new tests. No failures.

- [ ] **Step 7: Format and commit**

```bash
cd src-js/fontra-core && npx prettier --write src/metrics-keys.js tests/test-metrics-keys.js src/fontra-internal-schema.js
cd ../.. && git add . && git commit -m "feat(metrics-keys): add core parse, storage and cascade helpers

Adds the sidebearingKeys fontra.internal section and a pure module for the
= prefix syntax, two-level key storage with empty-section cleanup, the
source-override cascade and the staleness test."
```

---

### Task 2: `ui-form` — string values, adornment, stale style

The sidebearing fields are `edit-number-x-y`, which routes to `_addEditNumberExpression`. It currently assumes a numeric value and has no place for a read-only suffix. Three small additions, all opt-in and inert for every existing caller.

**Files:**

- Modify: `src-js/fontra-webcomponents/src/ui-form.js:15-129` (styles), `:357-449` (`_addEditNumberExpression`), `:752-754` (`maybeRoundToString`)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: three new optional `fieldItem` properties honoured by `_addEditNumberExpression`:
  - `fieldItem.value` may now be a `string` (rendered verbatim, not rounded)
  - `fieldItem.displayValue: string | undefined` — read-only text rendered after the input
  - `fieldItem.stale: boolean | undefined` — adds the `field-stale` class to the input

- [ ] **Step 1: Let `maybeRoundToString` pass strings through**

`round()` on a string yields `NaN`, which would blank a field whose value is `"=n"`. Replace the function at `src-js/fontra-webcomponents/src/ui-form.js:752-754`:

```js
function maybeRoundToString(value, digits) {
  if (value == undefined) {
    return "";
  }
  if (typeof value === "string") {
    // Expression fields may hold a metrics key such as "=n" — never round it.
    return value;
  }
  return digits == undefined ? value : round(value, digits);
}
```

- [ ] **Step 2: Add the styles**

In the `static styles` template at `src-js/fontra-webcomponents/src/ui-form.js:15`, append these rules just before the closing backtick of the `.ui-form-icon` block region (anywhere inside the template is fine; keep it next to the other `.ui-form-value` rules at `:106-119`):

```css
.ui-form-value .field-adornment {
  opacity: 0.6;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.ui-form-value input.field-stale {
  outline: 1.5px solid var(--fontra-color-warning, #e0a030);
  outline-offset: -1.5px;
}
```

- [ ] **Step 3: Render the adornment and the stale class**

In `_addEditNumberExpression`, replace the tail of the function (currently `src-js/fontra-webcomponents/src/ui-form.js:445-449`):

```js
    this._fieldGetters[fieldItem.key] = () => inputElement.value;
    this._fieldSetters[fieldItem.key] = (value) =>
      (inputElement.value = maybeRoundToString(value, fieldItem.numDigits));
    valueElement.appendChild(inputElement);
  }
```

with:

```js
    if (fieldItem.stale) {
      inputElement.classList.add("field-stale");
    }

    this._fieldGetters[fieldItem.key] = () => inputElement.value;
    this._fieldSetters[fieldItem.key] = (value) =>
      (inputElement.value = maybeRoundToString(value, fieldItem.numDigits));
    valueElement.appendChild(inputElement);

    if (fieldItem.displayValue !== undefined) {
      // Read-only companion to the editable expression: the resolved number is
      // shown beside the field, never baked into its value.
      valueElement.appendChild(
        html.span({ class: "field-adornment" }, [fieldItem.displayValue])
      );
    }
  }
```

- [ ] **Step 4: Verify `html` is imported**

Run: `grep -n "^import \* as html\|^import { html" src-js/fontra-webcomponents/src/ui-form.js`
Expected: a line importing `html` from `@fontra/core/html-utils.js`. If absent, add `import * as html from "@fontra/core/html-utils.js";` to the import block at the top of the file.

- [ ] **Step 5: Syntax check**

Run: `node --check src-js/fontra-webcomponents/src/ui-form.js`
Expected: no output (exit 0).

- [ ] **Step 6: Manual test matrix**

Nothing consumes the new properties yet, so this checks for regressions only. In the editor:

| #   | Action                                            | Expected                                                       |
| --- | ------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Select a glyph; look at the Sidebearings row      | Two numeric fields as before, unchanged                        |
| 2   | Type `120` into the left sidebearing, press Enter | Margin applies as before                                       |
| 3   | Type `n` (bare, no `=`) into the left sidebearing | One-shot evaluation as before, field shows the resolved number |
| 4   | Type `garbage!!` into the left sidebearing        | Field reverts, validation message as before                    |
| 5   | Check the Advance Width field                     | Unchanged                                                      |

- [ ] **Step 7: Format and commit**

```bash
npx prettier --write src-js/fontra-webcomponents/src/ui-form.js
git add . && git commit -m "feat(ui-form): support string values, a read-only adornment and a stale style on expression number fields

Sidebearing metrics keys need the editable value to be an expression while the
resolved number shows beside it. displayValue previously served only the range
slider; the edit-number expression field had no equivalent."
```

---

### Task 3: Extract the margin setters and generalize the resolver

Pure refactor — no behavior change. Everything after this depends on there being exactly one left-margin setter, one right-margin setter and one resolver.

**Files:**

- Modify: `src-js/views-editor/src/panel-selection-info.js:250-306` (field definitions), `:929-1008` (resolver), and module scope near `maybeClampValue` at `:1144`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces (module scope in `panel-selection-info.js`):
  - `setLeftMarginOnLayer(layerGlyph, layerGlyphController, value) → void`
  - `setRightMarginOnLayer(layerGlyph, layerGlyphController, value) → void`
  - `MARGIN_SETTERS` — `{ left: setLeftMarginOnLayer, right: setRightMarginOnLayer }`
  - `resolveMetricsExpression(fontController, expression, metricProperty, locations, mainLayerName) → Promise<number | { error } | { getValue(layerName), value }>` where `locations` is `{ [layerName]: location }`
- Produces (method): `SelectionInfoPanel._evaluateMetricsExpression` keeps its signature and becomes a thin caller.

- [ ] **Step 1: Add the margin setters at module scope**

In `src-js/views-editor/src/panel-selection-info.js`, immediately after the `maybeClampValue` function (currently ending at `:1152`), add:

```js
// The single left-margin setter. Setting the left margin translates the whole
// outline, so it must run before any right-margin write in the same pass.
function setLeftMarginOnLayer(layerGlyph, layerGlyphController, value) {
  const translationX = maybeClampValue(
    value - layerGlyphController.leftMargin,
    -layerGlyph.xAdvance,
    undefined
  );
  for (const i of range(0, layerGlyph.path.coordinates.length, 2)) {
    layerGlyph.path.coordinates[i] += translationX;
  }
  for (const compo of layerGlyph.components) {
    compo.transformation.translateX += translationX;
  }
  layerGlyph.xAdvance += translationX;
}

// The single right-margin setter.
function setRightMarginOnLayer(layerGlyph, layerGlyphController, value) {
  const translationX = maybeClampValue(
    value - layerGlyphController.rightMargin,
    -layerGlyph.xAdvance,
    undefined
  );
  layerGlyph.xAdvance += translationX;
}

const MARGIN_SETTERS = Object.freeze({
  left: setLeftMarginOnLayer,
  right: setRightMarginOnLayer,
});
```

- [ ] **Step 2: Point the two field definitions at the setters**

In the sidebearings form item, replace the `setValue` body of `fieldX` (`:268-281`):

```js
            setValue: (layerGlyph, layerGlyphController, fieldItem, value) => {
              setLeftMarginOnLayer(layerGlyph, layerGlyphController, value);
            },
```

and of `fieldY` (`:297-304`):

```js
            setValue: (layerGlyph, layerGlyphController, fieldItem, value) => {
              setRightMarginOnLayer(layerGlyph, layerGlyphController, value);
            },
```

- [ ] **Step 3: Extract the resolver to module scope**

Add at module scope in the same file (next to the margin setters):

```js
// One implementation of the nameCapture -> compute -> instantiateController
// chain. Callers supply the locations to resolve at, so this serves both the
// editing-layer case (typing in the field) and the arbitrary-source case
// (Update / Update all), which must resolve sources that are not open.
async function resolveMetricsExpression(
  fontController,
  expression,
  metricProperty,
  locations,
  mainLayerName
) {
  const sidebearingOpposites = {
    leftMargin: "rightMargin",
    rightMargin: "leftMargin",
  };

  const numericValue = Number(expression);
  if (!isNaN(numericValue)) {
    return numericValue;
  }

  const { names, namespace } = nameCapture(
    fontController.glyphMap,
    (nameObject, name) =>
      nameObject[name] ||
      (sidebearingOpposites[metricProperty] &&
        name.endsWith("!") &&
        nameObject[name.slice(0, -1)])
        ? 1
        : undefined
  );

  try {
    compute(expression, undefined, namespace);
  } catch (e) {
    return { error: e.message };
  }

  const layerVariables = {};
  for (const name of names) {
    const referencedGlyphName = name.endsWith("!") ? name.slice(0, -1) : name;
    const referencedGlyph = await fontController.getGlyph(referencedGlyphName);
    if (!referencedGlyph) {
      // Referenced glyph is missing (spec §7 case 1): report rather than throw.
      return { error: `unknown glyph: ${referencedGlyphName}` };
    }
    for (const [layerName, location] of Object.entries(locations)) {
      const getGlyphFunc = fontController.getGlyph.bind(fontController);
      const instanceController = await referencedGlyph.instantiateController(
        location,
        layerName,
        getGlyphFunc
      );
      if (!layerVariables[layerName]) {
        layerVariables[layerName] = {};
      }
      layerVariables[layerName][referencedGlyphName] =
        instanceController[metricProperty];
      if (name.endsWith("!") && sidebearingOpposites[metricProperty]) {
        layerVariables[layerName][referencedGlyphName + "!"] =
          instanceController[sidebearingOpposites[metricProperty]];
      }
    }
  }

  return {
    getValue: (layerName) => {
      try {
        return ensureFiniteNumber(
          compute(expression, undefined, layerVariables[layerName])
        );
      } catch (e) {
        console.error(e);
      }
      return 0;
    },
    value: ensureFiniteNumber(
      compute(expression, undefined, layerVariables[mainLayerName])
    ),
  };
}
```

- [ ] **Step 4: Reduce the method to a caller**

Replace the whole body of `_evaluateMetricsExpression` (`:929-997`) with:

```js
  async _evaluateMetricsExpression(expression, varGlyphController, metricProperty) {
    const { mainLayerName, locations } = this._getEditingLocations(varGlyphController);
    return await resolveMetricsExpression(
      this.fontController,
      expression,
      metricProperty,
      locations,
      mainLayerName
    );
  }
```

Leave `_getEditingLocations` (`:999-1008`) as it is.

- [ ] **Step 5: Confirm `ensureFiniteNumber` is reachable at module scope**

Run: `grep -n "ensureFiniteNumber" src-js/views-editor/src/panel-selection-info.js`
Expected: a definition or import. If it is defined as a class method rather than a module function, move it to module scope unchanged before proceeding — `resolveMetricsExpression` is not a method and cannot reach `this`.

- [ ] **Step 6: Syntax check**

Run: `node --check src-js/views-editor/src/panel-selection-info.js`
Expected: no output (exit 0).

- [ ] **Step 7: Manual test matrix — regression only**

| #   | Action                                                           | Expected                                                     |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Type `100` into the left sidebearing                             | Outline shifts, advance follows; same as before              |
| 2   | Type `100` into the right sidebearing                            | Advance changes, outline does not move                       |
| 3   | Type `n` into `o`'s left sidebearing                             | Resolves to `n`'s left margin, applied once                  |
| 4   | Type `n!` into `o`'s left sidebearing                            | Resolves to `n`'s **right** margin                           |
| 5   | Type `(a+b)/2` into a sidebearing                                | Resolves and applies                                         |
| 6   | Type `zzz` (no such glyph)                                       | Field reverts with a validation message, nothing applied     |
| 7   | Open two sources for editing, type `n` into the left sidebearing | Each editing layer gets `n` resolved at **its own** location |
| 8   | Undo each of the above                                           | Reverts in one step                                          |

- [ ] **Step 8: Commit**

```bash
node --check src-js/views-editor/src/panel-selection-info.js
git add . && git commit -m "refactor(selection-info): single margin setters and one location-parameterized resolver

The margin math was inline in two setValue closures and the metrics evaluator
was bound to the editing layers. Update and Update-all must resolve sources that
are not open, so the chain is now parameterized by an explicit locations map.
No behavior change."
```

---

### Task 4: Create and clear a shared key

The `=` prefix becomes meaningful. The key is written in the **same** `recordChanges` pass as the margin, so creating a link is one undo step (spec §4.1).

**Files:**

- Modify: `src-js/views-editor/src/panel-selection-info.js` — imports, sidebearing field definitions (`:250-306`), `applyNewValue` (`:1111-1142`), plus two new methods

**Interfaces:**

- Consumes: `parseMetricsKey`, `setSidebearingKey`, `deleteSidebearingKey`, `getSidebearingKey`, `SIDE_METRIC_PROPERTY` from Task 1; `MARGIN_SETTERS` from Task 3.
- Produces:
  - `fieldItem.recordExtraChanges(glyph, layerInfo, value)` — optional hook invoked inside `applyNewValue`'s `recordChanges` callback
  - `SelectionInfoPanel._evaluateSidebearingInput(input, varGlyphController, side)`
  - `SelectionInfoPanel._recordPendingMetricsKey(glyph, layerInfo, side)`
  - `this._pendingMetricsKeyEdit` — `{ side, action: "set" | "clear", expression? } | null`

- [ ] **Step 1: Add the imports**

At the top of `src-js/views-editor/src/panel-selection-info.js`, add after the `html-utils` import (keep the import block alphabetical by module path — `metrics-keys.js` sorts after `localization.js`):

```js
import {
  deleteSidebearingKey,
  getSidebearingKey,
  parseMetricsKey,
  setSidebearingKey,
  SIDE_METRIC_PROPERTY,
} from "@fontra/core/metrics-keys.js";
```

- [ ] **Step 2: Add the input handler**

Add as a method on `SelectionInfoPanel`, next to `_evaluateMetricsExpression`:

```js
  // Field entry point for a sidebearing. Decides whether the input creates a
  // persistent link (leading "=") or is a one-shot value, records the intent,
  // and returns the resolved value for the normal apply path.
  async _evaluateSidebearingInput(input, varGlyphController, side) {
    const metricProperty = SIDE_METRIC_PROPERTY[side];
    const parsed = parseMetricsKey(input);

    if (parsed.error) {
      return { error: parsed.error };
    }

    if (!parsed.isKey) {
      // A plain number or a bare one-shot reference breaks any existing link
      // at the level this field is bound to (spec §4.4).
      this._pendingMetricsKeyEdit = { side, action: "clear" };
      return await this._evaluateMetricsExpression(
        input,
        varGlyphController,
        metricProperty
      );
    }

    const result = await this._evaluateMetricsExpression(
      parsed.expression,
      varGlyphController,
      metricProperty
    );
    if (result?.error) {
      this._pendingMetricsKeyEdit = null;
      return result;
    }

    this._pendingMetricsKeyEdit = {
      side,
      action: "set",
      expression: parsed.expression,
    };
    return result;
  }
```

- [ ] **Step 3: Add the key writer**

Add directly below it:

```js
  // Runs inside applyNewValue's recordChanges callback, so the key and the
  // margin land in one undo step. Writes at the level the field is bound to:
  // a source override if this side already has one, otherwise the shared key.
  _recordPendingMetricsKey(glyph, layerInfo, side) {
    const pending = this._pendingMetricsKeyEdit;
    this._pendingMetricsKeyEdit = null;
    if (!pending || pending.side !== side) {
      return;
    }

    const overriddenLayerNames = layerInfo
      .map(({ layerName }) => layerName)
      .filter(
        (layerName) =>
          getSidebearingKey(glyph.layers[layerName]?.glyph, side) !== undefined
      );

    if (pending.action === "clear") {
      if (overriddenLayerNames.length) {
        for (const layerName of overriddenLayerNames) {
          deleteSidebearingKey(glyph.layers[layerName].glyph, side);
        }
      } else {
        deleteSidebearingKey(glyph, side);
      }
      return;
    }

    if (overriddenLayerNames.length) {
      for (const layerName of overriddenLayerNames) {
        setSidebearingKey(glyph.layers[layerName].glyph, side, pending.expression);
      }
    } else {
      setSidebearingKey(glyph, side, pending.expression);
    }
  }
```

- [ ] **Step 4: Initialize the pending slot**

In the `SelectionInfoPanel` constructor (`:32`), after `this.sceneController = ...`, add:

```js
this._pendingMetricsKeyEdit = null;
```

- [ ] **Step 5: Call the hook from `applyNewValue`**

In `applyNewValue` (`:1119-1141`), add the hook call at the end of the `recordChanges` callback, after the `for` loop closes and before the callback's closing brace:

```js
return recordChanges(glyph, (glyph) => {
  const layers = glyph.layers;
  for (const { layerName, layerGlyphController, orgValue } of layerInfo) {
    // ... unchanged loop body ...
  }
  // Optional per-field hook: lets a field record extra changes (eg. a metrics
  // key) inside the same undo step as the value it just applied.
  fieldItem.recordExtraChanges?.(glyph, layerInfo, value);
});
```

- [ ] **Step 6: Rewire the two sidebearing fields**

In the sidebearings form item, replace `fieldX`'s `evaluateExpression` (`:259-264`) with:

```js
            evaluateExpression: async (input) =>
              await this._evaluateSidebearingInput(input, varGlyphController, "left"),
            recordExtraChanges: (glyph, layerInfo) =>
              this._recordPendingMetricsKey(glyph, layerInfo, "left"),
```

and `fieldY`'s (`:287-292`) with:

```js
            evaluateExpression: async (input) =>
              await this._evaluateSidebearingInput(input, varGlyphController, "right"),
            recordExtraChanges: (glyph, layerInfo) =>
              this._recordPendingMetricsKey(glyph, layerInfo, "right"),
```

- [ ] **Step 7: Syntax check**

Run: `node --check src-js/views-editor/src/panel-selection-info.js`
Expected: no output (exit 0).

- [ ] **Step 8: Manual test matrix**

The field still displays a number after these steps — display comes in Task 5. Verify persistence with the browser console:
`await (await fontController.getGlyph("o")).glyph.customData`

| #   | Action                                             | Expected                                                                                                  |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Type `=n` into `o`'s left sidebearing              | Margin becomes `n`'s left margin; `customData["fontra.internal"].sidebearingKeys.left.expression === "n"` |
| 2   | Type `=n!` into `o`'s left sidebearing             | Margin becomes `n`'s **right** margin; stored expression is `"n!"`                                        |
| 3   | Type `=(a+b)/2`                                    | Resolves; stored expression is `"(a+b)/2"` verbatim                                                       |
| 4   | Type `n` (no `=`) into a fresh glyph's sidebearing | Resolves once; **no** `sidebearingKeys` section written                                                   |
| 5   | On the keyed field from #1, type `85`              | Margin becomes 85; the `left` key is gone                                                                 |
| 6   | On the keyed field from #1, type `=m`              | Key replaced with `"m"`                                                                                   |
| 7   | Key the left side, then key the right side         | Both keys present; `fontra.internal` has one `sidebearingKeys` object with two entries                    |
| 8   | Clear both keys by typing numbers                  | `sidebearingKeys` gone; `fontra.internal` gone entirely if the glyph has no skeleton                      |
| 9   | Repeat #8 on a glyph **with** a skeleton           | `sidebearingKeys` gone, `skeleton` section intact                                                         |
| 10  | Type `=` alone                                     | Field reverts with a validation message; nothing written                                                  |
| 11  | Type `=zzz` (no such glyph)                        | Field reverts with a validation message; **no** key written                                               |
| 12  | Undo after #1                                      | Margin and key revert together, one undo press                                                            |
| 13  | Reload the page after #1                           | Key still there                                                                                           |

- [ ] **Step 9: Commit**

```bash
node --check src-js/views-editor/src/panel-selection-info.js
git add . && git commit -m "feat(metrics-keys): persist a sidebearing link typed with the = prefix

Creating a link writes the key in the same recordChanges pass as the margin, so
it is one undo step. A plain number or a bare reference clears the key at its
level, preserving the existing one-shot behavior."
```

---

### Task 5: Display the key, the resolved number and the stale marker

**Files:**

- Modify: `src-js/views-editor/src/panel-selection-info.js` — `update()` (`:136-306`)
- Modify: `src-js/fontra-core/assets/lang/en.js`

**Interfaces:**

- Consumes: `getEffectiveMetricsKey`, `formatMetricsKeyDisplay`, `isMetricsValueStale`, `SIDE_METRIC_PROPERTY` from Task 1; `resolveMetricsExpression` from Task 3; `displayValue` / `stale` from Task 2.
- Produces: `SelectionInfoPanel._getMetricsKeyDisplay(varGlyphController, glyphController, side) → Promise<{ expression, level, resolvedValue, stale } | null>`

- [ ] **Step 1: Add the lang strings**

In `src-js/fontra-core/assets/lang/en.js`, next to `"sidebar.selection-info.sidebearings"` (`:554`):

```js
  "sidebar.selection-info.metrics-key.stale.tooltip":
    "Referenced glyph changed — press Update",
```

- [ ] **Step 2: Add the display helper**

Add as a method on `SelectionInfoPanel`:

```js
  // Resolves the current source's effective key for one side, for display only.
  // The live resolve doubles as the staleness test (spec §4.8) — no watcher.
  async _getMetricsKeyDisplay(varGlyphController, glyphController, side) {
    if (!varGlyphController || !glyphController) {
      return null;
    }
    const layerName = this.sceneController.sceneSettings.editLayerName;
    const layerGlyph = varGlyphController.glyph.layers[layerName]?.glyph;
    const effective = getEffectiveMetricsKey(
      varGlyphController.glyph,
      layerGlyph,
      side
    );
    if (!effective) {
      return null;
    }

    const metricProperty = SIDE_METRIC_PROPERTY[side];
    const { mainLayerName, locations } = this._getEditingLocations(varGlyphController);
    const result = await resolveMetricsExpression(
      this.fontController,
      effective.expression,
      metricProperty,
      locations,
      mainLayerName
    );

    if (result?.error) {
      return { ...effective, resolvedValue: undefined, error: result.error };
    }
    const resolvedValue = typeof result === "number" ? result : result?.value;
    return {
      ...effective,
      resolvedValue,
      stale: isMetricsValueStale(glyphController[metricProperty], resolvedValue),
    };
  }
```

- [ ] **Step 3: Import the new symbols**

Extend the `metrics-keys.js` import added in Task 4:

```js
import {
  deleteSidebearingKey,
  formatMetricsKeyDisplay,
  getEffectiveMetricsKey,
  getSidebearingKey,
  isMetricsValueStale,
  parseMetricsKey,
  setSidebearingKey,
  SIDE_METRIC_PROPERTY,
} from "@fontra/core/metrics-keys.js";
```

- [ ] **Step 4: Resolve both sides before building the form**

In `update()`, after `const glyphLocked = ...` (`:169`), add:

```js
const metricsKeyDisplay = {
  left: await this._getMetricsKeyDisplay(varGlyphController, glyphController, "left"),
  right: await this._getMetricsKeyDisplay(varGlyphController, glyphController, "right"),
};
```

- [ ] **Step 5: Feed the fields**

In the sidebearings form item, replace `fieldX`'s `value`, and add the two new properties. `fieldX` becomes:

```js
          fieldX: {
            key: '["leftMargin"]',
            value: metricsKeyDisplay.left
              ? formatMetricsKeyDisplay(metricsKeyDisplay.left.expression)
              : glyphController.leftMargin,
            displayValue: metricsKeyDisplay.left
              ? formatResolvedMetricsValue(metricsKeyDisplay.left)
              : undefined,
            stale: !!metricsKeyDisplay.left?.stale,
            "data-tooltip": metricsKeyDisplay.left?.stale
              ? translate("sidebar.selection-info.metrics-key.stale.tooltip")
              : undefined,
            numDigits: 1,
            disabled: glyphController.leftMargin == undefined,
            evaluateExpression: async (input) =>
              await this._evaluateSidebearingInput(input, varGlyphController, "left"),
            recordExtraChanges: (glyph, layerInfo) =>
              this._recordPendingMetricsKey(glyph, layerInfo, "left"),
            getValue: (layerGlyph, layerGlyphController, fieldItem) => {
              return layerGlyphController.leftMargin;
            },
            setValue: (layerGlyph, layerGlyphController, fieldItem, value) => {
              setLeftMarginOnLayer(layerGlyph, layerGlyphController, value);
            },
          },
```

and `fieldY` becomes:

```js
          fieldY: {
            key: '["rightMargin"]',
            value: metricsKeyDisplay.right
              ? formatMetricsKeyDisplay(metricsKeyDisplay.right.expression)
              : glyphController.rightMargin,
            displayValue: metricsKeyDisplay.right
              ? formatResolvedMetricsValue(metricsKeyDisplay.right)
              : undefined,
            stale: !!metricsKeyDisplay.right?.stale,
            "data-tooltip": metricsKeyDisplay.right?.stale
              ? translate("sidebar.selection-info.metrics-key.stale.tooltip")
              : undefined,
            numDigits: 1,
            disabled: glyphController.rightMargin == undefined,
            evaluateExpression: async (input) =>
              await this._evaluateSidebearingInput(input, varGlyphController, "right"),
            recordExtraChanges: (glyph, layerInfo) =>
              this._recordPendingMetricsKey(glyph, layerInfo, "right"),
            getValue: (layerGlyph, layerGlyphController, fieldItem) => {
              return layerGlyphController.rightMargin;
            },
            setValue: (layerGlyph, layerGlyphController, fieldItem, value) => {
              setRightMarginOnLayer(layerGlyph, layerGlyphController, value);
            },
          },
```

- [ ] **Step 6: Add the adornment formatter**

At module scope in the same file, next to the margin setters:

```js
// The adornment beside a keyed field: the resolved number, or a marker when the
// reference could not be resolved (spec §7 cases 1 and 2).
function formatResolvedMetricsValue(keyDisplay) {
  if (keyDisplay.error || keyDisplay.resolvedValue == undefined) {
    return "?";
  }
  return String(round(keyDisplay.resolvedValue, 1));
}
```

`round` is already imported from `@fontra/core/utils.ts` (`:17`).

- [ ] **Step 7: Syntax check**

Run: `node --check src-js/views-editor/src/panel-selection-info.js`
Expected: no output (exit 0).

- [ ] **Step 8: Manual test matrix**

| #   | Action                                        | Expected                                                                                            |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Key `o`'s left to `=n`                        | Field reads `=n`; adornment beside it shows `n`'s margin                                            |
| 2   | Click into the field                          | The editable text is `=n` only — no number to delete                                                |
| 3   | Change `n`'s left margin by 10, return to `o` | `o`'s field is outlined (stale); adornment shows the **new** value, the margin is still the old one |
| 4   | Hover the stale field                         | Tooltip: "Referenced glyph changed — press Update"                                                  |
| 5   | Type `85` over the stale field                | Field reverts to a plain number, outline gone                                                       |
| 6   | Key a side to `=zzz` after deleting `zzz`     | Adornment reads `?`, no crash                                                                       |
| 7   | Key `o`'s left to `=o!` (self, opposite side) | Resolves normally                                                                                   |
| 8   | Switch sources with a keyed glyph             | Field re-resolves at the new source's location                                                      |
| 9   | Glyph with no keys                            | Both fields numeric, no adornment, no outline — unchanged from before                               |

- [ ] **Step 9: Commit**

```bash
node --check src-js/views-editor/src/panel-selection-info.js
git add . && git commit -m "feat(metrics-keys): show the expression with the resolved value as an adornment

The editable value is the expression; the number sits beside it as read-only
text, so nothing has to be stripped on read. The live resolve done for display
is also the staleness test."
```

---

### Task 6: The per-glyph Update button

**Files:**

- Modify: `src-js/views-editor/src/panel-selection-info.js` — sidebearings row (`:250-306`), plus two new methods
- Modify: `src-js/fontra-core/assets/lang/en.js`
- Modify: `docs/superpowers/FEATURE-ARCHITECTURE-MAP.md` §7

**Interfaces:**

- Consumes: `getEffectiveMetricsKey`, `hasAnySidebearingKey`, `isSelfReferenceSameSide`, `SIDE_METRIC_PROPERTY` from Task 1; `resolveMetricsExpression`, `MARGIN_SETTERS` from Task 3.
- Produces:
  - `SelectionInfoPanel._glyphHasMetricsKeys(varGlyphController) → boolean`
  - `SelectionInfoPanel._resolveMetricsKeysForGlyph(glyphName, varGlyphController) → Promise<Array<{ layerName, side, value }>>`
  - `SelectionInfoPanel._updateMetricsForGlyph(glyphName, varGlyphController) → Promise<void>`

- [ ] **Step 1: Add the lang strings**

```js
  "sidebar.selection-info.metrics-key.update.tooltip":
    "Re-resolve metrics keys for every source",
```

- [ ] **Step 2: Add the key-presence test**

```js
  // True when the glyph has any key at all — shared or on any source.
  _glyphHasMetricsKeys(varGlyphController) {
    const glyph = varGlyphController?.glyph;
    if (!glyph) {
      return false;
    }
    if (hasAnySidebearingKey(glyph)) {
      return true;
    }
    return Object.values(glyph.layers).some((layer) =>
      hasAnySidebearingKey(layer.glyph)
    );
  }
```

Add `hasAnySidebearingKey` to the `metrics-keys.js` import list.

- [ ] **Step 3: Add the resolve pass**

Resolution is async and `editNamedGlyphAndRecordChanges` records synchronously, so everything is resolved up front:

```js
  // Resolves every source's effective key. Returns a flat, ordered list of
  // margins to apply: left entries first, so the path translation happens
  // before any right-margin write (spec §5).
  async _resolveMetricsKeysForGlyph(glyphName, varGlyphController) {
    const glyph = varGlyphController.glyph;
    const pending = { left: [], right: [] };

    for (const source of varGlyphController.sources) {
      if (source.inactive) {
        continue;
      }
      const layerName = source.layerName;
      const layerGlyph = glyph.layers[layerName]?.glyph;
      if (!layerGlyph) {
        continue;
      }
      const location = varGlyphController.getSourceLocation(source);

      for (const side of ["left", "right"]) {
        const effective = getEffectiveMetricsKey(glyph, layerGlyph, side);
        if (!effective) {
          continue;
        }
        if (isSelfReferenceSameSide(effective.expression, glyphName)) {
          // Identity: it would write back the value it just read (spec §7 case 3).
          continue;
        }
        const result = await resolveMetricsExpression(
          this.fontController,
          effective.expression,
          SIDE_METRIC_PROPERTY[side],
          { [layerName]: location },
          layerName
        );
        if (result?.error) {
          // Missing or unresolvable reference: skip this side, leave the real
          // margin untouched (spec §7 cases 1 and 2).
          console.warn(
            `metrics key for ${glyphName}/${layerName}/${side}: ${result.error}`
          );
          continue;
        }
        const value = typeof result === "number" ? result : result?.value;
        if (!Number.isFinite(value)) {
          continue;
        }
        pending[side].push({ layerName, side, value });
      }
    }

    return [...pending.left, ...pending.right];
  }
```

- [ ] **Step 4: Add the apply pass**

```js
  async _updateMetricsForGlyph(glyphName, varGlyphController) {
    if (this.fontController.readOnly) {
      return;
    }
    const pending = await this._resolveMetricsKeysForGlyph(
      glyphName,
      varGlyphController
    );
    if (!pending.length) {
      return;
    }

    const layerControllers = {};
    for (const { layerName } of pending) {
      if (layerControllers[layerName]) {
        continue;
      }
      layerControllers[layerName] = await this.fontController.getLayerGlyphController(
        glyphName,
        layerName,
        varGlyphController.getSourceIndexForLayerName(layerName)
      );
    }

    await this.sceneController.editNamedGlyphAndRecordChanges(glyphName, (glyph) => {
      for (const { layerName, side, value } of pending) {
        const layerGlyph = glyph.layers[layerName]?.glyph;
        if (!layerGlyph) {
          continue;
        }
        MARGIN_SETTERS[side](layerGlyph, layerControllers[layerName], value);
      }
      return "update sidebearings";
    });
  }
```

- [ ] **Step 5: Add the button to the sidebearings row**

Immediately after the sidebearings `formContents.push({ type: "edit-number-x-y", ... })` block (which ends at `:306`), add:

```js
if (this._glyphHasMetricsKeys(varGlyphController)) {
  formContents.push({
    type: "single-icon",
    element: html.createDomElement("icon-button", {
      "src": "/tabler-icons/refresh.svg",
      "style": "width: 1.3em; height: 1.3em;",
      "disabled": glyphLocked || this.fontController.readOnly,
      "data-tooltip": translate("sidebar.selection-info.metrics-key.update.tooltip"),
      "data-tooltipposition": "left",
      "onclick": async () => {
        await this._updateMetricsForGlyph(glyphName, varGlyphController);
        await this.update();
      },
    }),
  });
}
```

- [ ] **Step 6: Confirm the icon exists**

Run: `ls src-js/fontra-core/assets/tabler-icons/refresh.svg`
Expected: the file exists. If it does not, run `ls src-js/fontra-core/assets/tabler-icons/ | grep -i "refresh\|reload\|rotate"` and use whichever of those is present, keeping the same 1.3em sizing.

- [ ] **Step 7: File the skeleton limitation**

In `docs/superpowers/FEATURE-ARCHITECTURE-MAP.md` §7, replace residue item 2 with:

```markdown
2. **Letterspacer ↔ skeleton coupling** — letterspacer's Apply _does_ move skeleton
   data with the sidebearing (`panel-letterspacer.js:575-581`). The selection-info
   margin path does **not**, and the metrics-keys Update / Update-all passes inherit
   that gap: keying a left margin on a skeleton glyph and pressing Update shifts the
   outline without shifting the skeleton. Deliberately out of scope of the metrics-keys
   spec (§9); needs its own fix in the shared margin setters
   (`panel-selection-info.js`, `setLeftMarginOnLayer`).
```

- [ ] **Step 8: Syntax check**

Run: `node --check src-js/views-editor/src/panel-selection-info.js`
Expected: no output (exit 0).

- [ ] **Step 9: Manual test matrix**

| #   | Action                                                                          | Expected                                                       |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Glyph with no keys                                                              | No Update button in the sidebearings row                       |
| 2   | Key `o`'s left to `=n`                                                          | Update button appears                                          |
| 3   | Change `n`'s left by 10, return to `o`, press Update                            | `o`'s margin follows; stale outline clears                     |
| 4   | Press Update again                                                              | Nothing changes; no new undo step of consequence               |
| 5   | Multi-source font: key `o`'s left, change `n` in **both** masters, press Update | Every source of `o` updates, each resolved at its own location |
| 6   | Undo after #3                                                                   | One press reverts the whole update                             |
| 7   | Both sides keyed, press Update                                                  | Both apply; the right margin ends up correct (left ran first)  |
| 8   | Lock the glyph                                                                  | Button disabled                                                |
| 9   | Key to a glyph, delete that glyph, press Update                                 | No crash; margin untouched; warning in the console             |
| 10  | Font with an inactive source                                                    | Inactive source skipped                                        |

- [ ] **Step 10: Commit**

```bash
node --check src-js/views-editor/src/panel-selection-info.js
git add . && git commit -m "feat(metrics-keys): add the per-glyph Update button

Resolves every source's effective key at that source's location and re-applies
the margins in one undo step, left side before right. Appears only when the
glyph has a key. Also files the skeleton-move gap the update path inherits."
```

---

### Task 7: The Unlink button (two-press)

Removes the key at its level and leaves the number (spec §4.4). Uses the established armed-state pattern from `panel-skeleton-defaults.js:194-217`.

**Files:**

- Modify: `src-js/views-editor/src/panel-selection-info.js`
- Modify: `src-js/fontra-core/assets/lang/en.js`

**Interfaces:**

- Consumes: `deleteSidebearingKey`, `getEffectiveMetricsKey` from Task 1.
- Produces: `SelectionInfoPanel._unlinkMetricsKey(glyphName, varGlyphController, side) → Promise<void>`; `this._metricsUnlinkConfirm` — `string | null`, holding the armed side.

- [ ] **Step 1: Add the lang strings**

```js
  "sidebar.selection-info.metrics-key.unlink.tooltip":
    "Remove the metrics key, keep the number",
  "sidebar.selection-info.metrics-key.unlink.confirm":
    "Click again to remove the metrics key",
```

- [ ] **Step 2: Initialize the armed slot**

In the constructor, beside `this._pendingMetricsKeyEdit = null;`:

```js
this._metricsUnlinkConfirm = null;
```

- [ ] **Step 3: Add the unlink method**

```js
  // Drops the key at the level that governs this source, leaving the applied
  // margin in place. A source override is removed in preference to the shared
  // key, matching "reset to shared" (spec §4.4, §4.9).
  async _unlinkMetricsKey(glyphName, varGlyphController, side) {
    if (this.fontController.readOnly) {
      return;
    }
    const layerName = this.sceneController.sceneSettings.editLayerName;
    const effective = getEffectiveMetricsKey(
      varGlyphController.glyph,
      varGlyphController.glyph.layers[layerName]?.glyph,
      side
    );
    if (!effective) {
      return;
    }

    await this.sceneController.editNamedGlyphAndRecordChanges(glyphName, (glyph) => {
      if (effective.level === "source") {
        deleteSidebearingKey(glyph.layers[layerName]?.glyph, side);
      } else {
        deleteSidebearingKey(glyph, side);
      }
      return "unlink metrics key";
    });
  }
```

- [ ] **Step 4: Add the button per keyed side**

Immediately after the Update button block from Task 6, add:

```js
for (const side of ["left", "right"]) {
  if (!metricsKeyDisplay[side]) {
    continue;
  }
  const isConfirming = this._metricsUnlinkConfirm === side;
  formContents.push({
    type: "single-icon",
    element: html.createDomElement("icon-button", {
      "src": isConfirming ? "/tabler-icons/x.svg" : "/tabler-icons/unlink.svg",
      "style": "width: 1.1em; height: 1.1em;",
      "disabled": glyphLocked || this.fontController.readOnly,
      "data-tooltip": translate(
        isConfirming
          ? "sidebar.selection-info.metrics-key.unlink.confirm"
          : "sidebar.selection-info.metrics-key.unlink.tooltip"
      ),
      "data-tooltipposition": "left",
      "onclick": async () => {
        if (this._metricsUnlinkConfirm !== side) {
          this._metricsUnlinkConfirm = side;
          await this.update();
          return;
        }
        this._metricsUnlinkConfirm = null;
        await this._unlinkMetricsKey(glyphName, varGlyphController, side);
        await this.update();
      },
    }),
  });
}
```

- [ ] **Step 5: Disarm on rebuild for a different glyph**

In `update()`, right after `const glyphName = this.sceneController.sceneSettings.selectedGlyphName;` (`:155`):

```js
if (this._metricsUnlinkConfirmGlyph !== glyphName) {
  // Never leave a button armed across a glyph switch.
  this._metricsUnlinkConfirm = null;
  this._metricsUnlinkConfirmGlyph = glyphName;
}
```

- [ ] **Step 6: Confirm the icon exists**

Run: `ls src-js/fontra-core/assets/tabler-icons/unlink.svg src-js/fontra-core/assets/tabler-icons/x.svg`
Expected: both exist. If `unlink.svg` is absent, run `ls src-js/fontra-core/assets/tabler-icons/ | grep -i "link"` and use what is there.

- [ ] **Step 7: Syntax check**

Run: `node --check src-js/views-editor/src/panel-selection-info.js`
Expected: no output (exit 0).

- [ ] **Step 8: Manual test matrix**

| #   | Action                                           | Expected                                         |
| --- | ------------------------------------------------ | ------------------------------------------------ |
| 1   | Key `o`'s left; one unlink button appears        | Only for the keyed side                          |
| 2   | Key both sides                                   | Two unlink buttons                               |
| 3   | Click unlink once                                | Icon swaps to `x`, nothing removed yet           |
| 4   | Click it again                                   | Key gone, field shows the plain number unchanged |
| 5   | Click once, then switch glyph and come back      | Button no longer armed                           |
| 6   | Click once, then click the _other_ side's unlink | The first disarms, the second arms               |
| 7   | Unlink a stale field                             | The stale number stays; outline gone             |
| 8   | Undo after #4                                    | Key returns                                      |
| 9   | Glyph locked                                     | Button disabled                                  |

- [ ] **Step 9: Commit**

```bash
node --check src-js/views-editor/src/panel-selection-info.js
git add . && git commit -m "feat(metrics-keys): add the two-press unlink button

Removes the key at the level governing the current source and keeps the applied
number. Uses the armed-icon pattern already used by the skeleton defaults panel."
```

---

### Task 8: The source override control

**Files:**

- Modify: `src-js/views-editor/src/panel-selection-info.js`
- Modify: `src-js/fontra-core/assets/lang/en.js`

**Interfaces:**

- Consumes: `getEffectiveMetricsKey`, `getSidebearingKey`, `setSidebearingKey`, `deleteSidebearingKey` from Task 1.
- Produces: `SelectionInfoPanel._toggleMetricsSourceOverride(glyphName, varGlyphController, side) → Promise<void>`

- [ ] **Step 1: Add the lang strings**

```js
  "sidebar.selection-info.metrics-key.override.tooltip": "Override for this source",
  "sidebar.selection-info.metrics-key.reset-to-shared.tooltip": "Reset to shared",
```

- [ ] **Step 2: Add the toggle**

```js
  // Detaches this source's side from the shared key, or reattaches it. The new
  // override is seeded from the shared expression so the value does not jump.
  async _toggleMetricsSourceOverride(glyphName, varGlyphController, side) {
    if (this.fontController.readOnly) {
      return;
    }
    const layerName = this.sceneController.sceneSettings.editLayerName;
    const layerGlyph = varGlyphController.glyph.layers[layerName]?.glyph;
    if (!layerGlyph) {
      return;
    }
    const isOverridden = getSidebearingKey(layerGlyph, side) !== undefined;
    const sharedExpression = getSidebearingKey(varGlyphController.glyph, side);

    if (!isOverridden && sharedExpression === undefined) {
      // Nothing to detach from.
      return;
    }

    await this.sceneController.editNamedGlyphAndRecordChanges(glyphName, (glyph) => {
      const targetLayerGlyph = glyph.layers[layerName]?.glyph;
      if (!targetLayerGlyph) {
        return "metrics key source override";
      }
      if (isOverridden) {
        deleteSidebearingKey(targetLayerGlyph, side);
        return "reset metrics key to shared";
      }
      setSidebearingKey(targetLayerGlyph, side, sharedExpression);
      return "override metrics key for source";
    });
  }
```

- [ ] **Step 3: Add the button per keyed side**

Inside the `for (const side of ["left", "right"])` loop from Task 7, after the unlink button push:

```js
const isOverridden = metricsKeyDisplay[side].level === "source";
formContents.push({
  type: "single-icon",
  element: html.createDomElement("icon-button", {
    "src": isOverridden ? "/tabler-icons/link.svg" : "/tabler-icons/link-plus.svg",
    "style": `width: 1.1em; height: 1.1em; opacity: ${isOverridden ? "1" : "0.6"};`,
    "disabled": glyphLocked || this.fontController.readOnly,
    "data-tooltip": translate(
      isOverridden
        ? "sidebar.selection-info.metrics-key.reset-to-shared.tooltip"
        : "sidebar.selection-info.metrics-key.override.tooltip"
    ),
    "data-tooltipposition": "left",
    "onclick": async () => {
      await this._toggleMetricsSourceOverride(glyphName, varGlyphController, side);
      await this.update();
    },
  }),
});
```

The filled/outline icon pair is the override marker required by spec §4.9.

- [ ] **Step 4: Confirm the icons exist**

Run: `ls src-js/fontra-core/assets/tabler-icons/ | grep -i "^link"`
Expected: `link.svg` and `link-plus.svg`. If either is missing, substitute an available pair that reads as filled-vs-outline and note the substitution in the commit message.

- [ ] **Step 5: Syntax check**

Run: `node --check src-js/views-editor/src/panel-selection-info.js`
Expected: no output (exit 0).

- [ ] **Step 6: Manual test matrix**

Needs a multi-source font.

| #   | Action                                              | Expected                                                                 |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Key `o`'s left to `=n` in Regular; switch to Bold   | Bold shows the same `=n`, resolved at Bold's location                    |
| 2   | In Bold press "Override for this source"            | Icon changes to the overridden marker; tooltip becomes "Reset to shared" |
| 3   | In Bold type `=m`                                   | Bold follows `m`; Regular still follows `n`                              |
| 4   | Press Update                                        | Both sources apply their own effective key                               |
| 5   | In Bold press "Reset to shared"                     | Bold reverts to `=n`; margin re-resolves on the next Update              |
| 6   | Unlink the **shared** key while Bold is overridden  | Regular loses the link; Bold keeps `=m`                                  |
| 7   | Unlink a **source override** field                  | That source reverts to the shared key, or to a plain number if none      |
| 8   | Override with the same expression as the shared key | Allowed; "Reset to shared" removes it cleanly                            |
| 9   | Undo each of the above                              | Single-press revert                                                      |

- [ ] **Step 7: Commit**

```bash
node --check src-js/views-editor/src/panel-selection-info.js
git add . && git commit -m "feat(metrics-keys): add the source override control

A keyed side can be detached from the shared key for one source, seeded from the
shared expression, and reattached. A filled-vs-outline icon marks which state
the field is in."
```

---

### Task 9: The letterspacer flag and guard

**Files:**

- Modify: `src-js/views-editor/src/panel-letterspacer.js:34-36` (field constants), `:219-220` (defaults), `:342-360` (form), `:493-601` (`applySpacing`), plus load/persist
- Modify: `src-js/fontra-core/assets/lang/en.js`

**Interfaces:**

- Consumes: `getEffectiveMetricsKey`, `deleteSidebearingKey` from Task 1.
- Produces: `LETTERSPACER_FONT_FIELDS.mayReplaceMetricsKeys`; `LetterspacerPanel.mayReplaceMetricsKeys` (boolean, default `false`).

- [ ] **Step 1: Add the lang string**

```js
  "sidebar.letterspacer.may-replace-metrics-keys": "Replace metrics keys",
```

The label states the effect, not a vague "override" — allowing it deletes keys.

- [ ] **Step 2: Add the field constant**

```js
const LETTERSPACER_FONT_FIELDS = Object.freeze({
  enabled: "enabled",
  mayReplaceMetricsKeys: "mayReplaceMetricsKeys",
});
```

- [ ] **Step 3: Add the imports**

```js
import {
  deleteSidebearingKey,
  getEffectiveMetricsKey,
} from "@fontra/core/metrics-keys.js";
```

- [ ] **Step 4: Add load and persist**

Beside `loadAlgorithmEnabled` / `persistAlgorithmEnabled` (`:675-702`):

```js
  async loadMayReplaceMetricsKeys() {
    const value = getLetterspacerSection(this.fontController)?.[
      LETTERSPACER_FONT_FIELDS.mayReplaceMetricsKeys
    ];
    this.mayReplaceMetricsKeys = !!value;
  }

  async persistMayReplaceMetricsKeys(value) {
    if (this.fontController.readOnly) {
      return;
    }
    const nextValue = !!value;
    const root = { customData: this.fontController.customData || {} };
    const changes = recordChanges(root, (root) => {
      const section = {
        ...(getLetterspacerSection(root) || {}),
        [LETTERSPACER_FONT_FIELDS.mayReplaceMetricsKeys]: nextValue,
      };
      setFontraInternalSection(root, FONTRA_INTERNAL_SECTIONS.LETTERSPACER, section);
    });
    if (changes.hasChange) {
      await this.fontController.postChange(
        changes.change,
        changes.rollbackChange,
        "edit letterspacer metrics-key policy",
        this
      );
    }
  }
```

Call `await this.loadMayReplaceMetricsKeys();` wherever `loadAlgorithmEnabled()` is called. Find the call sites with:
`grep -n "loadAlgorithmEnabled()" src-js/views-editor/src/panel-letterspacer.js`

- [ ] **Step 5: Add the toggle to the form**

After the `applyRSB` field (`:352-360`):

```js
          {
            type: "edit-number",
            key: "mayReplaceMetricsKeys",
            label: translate("sidebar.letterspacer.may-replace-metrics-keys"),
            value: this.mayReplaceMetricsKeys ? 1 : 0,
            minValue: 0,
            maxValue: 1,
            integer: true,
          },
```

In the form's `onFieldChange` handler (the block containing `await this.persistParam(fieldItem.key, value)` at `:400`), add before that call:

```js
if (fieldItem.key === "mayReplaceMetricsKeys") {
  this.mayReplaceMetricsKeys = !!value;
  await this.persistMayReplaceMetricsKeys(value);
  return;
}
```

- [ ] **Step 6: Guard `applySpacing`**

Inside `applySpacing`, the per-layer loop begins at `:524`. After `const path = layerGlyph.path;` and the bounds guard, add the key lookup:

```js
const keyedSides = {
  left: !!getEffectiveMetricsKey(glyph, layerGlyph, "left"),
  right: !!getEffectiveMetricsKey(glyph, layerGlyph, "right"),
};
const skipLeft = keyedSides.left && !this.mayReplaceMetricsKeys;
const skipRight = keyedSides.right && !this.mayReplaceMetricsKeys;
```

Then replace the two apply guards. `:566` becomes:

```js
          if (this.params.applyLSB && !skipLeft) {
```

and the right-side block at `:584-594` becomes:

```js
if ((this.params.applyRSB && !skipRight) || (this.params.applyLSB && !skipLeft)) {
  const newBounds =
    layerGlyph.path.getBounds?.() || layerGlyph.path.getControlBounds?.();
  if (this.params.applyRSB && !skipRight) {
    layerGlyph.xAdvance = Math.round(newBounds.xMax + roundedRSB);
  } else {
    // Preserve the right margin the glyph had before the path moved.
    layerGlyph.xAdvance = Math.round(
      newBounds.xMax + (layerGlyph.xAdvance - bounds.xMax)
    );
  }
}
```

Then, when replacement **is** allowed, delete the keys that were just overwritten. Add after the right-side block, still inside the per-layer loop:

```js
if (this.mayReplaceMetricsKeys) {
  // Allowed override replaces the variable with a number: the key
  // goes, so the field reads as plain rather than stale (spec §4.10).
  if (this.params.applyLSB && keyedSides.left) {
    replacedSides.left = true;
    deleteSidebearingKey(layerGlyph, "left");
  }
  if (this.params.applyRSB && keyedSides.right) {
    replacedSides.right = true;
    deleteSidebearingKey(layerGlyph, "right");
  }
}
```

Declare the accumulator just before the per-layer loop (`:524`):

```js
const replacedSides = { left: false, right: false };
```

and after the loop closes, before `return "letterspacer";` (`:597`), drop the shared keys once per glyph:

```js
// Shared keys are glyph-level: remove them once, not per layer.
if (replacedSides.left) {
  deleteSidebearingKey(glyph, "left");
}
if (replacedSides.right) {
  deleteSidebearingKey(glyph, "right");
}
```

Note that `glyph` here is the `VariableGlyph` passed to `editGlyphAndRecordChanges`, so the shared-key delete lands in the same undo step as the margins.

- [ ] **Step 7: Syntax check**

Run: `node --check src-js/views-editor/src/panel-letterspacer.js`
Expected: no output (exit 0).

- [ ] **Step 8: Manual test matrix**

| #   | Setup                                                  | Action                      | Expected                                                                                            |
| --- | ------------------------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Fresh font                                             | Open the letterspacer panel | "Replace metrics keys" present, value `0`                                                           |
| 2   | Flag `0`, `o`'s left keyed `=n`, both apply toggles on | Press Apply                 | Left margin **unchanged**, key intact; right margin applies                                         |
| 3   | Flag `0`, `o`'s right keyed                            | Press Apply                 | Right unchanged, key intact; left applies                                                           |
| 4   | Flag `0`, both sides keyed                             | Press Apply                 | Neither margin changes; both keys intact                                                            |
| 5   | Flag `1`, `o`'s left keyed                             | Press Apply                 | Left margin takes letterspacer's value; key **gone**; field is a plain number with no stale outline |
| 6   | Flag `1`, key was a **source override**                | Press Apply                 | That source's override removed; other sources' keys untouched                                       |
| 7   | Flag `1`, key was **shared**                           | Press Apply                 | Shared key removed once; the Update button disappears if no keys remain                             |
| 8   | Any of the above                                       | Undo                        | One press restores both margins and keys                                                            |
| 9   | Flag `1`, then set it back to `0`, reload              | —                           | Flag persists as `0`                                                                                |
| 10  | Glyph with no keys                                     | Press Apply                 | Behaves exactly as before this task                                                                 |
| 11  | Skeleton glyph, flag `0`, left keyed                   | Press Apply                 | Left skipped; skeleton not shifted; right applies                                                   |

Case 11 matters: letterspacer's skeleton translation is inside the `applyLSB` branch, so skipping the left side must skip the skeleton move with it. Confirm the skeleton and outline stay aligned.

- [ ] **Step 9: Commit**

```bash
node --check src-js/views-editor/src/panel-letterspacer.js
git add . && git commit -m "feat(letterspacer): guard metrics-keyed sidebearings behind a font-level flag

Apply writes margins by its own route, so a keyed side was silently overwritten.
It now skips keyed sides by default; when the flag allows replacement it writes
the number and deletes the key, so the side reads as plain rather than stale."
```

---

### Task 10: The Update all metrics action

Font-wide, two-press via a confirm dialog, atomic in one undo step.

**Files:**

- Modify: `src-js/views-editor/src/editor.js:584-608` (glyph menu topic block), plus a new method
- Modify: `src-js/fontra-core/assets/lang/en.js`

**Interfaces:**

- Consumes: `getEffectiveMetricsKey`, `hasAnySidebearingKey`, `SIDE_METRIC_PROPERTY` from Task 1.
- Produces: `EditorController.doUpdateAllMetrics() → Promise<void>`; action id `action.glyph.update-all-metrics`.

**Risk note:** this is the only task that composes a change across several glyphs. `consolidateChanges` and `["glyphs", glyphName]` as a base path are the same primitives `scene-controller.js:1547` uses per glyph — verify the combined change round-trips (undo, then redo, then reload) before considering the task done.

- [ ] **Step 1: Add the lang strings**

```js
  "action.glyph.update-all-metrics": "Update All Metrics",
  "dialog.update-all-metrics.title": "Update all metrics keys?",
  "dialog.update-all-metrics.content":
    "This rewrites sidebearings in every glyph that has a metrics key.",
```

- [ ] **Step 2: Export the shared resolve pass and margin setters**

`doUpdateAllMetrics` needs the same per-source resolve and the same margin setters as Task 6, and rail R-B forbids a second copy. Do this refactor **before** writing the method so its body can reference the final names.

In `src-js/views-editor/src/panel-selection-info.js`, change the declarations added in Task 3 to named exports:

```js
export function setLeftMarginOnLayer(layerGlyph, layerGlyphController, value) {
export function setRightMarginOnLayer(layerGlyph, layerGlyphController, value) {
export const MARGIN_SETTERS = Object.freeze({
export async function resolveMetricsExpression(
```

Move `_resolveMetricsKeysForGlyph` (Task 6, step 3) out of the class to module scope in the same file, export it, and make `fontController` its first parameter — the body is otherwise unchanged, with `this.fontController` replaced by `fontController`:

```js
export async function resolveMetricsKeysForGlyph(
  fontController,
  glyphName,
  varGlyphController
) {
  // body unchanged from Task 6 step 3, except `this.fontController` -> `fontController`
}
```

Leave a thin method behind so Task 6's button keeps working:

```js
  async _resolveMetricsKeysForGlyph(glyphName, varGlyphController) {
    return await resolveMetricsKeysForGlyph(
      this.fontController,
      glyphName,
      varGlyphController
    );
  }
```

- [ ] **Step 3: Add the imports to `editor.js`**

```js
import { recordChanges } from "@fontra/core/change-recorder.js";
import { consolidateChanges } from "@fontra/core/changes.js";
import { hasAnySidebearingKey } from "@fontra/core/metrics-keys.js";
import { MARGIN_SETTERS, resolveMetricsKeysForGlyph } from "./panel-selection-info.js";
```

Check first whether `recordChanges` and `consolidateChanges` are already imported:
`grep -n "consolidateChanges\|recordChanges" src-js/views-editor/src/editor.js`
Add only what is missing. Confirm the module path for `consolidateChanges`:
`grep -rn "export function consolidateChanges" src-js/fontra-core/src/`

`editor.js` already imports `panel-selection-info.js` at `:124` (default export) and `dialog` at `:77`, so neither the named imports nor the dialog introduce a new cycle or a new dependency.

- [ ] **Step 4: Register the action**

Inside the `0035-action-topics.menu.glyph` block (`:584`), after the existing registrations:

```js
registerAction(
  "action.glyph.update-all-metrics",
  { topic },
  () => this.doUpdateAllMetrics(),
  () => !this.fontController.readOnly
);
```

- [ ] **Step 5: Add the method**

Add to `EditorController`:

```js
  // Font-wide, explicit, and confirmed: rewrites every keyed sidebearing in the
  // font. Chains (a<-b, b<-c) settle one link per pass, so the sweep runs to a
  // fixpoint bounded by the glyph count (spec §4.3).
  async doUpdateAllMetrics() {
    if (this.fontController.readOnly) {
      return;
    }

    const result = await dialog(
      translate("dialog.update-all-metrics.title"),
      translate("dialog.update-all-metrics.content"),
      [
        { title: translate("dialog.cancel"), isCancelButton: true },
        { title: translate("dialog.okay"), isDefaultButton: true, resultValue: "ok" },
      ]
    );
    if (!result) {
      return;
    }

    const glyphNames = Object.keys(this.fontController.glyphMap || {});
    const maxPasses = Math.max(1, glyphNames.length);
    const changes = [];
    const rollbacks = [];
    const touchedGlyphNames = new Set();

    for (let pass = 0; pass < maxPasses; pass++) {
      let passChangedSomething = false;

      for (const glyphName of glyphNames) {
        const varGlyph = await this.fontController.getGlyph(glyphName);
        if (!varGlyph) {
          continue;
        }
        const glyph = varGlyph.glyph;
        if (glyph.customData["fontra.glyph.locked"]) {
          continue;
        }
        if (!this._glyphHasAnyMetricsKey(glyph)) {
          continue;
        }

        const pending = await resolveMetricsKeysForGlyph(
          this.fontController,
          glyphName,
          varGlyph
        );
        if (!pending.length) {
          continue;
        }

        const layerControllers = {};
        for (const { layerName } of pending) {
          if (layerControllers[layerName]) {
            continue;
          }
          layerControllers[layerName] =
            await this.fontController.getLayerGlyphController(
              glyphName,
              layerName,
              varGlyph.getSourceIndexForLayerName(layerName)
            );
        }

        const glyphChanges = recordChanges(glyph, (glyph) => {
          for (const { layerName, side, value } of pending) {
            const layerGlyph = glyph.layers[layerName]?.glyph;
            if (!layerGlyph) {
              continue;
            }
            MARGIN_SETTERS[side](layerGlyph, layerControllers[layerName], value);
          }
        });

        if (!glyphChanges.hasChange) {
          continue;
        }
        passChangedSomething = true;
        touchedGlyphNames.add(glyphName);
        changes.push(consolidateChanges(glyphChanges.change, ["glyphs", glyphName]));
        rollbacks.unshift(
          consolidateChanges(glyphChanges.rollbackChange, ["glyphs", glyphName])
        );
      }

      // Fixpoint: a pass that changes nothing means every chain has settled.
      // Cycles stop here too, since the second pass reproduces the first.
      if (!passChangedSomething) {
        break;
      }
    }

    if (!changes.length) {
      return;
    }

    const change = consolidateChanges(changes);
    const rollbackChange = consolidateChanges(rollbacks);
    const undoInfo = {
      label: translate("action.glyph.update-all-metrics"),
      undoSelection: undefined,
      redoSelection: undefined,
      location: this.sceneController.getGlyphEditLocation?.(),
    };

    await this.fontController.editFinal(
      change,
      rollbackChange,
      undoInfo.label,
      true
    );
    this.fontController.pushUndoRecord(change, rollbackChange, undoInfo);

    for (const glyphName of touchedGlyphNames) {
      await this.fontController.glyphChanged(glyphName, { senderID: this });
    }
    this.sceneController.canvasController?.requestUpdate();
  }

  _glyphHasAnyMetricsKey(glyph) {
    if (hasAnySidebearingKey(glyph)) {
      return true;
    }
    return Object.values(glyph.layers).some((layer) =>
      hasAnySidebearingKey(layer.glyph)
    );
  }
```

- [ ] **Step 6: Confirm the dialog helper and translate are available in `editor.js`**

Run: `grep -n "import { dialog }\|from \"@fontra/web-components/modal-dialog.js\"\|dialog.okay" src-js/views-editor/src/editor.js src-js/fontra-core/assets/lang/en.js`
Expected: `editor.js` imports `dialog`; `en.js` has a `dialog.okay` key. If `dialog.okay` does not exist, use whichever confirm key `en.js` provides (`dialog.yes` is used by `_toggleGlyphLock`).

- [ ] **Step 7: Syntax check**

Run: `node --check src-js/views-editor/src/editor.js && node --check src-js/views-editor/src/panel-selection-info.js`
Expected: no output (exit 0).

- [ ] **Step 8: Manual test matrix**

| #   | Setup                                      | Action                     | Expected                                               |
| --- | ------------------------------------------ | -------------------------- | ------------------------------------------------------ |
| 1   | No keys anywhere                           | Glyph ▸ Update All Metrics | Dialog appears; confirming does nothing, no undo entry |
| 2   | Cancel the dialog                          | —                          | Nothing happens                                        |
| 3   | `o`←`=n`, `n`'s margin changed             | Confirm                    | `o` updates                                            |
| 4   | `a`←`=b`, `b`←`=c`, change `c`             | Confirm                    | All three settle in one invocation (fixpoint)          |
| 5   | Cycle `a`←`=b`, `b`←`=a`                   | Confirm                    | Terminates; no hang, no runaway                        |
| 6   | After #4                                   | Undo once                  | Every glyph reverts together                           |
| 7   | After #6                                   | Redo once                  | Every glyph re-applies                                 |
| 8   | After #4                                   | Reload the page            | Values persisted                                       |
| 9   | One keyed glyph locked                     | Confirm                    | Locked glyph skipped, others update                    |
| 10  | Read-only font                             | Open the Glyph menu        | Action disabled                                        |
| 11  | Multi-source font with keys in two masters | Confirm                    | Every source updates at its own location               |
| 12  | Glyph keyed to a deleted glyph             | Confirm                    | Skipped with a console warning; no crash               |

Run #6, #7 and #8 in that order on the same session — the combined-change round trip is the risk in this task.

- [ ] **Step 9: Commit**

```bash
node --check src-js/views-editor/src/editor.js src-js/views-editor/src/panel-selection-info.js
git add . && git commit -m "feat(metrics-keys): add the font-wide Update All Metrics action

Confirmed by dialog, runs to a fixpoint so chains settle in one invocation, and
composes every glyph's change into a single undo step. Shares the resolver and
margin setters with the per-glyph Update rather than duplicating them."
```

---

## Final verification

- [ ] **Run the core suite**

Run: `cd src-js/fontra-core && npm test`
Expected: PASS, no failures. Report the count.

- [ ] **Syntax-check every touched editor file**

Run:

```bash
node --check src-js/views-editor/src/panel-selection-info.js
node --check src-js/views-editor/src/panel-letterspacer.js
node --check src-js/views-editor/src/editor.js
node --check src-js/fontra-webcomponents/src/ui-form.js
```

Expected: no output from any (exit 0).

- [ ] **Confirm no duplicate implementations (rail R-B)**

Run: `grep -rn "leftMargin\b.*translationX\|nameCapture(" src-js/views-editor/src/`
Expected: exactly one left-margin setter and exactly one `nameCapture` call site, both in `panel-selection-info.js`.

- [ ] **Confirm the bundle was never run**

The user's bundle-watch reports compile errors. If it reported any during the work, they are fixed. Do not run a build to check.

- [ ] **Re-run the full spec §7 corner-case table**

Walk cases 1–19 of the spec's corner-case table against the running editor. Report any that do not behave as specified rather than fixing them silently.

- [ ] **Write the DEVELOPMENT-LOG entry**

Add entry 3 to `docs/superpowers/DEVELOPMENT-LOG.md` following the existing four-part format (Problem / Solution / Commits / Challenges and findings). List every commit from this plan, oldest first. Under "Challenges and findings", record anything the plan got wrong — especially whatever Task 10's combined-change composition actually required.

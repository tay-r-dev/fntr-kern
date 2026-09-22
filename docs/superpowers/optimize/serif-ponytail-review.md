# Serif code: simplification review

**Date:** 2026-09-23. **Branch:** `feat/width-rate-axis`, at `c1e5e998f`.
**Scope:** `serif-geometry.js`, the serif parts of `skeleton-generator.js`, the serif writers
and presets in `skeleton-model.js`, and the serif panel code.

This review looks for complexity only. It does not look for bugs. Behavior faults and places
where the code disagrees with the docs are in `serif-semantic-review.md` in this folder. Nothing here is applied yet.
Line numbers are from the commit above and will drift. The function names are the stable anchors.

**Result:** about 96 lines can go. The review found no structural problem. Most items are two
copies of one piece of logic, or leftovers from earlier rounds of work.

## `fontra-core/src/serif-geometry.js`

| Where | Kind | Finding | Change | Lines |
| --- | --- | --- | --- | --- |
| L203-205, L441-443 | shrink | The two linear-interpolation helpers are identical. | Keep one. | −4 |
| L516, `buildHalfSerif` | delete | `tipThickness` is only a new name for the requested thickness. A removed clamp left it behind. | Use the requested value directly. | −1 |
| L634-641, `buildHalfSerif` | shrink | The ease landing on the bracket has its own 32-step bisection loop. The module already has a fixed-count bisection. | Call the module's bisection. | −6 |
| L143, `computeSerifFrame` | delete | The second orient-to-left call does nothing. Depth does not change when the axis flips sign, and L155-156 then rebuild the axis from depth. | Keep only the tangent separation. Correct the comment at L131-135. | −1 |
| L594, L700 | delete | The depth-clamped flag goes up to the cap result, and no production code reads it. Only two tests read it. | Remove the flag and those two assertions. | −3 |

## `fontra-core/src/skeleton-generator.js`

| Where | Kind | Finding | Change | Lines |
| --- | --- | --- | --- | --- |
| L3073-3098, L3275-3302 | shrink | The start serif branch and the end serif branch are one call with the ends swapped. | Use one local function that takes the position. | −20 |
| L3497-3507, `mergeOneSerifEasing` | delete | The comment describes a shared-tension bisection that no longer exists. The merge now calls the editor's own point-deletion fit. | Delete the comment. Keep the guard on where the two end directions meet. | −8 |
| L3448-3456, L7901-7915 | shrink | Two copies turn a line into a cubic, with its handles at the thirds. | Use one helper. | −8 |
| L3459-3460, `mergeOneSerifEasing` | shrink | The chord-length helper has one caller. | Put it inline. | −2 |
| L7758-7766, L7794-7799 | shrink | The units scale is calculated twice: once in a context object for `resolveSerifHalf`, and once as its own value for the cup. | Calculate it once and pass the number. | −5 |
| L7928-7929, `buildSerifCap` | delete | The cap result gives the depth-clamped flag. No caller reads it. | Remove it with the flag above. | −2 |
| L7748 | delete | The export alias `SERIF_HALF_DEFAULTS` points to a table of zeros. Its one reader in the panel always gets zero. | Remove it with the panel item below. | −1 |
| L866, L942 | shrink | Both authored-handle functions define the same off-curve test. | Define it once at module level. | −1 |

## `fontra-core/src/skeleton-model.js`

| Where | Kind | Finding | Change | Lines |
| --- | --- | --- | --- | --- |
| L3215-3222, `normalizeSerifPresetHalf` | shrink | It is a copy of `normalizeSerifHalf` at L5337. The only difference is a number conversion. | Keep one, with the conversion. | −8 |
| L3330-3338, `applySerifPreset` | delete | It copies the halves and the links again. The normalizer has already made new objects. | The body becomes the normalizer call alone. | −6 |
| L3202-3213 | shrink | The three cup fields are written out twice. | Build `SERIF_PRESET_FIELDS` from the half fields plus `SERIF_CUP_FIELDS`. | −3 |
| L3149-3150, `setSkeletonSerifParameters` | shrink | The other side is calculated twice, once as a name and once as its values. | Calculate the name once. | −1 |

## `views-editor/src/skeleton-panel-edits.js`

| Where | Kind | Finding | Change | Lines |
| --- | --- | --- | --- | --- |
| L1341-1345, `nudgeOnePointSerif` | delete | The fallback to "the generator's migration value" always gives zero. The comment at L1336 is out of date. | Use the stored number, or zero. | −4 |
| L1382-1389, `nudgePanelSerifValueStream` | shrink | This endpoint gate is written by hand. `forcePanelSerifSide` uses `isSkeletonContourEndpoint` for the same check. | One line. | −5 |
| L1354-1359, `nudgeOnePointSerif` | shrink | Two bound checks, each guarded against null. | One clamp with open bounds. | −4 |
| L1337, `nudgeOnePointSerif` | delete | The `contour` parameter is not used. | Remove it. | 0 |

## `views-editor/src/panel-skeleton-parameters.js`

| Where | Kind | Finding | Change | Lines |
| --- | --- | --- | --- | --- |
| L298-313, `serifNudgeTargets` | shrink | It does the same scope split, and the same "both means left and right" step, as `serifHalfValuesFromField` above it. | Move that step into one helper. | −5 |

## Outside this review's scope

These are not complexity items, but the review found them.

- **The easing merge marks cap points by fixed positions** in the terminal's point list: 2, 5,
  16 and 13 (`buildSerifCap`, near L7884). If `buildSerifTerminal` changes its point order, the
  merge marks the wrong points and gives no error. A mark set inside `buildSerifTerminal` has
  no such dependency.
- **The architecture map has old line counts.** It gives 268 lines for `serif-geometry.js` and
  4,730 for `skeleton-generator.js`. The files now have 828 and 8,073 lines.

## Order of work, if applied

1. Do the generator start and end branch merge first. It is the largest cut, and the golden
   fixtures cover both ends.
2. Do the dead flag, the alias and the panel fallback together. The alias removal makes the
   fallback change necessary.
3. Do the remaining small items in any order. Each one is local to its function.
4. Run `npm test` in `fontra-core` after each step. The panel items need the manual check
   from rail R-G: scrub a serif field, and use the Force menu.

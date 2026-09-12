# forkra UI Nomenclature

**Date:** 2026-09-10.
**Scope:** `src-js/views-editor/` (primary), `src-js/fontra-webcomponents/` (shared widgets),
`src-js/fontra-core/assets/` (CSS and icons). Other views are noted only for shared-component use.

This document is read-only reconnaissance for a UX refactor. It names every UI component in the
editor view, where it lives, and what the user sees. Names follow `GLOSSARY.md` and
`FEATURE-ARCHITECTURE-MAP.md`. Facts below were checked against the tree on 2026-09-10.

---

## 1. Categories

Six structural categories cover every component found. Each is defined by how it is built and
registered, not by what it looks like.

| Category | Extends / registers as | Mounts at | Example |
| --- | --- | --- | --- |
| **View** | Its own `start.js` bootstraps `EditorController`, mounted into `editor.html` | The whole browser tab | The editor view itself |
| **Sidebar panel** | `class X extends Panel` (`views-editor/src/panel.js`), a plain HTML custom element registered with `customElements.define`, instantiated with `new X(this)` and passed to `addSidebarPanel(panel, "left"|"right")` in `editor.js` | Left or right sidebar, one accordion-style tab per panel | `SelectionInfoPanel` |
| **Sub-panel** | A plain class or function embedded inside a sidebar panel's own DOM, not separately registered, no `customElements.define` of its own | A section inside a sidebar panel | The Letterspacer block inside `panel-selection-info.js`, `SkeletonDefaultsPanel` embedded the same way |
| **Tool** | A tool class with `identifier`, instantiated in `editor.js:initTools()` and pushed into the `editToolClasses` array, then `addEditTool()` stores it in `this.tools{}` and adds a toolbar button | The tool strip along the canvas edge; the canvas itself while active | `PointerTools`, `SkeletonPenTools`, `MarkerTool` |
| **Visualization layer** | A plain object literal passed to `registerVisualizationLayerDefinition()` (`visualization-layer-definitions.js` / `-skeleton.js` / `-markers.js` / etc.), pushed into the module-level `visualizationLayerDefinitions` array | Drawn directly onto the glyph canvas, on top of or under the outline | `fontra.skeleton.ribs`, `fontra.tunni.point`, `fontra.coarse.grid` |
| **Shared web component** | A custom element defined in `fontra-webcomponents/src/*.js`, `customElements.define(tag, Class)`, consumed by tag name from any panel's HTML template | Wherever a panel embeds its tag | `<ui-form>`, `<range-slider>`, `<ui-accordion>` |
| **Menu / menu item** | A plain data array returned by a `getXMenuItems()` function in `fontra-core/src/fontra-menus.js`, rendered by the `<menu-bar>` web component | The top menu bar, or a right-click context menu (`popup-menu`) | Font menu, Edit menu, View menu |
| **Dialog / modal** | The `<modal-dialog>` web component, invoked programmatically (`dialogSetup`, `showMenu`, etc.), not permanently mounted | A centered overlay over the whole view | Save dialog, glyph-note dialog boxes |

Two components do not fit cleanly and are flagged in §7.

---

## 2. Views

| Name in code | File | What the user sees | Lines |
| --- | --- | --- | --- |
| `EditorController` | `views-editor/src/editor.js` | The whole glyph-editing tab: canvas, two sidebars, top toolbar, tool strip | 4310 |
| `start.js` (editor) | `views-editor/src/start.js` | Bootstraps `EditorController` on page load | small |
| `editor.html` | `views-editor/editor.html` | The page shell: canvas element, sidebar mount points, tool strip markup | — |
| `editor.css` | `views-editor/assets/editor.css` | The editor's own layout rules (canvas sizing, sidebar widths, tool strip) | — |

Other views, noted only for shared-component use (not scanned in depth):
- `views-fontinfo`, `views-fontoverview`, `views-applicationsettings` — each has its own `start.js`
  and imports only its own code, plus shared web components (`ui-form`, `ui-accordion`,
  `ui-list`, `glyph-cell`, `modal-dialog`, `menu-bar`) from `fontra-webcomponents`.
- `views-kerning` — a separate workspace (F13). It is the one exception that imports directly
  from `views-editor` (`scene-controller.js`, `scene-model.js`, `edit-tools-metrics.js`), per
  `FEATURE-ARCHITECTURE-MAP.md` §3 F13. It also has its own CSS (`views-kerning/assets/kerning.css`)
  and its own HTML shell (`views-kerning/kerning.html`).

---

## 3. Sidebar panels

All extend `Panel` (`views-editor/src/panel.js`, 47 lines) and are registered by one call each
in `EditorController.initSidebars()` (inside `editor.js`, around line 1250):

```js
this.addSidebar(new Sidebar("left"));
this.addSidebar(new Sidebar("right"));
this.addSidebarPanel(new TextEntryPanel(this), "left");
this.addSidebarPanel(new GlyphSearchPanel(this), "left");
this.addSidebarPanel(new DesignspaceNavigationPanel(this), "left");
this.addSidebarPanel(new ReferenceFontPanel(this), "left");
this.addSidebarPanel(new SelectionInfoPanel(this), "right");
this.addSidebarPanel(new TransformationPanel(this), "right");
this.addSidebarPanel(new SkeletonParametersPanel(this), "right");
this.addSidebarPanel(new MarkersPanel(this), "right");
this.addSidebarPanel(new GlyphNotePanel(this), "right");
this.addSidebarPanel(new RelatedGlyphsPanel(this), "right");
this.addSidebarPanel(new CharactersGlyphsPanel(this), "right");
```

`Sidebar` (`sidebar.js`, 195 lines) is the container: one per side, holding a tab strip and a
stacked set of panel bodies, one visible at a time.

| Class | Custom element tag | File | Lines | What the user sees | Owning feature(s) |
| --- | --- | --- | --- | --- | --- |
| `TextEntryPanel` | `panel-text-entry` | `panel-text-entry.js` | 857 | Left sidebar: the type-in-text box that drives what shows on the canvas | core Fontra |
| `GlyphSearchPanel` | `panel-glyph-search` | `panel-glyph-search.js` | 159 | Left sidebar: search field to jump to a glyph | core Fontra |
| `DesignspaceNavigationPanel` | `panel-designspace-navigation` | `panel-designspace-navigation.js` | 3226 | Left sidebar: master/source list, plus the Coarse grid and SpeedPunk accordions | core Fontra, F1 Coarse grid, F3 SpeedPunk |
| `ReferenceFontPanel` | `panel-reference-font` | `panel-reference-font.js` | 739 | Left sidebar: loads a reference font/image to trace against | core Fontra |
| `SelectionInfoPanel` | `panel-selection-info` | `panel-selection-info.js` | 1807 | Right sidebar: coordinates, margins, advance width for the current selection; hosts the Letterspacer sub-panel | core Fontra, F6 Letterspacer |
| `TransformationPanel` | `panel-transformation` | `panel-transformation.js` | 1885 | Right sidebar: move/scale/rotate/skew controls, plus Tunni and point-label toggles | core Fontra, F4 Tunni, F5 Point labels |
| `SkeletonParametersPanel` | `panel-skeleton-parameters` | `panel-skeleton-parameters.js` | 2784 | Right sidebar: numeric fields for the selected skeleton point/rib (width, cap, serif settings) | F7 Skeleton |
| `MarkersPanel` | `panel-markers` | `panel-markers.js` | 515 | Right sidebar: list of markers on the glyph, with visibility toggles | F11 Markers |
| `GlyphNotePanel` | `panel-glyph-note` | `panel-glyph-note.js` | 153 | Right sidebar: a free-text note attached to the glyph | core Fontra |
| `RelatedGlyphPanel` (registered as `RelatedGlyphsPanel`) | `panel-related-glyph` | `panel-related-glyphs.js` | 738 | Right sidebar: list of glyphs that share components with the current one | core Fontra |
| `CharactersGlyphsPanel` | `panel-characters-glyphs` | `panel-characters-glyphs.js` | 853 | Right sidebar: character-to-glyph mapping list | core Fontra |

Note: the class is named `RelatedGlyphPanel` (singular) in `panel-related-glyphs.js`, but
`editor.js` instantiates it as `RelatedGlyphsPanel`. Confirmed both spellings exist — check the
import alias before editing either file.

---

## 4. Sub-panels

Embedded UI blocks that live inside a sidebar panel's own template, with no separate
`customElements.define` and no separate row in the sidebar registration list.

| Name | File | What the user sees | Owning feature |
| --- | --- | --- | --- |
| Letterspacer block | `panel-letterspacer.js` (2011 lines) | A collapsible section inside `SelectionInfoPanel` with area/depth/overshoot sliders and an Apply button | F6 Letterspacer |
| `SkeletonDefaultsPanel` | `panel-skeleton-defaults.js` (678 lines) | A collapsible section, likely inside the skeleton panel area, for per-source default widths/caps | F7 Skeleton |
| Coarse grid accordion | inside `panel-designspace-navigation.js` | A collapsible section in the left sidebar's navigation panel with grid-size presets | F1 Coarse grid |
| SpeedPunk accordion | inside `panel-designspace-navigation.js` | A collapsible section in the same panel with peak-height/sharpness/opacity sliders | F3 SpeedPunk |

`SkeletonDefaultsPanel` still extends `Panel` and still calls `customElements.define`, so
structurally it reads as a full sidebar panel, but it is not in the `addSidebarPanel()` list in
`editor.js` — it is mounted by `panel-selection-info.js` as a child, per
`FEATURE-ARCHITECTURE-MAP.md` §4's note ("Hosts letterspacer + skeleton-defaults sub-panels").
This is the one component that is a registered custom element but not a top-level sidebar tab —
flagged again in §7.

---

## 5. Tools

Registered as a fixed array in `EditorController.initTools()` (`editor.js`, ~line 1088):

```js
const editToolClasses = [
  PointerTools, PenTool, SkeletonPenTools, KnifeTool, ShapeTool,
  MetricsTool, PowerRulerTool, MarkerTool, HandTool,
];
for (const editToolClass of editToolClasses) {
  this.addEditTool(new editToolClass(this));
}
```

`addEditTool()` stores each tool in `this.tools[tool.identifier]` (and `this.topLevelTools`), and
builds its toolbar button. A tool with `subTools` (for example `PointerTools`, which bundles the
plain pointer and the shape/knife variants under one button) fans its sub-tools into `this.tools`
too, each getting its own `identifier`.

| Class | File | Lines | What the user sees | Owning feature |
| --- | --- | --- | --- | --- |
| `PointerTools` | `edit-tools-pointer.js` | 1816 | The arrow/select tool, drag, marquee, transform handles | core Fontra; dispatch point for Skeleton, Tunni, markers, base-expansion (R-A dispatcher) |
| `PenTool` | `edit-tools-pen.js` | 951 | The pen tool for drawing/editing normal outline contours | core Fontra; carries quad-handle and pen-connect extras (F8) |
| `SkeletonPenTools` | `edit-tools-skeleton.js` | 1266 | The Skeleton Pen tool, drawing centerlines | F7 Skeleton |
| `KnifeTool` | `edit-tools-knife.js` | 186 | Slices a contour in two by dragging a line across it | core Fontra |
| `ShapeTool` | `edit-tools-shape.js` | 252 | Draws primitive shapes (rectangle/oval) | core Fontra |
| `MetricsTool` (exports `SidebearingTool`, `KerningTool`) | `edit-tools-metrics.js` | 1578 | Drag handles on the sidebearing lines / kerning gap | core Fontra; `KerningTool` reused by `views-kerning` |
| `PowerRulerTool` | `edit-tools-power-ruler.js` | 321 | On-demand measurement ruler across the outline | core Fontra (winding-walk shared with Markers) |
| `MarkerTool` | `edit-tools-marker.js` | 285 | Places rays/dimensions on a contour | F11 Markers |
| `HandTool` | `edit-tools-hand.js` | 32 | Pans the canvas | core Fontra |
| `edit-tools-base.js` | 63 lines | not itself a tool — the shared base class every tool above extends | core Fontra |

Q-measure (F2) is not a tool. It is a hold-key modifier (`measure-interactions.js`, 505 lines)
wired into `editor.js` as `action.realtime.measure` and read by whichever tool is active.

---

## 6. Visualization layers (canvas overlays)

Registered as plain object literals pushed into one shared array:

```js
// visualization-layer-definitions.js
export const visualizationLayerDefinitions = [];
export function registerVisualizationLayerDefinition(newLayerDef) { ... }
registerVisualizationLayerDefinition({ identifier: "fontra....", ... });
```

Each entry carries an `identifier` (dotted, e.g. `fontra.skeleton.ribs`), a `draw` function, and
z-order/selection-mode flags. Files that call `registerVisualizationLayerDefinition`:

| File | Lines | Layers registered | Owning feature |
| --- | --- | --- | --- |
| `visualization-layer-definitions.js` | 2520 | Most core layers, plus registration-only entries for measure, point labels, coarse grid, SpeedPunk, base-expand ghost, Tunni | core Fontra, F1–F5, F9 |
| `visualization-layer-skeleton.js` | 1202 | 13 layers under `fontra.skeleton.*`: `width-shading`, `ribs`, `rib-points`, `centerline`, `handles`, `nodes`, `selected-nodes`, `tunni`, `generated-tunni`, `generated-curvature-labels`, `insert-handles-preview`, `editable-markers`, `point-labels` | F7 Skeleton |
| `visualization-layer-markers.js` | 348 | Ray and dimension overlays | F11 Markers |
| `visualization-layer-snapping.js` | 240 | Held rings, near-indicator, guide lines during a drag | F12 Snapping |
| `visualization-layer-letterspacer.js` | 150 | `letterspacer-visualization` overlay (margin/area shading) | F6 Letterspacer |
| `visualization-layer-composition.js` | 47 | Composition/component-related overlay | core Fontra |
| `visualization-layers.js` | 138 | The registration mechanism itself and the runtime that walks the array each frame | core Fontra (infrastructure, not a layer) |

The user sees these as drawings on the glyph canvas: dashed guides, coloured handles, comb
fringes, rulers. They never have their own DOM element; they are canvas draw calls keyed by
layer identifier and toggled from the View menu or a sidebar checkbox (see §8).

---

## 7. Shared web components (`fontra-webcomponents/src/`)

22 files, each a plain custom element (`extends HTMLElement`, `customElements.define(tag, Class)`).
Consumed by tag name inside any panel's template string.

| Tag | File | Lines (delta vs upstream where known) | What it is |
| --- | --- | --- | --- |
| `ui-form` | `ui-form.js` | +56 (forkra) | The generic label+field row builder used by nearly every panel |
| `ui-accordion` | `ui-accordion.js` | — | Collapsible section, used for Coarse grid, SpeedPunk, Letterspacer, etc. |
| `ui-list` | `ui-list.js` | — | Sortable/selectable list, used by Markers panel, glyph lists |
| `range-slider` | `range-slider.js` | +53/−10 (forkra) | Slider with numeric readout; forkra added `allowInputBeyondRange`, `displayValue`, `values`, `step` for skeleton widths |
| `rotary-control` | `rotary-control.js` | — | Circular drag knob (angle controls, e.g. serif axis) |
| `icon-button` | `icon-button.js` | — | A toolbar-style icon button |
| `inline-svg` | `inline-svg.js` | — | Inlines an SVG icon so its colour follows CSS custom properties |
| `menu-bar` | `menu-bar.js` | — | Renders the top menu bar from a menu-item array |
| `menu-panel` | `menu-panel.js` | — | One open dropdown/submenu |
| `popup-menu` | `popup-menu.js` | — | Right-click context menu |
| `modal-dialog` | `modal-dialog.js` | — | Centered modal overlay (Save dialog, confirmations) |
| `glyph-cell` | `glyph-cell.js` | +60/−8 (forkra, kerning view) | One glyph tile (used by Characters/Glyphs panel and the kerning class panel) |
| `glyph-cell-view` | `glyph-cell-view.js` | — | A grid of `glyph-cell`s |
| `glyph-search-field` | `glyph-search-field.js` | — | Text input feeding a glyph search |
| `glyph-search-list` | `glyph-search-list.js` | — | Dropdown result list for glyph search |
| `designspace-location` | `designspace-location.js` | — | The axis-slider strip for design-space position |
| `custom-data-list` | `custom-data-list.js` | — | Key/value editor for raw customData |
| `add-remove-buttons` | `add-remove-buttons.js` | — | The +/- pair used to grow/shrink a list |
| `grouped-settings` | `grouped-settings.js` | — | Grouped checkbox/setting block |
| `simple-settings` | `simple-settings.js` | — | Minimal settings form |
| `theme-support.js` | — | Not a custom element — a shared helper for light/dark theme variables |
| `plugin-manager` | `plugin-manager.js` | — | Plugin list/toggle UI (application-settings view mainly) |

Shadow DOM: `attachShadow`/`shadowRoot` was found in 12 of the 22 files (`ui-form`, `rotary-control`,
`ui-accordion`, `ui-list`, `glyph-search-list`, `menu-bar`, `menu-panel`, `modal-dialog`,
`plugin-manager`, `glyph-search-field`, `designspace-location`, `custom-data-list`). The remaining
10 (`add-remove-buttons`, `glyph-cell-view`, `glyph-cell`, `grouped-settings`, `icon-button`,
`inline-svg`, `popup-menu`, `range-slider`, `simple-settings`, `theme-support`) render into light
DOM or a plain innerHTML template. This is an inconsistency worth flagging (§9).

Sidebar panels themselves (`panel.js` base class) do **not** use shadow DOM — they render into
regular light-DOM containers, so panel CSS is global, while about half the shared widgets they
embed are shadow-scoped. Style hooks crossing that boundary must go through CSS custom properties.

---

## 8. Menus

`fontra-core/src/fontra-menus.js` (356 lines) exports one `getXMenuItems(viewController)` function
per top-level menu, each returning a plain array of `MenuItem`-shaped objects (title, action,
sometimes a submenu array). `getFontMenuItems()` (line 182) is one example; it is where the
Kerning-view entry was added (per the architecture map, "after `font-overview.title`"). The
`<menu-bar>` web component renders whichever menu array the current view supplies.

Right-click context menus reuse the same `MenuItem` shape, rendered through `<popup-menu>` instead
of `<menu-bar>`.

---

## 9. Registration mechanisms — summary table

| What | Mechanism | Exact function/array |
| --- | --- | --- |
| Sidebar panel goes into a sidebar | One call per panel in `EditorController` | `this.addSidebarPanel(new XPanel(this), "left"|"right")`, inside `editor.js` |
| Sidebar container itself | Two calls, one per side | `this.addSidebar(new Sidebar("left"))` / `"right"` |
| Tool goes into the toolbar | Push the class into a fixed array, then loop | `editToolClasses` array + `this.addEditTool(new editToolClass(this))`, `editor.js:initTools()` |
| Tool lookup at runtime | Keyed by identifier | `this.tools[tool.identifier]` |
| Visualization layer goes onto the canvas | Call the registration function at module load | `registerVisualizationLayerDefinition({ identifier, draw, ... })`, appends to `visualizationLayerDefinitions` array (`visualization-layers.js`) |
| Menu item added | Return it from the menu's item-array function | `getFontMenuItems()`, `getEditMenuItems()`, etc. in `fontra-menus.js` |
| Web component registered | Standard custom element registration | `customElements.define("tag-name", ClassName)`, once per file in `fontra-webcomponents/src/` |
| Keyboard/menu action wired | Central action registry | `registerAction(...)`, called ~24 times directly in `editor.js` (view actions, zoom, realtime hotkeys) |

---

## 10. Localization

All UI strings come from `fontra-core/assets/lang/en.js` and its 12 sibling translation files
(`de.js`, `es-419.js`, `es-ES.js`, `fr.js`, `it.js`, `ja.js`, `nl.js`, `pt-BR.js`, `pt-PT.js`,
`tl.js`, `zh-CN.js`, `zh-TW.js`). `fontra-core/src/localization.js` exports `translate(key, ...args)`.
Any component calls `translate("some.key")` to get the current-language string; it never hardcodes
English text in the DOM template. Per the architecture map's shared-file table, forkra's own
additions to `en.js` are itemised: skeleton-parameters (73 keys), designspace-navigation (11),
letterspacer (7), realtime shortcuts (5), skeleton tool (6), markers (8), kerning view (3).

---

## 11. Styling

CSS files that the editor UI depends on:

| File | Role |
| --- | --- |
| `fontra-core/assets/css/core.css` | Base tokens: colour variables, light/dark theme switch via `--fontra-theme-marker` |
| `fontra-core/assets/css/shared.css` | Shared layout rules used across views |
| `fontra-core/assets/css/multi-panel.css` | The generic sidebar/panel/accordion layout rules |
| `fontra-core/assets/css/tooltip.css` | Tooltip styling |
| `views-editor/assets/editor.css` | Editor-specific layout: canvas sizing, tool strip, sidebar widths |

Theme switching: `core.css` defines `--fontra-theme-marker` as either a valid space token or
`initial`, gated by `prefers-color-scheme` and a light/dark class, then every colour token
(`--foreground-color-light`, `--background-color-light`, `--ui-element-foreground-color-light`,
etc.) is written as `var(--fontra-theme-marker) <light-value>`, so the marker's validity switches
whole blocks of variables on or off. This is the styling hook pattern: **every themed colour is a
CSS custom property**, never a hardcoded hex value in component code.

Icons: SVG files under `fontra-core/assets/tabler-icons/` (from the Tabler Icons set) plus
forkra-added icons — `skeleton-pen.svg`, `bone.svg` (Skeleton), `spacing-horizontal.svg`
(Letterspacer), and a `check.svg` addition for the kerning view. Icons are pulled in through the
`<inline-svg>` web component so their fill colour tracks the current theme's custom properties.

---

## 12. Duplication and inconsistencies found

1. **Shadow DOM is inconsistent across shared web components.** 12 of 22 use `attachShadow`; 10
   render into light DOM. A component moved from one style to the other would change how its
   internal CSS is scoped, without any visible signal in how it is consumed from a panel.

2. **`RelatedGlyphPanel` vs `RelatedGlyphsPanel` naming mismatch.** The class is declared as
   `RelatedGlyphPanel` (singular) in `panel-related-glyphs.js`, but `editor.js` imports and
   instantiates it under the name `RelatedGlyphsPanel` (plural). Confirmed both spellings are
   live in the tree; this is either an aliased import or a real inconsistency worth a decision
   during the refactor.

3. **`SkeletonDefaultsPanel` is structurally a full `Panel` subclass with its own custom element,
   but it is not a top-level sidebar tab** — it is mounted as a child inside
   `panel-selection-info.js`, alongside the Letterspacer sub-panel, which is a plain embedded
   block with no custom element of its own. Two different construction patterns are used for the
   same job ("a sub-section inside another panel"): one is a full registered custom element, the
   other is not. This is the clearest case of two naming/construction conventions for one kind of
   thing.

4. **Q-measure is a hold-key modifier, not a tool, but sits next to the tool list conceptually.**
   Users may expect it in the tool strip since it changes cursor behavior, but it registers
   through the action/hotkey system (`registerAction`) instead of `addEditTool()`. Worth deciding
   during the refactor whether it should visually read as a tool.

5. **Two distinct point-label layers exist by design, not by accident**: `fontra.point.labels`
   (F5, general Tunni/tension labels) and `fontra.skeleton.point-labels` (inside F7's 13-layer
   set). The architecture map explicitly warns not to merge them, but from a pure UI-nomenclature
   standpoint they are the same category of thing (a numeric readout drawn next to a curve) with
   two names and two owners. Flag for the refactor's category design, not for a code merge.

6. **`edit-tools-metrics.js` exports two tool identities from one file** (`SidebearingTool` and
   `KerningTool`), and `KerningTool` is re-exported into the separate `views-kerning` workspace.
   This is a deliberate reuse per the architecture map (not a duplication bug), but it means one
   file in `views-editor` is dual-owned by the editor's own metrics tool and the kerning view.

7. **`ui-form` and `range-slider` both carry forkra-only extensions for the skeleton panel**
   (`allowInputBeyondRange`, `displayValue`, indeterminate checkbox state). No duplication was
   found — these are additive changes to the one shared component, which is the correct pattern
   (rail R-B: one copy of every function) — but they are worth knowing about because any panel
   still using `ui-form` inherits skeleton-specific behavior it may not need.

No second implementation of any panel, tool, or visualization layer was found — the codebase
follows its own "one copy" rail (R-B) closely at the UI-component level. The duplication that
exists is naming/pattern duplication (item 3 and 5 above), not logic duplication.

---

## 13. Interactive elements — the nomenclature

Sections 1 to 12 name the containers. This section names the things a designer puts a cursor on.
Two families, split by where the element lives. **On-canvas elements** are drawn by a
visualization layer and hit-tested by the scene model. **Chrome elements** are DOM, and live in a
panel, the tool strip, the menu bar or a dialog.

Each term below is the one name for that thing. Use it in code, in labels and in these documents.

### 13.1 On-canvas elements

| Term | What the designer sees and does | Hit test | Owning feature |
| --- | --- | --- | --- |
| **Node** | A point of the outline or the centerline. Click to select, drag to move. | `pointSelectionAtPoint`, `skeletonPointAtPoint` | core, F7 |
| **Handle** | An off-curve control on a stalk. Drag to bend the curve. | `pointSelectionAtPoint`, `skeletonHandleAtPoint` | core, F7 |
| **Segment** | The stretch of curve between two nodes. Click to select it whole. | `segmentSelectionAtPoint`, `skeletonSegmentAtPoint` | core, F7 |
| **Rib** | The width bar across a centerline point. Drag either end to change the stroke width. | `skeletonRibAtPoint`, `skeletonRibSelectionAtPoint` | F7 |
| **Gizmo** | A drawn control that is not part of the letter. Drag it and it writes a value. Four exist: the Tunni point, the Tunni handle, the curvature gizmo and the on-curve gizmo. | `skeletonTunniAtPoint`, `generatedTunniAtPoint`, `editableGeneratedAtPoint` | F4, F7 |
| **Grip** | The small square that makes a placed object draggable. Markers have grips. A grip carries no value of its own. | `markerAtPoint` → `markerGrips` | F11 |
| **Readout** | A number the canvas draws during a drag, next to the cursor. It is transient and cannot be clicked. | none | F7, F9, F12 |
| **Label** | A number the canvas draws beside a segment and keeps on screen. Switched on per layer. | none | F5, F7 |
| **Guide** | A line the canvas draws to say what a drag has caught: a metric, a guideline, a snap. | `guidelineSelectionAtPoint`, `fontGuidelineSelectionAtPoint` | core, F12 |
| **Ring** | The circle that marks a held snap target during a drag. | none | F12 |
| **Comb** | The fringe grown off the outline to show the bend. Not interactive. | none | F3 |
| **Insertion preview** | The ghost node and handles the pen draws under the cursor before a click places them. | `skeletonInsertionAtPoint` | core, F7 |
| **Ghost** | The outline preview a base-curve expansion drag draws before it commits. | none | F9 |
| **Sidebearing line** | The vertical margin line. Drag it to change the margin. | `sidebearingAtPoint` | core |
| **Kerning gap** | The space between two glyphs in a line. Drag it to kern. | `kerningAtPoint` | core, F13 |

**Gizmo, grip and readout are three different things.** A gizmo writes a value. A grip moves an
object. A readout says a number and takes no input. Do not use one word for another.

### 13.2 Chrome elements

| Term | What the designer sees and does | Built by |
| --- | --- | --- |
| **Tool button** | One button in the tool strip beside the canvas. Picks the active tool. A button holding sub-tools opens them on a press and hold. | `tool-button` markup in `editor.html`, `addEditTool()` |
| **Tab** | The strip along a sidebar's outer edge. Picks which panel body shows. | `Sidebar` (`sidebar.js`) |
| **Accordion** | A collapsible section inside a panel, with a title bar that opens and closes it. | `<ui-accordion>` |
| **Field row** | One label and one control on a line. The unit every panel is built from. | `<ui-form>` |
| **Number field** | A box holding one number. Takes typing, and takes the arrow keys. | `_addEditNumber` in `ui-form.js` |
| **Expression field** | A number field that also accepts a leading `=` and stores a link. | `_addEditNumberExpression` |
| **Paired number field** | Two boxes on one row, for x and y. | `_addEditNumberXY` |
| **Text field** | A box holding free text. | `_addEditText`, `_addEditTextDouble` |
| **Angle field** | A number field for degrees, beside a rotary control. | `_addEditAngle` |
| **Slider** | A track and a thumb, with a number beside it. | `<range-slider>`, `_addEditNumberSlider` |
| **Rotary control** | A round knob dragged to set an angle. | `<rotary-control>` |
| **Scrub label** | The label of a field row, dragged sideways to change the number. Shift is the fine adjust. Right-click abandons the drag. Every scrub label carries a multiply button. | `fontra-core/src/number-scrub.js` |
| **Multiply button** | The button beside a scrub label. It shows where that field's number lands, not the ratio. | panel code, per point |
| **Checkbox** | A box that is on, off, or indeterminate across a mixed selection. | `_addCheckbox` |
| **Select** | A drop-down list of named choices, such as the cap style. | `_addSelect` |
| **Color picker** | A swatch that opens a color chooser. | `_addColorPicker` |
| **Icon button** | A button whose whole face is an icon. | `<icon-button>` |
| **Add and remove buttons** | The pair that grows or shrinks a list. | `<add-remove-buttons>` |
| **List** | A selectable, sortable list of rows. Markers and glyph lists use it. | `<ui-list>` |
| **Glyph tile** | One glyph drawn in a cell, in a grid or a strip. | `<glyph-cell>`, `<glyph-cell-view>` |
| **Menu item** | One line of the menu bar or of a context menu. | `fontra-menus.js` |
| **Dialog** | A centered overlay that takes the whole view until it is answered. | `<modal-dialog>` |
| **Tooltip** | Hover text on a control. | `tooltip.css` |
| **Header** | A title line inside a panel, with no control on it. | `_addHeader` |
| **Divider and spacer** | A rule or a gap between field rows. | `_addDivider`, `_addSpacer` |

### 13.3 Words this project must stop using two ways

1. **Nudge.** In the skeleton it is the tangential displacement of a generated outline point,
   which is what `GLOSSARY.md` defines. In the panel it is also the name of every scrub stream
   (`nudgePanelPointWidthStream` and six more). The two have nothing to do with each other. The
   panel sense must take another name. **Scrub** is the word for what those streams carry.
2. **Marker.** A marker is a placed measurement (F11). The skeleton also draws a layer called
   `fontra.skeleton.editable-markers`, which marks editable generated geometry and measures
   nothing. That layer needs a name that is not marker.
3. **Handle.** It is an off-curve control. It is not a grip, and no chrome element is a handle.
4. **Bar.** A rib draws as a bar. The menu bar is a bar. Nothing else may be called one.
5. **Toggle and switch.** Both are in the tree for the same thing. **Checkbox** is the element.
   Reserve **switch** for a setting a layer reads, such as the gizmo-mode switch.

---

## 14. What the refactor adds to shared components

The UX refactor asks for behavior the shared components do not have. Each gap is listed here the
first time a chapter of `UI-REFACTOR.md` needs it, so the next chapter extends the one component
instead of hand-building a second copy. This is rail R-B applied to the interface.

**A hand-built copy in some panel does not close a gap.** It is the evidence the gap is real. The
question is always whether the shared component can say it, not whether some panel already draws
it.

A row leaves this section once the component carries the behavior.

| Component | What it cannot say today | Asked for by | State |
| --- | --- | --- | --- |
| `<icon-button>` | **On.** It has an icon, a disabled state and a click. It cannot mark itself as the active choice, so a row of them cannot show which one is picked. Two places hand-built such a row out of bare `<inline-svg>` for this reason: the text alignment row in `panel-text-entry.js`, and the tool strip. | UI refactor §1.3, autokern alignment | to build |
| **Toggle** | Nothing in the tree is one. Every boolean in core, in the shared components and in the editor is a plain checkbox. The refactor needs a pill that slides, in two placements. See below. | UI refactor §2.4, the Visual group | to build |
| **Table** | No shared table exists. The kerning view's pair table is the design to lift: sortable headers, a select-all tick, row selection, a vertical resize grip, and a header context menu for columns. Lift it without the windowed loading, which only the pair table needs. Markers wants two, Skeleton settings wants two. | UI refactor §6 and §7 | to build |
| **Segmented control** | A row of text buttons where exactly one is on, for a choice among three or four. One is hand-built already, the serif Sides row in the skeleton panel, and is not shared. A `<select>` hides the options and a slider makes a named choice read as a number. The Selection panel alone wants four: harmonize method, terminal kind, force angle, gizmo mode. | UI refactor §5.4, harmonize method | to build |
| **Chain** | The link between a left field and a right field. Closed, it greys the right value and writes both from the left. The linked state is in the data and shows as one checkbox per block today. The Selection panel wants about twenty, one per row. | UI refactor §5.8, skeleton rows | to build |
| **Overflow button** | A vertical three-dot beside a segmented control, holding the choices the control has no room for. It opens a multi-select dropdown, so it needs that component and no other. | UI refactor §5.5, projection | to build |
| **Multi-select dropdown** | Nothing in the tree is one. A `<select>` picks one option. A fieldset of checkboxes picks several and costs a block of the panel, always open. This is a button that opens a list of checkboxes and closes again. Four sit on one row in the pair table. | UI refactor §3.3, pair table filters | to build |
| `<ui-form>` | **A compact scrub field.** A field row is full width today: label on the left, box on the right, and the label is what you drag. The refactor needs the name inside the box, a visible scrub affordance, and two fields per row. | UI refactor §2.5, the SpeedPunk group | to build |

**Scope of that change.** Add the on state and use it for the new row. Every one of the fourteen
existing uses defaults to off and does not change. Do not convert the two hand-built rows. Text
Entry is upstream and works, and the tool strip is core Fontra with its own look.

**Read before editing `icon-button.js`.** It declares a setter for its click handler and no getter,
so reading the handler back gives `undefined`. That broke a kerning-view hotkey once, recorded in
`DEVELOPMENT-LOG.md` under the kerning view.

### 14.1 The toggle, and what separates it from a checkbox

Three controls say a boolean. They differ in what they govern, not in what they store.

| Control | Where it sits | What it governs |
| --- | --- | --- |
| **Header toggle** | The right end of an accordion header | A visualization. Off also freezes every control inside that accordion. |
| **Labeled toggle** | Its own row, label beside it | One option, standing alone. Nothing freezes. |
| **Checkbox** | A row, often several across | One of a set. |

A checkbox and a labeled toggle do the same thing to the data. They say different things to the
designer. A checkbox belongs to a set and a toggle stands alone, so both exist and neither
replaces the other.

**The freeze is the new behavior.** No control in the tree greys a whole accordion today. The
accordion already takes an auxiliary header element, so the placement costs nothing. The freeze
does not.

**This does not change §13.3 rule 5.** There, **switch** names a setting a layer reads, such as
the gizmo-mode switch. **Toggle** names the element. A header toggle is the element that writes a
switch. Keep the two words apart.

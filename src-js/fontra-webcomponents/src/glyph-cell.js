import { guessGlyphPlaceholderString } from "@fontra/core/glyph-data.js";
import { SVGPath2D } from "@fontra/core/glyph-svg.js";
import * as html from "@fontra/core/html-utils.js";
import { UnlitElement } from "@fontra/core/html-utils.js";
import * as svg from "@fontra/core/svg-utils.js";
import { Transform } from "@fontra/core/transform.js";
import { assert, rgbaToCSS, throttleCalls } from "@fontra/core/utils.ts";
import { InlineSVG } from "./inline-svg.js";

// The swatch's glyph area is 78px square (Figma 4269:1045).
const UNSCALED_CELL_HEIGHT = 78;

// A tab in the background still hears its glyphs change, but nobody sees the
// tiles: each would refetch its glyph (for a skeleton glyph, regenerate its
// outline) on every edit made in another tab. The tiles an edit reaches while
// the tab is hidden wait here, and redraw once when it is shown again.
const cellsChangedWhileHidden = new Set();
globalThis.document?.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    return;
  }
  for (const cell of cellsChangedWhileHidden) {
    cell.throttledUpdate();
  }
  cellsChangedWhileHidden.clear();
});

const cellObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      const cell = entry.target;
      if (entry.intersectionRatio > 0) {
        cell.locationController.addKeyListener(
          cell.locationKey,
          cell.onLocationChanged
        );
        cell.fontController.addGlyphChangeListener(cell.glyphName, cell.onGlyphChanged);
        cell._allowRedraw = true;
        cell.throttledUpdate();
        cell.visible = true;
      } else {
        if (cell._glyphInstanceRequestID) {
          cell.fontController.cancelGlyphInstanceRequest(cell._glyphInstanceRequestID);
          delete cell._glyphInstanceRequestID;
        }
        cell.locationController.removeKeyListener(
          cell.locationKey,
          cell.onLocationChanged
        );
        cell.fontController.removeGlyphChangeListener(
          cell.glyphName,
          cell.onGlyphChanged
        );
        cell.visible = false;
      }
    });
  },
  {
    root: document.documentElement, // Maybe use a more nearby clipping element?
  }
);

export class GlyphCell extends UnlitElement {
  // The swatch (Figma 4269:1045): a card face over the development-status
  // bar. The glyph takes its name's colour; the selected swatch is lime.
  static styles = `
  :host {
    display: inline-block;
    --glyph-cell-scale-factor: calc(var(--glyph-cell-scale-factor-override, 1));
  }

  /* The glyph moved and this drawing did not follow it. */
  :host(.stale) {
    opacity: 0.4;
  }

  /* The swatch: the face, then the status bar 1px under it, clipped
     together to 6px corners. */
  #glyph-cell-container {
    --swatch-surface: var(--surface-base-basic-0);
    --swatch-line: var(--line-base-basic-0);
    --swatch-name: var(--text-base-basic-1);
    --swatch-code: var(--text-base-basic-4);
    display: inline-flex;
    flex-direction: column;
    gap: 1px;
    margin: 4px;
    border-radius: var(--corner-outer-l);
    overflow: hidden;
    cursor: pointer;
  }

  #glyph-cell-container:hover {
    --swatch-surface: var(--surface-base-basic-1);
    --swatch-line: var(--line-base-basic-1);
  }

  #glyph-cell-container.selected {
    --swatch-surface: var(--surface-color-lime-basic-2);
    --swatch-line: var(--line-color-lime-basic-2);
    --swatch-name: var(--text-color-lime-basic-1);
    --swatch-code: var(--text-color-lime-basic-5);
  }

  #glyph-cell-container.missing #glyph-cell-content {
    opacity: 0.4;
  }

  /* The face: ruled at the sides and above, 6px in, the glyph 2px over its
     label. */
  #glyph-cell-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px;
    background-color: var(--swatch-surface);
    border: 1px solid var(--swatch-line);
    border-bottom: none;
    border-radius: var(--corner-outer-l) var(--corner-outer-l) 0 0;
    color: var(--swatch-name);
    fill: var(--swatch-name);
    user-select: none;
    -webkit-user-select: none;
  }

  #glyph-cell-content > svg {
    display: block;
    height: calc(${UNSCALED_CELL_HEIGHT}px * var(--glyph-cell-scale-factor, 1));
  }

  .glyph-shape-placeholder {
    height: calc(${UNSCALED_CELL_HEIGHT}px * var(--glyph-cell-scale-factor, 1));
    display: grid;  /* for vertical text centering */
    place-items: center;
    text-align: center;
    opacity: 0.5;
  }

  .glyph-name-label {
    display: flex;
    justify-content: space-between;
    gap: 4px;
    font: var(--ui-text-label-xs);
    letter-spacing: var(--ui-tracking);
    font-feature-settings: "case" 1;
    white-space: nowrap;
  }

  .glyph-name {
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--swatch-name);
  }

  .glyph-code {
    flex: none;
    color: var(--swatch-code);
  }

  .glyph-status-color {
    /* The development-status bar. A host that shows glyph tiles for a reason
       other than editing them -- the kerning view's class panel, where a tile
       states class membership and nothing else -- turns it off by setting
       --glyph-cell-status-display: none on the cell. Default unchanged. */
    display: var(--glyph-cell-status-display, block);
    flex: none;
    height: 4px;
    box-sizing: border-box;
    border: 1px solid var(--line-base-inverted-1);
    border-radius: var(--corner-outer-xs);
  }

  #glyph-cell-container.selected .glyph-status-color {
    border: none;
    border-radius: 0;
  }
  `;

  constructor(fontController, glyphName, codePoints, locationController, locationKey) {
    super();
    this.fontController = fontController;
    this.glyphName = glyphName;
    this.codePoints = codePoints;
    this.locationController = locationController;
    this.locationKey = locationKey;
    this.throttledUpdate = throttleCalls(() => this._updateGlyph(), 50);
    this.marginTop = 0.2;
    this.marginBottom = 0.05;
    this.marginSide = 0;
    this.size = 62.4;
    this.height = (1 + this.marginTop + this.marginBottom) * this.size;
    assert(this.height === UNSCALED_CELL_HEIGHT, "manual size dependency incorrect");
    this.width = this.height;
    const { glyphString, direction } = guessGlyphPlaceholderString(
      this.codePoints,
      this.glyphName
    );
    this._placeholderString = glyphString;
    this._placeholderDirection = direction || "auto";
    this._selected = false;

    // A cell follows its glyph by default. A view that sets `deferUpdates`
    // keeps the drawing it has and reports that the glyph moved under it, so
    // the designer decides when to look again. Coming into view and a location
    // change still redraw at once: neither is an edit.
    this.deferUpdates = false;
    this.stale = false;
    this._hasDrawn = false;
    this._allowRedraw = false;
    this.onGlyphChanged = () => {
      if (document.hidden) {
        cellsChangedWhileHidden.add(this);
        return;
      }
      this.throttledUpdate();
    };
    // A location change is not an edit, so it redraws whatever the cell was
    // told about deferring.
    this.onLocationChanged = () => this.refreshNow();
  }

  markStale() {
    if (this.stale) {
      return;
    }
    this.stale = true;
    this.classList.add("stale");
    this.onStaleChanged?.(this);
  }

  refreshNow() {
    this._allowRedraw = true;
    this.stale = false;
    this.classList.remove("stale");
    this.throttledUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    cellObserver.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    cellObserver.unobserve(this);
    cellsChangedWhileHidden.delete(this);
    this.locationController.removeKeyListener(this.locationKey, this.onLocationChanged);
    this.fontController.removeGlyphChangeListener(this.glyphName, this.onGlyphChanged);
  }

  async _updateGlyph() {
    // The guard sits here, at the drawing, rather than on any one of the things
    // that ask for a redraw. A cell is asked to redraw from several directions
    // — its glyph changed, its location changed, it came into view — and a
    // deferring cell has to hold still for all of them but the ones it was told
    // to honour. The first draw always happens: a blank tile is not a preview.
    if (this.deferUpdates && this._hasDrawn && !this._allowRedraw) {
      this.markStale();
      return;
    }
    this._allowRedraw = false;
    this._hasDrawn = true;

    this.width = this.height;

    const location = this.locationController.model[this.locationKey];
    const request = this.fontController.requestGlyphInstance(this.glyphName, location);
    this._glyphInstanceRequestID = request.requestID;
    const glyphController = await request.instancePromise;
    delete this._glyphInstanceRequestID;
    if (!glyphController) {
      // glyph instance request got cancelled, or glyph does not exist
      this._glyphSVG = null;
      return;
    }

    this._glyphIsEmpty = !glyphController.controlBounds;
    if (this._glyphIsEmpty) {
      this._glyphSVG = null;
      this.requestUpdate();
      return;
    }

    const unitsPerEm = this.fontController.unitsPerEm;
    const fontSource = this.fontController.fontSourcesInstancer.instantiate(location);
    const ascender =
      fontSource?.lineMetricsHorizontalLayout["ascender"]?.value || 0.8 * unitsPerEm;
    const descender =
      fontSource?.lineMetricsHorizontalLayout["descender"]?.value || -0.2 * unitsPerEm;

    const svgPath = new SVGPath2D();
    glyphController.flattenedPath.drawToPath2d(svgPath);

    const size = this.size;
    const height = this.height;
    this.width = Math.max(
      height,
      ((1 + 2 * this.marginSide) * size * glyphController.xAdvance) / unitsPerEm
    );

    const svgElement = svg.svg(
      {
        viewBox: svg.viewBox(
          -this.marginSide * unitsPerEm,
          -(ascender + this.marginTop * unitsPerEm),
          Math.max(glyphController.xAdvance + 2 * this.marginSide * unitsPerEm, 1), // a width of 0 is problematic
          ascender - descender + (this.marginTop + this.marginBottom) * unitsPerEm
        ),
        width: "100%",
        height: "100%",
      },
      [
        svg.path({
          d: svgPath.getPath(),
          transform: new Transform(1, 0, 0, -1, 0, 0),
        }),
      ]
    );

    this._glyphStatusColor = getStatusColor(
      this.fontController.customData["fontra.sourceStatusFieldDefinitions"],
      glyphController.varGlyph,
      glyphController.sourceIndex
    );
    this._glyphSVG = svgElement;
    this.requestUpdate();
  }

  render() {
    const fallbackFontSize = this.height / 2;
    this._glyphCellContent = html.div(
      {
        id: "glyph-cell-container",
        class: this._glyphIsEmpty || this._glyphSVG ? "exists" : "missing",
      },
      [
        html.div(
          {
            id: "glyph-cell-content",
          },
          [
            this._glyphSVG
              ? this._glyphSVG
              : html.div(
                  {
                    class: "glyph-shape-placeholder",
                    dir: this._placeholderDirection,
                    style: `
                  width: calc(${this.width}px * var(--glyph-cell-scale-factor));
                  font-size: calc(${fallbackFontSize}px * var(--glyph-cell-scale-factor));
                  line-height: ${fallbackFontSize}px;
                `,
                  },
                  [this._placeholderString]
                ),
            html.div(
              {
                class: "glyph-name-label",
                style: `width: calc(${this.width}px * var(--glyph-cell-scale-factor));`,
              },
              [
                html.span({ class: "glyph-name" }, [this.glyphName]),
                html.span({ class: "glyph-code" }, [this._codeLabel()]),
              ]
            ),
          ]
        ),
        html.div({
          class: "glyph-status-color",
          style: `background-color: ${this._glyphStatusColor};`,
        }),
      ]
    );

    // update the selected state when rebuilding the cell contents
    this._updateSelectedState();

    return this._glyphCellContent;
  }

  // The first code point, as hex digits; nothing for an unencoded glyph.
  _codeLabel() {
    const codePoint = this.codePoints?.[0];
    return codePoint === undefined
      ? ""
      : codePoint.toString(16).toUpperCase().padStart(4, "0");
  }

  get selected() {
    return this._selected;
  }

  set selected(onOff) {
    this._selected = onOff;
    this._updateSelectedState();
  }

  _updateSelectedState() {
    this._glyphCellContent?.classList.toggle("selected", this._selected);
  }

  setDragging(onOff) {
    this._glyphCellContent?.classList.toggle("dragging", onOff);
  }

  get visible() {
    return this.classList.contains("visible");
  }

  set visible(onOff) {
    this.classList.toggle("visible", onOff);
  }
}

function getStatusColor(statusFieldDefinitions, varGlyph, sourceIndex) {
  let statusColor = "var(--line-base-basic-1)";
  if (!statusFieldDefinitions || sourceIndex === undefined) {
    return statusColor;
  }

  let status = varGlyph?.sources[sourceIndex].customData["fontra.development.status"];
  if (status === undefined) {
    status = statusFieldDefinitions.find((statusDef) => statusDef.isDefault)?.value;
  }

  const color = statusFieldDefinitions[status]?.color;
  if (color) {
    statusColor = rgbaToCSS(color);
  }

  return statusColor;
}

customElements.define("glyph-cell", GlyphCell);

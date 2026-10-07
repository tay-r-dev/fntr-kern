import { recordChanges } from "@fontra/core/change-recorder.js";
import {
  getFontraInternalSection,
  setFontraInternalSection,
} from "@fontra/core/fontra-internal-data.js";
import { FONTRA_INTERNAL_SECTIONS } from "@fontra/core/fontra-internal-schema.js";
import { getGlyphInfoFromGlyphName } from "@fontra/core/glyph-data.js";
import {
  getMyGlyphSets,
  GlyphSetsController,
  readProjectGlyphSets,
  THIS_FONTS_GLYPHSET,
} from "@fontra/core/glyphsets-controller.js";
import * as html from "@fontra/core/html-utils.js";
import {
  calculateSidebearing,
  closePolygon,
  computeParamAreaFromTargetArea,
  computeTargetAreaFromSidebearing,
  LetterspacerEngine,
  polygonArea,
  setDepth,
} from "@fontra/core/letterspacer-engine.js";
import { translate } from "@fontra/core/localization.js";
import {
  deleteSidebearingKey,
  getEffectiveMetricsKey,
} from "@fontra/core/metrics-keys.js";
import { ObservableController } from "@fontra/core/observable-object.js";
import { getSkeletonData, translateSkeletonData } from "@fontra/core/skeleton-model.js";
import "@fontra/web-components/input-field-large.js"; // the Area/Depth/Overshoot row
import { showArmedTooltip } from "@fontra/web-components/armed-tooltip.js";
import "@fontra/web-components/labeled-toggle.js"; // the heading switch and the settings
import "@fontra/web-components/multi-select-dropdown.js"; // batch apply's glyph set
import "@fontra/web-components/overflow-popover.js"; // the settings overflow
import "@fontra/web-components/text-button.js";
import { Accordion } from "@fontra/web-components/ui-accordion.js";
import "@fontra/web-components/ui-text-input.js"; // the reference glyph
import { CHECKMARK_STYLES } from "@fontra/web-components/checkmark-styles.js";
import { METRICS_PANEL_STYLES } from "./metrics-panel-styles.js";
import Panel from "./panel.js";
import { editSkeleton } from "./skeleton-editing.js";

// ============================================================
// Letterspacer persistence helpers (fontra.internal customData)
// ============================================================

const LETTERSPACER_SOURCE_FIELDS = Object.freeze({
  area: "area",
  depth: "depth",
  overshoot: "overshoot",
});

const LETTERSPACER_FONT_FIELDS = Object.freeze({
  enabled: "enabled",
  mayReplaceMetricsKeys: "mayReplaceMetricsKeys",
});

const LETTERSPACER_GLYPH_FIELDS = Object.freeze({
  referenceGlyphName: "referenceGlyphName",
});

const LETTERSPACER_DEFAULTS = {
  area: 400,
  depth: 15,
  overshoot: 0,
  referenceGlyph: "",
};

const HT_REFERENCE_RULES = [
  // Letters
  { script: "*", category: "Letter", subCategory: "Uppercase", factor: 1.25, reference: "H", filter: "*" }, // prettier-ignore
  { script: "*", category: "Letter", subCategory: "Smallcaps", factor: 1.1, reference: "h.sc", filter: "*" }, // prettier-ignore
  { script: "*", category: "Letter", subCategory: "Lowercase", factor: 1.0, reference: "x", filter: "*" }, // prettier-ignore
  { script: "*", category: "Letter", subCategory: "Lowercase", factor: 0.7, reference: "m.sups", filter: ".sups" }, // prettier-ignore

  // Numbers
  { script: "*", category: "Number", subCategory: "Decimal Digit", factor: 1.2, reference: "one", filter: "*" }, // prettier-ignore
  { script: "*", category: "Number", subCategory: "Decimal Digit", factor: 1.2, reference: "zero.osf", filter: ".osf" }, // prettier-ignore
  { script: "*", category: "Number", subCategory: "Fraction", factor: 1.3, reference: "*", filter: "*" }, // prettier-ignore
  { script: "*", category: "Number", subCategory: "*", factor: 0.8, reference: "*", filter: ".dnom" }, // prettier-ignore
  { script: "*", category: "Number", subCategory: "*", factor: 0.8, reference: "*", filter: ".numr" }, // prettier-ignore
  { script: "*", category: "Number", subCategory: "*", factor: 0.8, reference: "*", filter: ".inferior" }, // prettier-ignore
  { script: "*", category: "Number", subCategory: "*", factor: 0.8, reference: "*", filter: "superior" }, // prettier-ignore

  // Punctuation
  { script: "*", category: "Punctuation", subCategory: "Other", factor: 1.4, reference: "*", filter: "*" }, // prettier-ignore
  { script: "*", category: "Punctuation", subCategory: "Parenthesis", factor: 1.2, reference: "*", filter: "*" }, // prettier-ignore
  { script: "*", category: "Punctuation", subCategory: "Quote", factor: 1.2, reference: "*", filter: "*" }, // prettier-ignore
  { script: "*", category: "Punctuation", subCategory: "Dash", factor: 1.0, reference: "*", filter: "*" }, // prettier-ignore
  { script: "*", category: "Punctuation", subCategory: "*", factor: 1.0, reference: "*", filter: "slash" }, // prettier-ignore
  { script: "*", category: "Punctuation", subCategory: "*", factor: 1.2, reference: "*", filter: "*" }, // prettier-ignore

  // Symbols
  { script: "*", category: "Symbol", subCategory: "Currency", factor: 1.6, reference: "*", filter: "*" }, // prettier-ignore
  { script: "*", category: "Symbol", subCategory: "*", factor: 1.5, reference: "*", filter: "*" }, // prettier-ignore
  { script: "*", category: "Mark", subCategory: "*", factor: 1.0, reference: "*", filter: "*" }, // prettier-ignore

  // Devanagari
  { script: "devanagari", category: "Letter", subCategory: "Other", factor: 1.0, reference: "devaHeight", filter: "*" }, // prettier-ignore
  { script: "devanagari", category: "Letter", subCategory: "Ligature", factor: 1.0, reference: "devaHeight", filter: "*" }, // prettier-ignore
];

function matchesRuleField(ruleValue, glyphValue) {
  if (ruleValue === "*") return true;
  if (glyphValue === undefined || glyphValue === null) return false;
  return String(ruleValue).toLowerCase() === String(glyphValue).toLowerCase();
}

function coerceNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getLetterspacerSection(entity) {
  const section = getFontraInternalSection(
    entity,
    FONTRA_INTERNAL_SECTIONS.LETTERSPACER
  );
  return isRecord(section) ? section : null;
}

function getSourceLetterspacerValues(source) {
  const section = getLetterspacerSection(source);
  return {
    area: coerceNumber(
      section?.[LETTERSPACER_SOURCE_FIELDS.area],
      LETTERSPACER_DEFAULTS.area
    ),
    depth: coerceNumber(
      section?.[LETTERSPACER_SOURCE_FIELDS.depth],
      LETTERSPACER_DEFAULTS.depth
    ),
    overshoot: coerceNumber(
      section?.[LETTERSPACER_SOURCE_FIELDS.overshoot],
      LETTERSPACER_DEFAULTS.overshoot
    ),
  };
}

function hasCompleteSourceLetterspacerValues(source) {
  const section = getLetterspacerSection(source);
  if (!section) {
    return false;
  }
  return (
    Number.isFinite(Number(section[LETTERSPACER_SOURCE_FIELDS.area])) &&
    Number.isFinite(Number(section[LETTERSPACER_SOURCE_FIELDS.depth])) &&
    Number.isFinite(Number(section[LETTERSPACER_SOURCE_FIELDS.overshoot]))
  );
}

function setSourceLetterspacerValues(source, values) {
  const section = {
    ...(getLetterspacerSection(source) || {}),
  };

  if (values.area !== undefined) {
    section[LETTERSPACER_SOURCE_FIELDS.area] = coerceNumber(
      values.area,
      LETTERSPACER_DEFAULTS.area
    );
  }
  if (values.depth !== undefined) {
    section[LETTERSPACER_SOURCE_FIELDS.depth] = coerceNumber(
      values.depth,
      LETTERSPACER_DEFAULTS.depth
    );
  }
  if (values.overshoot !== undefined) {
    section[LETTERSPACER_SOURCE_FIELDS.overshoot] = coerceNumber(
      values.overshoot,
      LETTERSPACER_DEFAULTS.overshoot
    );
  }

  setFontraInternalSection(source, FONTRA_INTERNAL_SECTIONS.LETTERSPACER, section);
}

function setFontLetterspacerEnabled(entity, enabled) {
  const section = {
    ...(getLetterspacerSection(entity) || {}),
    [LETTERSPACER_FONT_FIELDS.enabled]: !!enabled,
  };
  setFontraInternalSection(entity, FONTRA_INTERNAL_SECTIONS.LETTERSPACER, section);
}

function setFontMayReplaceMetricsKeys(entity, value) {
  const section = {
    ...(getLetterspacerSection(entity) || {}),
    [LETTERSPACER_FONT_FIELDS.mayReplaceMetricsKeys]: !!value,
  };
  setFontraInternalSection(entity, FONTRA_INTERNAL_SECTIONS.LETTERSPACER, section);
}

function setGlyphLetterspacerReference(glyph, value) {
  const section = {
    ...(getLetterspacerSection(glyph) || {}),
    [LETTERSPACER_GLYPH_FIELDS.referenceGlyphName]: String(value ?? ""),
  };
  setFontraInternalSection(glyph, FONTRA_INTERNAL_SECTIONS.LETTERSPACER, section);
}

// The subsets the bulk apply offers, in the order they are shown. Each one is
// the glyph category the automatic reference rules already sort a glyph into,
// so a subset a designer checks is the same group the spacing engine treats
// alike.
const DOUBLE_CHECK_REVERSE_KEY = "fontra.letterspacer.double-check-reverse";

function readDoubleCheckReverse() {
  try {
    return localStorage.getItem(DOUBLE_CHECK_REVERSE_KEY) !== "false";
  } catch (error) {
    return true;
  }
}

const BULK_SUBSETS = [
  { key: "uppercase", label: "Uppercase" },
  { key: "lowercase", label: "Lowercase" },
  { key: "smallcaps", label: "Smallcaps" },
  { key: "numbers", label: "Numbers" },
  { key: "punctuation", label: "Punctuation" },
  { key: "symbols", label: "Symbols" },
  { key: "marks", label: "Marks" },
];

export default class LetterspacerPanel extends Panel {
  identifier = "letterspacer";
  iconPath = "/tabler-icons/spacing-horizontal.svg";

  constructor(editorController) {
    super(editorController);
    this.card = html.div({ class: "metrics-card" });
    this.contentElement.appendChild(this.card);
    this._appendStyle(METRICS_PANEL_STYLES + LETTERSPACER_CARD_STYLES);
    this.fontController = this.editorController.fontController;
    this.sceneController = this.editorController.sceneController;
    this.sceneSettingsController = this.editorController.sceneSettingsController;
    this.handleSelectionChangeBound = this.handleSelectionChange.bind(this);

    // Listen for glyph edits to clear visualization
    this.sceneController.addCurrentGlyphChangeListener((event) => {
      this.clearVisualization();
      this.refreshPersistedParams();
    });

    this.refreshPersistedParamsBound = this.refreshPersistedParams.bind(this);
    this.sceneSettingsController.addKeyListener(
      [
        "fontLocationSourceMapped",
        "selectedGlyphName",
        "selection",
        "editingLayers",
        "editLayerName",
      ],
      this.refreshPersistedParamsBound
    );

    this.params = {
      area: 400,
      depth: 15,
      overshoot: 0,
      applyLSB: 1,
      applyRSB: 1,
      referenceGlyph: "",
    };

    // Apply writes margins by its own route, so a metrics-keyed side has two
    // writers. Default is to leave a keyed side alone (spec section 4.10).
    this.mayReplaceMetricsKeys = false;
    this.metricsKeyHeldMessage = "";

    // Track current and calculated spacing values
    this.currentLSB = 0;
    this.currentRSB = 0;
    this.calculatedLSB = null;
    this.calculatedRSB = null;
    this.visualizationOpacity = 1;
    this.reverseWarningArmed = false;
    this.reverseWarningMessage = "";
    this.reverseWarningTooltip = null;
    this.debugLogging = true;
    this.algorithmEnabled = true;

    // Bulk apply: which glyphset to walk and which subsets of it to space.
    // Session state, not persisted -- it is a one-shot action, not a setting
    // the spacing of a glyph depends on.
    this.bulkGlyphsetId = "";
    this.bulkSubsets = Object.fromEntries(
      BULK_SUBSETS.map((subset) => [subset.key, true])
    );
    this.bulkStatus = "";
    this.bulkOpen = true;
    // Reverse across a whole source asks for a second press, unless the
    // designer has switched that off. A preference of the person, not of the
    // font, so it is kept in the browser.
    this.doubleCheckReverse = readDoubleCheckReverse();
  }

  getContentElement() {
    return html.div({ class: "panel" }, []);
  }

  // LETTERSPACER (Figma 4108:2095): the heading with the settings overflow and
  // the switch. Off, the switch hides everything under the heading (Figma
  // 4108:3086).
  _buildHeader() {
    const toggle = html.createDomElement("labeled-toggle", {
      title: "Enable letterspacer",
    });
    toggle.checked = this.algorithmEnabled;
    toggle.addEventListener("change", () => this.setAlgorithmEnabled(toggle.checked));

    const settings = html.createDomElement("overflow-popover", {
      "class": "metrics-heading-icon",
      "data-tooltip": "Settings",
      "data-tooltipposition": "left",
    });
    settings.setAttribute("settings-card", "");
    // The card renders in the popover's own shadow root, which this panel's
    // styles do not reach.
    settings.appendStyle(METRICS_PANEL_STYLES + LETTERSPACER_CARD_STYLES);
    settings.content = this._buildSettingsCard();

    return html.div({ class: "metrics-heading-row" }, [
      html.span({ class: "metrics-heading metrics-grow" }, [
        translate("sidebar.letterspacer.title"),
      ]),
      settings,
      toggle,
    ]);
  }

  // The settings overflow (Figma 4108:3038): a ruled SETTINGS heading over the
  // switches.
  _buildSettingsCard() {
    const overrideToggle = html.createDomElement("labeled-toggle", {
      label: "override metric variables",
      title: translate("sidebar.letterspacer.may-replace-metrics-keys.tooltip"),
    });
    overrideToggle.checked = this.mayReplaceMetricsKeys;
    overrideToggle.addEventListener("change", () =>
      this._onMayReplaceMetricsKeysChange(overrideToggle.checked)
    );
    const doubleCheckToggle = html.createDomElement("labeled-toggle", {
      label: "double check on reverse",
    });
    doubleCheckToggle.checked = this.doubleCheckReverse;
    doubleCheckToggle.addEventListener("change", () => {
      this.doubleCheckReverse = doubleCheckToggle.checked;
      try {
        localStorage.setItem(DOUBLE_CHECK_REVERSE_KEY, String(this.doubleCheckReverse));
      } catch (error) {
        // Not remembered; the switch still holds for this session.
      }
    });
    return html.div({ class: "settings-card" }, [
      html.div({ class: "settings-card-heading" }, ["settings"]),
      html.div({ class: "settings-card-body" }, [doubleCheckToggle, overrideToggle]),
    ]);
  }

  // Area and Depth scrub; Overshoot is a plain field (Figma: "not scrub").
  _buildAreaDepthOvershootRow() {
    const makeField = (key, label, scrub) => {
      const field = html.createDomElement("input-field-large", {
        label,
        value: this.params[key],
        // The old edit-number rows scrubbed and typed whole numbers only.
        integer: true,
      });
      field.type = scrub ? "scrub" : "number";
      field.defaultValue = LETTERSPACER_DEFAULTS[key];
      field.addEventListener("change", (event) =>
        this._onSpacingParamChange(key, event.detail.value)
      );
      return field;
    };
    return html.div({ class: "metrics-row" }, [
      makeField("area", translate("sidebar.letterspacer.area"), true),
      makeField("depth", translate("sidebar.letterspacer.depth"), true),
      makeField("overshoot", translate("sidebar.letterspacer.overshoot"), false),
    ]);
  }

  async _onSpacingParamChange(key, value) {
    if (this._suppressPersist) {
      this.params[key] = value;
      return;
    }
    if (!this.algorithmEnabled) {
      return;
    }
    this.params[key] = value;
    await this.persistParam(key, value);
    this.calculatedLSB = null;
    this.calculatedRSB = null;
    this.clearVisualizationData();
    // Update value display without rebuilding the card
    this.updateValueDisplay();
  }

  _buildReferenceField() {
    const input = html.createDomElement("ui-text-input", {});
    input.placeholder = "auto";
    input.value = this.params.referenceGlyph;
    input.addEventListener("change", () => this._onReferenceGlyphChange(input.value));
    return input;
  }

  _onReferenceGlyphChange(value) {
    if (this._suppressPersist) {
      this.params.referenceGlyph = value;
      return;
    }
    if (!this.algorithmEnabled) {
      return;
    }
    this.params.referenceGlyph = value;
    this.persistParam("referenceGlyph", value);
    this.calculatedLSB = null;
    this.calculatedRSB = null;
    this.clearVisualizationData();
    // Update value display without rebuilding the card
    this.updateValueDisplay();
  }

  // Session state only -- persistParam has never had a branch for these two
  // keys (only "referenceGlyph", "area", "depth" and "overshoot" persist).
  _onApplySideChange(key, checked) {
    if (this._suppressPersist) {
      this.params[key] = checked;
      return;
    }
    if (!this.algorithmEnabled) {
      return;
    }
    this.params[key] = checked;
  }

  async _onMayReplaceMetricsKeysChange(checked) {
    // A policy for the whole project, not a spacing parameter, so it is held
    // at font level rather than beside the per-source numbers.
    this.mayReplaceMetricsKeys = checked;
    if (!this._suppressPersist) {
      await this.persistMayReplaceMetricsKeys(checked);
      await this.updateMetricsKeyHeldMessage();
      this._renderHeldMessage();
    }
  }

  // A checkmark (Figma 379:22544): our checkbox assets, with an optional name.
  _checkmark(checked, label, onchange) {
    return html.label({ class: "checkmark-row" }, [
      html.input({
        type: "checkbox",
        class: "checkmark",
        checked,
        onchange: (event) => onchange(event.target.checked),
      }),
      ...(label ? [html.span({}, [label])] : []),
    ]);
  }

  // The static table (Figma 4108:2787): the side checks heading the L and R
  // columns (which sides Apply writes), then Current and Calculated.
  _buildCalculatedTable() {
    const cell = (content, extraClass = "") =>
      html.div({ class: `ls-cell ${extraClass}`.trim() }, content);
    this._currentLCell = cell([""], "ls-value");
    this._currentRCell = cell([""], "ls-value");
    this._calculatedLCell = cell([""], "ls-value");
    this._calculatedRCell = cell([""], "ls-value");
    const sideHead = (key, side) =>
      cell(
        [
          this._checkmark(!!this.params[key], "", (checked) =>
            this._onApplySideChange(key, checked)
          ),
          html.span({ class: "ls-side" }, [side]),
        ],
        "ls-head"
      );
    this._updateCalculatedValueCells();
    return html.div({ class: "ls-table" }, [
      cell([""]),
      sideHead("applyLSB", "L"),
      sideHead("applyRSB", "R"),
      cell(["Current"]),
      this._currentLCell,
      this._currentRCell,
      cell(["Calculated"]),
      this._calculatedLCell,
      this._calculatedRCell,
    ]);
  }

  _buildActionRow() {
    const button = (label, onclick) =>
      html.createDomElement("text-button", {
        label,
        size: "S",
        disabled: !this.hasCurrentMaster,
        onclick,
      });
    return html.div({ class: "ls-actions" }, [
      html.div({ class: "ls-actions-group" }, [
        button("calculate", () => this.calculateSpacing()),
        button("apply", () => this.applySpacing()),
      ]),
      button("reverse", (event) => this.reverseSpacing(event)),
    ]);
  }

  // batch apply (Figma 4108:2102): an accordion switch over the glyph set,
  // its subsets and the apply button. It spaces the glyphset it is pointed
  // at, not the glyph on the canvas, so it stays enabled where Calculate and
  // Apply cannot.
  _buildBatchApply() {
    const glyphsetDropdown = html.createDomElement("multi-select-dropdown", {
      label: "glyph set",
      labelAbove: true,
      singleChoice: true,
      items: this.getBulkGlyphsetOptions().map((option) => ({
        ...option,
        checked: option.value === this.bulkGlyphsetId,
      })),
    });
    glyphsetDropdown.addEventListener("change", (event) => {
      this.bulkGlyphsetId = event.detail.checked || "";
    });

    this._bulkStatusElement = html.div({ class: "metrics-label" }, [this.bulkStatus]);

    const content = html.div({ class: "ls-batch" }, [
      glyphsetDropdown,
      html.div(
        { class: "checkmark-wrap" },
        BULK_SUBSETS.map((subset) =>
          this._checkmark(!!this.bulkSubsets[subset.key], subset.label, (checked) => {
            this.bulkSubsets[subset.key] = checked;
          })
        )
      ),
      html.div({}, [
        html.createDomElement("text-button", {
          label: "apply to set",
          size: "S",
          onclick: () => this.applySpacingToGlyphSet(),
        }),
      ]),
      this._bulkStatusElement,
    ]);

    const accordion = new Accordion();
    accordion.setAttribute("switch", "");
    // The content renders in the accordion's own shadow root, which this
    // panel's styles do not reach.
    accordion.appendStyle(METRICS_PANEL_STYLES + LETTERSPACER_CARD_STYLES);
    accordion.classList.add("ls-switch");
    accordion.items = [
      {
        label: translate("sidebar.letterspacer.bulk.title"),
        open: this.bulkOpen,
        content,
      },
    ];
    accordion.onItemOpenClose = (item, open) => {
      this.bulkOpen = open;
    };
    return accordion;
  }

  _renderHeldMessage() {
    if (this._heldMessageElement) {
      this._heldMessageElement.textContent = this.metricsKeyHeldMessage;
      this._heldMessageElement.hidden = !this.metricsKeyHeldMessage;
    }
  }

  _updateCalculatedValueCells() {
    if (this._currentLCell) {
      this._currentLCell.textContent = this.formatValue(this.currentLSB);
    }
    if (this._currentRCell) {
      this._currentRCell.textContent = this.formatValue(this.currentRSB);
    }
    if (this._calculatedLCell) {
      this._calculatedLCell.textContent = this.formatValue(this.calculatedLSB);
    }
    if (this._calculatedRCell) {
      this._calculatedRCell.textContent = this.formatValue(this.calculatedRSB);
    }
  }

  async setAlgorithmEnabled(enabled) {
    const nextValue = !!enabled;
    if (this.algorithmEnabled === nextValue) {
      return;
    }
    this.algorithmEnabled = nextValue;
    if (!this.algorithmEnabled) {
      this.calculatedLSB = null;
      this.calculatedRSB = null;
      this.clearVisualizationData();
    }
    await this.persistAlgorithmEnabled(nextValue);
    await this.refreshDesignspacePanel();
    await this.update();
  }

  async update(senderInfo) {
    if (!this.card.offsetParent) return;
    await this.fontController.ensureInitialized;

    this._suppressPersist = true;
    try {
      await this.loadAlgorithmEnabled();
      await this.loadMayReplaceMetricsKeys();
      await this.updateMetricsKeyHeldMessage();
      if (this.algorithmEnabled) {
        await this.loadPersistedParams();
        // The Current row must always read the glyph's actual sidebearings,
        // not just after a Calculate press -- refresh it on every rebuild
        // (glyph switch, panel open, edit) the same way Calculate does.
        await this.updateCurrentValues();
      }
      this.hasCurrentMaster = this.algorithmEnabled
        ? await this.hasCurrentMasterForGlyph()
        : false;

      const children = [this._buildHeader()];
      if (this.algorithmEnabled) {
        this._heldMessageElement = html.div({ class: "metrics-label" }, []);
        this._renderHeldMessage();
        children.push(
          html.div({ class: "metrics-stack ls-body" }, [
            this._buildAreaDepthOvershootRow(),
            this._labeled("reference glyph", this._buildReferenceField()),
            html.div({ class: "metrics-group" }, [
              this._buildCalculatedTable(),
              this._buildActionRow(),
            ]),
            this._heldMessageElement,
          ]),
          this._buildBatchApply()
        );
      }
      this.card.classList.toggle("ls-card--off", !this.algorithmEnabled);
      this.card.replaceChildren(...children);
    } finally {
      this._suppressPersist = false;
    }

    if (this.algorithmEnabled) {
      this.updateValueDisplay();
    }
  }

  // A ui/label/XS caption over its control, 4px apart.
  _labeled(label, control) {
    return html.div({ class: "metrics-group" }, [
      html.span({ class: "metrics-label" }, [label]),
      control,
    ]);
  }

  updateValueDisplay() {
    // Update the calculated-table cells in place, without rebuilding the form.
    this._updateCalculatedValueCells();
  }

  clearVisualizationData() {
    const sceneModel =
      this.editorController.sceneController?.sceneModel ||
      this.editorController.sceneModel;
    if (sceneModel?.letterspacerVisualizationData) {
      sceneModel.letterspacerVisualizationData = null;
    }
    if (this.editorController.canvasController) {
      this.editorController.canvasController.requestUpdate();
    }
  }

  async updateCurrentValues() {
    const positionedGlyph =
      this.sceneController.sceneModel.getSelectedPositionedGlyph();
    if (!positionedGlyph) return false;

    const path = positionedGlyph.glyph.path;
    const bounds = path.getBounds?.() || path.getControlBounds?.();
    if (!bounds) return false;

    this.currentLSB = Math.round(bounds.xMin);
    this.currentRSB = Math.round(positionedGlyph.glyph.xAdvance - bounds.xMax);
    return true;
  }

  async applySpacing() {
    if (!this.algorithmEnabled) {
      return;
    }
    if (!(await this.hasCurrentMasterForGlyph())) {
      return;
    }
    this.visualizationOpacity = 1;
    const positionedGlyph =
      this.sceneController.sceneModel.getSelectedPositionedGlyph();
    if (!positionedGlyph) return;

    const fontMetrics = await this.getFontMetrics();
    const glyphName = this.getSelectedGlyphName() || positionedGlyph.glyphName;
    const { referenceGlyph, factor } = this.getReferenceSettings(glyphName);
    const referenceGlyphController = referenceGlyph
      ? await this.fontController.getGlyph(referenceGlyph)
      : null;
    const engine = new LetterspacerEngine(this.params, fontMetrics);

    // Store calculated values from the edit operation
    let calculatedLSB = null;
    let calculatedRSB = null;

    await this.sceneController.editGlyphAndRecordChanges(
      (glyph) => {
        const layerGlyphs = this.sceneController.getEditingLayerFromGlyphLayers(
          glyph.layers
        );
        const replacedShared = { left: false, right: false };

        for (const [layerName, layerGlyph] of Object.entries(layerGlyphs)) {
          const bounds =
            layerGlyph.path.getBounds?.() || layerGlyph.path.getControlBounds?.();
          if (!bounds) continue;

          const refBounds = this.getReferenceBoundsForLayer(
            referenceGlyph,
            referenceGlyphController,
            layerName,
            layerGlyph,
            fontMetrics,
            glyphName
          );

          const { keyed, skip } = this.metricsKeySkipSides(glyph, layerGlyph);
          const applied = this.applySpacingToLayerGlyph(
            layerGlyph,
            engine,
            refBounds,
            factor,
            skip
          );
          if (applied) {
            calculatedLSB = applied.lsb;
            calculatedRSB = applied.rsb;
            this.replaceMetricsKeysOnLayer(
              glyph,
              layerGlyph,
              applied,
              keyed,
              replacedShared
            );
          }
        }

        // Shared keys are glyph-level: remove them once, not per layer.
        for (const side of ["left", "right"]) {
          if (replacedShared[side]) {
            deleteSidebearingKey(glyph, side);
          }
        }

        return "letterspacer";
      },
      undefined,
      true
    );

    // Update the stored calculated values
    this.calculatedLSB = calculatedLSB;
    this.calculatedRSB = calculatedRSB;

    // Update current values from the modified glyph
    const path = positionedGlyph.glyph.path;
    const bounds = path.getBounds?.() || path.getControlBounds?.();
    if (bounds) {
      this.currentLSB = Math.round(bounds.xMin);
      this.currentRSB = Math.round(positionedGlyph.glyph.xAdvance - bounds.xMax);
    }

    // Update value display without rebuilding the form
    this.updateValueDisplay();

    if (this.editorController.sceneModel) {
      this.editorController.sceneModel.letterspacerVisualizationData =
        await this.getVisualizationData();
      if (this.editorController.canvasController) {
        this.editorController.canvasController.requestUpdate();
      }
    }

    // Force interpolation status to refresh after edits
    const mappedLocation = this.sceneController.sceneSettings.fontLocationSourceMapped;
    if (mappedLocation) {
      this.sceneSettingsController.setItem(
        "fontLocationSourceMapped",
        { ...mappedLocation },
        { senderID: this }
      );
    }

    await this.refreshDesignspacePanel();
    await this.update();
  }

  // The glyphsets the project has already added, plus the font's own glyphs as
  // the default. Same primitives the kerning view's glyphset filter uses, and
  // like it this panel does not offer an "add glyphset" UI of its own.
  getBulkGlyphsetOptions() {
    if (!this.bulkGlyphsetsController) {
      this.bulkGlyphsetSettingsController = new ObservableController({
        projectGlyphSets: readProjectGlyphSets(this.fontController),
        myGlyphSets: getMyGlyphSets(),
        projectGlyphSetSelection: [],
        myGlyphSetSelection: [],
      });
      this.bulkGlyphsetsController = new GlyphSetsController(
        this.fontController,
        this.bulkGlyphsetSettingsController
      );
    }
    const settings = this.bulkGlyphsetSettingsController.model;
    const options = [
      { value: "", label: translate("sidebar.letterspacer.bulk.this-font") },
    ];
    for (const info of Object.values({
      ...settings.projectGlyphSets,
      ...settings.myGlyphSets,
    })) {
      // THIS_FONTS_GLYPHSET ("") already is the first option above.
      if (info.url === THIS_FONTS_GLYPHSET) {
        continue;
      }
      options.push({ value: info.url, label: info.name });
    }
    return options;
  }

  // Which glyph names the bulk apply will touch: the selected glyphset, kept to
  // the glyphs this font actually has, then kept to the checked subsets.
  async getBulkGlyphNames() {
    let glyphNames;
    if (this.bulkGlyphsetId) {
      this.getBulkGlyphsetOptions();
      const entries =
        (await this.bulkGlyphsetsController.loadGlyphSet(this.bulkGlyphsetId)) || [];
      // ponytail: membership by the glyphset's own literal glyph name, the same
      // simplification the kerning view's glyphset filter makes.
      glyphNames = entries
        .map((entry) => entry.glyphName)
        .filter((glyphName) => glyphName in this.fontController.glyphMap);
    } else {
      glyphNames = Object.keys(this.fontController.glyphMap);
    }
    return glyphNames.filter((glyphName) => this.glyphIsInCheckedSubset(glyphName));
  }

  glyphIsInCheckedSubset(glyphName) {
    const subset = this.getBulkSubsetForGlyph(glyphName);
    return !!subset && !!this.bulkSubsets[subset];
  }

  // One glyph, one subset. Case comes from the same reading of the name the
  // automatic reference does, so a glyph is bulk-spaced under the same subset
  // whose reference glyph it would be measured against.
  getBulkSubsetForGlyph(glyphName) {
    let glyphInfo = getGlyphInfoFromGlyphName(glyphName);
    if (!glyphInfo && glyphName.includes(".")) {
      glyphInfo = getGlyphInfoFromGlyphName(glyphName.split(".")[0]);
    }
    glyphInfo = glyphInfo || {};
    const subCategory = this.getHtSubCategory(glyphName, glyphInfo);
    switch (glyphInfo.category) {
      case "Letter":
        if (subCategory === "Smallcaps") return "smallcaps";
        if (subCategory === "Uppercase") return "uppercase";
        if (subCategory === "Lowercase") return "lowercase";
        return null;
      case "Number":
        return "numbers";
      case "Punctuation":
        return "punctuation";
      case "Symbol":
        return "symbols";
      case "Mark":
        return "marks";
      default:
        return null;
    }
  }

  // Bulk apply: space every glyph of the selected glyphset that falls in a
  // checked subset, at the source the editor is on. One font-level edit, so the
  // whole run is one undo step -- the same shape the metrics tool uses to write
  // sidebearings on glyphs that are not the selected one.
  async applySpacingToGlyphSet() {
    if (!this.algorithmEnabled || this.fontController.readOnly) {
      return;
    }
    this.bulkStatus = translate("sidebar.letterspacer.bulk.working");
    this.updateBulkStatus();

    const glyphNames = await this.getBulkGlyphNames();
    const fontMetrics = await this.getFontMetrics();
    const sourceLocation = this.sceneController.sceneSettings.fontLocationSourceMapped;
    const engine = new LetterspacerEngine(this.params, fontMetrics);

    const font = { glyphs: {} };
    const targets = [];
    for (const glyphName of glyphNames) {
      const varGlyphController = await this.fontController.getGlyph(glyphName);
      if (!varGlyphController) {
        continue;
      }
      const sourceIndex = varGlyphController.getSourceIndex(sourceLocation);
      const layerName = varGlyphController.sources[sourceIndex]?.layerName;
      // A glyph with no master at this location is left alone, exactly as the
      // single-glyph Apply refuses to run without one.
      if (!layerName || !varGlyphController.glyph.layers[layerName]) {
        continue;
      }
      // The reference is read per glyph: its own stored reference if it has one,
      // else the automatic one for its category. The panel's Reference field
      // belongs to the selected glyph and does not speak for the whole set.
      const stored = (
        getLetterspacerSection(varGlyphController.glyph)?.[
          LETTERSPACER_GLYPH_FIELDS.referenceGlyphName
        ] || ""
      ).trim();
      const { referenceGlyph, factor } = stored
        ? { referenceGlyph: stored, factor: 1 }
        : this.getAutoReferenceSettings(glyphName);
      const referenceGlyphController = referenceGlyph
        ? await this.fontController.getGlyph(referenceGlyph)
        : null;
      font.glyphs[glyphName] = varGlyphController.glyph;
      targets.push({
        glyphName,
        layerName,
        referenceGlyph,
        referenceGlyphController,
        factor,
      });
    }

    let spacedCount = 0;
    const changes = recordChanges(font, (font) => {
      for (const target of targets) {
        const layerGlyph = font.glyphs[target.glyphName].layers[target.layerName].glyph;
        const refBounds = this.getReferenceBoundsForLayer(
          target.referenceGlyph,
          target.referenceGlyphController,
          target.layerName,
          layerGlyph,
          fontMetrics,
          target.glyphName
        );
        const varGlyph = font.glyphs[target.glyphName];
        const { keyed, skip } = this.metricsKeySkipSides(varGlyph, layerGlyph);
        const applied = this.applySpacingToLayerGlyph(
          layerGlyph,
          engine,
          refBounds,
          target.factor,
          skip
        );
        if (applied) {
          spacedCount++;
          const replacedShared = { left: false, right: false };
          this.replaceMetricsKeysOnLayer(
            varGlyph,
            layerGlyph,
            applied,
            keyed,
            replacedShared
          );
          for (const side of ["left", "right"]) {
            if (replacedShared[side]) {
              deleteSidebearingKey(varGlyph, side);
            }
          }
        }
      }
    });

    if (changes.hasChange) {
      await this.fontController.editFinal(
        changes.change,
        changes.rollbackChange,
        "letterspacer: apply to glyph set",
        true
      );
      for (const target of targets) {
        await this.fontController.glyphChanged(target.glyphName, { senderID: this });
      }
    }

    this.bulkStatus = `${spacedCount} / ${glyphNames.length} spaced`;
    this.updateBulkStatus();
    await this.update();
  }

  updateBulkStatus() {
    if (this._bulkStatusElement) {
      this._bulkStatusElement.textContent = this.bulkStatus;
    }
  }

  // Apply skipping a keyed side is the default and it is silent, which reads as
  // Apply being broken. The panel says which side is held and why, standing
  // beside the switch that changes the policy.
  async updateMetricsKeyHeldMessage() {
    this.metricsKeyHeldMessage = "";
    if (this.mayReplaceMetricsKeys) {
      return;
    }
    const varGlyph =
      await this.sceneController.sceneModel.getSelectedVariableGlyphController();
    if (!varGlyph) {
      return;
    }
    const layerName = this.sceneController.sceneSettings.editLayerName;
    const layerGlyph = varGlyph.glyph.layers[layerName]?.glyph;
    const held = {
      left:
        !!this.params.applyLSB &&
        !!getEffectiveMetricsKey(varGlyph.glyph, layerGlyph, "left"),
      right:
        !!this.params.applyRSB &&
        !!getEffectiveMetricsKey(varGlyph.glyph, layerGlyph, "right"),
    };
    if (held.left && held.right) {
      this.metricsKeyHeldMessage = translate(
        "sidebar.letterspacer.metrics-key-held.both"
      );
    } else if (held.left) {
      this.metricsKeyHeldMessage = translate(
        "sidebar.letterspacer.metrics-key-held.left"
      );
    } else if (held.right) {
      this.metricsKeyHeldMessage = translate(
        "sidebar.letterspacer.metrics-key-held.right"
      );
    }
  }

  // Which sides Apply must leave alone on this layer. A keyed side has two
  // writers, and by default the key wins (spec section 4.10). Where the flag
  // allows replacement nothing is skipped and the key is deleted afterwards.
  metricsKeySkipSides(glyph, layerGlyph) {
    const keyed = {
      left: !!getEffectiveMetricsKey(glyph, layerGlyph, "left"),
      right: !!getEffectiveMetricsKey(glyph, layerGlyph, "right"),
    };
    if (this.mayReplaceMetricsKeys) {
      return { keyed, skip: { left: false, right: false } };
    }
    return { keyed, skip: { left: keyed.left, right: keyed.right } };
  }

  // Deletes the keys Apply has just written over, at the level that governs the
  // source. A source override goes with its own layer; a shared key is glyph
  // level and is dropped once, by the caller, after every layer is done.
  replaceMetricsKeysOnLayer(glyph, layerGlyph, wrote, keyed, replacedShared) {
    if (!this.mayReplaceMetricsKeys) {
      return;
    }
    for (const side of ["left", "right"]) {
      if (!wrote[side === "left" ? "wroteLeft" : "wroteRight"] || !keyed[side]) {
        continue;
      }
      const effective = getEffectiveMetricsKey(glyph, layerGlyph, side);
      if (effective?.level === "source") {
        deleteSidebearingKey(layerGlyph, side);
      } else if (effective) {
        replacedShared[side] = true;
      }
    }
  }

  // One layer, one write: compute this layer's spacing and put it on the layer.
  // Both the single-glyph Apply and the bulk Apply go through here, so a change
  // to how spacing lands on a glyph is a change in one place.
  applySpacingToLayerGlyph(
    layerGlyph,
    engine,
    refBounds,
    factor,
    skipSides = { left: false, right: false }
  ) {
    const path = layerGlyph.path;
    const bounds = path.getBounds?.() || path.getControlBounds?.();
    if (!bounds) {
      return null;
    }

    const result = engine.computeSpacing(
      path,
      bounds,
      refBounds.minY,
      refBounds.maxY,
      factor
    );
    if (result.noRefIntersections) {
      return null;
    }

    const { lsb, rsb } = result;
    if (lsb === null || rsb === null) {
      return null;
    }

    const roundedLSB = Math.round(lsb);
    const roundedRSB = Math.round(rsb);
    const currentLSB = bounds.xMin;

    const writeLSB = !!this.params.applyLSB && !skipSides.left;
    const writeRSB = !!this.params.applyRSB && !skipSides.right;

    if (writeLSB) {
      // Round the SHIFT, not just the target: a fractional delta would
      // smear decimals onto every point (and thus onto the RSB)
      const deltaLSB = Math.round(roundedLSB - currentLSB);
      this.shiftPath(layerGlyph.path, deltaLSB);
      // Move the skeleton by the same delta through the one write path
      // (WS-16). editSkeleton regenerates the generated contours from the
      // translated skeleton; because it sets absolute positions, this does
      // not double-shift the contours shiftPath already moved.
      if (deltaLSB && getSkeletonData(layerGlyph)) {
        editSkeleton(layerGlyph, (skeletonData) => {
          const moved = translateSkeletonData(skeletonData, deltaLSB, 0);
          skeletonData.contours = moved.contours;
          skeletonData.nextId = moved.nextId;
        });
      }
    }

    if (writeRSB || writeLSB) {
      const newBounds =
        layerGlyph.path.getBounds?.() || layerGlyph.path.getControlBounds?.();
      if (writeRSB) {
        layerGlyph.xAdvance = Math.round(newBounds.xMax + roundedRSB);
      } else {
        // Preserve the right margin the glyph had before the path moved.
        layerGlyph.xAdvance = Math.round(
          newBounds.xMax + (layerGlyph.xAdvance - bounds.xMax)
        );
      }
    }

    return {
      lsb: roundedLSB,
      rsb: roundedRSB,
      wroteLeft: writeLSB,
      wroteRight: writeRSB,
    };
  }

  async loadPersistedParams() {
    await this.ensureLetterspacerSchema();
    const sourceId = this.getCurrentSourceIdentifier();
    const activeSourceIds = await this.getCurrentGlyphSourceIdentifiers();
    const effectiveSourceId = this.getEffectiveSourceIdentifier(
      sourceId,
      activeSourceIds
    );
    if (effectiveSourceId && this.fontController.sources[effectiveSourceId]) {
      const values = getSourceLetterspacerValues(
        this.fontController.sources[effectiveSourceId]
      );
      this.params.area = coerceNumber(
        values.area,
        this.params.area ?? LETTERSPACER_DEFAULTS.area
      );
      this.params.depth = coerceNumber(
        values.depth,
        this.params.depth ?? LETTERSPACER_DEFAULTS.depth
      );
      this.params.overshoot = coerceNumber(
        values.overshoot,
        this.params.overshoot ?? LETTERSPACER_DEFAULTS.overshoot
      );
    } else {
      this.params.overshoot = this.params.overshoot ?? LETTERSPACER_DEFAULTS.overshoot;
    }

    const referenceValue = await this.getGlyphReferenceValue();
    this.params.referenceGlyph =
      typeof referenceValue === "string"
        ? referenceValue
        : LETTERSPACER_DEFAULTS.referenceGlyph;
  }

  async loadAlgorithmEnabled() {
    const value = getLetterspacerSection(this.fontController)?.[
      LETTERSPACER_FONT_FIELDS.enabled
    ];
    if (value === undefined || value === null) {
      return;
    }
    this.algorithmEnabled = !!value;
  }

  async persistAlgorithmEnabled(enabled) {
    if (this.fontController.readOnly) {
      return;
    }
    const nextValue = !!enabled;
    const root = { customData: this.fontController.customData || {} };
    const changes = recordChanges(root, (root) => {
      setFontLetterspacerEnabled(root, nextValue);
    });
    if (changes.hasChange) {
      await this.fontController.postChange(
        changes.change,
        changes.rollbackChange,
        "edit letterspacer enabled",
        this
      );
    }
  }

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
      setFontMayReplaceMetricsKeys(root, nextValue);
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

  getCurrentSourceIdentifier() {
    const mappedLocation =
      this.sceneController.sceneSettings.fontLocationSourceMapped || {};
    const sourceLocation = this.sceneController.sceneSettings.fontLocationSource || {};
    const hasMappedKeys = Object.keys(mappedLocation).length > 0;
    const location = hasMappedKeys ? mappedLocation : sourceLocation;
    return (
      this.fontController.fontSourcesInstancer?.getSourceIdentifierForLocation(
        location
      ) || this.fontController.defaultSourceIdentifier
    );
  }

  async getCurrentGlyphSourceIdentifiers() {
    const positionedGlyph =
      this.sceneController.sceneModel.getSelectedPositionedGlyph();
    let varGlyph = positionedGlyph?.varGlyph;
    if (!varGlyph) {
      varGlyph =
        await this.sceneController.sceneModel.getSelectedVariableGlyphController();
    }
    if (!varGlyph?.sources) {
      return [];
    }
    const ids = new Set();
    for (const source of varGlyph.sources) {
      const id = source.locationBase || source.layerName;
      if (id && this.fontController.sources?.[id]) {
        ids.add(id);
      }
    }
    return [...ids];
  }

  getEffectiveSourceIdentifier(sourceId, activeSourceIds) {
    if (!sourceId) {
      return sourceId;
    }
    if (!activeSourceIds?.length || activeSourceIds.includes(sourceId)) {
      return sourceId;
    }
    return this.getNearestSourceIdentifier(sourceId, activeSourceIds) || sourceId;
  }

  getSourceLocationForId(sourceId) {
    const source = this.fontController.sources[sourceId];
    if (!source)
      return this.fontController.fontSourcesInstancer?.defaultSourceLocation || {};
    const base = this.fontController.fontSourcesInstancer?.defaultSourceLocation || {};
    return { ...base, ...source.location };
  }

  getLetterspacerValuesForSource(sourceId) {
    const source = this.fontController.sources[sourceId];
    return getSourceLetterspacerValues(source);
  }

  getNearestSourceIdentifier(targetId, candidateIds) {
    if (!candidateIds.length) return undefined;
    const axes = this.fontController.fontAxesSourceSpace || [];
    const targetLoc = this.getSourceLocationForId(targetId);
    const defaultId = this.fontController.defaultSourceIdentifier;
    let bestId = undefined;
    let bestDist = Infinity;
    for (const id of candidateIds) {
      if (id === targetId) continue;
      const loc = this.getSourceLocationForId(id);
      let sum = 0;
      for (const axis of axes) {
        const a = targetLoc[axis.name] ?? axis.defaultValue ?? 0;
        const b = loc[axis.name] ?? axis.defaultValue ?? 0;
        const d = a - b;
        sum += d * d;
      }
      const dist = Math.sqrt(sum);
      if (
        dist < bestDist - 1e-9 ||
        (Math.abs(dist - bestDist) < 1e-9 && id === defaultId)
      ) {
        bestDist = dist;
        bestId = id;
      }
    }
    if (!bestId && candidateIds.includes(defaultId)) {
      bestId = defaultId;
    }
    return bestId ?? candidateIds[0];
  }

  getMissingLetterspacerValues(sourceIds) {
    const sources = this.fontController.sources || {};
    const idsToCheck =
      Array.isArray(sourceIds) && sourceIds.length
        ? sourceIds.filter((id) => sources[id])
        : Object.keys(sources);
    const hasKeys = (source) => hasCompleteSourceLetterspacerValues(source);
    const candidateIds = idsToCheck.filter((id) => hasKeys(sources[id]));
    const missing = {};
    for (const id of idsToCheck) {
      const source = sources[id];
      if (hasKeys(source)) {
        continue;
      }
      const nearestId = this.getNearestSourceIdentifier(id, candidateIds);
      const values = nearestId
        ? this.getLetterspacerValuesForSource(nearestId)
        : { ...LETTERSPACER_DEFAULTS };
      missing[id] = values;
    }
    return missing;
  }

  async ensureLetterspacerSchema() {
    if (this.fontController.readOnly || this._ensuringSchema) {
      return;
    }
    const activeSourceIds = await this.getCurrentGlyphSourceIdentifiers();
    if (!activeSourceIds.length) {
      return;
    }
    const missing = this.getMissingLetterspacerValues(activeSourceIds);
    const missingIds = Object.keys(missing);
    if (!missingIds.length) {
      return;
    }
    this._ensuringSchema = true;
    try {
      const root = { sources: this.fontController.sources };
      const changes = recordChanges(root, (root) => {
        for (const id of missingIds) {
          const source = root.sources[id];
          if (!source) {
            continue;
          }
          setSourceLetterspacerValues(source, {
            area: missing[id].area,
            depth: missing[id].depth,
            overshoot: missing[id].overshoot,
          });
        }
      });
      if (changes.hasChange) {
        await this.fontController.postChange(
          changes.change,
          changes.rollbackChange,
          "init letterspacer schema",
          this
        );
      }
    } finally {
      this._ensuringSchema = false;
    }
  }

  async persistParam(key, value) {
    if (key === "referenceGlyph") {
      await this.persistGlyphReference(value);
      return;
    }
    if (key === "area" || key === "depth" || key === "overshoot") {
      const sourceId = this.getCurrentSourceIdentifier();
      const activeSourceIds = await this.getCurrentGlyphSourceIdentifiers();
      const effectiveSourceId = this.getEffectiveSourceIdentifier(
        sourceId,
        activeSourceIds
      );
      if (!effectiveSourceId || !this.fontController.sources[effectiveSourceId]) {
        return;
      }
      const targetSourceIds = activeSourceIds.length
        ? activeSourceIds
        : [effectiveSourceId];
      const valueToStore = coerceNumber(value, 0);

      const missing = this.getMissingLetterspacerValues(targetSourceIds);
      const root = { sources: this.fontController.sources };
      const changes = recordChanges(root, (root) => {
        for (const id of targetSourceIds) {
          const source = root.sources[id];
          if (!source) {
            continue;
          }
          // Sources with complete values keep them (2.1: falling back to
          // DEFAULTS here silently reset the two keys not being edited —
          // e.g. reverse persisting "area" wiped the stored depth); the
          // `missing` fills only apply to sources that lacked values.
          const existing = getSourceLetterspacerValues(source);
          const nextValues = {
            area: missing[id]?.area ?? existing.area,
            depth: missing[id]?.depth ?? existing.depth,
            overshoot: missing[id]?.overshoot ?? existing.overshoot,
          };
          if (id === effectiveSourceId) {
            nextValues[key] = valueToStore;
          }
          setSourceLetterspacerValues(source, nextValues);
        }
      });
      if (changes.hasChange) {
        await this.fontController.postChange(
          changes.change,
          changes.rollbackChange,
          `edit letterspacer ${key}`,
          this
        );
      }
    }
  }

  async getGlyphReferenceValue() {
    const varGlyph = await this.getSelectedVarGlyph();
    return getLetterspacerSection(varGlyph?.glyph)?.[
      LETTERSPACER_GLYPH_FIELDS.referenceGlyphName
    ];
  }

  async persistGlyphReference(value) {
    const glyphName =
      this.getSelectedGlyphName() ||
      this.sceneController.sceneModel?.getSelectedPositionedGlyph?.()?.glyphName;
    if (!glyphName) {
      return;
    }
    const nextValue = String(value ?? "");
    await this.sceneController.editNamedGlyphAndRecordChanges(glyphName, (glyph) => {
      const existing =
        getLetterspacerSection(glyph)?.[LETTERSPACER_GLYPH_FIELDS.referenceGlyphName];
      if (existing === nextValue) {
        return "edit letterspacer reference";
      }
      setGlyphLetterspacerReference(glyph, nextValue);
      return "edit letterspacer reference";
    });
  }

  async getSelectedVarGlyph() {
    const positionedGlyph =
      this.sceneController.sceneModel?.getSelectedPositionedGlyph?.();
    if (positionedGlyph?.varGlyph) {
      return positionedGlyph.varGlyph;
    }
    if (this.sceneController.sceneModel?.getSelectedVariableGlyphController) {
      return await this.sceneController.sceneModel.getSelectedVariableGlyphController();
    }
    return null;
  }

  async reverseSpacing(event) {
    if (!this.algorithmEnabled) {
      return;
    }
    if (!(await this.hasCurrentMasterForGlyph())) {
      return;
    }
    const guardInfo = await this.getReverseGuardInfo();
    if (guardInfo.shouldGuard && this.doubleCheckReverse && !this.reverseWarningArmed) {
      this.reverseWarningArmed = true;
      this.reverseWarningMessage = guardInfo.message;
      this.showReverseWarningTooltip(event?.currentTarget, guardInfo.message);
      return;
    }
    this.reverseWarningArmed = false;
    this.reverseWarningMessage = "";
    this.hideReverseWarningTooltip();

    const positionedGlyph =
      this.sceneController.sceneModel.getSelectedPositionedGlyph();
    if (!positionedGlyph) return;

    const fontMetrics = await this.getFontMetrics();
    const glyphName = this.getSelectedGlyphName() || positionedGlyph.glyphName;
    const { factor } = this.getReferenceSettings(glyphName);
    const path = positionedGlyph.glyph.path;
    const bounds = path.getBounds?.() || path.getControlBounds?.();
    if (!bounds) return;

    const currentLSB = bounds.xMin;
    const currentRSB = positionedGlyph.glyph.xAdvance - bounds.xMax;

    const freq = 5;
    const minY = bounds.yMin;
    const maxY = bounds.yMax;
    const amplitudeY = maxY - minY;
    if (amplitudeY === 0) return;

    const reverseEngine = new LetterspacerEngine(this.params, fontMetrics);
    const margins = reverseEngine.collectMargins(path, bounds, minY, maxY, freq);

    if (!margins.leftMargins || !margins.rightMargins) {
      return;
    }

    const maxDepth = (fontMetrics.xHeight * this.params.depth) / 100;
    const processedLeft = setDepth(
      margins.leftMargins,
      margins.leftExtreme,
      maxDepth,
      true
    );
    const processedRight = setDepth(
      margins.rightMargins,
      margins.rightExtreme,
      maxDepth,
      false
    );

    if (processedLeft.length < 2 || processedRight.length < 2) {
      return;
    }

    const leftPolygon = closePolygon(processedLeft, margins.leftExtreme, minY, maxY);
    const rightPolygon = closePolygon(processedRight, margins.rightExtreme, minY, maxY);

    const areaLeft = polygonArea(leftPolygon);
    const areaRight = polygonArea(rightPolygon);

    const targetAreaLeft = computeTargetAreaFromSidebearing(
      areaLeft,
      currentLSB,
      amplitudeY
    );
    const targetAreaRight = computeTargetAreaFromSidebearing(
      areaRight,
      currentRSB,
      amplitudeY
    );

    const paramAreaLeft = computeParamAreaFromTargetArea(
      targetAreaLeft,
      fontMetrics,
      amplitudeY,
      factor
    );
    const paramAreaRight = computeParamAreaFromTargetArea(
      targetAreaRight,
      fontMetrics,
      amplitudeY,
      factor
    );

    const averagedArea = (paramAreaLeft + paramAreaRight) / 2;
    this.params.area = Math.max(50, Math.min(2000, Math.round(averagedArea)));
    await this.persistParam("area", this.params.area);

    const finalEngine = new LetterspacerEngine(this.params, fontMetrics);
    const result = finalEngine.computeSpacing(path, bounds, minY, maxY, factor);
    if (result.lsb !== null && result.rsb !== null) {
      this.calculatedLSB = Math.round(result.lsb);
      this.calculatedRSB = Math.round(result.rsb);
    }

    await this.update();
    this.updateValueDisplay();

    if (this.editorController.sceneController?.sceneModel) {
      this.editorController.sceneModel.letterspacerVisualizationData =
        await this.getVisualizationData();
    }
    if (this.editorController.canvasController) {
      this.editorController.canvasController.requestUpdate();
    }
  }

  shiftPath(path, deltaX) {
    const coords = path.coordinates;
    for (let i = 0; i < coords.length; i += 2) {
      coords[i] += deltaX;
    }
  }

  async getFontMetrics() {
    const fontSource = this.fontController.fontSourcesInstancer?.fontSourceAtLocation?.(
      this.sceneController.sceneSettings.fontLocationSourceMapped
    );
    const lineMetrics = fontSource?.lineMetricsHorizontalLayout || {};

    return {
      upm: this.fontController.unitsPerEm,
      xHeight: lineMetrics.xHeight?.value || this.fontController.unitsPerEm * 0.5,
      italicAngle: fontSource?.italicAngle || 0,
    };
  }

  getSelectedGlyphName() {
    return (
      this.sceneController.sceneModel?.getSelectedGlyphName?.() ??
      this.sceneController.sceneSettings?.selectedGlyphName
    );
  }

  getReferenceSettings(glyphName) {
    const manualReference = (this.params.referenceGlyph || "").trim();
    if (manualReference) {
      return { referenceGlyph: manualReference, factor: 1 };
    }
    return this.getAutoReferenceSettings(glyphName);
  }

  getAutoReferenceSettings(glyphName) {
    if (!glyphName) {
      return { referenceGlyph: "", factor: 1 };
    }
    let glyphInfo = getGlyphInfoFromGlyphName(glyphName);
    if (!glyphInfo && glyphName.includes(".")) {
      const baseName = glyphName.split(".")[0];
      glyphInfo = getGlyphInfoFromGlyphName(baseName);
    }
    glyphInfo = glyphInfo || {};
    const category = glyphInfo.category;
    const script = glyphInfo.script;
    const subCategory = this.getHtSubCategory(glyphName, glyphInfo);

    let match = null;
    for (const rule of HT_REFERENCE_RULES) {
      if (
        !matchesRuleField(rule.script, script) ||
        !matchesRuleField(rule.category, category) ||
        !matchesRuleField(rule.subCategory, subCategory)
      ) {
        continue;
      }

      if (!match) {
        match = rule;
        continue;
      }

      if (rule.filter && rule.filter !== "*" && glyphName.includes(rule.filter)) {
        match = rule;
      }
    }

    if (!match) {
      return { referenceGlyph: glyphName, factor: 1 };
    }

    const referenceGlyph = match.reference === "*" ? glyphName : match.reference;
    return {
      referenceGlyph: referenceGlyph || glyphName,
      factor: Number(match.factor) || 1,
    };
  }

  getHtSubCategory(glyphName, glyphInfo) {
    const suffixes =
      glyphName
        ?.split(".")
        .slice(1)
        .map((item) => item.toLowerCase()) || [];
    if (
      suffixes.includes("sc") ||
      suffixes.includes("smcp") ||
      suffixes.includes("c2sc")
    ) {
      return "Smallcaps";
    }

    if (glyphInfo?.subCategory) {
      return glyphInfo.subCategory;
    }

    const caseValue = glyphInfo?.case;
    if (!caseValue) {
      return undefined;
    }

    const normalized = String(caseValue).toLowerCase();
    if (normalized === "upper") return "Uppercase";
    if (normalized === "lower") return "Lowercase";
    if (normalized === "smallcaps") return "Smallcaps";

    return undefined;
  }

  getLayerBounds(layerGlyph) {
    if (!layerGlyph) {
      return null;
    }
    const path = layerGlyph.path;
    return path?.getBounds?.() || path?.getControlBounds?.() || null;
  }

  getReferenceBoundsForLayer(
    referenceGlyphName,
    referenceGlyphController,
    sourceId,
    layerGlyph,
    fontMetrics,
    glyphName
  ) {
    const overshoot = (fontMetrics.xHeight * this.params.overshoot) / 100;
    const fallbackBounds = this.getLayerBounds(layerGlyph);

    if (referenceGlyphName && referenceGlyphController?.layers) {
      const refLayer =
        referenceGlyphController.layers[sourceId] ||
        Object.values(referenceGlyphController.layers)[0];
      const refBounds = this.getLayerBounds(refLayer?.glyph);
      if (refBounds) {
        return {
          minY: refBounds.yMin - overshoot,
          maxY: refBounds.yMax + overshoot,
          referenceGlyph: referenceGlyphName,
        };
      }
    }

    if (referenceGlyphName) {
    }

    if (fallbackBounds) {
      return {
        minY: fallbackBounds.yMin - overshoot,
        maxY: fallbackBounds.yMax + overshoot,
        referenceGlyph: glyphName,
      };
    }

    return {
      minY: -overshoot,
      maxY: fontMetrics.xHeight + overshoot,
      referenceGlyph: glyphName,
    };
  }

  async toggle(on, focus) {
    // forkra's sceneController is not an EventTarget and never dispatches
    // "selectionChanged"; selection changes surface through the scene settings
    // controller instead (same mechanism used for refreshPersistedParams).
    if (on) {
      this.update();
      this.sceneSettingsController.addKeyListener(
        ["selection"],
        this.handleSelectionChangeBound
      );
    } else {
      this.sceneSettingsController.removeKeyListener(
        ["selection"],
        this.handleSelectionChangeBound
      );
    }
  }

  async handleSelectionChange() {
    this.clearVisualizationData();
  }

  async refreshPersistedParams() {
    if (!this.card.offsetParent) {
      return;
    }
    await this.update();
  }

  async clearVisualization() {
    if (!this.algorithmEnabled) {
      this.clearVisualizationData();
      return;
    }
    // Fade the visualization when glyph is edited (until Calculate/Apply)
    this.visualizationOpacity = 0.2;
    const sceneModel = this.editorController.sceneController?.sceneModel;
    if (sceneModel?.letterspacerVisualizationData) {
      sceneModel.letterspacerVisualizationData = {
        ...sceneModel.letterspacerVisualizationData,
        opacity: this.visualizationOpacity,
      };
    }
    if (this.editorController.canvasController) {
      this.editorController.canvasController.requestUpdate();
    }

    await this.refreshDesignspacePanel();
    await this.update();
  }

  formatValue(value) {
    // Format spacing value for display
    if (value === null || value === undefined) return "-";
    return Math.round(value);
  }

  async updateCalculatedValues({ warnOnNoRef = false } = {}) {
    // Update current and calculated spacing values
    const positionedGlyph =
      this.sceneController.sceneModel.getSelectedPositionedGlyph();
    if (!positionedGlyph) return;

    const hasBounds = await this.updateCurrentValues();
    if (!hasBounds) return;
    if (!this.algorithmEnabled) return;

    // Calculate new values using letterspacer
    const path = positionedGlyph.glyph.path;
    const bounds = path.getBounds?.() || path.getControlBounds?.();
    if (!bounds) return;

    const fontMetrics = await this.getFontMetrics();
    const glyphName = this.getSelectedGlyphName() || positionedGlyph.glyphName;
    const { referenceGlyph, factor } = this.getReferenceSettings(glyphName);
    const referenceGlyphController = referenceGlyph
      ? await this.fontController.getGlyph(referenceGlyph)
      : null;
    const sourceId = this.getCurrentSourceIdentifier();
    const refBounds = this.getReferenceBoundsForLayer(
      referenceGlyph,
      referenceGlyphController,
      sourceId,
      positionedGlyph.glyph,
      fontMetrics,
      glyphName
    );
    const engine = new LetterspacerEngine(this.params, fontMetrics);
    const result = engine.computeSpacing(
      path,
      bounds,
      refBounds.minY,
      refBounds.maxY,
      factor
    );

    if (result.noRefIntersections) {
      this.calculatedLSB = null;
      this.calculatedRSB = null;
      if (warnOnNoRef) {
      }
      return;
    }

    if (result.lsb !== null && result.rsb !== null) {
      this.calculatedLSB = Math.round(result.lsb);
      this.calculatedRSB = Math.round(result.rsb);
    }
  }

  async calculateSpacing() {
    if (!this.algorithmEnabled) {
      return;
    }
    if (!(await this.hasCurrentMasterForGlyph())) {
      return;
    }
    // Recalculate spacing after glyph edits
    this.visualizationOpacity = 1;
    await this.updateCalculatedValues({ warnOnNoRef: true });
    this.updateValueDisplay();
    await this.update();

    // Refresh visualization
    if (this.editorController.sceneController?.sceneModel) {
      this.editorController.sceneController.sceneModel.letterspacerVisualizationData =
        await this.getVisualizationData();
    }
    if (this.editorController.canvasController) {
      this.editorController.canvasController.requestUpdate();
    }
  }

  getEngine() {
    return this.engine;
  }

  async getVisualizationData() {
    if (!this.algorithmEnabled) {
      return null;
    }
    const positionedGlyph =
      this.sceneController.sceneModel.getSelectedPositionedGlyph();
    if (!positionedGlyph) {
      return null;
    }

    const fontMetrics = await this.getFontMetrics();
    const glyphName = this.getSelectedGlyphName() || positionedGlyph.glyphName;
    const { referenceGlyph, factor } = this.getReferenceSettings(glyphName);
    const referenceGlyphController = referenceGlyph
      ? await this.fontController.getGlyph(referenceGlyph)
      : null;
    const sourceId = this.getCurrentSourceIdentifier();
    const refBounds = this.getReferenceBoundsForLayer(
      referenceGlyph,
      referenceGlyphController,
      sourceId,
      positionedGlyph.glyph,
      fontMetrics,
      glyphName
    );
    const engine = new LetterspacerEngine(this.params, fontMetrics);

    const path = positionedGlyph.glyph.path;
    const bounds = path.getBounds?.() || path.getControlBounds?.();
    if (!bounds) {
      return null;
    }

    const spacingResult = engine.computeSpacing(
      path,
      bounds,
      refBounds.minY,
      refBounds.maxY,
      factor
    );
    if (spacingResult.noRefIntersections) {
      return null;
    }

    const result = {
      opacity: this.visualizationOpacity ?? 1,
      scanLines: engine.scanLines,
      leftPolygon: engine.leftPolygon,
      rightPolygon: engine.rightPolygon,
      leftSBPolygon: engine.leftSBPolygon,
      rightSBPolygon: engine.rightSBPolygon,
      leftSBLine: engine.leftSBLine,
      rightSBLine: engine.rightSBLine,
      lsb: engine.lsb,
      rsb: engine.rsb,
      leftExtreme: engine.leftExtreme,
      rightExtreme: engine.rightExtreme,
      leftDepthLimit: engine.leftDepthLimit,
      rightDepthLimit: engine.rightDepthLimit,
      leftExtremeDepthLimited: engine.leftExtremeDepthLimited,
      rightExtremeDepthLimited: engine.rightExtremeDepthLimited,
      leftMargins: engine.leftMargins,
      rightMargins: engine.rightMargins,
      leftMarginsProcessed: engine.leftMarginsProcessed,
      rightMarginsProcessed: engine.rightMarginsProcessed,
      params: this.params,
      referenceBounds: { minY: refBounds.minY, maxY: refBounds.maxY },
    };

    return result;
  }

  async hasCurrentMasterForGlyph() {
    const sourceId = this.getCurrentSourceIdentifier();
    if (!sourceId) {
      return false;
    }
    const activeSourceIds = await this.getCurrentGlyphSourceIdentifiers();
    return activeSourceIds.includes(sourceId);
  }

  async refreshDesignspacePanel() {
    const panel = this.editorController.getSidebarPanel?.("designspace-navigation");
    if (panel?.refreshSourcesAndStatus) {
      await panel.refreshSourcesAndStatus();
    }
  }

  async getReverseGuardInfo() {
    const sourceId = this.getCurrentSourceIdentifier();
    const activeSourceIds = await this.getCurrentGlyphSourceIdentifiers();
    const effectiveSourceId = this.getEffectiveSourceIdentifier(
      sourceId,
      activeSourceIds
    );
    if (!effectiveSourceId) {
      return { shouldGuard: false, message: "" };
    }
    const values = this.getLetterspacerValuesForSource(effectiveSourceId);
    if (values.area === LETTERSPACER_DEFAULTS.area) {
      return { shouldGuard: false, message: "" };
    }
    const message =
      "Will apply reverse value across the whole source. Press again to continue.";
    return { shouldGuard: true, message };
  }

  showReverseWarningTooltip(anchor, message) {
    if (!anchor || !message) {
      return;
    }
    this.hideReverseWarningTooltip();
    this.reverseWarningTooltip = showArmedTooltip(anchor, message);
  }

  hideReverseWarningTooltip() {
    if (this.reverseWarningTooltip) {
      this.reverseWarningTooltip();
      this.reverseWarningTooltip = null;
    }
  }
}

customElements.define("panel-letterspacer", LetterspacerPanel);

// The letterspacer card's own parts: the settings overflow (Figma 4108:3038),
// the checkmarks (Figma 379:22544, our checkbox assets), the static table
// (Figma 4108:2787) and the batch apply switch (Figma 4108:2102).
const LETTERSPACER_CARD_STYLES = `
  /* Hosted in the metrics panel's column: as tall as its card. */
  .panel {
    height: auto;
  }

  .metrics-card {
    gap: 10px;
  }

  /* Off, the card is the heading alone, 12px all round. */
  .metrics-card.ls-card--off {
    padding-bottom: 12px;
  }

  .metrics-grow {
    flex: 1 1 auto;
  }

  .ls-body {
    padding-bottom: 4px;
  }

  .settings-card {
    display: flex;
    flex-direction: column;
    min-width: 180px;
  }

  /* ui/heading/h4 */
  .settings-card-heading {
    padding: 10px 12px;
    border-bottom: 1px solid var(--line-base-basic-1);
    font: var(--ui-text-heading-h4);
    letter-spacing: var(--ui-tracking);
    text-transform: uppercase;
    color: var(--text-base-basic-3);
  }

  .settings-card-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 12px 16px;
  }

  .ls-table {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border: 1px solid var(--line-base-basic-1);
    border-radius: 6px;
  }

  /* ui/label/S; every row but the last ruled under. */
  .ls-cell {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 8px;
    box-sizing: border-box;
    overflow: hidden;
    white-space: nowrap;
    font: var(--ui-text-label-s);
    letter-spacing: var(--ui-tracking);
    font-feature-settings: "case" 1;
    color: var(--text-base-basic-3);
  }

  .ls-cell:nth-child(-n + 6) {
    border-bottom: 1px solid var(--line-base-basic-1);
  }

  .ls-value {
    color: var(--text-base-basic-2);
  }

  /* ui/heading/h4 */
  .ls-side {
    font: var(--ui-text-heading-h4);
    letter-spacing: var(--ui-tracking);
    text-transform: uppercase;
  }

  .ls-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
  }

  .ls-actions-group {
    display: flex;
    gap: 4px;
  }

  /* The switch runs to the card's edges. */
  .ls-switch {
    margin: 0 -8px;
  }

  .ls-batch {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .checkmark-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 12px;
    padding: 8px 0 10px;
  }

  ${CHECKMARK_STYLES}
`;

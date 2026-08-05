import { recordChanges } from "@fontra/core/change-recorder.js";
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { isScrubCancelled } from "@fontra/core/number-scrub.js";
import { MAX_TIP_CUT_ANGLE } from "@fontra/core/serif-geometry.js";
import { SERIF_HALF_DEFAULTS } from "@fontra/core/skeleton-generator.js";
import {
  SERIF_HALF_FIELDS,
  SERIF_PRESETS,
  SKELETON_SOURCE_DEFAULT_KEYS,
  VALID_SERIF_AXIS_MODES,
  captureSerifPreset,
  getSkeletonData,
  getSkeletonGlyphCase,
  resolveEffectiveSourceSkeletonDefault,
  setSkeletonCapParameters,
  setSkeletonCornerParameters,
  setSourceSkeletonDefaultsValues,
} from "@fontra/core/skeleton-model.js";
import { throttleCalls } from "@fontra/core/utils.ts";
import { Form } from "@fontra/web-components/ui-form.js";
import Panel from "./panel.js";
import {
  SKELETON_PANEL_SENDER,
  applyPanelSerifPreset,
  nudgePanelCapParameterStream,
  nudgePanelContourDefaultWidthStream,
  nudgePanelPointWidthStream,
  nudgePanelSerifValueStream,
  resetPanelGeneratedHandle,
  resetPanelRibs,
  scalePanelCapParameter,
  scalePanelContourDefaultWidth,
  scalePanelPointWidth,
  scalePanelSerifValue,
  setPanelCapParameters,
  setPanelCapStyle,
  setPanelContourDefaultWidth,
  setPanelContourSingleSided,
  setPanelCornerParameters,
  setPanelPointDistribution,
  setPanelPointDistributionStream,
  setPanelPointLinked,
  setPanelPointSideWidth,
  setPanelPointTied,
  setPanelPointTotalWidth,
  setPanelPointValuesStream,
  setPanelRibAngleLock,
  setPanelRibDetached,
  setPanelRibLocked,
  setPanelSerifParameters,
  setPanelSerifParametersStream,
} from "./skeleton-panel-edits.js";
import {
  collectRibEditTargets,
  collectSkeletonPanelSelection,
  collectWidthEditPoints,
  makeSkeletonPanelStateSignature,
  singleGeneratedHandleTarget,
  summarizeSkeletonCapSelection,
  summarizeSkeletonCapStyleSelection,
  summarizeSkeletonContourSelection,
  summarizeSkeletonCornerSelection,
  summarizeSkeletonPointWidths,
  summarizeSkeletonRibSelection,
  summarizeSkeletonSerifSelection,
} from "./skeleton-panel-model.js";

// Cap parameter UI constants (donor parity: panel-skeleton-parameters.js).
// The round-cap radius slider works in 20 discrete positions mapped
// logarithmically onto the [CAP_RADIUS_MIN, CAP_RADIUS_MAX] ratio range.
const DEFAULT_CAP_RADIUS_RATIO = 1 / 8;
const DEFAULT_CAP_TENSION = 0.55;
const DEFAULT_CAP_ANGLE = 0;
const CAP_RADIUS_MIN = 1 / 128;
const CAP_RADIUS_MAX = 1 / 4;
export const CAP_RADIUS_POSITIONS = 20;
export const CAP_ANGLE_MIN = -85;
export const CAP_ANGLE_MAX = 85;
// Drop (ball terminal) cap: ratio edited as a percent of stroke width.
const DEFAULT_CAP_BALL_RATIO = 1.25;
// The slider stops at 105%: below that the ball is narrower than the stroke and
// there is nothing to read as a bulb. Typing into the field still reaches the
// model's full 50–300% range.
export const CAP_BALL_MIN = 105;
export const CAP_BALL_MAX = 300;
// Ball shape: 0% round -> 100% teardrop, edited as a percent.
const DEFAULT_CAP_BALL_SHAPE = 0;
// The slider stops at 40%: past that the ball attaches so far back that it
// stops reading as a terminal. Typing into the field still reaches 100%.
export const CAP_SHAPE_MIN = 0;
export const CAP_SHAPE_MAX = 40;
// Drop-cap tension can be pushed well past 100% for an extra-smooth waist.
export const CAP_TENSION_DROP_MAX = 300;

export function capRadiusRatioFromIndex(index) {
  const clampedIndex = Math.min(Math.max(index, 0), CAP_RADIUS_POSITIONS - 1);
  const t = clampedIndex / (CAP_RADIUS_POSITIONS - 1);
  const minLog = Math.log2(CAP_RADIUS_MIN);
  const maxLog = Math.log2(CAP_RADIUS_MAX);
  return 2 ** (minLog + t * (maxLog - minLog));
}

export function capRadiusIndexFromRatio(ratio) {
  const clampedRatio = Math.min(Math.max(ratio, CAP_RADIUS_MIN), CAP_RADIUS_MAX);
  const minLog = Math.log2(CAP_RADIUS_MIN);
  const maxLog = Math.log2(CAP_RADIUS_MAX);
  const t = (Math.log2(clampedRatio) - minLog) / (maxLog - minLog);
  return Math.round(t * (CAP_RADIUS_POSITIONS - 1));
}

// Slider-unit -> model-unit conversion, shared by the streaming and the
// final-value paths. The radius slider edits a 1-based log-scale position,
// tension/roundness/reach/strength edit percent.
function capValuesFromField(name, value) {
  if (name === "radius") {
    return { capRadiusRatio: capRadiusRatioFromIndex(Number(value) - 1) };
  }
  if (name === "tension") {
    return { capTension: Number(value) / 100 };
  }
  if (name === "angle") {
    return { capAngle: Number(value) };
  }
  if (name === "distance") {
    return { capDistance: Number(value) };
  }
  if (name === "ball") {
    return { capBallRatio: Number(value) / 100 };
  }
  if (name === "ballshape") {
    return { capBallShape: Number(value) / 100 };
  }
  if (name === "ballside") {
    return { capBallSide: value };
  }
  return null;
}

// A row that packs several inputs onto one line carries them as nested fields,
// and it is those nested fields that own the keys. Flattening the row into its
// parts is what lets both the layout signature and the in-place value refresh
// treat a packed row exactly like the separate rows it replaced — without it,
// every packed row reads as keyless and the section falls back to a full
// rebuild on each edit, which is what loses focus mid-drag.
function formFieldsOf(item) {
  if (item?.type !== "universal-row") {
    return [item];
  }
  // The row itself stays in the list so its own label still counts as layout;
  // it carries no key, so the value refresh skips it.
  return [item, item.field1, item.field2, item.field3].filter((field) => field);
}

// Everything about a set of field descriptions EXCEPT the values. Two form
// contents with the same signature can share one set of DOM inputs, so the panel
// can push new values into the existing form instead of rebuilding it.
export function formContentsLayoutSignature(formContents) {
  return formContents
    .flatMap((item) => formFieldsOf(item))
    .map((item) =>
      [
        item.type,
        item.key ?? "",
        item.label ?? "",
        // A field switching between a real value and "mixed", or gaining a
        // placeholder, changes what the input shows independently of its value,
        // so those belong to the layout rather than to the value.
        item.displayValue ?? "",
        item.placeholder ?? "",
        item.disabled ? "1" : "",
        item.minValue ?? "",
        item.maxValue ?? "",
        item.step ?? "",
        (item.options || []).map((option) => option.value).join(","),
        // Button and dropdown rows carry no key, so they cannot be refreshed in
        // place: their live click handlers close over the values they were built
        // with. Folding their text in makes any change to what they offer count
        // as a layout change, which rebuilds them.
        item.element?.textContent ?? "",
      ].join("")
    )
    .join("");
}

// Ratio-stored fields are edited as percent, like cap tension.
function percentSummary(summary) {
  return {
    value: summary.value == null ? null : Math.round(summary.value * 100),
    mixed: summary.mixed,
  };
}

// Slider/number-unit -> model-unit for one serif half field.
function serifHalfValueFromField(field, value) {
  if (field === "tension" || field === "concavity" || field === "easeCurvature") {
    return Number(value) / 100;
  }
  return Number(value);
}

// A `<scope>-<field>` half-serif field name and its panel-unit value, turned
// into the partial serif object the model mutator takes. Null for anything that
// is not a half field, so the caller can fall through to the shared ones.
function serifHalfValuesFromField(name, value) {
  const [scope, field] = String(name).split("-");
  if (!SERIF_HALF_FIELDS.includes(field)) {
    return null;
  }
  const resolved = value == null ? null : serifHalfValueFromField(field, value);
  const values = {};
  for (const side of scope === "both" ? ["left", "right"] : [scope]) {
    values[side] = { [field]: resolved };
  }
  return values;
}

// Which stored serif numbers one label scrub moves. A field under a linked half
// drives both sides, which is what "linked" means everywhere else in this panel.
function serifNudgeTargets(name) {
  if (name === "cup") {
    return [{ field: "undersideCup" }];
  }
  const [scope, field] = String(name).split("-");
  if (!SERIF_HALF_FIELDS.includes(field)) {
    return [];
  }
  return (scope === "both" ? ["left", "right"] : [scope]).map((side) => ({
    side,
    field,
  }));
}

function cornerValuesFromField(name, value) {
  if (name === "roundness") {
    return { cornerRoundness: Number(value) / 100 };
  }
  if (name === "asymmetry") {
    return { cornerAsymmetry: Number(value) };
  }
  if (name === "reach") {
    return { cornerReach: Number(value) / 100 };
  }
  if (name === "strength") {
    return { roundnessStrength: Number(value) / 100 };
  }
  return null;
}

export default class SkeletonParametersPanel extends Panel {
  identifier = "skeleton-parameters";
  iconPath = "/tabler-icons/bone.svg";

  constructor(editorController) {
    super(editorController);
    this.infoForm = new Form();
    this.contentElement.appendChild(
      html.div(
        { class: "panel-section panel-section--flex panel-section--scrollable" },
        [this.infoForm]
      )
    );
    this.fontController = this.editorController.fontController;
    this.sceneController = this.editorController.sceneController;
    this.sceneSettingsController = this.editorController.sceneSettingsController;

    this._widthSnapshot = null;
    this._widthSnapshotKey = null;
    this._lastSignature = null;
    this._widthProfileSelection = "base";
    // Per-field multiply ratios, kept across rebuilds so a rebuild after Apply
    // does not reset the box the user is working in.
    this._multiplyFactors = {};
    this._capProfileSelection = "base";
    this._serifPresetSelection = null;
    this._serifApplyScope = "both";
    this._forceApplyArmed = null;
    this._confirmTooltip = null;

    this.updateBound = this.update.bind(this);
    // External glyph edits (e.g. dblclick smooth toggle) must refresh the
    // panel's gates immediately; our own field edits already rebuild in
    // _onFieldChange and must NOT trigger a rebuild mid-drag.
    this._suppressGlyphChangeUpdate = false;
    this._throttledGlyphChangeUpdate = throttleCalls(() => {
      this._forceRebuild = true;
      this.update();
    }, 100);
    this.sceneController.addCurrentGlyphChangeListener((event) => {
      // Our own edits already rebuild in _onFieldChange; their async echo
      // (postChange broadcast) must not schedule a second rebuild — the
      // trailing rebuild replaces the slider input the user may already be
      // dragging again and can briefly read not-yet-settled values.
      if (event?.senderID === SKELETON_PANEL_SENDER) {
        return;
      }
      if (!this._suppressGlyphChangeUpdate) {
        this._throttledGlyphChangeUpdate();
      }
    });
    this.sceneSettingsController.addKeyListener(
      [
        "fontLocationSourceMapped",
        "selectedGlyphName",
        "selection",
        "editingLayers",
        "editLayerName",
      ],
      this.updateBound
    );
  }

  getContentElement() {
    return html.div({ class: "panel" }, []);
  }

  async toggle(on) {
    if (on) {
      await this.update();
    }
  }

  // ---- Reading current skeleton state --------------------------------------

  _getPositionedGlyph() {
    return this.sceneController.sceneModel?.getSelectedPositionedGlyph?.() || null;
  }

  // Mirror scene-model._getEditLayerSkeletonData: the panel edits and displays
  // the edit layer, whose ids are canonical for cross-layer resolution (WS-9).
  _getEditLayerSkeletonData(positionedGlyph) {
    if (!positionedGlyph) {
      return null;
    }
    const editLayerName =
      this.sceneSettingsController.model?.editLayerName ||
      positionedGlyph.glyph?.layerName;
    const layerGlyph =
      editLayerName && positionedGlyph.varGlyph?.glyph?.layers?.[editLayerName]?.glyph;
    return getSkeletonData(layerGlyph || positionedGlyph.glyph);
  }

  getSelectedGlyphName() {
    return this.sceneController.sceneSettings?.selectedGlyphName;
  }

  // ---- Source defaults access ----------------------------------------------

  // ---- Panel rebuild --------------------------------------------------------

  async update() {
    // A rebuild while a slider streams would replace the input mid-drag and
    // lock its direction; _onFieldChange rebuilds once the edit completes.
    if (this._suppressGlyphChangeUpdate) {
      return;
    }
    if (!this.infoForm.contentElement.offsetParent) {
      return;
    }
    await this.fontController.ensureInitialized;

    const positionedGlyph = this._getPositionedGlyph();
    const skeletonData = this._getEditLayerSkeletonData(positionedGlyph);
    const glyphName = this.getSelectedGlyphName();
    const panelSelection = collectSkeletonPanelSelection({
      selection: this.sceneController.selection,
      skeletonData,
    });
    this._panelSelection = panelSelection;

    const signature = makeSkeletonPanelStateSignature({
      glyphName,
      editingLayerNames: this.sceneController.editingLayerNames,
      selection: this.sceneController.selection,
      panelSelection: skeletonData ? panelSelection : null,
    });
    if (signature === this._lastSignature && !this._forceRebuild) {
      return;
    }
    this._lastSignature = signature;
    this._forceRebuild = false;
    this._disarmForceApply();

    const formContents = [
      { type: "header", label: translate("sidebar.skeleton-parameters.title") },
    ];

    if (!skeletonData) {
      formContents.push({
        type: "text",
        value: translate("sidebar.skeleton-parameters.no-skeleton"),
      });
      this._lastFormLayout = null;
      this.infoForm.setFieldDescriptions(formContents);
      this.infoForm.onFieldChange = () => {};
      return;
    }

    const widthPoints = collectWidthEditPoints(panelSelection);
    // Ribs fall back to both sides of every resolved point, so the rib
    // parameters show for any skeleton selection (4.10) and the reset buttons
    // cover both of a selected point's ribs (4.11).
    const { ribs: ribTargets, derived: ribsDerived } =
      collectRibEditTargets(panelSelection);
    this._ribTargets = ribTargets;
    if (widthPoints.length) {
      this._buildPointWidthSection(formContents, widthPoints);
    }
    if (panelSelection.contours.length) {
      this._buildContourSection(formContents, panelSelection.contours);
    }
    if (widthPoints.length) {
      this._buildCapSection(formContents, widthPoints);
      this._buildCornerSection(formContents, widthPoints);
    }
    this._singleGeneratedHandle = singleGeneratedHandleTarget(panelSelection);
    if (ribTargets.length) {
      this._buildRibSection(formContents, ribTargets, ribsDerived);
    }

    if (!widthPoints.length && !panelSelection.contours.length && !ribTargets.length) {
      formContents.push({
        type: "text",
        value: translate("sidebar.skeleton-parameters.no-selection"),
      });
    }

    formContents.push({ type: "spacer" });

    this._applyFormContents(formContents);
    this.infoForm.onFieldChange = (fieldItem, value, valueStream) =>
      this._onFieldChange(fieldItem, value, valueStream);
  }

  // Handing the form a new set of field descriptions rebuilds every input from
  // scratch, which throws away focus and any in-flight interaction: an arrow key
  // in a number input applied once and then stopped, and a slider went dead until
  // the selection was cycled. When only the VALUES moved — which is the common
  // case, since editing a parameter is what triggers the update — the existing
  // inputs are still the right ones and just need their values pushed in.
  _applyFormContents(formContents) {
    const layout = formContentsLayoutSignature(formContents);
    if (layout === this._lastFormLayout) {
      for (const item of formContents.flatMap((row) => formFieldsOf(row))) {
        if (item.key == null || !this.infoForm.hasKey(item.key)) {
          continue;
        }
        // Writing back into the input the user just used would fight their next
        // keystroke, and it already holds the value it reported to us — a scrub
        // has been writing the running number into it all along.
        if (item.key === this._activeFieldKey) {
          continue;
        }
        this.infoForm.setValue(item.key, item.value);
      }
      return;
    }
    this._lastFormLayout = layout;
    this.infoForm.setFieldDescriptions(formContents);
  }

  // ---- Master default profiles (force-apply) --------------------------------

  _resolveSourceDefault(key) {
    const location =
      this.sceneController.sceneSettings.fontLocationSourceMapped ||
      this.sceneController.sceneSettings.fontLocationSource ||
      {};
    return resolveEffectiveSourceSkeletonDefault(this.fontController, location, key);
  }

  // Width profile options for the edited glyph's case: the three master
  // defaults plus the master's custom width entries (donor "Profile" select).
  _widthProfileOptions() {
    const isLower = getSkeletonGlyphCase(this.getSelectedGlyphName()) === "lowercase";
    const K = SKELETON_SOURCE_DEFAULT_KEYS;
    const options = [
      {
        id: "base",
        label: translate("sidebar.skeleton-parameters.default-base"),
        value: this._resolveSourceDefault(
          isLower ? K.WIDTH_LOWERCASE_BASE : K.WIDTH_CAPITAL_BASE
        ),
      },
      {
        id: "horizontal",
        label: translate("sidebar.skeleton-parameters.default-horizontal"),
        value: this._resolveSourceDefault(
          isLower ? K.WIDTH_LOWERCASE_HORIZONTAL : K.WIDTH_CAPITAL_HORIZONTAL
        ),
      },
      {
        id: "contrast",
        label: translate("sidebar.skeleton-parameters.default-contrast"),
        value: this._resolveSourceDefault(
          isLower ? K.WIDTH_LOWERCASE_CONTRAST : K.WIDTH_CAPITAL_CONTRAST
        ),
      },
    ];
    const custom = this._resolveSourceDefault(
      isLower ? K.CUSTOM_WIDTHS_LOWERCASE : K.CUSTOM_WIDTHS_UPPERCASE
    );
    if (Array.isArray(custom)) {
      custom.forEach((item, index) => {
        const value = Number(item?.value);
        if (Number.isFinite(value)) {
          options.push({
            id: `custom:${index}`,
            label: item?.name || `Custom ${index + 1}`,
            value,
          });
        }
      });
    }
    return options.filter((option) => Number.isFinite(Number(option.value)));
  }

  // Cap profile options for the active style: master cap defaults plus the
  // master's custom cap profiles. `values` holds the point fields to write.
  _capProfileOptions(styleValue) {
    const K = SKELETON_SOURCE_DEFAULT_KEYS;
    const options = [];
    if (styleValue === "round") {
      options.push({
        id: "base",
        label: translate("sidebar.skeleton-parameters.default-caps"),
        values: {
          capRadiusRatio: Number(this._resolveSourceDefault(K.CAP_RADIUS_RATIO)),
          capTension: Number(this._resolveSourceDefault(K.CAP_TENSION)),
        },
      });
      const custom = this._resolveSourceDefault(K.CUSTOM_CAP_ROUNDED);
      if (Array.isArray(custom)) {
        custom.forEach((item, index) => {
          const radius = Number(item?.radius ?? item?.value);
          let tension = Number(item?.tension);
          if (Number.isFinite(tension) && tension > 1) {
            tension = tension / 100;
          }
          if (Number.isFinite(radius)) {
            options.push({
              id: `custom:${index}`,
              label: item?.name || `Custom ${index + 1}`,
              values: {
                capRadiusRatio: radius,
                capTension: Number.isFinite(tension) ? tension : DEFAULT_CAP_TENSION,
              },
            });
          }
        });
      }
    } else if (styleValue === "square") {
      options.push({
        id: "base",
        label: translate("sidebar.skeleton-parameters.default-caps"),
        values: {
          capAngle: Number(this._resolveSourceDefault(K.CAP_ANGLE)),
          capDistance: Number(this._resolveSourceDefault(K.CAP_DISTANCE)),
        },
      });
      const custom = this._resolveSourceDefault(K.CUSTOM_CAP_SQUARE);
      if (Array.isArray(custom)) {
        custom.forEach((item, index) => {
          const angle = Number(item?.angle ?? item?.value);
          const distance = Number(item?.distance);
          if (Number.isFinite(angle)) {
            options.push({
              id: `custom:${index}`,
              label: item?.name || `Custom ${index + 1}`,
              values: {
                capAngle: angle,
                capDistance: Number.isFinite(distance) ? distance : 0,
              },
            });
          }
        });
      }
    } else if (styleValue === "drop") {
      options.push({
        id: "base",
        label: translate("sidebar.skeleton-parameters.default-caps"),
        values: {
          capBallRatio: DEFAULT_CAP_BALL_RATIO,
          capTension: Number(this._resolveSourceDefault(K.CAP_TENSION)),
        },
      });
    }
    return options;
  }

  // Two-click confirm (letterspacer reverse pattern): first click arms the
  // button and shows a tooltip, second click applies.
  _confirmThenApply(event, armKey, apply) {
    if (this._forceApplyArmed !== armKey) {
      this._forceApplyArmed = armKey;
      this._showConfirmTooltip(
        event?.currentTarget,
        translate("sidebar.skeleton-parameters.force-apply.confirm")
      );
      return;
    }
    this._forceApplyArmed = null;
    this._hideConfirmTooltip();
    apply();
  }

  _disarmForceApply() {
    this._forceApplyArmed = null;
    this._hideConfirmTooltip();
  }

  _showConfirmTooltip(anchor, message) {
    this._hideConfirmTooltip();
    if (!anchor || !message) {
      return;
    }
    const tooltip = html.div({}, [message]);
    Object.assign(tooltip.style, {
      position: "fixed",
      zIndex: "9999",
      maxWidth: "220px",
      padding: "8px 10px",
      borderRadius: "6px",
      fontSize: "0.85rem",
      lineHeight: "1.3",
      color: "var(--tooltip-foreground-color, #fff)",
      background: "var(--tooltip-background-color, #000)",
      boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
      pointerEvents: "none",
      whiteSpace: "normal",
      overflowWrap: "anywhere",
    });
    document.body.appendChild(tooltip);
    const rect = anchor.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const margin = 8;
    let left = rect.left - tipRect.width - margin;
    if (left < margin) {
      left = Math.min(rect.right + margin, window.innerWidth - tipRect.width - margin);
    }
    const top = Math.min(
      window.innerHeight - tipRect.height - margin,
      Math.max(margin, rect.top + rect.height / 2 - tipRect.height / 2)
    );
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
    this._confirmTooltip = tooltip;
  }

  _hideConfirmTooltip() {
    if (this._confirmTooltip) {
      this._confirmTooltip.remove();
      this._confirmTooltip = null;
    }
  }

  _buildForceApplyRow(formContents, { options, selectionProp, armKey, apply }) {
    if (!options.length) {
      return;
    }
    if (!options.some((option) => option.id === this[selectionProp])) {
      this[selectionProp] = options[0].id;
    }
    const select = html.select(
      {
        style: "min-width: 9em;",
        onchange: (event) => {
          this[selectionProp] = event.target.value;
          this._disarmForceApply();
        },
      },
      options.map((option) =>
        html.option({ value: option.id, selected: this[selectionProp] === option.id }, [
          option.label,
        ])
      )
    );
    const button = html.button(
      {
        onclick: (event) => {
          const option = options.find((item) => item.id === this[selectionProp]);
          if (!option) {
            return;
          }
          this._confirmThenApply(event, armKey, () => apply(option));
        },
      },
      [translate("sidebar.skeleton-parameters.force-apply")]
    );
    formContents.push({
      type: "single-icon",
      element: html.div(
        { style: "display:flex; gap:0.35rem; align-items:center; flex-wrap:wrap;" },
        [select, button]
      ),
    });
  }

  async _forceApplyWidthProfile(option) {
    await setPanelPointTotalWidth(
      this.sceneController,
      this._widthPoints(),
      Number(option.value),
      this._undo("set-total-width")
    );
    this._forceRebuild = true;
    await this.update();
  }

  async _forceApplyCapProfile(option) {
    await setPanelCapParameters(
      this.sceneController,
      this._widthPoints(),
      option.values,
      this._undo("set-cap")
    );
    this._forceRebuild = true;
    await this.update();
  }

  // ---- Section builders -----------------------------------------------------

  _buildPointWidthSection(formContents, widthPoints) {
    const summary = summarizeSkeletonPointWidths(widthPoints);
    formContents.push({ type: "divider" });
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.point-widths"),
    });
    formContents.push({
      type: "checkbox",
      key: "width:linked",
      label: translate("sidebar.skeleton-parameters.linked"),
      value: summary.linked.mixed ? false : summary.linked.value,
    });
    // Only has an effect on a smooth point whose one handle faces away from a
    // straight segment; harmless elsewhere, so it is always shown rather than
    // appearing and disappearing as the selection changes.
    formContents.push({
      type: "checkbox",
      key: "width:tied",
      label: translate("sidebar.skeleton-parameters.tied"),
      value: summary.tied.mixed ? false : summary.tied.value,
    });
    // The minimum is declared here rather than left to the model: without it a
    // scrub past the bottom of the range keeps counting down in the box while
    // the stroke has already stopped, and the number snaps back on release.
    this._pushSummaryNumber(formContents, "width:total", "total-width", summary.total, {
      minValue: 0,
    });
    // On a single-sided contour the visible edge is the TOTAL, so the per-side
    // numbers and the split between them describe nothing on screen. Greyed and
    // blank rather than hidden: they are still stored, and still what the point
    // goes back to if the contour returns to double-sided.
    const perSideGate = summary.singleSided
      ? { disabled: true, blank: true, minValue: 0 }
      : { minValue: 0 };
    this._pushSummaryNumber(
      formContents,
      "width:left",
      "left-width",
      summary.left,
      perSideGate
    );
    this._pushSummaryNumber(
      formContents,
      "width:right",
      "right-width",
      summary.right,
      perSideGate
    );
    this._pushSummarySlider(
      formContents,
      "width:distribution",
      "distribution",
      summary.distribution,
      -100,
      100,
      0,
      summary.singleSided
        ? { step: 10, disabled: true, displayValue: "" }
        : { step: 10 }
    );
    // Force-apply a master width profile to the selected points (two-click
    // confirm; the dropdown picks base/horizontal/contrast or a custom width).
    this._buildForceApplyRow(formContents, {
      options: this._widthProfileOptions(),
      selectionProp: "_widthProfileSelection",
      armKey: "width",
      apply: (option) => this._forceApplyWidthProfile(option),
    });
  }

  _buildContourSection(formContents, contours) {
    const summary = summarizeSkeletonContourSelection(contours);
    formContents.push({ type: "divider" });
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.contour"),
    });
    const singleSided = summary.singleSided.value;
    formContents.push({
      type: "checkbox",
      key: "contour:single-sided",
      label: translate("sidebar.skeleton-parameters.single-sided"),
      value: summary.singleSided.mixed ? false : singleSided != null,
    });
    if (singleSided != null) {
      formContents.push({
        type: "checkbox",
        key: "contour:single-sided-right",
        label: translate("sidebar.skeleton-parameters.single-sided-right"),
        value: singleSided === "right",
      });
    }
    this._pushSummaryNumber(
      formContents,
      "contour:default-width",
      "contour-default-width",
      summary.defaultWidth,
      { minValue: 0 }
    );
  }

  _buildCapSection(formContents, widthPoints) {
    const cap = summarizeSkeletonCapSelection(widthPoints);
    const capStyle = summarizeSkeletonCapStyleSelection(widthPoints);
    formContents.push({ type: "divider" });
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.caps"),
    });
    formContents.push({
      type: "select",
      key: "cap:style",
      label: translate("sidebar.skeleton-parameters.cap-style"),
      value: capStyle.mixed ? "" : (capStyle.value ?? "butt"),
      disabled: !capStyle.canEdit,
      options: [
        ...(capStyle.mixed ? [{ value: "", label: "mixed", disabled: true }] : []),
        {
          value: "butt",
          label: translate("sidebar.skeleton-parameters.cap-style.flat"),
        },
        {
          value: "square",
          label: translate("sidebar.skeleton-parameters.cap-style.square"),
        },
        {
          value: "round",
          label: translate("sidebar.skeleton-parameters.cap-style.round"),
        },
        {
          value: "drop",
          label: translate("sidebar.skeleton-parameters.cap-style.drop"),
        },
        {
          value: "serif",
          label: translate("sidebar.skeleton-parameters.cap-style.serif"),
        },
      ],
    });
    // The rib angle lock is offered for every cap style, not just the flat one
    // as in the donor: it decides the rib the cap is built on, so it supersedes
    // the style rather than belonging to one.
    formContents.push({
      type: "select",
      key: "cap:ribanglelock",
      label: translate("sidebar.skeleton-parameters.rib-angle-lock"),
      value: cap.ribAngleLock.mixed ? "" : (cap.ribAngleLock.value ?? "auto"),
      disabled: !capStyle.canEdit,
      options: [
        ...(cap.ribAngleLock.mixed
          ? [{ value: "", label: "mixed", disabled: true }]
          : []),
        {
          value: "auto",
          label: translate("sidebar.skeleton-parameters.rib-angle-lock.auto"),
        },
        {
          value: "horizontal",
          label: translate("sidebar.skeleton-parameters.rib-angle-lock.horizontal"),
        },
        {
          value: "vertical",
          label: translate("sidebar.skeleton-parameters.rib-angle-lock.vertical"),
        },
      ],
    });
    // Donor parity: cap parameters appear as sliders, only for the styles
    // they apply to. Radius maps 20 discrete slider positions logarithmically
    // onto the [1/128, 1/4] ratio range; tension is edited in percent. Both
    // are converted back in _onCapChange.
    const styleValue = capStyle.mixed ? null : (capStyle.value ?? "butt");
    if (styleValue === "round") {
      const radiusSummary = {
        value:
          capRadiusIndexFromRatio(
            cap.capRadiusRatio.value ?? DEFAULT_CAP_RADIUS_RATIO
          ) + 1,
        mixed: cap.capRadiusRatio.mixed,
      };
      this._pushSummarySlider(
        formContents,
        "cap:radius",
        "cap-radius",
        radiusSummary,
        1,
        CAP_RADIUS_POSITIONS,
        capRadiusIndexFromRatio(DEFAULT_CAP_RADIUS_RATIO) + 1,
        { step: 1 }
      );
      const tensionSummary = {
        value: Math.round((cap.capTension.value ?? DEFAULT_CAP_TENSION) * 100),
        mixed: cap.capTension.mixed,
      };
      this._pushSummarySlider(
        formContents,
        "cap:tension",
        "cap-tension",
        tensionSummary,
        0,
        100,
        Math.round(DEFAULT_CAP_TENSION * 100),
        { step: 5 }
      );
    } else if (styleValue === "square") {
      const angleSummary = {
        value: Math.round(cap.capAngle.value ?? DEFAULT_CAP_ANGLE),
        mixed: cap.capAngle.mixed,
      };
      this._pushSummarySlider(
        formContents,
        "cap:angle",
        "cap-angle",
        angleSummary,
        CAP_ANGLE_MIN,
        CAP_ANGLE_MAX,
        DEFAULT_CAP_ANGLE,
        { step: 1 }
      );
      this._pushSummaryNumber(
        formContents,
        "cap:distance",
        "cap-distance",
        cap.capDistance
      );
    } else if (styleValue === "drop") {
      const ballSummary = {
        value: Math.round((cap.capBallRatio.value ?? DEFAULT_CAP_BALL_RATIO) * 100),
        mixed: cap.capBallRatio.mixed,
      };
      this._pushSummarySlider(
        formContents,
        "cap:ball",
        "cap-ball",
        ballSummary,
        CAP_BALL_MIN,
        CAP_BALL_MAX,
        Math.round(DEFAULT_CAP_BALL_RATIO * 100),
        { step: 5, allowInputBeyondRange: true }
      );
      const shapeSummary = {
        value: Math.round((cap.capBallShape.value ?? DEFAULT_CAP_BALL_SHAPE) * 100),
        mixed: cap.capBallShape.mixed,
      };
      this._pushSummarySlider(
        formContents,
        "cap:ballshape",
        "cap-ball-shape",
        shapeSummary,
        CAP_SHAPE_MIN,
        CAP_SHAPE_MAX,
        Math.round(DEFAULT_CAP_BALL_SHAPE * 100),
        { step: 5, allowInputBeyondRange: true }
      );
      const tensionSummary = {
        value: Math.round((cap.capTension.value ?? DEFAULT_CAP_TENSION) * 100),
        mixed: cap.capTension.mixed,
      };
      this._pushSummarySlider(
        formContents,
        "cap:tension",
        "cap-tension",
        tensionSummary,
        0,
        CAP_TENSION_DROP_MAX,
        Math.round(DEFAULT_CAP_TENSION * 100),
        { step: 5 }
      );
      formContents.push({
        type: "select",
        key: "cap:ballside",
        label: translate("sidebar.skeleton-parameters.cap-ball-side"),
        value: cap.capBallSide.mixed ? "" : (cap.capBallSide.value ?? "auto"),
        disabled: !capStyle.canEdit,
        options: [
          ...(cap.capBallSide.mixed
            ? [{ value: "", label: "mixed", disabled: true }]
            : []),
          {
            value: "auto",
            label: translate("sidebar.skeleton-parameters.cap-ball-side.auto"),
          },
          {
            value: "left",
            label: translate("sidebar.skeleton-parameters.cap-ball-side.left"),
          },
          {
            value: "right",
            label: translate("sidebar.skeleton-parameters.cap-ball-side.right"),
          },
        ],
      });
    } else if (styleValue === "serif") {
      this._buildSerifSection(formContents, widthPoints, capStyle.canEdit);
    }
    // Force-apply master cap defaults (or a custom cap profile) to the
    // selected endpoints, two-click confirm. Serifs have no profile library
    // yet, so they are not offered here.
    if (
      (styleValue === "round" || styleValue === "square" || styleValue === "drop") &&
      capStyle.canEdit
    ) {
      this._buildForceApplyRow(formContents, {
        options: this._capProfileOptions(styleValue),
        selectionProp: "_capProfileSelection",
        armKey: "cap",
        apply: (option) => this._forceApplyCapProfile(option),
      });
    }
  }

  // Donor "Corner Rounding" section: parameters of the angle-point rounding
  // engine, NOT cap parameters. All four live on the point; edited in percent
  // (except asymmetry) and gated to angle points (non-smooth, non-endpoint).
  _buildCornerSection(formContents, widthPoints) {
    const corner = summarizeSkeletonCornerSelection(widthPoints);
    formContents.push({ type: "divider" });
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.corner-rounding"),
    });
    const gate = { disabled: !corner.canEdit };
    const asPercent = (summary) => ({
      value: summary.value == null ? null : Math.round(summary.value * 100),
      mixed: summary.mixed,
    });
    this._pushSummarySlider(
      formContents,
      "corner:roundness",
      "corner-roundness",
      asPercent(corner.cornerRoundness),
      0,
      100,
      0,
      { step: 1, ...gate }
    );
    this._pushSummarySlider(
      formContents,
      "corner:asymmetry",
      "corner-asymmetry",
      corner.cornerAsymmetry,
      -1,
      1,
      0,
      { step: 0.1, ...gate }
    );
    this._pushSummarySlider(
      formContents,
      "corner:reach",
      "corner-reach",
      asPercent(corner.cornerReach),
      5,
      99,
      50,
      { step: 1, ...gate }
    );
    this._pushSummarySlider(
      formContents,
      "corner:strength",
      "corner-strength",
      asPercent(corner.roundnessStrength),
      10,
      400,
      100,
      { step: 1, ...gate }
    );
  }

  _buildRibSection(formContents, ribs, derived = false) {
    const summary = summarizeSkeletonRibSelection(ribs);
    // Derived targets cover both sides of each selected point, so the reset
    // button says so; an explicit rib selection resets just that rib.
    const resetRibLabel = derived && ribs.length > 1 ? "reset-ribs-both" : "reset-rib";
    formContents.push({ type: "divider" });
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.ribs"),
    });
    // D9: the gizmos are the default way to shape a generated segment; dragging
    // its handles directly is the opt-out. A behavior name, not a data mode
    // (R-F) — both write the same fields, so flipping this loses nothing and
    // there is nothing to reset on the way back.
    formContents.push({
      type: "checkbox",
      key: "rib:generated-gizmos",
      label: translate("sidebar.skeleton-parameters.generated-gizmos"),
      value: this._generatedGizmosEnabled(),
    });
    // Locking blocks this side's generated adjustments without clearing them.
    // With a skeleton point selected the derived targets are both its ribs, so
    // this is the donor's combined lock control.
    formContents.push({
      type: "checkbox",
      key: "rib:locked",
      label: translate("sidebar.skeleton-parameters.locked"),
      value: summary.locked.mixed ? false : summary.locked.value,
      indeterminate: summary.locked.mixed,
    });
    // Detach is an adjustment, so a fully locked selection can't reach it.
    if (summary.locked.value !== true) {
      formContents.push({
        type: "checkbox",
        key: "rib:detached",
        label: translate("sidebar.skeleton-parameters.detached"),
        value: summary.detached.mixed ? false : summary.detached.value,
      });
    }
    const buttons = [
      html.button({ onclick: () => this._resetRibs({ handlesOnly: false }) }, [
        translate(`sidebar.skeleton-parameters.${resetRibLabel}`),
      ]),
      html.button({ onclick: () => this._resetRibs({ handlesOnly: true }) }, [
        translate("sidebar.skeleton-parameters.reset-handles"),
      ]),
    ];
    // With exactly one generated handle selected, offer the narrow reset that
    // clears only that handle and leaves its pair alone (5.3).
    if (this._singleGeneratedHandle) {
      buttons.push(
        html.button({ onclick: () => this._resetSingleGeneratedHandle() }, [
          translate("sidebar.skeleton-parameters.reset-this-handle"),
        ])
      );
    }
    formContents.push({
      type: "single-icon",
      element: html.div(
        { style: "display:flex; gap:0.5rem; flex-wrap:wrap;" },
        buttons
      ),
    });
  }

  // Serif parameters. Nine numbers per half plus the axis and the underside cup
  // shared by the terminal, grouped wing / bracket / contour easing so the panel
  // reads in the order the shape is built. Absolute font units for the lengths;
  // tension, concavity and ease curvature are edited as percent and stored as
  // ratios. When the halves are linked one set of
  // controls is shown and written to both sides — the storage is always two
  // independent halves, linking is only an editing convenience.
  _buildSerifSection(formContents, widthPoints, canEdit) {
    const serif = summarizeSkeletonSerifSelection(widthPoints);
    const linked = !serif.linked.mixed && serif.linked.value !== false;

    formContents.push({
      type: "checkbox",
      key: "serif:linked",
      label: translate("sidebar.skeleton-parameters.serif-linked"),
      value: linked,
      indeterminate: serif.linked.mixed,
      disabled: !canEdit,
    });

    // Every serif length is a plain number whose label scrubs, like the rest of
    // the panel. It used to carry a scale slider on the same line; the scrub
    // replaced it, and took a row's worth of width back with it.
    //
    // The minimum is declared here rather than left to the model: without it a
    // drag past the bottom of the range keeps counting down in the box while the
    // shape has already stopped, and the number snaps back on release.
    const pushLength = (key, labelKey, summary, minValue = 0) => {
      this._pushSummaryNumber(formContents, key, labelKey, summary, {
        disabled: !canEdit,
        ...(minValue == null ? {} : { minValue }),
      });
    };

    const pushGroup = (labelKey) => {
      formContents.push({
        type: "header",
        label: translate(`sidebar.skeleton-parameters.${labelKey}`),
      });
    };

    const pushHalf = (scope, half) => {
      pushGroup("serif-group-wing");
      pushLength(`serif:${scope}-wingLength`, "serif-wing-length", half.wingLength);
      pushLength(
        `serif:${scope}-tipThickness`,
        "serif-tip-thickness",
        half.tipThickness
      );
      // Signed, unlike the other three: a negative slope tilts the wing's inner
      // face the other way and is a real family of shapes, not an error.
      pushLength(`serif:${scope}-wingSlope`, "serif-wing-slope", half.wingSlope, null);
      // Degrees rather than a length, but edited like the other three: a number
      // whose label scrubs. It was a slider, which made it the odd one out in a
      // group of four.
      this._pushSummaryNumber(
        formContents,
        `serif:${scope}-tipCutAngle`,
        "serif-tip-cut",
        half.tipCutAngle,
        {
          disabled: !canEdit,
          minValue: -MAX_TIP_CUT_ANGLE,
          maxValue: MAX_TIP_CUT_ANGLE,
        }
      );

      // An untouched half stores null on every field, and null means "inherit"
      // — so these three sliders have to park on the generator's own default or
      // they show a shape that is not on screen, and the first drag jumps.
      const percentDefault = (field) => Math.round(SERIF_HALF_DEFAULTS[field] * 100);

      pushGroup("serif-group-bracket");
      // How far back along the stem flank the transition starts. It moves the
      // junction, which moves the attractor the bracket bends around, so it is
      // not a longer version of wing slope.
      pushLength(`serif:${scope}-reach`, "serif-reach", half.reach);
      // How far both handles travel toward the attractor. At 0 the bracket is a
      // straight wedge; there is no separate corner-or-smooth switch.
      this._pushSummarySlider(
        formContents,
        `serif:${scope}-tension`,
        "serif-tension",
        percentSummary(half.tension),
        0,
        100,
        percentDefault("tension"),
        { step: 1, disabled: !canEdit }
      );
      // Signed, and it places the attractor: negative bulges the transition
      // convex, 0 is a flat chamfer, 100 puts it on the wing's inner corner.
      this._pushSummarySlider(
        formContents,
        `serif:${scope}-concavity`,
        "serif-concavity",
        percentSummary(half.concavity),
        -100,
        100,
        percentDefault("concavity"),
        { step: 1, disabled: !canEdit }
      );

      pushGroup("serif-group-easing");
      // Rounds the junction between the flank and the bracket. It switches
      // itself off on a hollow bracket, which is why these two do nothing at
      // positive concavity.
      pushLength(
        `serif:${scope}-easeDistance`,
        "serif-ease-distance",
        half.easeDistance
      );
      this._pushSummarySlider(
        formContents,
        `serif:${scope}-easeCurvature`,
        "serif-ease-curvature",
        percentSummary(half.easeCurvature),
        0,
        100,
        percentDefault("easeCurvature"),
        { step: 1, disabled: !canEdit }
      );
    };

    if (linked) {
      pushHalf("both", serif.left);
    } else {
      formContents.push({
        type: "header",
        label: translate("sidebar.skeleton-parameters.serif-left"),
      });
      pushHalf("left", serif.left);
      formContents.push({
        type: "header",
        label: translate("sidebar.skeleton-parameters.serif-right"),
      });
      pushHalf("right", serif.right);
    }

    formContents.push({ type: "divider" });
    // The serif axis is independent of the rib angle lock above: the lock sets
    // the rib the cap is built on, this sets which way the wings run. Both
    // apply at once.
    formContents.push({
      type: "select",
      key: "serif:axismode",
      label: translate("sidebar.skeleton-parameters.serif-axis"),
      value: serif.axisMode.mixed ? "" : (serif.axisMode.value ?? "perpendicular"),
      disabled: !canEdit,
      options: [
        ...(serif.axisMode.mixed
          ? [{ value: "", label: "mixed", disabled: true }]
          : []),
        {
          value: "perpendicular",
          label: translate("sidebar.skeleton-parameters.serif-axis.perpendicular"),
        },
        {
          value: "horizontal",
          label: translate("sidebar.skeleton-parameters.serif-axis.horizontal"),
        },
        {
          value: "vertical",
          label: translate("sidebar.skeleton-parameters.serif-axis.vertical"),
        },
        {
          value: "absolute",
          label: translate("sidebar.skeleton-parameters.serif-axis.absolute"),
        },
      ],
    });
    if (serif.axisMode.value === "absolute" && !serif.axisMode.mixed) {
      this._pushSummarySlider(
        formContents,
        "serif:axisangle",
        "serif-axis-angle",
        serif.axisAngle,
        -90,
        90,
        0,
        { step: 1, disabled: !canEdit }
      );
    }
    // One curve across the whole terminal, so this is shared rather than per
    // half: a cup on each half would meet at a break in the middle.
    pushLength("serif:cup", "serif-underside-cup", serif.undersideCup);
    this._buildSerifPresetControls(formContents, serif, canEdit);
  }

  // ---- Serif presets --------------------------------------------------------

  // The ported built-ins first, then the master's own — the same order the
  // width and cap selects use. A built-in cannot be updated in place.
  _serifPresetOptions() {
    const options = SERIF_PRESETS.map((preset, index) => ({
      id: `builtin:${index}`,
      label: preset.name,
      preset,
      builtin: true,
    }));
    const list = this._resolveSourceDefault(SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_SERIFS);
    if (Array.isArray(list)) {
      list
        .filter((item) => item && typeof item === "object")
        .forEach((item, index) => {
          options.push({
            id: `custom:${index}`,
            index,
            label: item.name || `Serif ${index + 1}`,
            preset: item,
            builtin: false,
          });
        });
    }
    return options;
  }

  // A preset is one shape. Capturing two different terminals into one would
  // produce neither of them, so create and update refuse a mixed selection.
  _serifSelectionIsMixed(serif) {
    for (const side of ["left", "right"]) {
      for (const field of SERIF_HALF_FIELDS) {
        if (serif[side][field].mixed) {
          return true;
        }
      }
    }
    return serif.linked.mixed || serif.undersideCup.mixed;
  }

  async _persistSerifPresetList(next) {
    if (this.fontController.readOnly) {
      return;
    }
    const location =
      this.sceneController.sceneSettings.fontLocationSourceMapped ||
      this.sceneController.sceneSettings.fontLocationSource ||
      {};
    const sourceId =
      this.fontController.fontSourcesInstancer?.getSourceIdentifierForLocation(
        location
      ) || this.fontController.defaultSourceIdentifier;
    if (!sourceId || !this.fontController.sources?.[sourceId]) {
      return;
    }
    const root = { sources: this.fontController.sources };
    const changes = recordChanges(root, (root) => {
      const source = root.sources[sourceId];
      if (source) {
        setSourceSkeletonDefaultsValues(source, {
          [SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_SERIFS]: next,
        });
      }
    });
    if (changes.hasChange) {
      await this.fontController.postChange(
        changes.change,
        changes.rollbackChange,
        translate("sidebar.skeleton-parameters.undo.set-defaults"),
        this
      );
    }
  }

  _customSerifPresets() {
    return this._serifPresetOptions()
      .filter((option) => !option.builtin)
      .map((option) => ({ ...option.preset }));
  }

  _selectedSerifPoint() {
    return this._widthPoints()[0] ?? null;
  }

  async _applySerifPreset(option) {
    await applyPanelSerifPreset(
      this.sceneController,
      this._widthPoints(),
      option.preset,
      this._serifApplyScope,
      this._undo("set-serif")
    );
    this._forceRebuild = true;
    await this.update();
  }

  async _createSerifPreset() {
    const entry = this._selectedSerifPoint();
    if (!entry) {
      return;
    }
    const next = this._customSerifPresets();
    next.push({
      name: `Serif ${next.length + 1}`,
      ...captureSerifPreset(entry.point),
    });
    this._serifPresetSelection = `custom:${next.length - 1}`;
    await this._persistSerifPresetList(next);
    this._forceRebuild = true;
    await this.update();
  }

  async _updateSerifPreset(option) {
    const entry = this._selectedSerifPoint();
    if (!entry) {
      return;
    }
    const next = this._customSerifPresets();
    next[option.index] = {
      name: option.preset.name,
      ...captureSerifPreset(entry.point),
    };
    await this._persistSerifPresetList(next);
    this._forceRebuild = true;
    await this.update();
  }

  _buildSerifPresetControls(formContents, serif, canEdit) {
    const options = this._serifPresetOptions();
    const mixed = this._serifSelectionIsMixed(serif);
    const hasPoint = !!this._selectedSerifPoint();
    formContents.push({ type: "divider" });
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.serif-presets"),
    });
    if (options.length) {
      if (!options.some((option) => option.id === this._serifPresetSelection)) {
        this._serifPresetSelection = options[0].id;
      }
      const select = html.select(
        {
          style: "min-width: 8em;",
          disabled: !canEdit,
          onchange: (event) => {
            this._serifPresetSelection = event.target.value;
            this._disarmForceApply();
            this.update();
          },
        },
        options.map((option) =>
          html.option(
            { value: option.id, selected: this._serifPresetSelection === option.id },
            [option.label]
          )
        )
      );
      const scopeSelect = html.select(
        {
          style: "min-width: 6em;",
          disabled: !canEdit,
          onchange: (event) => {
            this._serifApplyScope = event.target.value;
            this._disarmForceApply();
          },
        },
        ["both", "left", "right"].map((scope) =>
          html.option({ value: scope, selected: this._serifApplyScope === scope }, [
            translate(`sidebar.skeleton-parameters.serif-presets.scope-${scope}`),
          ])
        )
      );
      const selected = options.find(
        (option) => option.id === this._serifPresetSelection
      );
      const applyButton = html.button(
        {
          disabled: !canEdit,
          onclick: (event) => {
            if (!selected) {
              return;
            }
            this._confirmThenApply(event, "serif-preset", () =>
              this._applySerifPreset(selected)
            );
          },
        },
        [translate("sidebar.skeleton-parameters.force-apply")]
      );
      // The name rides on the button, so a select changed between the two
      // presses cannot aim the overwrite at a preset the designer is not
      // looking at.
      const updateButton = html.button(
        {
          disabled: !canEdit || mixed || !hasPoint || !selected || selected.builtin,
          onclick: (event) => {
            if (!selected) {
              return;
            }
            this._confirmThenApply(event, "serif-preset-update", () =>
              this._updateSerifPreset(selected)
            );
          },
        },
        [
          translate(
            "sidebar.skeleton-parameters.serif-presets.update",
            selected?.label ?? ""
          ),
        ]
      );
      formContents.push({
        type: "single-icon",
        element: html.div(
          { style: "display:flex; gap:0.35rem; align-items:center; flex-wrap:wrap;" },
          [select, scopeSelect, applyButton, updateButton]
        ),
      });
    }
    const createButton = html.button(
      {
        disabled: !canEdit || mixed || !hasPoint,
        onclick: () => this._createSerifPreset(),
      },
      [translate("sidebar.skeleton-parameters.serif-presets.create")]
    );
    formContents.push({
      type: "single-icon",
      element: html.div({}, [createButton]),
    });
  }

  // ---- Field description helpers -------------------------------------------

  _pushSummaryNumber(formContents, key, labelKey, summary, options = {}) {
    formContents.push({
      label: translate(`sidebar.skeleton-parameters.${labelKey}`),
      ...this._summaryNumberField(key, summary, options),
    });
  }

  // The number input on its own, so a caller can either give it a row of its
  // own or pack it beside something else.
  //
  // Every one of these scrubs: dragging its label sideways moves the number.
  // On by default rather than per field, so there is no guessing which of the
  // panel's numbers are draggable — they all are. A caller that wants one inert
  // passes `scrub: false`.
  _summaryNumberField(key, summary, options = {}) {
    const { blank = false, ...fieldOptions } = options;
    return {
      type: "edit-number",
      key,
      value: blank || summary.mixed ? null : summary.value,
      placeholder: blank ? "" : summary.placeholder || undefined,
      scrub: true,
      auxiliaryElement: fieldOptions.disabled
        ? undefined
        : this._multiplyControl(key, summary),
      ...fieldOptions,
    };
  }

  // "× 1.1 → 44 Apply", packed into the same row as the number.
  //
  // A scrub adds and a multiply scales, and the two want different controls: a
  // scrub is a continuous drag with the shape under the hand, a multiply is one
  // ratio applied at once. Hence a field and a button rather than a second drag.
  //
  // The button carries the answer because a ratio is not a shape. 1.1 tells you
  // nothing about where a 40 lands; 44 does.
  _multiplyControl(key, summary) {
    const factorOf = () => Number(this._multiplyFactors[key] ?? 1);
    const preview = () => {
      const factor = factorOf();
      if (!Number.isFinite(factor) || summary.mixed || summary.value == null) {
        return summary.mixed ? "mixed - Apply" : "Apply";
      }
      return `${Math.round(summary.value * factor)} - Apply`;
    };
    const button = html.button(
      {
        style: "white-space: nowrap;",
        onclick: () => {
          const factor = factorOf();
          if (!Number.isFinite(factor) || factor === 1) {
            return;
          }
          const [group, name] = String(key).split(":");
          this._onMultiply(group, name, factor);
        },
      },
      [preview()]
    );
    const input = html.input({
      type: "number",
      step: "0.1",
      value: String(factorOf()),
      style: "width: 3.5em;",
      oninput: (event) => {
        this._multiplyFactors[key] = event.target.value;
        // Live, so the button always shows where this field's number lands
        // rather than a stale answer to the previous ratio.
        button.textContent = preview();
      },
    });
    return html.div(
      { style: "display:flex; gap:0.25rem; align-items:center; margin-left:auto;" },
      [html.span({}, ["×"]), input, button]
    );
  }

  _pushSummarySlider(
    formContents,
    key,
    labelKey,
    summary,
    minValue,
    maxValue,
    defaultValue,
    options = {}
  ) {
    // A mixed or absent value must NOT pin the thumb to minValue: that makes
    // the slider draggable in only one direction. Park it at the default and
    // show "mixed" as a placeholder instead (donor parity).
    const noValue = summary.mixed || summary.value == null;
    formContents.push({
      type: "edit-number-slider",
      key,
      label: translate(`sidebar.skeleton-parameters.${labelKey}`),
      value: noValue ? (defaultValue ?? minValue) : summary.value,
      displayValue: summary.mixed ? "mixed" : undefined,
      minValue,
      // The RangeSlider web component requires a numeric defaultValue
      defaultValue: defaultValue ?? minValue,
      maxValue,
      ...options,
    });
  }

  // ---- Field change dispatch ------------------------------------------------

  async _onFieldChange(fieldItem, value, valueStream) {
    const [group, name] = String(fieldItem.key).split(":");
    this._suppressGlyphChangeUpdate = true;
    // Remembered so the refresh at the end of this method leaves this one input
    // alone: it already holds what the user put in it, and writing back would
    // interrupt a run of arrow-key increments.
    this._activeFieldKey = fieldItem.key;
    try {
      // A label scrub streams the CHANGE from where the drag started, not a
      // value, and only the plain number fields scrub — every slider streams
      // values. Applying a change per point is what keeps a mixed selection's
      // differences instead of collapsing them onto one number.
      //
      // Checked before every other streaming branch: a scrubbed number would
      // otherwise be read as an absolute value by whichever branch claims its
      // group first, and set the field to the size of the drag.
      if (valueStream && fieldItem.type === "edit-number") {
        await this._onScrub(group, name, valueStream);
        return;
      }
      // Distribution, cap and corner sliders stream onto the canvas while
      // dragging; all other fields apply the committed value once.
      if (group === "width" && name === "distribution" && valueStream) {
        await setPanelPointDistributionStream(
          this.sceneController,
          this._widthPoints(),
          valueStream,
          this._undo("set-distribution")
        );
        return;
      }
      if (valueStream && (group === "cap" || group === "corner")) {
        const makeValues = group === "cap" ? capValuesFromField : cornerValuesFromField;
        const setter =
          group === "cap" ? setSkeletonCapParameters : setSkeletonCornerParameters;
        if (makeValues(name, value)) {
          await setPanelPointValuesStream(
            this.sceneController,
            this._widthPoints(),
            valueStream,
            (point, contour, streamedValue) =>
              setter(point, makeValues(name, streamedValue)),
            this._undo(group === "cap" ? "set-cap" : "set-corner")
          );
          return;
        }
      }
      if (valueStream && group === "serif") {
        const makeValues = (streamed) =>
          name === "axisangle"
            ? { axisAngle: Number(streamed) }
            : serifHalfValuesFromField(name, streamed);
        if (makeValues(value)) {
          await setPanelSerifParametersStream(
            this.sceneController,
            this._widthPoints(),
            valueStream,
            makeValues,
            this._undo("set-serif")
          );
          return;
        }
      }
      const finalValue = await this._resolveStreamValue(value, valueStream);
      // An abandoned drag has already put the shape back; there is no value to
      // commit and committing one would undo the abandoning.
      if (isScrubCancelled(finalValue)) {
        return;
      }
      if (group === "width") {
        await this._onWidthChange(name, finalValue);
      } else if (group === "contour") {
        await this._onContourChange(name, finalValue);
      } else if (group === "cap") {
        await this._onCapChange(name, finalValue);
      } else if (group === "corner") {
        await this._onCornerChange(name, finalValue);
      } else if (group === "rib") {
        await this._onRibChange(name, finalValue);
      } else if (group === "serif") {
        await this._onSerifChange(name, finalValue);
      }
    } finally {
      this._suppressGlyphChangeUpdate = false;
      // A stream is a finished drag by the time we get here, so the input has
      // to take whatever the model settled on — which is not the number the
      // drag reached, if a bound trimmed it. Holding the field back here is
      // what left a scrub showing a value the terminal was never at. A typed
      // or arrow-key change is the case the hold-back is for: that field still
      // has focus, and writing into it fights the next keystroke.
      if (valueStream) {
        this._activeFieldKey = null;
      }
      this._forceRebuild = true;
      await this.update();
      this._activeFieldKey = null;
    }
  }

  // Route a label scrub to the edit path that moves its number by a change.
  // Every branch here is relative; nothing sets an absolute value, so a mixed
  // selection comes out of a drag as mixed as it went in.
  // The multiply beside each scrub field. Same fields, same per-point writers,
  // same undo labels — a scrub adds to what a point holds and this scales it, so
  // the only thing that differs is the arithmetic.
  //
  // Per point, not against one number: scaling a mixed selection by 1.1 has to
  // grow each point from its own value, which is the whole reason a multiply is
  // not a scrub with the answer worked out in advance.
  async _onMultiply(group, name, factor) {
    const sc = this.sceneController;
    if (group === "width") {
      if (name !== "total" && name !== "left" && name !== "right") {
        return;
      }
      await scalePanelPointWidth(
        sc,
        this._widthPoints(),
        name,
        factor,
        this._undo("set-width")
      );
    } else if (group === "contour" && name === "default-width") {
      await scalePanelContourDefaultWidth(
        sc,
        this._panelSelection.contours,
        factor,
        this._undo("set-contour-width")
      );
    } else if (group === "cap" && name === "distance") {
      await scalePanelCapParameter(
        sc,
        this._widthPoints(),
        "capDistance",
        factor,
        this._undo("set-cap")
      );
    } else if (group === "serif") {
      const targets = serifNudgeTargets(name);
      if (!targets.length) {
        return;
      }
      await scalePanelSerifValue(
        sc,
        this._widthPoints(),
        targets,
        factor,
        this._undo("set-serif")
      );
    } else {
      return;
    }
    this._forceRebuild = true;
    await this.update();
  }

  async _onScrub(group, name, valueStream) {
    const sc = this.sceneController;
    if (group === "width") {
      if (name !== "total" && name !== "left" && name !== "right") {
        return;
      }
      await nudgePanelPointWidthStream(
        sc,
        this._widthPoints(),
        name,
        valueStream,
        this._undo("set-width")
      );
      return;
    }
    if (group === "contour" && name === "default-width") {
      await nudgePanelContourDefaultWidthStream(
        sc,
        this._panelSelection.contours,
        valueStream,
        this._undo("set-contour-width")
      );
      return;
    }
    if (group === "cap" && name === "distance") {
      await nudgePanelCapParameterStream(
        sc,
        this._widthPoints(),
        "capDistance",
        valueStream,
        this._undo("set-cap")
      );
      return;
    }
    if (group === "serif") {
      const targets = serifNudgeTargets(name);
      if (targets.length) {
        await nudgePanelSerifValueStream(
          sc,
          this._widthPoints(),
          targets,
          valueStream,
          this._undo("set-serif")
        );
      }
    }
  }

  // Consume a slider value stream and return the final value: applying only the
  // committed value yields exactly one undo record per drag.
  async _resolveStreamValue(value, valueStream) {
    if (!valueStream) {
      return value;
    }
    let last = value;
    for await (const v of valueStream) {
      if (isScrubCancelled(v)) {
        return v;
      }
      last = v;
    }
    return last;
  }

  _widthPoints() {
    return collectWidthEditPoints(this._panelSelection);
  }

  async _onWidthChange(name, value) {
    const points = this._widthPoints();
    const sc = this.sceneController;
    if (name === "linked") {
      await setPanelPointLinked(sc, points, value === true, this._undo("set-linked"));
    } else if (name === "tied") {
      await setPanelPointTied(sc, points, value === true, this._undo("set-tied"));
    } else if (name === "total") {
      await setPanelPointTotalWidth(sc, points, value, this._undo("set-total-width"));
    } else if (name === "left") {
      await setPanelPointSideWidth(sc, points, "left", value, this._undo("set-width"));
    } else if (name === "right") {
      await setPanelPointSideWidth(sc, points, "right", value, this._undo("set-width"));
    } else if (name === "distribution") {
      await setPanelPointDistribution(
        sc,
        points,
        value,
        this._undo("set-distribution")
      );
    }
  }

  async _onContourChange(name, value) {
    const contours = this._panelSelection.contours;
    const sc = this.sceneController;
    if (name === "single-sided") {
      await setPanelContourSingleSided(
        sc,
        contours,
        value === true ? "left" : null,
        this._undo("set-single-sided")
      );
    } else if (name === "single-sided-right") {
      await setPanelContourSingleSided(
        sc,
        contours,
        value === true ? "right" : "left",
        this._undo("set-single-sided")
      );
    } else if (name === "default-width") {
      await setPanelContourDefaultWidth(
        sc,
        contours,
        value,
        this._undo("set-contour-width")
      );
    }
  }

  async _onCapChange(name, value) {
    if (name === "ribanglelock") {
      if (!["auto", "horizontal", "vertical"].includes(value)) {
        return;
      }
      await setPanelRibAngleLock(
        this.sceneController,
        this._widthPoints(),
        value === "auto" ? null : value,
        this._undo("set-rib-angle-lock")
      );
      return;
    }
    if (name === "style") {
      if (!["butt", "square", "round", "drop", "serif"].includes(value)) {
        return;
      }
      const location =
        this.sceneController.sceneSettings.fontLocationSourceMapped ||
        this.sceneController.sceneSettings.fontLocationSource ||
        {};
      const K = SKELETON_SOURCE_DEFAULT_KEYS;
      const presetValues = {
        capRadiusRatio: resolveEffectiveSourceSkeletonDefault(
          this.fontController,
          location,
          K.CAP_RADIUS_RATIO
        ),
        capTension: resolveEffectiveSourceSkeletonDefault(
          this.fontController,
          location,
          K.CAP_TENSION
        ),
        capAngle: resolveEffectiveSourceSkeletonDefault(
          this.fontController,
          location,
          K.CAP_ANGLE
        ),
        capDistance: resolveEffectiveSourceSkeletonDefault(
          this.fontController,
          location,
          K.CAP_DISTANCE
        ),
        capBallRatio: DEFAULT_CAP_BALL_RATIO,
        capBallShape: DEFAULT_CAP_BALL_SHAPE,
      };
      await setPanelCapStyle(
        this.sceneController,
        this._widthPoints(),
        value,
        this._undo("set-cap"),
        presetValues
      );
      return;
    }
    const values = capValuesFromField(name, value);
    if (!values) {
      return;
    }
    await setPanelCapParameters(
      this.sceneController,
      this._widthPoints(),
      values,
      this._undo("set-cap")
    );
  }

  async _onSerifChange(name, value) {
    const apply = (values) =>
      setPanelSerifParameters(
        this.sceneController,
        this._widthPoints(),
        values,
        this._undo("set-serif")
      );

    if (name === "linked") {
      // Linking copies the left half onto the right, so turning it on gives one
      // symmetric serif rather than silently keeping a difference the panel can
      // no longer show.
      const serif = summarizeSkeletonSerifSelection(this._widthPoints());
      const values = { linked: value === true };
      if (value === true) {
        values.right = {};
        for (const field of SERIF_HALF_FIELDS) {
          values.right[field] = serif.left[field].mixed
            ? null
            : serif.left[field].value;
        }
      }
      await apply(values);
      return;
    }
    if (name === "axismode") {
      if (!VALID_SERIF_AXIS_MODES.has(value)) {
        return;
      }
      await apply({ axisMode: value });
      return;
    }
    if (name === "axisangle") {
      await apply({ axisAngle: Number(value) });
      return;
    }
    if (name === "cup") {
      await apply({ undersideCup: value == null ? null : Number(value) });
      return;
    }
    const values = serifHalfValuesFromField(name, value);
    if (values) {
      await apply(values);
    }
  }

  async _onCornerChange(name, value) {
    const values = cornerValuesFromField(name, value);
    if (!values) {
      return;
    }
    await setPanelCornerParameters(
      this.sceneController,
      this._widthPoints(),
      values,
      this._undo("set-corner")
    );
  }

  // The gizmo layer's own switch is the single source of truth for the mode, so
  // the panel checkbox and the View menu can never drift apart. Nothing about
  // this is stored in the glyph: it is how the outline is edited, not what the
  // outline is.
  _generatedGizmosEnabled() {
    return (
      this.editorController.visualizationLayersSettings.model[
        "fontra.skeleton.generated-tunni"
      ] === true
    );
  }

  async _onRibChange(name, value) {
    if (name === "generated-gizmos") {
      this.editorController.visualizationLayersSettings.model[
        "fontra.skeleton.generated-tunni"
      ] = value === true;
      return;
    }
    if (name === "locked") {
      await setPanelRibLocked(
        this.sceneController,
        this._ribTargets,
        value === true,
        this._undo("set-rib-locked")
      );
    } else if (name === "detached") {
      await setPanelRibDetached(
        this.sceneController,
        this._ribTargets,
        value === true,
        this._undo("set-rib-detached")
      );
    }
  }

  async _resetSingleGeneratedHandle() {
    if (!this._singleGeneratedHandle) {
      return;
    }
    await resetPanelGeneratedHandle(
      this.sceneController,
      this._singleGeneratedHandle,
      this._undo("reset-this-handle")
    );
    this._forceRebuild = true;
    await this.update();
  }

  async _resetRibs({ handlesOnly }) {
    await resetPanelRibs(
      this.sceneController,
      this._ribTargets,
      { handlesOnly },
      this._undo(handlesOnly ? "reset-handles" : "reset-ribs")
    );
    this._forceRebuild = true;
    await this.update();
  }

  _undo(key) {
    return translate(`sidebar.skeleton-parameters.undo.${key}`);
  }
}

customElements.define("panel-skeleton-parameters", SkeletonParametersPanel);

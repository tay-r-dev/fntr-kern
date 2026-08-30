import { recordChanges } from "@fontra/core/change-recorder.js";
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { isScrubCancelled } from "@fontra/core/number-scrub.js";
import {
  DEFAULT_UNDERSIDE_CUP_TENSION,
  MAX_TIP_CUT_ANGLE,
} from "@fontra/core/serif-geometry.js";
import { SERIF_HALF_DEFAULTS } from "@fontra/core/skeleton-generator.js";
import {
  SERIF_HALF_FIELDS,
  SERIF_PRESETS,
  SKELETON_LOCK_KINDS,
  SKELETON_SOURCE_DEFAULT_KEYS,
  VALID_SERIF_AXIS_MODES,
  VALID_SERIF_SIDES,
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
import { editSkeleton } from "./skeleton-editing.js";
import {
  SKELETON_PANEL_SENDER,
  applyPanelSerifPreset,
  nudgePanelCapParameterStream,
  nudgePanelContourDefaultWidthStream,
  nudgePanelCornerDistanceStream,
  nudgePanelPointWidthStream,
  nudgePanelSerifValueStream,
  resetPanelGeneratedHandle,
  resetPanelRibs,
  scalePanelCapParameter,
  scalePanelContourDefaultWidth,
  scalePanelCornerDistance,
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
  summarizeSkeletonRibAngleLockSelection,
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
// Bulb easing: a percent of the run from the ball's crossing on the inner edge
// to the next generated on-curve. 100 collapses the two, and there is nothing
// past it, so this is a hard end rather than a slider convenience.
const DEFAULT_CAP_BALL_EASING = 0;
export const CAP_BALL_EASING_MAX = 100;

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
  if (name === "balleasing") {
    return { capBallEasing: Math.min(Math.max(Number(value) / 100, 0), 1) };
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

// Which stored serif numbers one label scrub moves. A field shown under the
// shared controls drives both sides, the same as typing into it does.
function serifNudgeTargets(name) {
  if (name === "cup") {
    return [{ field: "undersideCup" }];
  }
  if (name === "cuptension" || name === "cupbalance") {
    return [];
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

// Corner field keys are "<side>-<parameter>": the side is carried in the key so
// the linked and unlinked forms reach the same writer, which is what decides
// whether one side or both take the value.
function cornerValuesFromField(name, value) {
  const [side, parameter] = String(name).split("-");
  if (side !== "left" && side !== "right") {
    return null;
  }
  if (parameter === "distance") {
    return { side, distance: Number(value) };
  }
  if (parameter === "curvature") {
    return { side, curvature: Number(value) / 100 };
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
    // True while one of this panel's own fields is streaming a drag. It stops a
    // REBUILD mid-drag, which would replace the input under the hand. It does
    // not stop a refresh: the other fields have to read live, the way they do
    // under a canvas drag, and _applyFormContents already leaves the active
    // field alone. Blocking the whole update instead left total, left, right and
    // distribution disagreeing with the shape until the mouse came off.
    this._streamingFieldEdit = false;
    this._throttledGlyphChangeUpdate = throttleCalls(() => {
      this._forceRebuild = true;
      this.update();
    }, 100);
    // An edit that changes WHICH controls the panel shows has to wait for its
    // own echo. The rebuild we run the moment the edit resolves reads the
    // positioned glyph, and that has not been recomputed yet — so it renders
    // the state from before the edit, and the panel sits one action behind
    // until something else moves. A value edit does not have this problem,
    // because the input already holds the number it reported to us.
    this._rebuildOnOwnEcho = false;
    this.sceneController.addCurrentGlyphChangeListener((event) => {
      // Our own edits already rebuild in _onFieldChange; their async echo
      // (postChange broadcast) must not schedule a second rebuild — the
      // trailing rebuild replaces the slider input the user may already be
      // dragging again and can briefly read not-yet-settled values.
      if (event?.senderID === SKELETON_PANEL_SENDER) {
        // A drag on one of our own fields: let it through, so every other field
        // follows the number being dragged. The pass is values-only.
        if (this._streamingFieldEdit) {
          this._throttledGlyphChangeUpdate();
          return;
        }
        if (!this._rebuildOnOwnEcho) {
          return;
        }
        this._rebuildOnOwnEcho = false;
      }
      this._throttledGlyphChangeUpdate();
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
    // Above the no-skeleton and no-selection branches, so it is there whatever
    // is selected. It is a generator setting: it applies to every outline the
    // generator writes, not to the points that happen to be selected.
    const dropDeadPoints =
      this._resolveSourceDefault(
        SKELETON_SOURCE_DEFAULT_KEYS.SERIF_REMOVE_COLLAPSED
      ) === true;
    formContents.push({
      type: "checkbox",
      key: `generator:dropDeadPoints`,
      label: translate("sidebar.skeleton-parameters.drop-dead-points"),
      value: dropDeadPoints,
    });
    if (dropDeadPoints) {
      formContents.push({
        type: "text",
        value: translate("sidebar.skeleton-parameters.drop-dead-points.warning"),
      });
    }

    if (!skeletonData) {
      formContents.push({
        type: "text",
        value: translate("sidebar.skeleton-parameters.no-skeleton"),
      });
      this._lastFormLayout = null;
      this.infoForm.setFieldDescriptions(formContents);
      // The generator switch is in this form even here, so the form still
      // needs a working handler.
      this.infoForm.onFieldChange = (fieldItem, value, valueStream) =>
        this._onFieldChange(fieldItem, value, valueStream);
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
    // A rebuild while one of our fields streams would replace the input under
    // the hand and lock the drag's direction. The layout is stable through a
    // value drag anyway, so reaching here mid-drag means something else changed
    // the shape of the panel, and it can wait until the drag ends.
    if (this._streamingFieldEdit) {
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
          capBallEasing: DEFAULT_CAP_BALL_EASING,
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
    // The rib angle lock sits with the point rather than with the cap. It is a
    // property of the point's rib and it applies at every point: at a terminal
    // it decides the rib the cap is built on, and at a corner it replaces the
    // line that splits the angle between the two arms, so both arms' edge ends
    // land on the forced rib and the corner sits at a plain half-width along it.
    const ribAngleLock = summarizeSkeletonRibAngleLockSelection(widthPoints);
    formContents.push({
      type: "select",
      key: "width:ribanglelock",
      label: translate("sidebar.skeleton-parameters.rib-angle-lock"),
      value: ribAngleLock.mixed ? "" : (ribAngleLock.value ?? "auto"),
      disabled: !ribAngleLock.canEdit,
      options: [
        ...(ribAngleLock.mixed ? [{ value: "", label: "mixed", disabled: true }] : []),
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
      // Easing, not tension: this sets how far back along the inner edge the
      // neck starts, as a percent of the run to the next generated on-curve.
      // 100 collapses the two, and there is no geometry past it — so the slider
      // ends there and typing cannot reach beyond it either.
      const easingSummary = {
        value: Math.round((cap.capBallEasing.value ?? DEFAULT_CAP_BALL_EASING) * 100),
        mixed: cap.capBallEasing.mixed,
      };
      this._pushSummarySlider(
        formContents,
        "cap:balleasing",
        "cap-ball-easing",
        easingSummary,
        0,
        CAP_BALL_EASING_MAX,
        Math.round(DEFAULT_CAP_BALL_EASING * 100),
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

  // Corner rounding: the angle-point rounding engine, NOT cap parameters. Two
  // numbers per side of the stroke, gated to angle points (non-smooth,
  // non-endpoint). Distance is font units and scrubs off its label; curvature
  // is a percentage on the same scale the serif's easing and the curvature
  // gizmo use. Linked shows one pair and writes both sides.
  _buildCornerSection(formContents, widthPoints) {
    const corner = summarizeSkeletonCornerSelection(widthPoints);
    formContents.push({ type: "divider" });
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.corner-rounding"),
    });
    const gate = { disabled: !corner.canEdit };
    formContents.push({
      type: "checkbox",
      key: "corner:linked",
      label: translate("sidebar.skeleton-parameters.linked"),
      value: corner.linked.mixed ? false : corner.linked.value,
      ...gate,
    });
    const asPercent = (summary) => ({
      value: summary.value == null ? null : Math.round(summary.value * 100),
      mixed: summary.mixed,
    });
    // Linked writes both sides from one pair, so only the left is offered — the
    // side the key names is the side the writer starts from.
    const linked = !corner.linked.mixed && corner.linked.value;
    const sides = linked ? ["left"] : ["left", "right"];
    for (const side of sides) {
      this._pushSummaryNumber(
        formContents,
        `corner:${side}-distance`,
        linked ? "corner-distance" : `corner-distance-${side}`,
        corner[side].distance,
        { minValue: 0, ...gate }
      );
      this._pushSummarySlider(
        formContents,
        `corner:${side}-curvature`,
        linked ? "corner-curvature" : `corner-curvature-${side}`,
        asPercent(corner[side].curvature),
        0,
        100,
        55,
        { step: 1, ...gate }
      );
    }
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
    // Three independent locks, one row each. The old single control could not
    // say which of the three the designer meant.
    for (const kind of SKELETON_LOCK_KINDS) {
      const value = summary.locked[kind];
      formContents.push({
        type: "checkbox",
        key: `rib:locked-${kind}`,
        label: translate(`sidebar.skeleton-parameters.locked.${kind}`),
        value: value.mixed ? false : value.value,
        indeterminate: value.mixed,
      });
    }
    // Detach is available whatever is locked. It does not move the handle; it
    // changes how the handle's stored offset is measured, and a handle lock
    // holds the handle where it is either way.
    formContents.push({
      type: "checkbox",
      key: "rib:detached",
      label: translate("sidebar.skeleton-parameters.detached"),
      value: summary.detached.mixed ? false : summary.detached.value,
    });
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
  // ratios.
  //
  // Which sides the terminal is built on is a segmented control: both, L or R.
  // A side outside it generates nothing. From a one-sided terminal a button
  // creates the opposite side, which is the only route to two wings shaped
  // apart; from there each section carries a symmetrize that copies itself over
  // the other and collapses back to one set of controls.
  _buildSerifSection(formContents, widthPoints, canEdit) {
    const serif = summarizeSkeletonSerifSelection(widthPoints);
    const sides = serif.sides.mixed ? null : (serif.sides.value ?? "both");
    const split = sides === "split";
    // Collapsing two wings the designer has actually shaped would throw one of
    // them away, so "both" stops being offered once they differ. Symmetrize is
    // the way back from there, because it says which shape survives.
    const halvesDiffer = SERIF_HALF_FIELDS.some((field) => {
      const left = serif.left[field];
      const right = serif.right[field];
      return left.mixed || right.mixed || left.value !== right.value;
    });

    // A segmented control, not three loose buttons: joined, with the live
    // segment filled.
    const tab = (option, label, disabled) =>
      html.button(
        {
          disabled: disabled || !canEdit,
          style: `
            flex: 1 1 0; min-width: 3em; margin: 0; border-radius: 0;
            border: 1px solid var(--horizontal-rule-color, #8888);
            ${option === "both" ? "border-radius: 4px 0 0 4px;" : "border-left: none;"}
            ${option === "right" ? "border-radius: 0 4px 4px 0;" : ""}
            ${
              sides === option || (option === "both" && split)
                ? "background: var(--editor-text-entry-input-background-color, #8884); font-weight: bold;"
                : "background: transparent; opacity: 0.6;"
            }
          `,
          onclick: () => this._onSerifChange("sides", option),
        },
        [label]
      );

    formContents.push({
      type: "single-icon",
      // Which segment is lit shows in the styling, not in the row's text, so the
      // layout signature would miss an L-to-R switch and leave the highlight
      // behind. The key carries it instead; nothing reads it as a field.
      key: `serif:sides-tabs-${sides ?? "mixed"}-${halvesDiffer ? "differ" : "same"}`,
      element: html.div({ style: "display:flex; align-items:center; gap:0.5rem;" }, [
        html.span({ style: "opacity:0.65;" }, [
          translate("sidebar.skeleton-parameters.serif-sides"),
        ]),
        html.div({ style: "display:flex; flex: 1 1 auto;" }, [
          tab(
            "both",
            translate("sidebar.skeleton-parameters.serif-sides.both"),
            split && halvesDiffer
          ),
          tab("left", translate("sidebar.skeleton-parameters.serif-sides.left"), false),
          tab(
            "right",
            translate("sidebar.skeleton-parameters.serif-sides.right"),
            false
          ),
        ]),
      ]),
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

    // Copies its own side over the other and ties them, so the terminal goes
    // back to one set of controls. Which shape survives is the designer's pick,
    // which is why it sits in the section rather than on the "both" tab.
    const pushSymmetrize = (side) => {
      formContents.push({
        type: "single-icon",
        element: html.div({}, [
          html.button(
            {
              disabled: !canEdit,
              onclick: () => this._onSerifChange("symmetrize", side),
            },
            [translate("sidebar.skeleton-parameters.serif-symmetrize")]
          ),
        ]),
      });
    };

    if (split) {
      formContents.push({
        type: "header",
        label: translate("sidebar.skeleton-parameters.serif-left"),
      });
      pushHalf("left", serif.left);
      pushSymmetrize("left");
      formContents.push({
        type: "header",
        label: translate("sidebar.skeleton-parameters.serif-right"),
      });
      pushHalf("right", serif.right);
      pushSymmetrize("right");
    } else if (sides === "left" || sides === "right") {
      // The two halves are held identical while only one is built, so the
      // fields write to both and switching back to "both" shows the shape that
      // is on screen rather than whatever the dead side was left holding.
      pushHalf("both", serif[sides]);
      formContents.push({
        type: "single-icon",
        element: html.div({}, [
          html.button(
            {
              disabled: !canEdit,
              onclick: () => this._onSerifChange("addOtherSide", sides),
            },
            [translate("sidebar.skeleton-parameters.serif-add-other-side")]
          ),
        ]),
      });
    } else {
      pushHalf("both", serif.left);
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
    // One curve across the whole terminal, so these are shared rather than per
    // half: a cup on each half would meet at a break in the middle. Three
    // numbers: the depth sets how deep the foot centre sits, the balance slides
    // that centre from tip to tip, and the tension sets how long the four
    // handles reaching it are.
    pushLength("serif:cup", "serif-underside-cup", serif.undersideCup);
    this._pushSummarySlider(
      formContents,
      "serif:cupbalance",
      "serif-underside-cup-balance",
      percentSummary(serif.undersideCupBalance),
      -100,
      100,
      0,
      { step: 1, disabled: !canEdit }
    );
    this._pushSummarySlider(
      formContents,
      "serif:cuptension",
      "serif-underside-cup-tension",
      percentSummary(serif.undersideCupTension),
      0,
      100,
      Math.round(DEFAULT_UNDERSIDE_CUP_TENSION * 100),
      { step: 1, disabled: !canEdit }
    );
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
    return (
      serif.sides.mixed ||
      serif.undersideCup.mixed ||
      serif.undersideCupTension.mixed ||
      serif.undersideCupBalance.mixed
    );
  }

  // The setting lives with the master, because the outline it changes is
  // written into the master's glyphs. The switch is in this panel because it is
  // a generator setting a designer reaches for while drawing.
  async _onGeneratorChange(name, value) {
    if (name !== "dropDeadPoints") {
      return;
    }
    await this._persistSourceDefaultValues({
      [SKELETON_SOURCE_DEFAULT_KEYS.SERIF_REMOVE_COLLAPSED]: value === true,
    });
    // The outline is stored, not recomputed on every draw, so the open glyph
    // keeps the old one until something edits it. A mutation that changes
    // nothing is enough to make it regenerate.
    const glyphName = this.sceneController.sceneSettings?.selectedGlyphName;
    if (!glyphName || this.fontController.readOnly) {
      return;
    }
    await this.sceneController.editGlyphAndRecordChanges(
      (glyph) => {
        for (const layer of Object.values(glyph.layers || {})) {
          if (getSkeletonData(layer.glyph)) {
            editSkeleton(layer.glyph, () => {});
          }
        }
        return translate("sidebar.skeleton-parameters.undo.set-defaults");
      },
      this,
      false
    );
  }

  async _persistSourceDefaultValues(values) {
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
        setSourceSkeletonDefaultsValues(source, values);
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

  async _persistSerifPresetList(next) {
    await this._persistSourceDefaultValues({
      [SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_SERIFS]: next,
    });
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
    this._streamingFieldEdit = true;
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
            : name === "cuptension"
              ? { undersideCupTension: Number(streamed) / 100 }
              : name === "cupbalance"
                ? { undersideCupBalance: Number(streamed) / 100 }
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
      } else if (group === "generator") {
        await this._onGeneratorChange(name, finalValue);
      }
    } finally {
      this._streamingFieldEdit = false;
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
    } else if (group === "corner") {
      const side = String(name).split("-")[0];
      if (side !== "left" && side !== "right") {
        return;
      }
      await scalePanelCornerDistance(
        sc,
        this._widthPoints(),
        side,
        factor,
        this._undo("set-corner")
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
    if (group === "corner") {
      const side = String(name).split("-")[0];
      if (side === "left" || side === "right") {
        await nudgePanelCornerDistanceStream(
          sc,
          this._widthPoints(),
          side,
          valueStream,
          this._undo("set-corner")
        );
      }
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

    // The side control is three buttons and two more below them, none of which
    // is a form field, so nothing on this route passes through the form's own
    // change handler. These edits also change which controls exist rather than
    // what they hold, so the rebuild has to happen against settled data —
    // hence the echo, not an immediate call. Every branch that writes `sides`
    // goes through here.
    const applyAndRebuild = async (values) => {
      this._rebuildOnOwnEcho = true;
      await apply(values);
    };

    // Copy one summarized half onto the other, so the two are identical and one
    // set of controls can describe both. A field that is mixed across the
    // selection stays mixed rather than collapsing onto one number.
    const mirrorOnto = (serif, from) => {
      const other = from === "left" ? "right" : "left";
      const half = {};
      for (const field of SERIF_HALF_FIELDS) {
        half[field] = serif[from][field].mixed ? null : serif[from][field].value;
      }
      return { [other]: half };
    };

    if (name === "sides") {
      if (!VALID_SERIF_SIDES.has(value)) {
        return;
      }
      const serif = summarizeSkeletonSerifSelection(this._widthPoints());
      // Picking a single side keeps the halves identical: only one is built,
      // and the other is what "both" comes back to.
      const values = { sides: value };
      if (value === "left" || value === "right") {
        Object.assign(values, mirrorOnto(serif, value));
      }
      await applyAndRebuild(values);
      return;
    }
    if (name === "addOtherSide") {
      // The halves already match, so the new side arrives as a copy of the one
      // that was drawn. Shaping them apart is the whole of it.
      await applyAndRebuild({ sides: "split" });
      return;
    }
    if (name === "symmetrize") {
      const serif = summarizeSkeletonSerifSelection(this._widthPoints());
      await applyAndRebuild({ sides: "both", ...mirrorOnto(serif, value) });
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
    if (name === "cuptension") {
      await apply({
        undersideCupTension: value == null ? null : Number(value) / 100,
      });
      return;
    }
    if (name === "cupbalance") {
      await apply({
        undersideCupBalance: value == null ? null : Number(value) / 100,
      });
      return;
    }
    const values = serifHalfValuesFromField(name, value);
    if (values) {
      await apply(values);
    }
  }

  async _onCornerChange(name, value) {
    const values =
      name === "linked"
        ? { linked: value === true }
        : cornerValuesFromField(name, value);
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
    if (name.startsWith("locked-")) {
      const kind = name.slice("locked-".length);
      await setPanelRibLocked(
        this.sceneController,
        this._ribTargets,
        kind,
        value === true,
        this._undo(`set-rib-locked-${kind}`)
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

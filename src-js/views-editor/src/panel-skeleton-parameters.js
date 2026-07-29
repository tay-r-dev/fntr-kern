import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import {
  SKELETON_SOURCE_DEFAULT_KEYS,
  getSkeletonData,
  getSkeletonGlyphCase,
  resolveEffectiveSourceSkeletonDefault,
  setSkeletonCapParameters,
  setSkeletonCornerParameters,
} from "@fontra/core/skeleton-model.js";
import { throttleCalls } from "@fontra/core/utils.ts";
import { Form } from "@fontra/web-components/ui-form.js";
import Panel from "./panel.js";
import {
  SKELETON_PANEL_SENDER,
  resetPanelGeneratedHandle,
  resetPanelRibs,
  scalePanelPointWidth,
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
    this._capProfileSelection = "base";
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

    this.infoForm.setFieldDescriptions(formContents);
    this.infoForm.onFieldChange = (fieldItem, value, valueStream) =>
      this._onFieldChange(fieldItem, value, valueStream);
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
    this._pushSummaryNumber(formContents, "width:total", "total-width", summary.total);
    // On a single-sided contour the visible edge is the TOTAL, so the per-side
    // numbers and the split between them describe nothing on screen. Greyed and
    // blank rather than hidden: they are still stored, and still what the point
    // goes back to if the contour returns to double-sided.
    const perSideGate = summary.singleSided ? { disabled: true, blank: true } : {};
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
    // Donor: scale 0.2–2.0 in 0.2 steps, shown here in percent; the number
    // input accepts values beyond the slider range.
    formContents.push({
      type: "edit-number-slider",
      key: "width:scale",
      label: translate("sidebar.skeleton-parameters.scale"),
      value: 100,
      minValue: 20,
      defaultValue: 100,
      maxValue: 200,
      step: 20,
      allowInputBeyondRange: true,
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
      summary.defaultWidth
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
    }
    // Force-apply master cap defaults (or a custom cap profile) to the
    // selected endpoints, two-click confirm.
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

  // ---- Field description helpers -------------------------------------------

  _pushSummaryNumber(formContents, key, labelKey, summary, options = {}) {
    const { blank = false, ...fieldOptions } = options;
    formContents.push({
      type: "edit-number",
      key,
      label: translate(`sidebar.skeleton-parameters.${labelKey}`),
      value: blank || summary.mixed ? null : summary.value,
      placeholder: blank ? "" : summary.placeholder || undefined,
      ...fieldOptions,
    });
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
    try {
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
      const finalValue = await this._resolveStreamValue(value, valueStream);
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
      }
    } finally {
      this._suppressGlyphChangeUpdate = false;
      this._forceRebuild = true;
      await this.update();
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
    } else if (name === "scale") {
      await scalePanelPointWidth(
        sc,
        points,
        (Number(value) || 100) / 100,
        this._undo("scale-width")
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
      if (!["butt", "square", "round", "drop"].includes(value)) {
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

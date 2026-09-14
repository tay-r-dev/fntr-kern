import { applicationSettingsController } from "@fontra/core/application-settings.js";
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
import "@fontra/web-components/chain-link.js"; // for <chain-link>, ticket 45
import "@fontra/web-components/compact-scrub-field.js"; // for <compact-scrub-field>, ticket 46
import "@fontra/web-components/multi-select-dropdown.js"; // for <multi-select-dropdown>, ticket 49
import "@fontra/web-components/overflow-button.js"; // for <overflow-button>, ticket 48
import "@fontra/web-components/segmented-control.js"; // for <segmented-control>, ticket 44
import { Form } from "@fontra/web-components/ui-form.js";
import { SELECTION_ROW_GROUP_STYLES } from "./selection-row-group-styles.js";
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
  scalePanelContourDefaultWidth,
  scalePanelCornerDistance,
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
  setPanelPointWidthPreset,
  editSelectedSkeletonInsertions,
  insertionRatioToUnits,
  insertionWidthReference,
  setInsertionEasing,
  setInsertionRatioFromUnits,
  setInsertionWidthLinked,
  setPanelInsertionValuesStream,
  setPanelPointValuesStream,
  setPanelRibAngleLock,
  setPanelRibAngleLockMode,
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
  summarizeSkeletonInsertionSelection,
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
// The model's full range, which the Size field reaches by typing and dragging.
export const CAP_BALL_MIN = 50;
export const CAP_BALL_MAX = 300;
// Ball shape: 0% round -> 100% teardrop, edited as a percent.
const DEFAULT_CAP_BALL_SHAPE = 0;
export const CAP_SHAPE_MIN = 0;
export const CAP_SHAPE_MAX = 100;
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

// Ticket 47: one icon per lock kind. The tooltip carries the full name.
const LOCK_KIND_ICONS = {
  handles: "/tabler-icons/circle-dot.svg",
  slide: "/tabler-icons/arrows-horizontal.svg",
  width: "/tabler-icons/dimensions.svg",
};

// A compact scrub field streams the value under the hand. The width writers
// move each point by a change, so the stream is turned into the change from
// where the drag started. The cancel sentinel passes through untouched.
async function* changesFrom(valueStream, startValue) {
  const start = Number(startValue) || 0;
  for await (const value of valueStream) {
    yield isScrubCancelled(value) ? value : Number(value) - start;
  }
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

// Composed into panel-selection.js's Selection panel, not registered as its
// own sidebar panel (see ticket 05: merge into one "Selection" tab).
export default class SkeletonParametersPanel {
  constructor(editorController, contentElement) {
    this.editorController = editorController;
    this.infoForm = new Form();
    // The Selection panel owns the one scroll area; this part only adds its form.
    contentElement.appendChild(html.div({}, [this.infoForm]));
    this.fontController = this.editorController.fontController;
    this.sceneController = this.editorController.sceneController;
    this.sceneSettingsController = this.editorController.sceneSettingsController;

    this._widthSnapshot = null;
    this._widthSnapshotKey = null;
    this._lastSignature = null;
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

    // Ticket 44: a Gizmo/Handles pair at the Skeleton heading's right,
    // replacing the Ribs section's Generated gizmos checkbox. Built once
    // here rather than inside update()'s formContents, so the same node
    // -- and the View menu's own external writes to it -- keep working
    // whether the next update() rebuilds the form or takes its in-place,
    // values-only path (formContentsLayoutSignature unchanged).
    const gizmoHandlesOptions = [
      { value: "gizmo", label: translate("sidebar.skeleton-parameters.mode.gizmo") },
      {
        value: "handles",
        label: translate("sidebar.skeleton-parameters.mode.handles"),
      },
    ];
    this.gizmoHandlesControl = html.createDomElement("segmented-control", {
      options: gizmoHandlesOptions,
      value: this._generatedGizmosEnabled() ? "gizmo" : "handles",
    });
    this.gizmoHandlesControl.addEventListener("change", (event) => {
      this.editorController.visualizationLayersSettings.model[
        "fontra.skeleton.generated-tunni"
      ] = event.detail.value === "gizmo";
    });
    this.editorController.visualizationLayersSettings.addKeyListener(
      "fontra.skeleton.generated-tunni",
      (event) => {
        this.gizmoHandlesControl.value = event.newValue === true ? "gizmo" : "handles";
      }
    );

    // Ticket 45: the chain between Left and Right, bound to `width:linked`.
    // Built once, like the Gizmo/Handles pair, so a values-only refresh keeps
    // the same node and the rebuild just re-places it. Its state is set on
    // every update from the selection.
    this.widthChain = html.createDomElement("chain-link", {
      tooltip: translate("sidebar.skeleton-parameters.linked"),
    });
    this.widthChain.addEventListener("change", async (event) => {
      await this._onWidthChange("linked", event.detail.linked);
      this._forceRebuild = true;
      await this.update();
    });

    // Ticket 46: Total and Distribution on one row, then Left, chain, Right,
    // as compact scrub fields. The fields AND their rows are built once. A row
    // built inside update() would take these nodes with it as it is built, and
    // on a values-only refresh that row is never placed, so the fields would
    // leave the live form.
    this._scrubbingFields = new Set();
    this.widthFields = {
      total: this._makeWidthField("total", "total-width"),
      distribution: this._makeWidthField("distribution", "distribution"),
      left: this._makeWidthField("left", "left-width"),
      right: this._makeWidthField("right", "right-width"),
    };
    const fieldRow = (children) =>
      html.div(
        { style: "display: flex; gap: 0.35rem; align-items: center;" },
        children
      );
    this.widthTotalRow = fieldRow([
      this.widthFields.total,
      this.widthFields.distribution,
    ]);
    this.widthSidesRow = fieldRow([
      this.widthFields.left,
      this.widthChain,
      this.widthFields.right,
    ]);

    // Ticket 47: under Generation, one row of labeled icon groups. Lock holds
    // the three lock kinds, Link holds Linked and Tied ribs, Reset holds the
    // three resets. Built once with its row, for the same reason as the width
    // fields; each update sets the buttons' state from the selection.
    this.infoForm.appendStyle(SELECTION_ROW_GROUP_STYLES);
    const iconButton = (src, tooltipKey, onclick) => {
      const button = html.createDomElement("icon-button", {
        "src": src,
        "data-tooltip": translate(`sidebar.skeleton-parameters.${tooltipKey}`),
        "data-tooltipposition": "top",
      });
      button.onclick = onclick;
      return button;
    };
    // A click turns a toggle on unless it is on; a mixed one therefore turns
    // on, which is the one answer that states something about every member.
    const toggleButton = (src, tooltipKey, write) => {
      const button = iconButton(src, tooltipKey, () =>
        this._runOwnEdit(() => write(!button.on))
      );
      return button;
    };
    this.lockButtons = Object.fromEntries(
      SKELETON_LOCK_KINDS.map((kind) => [
        kind,
        toggleButton(LOCK_KIND_ICONS[kind], `locked.${kind}`, (value) =>
          this._onRibChange(`locked-${kind}`, value)
        ),
      ])
    );
    this.linkedButton = toggleButton("/tabler-icons/link.svg", "linked", (value) =>
      this._onWidthChange("linked", value)
    );
    this.tiedButton = toggleButton("/tabler-icons/link-plus.svg", "tied", (value) =>
      this._onWidthChange("tied", value)
    );
    this.resetRibButton = iconButton("/tabler-icons/refresh.svg", "reset-rib", () =>
      this._resetRibs({ handlesOnly: false })
    );
    this.resetHandlesButton = iconButton(
      "/tabler-icons/rotate.svg",
      "reset-handles",
      () => this._resetRibs({ handlesOnly: true })
    );
    this.resetThisHandleButton = iconButton(
      "/tabler-icons/x.svg",
      "reset-this-handle",
      () => this._resetSingleGeneratedHandle()
    );
    const iconGroup = (labelKey, buttons) => [
      html.span({ class: "selection-row-group-label" }, [
        translate(`sidebar.skeleton-parameters.${labelKey}`),
      ]),
      html.div({ class: "selection-row-group-icons" }, buttons),
    ];
    // Ticket 48: Projection is the contour's sides, D, L and R for both, left
    // and right. Its overflow holds the two options on that change: keep
    // shape and preserve changes, which are application settings rather than
    // contour data. Preserve changes stays greyed while keep shape is off.
    this.projectionControl = html.createDomElement("segmented-control", {
      options: ["both", "left", "right"].map((value) => ({
        value,
        label: translate(`sidebar.skeleton-parameters.projection.${value}`),
      })),
    });
    this.projectionControl.addEventListener("change", (event) =>
      this._runOwnEdit(() => this._onContourChange("single-sided", event.detail.value))
    );
    this.projectionOverflow = html.createDomElement("overflow-button", {
      "data-tooltip": translate("sidebar.skeleton-parameters.projection.options"),
      "data-tooltipposition": "top",
    });
    this.projectionOverflow.addEventListener("change", (event) => {
      const checked = event.detail.checked;
      const settings = applicationSettingsController.model;
      settings.skeletonSideModeKeepsForm = checked.includes("keep-form");
      settings.skeletonSideModeKeepsEdits = checked.includes("keep-edits");
      // Before the list reopens, so it shows preserve changes greyed or live
      // the moment keep shape changes.
      this._refreshProjectionOverflow();
    });
    this._refreshProjectionOverflow();
    // Ticket 52: Force angle is the rib angle lock -- Free, Vertical,
    // Horizontal -- offered at every point, as the lock always applied. At a
    // terminal it decides the rib the cap is built on; at a corner it replaces
    // the line that splits the angle between the two arms.
    this.forceAngleControl = html.createDomElement("segmented-control", {
      options: [
        ["auto", "free"],
        ["vertical", "vertical"],
        ["horizontal", "horizontal"],
      ].map(([value, labelKey]) => ({
        value,
        label: translate(`sidebar.skeleton-parameters.force-angle.${labelKey}`),
      })),
    });
    this.forceAngleControl.addEventListener("change", (event) =>
      this._runOwnEdit(() => this._onWidthChange("ribanglelock", event.detail.value))
    );
    // Ticket 53: the lock mode behind Force angle's overflow. A forced rib
    // cannot both keep the stroke as wide as its number and blend cleanly
    // between masters, so the point says which it holds on to. Keeping the
    // stem width runs the rib further to reach the edge, so every master draws
    // its number. Keeping the footprint keeps the bar the number long, which
    // draws a turned stroke thinner and is the one that interpolates.
    this.forceAngleOverflow = html.createDomElement("overflow-button", {
      "data-tooltip": translate("sidebar.skeleton-parameters.rib-angle-lock-mode"),
      "data-tooltipposition": "top",
    });
    this.forceAngleOverflow.singleChoice = true;
    this.forceAngleOverflow.addEventListener("change", (event) => {
      const [mode] = [].concat(event.detail.checked);
      if (mode) {
        this._runOwnEdit(() => this._onWidthChange("ribanglelockmode", mode));
      }
    });
    // Ticket 49: the Generation header's preset control -- a dropdown, Add and
    // Update. A preset is a total width and a projection side. Picking one
    // applies it at once. Add stores the selection's total and projection as a
    // new preset for the glyph's case; Update writes them over the preset last
    // picked. The dropdown shows no picked state: its label stays "Preset".
    this._widthPresetIndex = null;
    this.widthPresetDropdown = html.createDomElement("multi-select-dropdown", {
      label: translate("sidebar.skeleton-parameters.width-preset"),
    });
    this.widthPresetDropdown.singleChoice = true;
    this.widthPresetDropdown.addEventListener("change", (event) => {
      const [index] = [].concat(event.detail.checked);
      const preset = index == null ? null : this._widthPresetList()[index];
      if (!preset) {
        return;
      }
      this._widthPresetIndex = index;
      this._applyWidthPreset(preset);
    });
    this.widthPresetAddButton = html.button({ onclick: () => this._addWidthPreset() }, [
      translate("sidebar.skeleton-parameters.width-preset.add"),
    ]);
    this.widthPresetUpdateButton = html.button(
      { onclick: () => this._updateWidthPreset() },
      [translate("sidebar.skeleton-parameters.width-preset.update")]
    );
    this.widthPresetHeaderControls = html.div(
      {
        style: "display: flex; gap: 0.35rem; align-items: center; font-weight: normal;",
      },
      [
        this.widthPresetDropdown,
        this.widthPresetAddButton,
        this.widthPresetUpdateButton,
      ]
    );
    // Ticket 50: the terminal kind, five across, writing the cap style. Picking
    // a kind changes which section the panel shows, so the rebuild waits for
    // the edit's own echo, as the serif sides row does. Picking Serif applies
    // Egyptian, through the same style writer the select used.
    this.terminalKindControl = html.createDomElement("segmented-control", {
      options: [
        ["butt", "flat"],
        ["square", "square"],
        ["round", "round"],
        ["drop", "drop"],
        ["serif", "serif"],
      ].map(([value, labelKey]) => ({
        value,
        label: translate(`sidebar.skeleton-parameters.cap-style.${labelKey}`),
      })),
    });
    this.terminalKindControl.addEventListener("change", (event) => {
      this._rebuildOnOwnEcho = true;
      this._runOwnEdit(() => this._onCapChange("style", event.detail.value));
    });
    this.terminalKindRow = html.div({ style: "display: flex;" }, [
      this.terminalKindControl,
    ]);
    this.terminalKindControl.style.flex = "1 1 auto";

    // Ticket 51: the Square section, Project angle and Distance.
    this.capFields = {
      angle: this._makeCapField("angle", "cap-angle"),
      distance: this._makeCapField("distance", "cap-distance"),
    };
    this.squareRow = fieldRow([this.capFields.angle, this.capFields.distance]);
    // Ticket 54: the Rounded section. Radius keeps its logarithmic display, a
    // position from 1 to 20, and Roundness its percent; capValuesFromField
    // converts both back to the stored ratio.
    this.capFields.radius = this._makeCapField("radius", "cap-radius");
    this.capFields.tension = this._makeCapField("tension", "cap-tension");
    this.roundedRow = fieldRow([this.capFields.radius, this.capFields.tension]);
    // Ticket 55: the Ball section, Size, Shape and Ease, each in percent.
    this.capFields.ball = this._makeCapField("ball", "cap-ball");
    this.capFields.ballshape = this._makeCapField("ballshape", "cap-ball-shape");
    this.capFields.balleasing = this._makeCapField("balleasing", "cap-ball-easing");
    this.ballRow = fieldRow([
      this.capFields.ball,
      this.capFields.ballshape,
      this.capFields.balleasing,
    ]);
    this.forceAngleRow = html.div({ class: "selection-row-group" }, [
      html.span({ class: "selection-row-group-label" }, [
        translate("sidebar.skeleton-parameters.force-angle"),
      ]),
      html.div({ class: "selection-row-group-icons" }, [
        this.forceAngleControl,
        this.forceAngleOverflow,
      ]),
    ]);
    this.generationIconRow = html.div({ class: "selection-row-group" }, [
      ...iconGroup("group.lock", Object.values(this.lockButtons)),
      ...iconGroup("group.projection", [
        this.projectionControl,
        this.projectionOverflow,
      ]),
      ...iconGroup("group.link", [this.linkedButton, this.tiedButton]),
      ...iconGroup("group.reset", [
        this.resetRibButton,
        this.resetHandlesButton,
        this.resetThisHandleButton,
      ]),
    ]);
  }

  // One compact scrub field that lives for the life of the panel. A drag runs
  // `scrub` once with the field's value stream, as one undo step; a typed value
  // runs `commit`. `key` names the field while it is under the hand, so a
  // refresh leaves it alone.
  _makeCompactField(key, labelKey, { scrub, commit }) {
    const field = html.createDomElement("compact-scrub-field", {
      label: translate(`sidebar.skeleton-parameters.${labelKey}`),
      integer: true,
    });
    field.style.flex = "1 1 0";
    field.style.minWidth = "0";
    field.addEventListener("scrubstart", (event) => {
      const { valueStream, startValue } = event.detail;
      this._scrubbingFields.add(key);
      this._runOwnEdit(async () => {
        try {
          await scrub(valueStream, startValue);
        } finally {
          // Before the closing refresh, so the field takes the number the
          // model settled on rather than the one the drag reached.
          this._scrubbingFields.delete(key);
        }
      });
    });
    field.addEventListener("change", (event) => {
      // A drag reports every frame as a change too; the stream above owns those.
      if (this._scrubbingFields.has(key) || event.detail.cancelled) {
        return;
      }
      this._runOwnEdit(() => commit(event.detail.value));
    });
    return field;
  }

  // One Generation width field. A drag moves every selected point by the
  // change from where it started, so a mixed selection stays mixed. A typed
  // value sets every point. Distribution is the one field that streams a value
  // rather than a change, as its slider did.
  _makeWidthField(name, labelKey) {
    return this._makeCompactField(`width:${name}`, labelKey, {
      scrub: (valueStream, startValue) =>
        name === "distribution"
          ? setPanelPointDistributionStream(
              this.sceneController,
              this._widthPoints(),
              valueStream,
              this._undo("set-distribution")
            )
          : nudgePanelPointWidthStream(
              this.sceneController,
              this._widthPoints(),
              name,
              changesFrom(valueStream, startValue),
              this._undo("set-width")
            ),
      commit: (value) => this._onWidthChange(name, value),
    });
  }

  // One Terminal field, named as capValuesFromField names it, which converts
  // the panel's unit to the stored one. Distance drags by a change, as its
  // label scrub did; every other field streams its value, as its slider did.
  _makeCapField(name, labelKey) {
    return this._makeCompactField(`cap:${name}`, labelKey, {
      scrub: (valueStream, startValue) =>
        name === "distance"
          ? nudgePanelCapParameterStream(
              this.sceneController,
              this._widthPoints(),
              "capDistance",
              changesFrom(valueStream, startValue),
              this._undo("set-cap")
            )
          : setPanelPointValuesStream(
              this.sceneController,
              this._widthPoints(),
              valueStream,
              (point, contour, value) =>
                setSkeletonCapParameters(point, capValuesFromField(name, value)),
              this._undo("set-cap")
            ),
      commit: (value) => this._onCapChange(name, value),
    });
  }

  // Every width preset the current master stores, both cases, in stored order.
  // Indices into this list are what the dropdown's items carry, so Update
  // writes the entry that was picked rather than its position in one case.
  _widthPresetList() {
    const list = this._resolveSourceDefault(SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_PRESETS);
    return Array.isArray(list) ? list.map((preset) => ({ ...preset })) : [];
  }

  // The total width and the projection side the selection states, or null
  // where it states none: a selection whose totals or whose contours'
  // projections disagree has no one preset to store.
  _selectionWidthPreset() {
    const points = this._widthPoints?.() || [];
    const contours = this._panelSelection?.contours || [];
    if (!points.length || !contours.length) {
      return null;
    }
    const total = summarizeSkeletonPointWidths(points).total;
    const projection = summarizeSkeletonContourSelection(contours).singleSided;
    if (total.mixed || total.value == null || projection.mixed) {
      return null;
    }
    return { width: total.value, side: projection.value ?? "both" };
  }

  // Applying a preset switches the selection's contours to its projection,
  // with the Keep shape and Preserve changes settings, then writes its total
  // width to the selected points. The projection goes first, so the total the
  // preset states is the total the points end with.
  async _applyWidthPreset(preset) {
    const points = this._widthPoints();
    const contours = this._panelSelection?.contours || [];
    if (!points.length) {
      return;
    }
    const settings = applicationSettingsController.model;
    await this._runOwnEdit(async () => {
      const current = summarizeSkeletonContourSelection(contours).singleSided;
      const target =
        preset.side === "left" || preset.side === "right" ? preset.side : null;
      if (contours.length && (current.mixed || (current.value ?? null) !== target)) {
        await setPanelContourSingleSided(
          this.sceneController,
          contours,
          target,
          this._undo("set-single-sided"),
          {
            keepForm: settings.skeletonSideModeKeepsForm === true,
            keepEdits: settings.skeletonSideModeKeepsEdits === true,
          }
        );
      }
      await setPanelPointWidthPreset(
        this.sceneController,
        points,
        { width: Number(preset.width), side: preset.side },
        this._undo("set-total-width")
      );
    });
  }

  _canCaptureWidthPreset() {
    return !this.fontController.readOnly && this._selectionWidthPreset() !== null;
  }

  _refreshWidthPresetControls() {
    const glyphCase = getSkeletonGlyphCase(this.getSelectedGlyphName());
    const list = this._widthPresetList();
    if (this._widthPresetIndex != null && !list[this._widthPresetIndex]) {
      this._widthPresetIndex = null;
    }
    this.widthPresetDropdown.items = list
      .map((preset, index) => ({ preset, index }))
      .filter(({ preset }) => preset?.case === glyphCase)
      .map(({ preset, index }) => ({
        value: index,
        label: `${preset.name || ""} · ${preset.width}${
          preset.side === "both" ? "" : ` ${preset.side === "left" ? "L" : "R"}`
        }`,
        checked: false,
      }));
    // A list with nothing in it opened as an empty frame.
    if (!this.widthPresetDropdown.items.length) {
      this.widthPresetDropdown.items = [
        {
          value: null,
          label: translate("sidebar.skeleton-parameters.width-preset.none"),
          disabled: true,
        },
      ];
    }
    const canCapture = this._canCaptureWidthPreset();
    this.widthPresetAddButton.disabled = !canCapture;
    this.widthPresetUpdateButton.disabled =
      !canCapture || this._widthPresetIndex == null;
  }

  async _addWidthPreset() {
    const captured = this._selectionWidthPreset();
    if (!captured) {
      return;
    }
    const glyphCase = getSkeletonGlyphCase(this.getSelectedGlyphName());
    const list = this._widthPresetList();
    const count = list.filter((preset) => preset.case === glyphCase).length;
    list.push({
      name: `${translate("sidebar.skeleton-parameters.width-preset")} ${count + 1}`,
      width: captured.width,
      side: captured.side,
      case: glyphCase,
    });
    this._widthPresetIndex = list.length - 1;
    await this._persistSourceDefaultValues({
      [SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_PRESETS]: list,
    });
    this._forceRebuild = true;
    await this.update();
  }

  async _updateWidthPreset() {
    const captured = this._selectionWidthPreset();
    const list = this._widthPresetList();
    const index = this._widthPresetIndex;
    if (!captured || index == null || !list[index]) {
      return;
    }
    // The name and case stay; the preset is the same entry with new numbers.
    list[index] = { ...list[index], width: captured.width, side: captured.side };
    await this._persistSourceDefaultValues({
      [SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_PRESETS]: list,
    });
    this._forceRebuild = true;
    await this.update();
  }

  // The two projection options, read from the application settings.
  _refreshProjectionOverflow() {
    const settings = applicationSettingsController.model;
    const keepForm = settings.skeletonSideModeKeepsForm === true;
    this.projectionOverflow.items = [
      {
        value: "keep-form",
        label: translate("sidebar.skeleton-parameters.sides.keep-form"),
        checked: keepForm,
      },
      {
        value: "keep-edits",
        label: translate("sidebar.skeleton-parameters.sides.keep-edits"),
        checked: settings.skeletonSideModeKeepsEdits === true,
        disabled: !keepForm,
      },
    ];
  }

  // The bracket every one of this panel's own edits runs in, for the elements
  // that are not form fields: the echo of the edit refreshes values while it
  // runs, and the panel rebuilds against the result when it ends.
  async _runOwnEdit(run) {
    this._streamingFieldEdit = true;
    try {
      await run();
    } finally {
      this._streamingFieldEdit = false;
      this._forceRebuild = true;
      await this.update();
    }
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

  _getEditLayerGlyph(positionedGlyph) {
    if (!positionedGlyph) {
      return null;
    }
    const editLayerName =
      this.sceneSettingsController.model?.editLayerName ||
      positionedGlyph.glyph?.layerName;
    const layerGlyph =
      editLayerName && positionedGlyph.varGlyph?.glyph?.layers?.[editLayerName]?.glyph;
    return layerGlyph || positionedGlyph.glyph || null;
  }

  _getEditLayerSkeletonData(positionedGlyph) {
    return getSkeletonData(this._getEditLayerGlyph(positionedGlyph));
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
      {
        type: "header",
        label: translate("sidebar.skeleton-parameters.title"),
        auxiliaryElement: this.gizmoHandlesControl,
      },
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
    this._ribsDerived = ribsDerived;
    // Before Generation, whose Reset group offers the narrow reset only while
    // one generated handle is selected.
    this._singleGeneratedHandle = singleGeneratedHandleTarget(panelSelection);
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
    const insertions = panelSelection.insertions || [];
    this._insertions = insertions;
    if (insertions.length) {
      this._buildInsertionSection(formContents, insertions);
    }

    if (
      !widthPoints.length &&
      !panelSelection.contours.length &&
      !ribTargets.length &&
      !insertions.length
    ) {
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
    this._refreshWidthPresetControls();
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.generation"),
      auxiliaryElement: this.widthPresetHeaderControls,
    });
    // On a single-sided contour the visible edge is the TOTAL, so the per-side
    // numbers and the split between them describe nothing on screen. Greyed and
    // blank rather than hidden: they are still stored, and still what the point
    // goes back to if the contour returns to double-sided.
    const sidesGate = { disabled: summary.singleSided, blank: summary.singleSided };
    // Ticket 45: a closed chain greys Right. Left is then the one place a side
    // is typed, and the writer carries the other side by its share. The chain
    // changes how numbers are typed and nothing else -- a drag never reads the
    // flag (feature model §5).
    const linkedClosed = !summary.linked.mixed && summary.linked.value === true;
    this.widthChain.linked = summary.linked.mixed ? null : summary.linked.value;
    this.widthChain.disabled = summary.singleSided;
    // The minimum is declared rather than left to the model: without it a drag
    // past the bottom keeps counting down in the box while the stroke has
    // stopped. A mixed field has no start value, so it drags from zero by the
    // change alone and takes no floor.
    this._refreshWidthField("total", summary.total, { minValue: 0 });
    this._refreshWidthField("distribution", summary.distribution, {
      ...sidesGate,
      minValue: -100,
      maxValue: 100,
      round: true,
    });
    this._refreshWidthField("left", summary.left, { ...sidesGate, minValue: 0 });
    this._refreshWidthField("right", summary.right, {
      ...sidesGate,
      disabled: sidesGate.disabled || linkedClosed,
      minValue: 0,
    });
    formContents.push({ type: "single-icon", element: this.widthTotalRow });
    formContents.push({ type: "single-icon", element: this.widthSidesRow });

    // Ticket 52: Force angle, under the widths. The rib angle lock is a
    // property of the point's rib, so every selected point offers it. A mixed
    // selection lights no segment.
    const ribAngleLock = summarizeSkeletonRibAngleLockSelection(widthPoints);
    this.forceAngleControl.value = ribAngleLock.mixed
      ? undefined
      : (ribAngleLock.value ?? "auto");
    this.forceAngleControl.disabled = !ribAngleLock.canEdit;
    // Ticket 53: one mode checked, none while the selection disagrees, and
    // greyed while Force angle is Free, because the mode decides nothing then.
    const lockMode = ribAngleLock.mode;
    this.forceAngleOverflow.items = ["stroke", "rib"].map((value) => ({
      value,
      label: translate(`sidebar.skeleton-parameters.rib-angle-lock-mode.${value}`),
      checked: !lockMode.mixed && (lockMode.value ?? "stroke") === value,
    }));
    this.forceAngleOverflow.disabled = !lockMode.canEdit;
    formContents.push({ type: "single-icon", element: this.forceAngleRow });

    // Ticket 47: Lock, Link and Reset. Tied ribs only has an effect on a smooth
    // point whose one handle faces away from a straight segment; harmless
    // elsewhere, so it is always offered rather than coming and going.
    const ribs = this._ribTargets || [];
    const ribSummary = summarizeSkeletonRibSelection(ribs);
    const setToggle = (button, reduced, disabled = false) => {
      button.mixed = reduced.mixed;
      button.on = !reduced.mixed && reduced.value === true;
      button.disabled = disabled;
    };
    for (const kind of SKELETON_LOCK_KINDS) {
      setToggle(this.lockButtons[kind], ribSummary.locked[kind], !ribs.length);
    }
    setToggle(this.linkedButton, summary.linked);
    setToggle(this.tiedButton, summary.tied);
    // Projection reads the contours the selection touches. A mixed selection
    // lights no segment.
    const contours = this._panelSelection?.contours || [];
    const sides = summarizeSkeletonContourSelection(contours).singleSided;
    this.projectionControl.value = sides.mixed ? undefined : (sides.value ?? "both");
    this.projectionControl.disabled = !contours.length;
    this.projectionOverflow.disabled = !contours.length;
    this._refreshProjectionOverflow();
    // Derived targets cover both sides of each selected point, so the reset
    // says so; an explicit rib selection resets just that rib.
    this.resetRibButton.setAttribute(
      "data-tooltip",
      translate(
        this._ribsDerived && ribs.length > 1
          ? "sidebar.skeleton-parameters.reset-ribs-both"
          : "sidebar.skeleton-parameters.reset-rib"
      )
    );
    this.resetRibButton.disabled = !ribs.length;
    this.resetHandlesButton.disabled = !ribs.length;
    // The narrow reset clears one generated handle and leaves its pair alone
    // (5.3), so it is live only with exactly one of them selected.
    this.resetThisHandleButton.disabled = !this._singleGeneratedHandle;
    formContents.push({ type: "single-icon", element: this.generationIconRow });
    // Detached has no place in the image, so it stays a checkbox under the row
    // until the designer places it. It does not move the handle; it changes how
    // the handle's stored offset is measured, so it is offered whatever is
    // locked.
    formContents.push({
      type: "checkbox",
      key: "rib:detached",
      label: translate("sidebar.skeleton-parameters.detached"),
      value: ribSummary.detached.mixed ? false : ribSummary.detached.value,
      indeterminate: ribSummary.detached.mixed,
      disabled: !ribs.length,
    });
  }

  _buildContourSection(formContents, contours) {
    const summary = summarizeSkeletonContourSelection(contours);
    formContents.push({ type: "divider" });
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.contour"),
    });
    // The sides and their two options moved to Generation's Projection group
    // (ticket 48). Off is the plain write, which is what the app has always
    // done: the centerline holds still and the letter moves.
    this._pushSummaryNumber(
      formContents,
      "contour:default-width",
      "contour-default-width",
      summary.defaultWidth,
      { minValue: 0 }
    );
  }

  // Ticket 50: the Terminal section. It is offered only where every selected
  // point is an open endpoint, and a point shows only its own kind's section
  // (UI-REFACTOR §5.2): a terminal never shows beside Corner rounding, and never
  // two terminals at once.
  _buildCapSection(formContents, widthPoints) {
    const cap = summarizeSkeletonCapSelection(widthPoints);
    const capStyle = summarizeSkeletonCapStyleSelection(widthPoints);
    if (!capStyle.canEdit) {
      return;
    }
    formContents.push({ type: "divider" });
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.caps"),
    });
    // A mixed selection lights no segment and shows no section.
    this.terminalKindControl.value = capStyle.mixed
      ? undefined
      : (capStyle.value ?? "butt");
    formContents.push({ type: "single-icon", element: this.terminalKindRow });
    // Each kind shows its own fields. Radius maps 20 discrete positions
    // logarithmically onto the [1/128, 1/4] ratio range; tension is edited in
    // percent. Both are converted back in capValuesFromField.
    const styleValue = capStyle.mixed ? null : (capStyle.value ?? "butt");
    if (styleValue === "round") {
      this._refreshCompactField(
        this.capFields.radius,
        "cap:radius",
        {
          value:
            capRadiusIndexFromRatio(
              cap.capRadiusRatio.value ?? DEFAULT_CAP_RADIUS_RATIO
            ) + 1,
          mixed: cap.capRadiusRatio.mixed,
        },
        { minValue: 1, maxValue: CAP_RADIUS_POSITIONS }
      );
      this._refreshCompactField(
        this.capFields.tension,
        "cap:tension",
        {
          value: Math.round((cap.capTension.value ?? DEFAULT_CAP_TENSION) * 100),
          mixed: cap.capTension.mixed,
        },
        { minValue: 0, maxValue: 100 }
      );
      formContents.push({ type: "single-icon", element: this.roundedRow });
    } else if (styleValue === "square") {
      this._refreshCompactField(
        this.capFields.angle,
        "cap:angle",
        {
          value: Math.round(cap.capAngle.value ?? DEFAULT_CAP_ANGLE),
          mixed: cap.capAngle.mixed,
        },
        { minValue: CAP_ANGLE_MIN, maxValue: CAP_ANGLE_MAX }
      );
      this._refreshCompactField(
        this.capFields.distance,
        "cap:distance",
        cap.capDistance
      );
      formContents.push({ type: "single-icon", element: this.squareRow });
    } else if (styleValue === "drop") {
      const percentOf = (summary, fallback) => ({
        value: Math.round((summary.value ?? fallback) * 100),
        mixed: summary.mixed,
      });
      // Size and Shape reach the model's whole range. The sliders stopped short
      // (105 and 40) and left the rest to typing; a scrub field types and drags
      // alike.
      this._refreshCompactField(
        this.capFields.ball,
        "cap:ball",
        percentOf(cap.capBallRatio, DEFAULT_CAP_BALL_RATIO),
        { minValue: CAP_BALL_MIN, maxValue: CAP_BALL_MAX }
      );
      this._refreshCompactField(
        this.capFields.ballshape,
        "cap:ballshape",
        percentOf(cap.capBallShape, DEFAULT_CAP_BALL_SHAPE),
        { minValue: CAP_SHAPE_MIN, maxValue: CAP_SHAPE_MAX }
      );
      // Easing, not tension: how far back along the inner edge the neck starts,
      // as a percent of the run to the next generated on-curve. 100 collapses
      // the two, and there is no geometry past it.
      this._refreshCompactField(
        this.capFields.balleasing,
        "cap:balleasing",
        percentOf(cap.capBallEasing, DEFAULT_CAP_BALL_EASING),
        { minValue: 0, maxValue: CAP_BALL_EASING_MAX }
      );
      formContents.push({ type: "single-icon", element: this.ballRow });
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
    // Ticket 50: a selected corner shows Corner rounding, and nothing else
    // does. The section used to show greyed for every other point.
    if (!corner.canEdit) {
      return;
    }
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

  // An insertion point's own parameters: the two widths and the easing.
  //
  // The widths are shown in units and stored as a ratio of the half-width the
  // stroke already draws there. A designer thinks in units, and a ratio is what
  // lets the point slide along a tapering stroke without changing the shape.
  // The conversion has one home, in skeleton-panel-edits.js, and both the field
  // and the scrub come through it.
  _buildInsertionSection(formContents, insertions) {
    const summary = summarizeSkeletonInsertionSelection(insertions);
    formContents.push({ type: "divider" });
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.insertion"),
    });
    formContents.push({
      type: "checkbox",
      key: "insertion:linked",
      label: translate("sidebar.skeleton-parameters.linked"),
      value: summary.linked.mixed ? false : summary.linked.value,
    });
    // Never greyed. An insertion point's ratio used to be treated as inert on a
    // tied straight, on the reasoning that the tie owns the offset there. That
    // was written before a cut straight became two cubics: the ends keep their
    // direction through their own outer handles now, whatever the middle does,
    // so the tie has nothing left to take away from the point between them. A
    // stem is exactly where a designer reaches for this control.
    const gate = { minValue: 0 };
    for (const side of ["left", "right"]) {
      this._pushSummaryNumber(
        formContents,
        `insertion:${side}`,
        `${side}-width`,
        this._insertionWidthSummary(insertions, side),
        gate
      );
    }
    // One per side, because the link governs easing as well as width. The
    // slider reads percent and the model stores minus one to one: below zero
    // the joint tightens toward a point, above it fills out.
    for (const side of ["left", "right"]) {
      const value = side === "left" ? summary.easingLeft : summary.easingRight;
      this._pushSummarySlider(
        formContents,
        `insertion:easing-${side}`,
        `insertion-easing-${side}`,
        { ...value, value: value.value == null ? null : value.value * 100 },
        -100,
        100,
        0,
        { step: 1 }
      );
    }
  }

  // The two width fields read units, so each selected point's stored ratio is
  // resolved against the outline it actually draws. A selection whose members
  // resolve to different numbers reports mixed, and one whose reference cannot
  // be read at all reports nothing rather than a number the shape does not obey.
  _insertionWidthSummary(insertions, side) {
    const values = insertions.map((entry) => this._insertionWidthInUnits(entry, side));
    const first = values[0] ?? null;
    return {
      mixed: values.some((value) => value !== first),
      value: first,
    };
  }

  // One insertion point's half-width at that side, in units.
  //
  // The reference comes off the drawn outline of the layer the panel edits,
  // which is the same layer its skeleton comes from. There is no candidate to
  // choose between: a skeleton and the outline it drew are one layer's two
  // halves, and taking them off the same one is what makes the number shown and
  // the number written describe one stroke.
  _insertionWidthInUnits(entry, side) {
    const reference = this._insertionReference(entry, side);
    const units = insertionRatioToUnits(reference, entry.insertion.width[side]);
    return Number.isFinite(units) ? Math.round(units) : null;
  }

  // The half-width the stroke draws where one insertion point stands.
  //
  // Read off the drawn outline through the provenance the generator published,
  // which is the same lookup the rib gizmo and the drawing layer already use.
  // It was measured by regenerating the whole glyph instead, once per side and
  // on every rebuild of the panel, plus twice more to open a scrub. The
  // generator is the largest file in the fork and it draws the shape the panel
  // is already looking at.
  //
  // The display, the scrub and the typed value all come through here, so the
  // number shown and the number written cannot disagree.
  _insertionReference(entry, side) {
    const glyph = this._getEditLayerGlyph(this._getPositionedGlyph());
    const skeletonData = getSkeletonData(glyph);
    if (!skeletonData || !glyph?.path) {
      return null;
    }
    return insertionWidthReference(
      skeletonData,
      glyph.path,
      entry.contourId,
      entry.insertionId,
      side
    );
  }

  // The easing slider reads percent and the model stores minus one to one. A
  // change of unit and no bound: the bound belongs in the writer, which is
  // `setInsertionEasing`, with normalization as the final gate on what is
  // stored. A panel that clamps as well is a third statement of one rule, and
  // this project has spent two rounds on a model that was correct because a
  // panel was showing a number the model had already rejected.
  _insertionEasingFromSlider(value) {
    return Number(value) / 100;
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
        {
          value: "tilt",
          label: translate("sidebar.skeleton-parameters.serif-axis.tilt"),
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
    // The tilt takes the same place the absolute angle does, because the two
    // never appear together. Its range is 40 either way, which is the lab's own
    // and is also where the terminal stops moving by rotation alone: past about
    // 38 degrees the wing runs so far along the stem that the construction's
    // searches meet the wall tangentially and the shape steps. The range is a
    // slider bound and not a clamp in the writer, exactly as the absolute
    // angle's is — the shape does not stop there, it steps.
    if (serif.axisMode.value === "tilt" && !serif.axisMode.mixed) {
      this._pushSummarySlider(
        formContents,
        "serif:axistilt",
        "serif-axis-tilt",
        serif.axisTilt,
        -40,
        40,
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

  _refreshWidthField(name, summary, options = {}) {
    this._refreshCompactField(
      this.widthFields[name],
      `width:${name}`,
      summary,
      options
    );
  }

  // Push one summary into a compact field. A field under the hand is left
  // alone: it already shows the number it is sending. A mixed field has no
  // start value, so it drags by the change alone and takes no bounds.
  _refreshCompactField(
    field,
    key,
    summary,
    { disabled = false, blank = false, minValue, maxValue, round = false } = {}
  ) {
    field.disabled = disabled;
    field.minValue = summary.mixed ? undefined : minValue;
    field.maxValue = summary.mixed ? undefined : maxValue;
    if (this._scrubbingFields.has(key)) {
      return;
    }
    const value =
      blank || summary.mixed || summary.value == null ? null : summary.value;
    field.value = value != null && round ? Math.round(value) : value;
  }

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
    const { blank = false, multiply = true, ...fieldOptions } = options;
    return {
      type: "edit-number",
      key,
      value: blank || summary.mixed ? null : summary.value,
      placeholder: blank ? "" : summary.placeholder || undefined,
      scrub: true,
      auxiliaryElement:
        fieldOptions.disabled || !multiply
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
      // Cap and corner sliders stream onto the canvas while dragging; all other
      // fields apply the committed value once. The width fields are compact
      // scrub fields with their own streams (_makeWidthField).
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
            : name === "axistilt"
              ? { axisTilt: Number(streamed) }
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
      if (valueStream && group === "insertion" && name.startsWith("easing-")) {
        const side = name.slice("easing-".length);
        await setPanelInsertionValuesStream(
          this.sceneController,
          this._insertions || [],
          valueStream,
          (insertion, contour, streamedValue) =>
            setInsertionEasing(
              insertion,
              side,
              this._insertionEasingFromSlider(streamedValue)
            ),
          this._undo("set-insertion-easing")
        );
        return;
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
      } else if (group === "insertion") {
        await this._onInsertionChange(name, finalValue);
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
    if (group === "contour" && name === "default-width") {
      await scalePanelContourDefaultWidth(
        sc,
        this._panelSelection.contours,
        factor,
        this._undo("set-contour-width")
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

  async _onInsertionChange(name, value) {
    const insertions = this._insertions || [];
    if (!insertions.length) {
      return;
    }
    if (name === "linked") {
      await editSelectedSkeletonInsertions(
        this.sceneController,
        insertions,
        (insertion) => setInsertionWidthLinked(insertion, value === true),
        this._undo("set-insertion-width")
      );
      return;
    }
    if (name.startsWith("easing-")) {
      const side = name.slice("easing-".length);
      await editSelectedSkeletonInsertions(
        this.sceneController,
        insertions,
        (insertion) =>
          setInsertionEasing(insertion, side, this._insertionEasingFromSlider(value)),
        this._undo("set-insertion-easing")
      );
      return;
    }
    if (name !== "left" && name !== "right") {
      return;
    }
    // A typed number is units. It is divided by the reference the outline
    // draws, once, before it is stored.
    const references = new Map();
    for (const entry of insertions) {
      references.set(
        `${entry.contourId}/${entry.insertionId}`,
        this._insertionReference(entry, name)
      );
    }
    await editSelectedSkeletonInsertions(
      this.sceneController,
      insertions,
      (insertion, contour) => {
        const reference = references.get(`${contour.id}/${insertion.id}`);
        if (reference) {
          setInsertionRatioFromUnits(insertion, name, reference, value);
        }
      },
      this._undo("set-insertion-width")
    );
  }

  async _onScrub(group, name, valueStream) {
    const sc = this.sceneController;
    if (group === "insertion" && (name === "left" || name === "right")) {
      // The scrub streams a change in units. Each frame resolves it against the
      // reference the drag opened with, so the ratio the model stores stays a
      // statement about the stroke rather than about the drag.
      const references = new Map();
      const startUnits = new Map();
      for (const entry of this._insertions || []) {
        const key = `${entry.contourId}/${entry.insertionId}`;
        const reference = this._insertionReference(entry, name);
        references.set(key, reference);
        startUnits.set(
          key,
          reference === null
            ? null
            : insertionRatioToUnits(reference, entry.insertion.width[name])
        );
      }
      await setPanelInsertionValuesStream(
        sc,
        this._insertions || [],
        valueStream,
        (insertion, contour, change) => {
          const key = `${contour.id}/${insertion.id}`;
          const reference = references.get(key);
          if (!reference) {
            return;
          }
          setInsertionRatioFromUnits(
            insertion,
            name,
            reference,
            startUnits.get(key) + Number(change)
          );
        },
        this._undo("set-insertion-width")
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
    if (name === "ribanglelockmode") {
      if (!["stroke", "rib"].includes(value)) {
        return;
      }
      await setPanelRibAngleLockMode(
        this.sceneController,
        this._widthPoints(),
        value,
        this._undo("set-rib-angle-lock-mode")
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
        value === "both" ? null : value,
        this._undo("set-single-sided"),
        {
          keepForm:
            applicationSettingsController.model.skeletonSideModeKeepsForm === true,
          keepEdits:
            applicationSettingsController.model.skeletonSideModeKeepsEdits === true,
        }
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
    if (name === "axistilt") {
      await apply({ axisTilt: Number(value) });
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

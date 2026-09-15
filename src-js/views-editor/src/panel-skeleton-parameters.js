import { applicationSettingsController } from "@fontra/core/application-settings.js";
import { recordChanges } from "@fontra/core/change-recorder.js";
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { isScrubCancelled } from "@fontra/core/number-scrub.js";
import { MAX_TIP_CUT_ANGLE } from "@fontra/core/serif-geometry.js";
import { DEFAULT_CAP_BALL_EASE_CURVATURE } from "@fontra/core/skeleton-generator.js";
import {
  SERIF_HALF_FIELDS,
  SERIF_PRESETS,
  DEFAULT_CORNER_CURVATURE,
  DEFAULT_INSERTION_RATIO,
  SKELETON_LOCK_KINDS,
  SKELETON_SOURCE_DEFAULT_KEYS,
  VALID_SERIF_AXIS_MODES,
  VALID_SERIF_SIDES,
  applySerifPreset,
  getSkeletonData,
  getSkeletonGlyphCase,
  getTerminalPresetSourceKey,
  normalizeTerminalPreset,
  resolveEffectiveSourceSkeletonDefault,
  setSkeletonCapParameters,
  setSkeletonCornerParameters,
  setSourceSkeletonDefaultsValues,
} from "@fontra/core/skeleton-model.js";
import { throttleCalls } from "@fontra/core/utils.ts";
import { showMenu } from "@fontra/web-components/menu-panel.js";
import "@fontra/web-components/chain-link.js"; // for <chain-link>, ticket 45
import "@fontra/web-components/compact-scrub-field.js"; // for <compact-scrub-field>, ticket 46
import "@fontra/web-components/multi-select-dropdown.js"; // for <multi-select-dropdown>, ticket 49
import "@fontra/web-components/overflow-button.js"; // for <overflow-button>, ticket 48
import "@fontra/web-components/overflow-popover.js"; // for the Rib card
import "@fontra/web-components/segmented-control.js"; // for <segmented-control>, ticket 44
import { Form } from "@fontra/web-components/ui-form.js";
import { PresetHeaderControl } from "./preset-header-control.js";
import { SELECTION_ROW_GROUP_STYLES } from "./selection-row-group-styles.js";
import {
  SKELETON_PANEL_SENDER,
  nudgePanelCapParameterStream,
  nudgePanelCornerDistanceStream,
  setPanelCornerDistributionStream,
  nudgePanelPointWidthStream,
  forcePanelSerifSide,
  nudgePanelSerifValueStream,
  resetPanelGeneratedHandle,
  resetPanelRibs,
  setPanelCapParameters,
  setPanelCapStyle,
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
  setInsertionEasing,
  setInsertionWidthLinked,
  setInsertionWidthRatio,
  setPanelInsertionValuesStream,
  setPanelPointValuesStream,
  setPanelRibAngleLock,
  setPanelRibAngleLockMode,
  setPanelRibDetached,
  setPanelRibLocked,
  setPanelSerifParameters,
  setPanelSerifLink,
  setPanelSerifParametersStream,
  setPanelTerminalPreset,
} from "./skeleton-panel-edits.js";
import {
  collectRibEditTargets,
  captureSelectionTerminalShape,
  captureSelectionWidthPreset,
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

// Ticket 56: what the Terminal section shows for a cap field a point has never
// stored, so a preset captured from that point stores what is on screen.
export const TERMINAL_FIELD_FALLBACKS = {
  capAngle: DEFAULT_CAP_ANGLE,
  capDistance: 0,
  capRadiusRatio: DEFAULT_CAP_RADIUS_RATIO,
  capTension: DEFAULT_CAP_TENSION,
  capBallRatio: DEFAULT_CAP_BALL_RATIO,
  capBallShape: DEFAULT_CAP_BALL_SHAPE,
  capBallEasing: DEFAULT_CAP_BALL_EASING,
  capBallEaseCurvature: DEFAULT_CAP_BALL_EASE_CURVATURE,
};
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

// Ticket 57: the serif's half fields in their groups, each row a left field, a
// chain and a right field. The groups are also what the Force menu's middle
// entry copies.
export const SERIF_FIELD_GROUPS = [
  ["serif-group-wing", ["wingLength", "tipThickness", "wingSlope", "tipCutAngle"]],
  ["serif-group-bracket", ["reach", "tension", "concavity"]],
  ["serif-group-easing", ["easeDistance", "easeCurvature"]],
];
// Stored as a ratio, edited as a percent, with the range each one's slider had.
export const SERIF_PERCENT_FIELD_BOUNDS = {
  tension: { minValue: 0, maxValue: 100 },
  concavity: { minValue: -100, maxValue: 100 },
  easeCurvature: { minValue: 0, maxValue: 100 },
};

// A compact scrub field streams the value under the hand. The width writers
// move each point by a change, so the stream is turned into the change from
// where the drag started. The cancel sentinel passes through untouched.
export async function* changesFrom(valueStream, startValue) {
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
        // A row built once and re-placed carries no text of its own, so two
        // different rows would read alike; its layoutKey names which one it is.
        item.layoutKey ?? "",
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

// The corner distribution, which names no side: -100 to 100, left positive.
function cornerValuesFromDistribution(value) {
  return { distribution: Number(value) };
}

// A stored ratio as the percent a field shows. A mixed or absent one shows
// nothing.
function percentOfRatio(summary) {
  return {
    mixed: summary.mixed,
    value: summary.value == null ? null : summary.value * 100,
  };
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
    this.gizmoHandlesControl.setAttribute("small", "");
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

    // The Insertion section in the same layout: Left, chain, Right for the
    // widths, and the same for the easings. One link governs both pairs, so
    // both chains are `insertion:linked`.
    const insertionChain = () => {
      const chain = html.createDomElement("chain-link", {
        tooltip: translate("sidebar.skeleton-parameters.linked"),
      });
      chain.addEventListener("change", (event) =>
        this._runOwnEdit(() => this._onInsertionChange("linked", event.detail.linked))
      );
      return chain;
    };
    this.insertionWidthChain = insertionChain();
    this.insertionEasingChain = insertionChain();
    this.insertionFields = {};
    for (const side of ["left", "right"]) {
      // A drag moves each point's width by the change in units, from where it
      // started, so a mixed selection stays mixed.
      this.insertionFields[side] = this._makeCompactField(
        `insertion:${side}`,
        `${side}-width`,
        {
          // Percent of the width the stroke draws at the point, 100 wherever
          // it stands. A drag moves each point by the change, so a mixed
          // selection stays mixed.
          defaultValue: Math.round(DEFAULT_INSERTION_RATIO * 100),
          scrub: (valueStream, startValue) =>
            setPanelInsertionValuesStream(
              this.sceneController,
              this._insertions || [],
              changesFrom(valueStream, startValue),
              (insertion, contour, change) =>
                setInsertionWidthRatio(
                  insertion,
                  side,
                  insertion.width[side] + Number(change) / 100
                ),
              this._undo("set-insertion-width")
            ),
          commit: (value) => this._onInsertionChange(side, value),
        }
      );
      // The field reads percent and the model stores minus one to one: below
      // zero the joint tightens toward a point, above it fills out.
      this.insertionFields[`easing-${side}`] = this._makeCompactField(
        `insertion:easing-${side}`,
        `insertion-easing-${side}`,
        {
          defaultValue: 0,
          scrub: (valueStream) =>
            setPanelInsertionValuesStream(
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
            ),
          commit: (value) => this._onInsertionChange(`easing-${side}`, value),
        }
      );
    }
    this.insertionWidthRow = fieldRow([
      this.insertionFields.left,
      this.insertionWidthChain,
      this.insertionFields.right,
    ]);
    this.insertionEasingRow = fieldRow([
      this.insertionFields["easing-left"],
      this.insertionEasingChain,
      this.insertionFields["easing-right"],
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
    // Tied ribs reflects the selection: greyed where no point has a straight
    // to tie across, and on, off or mixed over the points that do.
    this.tiedButton = toggleButton("/tabler-icons/link-plus.svg", "tied", (value) =>
      this._onWidthChange("tied", value)
    );
    // Reset is three parts, and the selection sets their reach: a skeleton point
    // resets both of its sides, a rib that side alone, a generated handle that
    // handle alone, which greys the other two.
    this.resetHandleButton = iconButton(
      "/tabler-icons/rotate.svg",
      "reset-handle",
      () =>
        this._singleGeneratedHandle
          ? this._resetSingleGeneratedHandle()
          : this._resetRibs("handles")
    );
    this.resetSlideButton = iconButton(
      "/tabler-icons/arrows-horizontal.svg",
      "reset-slide",
      () => this._resetRibs("slide")
    );
    this.resetAllButton = iconButton("/tabler-icons/refresh.svg", "reset-all", () =>
      this._resetRibs("all")
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
    // The Rib group's overflow, a card as in the design: Rib angle (the rib
    // angle lock: Free, Vertical, Horizontal) with Keep the footprint, the
    // forced rib's mode, under it; then Lock with the three lock kinds and Link
    // with Tied ribs and Detach. The controls are built once; each update sets
    // their state from the selection.
    this.ribAngleControl = html.createDomElement("segmented-control", {
      options: [
        ["auto", "free"],
        ["vertical", "vertical"],
        ["horizontal", "horizontal"],
      ].map(([value, labelKey]) => ({
        value,
        label: translate(`sidebar.skeleton-parameters.force-angle.${labelKey}`),
      })),
    });
    this.ribAngleControl.addEventListener("change", (event) =>
      this._runOwnEdit(() => this._onWidthChange("ribanglelock", event.detail.value))
    );
    this.ribFootprintCheck = html.input({ type: "checkbox" });
    this.ribFootprintCheck.addEventListener("change", () =>
      this._runOwnEdit(() =>
        this._onWidthChange(
          "ribanglelockmode",
          this.ribFootprintCheck.checked ? "rib" : "stroke"
        )
      )
    );
    this.ribLockButtons = Object.fromEntries(
      SKELETON_LOCK_KINDS.map((kind) => [
        kind,
        toggleButton(`/images/lock-${kind}.svg`, `locked.${kind}`, (value) =>
          this._onRibChange(`locked-${kind}`, value)
        ),
      ])
    );
    const cardTitle = (labelKey) =>
      html.span({}, [translate(`sidebar.skeleton-parameters.${labelKey}`)]);
    const cardColumn = (children) =>
      html.div(
        { style: "display: flex; flex-direction: column; gap: 0.25em;" },
        children
      );
    this.ribOverflow = html.createDomElement("overflow-popover", {
      "data-tooltip": translate("sidebar.skeleton-parameters.rib-options"),
      "data-tooltipposition": "top",
    });
    this.ribOverflow.content = html.div(
      {
        class: "selection-row-group-icons",
        style: "display: flex; flex-direction: column; align-items: start; gap: 0.9em;",
      },
      [
        cardColumn([cardTitle("rib-angle"), this.ribAngleControl]),
        html.label({ style: "display: flex; gap: 0.5em; align-items: center;" }, [
          this.ribFootprintCheck,
          translate("sidebar.skeleton-parameters.rib-angle-lock-mode.rib"),
        ]),
        cardColumn([
          cardTitle("group.lock"),
          html.div(
            { style: "display: flex; gap: 0.15em;" },
            Object.values(this.ribLockButtons)
          ),
        ]),
      ]
    );
    for (const button of Object.values(this.ribLockButtons)) {
      button.style.width = "1.8em";
      button.style.height = "1.8em";
    }
    // Ticket 49: the Generation header's preset control. A preset is a total
    // width and a projection side. Add stores the selection's total and
    // projection as a new preset for the glyph's case; Update writes them over
    // the preset picked last.
    this.widthPresetControl = new PresetHeaderControl({
      onPick: (index) => {
        const preset = this._widthPresetList()[index];
        if (preset) {
          this._applyWidthPreset(preset);
        }
      },
      onAdd: () => this._addWidthPreset(),
      onUpdate: (index) => this._updateWidthPreset(index),
    });
    // Tickets 56 and 60: the Terminal header's preset control, the same control
    // for the kind the selection shows -- Square, Rounded, Ball or Serif. Flat
    // has no fields. A serif preset is the whole terminal (both halves, every
    // link, the angle and the cup), so the serif needs one control, not one per
    // side.
    this._terminalPresetType = null;
    this.terminalPresetControl = new PresetHeaderControl({
      onPick: (value) => {
        const type = this._terminalPresetType;
        const preset = type ? this._terminalPresetByValue(type, value) : null;
        if (preset) {
          this._applyTerminalPreset(type, preset);
        }
      },
      onAdd: () => this._addTerminalPreset(this._terminalPresetType),
      onUpdate: (index) => this._updateTerminalPreset(this._terminalPresetType, index),
    });
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

    // Ticket 61: Corner rounding as two chained rows, Distance and Curvature,
    // each left, chain, right. Both chains are `corner:linked`. Closed, the
    // curvature writer carries the left value to both sides and greys the right
    // field; both distances stay editable, because each is one side of the
    // same shared-centre rounding and moves the other by that rule. Ticket 75:
    // the Distribution row under them moves distance between the two sides.
    this.cornerFields = {};
    for (const side of ["left", "right"]) {
      for (const parameter of ["distance", "curvature"]) {
        this.cornerFields[`${side}-${parameter}`] = this._makeCornerField(
          side,
          parameter
        );
      }
    }
    const cornerChain = () => {
      const chain = html.createDomElement("chain-link", {
        tooltip: translate("sidebar.skeleton-parameters.linked"),
      });
      chain.addEventListener("change", (event) =>
        this._runOwnEdit(() => this._onCornerChange("linked", event.detail.linked))
      );
      return chain;
    };
    this.cornerChains = [cornerChain(), cornerChain()];
    this.cornerDistanceRow = fieldRow([
      this.cornerFields["left-distance"],
      this.cornerChains[0],
      this.cornerFields["right-distance"],
    ]);
    this.cornerCurvatureRow = fieldRow([
      this.cornerFields["left-curvature"],
      this.cornerChains[1],
      this.cornerFields["right-curvature"],
    ]);
    this.cornerDistributionField = this._makeCompactField(
      "corner:distribution",
      "corner-distribution",
      {
        defaultValue: 0,
        scrub: (valueStream) =>
          setPanelCornerDistributionStream(
            this.sceneController,
            this._widthPoints(),
            valueStream,
            this._undo("set-corner")
          ),
        commit: (value) => this._onCornerChange("distribution", value),
      }
    );
    this.cornerDistributionRow = fieldRow([this.cornerDistributionField]);

    // Ticket 57: the serif's half fields, one row per field: left, chain,
    // right. A closed chain is that field's link: it greys the right field and
    // the writer carries a left write across. One check above each column says
    // whether the serif is built on that side. Right-clicking a field offers the
    // Force menu.
    this.serifFields = {};
    this.serifChains = {};
    // The serif rows follow the Transform rows: the name in a label column,
    // the fields after it. The group title is bold, as in the design.
    // A group is one grid, so its label column is as wide as its widest label.
    // A row adds its two cells to that grid rather than making its own.
    const labeledRow = (labelKey, children) =>
      html.div({ style: "display: contents;" }, [
        html.span({ style: "white-space: nowrap;" }, [
          translate(`sidebar.skeleton-parameters.${labelKey}`),
        ]),
        fieldRow(children),
      ]);
    const groupTitle = (labelKey) =>
      html.span({ style: "font-weight: bold; grid-column: 1 / -1;" }, [
        translate(`sidebar.skeleton-parameters.${labelKey}`),
      ]);
    const groupBlock = (children) =>
      html.div(
        {
          style:
            "display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.35rem 0.75em; align-items: center;",
        },
        children
      );
    this.serifGroupBlocks = SERIF_FIELD_GROUPS.map(([groupKey, fields]) =>
      groupBlock([
        groupTitle(groupKey),
        ...fields.map((field) => {
          for (const side of ["left", "right"]) {
            this.serifFields[`${side}-${field}`] = this._makeSerifField(side, field);
          }
          const chain = html.createDomElement("chain-link", {
            tooltip: translate("sidebar.skeleton-parameters.linked"),
          });
          chain.addEventListener("change", (event) =>
            this._runOwnEdit(() =>
              setPanelSerifLink(
                this.sceneController,
                this._widthPoints(),
                field,
                event.detail.linked,
                this._undo("set-serif")
              )
            )
          );
          this.serifChains[field] = chain;
          return labeledRow(`serif-field.${field}`, [
            this.serifFields[`left-${field}`],
            chain,
            this.serifFields[`right-${field}`],
          ]);
        }),
      ])
    );
    // Which sides the serif is built on, as two checks in the Terminal header's
    // overflow while the kind is Serif.
    this.serifSidesOverflow = html.createDomElement("overflow-button", {
      "data-tooltip": translate("sidebar.skeleton-parameters.serif-sides"),
      "data-tooltipposition": "left",
    });
    this.serifSidesOverflow.addEventListener("change", (event) =>
      this._onSerifSideCheck(event.detail.checked)
    );
    // Ticket 58: the Cup group, three single fields, one row each.
    this.serifCupFields = {
      cup: this._makeSerifCupField("cup", "serif-underside-cup"),
      cupbalance: this._makeSerifCupField("cupbalance", "serif-underside-cup-balance"),
      cuptension: this._makeSerifCupField("cuptension", "serif-underside-cup-tension"),
    };
    this.serifCupBlock = groupBlock([
      groupTitle("serif-group-cup"),
      labeledRow("serif-underside-cup", [this.serifCupFields.cup]),
      labeledRow("serif-underside-cup-balance", [this.serifCupFields.cupbalance]),
      labeledRow("serif-underside-cup-tension", [this.serifCupFields.cuptension]),
    ]);

    // The serif Angle group: Tilt alone. The axis direction is not offered
    // here, because the point's rib angle already sets it. Tilt is live only
    // while the axis is free.
    this.serifAxisTiltField = this._makeSerifTiltField();
    this.serifAxisRow = groupBlock([
      groupTitle("serif-group-angle"),
      labeledRow("serif-axis-tilt", [this.serifAxisTiltField]),
    ]);
    // Projection and Reset first, then the Rib group under them.
    this.generationIconRow = html.div({ class: "selection-row-group" }, [
      ...iconGroup("group.projection", [
        this.projectionControl,
        this.projectionOverflow,
      ]),
      ...iconGroup("group.reset", [
        this.resetHandleButton,
        this.resetSlideButton,
        this.resetAllButton,
      ]),
    ]);
    this.ribRow = html.div({ class: "selection-row-group" }, [
      ...iconGroup("group.rib", [this.tiedButton, this.ribOverflow]),
    ]);
  }

  // One compact scrub field that lives for the life of the panel. A drag runs
  // `scrub` once with the field's value stream, as one undo step; a typed value
  // runs `commit`. `key` names the field while it is under the hand, so a
  // refresh leaves it alone.
  // `defaultValue`, in the field's own units, is what a double-click on the
  // scrub area puts back. Leave it out where a parameter has no default.
  // `label`, where given, is the text in the box itself, for a field whose row
  // already carries the name.
  _makeCompactField(key, labelKey, { scrub, commit, defaultValue, label }) {
    const field = html.createDomElement("compact-scrub-field", {
      label: label ?? translate(`sidebar.skeleton-parameters.${labelKey}`),
      integer: true,
    });
    field.defaultValue = defaultValue;
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
      // An even split. The widths themselves have no default to return to.
      defaultValue: name === "distribution" ? 0 : undefined,
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

  // One Corner rounding field, named as cornerValuesFromField names it: the
  // side travels in the name so linked and unlinked reach the same writer.
  // Distance drags by a change, as its label scrub did; Curvature streams its
  // percent, as its slider did.
  _makeCornerField(side, parameter) {
    const name = `${side}-${parameter}`;
    return this._makeCompactField(`corner:${name}`, `corner-${parameter}-${side}`, {
      defaultValue:
        parameter === "curvature"
          ? Math.round(DEFAULT_CORNER_CURVATURE * 100)
          : undefined,
      scrub: (valueStream, startValue) =>
        parameter === "distance"
          ? nudgePanelCornerDistanceStream(
              this.sceneController,
              this._widthPoints(),
              side,
              changesFrom(valueStream, startValue),
              this._undo("set-corner")
            )
          : setPanelPointValuesStream(
              this.sceneController,
              this._widthPoints(),
              valueStream,
              (point, contour, value) =>
                setSkeletonCornerParameters(point, cornerValuesFromField(name, value)),
              this._undo("set-corner")
            ),
      commit: (value) => this._onCornerChange(name, value),
    });
  }

  // One serif half field. The name carries the side, so a write names one half
  // and the writer's link carry decides whether the other follows. Lengths and
  // the tip cut drag by a change, as their label scrubs did; the three ratios
  // stream their percent, as their sliders did.
  _makeSerifField(side, field) {
    const name = `${side}-${field}`;
    const element = this._makeCompactField(`serif:${name}`, `serif-field.${field}`, {
      label: translate(`sidebar.skeleton-parameters.projection.${side}`),
      scrub: (valueStream, startValue) =>
        field in SERIF_PERCENT_FIELD_BOUNDS
          ? setPanelSerifParametersStream(
              this.sceneController,
              this._widthPoints(),
              valueStream,
              (value) => serifHalfValuesFromField(name, value),
              this._undo("set-serif")
            )
          : nudgePanelSerifValueStream(
              this.sceneController,
              this._widthPoints(),
              serifNudgeTargets(name),
              changesFrom(valueStream, startValue),
              this._undo("set-serif")
            ),
      commit: (value) => this._onSerifChange(name, value),
    });
    element.addEventListener("contextmenu", (event) =>
      this._showSerifForceMenu(event, side, field)
    );
    return element;
  }

  // The serif Tilt field. It streams its degrees, as its slider did, and
  // writes the tilt mode with it, which is what Free is.
  _makeSerifTiltField() {
    return this._makeCompactField("serif:axistilt", "serif-axis-tilt", {
      label: "",
      defaultValue: 0,
      scrub: (valueStream) =>
        setPanelSerifParametersStream(
          this.sceneController,
          this._widthPoints(),
          valueStream,
          (value) => ({ axisMode: "tilt", axisTilt: Number(value) }),
          this._undo("set-serif")
        ),
      commit: (value) => this._onSerifChange("axistilt", value),
    });
  }

  // One Cup field, named as _onSerifChange names it. The depth drags by a
  // change, as its label scrub did; the balance and the tension stream their
  // percent, as their sliders did.
  _makeSerifCupField(name, labelKey) {
    return this._makeCompactField(`serif:${name}`, labelKey, {
      label: "",
      scrub: (valueStream, startValue) =>
        name === "cup"
          ? nudgePanelSerifValueStream(
              this.sceneController,
              this._widthPoints(),
              serifNudgeTargets("cup"),
              changesFrom(valueStream, startValue),
              this._undo("set-serif")
            )
          : setPanelSerifParametersStream(
              this.sceneController,
              this._widthPoints(),
              valueStream,
              (value) =>
                name === "cuptension"
                  ? { undersideCupTension: Number(value) / 100 }
                  : { undersideCupBalance: Number(value) / 100 },
              this._undo("set-serif")
            ),
      commit: (value) => this._onSerifChange(name, value),
    });
  }

  // Right-click on a serif field: copy that field, its group, or every half
  // field onto the other side.
  _showSerifForceMenu(event, side, field) {
    event.preventDefault();
    if (this._scrubbingFields.has(`serif:${side}-${field}`)) {
      return;
    }
    const other = side === "left" ? "right" : "left";
    const otherName = translate(`sidebar.skeleton-parameters.serif-force.${other}`);
    const [groupKey, groupFields] = SERIF_FIELD_GROUPS.find(([, fields]) =>
      fields.includes(field)
    );
    const force = (fields) =>
      this._runOwnEdit(() =>
        forcePanelSerifSide(
          this.sceneController,
          this._widthPoints(),
          side,
          fields,
          this._undo("set-serif")
        )
      );
    showMenu(
      [
        {
          title: translate("sidebar.skeleton-parameters.serif-force.field", otherName),
          callback: () => force([field]),
        },
        {
          title: translate(
            "sidebar.skeleton-parameters.serif-force.group",
            translate(`sidebar.skeleton-parameters.${groupKey}`),
            otherName
          ),
          callback: () => force(groupFields),
        },
        {
          title: translate("sidebar.skeleton-parameters.serif-force.all", otherName),
          callback: () => force(SERIF_HALF_FIELDS),
        },
      ],
      { x: event.clientX, y: event.clientY }
    );
  }

  // The two side checks say which sides the serif is built on. At least one
  // stays on: a serif on no side is not a serif, and Flat is the kind for that.
  _onSerifSideCheck(checked) {
    const on = { left: checked.includes("left"), right: checked.includes("right") };
    if (!on.left && !on.right) {
      for (const item of this.serifSidesOverflow.items) {
        item.checked = true;
      }
      return;
    }
    const sides = on.left && on.right ? "both" : on.left ? "left" : "right";
    this._runOwnEdit(() => this._onSerifChange("sides", sides));
  }

  // One Terminal field, named as capValuesFromField names it, which converts
  // the panel's unit to the stored one. Distance drags by a change, as its
  // label scrub did; every other field streams its value, as its slider did.
  _makeCapField(name, labelKey) {
    // In the units each field shows: radius as its 1-based position, the rest
    // as percent, angle and distance as they are.
    const capDefaults = {
      radius: capRadiusIndexFromRatio(DEFAULT_CAP_RADIUS_RATIO) + 1,
      tension: Math.round(DEFAULT_CAP_TENSION * 100),
      angle: DEFAULT_CAP_ANGLE,
      distance: 0,
      ball: Math.round(DEFAULT_CAP_BALL_RATIO * 100),
      ballshape: Math.round(DEFAULT_CAP_BALL_SHAPE * 100),
      balleasing: Math.round(DEFAULT_CAP_BALL_EASING * 100),
    };
    return this._makeCompactField(`cap:${name}`, labelKey, {
      defaultValue: capDefaults[name],
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
    return this._panelSelection
      ? captureSelectionWidthPreset(this._panelSelection)
      : null;
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
    this.widthPresetControl.refresh({
      items: this._widthPresetList()
        .map((preset, index) => ({ preset, index }))
        .filter(({ preset }) => preset?.case === glyphCase)
        .map(({ preset, index }) => ({
          value: index,
          label: `${preset.name || ""} · ${preset.width}${
            preset.side === "both" ? "" : ` ${preset.side === "left" ? "L" : "R"}`
          }`,
        })),
      canCapture: this._canCaptureWidthPreset(),
    });
  }

  // A new preset's name: the word, then one more than the presets this case
  // already has in the list.
  _nextPresetName(list, glyphCase) {
    const count = list.filter((preset) => preset?.case === glyphCase).length;
    return `${translate("sidebar.skeleton-parameters.width-preset")} ${count + 1}`;
  }

  async _addWidthPreset() {
    const captured = this._selectionWidthPreset();
    if (!captured) {
      return;
    }
    const glyphCase = getSkeletonGlyphCase(this.getSelectedGlyphName());
    const list = this._widthPresetList();
    list.push({
      name: this._nextPresetName(list, glyphCase),
      width: captured.width,
      side: captured.side,
      case: glyphCase,
    });
    this.widthPresetControl.lastPicked = list.length - 1;
    await this._persistSourceDefaultValues({
      [SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_PRESETS]: list,
    });
    this._forceRebuild = true;
    await this.update();
  }

  async _updateWidthPreset(index) {
    const captured = this._selectionWidthPreset();
    const list = this._widthPresetList();
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

  // ---- Terminal presets (ticket 56) ------------------------------------------

  // Every preset of one kind the current master stores, both cases, in stored
  // order, read through the model's normalizer.
  _terminalPresetList(type) {
    const key = getTerminalPresetSourceKey(type);
    const list = key ? this._resolveSourceDefault(key) : null;
    return Array.isArray(list)
      ? list.map((preset) => normalizeTerminalPreset(type, preset))
      : [];
  }

  // The dropdown's entries for one kind: for a serif, the five built-ins first
  // (they cannot be updated in place), then the master's own for the glyph's
  // case, each carrying its index in the stored list.
  _terminalPresetItems(type) {
    const glyphCase = getSkeletonGlyphCase(this.getSelectedGlyphName());
    const builtins =
      type === "serif"
        ? SERIF_PRESETS.map((preset, index) => ({
            value: `builtin:${index}`,
            label: preset.name,
          }))
        : [];
    return [
      ...builtins,
      ...this._terminalPresetList(type)
        .map((preset, index) => ({ preset, index }))
        .filter(({ preset }) => preset?.case === glyphCase)
        .map(({ preset, index }) => ({ value: index, label: preset.name || "" })),
    ];
  }

  _terminalPresetByValue(type, value) {
    if (typeof value === "string") {
      const index = Number(value.slice("builtin:".length));
      return type === "serif" ? (SERIF_PRESETS[index] ?? null) : null;
    }
    return this._terminalPresetList(type)[value] ?? null;
  }

  // The shape the selection states for one kind (captureSelectionTerminalShape,
  // shared with the Skeleton settings tab).
  _selectionTerminalPreset(type) {
    return captureSelectionTerminalShape(
      this._panelSelection,
      type,
      TERMINAL_FIELD_FALLBACKS
    );
  }

  _refreshTerminalPresetControl(type) {
    const captured = this.fontController.readOnly
      ? null
      : this._selectionTerminalPreset(type);
    if (type !== "serif") {
      this.terminalPresetControl.refresh({
        items: this._terminalPresetItems(type),
        canCapture: captured !== null,
      });
      return;
    }
    // A serif shows which preset is picked. Update is live only when the
    // picked preset is one of the master's own (a built-in cannot be updated in
    // place) and the selection no longer matches it, and it takes two presses.
    const picked = this.terminalPresetControl.lastPicked;
    const preset =
      typeof picked === "number" ? this._terminalPresetByValue(type, picked) : null;
    const shapeOf = (serifPreset) => JSON.stringify(applySerifPreset(serifPreset));
    this.terminalPresetControl.refresh({
      items: this._terminalPresetItems(type),
      canCapture: captured !== null,
      showPicked: true,
      updateEnabled: !!(preset && captured && shapeOf(captured) !== shapeOf(preset)),
      confirmUpdate: true,
    });
  }

  async _applyTerminalPreset(type, preset) {
    const points = this._widthPoints();
    if (!points.length) {
      return;
    }
    await this._runOwnEdit(() =>
      setPanelTerminalPreset(
        this.sceneController,
        points,
        type,
        preset,
        this._undo("set-cap")
      )
    );
  }

  async _addTerminalPreset(type) {
    const shape = type ? this._selectionTerminalPreset(type) : null;
    if (!shape) {
      return;
    }
    const glyphCase = getSkeletonGlyphCase(this.getSelectedGlyphName());
    const list = this._terminalPresetList(type);
    list.push(
      normalizeTerminalPreset(type, {
        name: this._nextPresetName(list, glyphCase),
        case: glyphCase,
        ...shape,
      })
    );
    this.terminalPresetControl.lastPicked = list.length - 1;
    await this._persistSourceDefaultValues({
      [getTerminalPresetSourceKey(type)]: list,
    });
    this._forceRebuild = true;
    await this.update();
  }

  async _updateTerminalPreset(type, index) {
    const shape = type ? this._selectionTerminalPreset(type) : null;
    const list = type ? this._terminalPresetList(type) : [];
    if (!shape || index == null || !list[index]) {
      return;
    }
    // The name and case stay; the preset is the same entry with a new shape.
    list[index] = normalizeTerminalPreset(type, { ...list[index], ...shape });
    await this._persistSourceDefaultValues({
      [getTerminalPresetSourceKey(type)]: list,
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

    const formContents = [
      {
        type: "header",
        label: translate("sidebar.skeleton-parameters.title"),
        auxiliaryElement: this.gizmoHandlesControl,
      },
    ];
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
    // The basic section is always there, so the panel keeps its shape. Without a
    // skeleton point in the selection its inputs are greyed. The sections for
    // one kind of point follow under it.
    this._buildPointWidthSection(formContents, widthPoints);
    if (widthPoints.length) {
      this._buildCapSection(formContents, widthPoints);
      this._buildCornerSection(formContents, widthPoints);
    }
    // Ticket 78: an insertion point is a kind of skeleton selection, so its
    // section is context-dependent, in the place Terminal and Corner rounding
    // take for an on-curve point.
    const insertions = panelSelection.insertions || [];
    this._insertions = insertions;
    if (insertions.length) {
      this._buildInsertionSection(formContents, insertions);
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

  // ---- Section builders -----------------------------------------------------

  _buildPointWidthSection(formContents, widthPoints) {
    const summary = summarizeSkeletonPointWidths(widthPoints);
    formContents.push({ type: "divider" });
    this._refreshWidthPresetControls();
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.generation"),
      auxiliaryElement: this.widthPresetControl.element,
    });
    // On a single-sided contour the visible edge is the TOTAL, so the per-side
    // numbers and the split between them describe nothing on screen. Greyed and
    // blank rather than hidden: they are still stored, and still what the point
    // goes back to if the contour returns to double-sided.
    const none = !widthPoints.length;
    const sidesGate = {
      disabled: none || summary.singleSided,
      blank: summary.singleSided,
    };
    // Ticket 45: a closed chain greys Right. Left is then the one place a side
    // is typed, and the writer carries the other side by its share. The chain
    // changes how numbers are typed and nothing else -- a drag never reads the
    // flag (feature model §5).
    const linkedClosed = !summary.linked.mixed && summary.linked.value === true;
    this.widthChain.linked = summary.linked.mixed ? null : summary.linked.value;
    this.widthChain.disabled = none || summary.singleSided;
    // The minimum is declared rather than left to the model: without it a drag
    // past the bottom keeps counting down in the box while the stroke has
    // stopped. A mixed field has no start value, so it drags from zero by the
    // change alone and takes no floor.
    this._refreshWidthField("total", summary.total, { disabled: none, minValue: 0 });
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
    formContents.push({
      type: "single-icon",
      element: this.widthTotalRow,
      layoutKey: "widthTotalRow",
    });
    formContents.push({
      type: "single-icon",
      element: this.widthSidesRow,
      layoutKey: "widthSidesRow",
    });

    const ribs = this._ribTargets || [];
    const ribSummary = summarizeSkeletonRibSelection(ribs);
    const setToggle = (button, reduced, disabled = false) => {
      button.mixed = !disabled && reduced.mixed;
      button.on = !disabled && !reduced.mixed && reduced.value === true;
      button.disabled = disabled;
    };
    // Projection reads the contours the selection touches. A mixed selection
    // lights no segment.
    const contours = this._panelSelection?.contours || [];
    const sides = summarizeSkeletonContourSelection(contours).singleSided;
    this.projectionControl.value = sides.mixed ? undefined : (sides.value ?? "both");
    this.projectionControl.disabled = !contours.length;
    this.projectionOverflow.disabled = !contours.length;
    this._refreshProjectionOverflow();
    // A lone generated handle reaches only itself: Reset handle stays, the slide
    // and the whole rib have nothing to act on.
    const handleOnly = !!this._singleGeneratedHandle;
    this.resetHandleButton.disabled = !handleOnly && !ribs.length;
    this.resetSlideButton.disabled = handleOnly || !ribs.length;
    this.resetAllButton.disabled = handleOnly || !ribs.length;
    formContents.push({
      type: "single-icon",
      element: this.generationIconRow,
      layoutKey: "generationIconRow",
    });

    setToggle(this.tiedButton, summary.tied, !summary.tied.canTie);
    this._refreshRibOverflow(widthPoints, ribs, ribSummary);
    formContents.push({
      type: "single-icon",
      element: this.ribRow,
      layoutKey: "ribRow",
    });
  }

  // The Rib card's state. A mixed value lights nothing: no angle segment, an
  // indeterminate check, a dashed toggle.
  _refreshRibOverflow(widthPoints, ribs, ribSummary) {
    const setToggle = (button, reduced, disabled) => {
      button.mixed = !disabled && reduced.mixed;
      button.on = !disabled && !reduced.mixed && reduced.value === true;
      button.disabled = disabled;
    };
    const ribAngleLock = summarizeSkeletonRibAngleLockSelection(widthPoints);
    this.ribAngleControl.value = ribAngleLock.mixed
      ? undefined
      : (ribAngleLock.value ?? "auto");
    this.ribAngleControl.disabled = !ribAngleLock.canEdit;
    // Greyed while the angle is Free, because the mode decides nothing then.
    const lockMode = ribAngleLock.mode;
    this.ribFootprintCheck.checked = !lockMode.mixed && lockMode.value === "rib";
    this.ribFootprintCheck.indeterminate = lockMode.mixed;
    this.ribFootprintCheck.disabled = !lockMode.canEdit;
    for (const kind of SKELETON_LOCK_KINDS) {
      setToggle(this.ribLockButtons[kind], ribSummary.locked[kind], !ribs.length);
    }
    this.ribOverflow.disabled = !ribs.length && !ribAngleLock.canEdit;
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
    const styleValue = capStyle.mixed ? null : (capStyle.value ?? "butt");
    // Ticket 56: the header carries the preset control for the kind shown, when
    // that kind is one with a preset table here. A different kind starts with
    // nothing picked, so Update cannot write one kind's shape over another's.
    const presetType = ["square", "round", "drop", "serif"].includes(styleValue)
      ? styleValue
      : null;
    if (presetType !== this._terminalPresetType) {
      this._terminalPresetType = presetType;
      this.terminalPresetControl.lastPicked = null;
    }
    if (presetType) {
      this._refreshTerminalPresetControl(presetType);
    }
    formContents.push({ type: "divider" });
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.caps"),
      // A serif also carries the overflow with its side checks.
      auxiliaryElement:
        presetType === "serif"
          ? html.div({ style: "display: flex; align-items: center; gap: 0.2rem;" }, [
              this.terminalPresetControl.element,
              this.serifSidesOverflow,
            ])
          : presetType
            ? this.terminalPresetControl.element
            : undefined,
      layoutKey: presetType ? `terminalPreset-${presetType}` : "",
    });
    // A mixed selection lights no segment and shows no section.
    this.terminalKindControl.value = styleValue ?? undefined;
    formContents.push({
      type: "single-icon",
      element: this.terminalKindRow,
      layoutKey: "terminalKindRow",
    });
    // Each kind shows its own fields. Radius maps 20 discrete positions
    // logarithmically onto the [1/128, 1/4] ratio range; tension is edited in
    // percent. Both are converted back in capValuesFromField.
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
      formContents.push({
        type: "single-icon",
        element: this.roundedRow,
        layoutKey: "roundedRow",
      });
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
      formContents.push({
        type: "single-icon",
        element: this.squareRow,
        layoutKey: "squareRow",
      });
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
      formContents.push({
        type: "single-icon",
        element: this.ballRow,
        layoutKey: "ballRow",
      });
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
    const asPercent = (summary) => ({
      value: summary.value == null ? null : Math.round(summary.value * 100),
      mixed: summary.mixed,
    });
    // A closed chain greys Right curvature, which the writer carries from Left.
    // Both distances stay live: a linked distance is one side of the shared
    // rounding, and typing either moves the other.
    const linked = !corner.linked.mixed && corner.linked.value === true;
    for (const chain of this.cornerChains) {
      chain.linked = corner.linked.mixed ? null : corner.linked.value;
    }
    for (const side of ["left", "right"]) {
      this._refreshCompactField(
        this.cornerFields[`${side}-distance`],
        `corner:${side}-distance`,
        {
          ...corner[side].distance,
          value:
            corner[side].distance.value == null
              ? null
              : Math.round(corner[side].distance.value),
        },
        { minValue: 0 }
      );
      this._refreshCompactField(
        this.cornerFields[`${side}-curvature`],
        `corner:${side}-curvature`,
        asPercent(corner[side].curvature),
        { disabled: side === "right" && linked, minValue: 0, maxValue: 100 }
      );
    }
    // The distribution only means something while the sides are linked.
    this._refreshCompactField(
      this.cornerDistributionField,
      "corner:distribution",
      corner.distribution,
      { disabled: !linked, minValue: -100, maxValue: 100, round: true }
    );
    formContents.push({
      type: "single-icon",
      element: this.cornerDistanceRow,
      layoutKey: "cornerDistanceRow",
    });
    formContents.push({
      type: "single-icon",
      element: this.cornerDistributionRow,
      layoutKey: "cornerDistributionRow",
    });
    formContents.push({
      type: "single-icon",
      element: this.cornerCurvatureRow,
      layoutKey: "cornerCurvatureRow",
    });
  }

  // An insertion point's own parameters: the two widths and the easing.
  //
  // The widths are relative: a ratio of the width the stroke draws where the
  // point stands, shown as percent. 100 is the stroke itself wherever the point
  // sits, which is what lets it slide along a tapering stroke without changing
  // the shape.
  _buildInsertionSection(formContents, insertions) {
    const summary = summarizeSkeletonInsertionSelection(insertions);
    formContents.push({ type: "divider" });
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.insertion"),
    });
    // A closed link greys the right-hand fields, which follow the left, the
    // way Generation's widths do.
    const linked = summary.linked.mixed ? null : summary.linked.value === true;
    for (const chain of [this.insertionWidthChain, this.insertionEasingChain]) {
      chain.linked = linked;
    }
    // Never greyed otherwise. An insertion point's ratio used to be treated as
    // inert on a tied straight, on the reasoning that the tie owns the offset
    // there. That was written before a cut straight became two cubics: the ends
    // keep their direction through their own outer handles now, whatever the
    // middle does, so the tie has nothing left to take away from the point
    // between them. A stem is exactly where a designer reaches for this control.
    for (const side of ["left", "right"]) {
      const disabled = side === "right" && linked === true;
      this._refreshCompactField(
        this.insertionFields[side],
        `insertion:${side}`,
        percentOfRatio(side === "left" ? summary.ratioLeft : summary.ratioRight),
        { disabled, minValue: 0, round: true }
      );
      const easing = side === "left" ? summary.easingLeft : summary.easingRight;
      this._refreshCompactField(
        this.insertionFields[`easing-${side}`],
        `insertion:easing-${side}`,
        { ...easing, value: easing.value == null ? null : easing.value * 100 },
        { disabled, minValue: -100, maxValue: 100, round: true }
      );
    }
    formContents.push({
      type: "single-icon",
      element: this.insertionWidthRow,
      layoutKey: "insertionWidthRow",
    });
    formContents.push({
      type: "single-icon",
      element: this.insertionEasingRow,
      layoutKey: "insertionEasingRow",
    });
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
    // Ticket 57: the side checks, then one chained row per half field in its
    // group. A mixed selection shows both checks indeterminate.
    // The side checks live in the Terminal header's overflow. A mixed selection
    // checks neither.
    const sides = serif.sides.mixed ? null : (serif.sides.value ?? "both");
    const on = { left: sides !== "right", right: sides !== "left" };
    this.serifSidesOverflow.items = ["left", "right"].map((side) => ({
      value: side,
      label: translate(`sidebar.skeleton-parameters.serif-side.${side}`),
      checked: sides != null && on[side],
    }));
    this.serifSidesOverflow.disabled = !canEdit;
    // Lengths stop at zero, except the signed wing slope; the tip cut stops at
    // the geometry's own limit either way; the three ratios keep their sliders'
    // percent ranges. Declared here rather than left to the model: without it
    // a drag past the end keeps counting while the shape has stopped.
    const boundsOf = (field) =>
      SERIF_PERCENT_FIELD_BOUNDS[field] ??
      (field === "wingSlope"
        ? {}
        : field === "tipCutAngle"
          ? { minValue: -MAX_TIP_CUT_ANGLE, maxValue: MAX_TIP_CUT_ANGLE }
          : { minValue: 0 });
    for (const [groupIndex, [, fields]] of SERIF_FIELD_GROUPS.entries()) {
      for (const field of fields) {
        const link = serif.links[field];
        const linked = !link.mixed && link.value === true;
        this.serifChains[field].linked = link.mixed ? null : link.value;
        this.serifChains[field].disabled = !canEdit;
        for (const side of ["left", "right"]) {
          const summary = serif[side][field];
          this._refreshCompactField(
            this.serifFields[`${side}-${field}`],
            `serif:${side}-${field}`,
            field in SERIF_PERCENT_FIELD_BOUNDS ? percentSummary(summary) : summary,
            {
              // A side that is off draws nothing, and a closed chain leaves the
              // right field nothing to say.
              disabled:
                !canEdit ||
                (sides != null && !on[side]) ||
                (side === "right" && linked),
              ...boundsOf(field),
            }
          );
        }
      }
      formContents.push({
        type: "single-icon",
        element: this.serifGroupBlocks[groupIndex],
        layoutKey: `serifGroup${groupIndex}`,
      });
    }

    // The Angle group. Free covers both the plain perpendicular and the tilt,
    // which are one construction at different tilts. A mixed selection, or a
    // terminal stored with the absolute angle the panel no longer offers,
    // lights no segment.
    const axisMode = serif.axisMode.mixed
      ? null
      : (serif.axisMode.value ?? "perpendicular");
    const free = axisMode === "perpendicular" || axisMode === "tilt";
    // Tilt is always shown and live only in Free. Its range is 40 either way,
    // which is the lab's own and is also where the terminal stops moving by
    // rotation alone: past about 38 degrees the wing runs so far along the stem
    // that the construction's searches meet the wall tangentially and the shape
    // steps. The range is a field bound and not a clamp in the writer — the
    // shape does not stop there, it steps.
    this._refreshCompactField(
      this.serifAxisTiltField,
      "serif:axistilt",
      serif.axisTilt,
      {
        disabled: !canEdit || !free,
        minValue: -40,
        maxValue: 40,
      }
    );
    formContents.push({
      type: "single-icon",
      element: this.serifAxisRow,
      layoutKey: "serifAxisRow",
    });
    // Ticket 58: the Cup group, three single fields, because the cup belongs to
    // the terminal rather than to a half: a cup on each half would meet at a
    // break in the middle. The depth sets how deep the foot centre sits, the
    // balance slides that centre from tip to tip, and the tension sets how long
    // the four handles reaching it are.
    this._refreshCompactField(
      this.serifCupFields.cup,
      "serif:cup",
      serif.undersideCup,
      {
        disabled: !canEdit,
        minValue: 0,
      }
    );
    this._refreshCompactField(
      this.serifCupFields.cupbalance,
      "serif:cupbalance",
      percentSummary(serif.undersideCupBalance),
      { disabled: !canEdit, minValue: -100, maxValue: 100 }
    );
    this._refreshCompactField(
      this.serifCupFields.cuptension,
      "serif:cuptension",
      percentSummary(serif.undersideCupTension),
      { disabled: !canEdit, minValue: 0, maxValue: 100 }
    );
    formContents.push({
      type: "single-icon",
      element: this.serifCupBlock,
      layoutKey: "serifCupBlock",
    });
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
    field.mixed = !blank && summary.mixed;
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
      // Cap and corner sliders stream onto the canvas while dragging; all other
      // fields apply the committed value once. The width fields are compact
      // scrub fields with their own streams (_makeWidthField).
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
    // A typed number is percent.
    await editSelectedSkeletonInsertions(
      this.sceneController,
      insertions,
      (insertion) => setInsertionWidthRatio(insertion, name, Number(value) / 100),
      this._undo("set-insertion-width")
    );
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

    // The two side checks. A side that goes off keeps its numbers, so switching
    // it back on shows the shape it had.
    if (name === "sides") {
      if (!VALID_SERIF_SIDES.has(value)) {
        return;
      }
      await apply({ sides: value });
      return;
    }
    if (name === "axismode") {
      if (!VALID_SERIF_AXIS_MODES.has(value)) {
        return;
      }
      await apply({ axisMode: value });
      return;
    }
    if (name === "axistilt") {
      // The tilt is what Free means, so a tilt written is the tilt mode.
      await apply({ axisMode: "tilt", axisTilt: Number(value) });
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
        : name === "distribution"
          ? cornerValuesFromDistribution(value)
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

  // `part` is "handles", "slide" or "all". The rib targets already carry the
  // reach: both sides of a selected point, or the one side of a selected rib.
  async _resetRibs(part) {
    await resetPanelRibs(
      this.sceneController,
      this._ribTargets,
      { part },
      this._undo(
        { handles: "reset-handles", slide: "reset-slide", all: "reset-ribs" }[part]
      )
    );
    this._forceRebuild = true;
    await this.update();
  }

  _undo(key) {
    return translate(`sidebar.skeleton-parameters.undo.${key}`);
  }
}

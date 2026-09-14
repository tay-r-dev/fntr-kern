import { registerAction } from "@fontra/core/actions.js";
import { applicationSettingsController } from "@fontra/core/application-settings.js";
import { Backend } from "@fontra/core/backend-api.js";
import {
  ChangeCollector,
  applyChange,
  consolidateChanges,
} from "@fontra/core/changes.js";
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { isScrubCancelled } from "@fontra/core/number-scrub.js";
import {
  filterPathByPointIndices,
  getSelectionByContour,
} from "@fontra/core/path-functions.js";
import { rectCenter, rectSize, unionRect } from "@fontra/core/rectangle.ts";
import { getSkeletonData } from "@fontra/core/skeleton-model.js";
import { Transform } from "@fontra/core/transform.js";
import {
  enumerate,
  mapObjectValuesAsync,
  parseSelection,
  range,
  reversed,
  zip,
} from "@fontra/core/utils.ts";
import { copyBackgroundImage, copyComponent } from "@fontra/core/var-glyph.js";
import { VarPackedPath } from "@fontra/core/var-path.js";
import "@fontra/web-components/compact-scrub-field.js"; // for <compact-scrub-field>, ticket 38
import "@fontra/web-components/labeled-toggle.js"; // for <labeled-toggle>, ticket 43's G3
import "@fontra/web-components/segmented-control.js"; // for <segmented-control>, ticket 42
import { Form } from "@fontra/web-components/ui-form.js";
import { EditBehaviorFactory } from "./edit-behavior.js";
import { SELECTION_ROW_GROUP_STYLES } from "./selection-row-group-styles.js";
import {
  applyGeneratedContourRemap,
  computeGeneratedContourRemap,
  getSkeletonSelectionBounds,
  makeSkeletonPointTargetEntry,
} from "./skeleton-editing.js";

// Composed into panel-selection.js's Selection panel, not registered as its
// own sidebar panel (see ticket 05: merge into one "Selection" tab).
export default class TransformationPanel {
  static stylesForm = `
  .ui-form-label {
    overflow-x: unset;
    display: grid;
    align-items: center;
    justify-content: end;
    height: 1.6em;
  }

  .origin-radio-buttons {
    display: grid;
    grid-template-columns: auto auto auto;
  }

  .origin-radio-buttons > input[type="radio"] {
    appearance: none;
    background-color: var(--editor-mini-console-background-color-light);
    margin: 2px;
    color: var(--editor-mini-console-background-color-light);
    width: 0.9em;
    height: 0.9em;
    border: 0.15em solid var(--editor-mini-console-background-color-light);
    border-radius: 50%;
    cursor: pointer;
  }

  .origin-radio-buttons > input[type="radio"]:hover {
    background-color: var(--text-input-background-color-dark);
    border: 0.15em solid var(--text-input-background-color-dark);
  }

  .origin-radio-buttons > input[type="radio"]:checked {
    background-color: var(--text-input-background-color-dark);
    border: 0.15em solid var(--text-input-background-color-dark);
  }

  .harmonize-report {
    font-size: 0.9em;
    opacity: 0.7;
  }

  /* Ticket 40: Flip+Align share one row, Distribute+Bools share the next,
     each row carrying two small group labels instead of a header of its
     own. The group styles are shared (selection-row-group-styles.js). */
  ${SELECTION_ROW_GROUP_STYLES}
`;

  constructor(editorController, contentElement) {
    this.editorController = editorController;
    this.infoForm = new Form();
    this.infoForm.appendStyle(TransformationPanel.stylesForm);
    contentElement.appendChild(
      html.div(
        { class: "panel-section panel-section--flex panel-section--scrollable" },
        [this.infoForm]
      )
    );
    this.fontController = this.editorController.fontController;
    this.sceneController = this.editorController.sceneController;

    this.pathOperations = Object.fromEntries(
      [
        Backend.unionPath,
        Backend.subtractPath,
        Backend.intersectPath,
        Backend.excludePath,
      ].map((func) => [func.name, func.bind(Backend)])
    );

    this.transformParameters = {
      scaleX: 100,
      scaleY: undefined,
      rotation: 0,
      moveX: 0,
      moveY: 0,
      originX: "center",
      originY: "middle",
      originXButton: undefined,
      originYButton: undefined,
      skewX: 0,
      skewY: 0,
      customDistributionSpacing: null,
      dimensionWidth: null,
      dimensionHeight: null,
    };
    // What these fields held at the last apply. It is the "before" half of the
    // next apply's undo record, so undo steps back through the values used.
    this._committedTransformValues = null;

    this.registerActions();

    this.sceneController.sceneSettingsController.addKeyListener(
      [
        "selectedGlyph",
        "selectedGlyphName",
        "selection",
        "fontLocationSourceMapped",
        "glyphLocation",
      ],
      (event) => {
        // a report describes one apply on one selection; it stops being true
        // the moment the selection moves
        this.setHarmonizeReport("");
        this.updateDimensions();
        // Move/Scale/Rotate/Skew are "by" amounts for the NEXT transform, not
        // a property of the selection -- a leftover number from an earlier
        // selection has nothing to do with this one. But only the selection
        // dropping (or moving to a different one) resets them: repeatedly
        // applying the SAME field's value to the SAME selection is the
        // normal, expected way to use it, so a plain apply must not touch
        // this -- see the glyph-change listener below, which is guarded
        // against exactly that.
        this._resetRelativeTransformFields();
      }
    );
    this.sceneController.addCurrentGlyphChangeListener((event) => {
      this.updateDimensions();
    });
    // Each apply stores what these fields held before it and after it, in its
    // own undo record (scene-controller.js passes an edit's undoInfo through).
    // Undo and redo hand that record back here, so stepping back through a run
    // of transforms walks the fields back through the same values -- the way
    // undo already restores the selection and the grid-snap flag.
    this.sceneController.sceneSettingsController.addKeyListener(
      "lastUndoRedoInfo",
      (event) => {
        const info = event.newValue;
        // A redo record is the reversed undo record, so the pair of stored
        // value sets is read from the other end. The keys themselves are not
        // swapped: only the selection is, and that is upstream's business.
        const values = (info?.isRedo ? info?.redoPanelValues : info?.undoPanelValues)
          ?.transform;
        if (values) {
          this._setRelativeTransformValues(values);
        }
      }
    );
  }

  // The seven numbers Move/Scale/Rotate/Skew hold. One place, so the reset, the
  // undo record and the restore below cannot drift apart.
  // Each one: the neutral value it resets to, and the field that shows it.
  static RELATIVE_TRANSFORM_FIELDS = {
    moveX: { neutral: 0, field: "moveXField" },
    moveY: { neutral: 0, field: "moveYField" },
    rotation: { neutral: 0, field: "rotateField" },
    scaleX: { neutral: 100, field: "scaleXField" },
    scaleY: { neutral: undefined, field: "scaleYField" },
    skewX: { neutral: 0, field: "skewXField" },
    skewY: { neutral: 0, field: "skewYField" },
  };

  // What the fields hold right now, for the undo record.
  _relativeTransformValues() {
    const values = {};
    for (const name of Object.keys(TransformationPanel.RELATIVE_TRANSFORM_FIELDS)) {
      values[name] = this.transformParameters[name];
    }
    return values;
  }

  // Put a set of values back, into both the model and the fields on screen.
  _setRelativeTransformValues(values) {
    // Whatever put these values on screen -- a reset, an undo, a redo -- they
    // are now what the fields hold, so the next apply records them as its
    // before-half.
    this._committedTransformValues = { ...values };
    for (const [name, { field }] of Object.entries(
      TransformationPanel.RELATIVE_TRANSFORM_FIELDS
    )) {
      const value = values[name];
      this.transformParameters[name] = value;
      if (this[field]) {
        this[field].value = value;
      }
    }
  }

  // The panel state one apply stores in its own undo record: the values in use
  // before it, and the ones it applied. Undo restores the first, redo the
  // second; the undo path says which way it went.
  _transformUndoInfo() {
    const after = this._relativeTransformValues();
    // Before the first apply the fields were neutral, so that is what undoing
    // it owes them. Falling back to the applied values instead made the first
    // step of undo leave the amount it had just undone in the field.
    const before = this._committedTransformValues || this._neutralTransformValues();
    this._committedTransformValues = after;
    return {
      undoPanelValues: { transform: before },
      redoPanelValues: { transform: after },
    };
  }

  // Move/Scale/Rotate/Skew hold "by" amounts for the NEXT transform, not a
  // stored property. Dimensions is excluded: it already always shows the
  // SELECTION's actual size via updateDimensions, not a "by" amount.
  _resetRelativeTransformFields() {
    this._setRelativeTransformValues(this._neutralTransformValues());
  }

  // What every one of them holds with nothing pending.
  _neutralTransformValues() {
    const neutral = {};
    for (const [name, { neutral: value }] of Object.entries(
      TransformationPanel.RELATIVE_TRANSFORM_FIELDS
    )) {
      neutral[name] = value;
    }
    return neutral;
  }

  registerActions() {
    const topic = "0070-action-topics.selection-transformations";

    const moveActions = [
      ["align.left", alignLeft],
      ["align.center", alignCenter],
      ["align.right", alignRight],
      ["align.top", alignTop],
      ["align.middle", alignMiddle],
      ["align.bottom", alignBottom],
      ["distribute.horizontally", distributeHorizontally],
      ["distribute.vertically", distributeVertically],
    ];
    for (const [keyPart, moveDescriptor] of moveActions) {
      registerAction(
        `action.selection-transformation.${keyPart}`,
        { topic, titleKey: `sidebar.selection-transformation.${keyPart}` },
        () => this.moveObjects(moveDescriptor)
      );
    }

    const pathActions = [
      ["union", this.pathOperations.unionPath],
      ["subtract", this.pathOperations.subtractPath],
      ["intersect", this.pathOperations.intersectPath],
      ["exclude", this.pathOperations.excludePath],
    ];
    for (const [keyPart, pathOperationFunc] of pathActions) {
      registerAction(
        `action.selection-transformation.path-operations.${keyPart}`,
        {
          topic,
          titleKey: `sidebar.selection-transformation.path-operations.${keyPart}`,
        },
        () => this.doPathOperations(pathOperationFunc, keyPart)
      );
    }
  }

  // Ticket 38 (+ live-preview follow-up): Move/Scale/Skew/Dimensions each
  // become one universal-row: a plain text label on the left (the row's own
  // name, e.g. "Move"), then two compact-scrub fields, each carrying the
  // row's icon -- decorative only, per compact-scrub-field.js. A drag
  // applies live, through transformSelectionStream: the field's own
  // "scrubstart" opens one streaming edit for the whole gesture, so it ends
  // as a single undo step and never compounds (every frame recomputes the
  // transform from the pre-drag state and the drag's current TOTAL value,
  // never a frame-to-frame delta). A typed value still applies once on Enter
  // (the "apply" event), through the plain one-shot transformSelection via
  // onApply. 0.1 is the rounding grid, not just the raw drag value, so a
  // drag lands on a clean number instead of a long, jittery decimal
  // (roundScrubValue's own step handling).
  _buildScrubXYRow({
    label,
    icon,
    tooltip,
    valueX,
    valueY,
    step = 0.1,
    onChangeX,
    onChangeY,
    onApply,
    makeTransformationForX,
    makeTransformationForY,
    undoLabel,
  }) {
    const fieldX = html.createDomElement("compact-scrub-field", {
      label: "X",
      value: valueX,
      icon,
      iconTooltip: tooltip,
      step,
    });
    const fieldY = html.createDomElement("compact-scrub-field", {
      label: "Y",
      value: valueY,
      icon,
      iconTooltip: tooltip,
      step,
    });
    // The value stays exactly where the drag or the typed edit left it --
    // applying the same amount again to the same selection is the normal,
    // repeated way to use these fields. Only a changed selection resets them
    // (the constructor's own selection-change listener), never a plain
    // apply.
    fieldX.addEventListener("change", (event) => onChangeX(event.detail.value));
    fieldY.addEventListener("change", (event) => onChangeY(event.detail.value));
    fieldX.addEventListener("apply", () => onApply());
    fieldY.addEventListener("apply", () => onApply());
    fieldX.addEventListener("scrubstart", (event) =>
      this.transformSelectionStream(
        event.detail.valueStream,
        makeTransformationForX,
        undoLabel
      )
    );
    fieldY.addEventListener("scrubstart", (event) =>
      this.transformSelectionStream(
        event.detail.valueStream,
        makeTransformationForY,
        undoLabel
      )
    );
    return {
      fieldX,
      fieldY,
      row: {
        type: "universal-row",
        field1: { type: "text", value: label },
        field2: { type: "auxiliaryElement", auxiliaryElement: fieldX },
        field3: { type: "auxiliaryElement", auxiliaryElement: fieldY },
      },
    };
  }

  async update(senderInfo) {
    if (!this.infoForm.contentElement.offsetParent) {
      // If the info form is not visible, do nothing
      return;
    }

    await this.fontController.ensureInitialized;

    const formContents = [];

    formContents.push({
      type: "header",
      label: translate("sidebar.selection-transformation.title"),
    });

    let radioButtonOrigin = html.createDomElement("div", {
      class: "origin-radio-buttons ui-form-center",
    });

    for (const keyY of ["top", "middle", "bottom"]) {
      for (const keyX of ["left", "center", "right"]) {
        const key = `${keyX}-${keyY}`;
        let radioButton = html.createDomElement("input", {
          "type": "radio",
          "value": key,
          "name": "origin",
          "v-model": "role",
          "class": "ui-form-radio-button",
          "checked":
            keyX === this.transformParameters.originX &&
            keyY === this.transformParameters.originY
              ? "checked"
              : "",
          "onclick": (event) => this._changeOrigin(keyX, keyY),
          "data-tooltip": translate(
            `sidebar.selection-transformation.origin.${keyY}.${keyX}`
          ),
          "data-tooltipposition": "bottom",
        });
        radioButtonOrigin.appendChild(radioButton);
      }
    }

    formContents.push({
      type: "single-icon",
      element: radioButtonOrigin,
    });

    formContents.push({ type: "divider" });

    formContents.push({
      type: "edit-number-x-y",
      label: translate("sidebar.selection-transformation.origin"),
      fieldX: {
        key: "originXButton",
        value: this.transformParameters.originXButton,
      },
      fieldY: {
        key: "originYButton",
        value: this.transformParameters.originYButton,
      },
    });

    formContents.push({ type: "divider" });

    const {
      row: moveRow,
      fieldX: moveXField,
      fieldY: moveYField,
    } = this._buildScrubXYRow({
      label: translate("sidebar.selection-transformation.move"),
      icon: "/tabler-icons/arrow-move-right.svg",
      tooltip: translate("sidebar.selection-transformation.move"),
      valueX: this.transformParameters.moveX,
      valueY: this.transformParameters.moveY,
      onChangeX: (value) => (this.transformParameters.moveX = value),
      onChangeY: (value) => (this.transformParameters.moveY = value),
      onApply: () =>
        this.transformSelection(
          () =>
            new Transform().translate(
              this.transformParameters.moveX,
              this.transformParameters.moveY
            ),
          "move"
        ),
      makeTransformationForX: (x) => () =>
        new Transform().translate(x, this.transformParameters.moveY),
      makeTransformationForY: (y) => () =>
        new Transform().translate(this.transformParameters.moveX, y),
      undoLabel: "move",
    });
    this.moveXField = moveXField;
    this.moveYField = moveYField;
    formContents.push(moveRow);

    const {
      row: scaleRow,
      fieldX: scaleXField,
      fieldY: scaleYField,
    } = this._buildScrubXYRow({
      label: translate("sidebar.selection-transformation.scale"),
      icon: "/tabler-icons/resize.svg",
      tooltip: translate("sidebar.selection-transformation.scale"),
      valueX: this.transformParameters.scaleX,
      valueY: this.transformParameters.scaleY,
      onChangeX: (value) => (this.transformParameters.scaleX = value),
      onChangeY: (value) => (this.transformParameters.scaleY = value),
      onApply: () =>
        this.transformSelection(
          () =>
            new Transform().scale(
              this.transformParameters.scaleX / 100,
              (this.transformParameters.scaleY
                ? this.transformParameters.scaleY
                : this.transformParameters.scaleX) / 100
            ),
          "scale"
        ),
      makeTransformationForX: (x) => () =>
        new Transform().scale(
          x / 100,
          (this.transformParameters.scaleY ? this.transformParameters.scaleY : x) / 100
        ),
      makeTransformationForY: (y) => () =>
        new Transform().scale(this.transformParameters.scaleX / 100, y / 100),
      undoLabel: "scale",
    });
    this.scaleXField = scaleXField;
    this.scaleYField = scaleYField;
    formContents.push(scaleRow);

    const rotateField = html.createDomElement("compact-scrub-field", {
      label: "",
      value: this.transformParameters.rotation,
      icon: "/tabler-icons/rotate.svg",
      iconTooltip: translate("sidebar.selection-transformation.rotate"),
      step: 0.1,
    });
    const applyRotate = () =>
      this.transformSelection(
        () =>
          new Transform().rotate((this.transformParameters.rotation * Math.PI) / 180),
        "rotate"
      );
    rotateField.addEventListener(
      "change",
      (event) => (this.transformParameters.rotation = event.detail.value)
    );
    rotateField.addEventListener("apply", applyRotate);
    rotateField.addEventListener("scrubstart", (event) =>
      this.transformSelectionStream(
        event.detail.valueStream,
        (rotation) => () => new Transform().rotate((rotation * Math.PI) / 180),
        "rotate"
      )
    );
    this.rotateField = rotateField;
    formContents.push({
      type: "universal-row",
      field1: {
        type: "text",
        value: translate("sidebar.selection-transformation.rotate"),
      },
      field2: { type: "auxiliaryElement", auxiliaryElement: rotateField },
      field3: {},
    });

    const {
      row: skewRow,
      fieldX: skewXField,
      fieldY: skewYField,
    } = this._buildScrubXYRow({
      label: translate("sidebar.selection-transformation.skew"),
      icon: "/images/skew.svg",
      tooltip: translate("sidebar.selection-transformation.skew"),
      valueX: this.transformParameters.skewX,
      valueY: this.transformParameters.skewY,
      onChangeX: (value) => (this.transformParameters.skewX = value),
      onChangeY: (value) => (this.transformParameters.skewY = value),
      onApply: () =>
        this.transformSelection(
          () =>
            new Transform().skew(
              (this.transformParameters.skewX * Math.PI) / 180,
              (this.transformParameters.skewY * Math.PI) / 180
            ),
          "skew"
        ),
      makeTransformationForX: (x) => () =>
        new Transform().skew(
          (x * Math.PI) / 180,
          (this.transformParameters.skewY * Math.PI) / 180
        ),
      makeTransformationForY: (y) => () =>
        new Transform().skew(
          (this.transformParameters.skewX * Math.PI) / 180,
          (y * Math.PI) / 180
        ),
      undoLabel: "skew",
    });
    this.skewXField = skewXField;
    this.skewYField = skewYField;
    formContents.push(skewRow);

    // A straight running exactly across the axis being scaled stands still by
    // default: travel along it is travel the scale never asked for. On, both of
    // its tension points travel, each to what its own curve asks for. A slanted
    // straight travels either way. App-wide, not per segment.
    formContents.push({
      type: "checkbox",
      key: "slideBothTensionPoints",
      label: translate("sidebar.selection-transformation.slide-both-tension-points"),
      value: applicationSettingsController.model.slideBothTensionPoints,
    });

    formContents.push({ type: "divider" });

    const applyDimensions = async () => {
      const glyph =
        await this.sceneController.sceneModel.getSelectedStaticGlyphController();
      const bounds = glyph?.getSelectionBounds(
        this.sceneController.selection,
        this.fontController.getBackgroundImageBoundsFunc
      );
      if (!bounds) {
        return;
      }
      const { width, height } = rectSize(bounds);
      const doScaleX = this.transformParameters.dimensionWidth != width;
      const doScaleY = this.transformParameters.dimensionHeight != height;

      if (doScaleX || doScaleY) {
        this.transformSelection((selectionBounds) => {
          const { width, height } = rectSize(selectionBounds);
          const newWidth = this.transformParameters.dimensionWidth || width;
          const newHeight = this.transformParameters.dimensionHeight || height;
          const scaleX = doScaleX ? newWidth / width : 1;
          const scaleY = doScaleY ? newHeight / height : 1;

          return new Transform().scale(scaleX, scaleY);
        }, "set dimensions");
      }
    };
    const {
      row: dimensionsRow,
      fieldX: dimensionWidthField,
      fieldY: dimensionHeightField,
    } = this._buildScrubXYRow({
      label: translate("sidebar.selection-info.dimensions"),
      icon: "/tabler-icons/dimensions.svg",
      tooltip: translate("sidebar.selection-info.dimensions"),
      valueX: this.transformParameters.dimensionWidth,
      valueY: this.transformParameters.dimensionHeight,
      onChangeX: (value) => (this.transformParameters.dimensionWidth = value),
      onChangeY: (value) => (this.transformParameters.dimensionHeight = value),
      onApply: applyDimensions,
      // Each axis scales independently against ITS OWN target: the axis
      // being dragged uses the drag's current total, the other reads
      // whatever it was last set to (or 1, unset). Bounds come from the
      // per-layer selectionBounds transformSelectionStream already computes
      // from the pre-drag state, not a live re-fetch.
      makeTransformationForX: (width) => (selectionBounds) => {
        const { width: curWidth, height: curHeight } = rectSize(selectionBounds);
        const scaleX = curWidth ? width / curWidth : 1;
        const targetHeight = this.transformParameters.dimensionHeight;
        const scaleY = targetHeight != null && curHeight ? targetHeight / curHeight : 1;
        return new Transform().scale(scaleX, scaleY);
      },
      makeTransformationForY: (height) => (selectionBounds) => {
        const { width: curWidth, height: curHeight } = rectSize(selectionBounds);
        const scaleY = curHeight ? height / curHeight : 1;
        const targetWidth = this.transformParameters.dimensionWidth;
        const scaleX = targetWidth != null && curWidth ? targetWidth / curWidth : 1;
        return new Transform().scale(scaleX, scaleY);
      },
      undoLabel: "set dimensions",
    });
    this.dimensionWidthField = dimensionWidthField;
    this.dimensionHeightField = dimensionHeightField;
    formContents.push(dimensionsRow);

    formContents.push({ type: "divider" });

    // Ticket 40: Flip and Align used to be a row plus a header-and-two-rows
    // section of their own; now they share one row under two small labels.
    const labelKeyPathOperations = "sidebar.selection-transformation.path-operations";

    const flipAlignRow = html.div({ class: "selection-row-group" }, [
      html.span({ class: "selection-row-group-label" }, [
        translate("sidebar.selection-transformation.flip"),
      ]),
      html.div({ class: "selection-row-group-icons" }, [
        html.createDomElement("icon-button", {
          "src": "/tabler-icons/flip-vertical.svg",
          "data-tooltip": translate("sidebar.selection-transformation.flip.vertically"),
          "data-tooltipposition": "top",
          "onclick": (event) =>
            this.transformSelection(
              () => new Transform().scale(-1, 1),
              "flip vertically"
            ),
        }),
        html.createDomElement("icon-button", {
          "src": "/tabler-icons/flip-horizontal.svg",
          "data-tooltip": translate(
            "sidebar.selection-transformation.flip.horizontally"
          ),
          "data-tooltipposition": "top",
          "onclick": (event) =>
            this.transformSelection(
              () => new Transform().scale(1, -1),
              "flip horizontally"
            ),
        }),
      ]),
      html.span({ class: "selection-row-group-label" }, [
        translate("sidebar.selection-transformation.align"),
      ]),
      html.div({ class: "selection-row-group-icons" }, [
        html.createDomElement("icon-button", {
          "src": "/tabler-icons/vertical-align-left.svg",
          "onclick": (event) => this.moveObjects(alignLeft),
          "data-tooltip": translate("sidebar.selection-transformation.align.left"),
          "data-tooltipposition": "top",
        }),
        html.createDomElement("icon-button", {
          "src": "/tabler-icons/vertical-align-center.svg",
          "onclick": (event) => this.moveObjects(alignCenter),
          "data-tooltip": translate("sidebar.selection-transformation.align.center"),
          "data-tooltipposition": "top",
        }),
        html.createDomElement("icon-button", {
          "src": "/tabler-icons/vertical-align-right.svg",
          "onclick": (event) => this.moveObjects(alignRight),
          "data-tooltip": translate("sidebar.selection-transformation.align.right"),
          "data-tooltipposition": "top",
        }),
        html.createDomElement("icon-button", {
          "src": "/tabler-icons/horizontal-align-top.svg",
          "onclick": (event) => this.moveObjects(alignTop),
          "data-tooltip": translate("sidebar.selection-transformation.align.top"),
          "data-tooltipposition": "top",
        }),
        html.createDomElement("icon-button", {
          "src": "/tabler-icons/horizontal-align-center.svg",
          "onclick": (event) => this.moveObjects(alignMiddle),
          "data-tooltip": translate("sidebar.selection-transformation.align.middle"),
          "data-tooltipposition": "top",
        }),
        html.createDomElement("icon-button", {
          "src": "/tabler-icons/horizontal-align-bottom.svg",
          "onclick": (event) => this.moveObjects(alignBottom),
          "data-tooltip": translate("sidebar.selection-transformation.align.bottom"),
          "data-tooltipposition": "top",
        }),
      ]),
    ]);
    formContents.push({ type: "single-icon", element: flipAlignRow });

    formContents.push({ type: "spacer" });

    // Ticket 40: Distribute (with its spacing number) and Bools (the path
    // operations) share the next row, same way.
    const distributionSpacingInput = html.input({
      "type": "number",
      "value":
        this.transformParameters.customDistributionSpacing == null
          ? ""
          : String(this.transformParameters.customDistributionSpacing),
      "data-tooltip": translate(
        "sidebar.selection-transformation.distribute.distance-in-units"
      ),
      "data-tooltipposition": "top",
      "oninput": (event) => {
        const raw = event.target.value;
        this.transformParameters.customDistributionSpacing =
          raw === "" ? null : Number(raw);
      },
    });

    const distributeBoolsRow = html.div({ class: "selection-row-group" }, [
      html.span({ class: "selection-row-group-label" }, [
        translate("sidebar.selection-transformation.distribute"),
      ]),
      html.div({ class: "selection-row-group-icons" }, [
        html.createDomElement("icon-button", {
          "src": "/tabler-icons/layout-distribute-vertical.svg",
          "onclick": (event) => this.moveObjects(distributeHorizontally),
          "data-tooltip": translate(
            "sidebar.selection-transformation.distribute.horizontally"
          ),
          "data-tooltipposition": "top",
        }),
        html.createDomElement("icon-button", {
          "src": "/tabler-icons/layout-distribute-horizontal.svg",
          "onclick": (event) => this.moveObjects(distributeVertically),
          "data-tooltip": translate(
            "sidebar.selection-transformation.distribute.vertically"
          ),
          "data-tooltipposition": "top",
        }),
        distributionSpacingInput,
      ]),
      html.span({ class: "selection-row-group-label" }, [
        translate(labelKeyPathOperations),
      ]),
      html.div({ class: "selection-row-group-icons" }, [
        html.createDomElement("icon-button", {
          "src": "/tabler-icons/layers-union.svg",
          "onclick": (event) =>
            this.doPathOperations(this.pathOperations.unionPath, "union"),
          "data-tooltip": translate(`${labelKeyPathOperations}.union`),
          "data-tooltipposition": "top",
        }),
        html.createDomElement("icon-button", {
          "src": "/tabler-icons/layers-subtract.svg",
          "onclick": (event) =>
            this.doPathOperations(this.pathOperations.subtractPath, "subtract"),
          "data-tooltip": translate(`${labelKeyPathOperations}.subtract`),
          "data-tooltipposition": "top",
        }),
        html.createDomElement("icon-button", {
          "src": "/tabler-icons/layers-intersect-2.svg",
          "onclick": (event) =>
            this.doPathOperations(this.pathOperations.intersectPath, "intersect"),
          "data-tooltip": translate(`${labelKeyPathOperations}.intersect`),
          "data-tooltipposition": "top",
        }),
        html.createDomElement("icon-button", {
          "src": "/tabler-icons/layers-difference.svg",
          "onclick": (event) =>
            this.doPathOperations(this.pathOperations.excludePath, "exclude"),
          "data-tooltip": translate(`${labelKeyPathOperations}.exclude`),
          "data-tooltipposition": "top",
        }),
      ]),
    ]);
    formContents.push({ type: "single-icon", element: distributeBoolsRow });

    // Point labels checkboxes moved to the Measurements accordion in the
    // Designspace panel's Visual group (ticket 28); the Harmonize section
    // below no longer has a position-bound sibling ahead of it.
    formContents.push({ type: "divider" });

    // Ticket 43: Run keeps its label, moved to the right end of the header.
    formContents.push({
      type: "header",
      label: translate("sidebar.selection-transformation.harmonize"),
      auxiliaryElement: html.button({ onclick: () => this.doHarmonize() }, [
        translate("sidebar.selection-transformation.harmonize.apply"),
      ]),
    });

    // Ticket 43: G3 becomes a labeled toggle. Built as a raw auxiliaryElement
    // row -- like the segmented control above -- rather than through the
    // Form's checkbox field type, since a plain checked/change pair is all it
    // needs and this way it can trigger the same rebuild the checkbox's
    // special case in onFieldChange used to (greying the segmented control
    // is a rebuild-only change).
    this.harmonizeG3Toggle = html.createDomElement("labeled-toggle", {
      label: translate("sidebar.selection-transformation.harmonize.g3"),
      checked: !!applicationSettingsController.model.harmonizeG3,
    });
    this.harmonizeG3Toggle.addEventListener("change", () => {
      applicationSettingsController.model.harmonizeG3 = this.harmonizeG3Toggle.checked;
      this.update();
    });
    formContents.push({
      type: "universal-row",
      field1: { type: "auxiliaryElement", auxiliaryElement: this.harmonizeG3Toggle },
      field2: {},
      field3: {},
    });

    // Ticket 42: a segmented control -- preserve, recompute, move on-curve --
    // in place of the three-position slider. One press draws one answer, so
    // there is no mid-gesture state to preserve and no separate name-element
    // row is needed; the lit segment already says which position is active.
    this.harmonizeMethodControl = html.createDomElement("segmented-control", {
      options: [1, 2, 3].map((method) => ({
        value: method,
        label: translate(
          `sidebar.selection-transformation.harmonize.method.${method}.short`
        ),
      })),
      value: applicationSettingsController.model.harmonizeG3
        ? 2
        : applicationSettingsController.model.harmonizeMethod,
      // G3 has one construction, so there is nothing for the control to say.
      disabled: !!applicationSettingsController.model.harmonizeG3,
    });
    this.harmonizeMethodControl.addEventListener("change", (event) => {
      applicationSettingsController.model.harmonizeMethod = event.detail.value;
    });
    formContents.push({
      type: "universal-row",
      field1: {
        type: "text",
        value: translate("sidebar.selection-transformation.harmonize.method"),
      },
      field2: {
        type: "auxiliaryElement",
        auxiliaryElement: this.harmonizeMethodControl,
      },
      field3: {},
    });

    formContents.push({
      type: "checkbox",
      key: "harmonizeEqualize",
      label: translate("sidebar.selection-transformation.harmonize.equalize"),
      value: applicationSettingsController.model.harmonizeEqualize,
    });

    formContents.push({
      type: "checkbox",
      key: "harmonizeOtherSources",
      label: translate("sidebar.selection-transformation.harmonize.other-sources"),
      value: applicationSettingsController.model.harmonizeOtherSources,
    });

    formContents.push({
      type: "universal-row",
      field1: {},
      field2: {
        type: "auxiliaryElement",
        auxiliaryElement: (this.harmonizeReportElement = html.span(
          { class: "harmonize-report", title: this.harmonizeReportDetail || "" },
          [this.harmonizeReportText || ""]
        )),
      },
      field3: {},
    });

    this.infoForm.setFieldDescriptions(formContents);

    this.infoForm.onFieldChange = async (fieldItem, value, valueStream) => {
      // A dragged slider calls this once, at drag start, with the value it had
      // *before* the drag; every value after that arrives on valueStream
      // (ui-form.js:545-567). Ignoring the stream stores a value one drag
      // behind whatever the slider shows.
      if (valueStream) {
        for await (const streamedValue of valueStream) {
          // An abandoned drag has nothing to commit.
          if (isScrubCancelled(streamedValue)) {
            return;
          }
          value = streamedValue;
        }
      }

      this.transformParameters[fieldItem.key] = value;

      if (
        [
          "harmonizeEqualize",
          "harmonizeOtherSources",
          "slideBothTensionPoints",
        ].includes(fieldItem.key)
      ) {
        applicationSettingsController.model[fieldItem.key] = value;
      }

      if (fieldItem.key === "originXButton" || fieldItem.key === "originYButton") {
        this.transformParameters[fieldItem.key.replace("Button", "")] = value;

        const iconRadioButtons = this.infoForm.shadowRoot.querySelectorAll(
          ".ui-form-radio-button"
        );
        iconRadioButtons.forEach((radioButton) => {
          radioButton.checked = false;
        });
      }
    };

    this.updateDimensions();
  }

  async doHarmonize() {
    const settings = applicationSettingsController.model;
    const options = {
      useG3: !!settings.harmonizeG3,
      // Read off the slider itself, not off the stored setting. The stored one
      // is written from a value stream that a click can close early, and a
      // command that does something other than what the panel shows is worse
      // than one that does nothing.
      method: this.harmonizeMethodOnScreen(),
      equalizeHandles: !!settings.harmonizeEqualize,
      applyToOtherSources: settings.harmonizeOtherSources,
    };
    const reports = await this.sceneController.doHarmonize(options);
    this.setHarmonizeReport(
      formatHarmonizeReport(reports),
      detailHarmonizeReport(reports, options)
    );
  }

  // The position the segmented control is actually showing. Falls back to
  // the stored setting where the panel has not been built yet, which is how
  // a keyboard shortcut reaches this before the panel is ever opened.
  harmonizeMethodOnScreen() {
    const shown = this.harmonizeMethodControl?.value;
    if (shown >= 1 && shown <= 3) {
      return shown;
    }
    return applicationSettingsController.model.harmonizeMethod;
  }

  setHarmonizeReport(text, detail = "") {
    this.harmonizeReportText = text;
    this.harmonizeReportDetail = detail;
    if (this.harmonizeReportElement) {
      this.harmonizeReportElement.innerText = text;
      this.harmonizeReportElement.title = detail;
    }
  }

  async updateDimensions() {
    const glyph =
      await this.sceneController.sceneModel.getSelectedStaticGlyphController();

    const settings = this.sceneController.sceneSettings;
    const bounds =
      glyph &&
      settings.selectedGlyph?.isEditing &&
      settings.selectedGlyphName &&
      settings.selection?.size
        ? glyph.getSelectionBounds(
            this.sceneController.selection,
            this.fontController.getBackgroundImageBoundsFunc
          )
        : null;

    const { width: rawWidth, height: rawHeight } = bounds
      ? rectSize(bounds)
      : { width: null, height: null };
    // One decimal place, same precision the field showed before it became a
    // compact-scrub-field (numDigits: 1).
    const width = rawWidth == null ? null : Math.round(rawWidth * 10) / 10;
    const height = rawHeight == null ? null : Math.round(rawHeight * 10) / 10;
    if (this.dimensionWidthField) {
      this.dimensionWidthField.value = width;
    }
    if (this.dimensionHeightField) {
      this.dimensionHeightField.value = height;
    }
    this.transformParameters.dimensionWidth = width;
    this.transformParameters.dimensionHeight = height;
  }

  async doPathOperations(pathOperationFunc, key) {
    if (!this.sceneController.sceneSettings.selectedGlyph?.isEditing) {
      return;
    }

    const positionedGlyph =
      this.sceneController.sceneModel.getSelectedPositionedGlyph();

    if (!positionedGlyph) {
      return;
    }

    const undoLabel = translate(
      `sidebar.selection-transformation.path-operations.${key}`
    );
    const doUnion = pathOperationFunc === this.pathOperations.unionPath;
    let { point: pointIndices } = parseSelection(this.sceneController.selection);
    pointIndices = pointIndices || [];

    if (!pointIndices.length && !doUnion) {
      return;
    }

    const selectedContourIndicesMap = getSelectionByContour(
      positionedGlyph.glyph.path,
      pointIndices
    );
    const selectedContourIndices = [...selectedContourIndicesMap.keys()];

    if (
      !doUnion &&
      selectedContourIndices.length === positionedGlyph.glyph.path.numContours
    ) {
      // All contours are selected and we're not doing remove overlap: this will
      // result in an empty path or in the same path depending on the operator.
      return;
    }

    const isContourSelected =
      pointIndices.length || !doUnion
        ? (i) => selectedContourIndicesMap.has(i)
        : (i) => true;

    const editLayerGlyphs = this.sceneController.getEditingLayerFromGlyphLayers(
      positionedGlyph.varGlyph.glyph.layers
    );

    if (!positionedGlyph.glyph.layerName) {
      const newLayerName =
        this.fontController.fontSourcesInstancer.getSourceIdentifierForLocation(
          this.sceneController.sceneSettings.fontLocationSourceMapped
        );
      if (newLayerName) {
        editLayerGlyphs[newLayerName] = positionedGlyph.glyph.instance;
      }
    }

    const layerPaths = await mapObjectValuesAsync(
      editLayerGlyphs,
      async (layerGlyph) => {
        const path = layerGlyph.path;
        const selectedContoursPath = new VarPackedPath();
        const unselectedContoursPath = new VarPackedPath();

        for (const contourIndex of range(path.numContours)) {
          if (isContourSelected(contourIndex)) {
            selectedContoursPath.appendContour(path.getContour(contourIndex));
          } else {
            unselectedContoursPath.appendContour(path.getContour(contourIndex));
          }
        }
        if (doUnion) {
          return await pathOperationFunc(selectedContoursPath);
        } else {
          return await pathOperationFunc(unselectedContoursPath, selectedContoursPath);
        }
      }
    );

    await this.sceneController.editGlyphAndRecordChanges(
      (glyph) => {
        for (const [layerName, layerPath] of Object.entries(layerPaths)) {
          if (doUnion && pointIndices.length) {
            // Union of selected contours: the selected contours (never
            // generated ones — those are unselectable) are deleted and the
            // boolean result is appended, so the surviving generated contours
            // only move; re-derive their indices via a marked dry run.
            const layerGlyph = glyph.layers[layerName].glyph;
            const structuralEdit = (path) => {
              for (const contourIndex of reversed(selectedContourIndices)) {
                path.deleteContour(contourIndex);
              }
              path.appendPath(layerPath);
            };
            const remap = computeGeneratedContourRemap(layerGlyph, structuralEdit);
            structuralEdit(layerGlyph.path);
            applyGeneratedContourRemap(layerGlyph, remap);
          } else {
            // Whole-path boolean ops (union-all, subtract/intersect/exclude)
            // consume every contour, generated ones included: the result no
            // longer corresponds to the skeleton's generated bookkeeping.
            // Documented WS-9 limitation (Deviations): with an active skeleton
            // these ops are destructive to the generated linkage.
            glyph.layers[layerName].glyph.path = layerPath;
          }
        }
        return undoLabel.toLowerCase();
      },
      undefined,
      true
    );

    this.sceneController.selection = new Set(); // Clear selection
  }

  async transformSelection(transformationForLayer, undoLabel) {
    let {
      point: pointIndices,
      component: componentIndices,
      anchor: anchorIndices,
      backgroundImage: backgroundImageIndices,
      skeletonPoint: skeletonPointKeys,
    } = parseSelection(this.sceneController.selection);

    pointIndices = pointIndices || [];
    componentIndices = componentIndices || [];
    anchorIndices = anchorIndices || [];
    backgroundImageIndices = backgroundImageIndices || [];
    skeletonPointKeys = skeletonPointKeys || [];
    if (
      !pointIndices.length &&
      !componentIndices.length &&
      !anchorIndices.length &&
      !backgroundImageIndices.length &&
      !skeletonPointKeys.length
    ) {
      return false;
    }

    const glyphController =
      await this.sceneController.sceneModel.getSelectedStaticGlyphController();
    const staticGlyphControllers =
      await this.sceneController.getStaticGlyphControllers();

    await this.sceneController.editGlyph((sendIncrementalChange, glyph) => {
      const editingLayers = this.sceneController.getEditingLayerFromGlyphLayers(
        glyph.layers
      );
      const editLayerName = this.sceneController.sceneSettings.editLayerName;
      const referenceSkeletonData = getSkeletonData(
        editingLayers[editLayerName] || Object.values(editingLayers)[0]
      );
      const layerInfo = Object.entries(editingLayers).map(([layerName, layerGlyph]) => {
        const skeletonEntry = makeSkeletonPointTargetEntry(
          layerGlyph,
          this.sceneController.selection,
          "default",
          referenceSkeletonData
        );
        const behaviorFactory = new EditBehaviorFactory(
          layerGlyph,
          this.sceneController.selection,
          this.sceneController.selectedTool.scalingEditBehavior,
          { targetEntries: skeletonEntry ? [skeletonEntry] : [] }
        );
        return {
          layerName,
          changePath: ["layers", layerName, "glyph"],
          layerGlyph: layerGlyph,
          selectionBounds: unionRect(
            ...[
              (staticGlyphControllers[layerName] || glyphController).getSelectionBounds(
                this.sceneController.selection,
                this.fontController.getBackgroundImageBoundsFunc
              ),
              getSkeletonSelectionBounds(layerGlyph, this.sceneController.selection),
            ].filter((bounds) => bounds)
          ),
          editBehavior: behaviorFactory.getTransformBehavior("default"),
        };
      });

      const editChanges = [];
      const rollbackChanges = [];
      for (const {
        changePath,
        editBehavior,
        selectionBounds,
        layerGlyph,
      } of layerInfo) {
        const pinPoint = getPinPoint(
          selectionBounds,
          this.transformParameters.originX,
          this.transformParameters.originY
        );

        const pinnedTransformation = new Transform()
          .translate(pinPoint.x, pinPoint.y)
          .transform(transformationForLayer(selectionBounds))
          .translate(-pinPoint.x, -pinPoint.y);

        const editChange =
          editBehavior.makeChangeForTransformation(pinnedTransformation);

        applyChange(layerGlyph, editChange);
        editChanges.push(consolidateChanges(editChange, changePath));
        rollbackChanges.push(
          consolidateChanges(editBehavior.rollbackChange, changePath)
        );
      }

      let changes = ChangeCollector.fromChanges(
        consolidateChanges(editChanges),
        consolidateChanges(rollbackChanges)
      );

      return {
        changes: changes,
        undoLabel: undoLabel,
        broadcast: true,
        undoInfo: this._transformUndoInfo(),
      };
    });
    return true;
  }

  // Live-preview version of transformSelection: opens ONE editGlyph edit for
  // the whole drag (a scrub's "scrubstart" valueStream) instead of one call
  // per frame, so the gesture ends as a single undo step. Copied from
  // skeleton-panel-edits.js's streamOntoSkeleton -- same shape, same
  // reasoning ("A rollback is a statement about the whole gesture, so every
  // frame records against a fresh copy of the pre-drag state, never the live
  // glyph"): every frame first plays editBehavior.rollbackChange, which is a
  // fixed, absolute-value restore captured once when the behavior was built
  // (edit-behavior.js's makeRollbackChange bakes in the ORIGINAL point
  // coordinates), so it is safe to replay before every frame regardless of
  // what an earlier frame left behind -- there is no per-frame delta to
  // compound. `makeTransformationForLayer(value)` gets the stream's current
  // value (the drag's running total, not a delta) and must return a
  // `(selectionBounds) => Transform`, the same shape transformSelection's own
  // `transformationForLayer` takes.
  async transformSelectionStream(valueStream, makeTransformationForLayer, undoLabel) {
    let {
      point: pointIndices,
      component: componentIndices,
      anchor: anchorIndices,
      backgroundImage: backgroundImageIndices,
      skeletonPoint: skeletonPointKeys,
    } = parseSelection(this.sceneController.selection);

    pointIndices = pointIndices || [];
    componentIndices = componentIndices || [];
    anchorIndices = anchorIndices || [];
    backgroundImageIndices = backgroundImageIndices || [];
    skeletonPointKeys = skeletonPointKeys || [];
    if (
      !pointIndices.length &&
      !componentIndices.length &&
      !anchorIndices.length &&
      !backgroundImageIndices.length &&
      !skeletonPointKeys.length
    ) {
      // Drain the stream so a caller awaiting it settles even with nothing
      // selected to move.
      for await (const _ of valueStream) {
      }
      return false;
    }

    const glyphController =
      await this.sceneController.sceneModel.getSelectedStaticGlyphController();
    const staticGlyphControllers =
      await this.sceneController.getStaticGlyphControllers();

    // Set from inside the editGlyph callback, on the one path that actually
    // commits a change -- a caller uses this to tell "the drag applied
    // something" from "it was cancelled, or never moved," so it only resets
    // a row's fields back to their neutral, next-drag-starts-here defaults
    // after a real apply, never after an abandoned gesture (which already
    // put the field itself back to its pre-drag number).
    let committed = false;

    await this.sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
      const editingLayers = this.sceneController.getEditingLayerFromGlyphLayers(
        glyph.layers
      );
      const editLayerName = this.sceneController.sceneSettings.editLayerName;
      const referenceSkeletonData = getSkeletonData(
        editingLayers[editLayerName] || Object.values(editingLayers)[0]
      );
      // Built once, from the pre-drag glyph: editBehavior's captured
      // reference points (and its rollbackChange) never change, whatever
      // value a later frame asks it to transform toward.
      const layerInfo = Object.entries(editingLayers).map(([layerName, layerGlyph]) => {
        const skeletonEntry = makeSkeletonPointTargetEntry(
          layerGlyph,
          this.sceneController.selection,
          "default",
          referenceSkeletonData
        );
        const behaviorFactory = new EditBehaviorFactory(
          layerGlyph,
          this.sceneController.selection,
          this.sceneController.selectedTool.scalingEditBehavior,
          { targetEntries: skeletonEntry ? [skeletonEntry] : [] }
        );
        return {
          layerName,
          changePath: ["layers", layerName, "glyph"],
          layerGlyph: layerGlyph,
          selectionBounds: unionRect(
            ...[
              (staticGlyphControllers[layerName] || glyphController).getSelectionBounds(
                this.sceneController.selection,
                this.fontController.getBackgroundImageBoundsFunc
              ),
              getSkeletonSelectionBounds(layerGlyph, this.sceneController.selection),
            ].filter((bounds) => bounds)
          ),
          editBehavior: behaviorFactory.getTransformBehavior("default"),
        };
      });

      const applyValue = (value) => {
        const editChanges = [];
        const rollbackChanges = [];
        for (const {
          changePath,
          editBehavior,
          selectionBounds,
          layerGlyph,
        } of layerInfo) {
          // Back to the pre-drag state first -- idempotent, so it does not
          // matter whether the previous frame ran or was skipped.
          applyChange(layerGlyph, editBehavior.rollbackChange);

          const pinPoint = getPinPoint(
            selectionBounds,
            this.transformParameters.originX,
            this.transformParameters.originY
          );
          const pinnedTransformation = new Transform()
            .translate(pinPoint.x, pinPoint.y)
            .transform(makeTransformationForLayer(value)(selectionBounds))
            .translate(-pinPoint.x, -pinPoint.y);

          const editChange =
            editBehavior.makeChangeForTransformation(pinnedTransformation);
          applyChange(layerGlyph, editChange);
          editChanges.push(consolidateChanges(editChange, changePath));
          rollbackChanges.push(
            consolidateChanges(editBehavior.rollbackChange, changePath)
          );
        }
        return ChangeCollector.fromChanges(
          consolidateChanges(editChanges),
          consolidateChanges(rollbackChanges)
        );
      };

      const THROTTLE_MS = 32;
      let lastValue = null;
      let lastApplied = null;
      let lastCollector = null;
      let lastTime = 0;
      let cancelled = false;
      for await (const value of valueStream) {
        if (isScrubCancelled(value)) {
          cancelled = true;
          break;
        }
        lastValue = value;
        const now = Date.now();
        if (now - lastTime < THROTTLE_MS) {
          continue;
        }
        lastTime = now;
        lastCollector = applyValue(value);
        lastApplied = value;
        await sendIncrementalChange(lastCollector.change, true);
      }

      // Abandoned: put the shape back where the drag found it and record
      // nothing, so it is not an undo step -- the same ending a drag that
      // never crossed the dead zone already had.
      if (cancelled) {
        if (lastCollector) {
          for (const { editBehavior, layerGlyph } of layerInfo) {
            applyChange(layerGlyph, editBehavior.rollbackChange);
          }
          await sendIncrementalChange(lastCollector.rollbackChange);
        }
        return;
      }
      if (lastValue === null) {
        return;
      }
      // Throttling may have skipped the last frame the drag actually sent;
      // make sure the committed value is the one the field is showing.
      if (lastApplied !== lastValue || !lastCollector) {
        lastCollector = applyValue(lastValue);
      }
      await sendIncrementalChange(lastCollector.change);
      committed = true;
      return {
        changes: lastCollector,
        undoLabel,
        broadcast: true,
        undoInfo: this._transformUndoInfo(),
      };
    });
    return committed;
  }

  _changeOrigin(keyX, keyY) {
    this.transformParameters.originX = keyX;
    this.transformParameters.originY = keyY;
    this.transformParameters.originXButton = undefined;
    this.transformParameters.originYButton = undefined;
    this.infoForm.setValue("originXButton", null);
    this.infoForm.setValue("originYButton", null);
  }

  _splitSelection(layerGlyphController, selection) {
    let {
      point: pointIndices,
      component: componentIndices,
      anchor: anchorIndices,
      backgroundImage: backgroundImageIndices,
      skeletonPoint: skeletonPointKeys,
    } = parseSelection(selection);
    pointIndices = pointIndices || [];

    const points = [];
    const contours = [];
    const components = componentIndices || [];
    const anchors = anchorIndices || [];
    const backgroundImages = backgroundImageIndices || [];
    // Each selected skeleton on-curve point is its own movable object (donor
    // per-point align/distribute behavior). Keys stay id-based (skeletonPoint/
    // <contourId>/<pointId>); the factory skeleton target entry moves them.
    const skeletonPoints = (skeletonPointKeys || []).map(
      (remainder) => `skeletonPoint/${remainder}`
    );

    if (!pointIndices.length) {
      return {
        points,
        contours,
        components,
        anchors,
        backgroundImages,
        skeletonPoints,
      };
    }

    const path = layerGlyphController.instance.path;
    const pathSelection = filterPathByPointIndices(
      layerGlyphController.instance.path,
      pointIndices
    );
    const selectionByContour = getSelectionByContour(path, pointIndices);

    let contourIndex = 0;
    for (const pointIndex of pointIndices) {
      while (path.contourInfo[contourIndex].endPoint < pointIndex) {
        contourIndex++;
      }

      let pathSelectionContourIndex;
      for (const [j, [cIndex, contourSelection]] of enumerate(selectionByContour)) {
        if (contourIndex === cIndex) {
          pathSelectionContourIndex = j;
          break;
        }
      }

      if (pathSelection.contourInfo[pathSelectionContourIndex].isClosed) {
        const contourStartIndex = !contourIndex
          ? 0
          : layerGlyphController.instance.path.contourInfo[contourIndex - 1].endPoint +
            1;
        const contourEndIndex = path.contourInfo[contourIndex].endPoint + 1;

        const contourPoints = Array.from(range(contourStartIndex, contourEndIndex));

        if (contourStartIndex === pointIndex) {
          // only add list of contours
          // if the point is the start of the contour
          contours.push(contourPoints);
        }
      } else {
        points.push(pointIndex);
      }
    }

    return { points, contours, components, anchors, backgroundImages, skeletonPoints };
  }

  _collectMovableObjects(moveDescriptor, controller) {
    const { points, contours, components, anchors, backgroundImages, skeletonPoints } =
      this._splitSelection(controller, this.sceneController.selection);

    const movableObjects = [];
    for (const pointIndex of points) {
      movableObjects.push(new MovablePoint(pointIndex));
    }
    for (const [contourIndex, pointIndices] of enumerate(contours)) {
      const individualSelection = new Set(
        pointIndices.map((pointIndex) => `point/${pointIndex}`)
      );
      movableObjects.push(new MovableObject(individualSelection));
    }
    for (const componentIndex of components) {
      const individualSelection = new Set([`component/${componentIndex}`]);
      movableObjects.push(new MovableObject(individualSelection));
    }
    for (const anchorIndex of anchors) {
      const individualSelection = new Set([`anchor/${anchorIndex}`]);
      movableObjects.push(new MovableObject(individualSelection));
    }
    for (const backgroundImageIndex of backgroundImages) {
      const individualSelection = new Set([`backgroundImage/${backgroundImageIndex}`]);
      movableObjects.push(new MovableObject(individualSelection));
    }
    for (const skeletonPointKey of skeletonPoints) {
      movableObjects.push(new MovableObject(new Set([skeletonPointKey])));
    }

    if (moveDescriptor.compareObjects) {
      movableObjects.sort((a, b) =>
        moveDescriptor.compareObjects(
          a,
          b,
          controller,
          this.fontController.getBackgroundImageBoundsFunc
        )
      );
    }

    return movableObjects;
  }

  async moveObjects(moveDescriptor) {
    const glyphController =
      await this.sceneController.sceneModel.getSelectedStaticGlyphController();
    const movableObjects = this._collectMovableObjects(moveDescriptor, glyphController);
    if (movableObjects.length <= 1) {
      return;
    }

    const staticGlyphControllers =
      await this.sceneController.getStaticGlyphControllers();
    await this.sceneController.editGlyph((sendIncrementalChange, glyph) => {
      const editLayerGlyphs = this.sceneController.getEditingLayerFromGlyphLayers(
        glyph.layers
      );
      // Skeleton selection ids are canonical in the edit layer; other layers
      // resolve by structural ordinal (WS-9 cross-layer addressing).
      const editLayerName = this.sceneController.sceneSettings.editLayerName;
      const referenceSkeletonData = getSkeletonData(
        editLayerGlyphs[editLayerName] || Object.values(editLayerGlyphs)[0]
      );

      const editChanges = [];
      const rollbackChanges = [];
      for (const [layerName, layerGlyph] of Object.entries(editLayerGlyphs)) {
        const changePath = ["layers", layerName, "glyph"];
        const controller = staticGlyphControllers[layerName] || glyphController;

        const boundingBoxes = movableObjects.map((obj) =>
          obj.computeBounds(
            controller,
            this.fontController.getBackgroundImageBoundsFunc
          )
        );
        const deltas = moveDescriptor.computeDeltasFromBoundingBoxes(
          boundingBoxes,
          this.transformParameters.customDistributionSpacing
        );
        for (const [delta, movableObject] of zip(deltas, movableObjects)) {
          const [editChange, rollbackChange] = movableObject.makeChangesForDelta(
            delta,
            layerGlyph,
            this.sceneController,
            referenceSkeletonData
          );
          applyChange(layerGlyph, editChange);
          editChanges.push(consolidateChanges(editChange, changePath));
          // Each object is moved on top of the one before it, so its rollback
          // restores the state the PREVIOUS object left behind, not the state
          // this whole edit started from. Undoing them front to back therefore
          // ends on the second-to-last object's result and keeps every earlier
          // move. They have to come off in the reverse order they went on —
          // which is what the change collector does for changes it records
          // itself, and what this hand-assembled list has to do by hand.
          rollbackChanges.unshift(consolidateChanges(rollbackChange, changePath));
        }
      }

      let changes = ChangeCollector.fromChanges(
        consolidateChanges(editChanges),
        consolidateChanges(rollbackChanges)
      );

      return {
        changes: changes,
        undoLabel: moveDescriptor.undoLabel,
        broadcast: true,
      };
    });
  }

  async toggle(on, focus) {
    if (on) {
      this.update();
    }
  }
}

export function getPinPoint(bounds, originX, originY) {
  const { width, height } = rectSize(bounds);

  // default from center
  let pinPointX = bounds.xMin + width / 2;
  let pinPointY = bounds.yMin + height / 2;

  if (typeof originX === "number") {
    pinPointX = originX;
  } else if (originX === "left") {
    pinPointX = bounds.xMin;
  } else if (originX === "right") {
    pinPointX = bounds.xMax;
  }

  if (typeof originY === "number") {
    pinPointY = originY;
  } else if (originY === "top") {
    pinPointY = bounds.yMax;
  } else if (originY === "bottom") {
    pinPointY = bounds.yMin;
  }

  return { x: pinPointX, y: pinPointY };
}

// Define MovableObject classes
class MovableObject {
  constructor(selection) {
    this.selection = selection;
  }

  computeBounds(staticGlyphController, getBackgroundImageBoundsFunc) {
    return staticGlyphController.getSelectionBounds(
      this.selection,
      getBackgroundImageBoundsFunc
    );
  }

  makeChangesForDelta(
    delta,
    layerGlyph,
    sceneController,
    referenceSkeletonData = null
  ) {
    // A skeleton-only movable object carries its point through the WS-9 factory
    // target entry (no SkeletonMovableObject; the factory owns dispatch).
    const skeletonEntry = makeSkeletonPointTargetEntry(
      layerGlyph,
      this.selection,
      "default",
      referenceSkeletonData
    );
    const behaviorFactory = new EditBehaviorFactory(
      layerGlyph,
      this.selection,
      sceneController.selectedTool.scalingEditBehavior,
      { targetEntries: skeletonEntry ? [skeletonEntry] : [] }
    );

    const editBehavior = behaviorFactory.getBehavior("default");
    const editChange = editBehavior.makeChangeForDelta(delta);
    return [editChange, editBehavior.rollbackChange];
  }
}

// An individually movable path point. Bounds must be the point's own
// coordinate: getSelectionBounds' filterPathByPointIndices expands an
// off-curve selection to its whole segment, which would give every handle its
// segment's box — handles sharing a segment then align to zero deltas.
class MovablePoint extends MovableObject {
  constructor(pointIndex) {
    super(new Set([`point/${pointIndex}`]));
    this.pointIndex = pointIndex;
  }

  computeBounds(staticGlyphController) {
    const point = staticGlyphController.instance.path.getPoint(this.pointIndex);
    if (!point) {
      return undefined;
    }
    return { xMin: point.x, yMin: point.y, xMax: point.x, yMax: point.y };
  }
}

// Define moveDescriptor objects
const alignLeft = {
  undoLabel: "align left", // TODO: maybe use translate("sidebar.selection-transformation.align.left")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const xMins = boundingBoxes.map((bounds) => bounds.xMin);
    const left = Math.min(...xMins);
    return xMins.map((xMin) => ({
      x: left - xMin,
      y: 0,
    }));
  },
};

const alignCenter = {
  undoLabel: "align center", // TODO: maybe use translate("sidebar.selection-transformation.align.center")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const xMaxes = boundingBoxes.map((bounds) => bounds.xMax);
    const xMins = boundingBoxes.map((bounds) => bounds.xMin);
    const left = Math.min(...xMins);
    const right = Math.max(...xMaxes);
    return boundingBoxes.map((bounds) => ({
      x: left - bounds.xMin + (right - left) / 2 - (bounds.xMax - bounds.xMin) / 2,
      y: 0,
    }));
  },
};

const alignRight = {
  undoLabel: "align right", // TODO: maybe use translate("sidebar.selection-transformation.align.right")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const xMaxes = boundingBoxes.map((bounds) => bounds.xMax);
    const right = Math.max(...xMaxes);
    return xMaxes.map((xMax) => ({
      x: right - xMax,
      y: 0,
    }));
  },
};

const alignTop = {
  undoLabel: "align top", // TODO: maybe use translate("sidebar.selection-transformation.align.top")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const yMaxes = boundingBoxes.map((bounds) => bounds.yMax);
    const top = Math.max(...yMaxes);
    return yMaxes.map((yMax) => ({
      x: 0,
      y: top - yMax,
    }));
  },
};

const alignMiddle = {
  undoLabel: "align middle", // TODO: maybe use translate("sidebar.selection-transformation.align.middle")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const yMaxes = boundingBoxes.map((bounds) => bounds.yMax);
    const yMins = boundingBoxes.map((bounds) => bounds.yMin);
    const bottom = Math.min(...yMins);
    const top = Math.max(...yMaxes);
    return boundingBoxes.map((bounds) => ({
      x: 0,
      y: top - bounds.yMax + (bounds.yMax - bounds.yMin) / 2 - (top - bottom) / 2,
    }));
  },
};

const alignBottom = {
  undoLabel: "align bottom", // TODO: maybe use translate("sidebar.selection-transformation.align.bottom")
  computeDeltasFromBoundingBoxes: (boundingBoxes) => {
    const yMins = boundingBoxes.map((bounds) => bounds.yMin);
    const bottom = Math.min(...yMins);
    return yMins.map((yMin) => ({
      x: 0,
      y: bottom - yMin,
    }));
  },
};

class DistributeObjectsDescriptor {
  constructor(direction, directionVar) {
    this.undoLabel = `distribute ${direction}`;
    this.minProperty = `${directionVar}Min`;
    this.maxProperty = `${directionVar}Max`;
    this.deltaProperty = directionVar;
  }

  computeDeltasFromBoundingBoxes(boundingBoxes, customDistributionSpacing) {
    let effectiveExtent = 0;
    for (const bounds of boundingBoxes) {
      effectiveExtent += bounds[this.maxProperty] - bounds[this.minProperty];
    }
    const mins = boundingBoxes.map((bounds) => bounds[this.minProperty]);
    const maxes = boundingBoxes.map((bounds) => bounds[this.maxProperty]);
    const minimum = Math.min(...mins);
    const maximum = Math.max(...maxes);

    const distributionSpacing =
      customDistributionSpacing === null
        ? (maximum - minimum - effectiveExtent) / (boundingBoxes.length - 1)
        : customDistributionSpacing;

    let next = minimum;
    let deltas = [];
    for (const bounds of boundingBoxes) {
      const extent = bounds[this.maxProperty] - bounds[this.minProperty];
      const delta = { x: 0, y: 0 };
      delta[this.deltaProperty] = next - bounds[this.minProperty];
      deltas.push(delta);
      next += extent + distributionSpacing;
    }
    return deltas;
  }

  compareObjects(a, b, glyphController, getBackgroundImageBoundsFunc) {
    return (
      rectCenter(a.computeBounds(glyphController, getBackgroundImageBoundsFunc))[
        this.deltaProperty
      ] -
      rectCenter(b.computeBounds(glyphController, getBackgroundImageBoundsFunc))[
        this.deltaProperty
      ]
    );
  }
}

const distributeHorizontally = new DistributeObjectsDescriptor("horizontally", "x");
const distributeVertically = new DistributeObjectsDescriptor("vertically", "y");

function summarizeHarmonizeReport(report) {
  // Group by status, and within a status by reason. "2 skipped" on its own is
  // not answerable; "2 skipped (not a smooth point)" is.
  const byStatus = new Map();
  for (const { status, reason } of report) {
    if (!byStatus.has(status)) {
      byStatus.set(status, { total: 0, reasons: new Map() });
    }
    const entry = byStatus.get(status);
    entry.total += 1;
    if (reason) {
      entry.reasons.set(reason, (entry.reasons.get(reason) || 0) + 1);
    }
  }

  const parts = [];
  for (const status of ["harmonized", "partial", "skipped"]) {
    const entry = byStatus.get(status);
    if (!entry) {
      continue;
    }
    let part = translate(
      `sidebar.selection-transformation.harmonize.status.${status}`,
      entry.total
    );
    if (entry.reasons.size) {
      const reasons = [...entry.reasons]
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) =>
          entry.reasons.size === 1 && count === entry.total
            ? translate(`sidebar.selection-transformation.harmonize.reason.${reason}`)
            : `${count} ${translate(
                `sidebar.selection-transformation.harmonize.reason.${reason}`
              )}`
        );
      part += ` (${reasons.join(", ")})`;
    }
    parts.push(part);
  }
  return parts.join(" · ");
}

// Hover detail: the bias that actually ran, plus one line per candidate point.
// The summary says what happened; this says which point and why.
function detailHarmonizeReport(reports, options) {
  // The head line names what was asked for. It used to name four tick boxes
  // that no longer exist, so it read "move the on-curve: off" whatever the
  // slider said.
  const position = options.useG3 ? 2 : Math.round(Number(options.method));
  const lines = [
    `${options.useG3 ? "G3" : "G2"}` +
      `, position ${options.useG3 ? "-" : position}: ` +
      translate(`sidebar.selection-transformation.harmonize.method.${position}`) +
      `, other sources: ${options.applyToOtherSources ? "on" : "off"}`,
  ];
  for (const [layerName, report] of reports) {
    lines.push(`${layerName}:`);
    for (const entry of report) {
      const reason = entry.reason ? ` / ${entry.reason}` : "";
      const sweeps = entry.iterations ? ` after ${entry.iterations}` : "";
      const reduced = entry.tensionReduced ? ", handle tension reduced" : "";
      // Which construction did the work. Named every time, because the command
      // chooses it: G3 falls back to G2 where it has no answer, and with
      // equalization on the handle-length solve is a candidate too. A report
      // that leaves it out is a report you have to guess at.
      const by = entry.construction ? ` by ${entry.construction}` : "";
      lines.push(
        `  point ${entry.pointIndex} (contour ${entry.contourIndex}): ` +
          `${entry.status}${by}${reason}${sweeps}${reduced}`
      );
    }
  }
  return lines.join("\n");
}

function formatHarmonizeReport(reports) {
  const rows = [...reports];
  if (!rows.length) {
    return translate("sidebar.selection-transformation.harmonize.nothing-to-do");
  }
  if (rows.length === 1) {
    return summarizeHarmonizeReport(rows[0][1]);
  }
  return rows
    .map(([layerName, report]) => `${layerName}: ${summarizeHarmonizeReport(report)}`)
    .join(" · ");
}

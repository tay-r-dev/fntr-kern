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
import { isScrubCancelled, scrubAmountSinceStart } from "@fontra/core/number-scrub.js";
import {
  filterPathByPointIndices,
  getSelectionByContour,
} from "@fontra/core/path-functions.js";
import { rectCenter, rectSize, unionRect } from "@fontra/core/rectangle.ts";
import { balancePathInPlace } from "@fontra/core/harmonization.js";
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
import "@fontra/web-components/input-scrub.js"; // for <ui-input-scrub>, the Scale row's linked pair
import "@fontra/web-components/icon-button.js"; // for <icon-button>, ticket 39's origin pick
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
  /* The label column is as wide as the widest label and no wider. */
  .ui-form {
    grid-template-columns: max-content minmax(0, 1fr);
    column-gap: 8px;
  }

  .ui-form-value.universal-row {
    gap: 8px;
  }

  .ui-form-label {
    overflow-x: unset;
    display: grid;
    align-items: center;
    justify-content: start;
    height: 1.6em;
  }

  /* Every packed row: the row's icon in the label column, then its fields
     splitting the value column evenly. */
  .ui-form-value.universal-row > compact-scrub-field,
  .ui-form-value.universal-row > ui-input-scrub {
    flex: 1 1 0;
    min-width: 0;
  }

  .row-icon {
    width: 16px;
    height: 16px;
    padding: 2px;
  }

  /* The Origin row: the grid, the typed X and Y, then pick and clear. */
  .origin-row {
    display: flex;
    flex: 1 1 0;
    min-width: 0;
    align-items: center;
    gap: 4px;
  }

  .origin-row > compact-scrub-field {
    flex: 1 1 0;
    min-width: 0;
  }

  .origin-buttons {
    display: flex;
    gap: 6px;
    padding-left: 2px;
    opacity: 0.3;
  }

  .origin-buttons:hover,
  .origin-buttons:has(icon-button[on]) {
    opacity: 1;
  }

  .origin-buttons icon-button {
    width: 16px;
    height: 16px;
  }

  /* A 24px square: 3 x 6px dots and two 3px gaps. */
  .origin-radio-buttons {
    display: grid;
    grid-template-columns: repeat(3, 6px);
    grid-auto-rows: 6px;
    gap: 3px;
    padding: 1.5px;
    flex: 0 0 auto;
  }

  .origin-radio-buttons > input[type="radio"] {
    appearance: none;
    box-sizing: border-box;
    background-color: var(--editor-mini-console-background-color-light);
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .origin-radio-buttons > input[type="radio"]:hover,
  .origin-radio-buttons > input[type="radio"]:checked {
    background-color: var(--text-input-background-color-dark);
  }

  .harmonize-report {
    font-size: 0.9em;
    opacity: 0.7;
  }

  /* Operations, Path, Harmonize: a small label over segmented rows, two
     groups side by side. The tray itself is shared
     (selection-row-group-styles.js). */
  ${SELECTION_ROW_GROUP_STYLES}

  .transform-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 12px;
  }

  .transform-group-label {
    font-size: 9px;
    line-height: 10px;
    letter-spacing: -0.03em;
    color: #8e8e8e;
  }

  .transform-pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
  }

  .transform-pair > .transform-group {
    padding-bottom: 0;
  }

  .transform-pair .tray {
    justify-self: stretch;
  }
`;

  constructor(editorController, contentElement) {
    this.editorController = editorController;
    this.infoForm = new Form();
    this.infoForm.appendStyle(TransformationPanel.stylesForm);
    // The Selection panel owns the one scroll area; this part only adds its form.
    contentElement.appendChild(html.div({}, [this.infoForm]));
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
      scaleY: 100,
      // A closed chain scales Y by X. The link stays through selection changes.
      scaleLinked: true,
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
    scaleY: { neutral: 100, field: "scaleYField" },
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
  // transform from the pre-drag state and the change from the drag's start
  // value to its current one, never a frame-to-frame delta). The arrow keys
  // in the typed value stream the same way. A typed value still applies once
  // on Enter (the "apply" event), through the plain one-shot
  // transformSelection via onApply. 0.1 is the rounding grid, not just the raw drag value, so a
  // drag lands on a clean number instead of a long, jittery decimal
  // (roundScrubValue's own step handling).
  // A row's name is its icon, in the label column. A row with options holds
  // them in the icon's dropdown; a click opens it, as the icon does nothing
  // else.
  _rowIcon(src, tooltip, dropdown) {
    const icon = html.createDomElement("icon-button", {
      "class": "row-icon",
      "src": src,
      "data-tooltip": tooltip,
      "data-tooltipposition": "left",
    });
    if (dropdown) {
      icon.dropdown = dropdown;
    }
    return { auxiliaryElement: icon };
  }

  _buildScrubXYRow({
    icon,
    tooltip,
    labels = ["X", "Y"],
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
      label: labels[0],
      value: valueX,
      step,
    });
    const fieldY = html.createDomElement("compact-scrub-field", {
      label: labels[1],
      value: valueY,
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
    // The shape already carries the value a live change starts from, so each
    // frame's transformation is told that start and applies only the change
    // since it.
    fieldX.addEventListener("scrubstart", (event) =>
      this.transformSelectionStream(
        event.detail.valueStream,
        (x) => makeTransformationForX(x, event.detail.startValue),
        undoLabel
      )
    );
    fieldY.addEventListener("scrubstart", (event) =>
      this.transformSelectionStream(
        event.detail.valueStream,
        (y) => makeTransformationForY(y, event.detail.startValue),
        undoLabel
      )
    );
    return {
      fieldX,
      fieldY,
      row: {
        type: "universal-row",
        field1: this._rowIcon(icon, tooltip),
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
      level: "h2",
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

    // Ticket 39: a button beside the grid enters pick mode. The next canvas
    // click types that point into X and Y; Escape leaves without a change.
    const pickButton = html.createDomElement("icon-button", {
      "src": "/tabler-icons/focus-2.svg",
      "data-tooltip": translate("sidebar.selection-transformation.origin.pick"),
      "data-tooltipposition": "bottom",
    });
    pickButton.on = !!this._originPick;
    pickButton.onclick = () =>
      this._originPick ? this._stopOriginPick() : this._startOriginPick();
    this.originPickButton = pickButton;
    // The cross drops a picked or typed origin, back to the grid's centre.
    const clearButton = html.createDomElement("icon-button", {
      "src": "/tabler-icons/x.svg",
      "data-tooltip": translate("sidebar.selection-transformation.origin.clear"),
      "data-tooltipposition": "bottom",
    });
    clearButton.onclick = () => this._clearOrigin();

    // The typed origin: two plain fields, no scrub. A typed value is the pin,
    // and no grid position is checked then.
    const originField = (label, key) => {
      const field = html.createDomElement("compact-scrub-field", {
        label,
        value: this.transformParameters[`${key}Button`],
      });
      field.scrubIcon = false;
      field.addEventListener("change", (event) => {
        this.transformParameters[key] = event.detail.value;
        this.transformParameters[`${key}Button`] = event.detail.value;
        this._checkOriginRadio(null);
      });
      return field;
    };
    this.originXField = originField("X", "originX");
    this.originYField = originField("Y", "originY");

    // One row: the origin icon, the grid, the typed X and Y, pick and clear.
    formContents.push({
      type: "universal-row",
      field1: this._rowIcon(
        "/tabler-icons/circle-dot.svg",
        translate("sidebar.selection-transformation.origin")
      ),
      field2: { type: "auxiliaryElement", auxiliaryElement: radioButtonOrigin },
      field3: {
        type: "auxiliaryElement",
        auxiliaryElement: html.div({ class: "origin-row" }, [
          this.originXField,
          this.originYField,
          html.div({ class: "origin-buttons" }, [pickButton, clearButton]),
        ]),
      },
    });

    const {
      row: moveRow,
      fieldX: moveXField,
      fieldY: moveYField,
    } = this._buildScrubXYRow({
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
      makeTransformationForX: (x, startX) => () =>
        new Transform().translate(scrubAmountSinceStart(x, startX, "offset"), 0),
      makeTransformationForY: (y, startY) => () =>
        new Transform().translate(0, scrubAmountSinceStart(y, startY, "offset")),
      undoLabel: "move",
    });
    this.moveXField = moveXField;
    this.moveYField = moveYField;
    formContents.push(moveRow);

    const scaleYFor = (x) =>
      this.transformParameters.scaleLinked ? x : this.transformParameters.scaleY;
    // The Scale row is the linked-pair composite: X, the link button, Y in one
    // element. Linked, Y follows X and is greyed -- the composite's own link
    // "on" semantics, mirroring and disabling the right field itself. The
    // fields are the composite's inner compact-scrub-fields, so the reset and
    // undo-restore write them through RELATIVE_TRANSFORM_FIELDS as before.
    const scaleInput = html.createDomElement("ui-input-scrub");
    scaleInput.leftLabel = "X";
    scaleInput.rightLabel = "Y";
    scaleInput.step = 0.1;
    scaleInput.leftValue = this.transformParameters.scaleX;
    scaleInput.rightValue = this.transformParameters.scaleY;
    scaleInput.link = this.transformParameters.scaleLinked ? "on" : "off";
    scaleInput.linkTooltip = translate("sidebar.skeleton-parameters.linked");
    this.scaleXField = scaleInput.leftField;
    this.scaleYField = scaleInput.rightField;
    // The value stays exactly where the drag or the typed edit left it, like
    // the other rows. When linked the composite already mirrors Y's field;
    // here the model follows.
    scaleInput.addEventListener("change", (event) => {
      const { value, side } = event.detail;
      if (side === "left") {
        this.transformParameters.scaleX = value;
        if (this.transformParameters.scaleLinked) {
          this.transformParameters.scaleY = value;
        }
      } else {
        this.transformParameters.scaleY = value;
      }
    });
    scaleInput.addEventListener("apply", () =>
      this.transformSelection(
        () =>
          new Transform().scale(
            this.transformParameters.scaleX / 100,
            scaleYFor(this.transformParameters.scaleX) / 100
          ),
        "scale"
      )
    );
    // The composite forwards the inner field's own scrubstart stream, so one
    // drag is still one undo step; `side` picks the axis. Linked, Y follows
    // X, so both axes take X's ratio.
    scaleInput.addEventListener("scrubstart", (event) => {
      const { valueStream, startValue, side } = event.detail;
      this.transformSelectionStream(
        valueStream,
        side === "left"
          ? (x) => () => {
              const ratio = scrubAmountSinceStart(x, startValue, "ratio");
              return new Transform().scale(
                ratio,
                this.transformParameters.scaleLinked ? ratio : 1
              );
            }
          : (y) => () =>
              new Transform().scale(1, scrubAmountSinceStart(y, startValue, "ratio")),
        "scale"
      );
    });
    scaleInput.addEventListener("link-changed", (event) => {
      const linked = event.detail.linked;
      this.transformParameters.scaleLinked = linked;
      if (linked) {
        // The composite has already mirrored Y's field to X's value.
        this.transformParameters.scaleY = this.transformParameters.scaleX;
      }
    });
    // Ticket 41: Smart scale, the tension-aware scale held on X, keeps its two
    // app-wide settings in the Scale icon's dropdown. Preserve aspect ratio
    // lets tension points slide along their straights; off, the scale only
    // adjusts handles. Slide adjacent tension points lets both ends of a
    // straight lying across the scaled axis travel; off, both stand still. It
    // means nothing while the slide is off, so it is greyed then.
    const settingCheck = (key, labelKey, onChange) => {
      const check = html.input({ type: "checkbox" });
      check.addEventListener("change", () => onChange(check.checked));
      this.scaleChecks[key] = check;
      return html.label({ style: "display: flex; gap: 0.5em; align-items: center;" }, [
        check,
        translate(`sidebar.selection-transformation.${labelKey}`),
      ]);
    };
    this.scaleChecks = {};
    const smartScaleCard = html.div(
      {
        style: "display: flex; flex-direction: column; align-items: start; gap: 0.6em;",
      },
      [
        settingCheck("preserve", "preserve-aspect-ratio", (checked) => {
          applicationSettingsController.model.preserveAspectRatio = checked;
          this._refreshScaleOverflow();
        }),
        settingCheck("slide", "slide-both-tension-points", (checked) => {
          applicationSettingsController.model.slideBothTensionPoints = checked;
        }),
      ]
    );
    this._refreshScaleOverflow();
    const scaleRow = {
      type: "universal-row",
      field1: this._rowIcon(
        "/tabler-icons/resize.svg",
        translate("sidebar.selection-transformation.smart-scale"),
        smartScaleCard
      ),
      field2: { type: "auxiliaryElement", auxiliaryElement: scaleInput },
      field3: {},
    };

    const rotateField = html.createDomElement("compact-scrub-field", {
      label: "Angle",
      value: this.transformParameters.rotation,
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
        (rotation) => () =>
          new Transform().rotate(
            (scrubAmountSinceStart(rotation, event.detail.startValue, "offset") *
              Math.PI) /
              180
          ),
        "rotate"
      )
    );
    this.rotateField = rotateField;
    formContents.push({
      type: "universal-row",
      field1: this._rowIcon(
        "/tabler-icons/rotate.svg",
        translate("sidebar.selection-transformation.rotate")
      ),
      field2: { type: "auxiliaryElement", auxiliaryElement: rotateField },
      field3: {},
    });

    const {
      row: skewRow,
      fieldX: skewXField,
      fieldY: skewYField,
    } = this._buildScrubXYRow({
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
      makeTransformationForX: (x, startX) => () =>
        new Transform().skew(
          (scrubAmountSinceStart(x, startX, "slant") * Math.PI) / 180,
          0
        ),
      makeTransformationForY: (y, startY) => () =>
        new Transform().skew(
          0,
          (scrubAmountSinceStart(y, startY, "slant") * Math.PI) / 180
        ),
      undoLabel: "skew",
    });
    this.skewXField = skewXField;
    this.skewYField = skewYField;
    formContents.push(skewRow);
    formContents.push(scaleRow);

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
      icon: "/tabler-icons/dimensions.svg",
      tooltip: translate("sidebar.selection-info.dimensions"),
      labels: ["W", "H"],
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

    // Operations, Path and Harmonize: each group is one segmented button row
    // (the shared tray), two groups side by side. Choices a row has no room
    // for hang off a segment as a dropdown, opened by a long press.
    const segment = (src, tooltipKey, onclick, dropdown) => {
      const button = html.createDomElement("icon-button", {
        "src": src,
        "data-tooltip": translate(tooltipKey),
        "data-tooltipposition": "top",
      });
      if (onclick) {
        button.onclick = onclick;
      }
      if (dropdown) {
        button.dropdown = dropdown;
      }
      return button;
    };
    const tray = (buttons) =>
      html.div({ class: "selection-row-group-icons tray" }, buttons);
    const groupLabel = (key) =>
      html.span({ class: "transform-group-label" }, [translate(key)]);
    const pairRow = (left, right) =>
      html.div({ class: "transform-pair" }, [left, right]);
    const labeledGroup = (key, element) =>
      html.div({ class: "transform-group" }, [groupLabel(key), element]);

    // The distribution spacing lives in each distribute button's dropdown;
    // both write the one parameter.
    const spacingCard = () =>
      html.input({
        type: "number",
        value:
          this.transformParameters.customDistributionSpacing == null
            ? ""
            : String(this.transformParameters.customDistributionSpacing),
        placeholder: translate(
          "sidebar.selection-transformation.distribute.distance-in-units"
        ),
        oninput: (event) => {
          const raw = event.target.value;
          this.transformParameters.customDistributionSpacing =
            raw === "" ? null : Number(raw);
        },
      });

    const K = "sidebar.selection-transformation";
    const operations = html.div({ class: "transform-group" }, [
      groupLabel(`${K}.operations`),
      pairRow(
        tray([
          segment("/tabler-icons/flip-vertical.svg", `${K}.flip.vertically`, () =>
            this.transformSelection(
              () => new Transform().scale(-1, 1),
              "flip vertically"
            )
          ),
          segment("/tabler-icons/flip-horizontal.svg", `${K}.flip.horizontally`, () =>
            this.transformSelection(
              () => new Transform().scale(1, -1),
              "flip horizontally"
            )
          ),
        ]),
        tray([
          segment(
            "/tabler-icons/layout-distribute-vertical.svg",
            `${K}.distribute.horizontally`,
            () => this.moveObjects(distributeHorizontally),
            spacingCard()
          ),
          segment(
            "/tabler-icons/layout-distribute-horizontal.svg",
            `${K}.distribute.vertically`,
            () => this.moveObjects(distributeVertically),
            spacingCard()
          ),
        ])
      ),
      pairRow(
        tray([
          segment("/tabler-icons/vertical-align-left.svg", `${K}.align.left`, () =>
            this.moveObjects(alignLeft)
          ),
          segment("/tabler-icons/vertical-align-center.svg", `${K}.align.center`, () =>
            this.moveObjects(alignCenter)
          ),
          segment("/tabler-icons/vertical-align-right.svg", `${K}.align.right`, () =>
            this.moveObjects(alignRight)
          ),
        ]),
        tray([
          segment("/tabler-icons/horizontal-align-top.svg", `${K}.align.top`, () =>
            this.moveObjects(alignTop)
          ),
          segment(
            "/tabler-icons/horizontal-align-center.svg",
            `${K}.align.middle`,
            () => this.moveObjects(alignMiddle)
          ),
          segment(
            "/tabler-icons/horizontal-align-bottom.svg",
            `${K}.align.bottom`,
            () => this.moveObjects(alignBottom)
          ),
        ])
      ),
    ]);
    formContents.push({ type: "single-icon", element: operations });

    // Path: remove overlaps, with the other three boolean operations in its
    // dropdown; simplify; balance.
    const P = `${K}.path-operations`;
    const booleanCard = tray([
      segment("/tabler-icons/layers-subtract.svg", `${P}.subtract`, () =>
        this.doPathOperations(this.pathOperations.subtractPath, "subtract")
      ),
      segment("/tabler-icons/layers-intersect-2.svg", `${P}.intersect`, () =>
        this.doPathOperations(this.pathOperations.intersectPath, "intersect")
      ),
      segment("/tabler-icons/layers-difference.svg", `${P}.exclude`, () =>
        this.doPathOperations(this.pathOperations.excludePath, "exclude")
      ),
    ]);
    const pathGroup = tray([
      segment(
        "/tabler-icons/layers-union.svg",
        `${P}.union.more`,
        () => this.doPathOperations(this.pathOperations.unionPath, "union"),
        booleanCard
      ),
      segment("/tabler-icons/shape.svg", "action.simplify-contour", () => {
        this.sceneController.updateContextMenuState(null);
        this.sceneController.doSimplifySelectedContours();
      }),
      segment("/tabler-icons/arrows-horizontal.svg", `${K}.harmonize.balance`, () =>
        this.doBalance()
      ),
    ]);

    // Harmonize: one segment per continuity. G2's options hang off it; G3 has
    // one construction and reads none of the G2 ticks.
    const settings = applicationSettingsController.model;
    this.harmonizeChecks = {};
    const optionCheck = (key, labelKey) => {
      const check = html.input({ type: "checkbox" });
      check.checked = !!settings[key];
      check.addEventListener("change", () => (settings[key] = check.checked));
      this.harmonizeChecks[key] = check;
      return html.label({ style: "display: flex; gap: 0.5em; align-items: center;" }, [
        check,
        translate(`${K}.harmonize.${labelKey}`),
      ]);
    };
    const harmonizeOptions = html.div(
      {
        style: "display: flex; flex-direction: column; align-items: start; gap: 0.6em;",
      },
      [
        optionCheck("harmonizePreserveCurvature", "preserve-curvature"),
        optionCheck("harmonizeMoveOnCurve", "move-on-curve"),
        optionCheck("harmonizeEqualize", "equalize"),
        optionCheck("harmonizeOtherSources", "other-sources"),
      ]
    );
    const g3Button = segment(undefined, `${K}.harmonize.g3`, () =>
      this.doHarmonize(true)
    );
    g3Button.label = "G3";
    const g2Button = segment(
      undefined,
      `${K}.harmonize.g2`,
      () => this.doHarmonize(false),
      harmonizeOptions
    );
    g2Button.label = "G2";

    formContents.push({
      type: "single-icon",
      element: pairRow(
        labeledGroup(`${K}.path`, pathGroup),
        labeledGroup(`${K}.harmonize`, tray([g3Button, g2Button]))
      ),
    });

    formContents.push({
      type: "single-icon",
      element: (this.harmonizeReportElement = html.span(
        { class: "harmonize-report", title: this.harmonizeReportDetail || "" },
        [this.harmonizeReportText || ""]
      )),
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
    };

    this.updateDimensions();
  }

  // The pressed segment names the continuity. It is also stored, so the
  // Harmonize shortcut repeats whichever was pressed last.
  async doHarmonize(useG3) {
    const settings = applicationSettingsController.model;
    settings.harmonizeG3 = useG3;
    const options = {
      useG3,
      // The dropdown writes a tick to the setting the moment it is made, so
      // the stored ticks are the ones the card shows.
      preserveCurvature: !!settings.harmonizePreserveCurvature,
      moveOnCurve: !!settings.harmonizeMoveOnCurve,
      equalizeHandles: !!settings.harmonizeEqualize,
      applyToOtherSources: settings.harmonizeOtherSources,
    };
    const reports = await this.sceneController.doHarmonize(options);
    this.setHarmonizeReport(
      formatHarmonizeReport(reports),
      detailHarmonizeReport(reports, options)
    );
  }

  // Balance the handles of the curves at the selected on-curves: one shared
  // tension per curve, holding its fullness. Ordinary paths only.
  async doBalance() {
    const pointSelection = parseSelection(this.sceneController.selection).point;
    if (!pointSelection?.length) {
      return;
    }
    await this.sceneController.editLayersAndRecordChanges((layerGlyphs) => {
      for (const layerGlyph of Object.values(layerGlyphs)) {
        // A generated contour is rebuilt from its skeleton, never edited.
        const indices = pointSelection.filter(
          (pointIndex) =>
            !this.sceneController.sceneModel.isGeneratedPathContour(
              layerGlyph.path.getContourIndex(pointIndex)
            )
        );
        if (indices.length) {
          balancePathInPlace(layerGlyph.path, indices);
        }
      }
      return translate("sidebar.selection-transformation.harmonize.balance");
    });
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

  _refreshScaleOverflow() {
    const settings = applicationSettingsController.model;
    const preserve = settings.preserveAspectRatio !== false;
    this.scaleChecks.preserve.checked = preserve;
    this.scaleChecks.slide.checked = !!settings.slideBothTensionPoints;
    this.scaleChecks.slide.disabled = !preserve;
  }

  _changeOrigin(keyX, keyY) {
    this._stopOriginPick();
    this.transformParameters.originX = keyX;
    this.transformParameters.originY = keyY;
    this.transformParameters.originXButton = undefined;
    this.transformParameters.originYButton = undefined;
    if (this.originXField) {
      this.originXField.value = null;
      this.originYField.value = null;
    }
  }

  _clearOrigin() {
    this._changeOrigin("center", "middle");
    this._checkOriginRadio("center-middle");
  }

  // Checks the grid position `key` ("center-middle"), or none for null.
  _checkOriginRadio(key) {
    for (const radioButton of this.infoForm.shadowRoot.querySelectorAll(
      ".ui-form-radio-button"
    )) {
      radioButton.checked = radioButton.value === key;
    }
  }

  // Ticket 39: pick mode. The canvas listeners run in the capture phase, so the
  // pick click reaches no tool: it neither selects nor drags.
  _startOriginPick() {
    const canvas = this.editorController.canvasController?.canvas;
    if (!canvas || this._originPick) {
      return;
    }
    const onPointerDown = (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = this.sceneController.selectedGlyphPoint(event);
      // The pointerup belongs to the pick too.
      canvas.addEventListener("pointerup", swallow, { capture: true, once: true });
      this._stopOriginPick();
      if (point) {
        this._setTypedOrigin(point.x, point.y);
      }
    };
    const swallow = (event) => event.stopImmediatePropagation();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this._stopOriginPick();
      }
    };
    canvas.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("keydown", onKeyDown, { capture: true });
    const previousCursor = canvas.style.cursor;
    canvas.style.cursor = "crosshair";
    this._originPick = () => {
      canvas.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      canvas.style.cursor = previousCursor;
    };
    if (this.originPickButton) {
      this.originPickButton.on = true;
    }
  }

  _stopOriginPick() {
    this._originPick?.();
    this._originPick = null;
    if (this.originPickButton) {
      this.originPickButton.on = false;
    }
  }

  // The same state a typed X and Y set: the point is the pin, and no grid
  // position is checked.
  _setTypedOrigin(x, y) {
    x = Math.round(x);
    y = Math.round(y);
    this.transformParameters.originX = x;
    this.transformParameters.originY = y;
    this.transformParameters.originXButton = x;
    this.transformParameters.originYButton = y;
    if (this.originXField) {
      this.originXField.value = x;
      this.originYField.value = y;
    }
    this._checkOriginRadio(null);
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
  // The head line names what was asked for. Under G3 the two ticks are not
  // read, so it does not name them.
  const onOff = (value) => (value ? "on" : "off");
  const lines = [
    (options.useG3
      ? "G3"
      : `G2, preserve curvature: ${onOff(options.preserveCurvature)}` +
        `, move on-curve: ${onOff(options.moveOnCurve)}`) +
      `, other sources: ${onOff(options.applyToOtherSources)}`,
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

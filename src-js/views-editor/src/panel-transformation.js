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
import { Form } from "@fontra/web-components/ui-form.js";
import { EditBehaviorFactory } from "./edit-behavior.js";
import Panel from "./panel.js";
import {
  applyGeneratedContourRemap,
  computeGeneratedContourRemap,
  getSkeletonSelectionBounds,
  makeSkeletonPointTargetEntry,
} from "./skeleton-editing.js";

export default class TransformationPanel extends Panel {
  identifier = "selection-transformation";
  iconPath = "/tabler-icons/shape.svg";

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
`;

  constructor(editorController) {
    super(editorController);
    this.infoForm = new Form();
    this.infoForm.appendStyle(TransformationPanel.stylesForm);
    this.contentElement.appendChild(
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
      showLabelsDistance: true,
      showLabelsTension: true,
      showLabelsAngle: false,
    };

    // Initialize scene settings with default values
    this.sceneController.sceneSettingsController.setItem("showLabelsDistance", true);
    this.sceneController.sceneSettingsController.setItem("showLabelsTension", true);
    this.sceneController.sceneSettingsController.setItem("showLabelsAngle", true);
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
      }
    );
    this.sceneController.addCurrentGlyphChangeListener((event) => {
      this.updateDimensions();
    });
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

  getContentElement() {
    return html.div(
      {
        class: "panel",
      },
      []
    );
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

    const buttonMove = html.createDomElement("icon-button", {
      "src": "/tabler-icons/arrow-move-right.svg",
      "onclick": (event) =>
        this.transformSelection(
          () =>
            new Transform().translate(
              this.transformParameters.moveX,
              this.transformParameters.moveY
            ),
          "move"
        ),
      "class": "ui-form-icon ui-form-icon-button",
      "data-tooltip": translate("sidebar.selection-transformation.move"),
      "data-tooltipposition": "top",
    });

    formContents.push({
      type: "edit-number-x-y",
      label: buttonMove,
      fieldX: {
        key: "moveX",
        value: this.transformParameters.moveX,
      },
      fieldY: {
        key: "moveY",
        value: this.transformParameters.moveY,
      },
      onEnterKey: (event) => {
        buttonMove.click();
      },
    });

    const buttonScale = html.createDomElement("icon-button", {
      "src": "/tabler-icons/resize.svg",
      "onclick": (event) =>
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
      "class": "ui-form-icon ui-form-icon-button",
      "data-tooltip": translate("sidebar.selection-transformation.scale"),
      "data-tooltipposition": "top",
    });

    formContents.push({
      type: "edit-number-x-y",
      label: buttonScale,
      fieldX: {
        key: "scaleX",
        id: "selection-transformation-scaleX",
        value: this.transformParameters.scaleX,
      },
      fieldY: {
        key: "scaleY",
        id: "selection-transformation-scaleY",
        value: this.transformParameters.scaleY,
      },
      onEnterKey: (event) => {
        buttonScale.click();
      },
    });

    const buttonRotate = html.createDomElement("icon-button", {
      "src": "/tabler-icons/rotate.svg",
      "onclick": (event) =>
        this.transformSelection(
          () =>
            new Transform().rotate((this.transformParameters.rotation * Math.PI) / 180),
          "rotate"
        ),
      "class": "ui-form-icon ui-form-icon-button",
      "data-tooltip": translate("sidebar.selection-transformation.rotate"),
      "data-tooltipposition": "top",
    });

    formContents.push({
      type: "edit-number",
      key: "rotation",
      label: buttonRotate,
      value: this.transformParameters.rotation,
      onEnterKey: (event) => {
        buttonRotate.click();
      },
    });

    const buttonSkew = html.createDomElement("icon-button", {
      "src": "/images/skew.svg",
      "onclick": (event) =>
        this.transformSelection(
          () =>
            new Transform().skew(
              (this.transformParameters.skewX * Math.PI) / 180,
              (this.transformParameters.skewY * Math.PI) / 180
            ),
          "skew"
        ),
      "class": "ui-form-icon ui-form-icon-button",
      "data-tooltip": translate("sidebar.selection-transformation.skew"),
      "data-tooltipposition": "top",
    });

    formContents.push({
      type: "edit-number-x-y",
      key: '["selectionTransformationSkew"]',
      label: buttonSkew,
      fieldX: {
        key: "skewX",
        id: "selection-transformation-skewX",
        value: this.transformParameters.skewX,
      },
      fieldY: {
        key: "skewY",
        id: "selection-transformation-skewY",
        value: this.transformParameters.skewY,
      },
      onEnterKey: (event) => {
        buttonSkew.click();
      },
    });

    formContents.push({ type: "divider" });

    const buttonDimensions = html.createDomElement("icon-button", {
      "src": "/tabler-icons/dimensions.svg",
      "onclick": async (event) => {
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
      },
      "class": "ui-form-icon ui-form-icon-button",
      "data-tooltip": translate("sidebar.selection-info.dimensions"),
      "data-tooltipposition": "top",
    });

    formContents.push({
      type: "edit-number-x-y",
      key: '["selectionTransformationDimensions"]',
      label: buttonDimensions,
      fieldX: {
        key: "dimensionWidth",
        id: "selection-transformation-dimension-width",
        numDigits: 1,
        value: null,
      },
      fieldY: {
        key: "dimensionHeight",
        id: "selection-transformation-dimension-height",
        numDigits: 1,
        value: null,
      },
      onEnterKey: (event) => {
        buttonDimensions.click();
      },
    });

    formContents.push({ type: "divider" });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "text",
        key: "LabelFlip",
        value: translate("sidebar.selection-transformation.flip"),
      },
      field2: {
        type: "auxiliaryElement",
        key: "FlipVertically",
        auxiliaryElement: html.createDomElement("icon-button", {
          "class": "ui-form-icon",
          "src": "/tabler-icons/flip-vertical.svg",
          "data-tooltip": translate("sidebar.selection-transformation.flip.vertically"),
          "data-tooltipposition": "top",
          "onclick": (event) =>
            this.transformSelection(
              () => new Transform().scale(-1, 1),
              "flip vertically"
            ),
        }),
      },
      field3: {
        type: "auxiliaryElement",
        key: "FlipHorizontally",
        auxiliaryElement: html.createDomElement("icon-button", {
          "class": "ui-form-icon",
          "src": "/tabler-icons/flip-horizontal.svg",
          "data-tooltip": translate(
            "sidebar.selection-transformation.flip.horizontally"
          ),
          "data-tooltipposition": "top-right",
          "onclick": (event) =>
            this.transformSelection(
              () => new Transform().scale(1, -1),
              "flip horizontally"
            ),
        }),
      },
    });

    formContents.push({ type: "spacer" });
    formContents.push({
      type: "header",
      label: translate("sidebar.selection-transformation.align"),
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "AlignLeft",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/vertical-align-left.svg",
          "onclick": (event) => this.moveObjects(alignLeft),
          "class": "ui-form-icon ui-form-icon-button",
          "data-tooltip": translate("sidebar.selection-transformation.align.left"),
          "data-tooltipposition": "bottom-left",
        }),
      },
      field2: {
        type: "auxiliaryElement",
        key: "AlignCenter",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/vertical-align-center.svg",
          "onclick": (event) => this.moveObjects(alignCenter),
          "data-tooltip": translate("sidebar.selection-transformation.align.center"),
          "data-tooltipposition": "bottom",
          "class": "ui-form-icon",
        }),
      },
      field3: {
        type: "auxiliaryElement",
        key: "AlignRight",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/vertical-align-right.svg",
          "onclick": (event) => this.moveObjects(alignRight),
          "data-tooltip": translate("sidebar.selection-transformation.align.right"),
          "data-tooltipposition": "bottom-right",
          "class": "ui-form-icon",
        }),
      },
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "AlignTop",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/horizontal-align-top.svg",
          "onclick": (event) => this.moveObjects(alignTop),
          "class": "ui-form-icon ui-form-icon-button",
          "data-tooltip": translate("sidebar.selection-transformation.align.top"),
          "data-tooltipposition": "bottom-left",
        }),
      },
      field2: {
        type: "auxiliaryElement",
        key: "AlignMiddle",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/horizontal-align-center.svg",
          "onclick": (event) => this.moveObjects(alignMiddle),
          "data-tooltip": translate("sidebar.selection-transformation.align.middle"),
          "data-tooltipposition": "bottom",
          "class": "ui-form-icon",
        }),
      },
      field3: {
        type: "auxiliaryElement",
        key: "AlignMiddle",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/horizontal-align-bottom.svg",
          "onclick": (event) => this.moveObjects(alignBottom),
          "data-tooltip": translate("sidebar.selection-transformation.align.bottom"),
          "data-tooltipposition": "bottom-right",
          "class": "ui-form-icon",
        }),
      },
    });

    formContents.push({ type: "spacer" });
    formContents.push({
      type: "header",
      label: translate("sidebar.selection-transformation.distribute"),
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "distributeHorizontally",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/layout-distribute-vertical.svg",
          "onclick": (event) => this.moveObjects(distributeHorizontally),
          "data-tooltip": translate(
            "sidebar.selection-transformation.distribute.horizontally"
          ),
          "data-tooltipposition": "top-left",
          "class": "ui-form-icon ui-form-icon-button",
        }),
      },
      field2: {
        type: "auxiliaryElement",
        key: "distributeVertically",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/layout-distribute-horizontal.svg",
          "onclick": (event) => this.moveObjects(distributeVertically),
          "data-tooltip": translate(
            "sidebar.selection-transformation.distribute.vertically"
          ),
          "data-tooltipposition": "top",
          "class": "ui-form-icon",
        }),
      },
      field3: {
        "type": "edit-number",
        "key": "customDistributionSpacing",
        "value": this.transformParameters.customDistributionSpacing,
        "allowEmptyField": true,
        "data-tooltip": translate(
          "sidebar.selection-transformation.distribute.distance-in-units"
        ),
        "data-tooltipposition": "top-right",
      },
    });

    formContents.push({ type: "spacer" });

    const labelKeyPathOperations = "sidebar.selection-transformation.path-operations";

    formContents.push({
      type: "header",
      label: translate(labelKeyPathOperations),
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "removeOverlaps",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/layers-union.svg",
          "onclick": (event) =>
            this.doPathOperations(this.pathOperations.unionPath, "union"),
          "data-tooltip": translate(`${labelKeyPathOperations}.union`),
          "data-tooltipposition": "top-left",
          "class": "ui-form-icon ui-form-icon-button",
        }),
      },
      field2: {
        type: "auxiliaryElement",
        key: "subtractContours",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/layers-subtract.svg",
          "onclick": (event) =>
            this.doPathOperations(this.pathOperations.subtractPath, "subtract"),
          "data-tooltip": translate(`${labelKeyPathOperations}.subtract`),
          "data-tooltipposition": "top",
          "class": "ui-form-icon",
        }),
      },
      field3: {
        type: "auxiliaryElement",
        key: "intersectContours",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/layers-intersect-2.svg",
          "onclick": (event) =>
            this.doPathOperations(this.pathOperations.intersectPath, "intersect"),
          "data-tooltip": translate(`${labelKeyPathOperations}.intersect`),
          "data-tooltipposition": "top-right",
          "class": "ui-form-icon",
        }),
      },
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "excludeContours",
        auxiliaryElement: html.createDomElement("icon-button", {
          "src": "/tabler-icons/layers-difference.svg",
          "onclick": (event) =>
            this.doPathOperations(this.pathOperations.excludePath, "exclude"),
          "data-tooltip": translate(`${labelKeyPathOperations}.exclude`),
          "data-tooltipposition": "top-left",
          "class": "ui-form-icon ui-form-icon-button",
        }),
      },
      field2: {},
      field3: {},
    });

    // Add Point labels control section
    formContents.push({ type: "divider" });
    formContents.push({
      type: "header",
      label: "Point labels",
    });

    // Create checkbox elements for Point labels
    const distanceCheckbox = html.input({
      type: "checkbox",
      checked: this.transformParameters.showLabelsDistance ?? true,
    });

    const tensionCheckbox = html.input({
      type: "checkbox",
      checked: this.transformParameters.showLabelsTension ?? true,
    });

    const angleCheckbox = html.input({
      type: "checkbox",
      checked: this.transformParameters.showLabelsAngle ?? true,
    });

    // Add three individual checkboxes for distance, tension, and angle using universal-row
    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "showLabelsDistance",
        auxiliaryElement: distanceCheckbox,
      },
      field2: {
        type: "text",
        key: "labelDistance",
        value: "Distance",
      },
      field3: {},
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "showLabelsTension",
        auxiliaryElement: tensionCheckbox,
      },
      field2: {
        type: "text",
        key: "labelTension",
        value: "Tension",
      },
      field3: {},
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "showLabelsAngle",
        auxiliaryElement: angleCheckbox,
      },
      field2: {
        type: "text",
        key: "labelAngle",
        value: "Angle",
      },
      field3: {},
    });

    // Harmonize section.
    //
    // Deliberately last: the Point-labels listeners below are bound by
    // querySelectorAll position, so any checkbox added ahead of them would
    // rebind Distance/Tension/Angle to the wrong controls. Those toggles are
    // slated for deprecation, so this section works around the issue instead of
    // fixing it. The fix, if they outlive the deprecation: bind those listeners
    // by id rather than by position.
    formContents.push({ type: "divider" });
    formContents.push({
      type: "header",
      label: translate("sidebar.selection-transformation.harmonize"),
    });

    formContents.push({
      type: "checkbox",
      key: "harmonizeG3",
      label: translate("sidebar.selection-transformation.harmonize.g3"),
      value: applicationSettingsController.model.harmonizeG3,
    });

    formContents.push({
      type: "checkbox",
      key: "harmonizeMoveOnCurve",
      label: translate("sidebar.selection-transformation.harmonize.move-on-curve"),
      value: applicationSettingsController.model.harmonizeMoveOnCurve,
    });

    formContents.push({
      type: "checkbox",
      key: "harmonizeEqualizeTension",
      label: translate("sidebar.selection-transformation.harmonize.equalize-tension"),
      value: applicationSettingsController.model.harmonizeEqualizeTension,
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
        auxiliaryElement: html.button({ onclick: () => this.doHarmonize() }, [
          translate("sidebar.selection-transformation.harmonize.apply"),
        ]),
      },
      field3: {},
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

      // Handle Tunni visibility parameters
      if (
        ["showLabelsDistance", "showLabelsTension", "showLabelsAngle"].includes(
          fieldItem.key
        )
      ) {
        // Update the scene settings
        this.sceneController.sceneSettingsController.setItem(fieldItem.key, value);
      }

      if (
        [
          "harmonizeG3",
          "harmonizeMoveOnCurve",
          "harmonizeOtherSources",
          "harmonizeEqualizeTension",
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

    // Add event listeners to the checkboxes to update the form values properly
    setTimeout(() => {
      // Use querySelector to find the checkboxes by their position in the form
      const allCheckboxes = this.infoForm.contentElement.querySelectorAll(
        'input[type="checkbox"]'
      );

      // Find the specific Tunni checkboxes by looking at the form structure
      // The checkboxes are added in sequence: Distance, Tension, Angle
      if (allCheckboxes.length >= 3) {
        const distanceCheckbox = allCheckboxes[0];
        const tensionCheckbox = allCheckboxes[1];
        const angleCheckbox = allCheckboxes[2];

        // Set initial checked states
        distanceCheckbox.checked = this.transformParameters.showLabelsDistance ?? true;
        tensionCheckbox.checked = this.transformParameters.showLabelsTension ?? true;
        angleCheckbox.checked = this.transformParameters.showLabelsAngle ?? true;

        // Add event listeners to each checkbox
        distanceCheckbox.addEventListener("change", (event) => {
          this.transformParameters.showLabelsDistance = event.target.checked;
          this.sceneController.sceneSettingsController.setItem(
            "showLabelsDistance",
            event.target.checked
          );
          // Force a redraw of the visualization
          this.sceneController.canvasController.requestUpdate();
        });

        tensionCheckbox.addEventListener("change", (event) => {
          this.transformParameters.showLabelsTension = event.target.checked;
          this.sceneController.sceneSettingsController.setItem(
            "showLabelsTension",
            event.target.checked
          );
          // Force a redraw of the visualization
          this.sceneController.canvasController.requestUpdate();
        });

        angleCheckbox.addEventListener("change", (event) => {
          this.transformParameters.showLabelsAngle = event.target.checked;
          this.sceneController.sceneSettingsController.setItem(
            "showLabelsAngle",
            event.target.checked
          );
          // Force a redraw of the visualization
          this.sceneController.canvasController.requestUpdate();
        });
      }
    }, 0);

    this.updateDimensions();
  }

  async doHarmonize() {
    const settings = applicationSettingsController.model;
    const options = {
      useG3: !!settings.harmonizeG3,
      moveOnCurve: !!settings.harmonizeMoveOnCurve,
      applyToOtherSources: settings.harmonizeOtherSources,
      equalizeTension: settings.harmonizeEqualizeTension,
    };
    const reports = await this.sceneController.doHarmonize(options);
    this.setHarmonizeReport(
      formatHarmonizeReport(reports),
      detailHarmonizeReport(reports, options)
    );
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

    const { width, height } = bounds ? rectSize(bounds) : { width: null, height: null };
    this.infoForm.setValue("dimensionWidth", width);
    this.infoForm.setValue("dimensionHeight", height);
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
      return;
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
      };
    });
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
  const lines = [
    `${options.useG3 ? "G3" : "G2"}` +
      `, move the on-curve: ${options.moveOnCurve ? "on" : "off"}` +
      `, equalize tension: ${options.equalizeTension ? "on" : "off"}` +
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

customElements.define("panel-transformation", TransformationPanel);

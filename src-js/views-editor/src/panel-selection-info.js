import { applicationSettingsController } from "@fontra/core/application-settings.js";
import { recordChanges } from "@fontra/core/change-recorder.js";
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import {
  deleteSidebearingKey,
  formatMetricsKeyDisplay,
  getEffectiveMetricsKey,
  getSidebearingKey,
  hasAnySidebearingKey,
  isMetricsValueStale,
  isSelfReferenceSameSide,
  parseMetricsKey,
  setSidebearingKey,
  SIDE_METRIC_PROPERTY,
} from "@fontra/core/metrics-keys.js";
import { isScrubCancelled } from "@fontra/core/number-scrub.js";
import { rectFromPoints, rectSize, unionRect } from "@fontra/core/rectangle.ts";
import { compute, nameCapture } from "@fontra/core/simple-compute.js";
import { getDecomposedIdentity } from "@fontra/core/transform.js";
import {
  assert,
  enumerate,
  getCharFromCodePoint,
  makeUPlusStringFromCodePoint,
  modulo,
  parseSelection,
  range,
  rgbaToHex,
  round,
  splitGlyphNameExtension,
  throttleCalls,
} from "@fontra/core/utils.ts";
import { showMenu } from "@fontra/web-components/menu-panel.js";
import { dialog } from "@fontra/web-components/modal-dialog.js";
import { Form } from "@fontra/web-components/ui-form.js";
import LetterspacerPanel from "./panel-letterspacer.js";
import SkeletonDefaultsPanel from "./panel-skeleton-defaults.js";
import Panel from "./panel.js";

export default class SelectionInfoPanel extends Panel {
  identifier = "selection-info";
  iconPath = "/images/info.svg";

  constructor(editorController) {
    super(editorController);
    this.throttledUpdate = throttleCalls((senderID) => this.update(senderID), 100);
    this.sceneController = this.editorController.sceneController;
    this._pendingMetricsKeyEdit = null;
    this._metricsUnlinkConfirm = null;
    this._metricsUnlinkConfirmGlyph = null;
    this.letterspacerPanel = new LetterspacerPanel(this.editorController);
    if (this.letterspacerHost) {
      this.letterspacerHost.appendChild(this.letterspacerPanel);
    }
    this.skeletonDefaultsPanel = new SkeletonDefaultsPanel(this.editorController);
    if (this.skeletonDefaultsHost) {
      this.skeletonDefaultsHost.appendChild(this.skeletonDefaultsPanel);
    }

    this.sceneController.sceneSettingsController.addKeyListener(
      [
        "selectedGlyphName",
        "selection",
        "fontLocationSourceMapped",
        "glyphLocation",
        "editLayerName",
        "combinedCharacterMap",
      ],
      (event) => this.throttledUpdate()
    );

    this.sceneController.sceneSettingsController.addKeyListener(
      "positionedLines",
      (event) => {
        if (!this.haveInstance) {
          this.update(event.senderInfo?.senderID);
        }
      }
    );

    this.sceneController.addCurrentGlyphChangeListener((event) => {
      this.throttledUpdate(event.senderID);
    });

    this.sceneController.addEventListener("glyphEditCannotEditReadOnly", async () => {
      this.update();
    });

    this.sceneController.addEventListener("glyphEditLocationNotAtSource", async () => {
      this.update();
    });

    applicationSettingsController.addKeyListener(
      ["alwaysShowGlobalAxesInComponentLocation", "sortComponentLocationGlyphAxes"],
      (event) => this.update()
    );
  }

  getContentElement() {
    this.infoForm = new Form();
    this.letterspacerHost = html.div({});
    this.skeletonDefaultsHost = html.div({});
    return html.div(
      {
        class: "panel",
      },
      [
        html.div(
          { class: "panel-section panel-section--flex panel-section--scrollable" },
          [this.infoForm]
        ),
        html.div(
          { class: "panel-section panel-section--checkbox" },
          this.getBehaviorElements()
        ),
      ]
    );
  }

  async toggle(on, focus) {
    if (on) {
      await this.update();
    }
    if (this.letterspacerPanel?.toggle) {
      await this.letterspacerPanel.toggle(on, focus);
    }
    if (this.skeletonDefaultsPanel?.toggle) {
      await this.skeletonDefaultsPanel.toggle(on, focus);
    }
  }

  getBehaviorElements() {
    const storageKey = "fontra.selection-info.absolute-value-changes";
    this.multiEditChangesAreAbsolute = localStorage.getItem(storageKey) === "true";
    return [
      html.input({
        type: "checkbox",
        id: "behavior-checkbox",
        checked: this.multiEditChangesAreAbsolute,
        onchange: (event) => {
          this.multiEditChangesAreAbsolute = event.target.checked;
          localStorage.setItem(storageKey, event.target.checked);
        },
      }),
      html.label(
        { for: "behavior-checkbox" },
        translate("sidebar.selection-info.multi-source")
      ),
    ];
  }

  async update(senderInfo) {
    if (
      senderInfo?.senderID === this &&
      ((senderInfo?.fieldKeyPath?.length !== 3 &&
        senderInfo?.fieldKeyPath?.[0] !== "component" &&
        senderInfo?.fieldKeyPath?.[2] !== "name") ||
        senderInfo?.fieldKeyPath?.[0] === "backgroundImage")
    ) {
      // Don't rebuild, just update the Dimensions field
      await this.updateDimensions();
      return;
    }
    if (!this.infoForm.contentElement.offsetParent) {
      // If the info form is not visible, do nothing
      return;
    }

    await this.fontController.ensureInitialized;

    const glyphName = this.sceneController.sceneSettings.selectedGlyphName;
    if (this._metricsUnlinkConfirmGlyph !== glyphName) {
      // Never leave a button armed across a glyph switch.
      this._metricsUnlinkConfirm = null;
      this._metricsUnlinkConfirmGlyph = glyphName;
    }
    const glyphController = await this.sceneController.sceneModel.getGlyphInstance(
      glyphName,
      this.sceneController.sceneSettings.editLayerName
    );
    let codePoints = this.fontController.glyphMap?.[glyphName] || [];

    const instance = glyphController?.instance;
    this.haveInstance = !!instance;

    const positionedGlyph =
      this.sceneController.sceneModel.getSelectedPositionedGlyph();
    const varGlyphController =
      await this.sceneController.sceneModel.getSelectedVariableGlyphController();
    const glyphLocked = !!varGlyphController?.glyph.customData["fontra.glyph.locked"];

    const metricsKeyDisplay = {
      left: await this._getMetricsKeyDisplay(
        varGlyphController,
        glyphController,
        "left"
      ),
      right: await this._getMetricsKeyDisplay(
        varGlyphController,
        glyphController,
        "right"
      ),
    };

    if (
      positionedGlyph?.isUndefined &&
      positionedGlyph.character &&
      !codePoints.length
    ) {
      // Glyph does not yet exist in the font, but we can grab the unicode from
      // positionedGlyph.character anyway
      codePoints = [positionedGlyph.character.codePointAt(0)];
    }

    const codePointsStr = makeCodePointsString(codePoints);
    let baseCodePointsStr;
    if (glyphName && !codePoints.length) {
      const [baseGlyphName, _] = splitGlyphNameExtension(glyphName);
      baseCodePointsStr = makeCodePointsString(
        this.fontController.glyphMap?.[baseGlyphName]
      );
    }

    const kerningController = await this.fontController.getKerningController("kern");

    const formContents = [];
    // Whether this rebuild puts the two hosted panels' elements back in the
    // form. They are in the DOM only while it does.
    let hostedPanelsInForm = false;
    if (glyphName) {
      formContents.push({
        type: "header",
        label: translate("sidebar.selection-info.title"),
        auxiliaryElement: html.createDomElement("icon-button", {
          "id": "glyphLocking",
          "style": `width: 1.3em; height: 1.3em;`,
          "src":
            glyphLocked || this.fontController.readOnly
              ? "/tabler-icons/lock.svg"
              : "/tabler-icons/lock-open-2.svg",
          "onclick": (event) => this._toggleGlyphLock(varGlyphController.glyph),
          "data-tooltip": translate(
            this.fontController.readOnly
              ? "sidebar.selection-info.glyph-locking.tooltip.read-only"
              : glyphLocked
                ? "sidebar.selection-info.glyph-locking.tooltip.unlock"
                : "sidebar.selection-info.glyph-locking.tooltip.lock"
          ),
          "data-tooltipposition": "left",
        }),
      });
      formContents.push({
        key: "glyphName",
        type: "text",
        label: translate("sidebar.selection-info.glyph-name"),
        value: glyphName,
      });
      formContents.push({
        key: "unicodes",
        type: "text",
        label: translate("sidebar.selection-info.unicode"),
        value: codePointsStr,
      });
      if (baseCodePointsStr) {
        formContents.push({
          key: "baseUnicodes",
          type: "text",
          label: translate("sidebar.selection-info.base-unicode"),
          value: baseCodePointsStr,
        });
      }
      if (instance) {
        formContents.push({
          type: "edit-number",
          key: '["xAdvance"]',
          label: translate("sidebar.selection-info.advance-width"),
          value: instance.xAdvance,
          numDigits: 1,
          evaluateExpression: async (expression) =>
            await this._evaluateMetricsExpression(
              expression,
              varGlyphController,
              "xAdvance"
            ),
          minValue: 0,
        });
        formContents.push({
          type: "edit-number-x-y",
          key: '["sidebearings"]',
          label: translate("sidebar.selection-info.sidebearings"),
          fieldX: {
            "key": '["leftMargin"]',
            "value": metricsKeyDisplay.left
              ? formatMetricsKeyDisplay(metricsKeyDisplay.left.expression)
              : glyphController.leftMargin,
            "displayValue": metricsKeyDisplay.left
              ? formatResolvedMetricsValue(metricsKeyDisplay.left)
              : undefined,
            "stale": !!metricsKeyDisplay.left?.stale,
            "data-tooltip": metricsKeyDisplay.left?.stale
              ? translate("sidebar.selection-info.metrics-key.stale.tooltip")
              : undefined,
            "numDigits": 1,
            "disabled": glyphController.leftMargin == undefined,
            "evaluateExpression": async (input) =>
              await this._evaluateSidebearingInput(input, varGlyphController, "left"),
            "recordExtraChanges": (glyph, layerInfo) =>
              this._recordPendingMetricsKey(glyph, layerInfo, "left"),
            "getValue": (layerGlyph, layerGlyphController, fieldItem) => {
              return layerGlyphController.leftMargin;
            },
            "setValue": (layerGlyph, layerGlyphController, fieldItem, value) => {
              setLeftMarginOnLayer(layerGlyph, layerGlyphController, value);
            },
          },
          fieldY: {
            "key": '["rightMargin"]',
            "value": metricsKeyDisplay.right
              ? formatMetricsKeyDisplay(metricsKeyDisplay.right.expression)
              : glyphController.rightMargin,
            "displayValue": metricsKeyDisplay.right
              ? formatResolvedMetricsValue(metricsKeyDisplay.right)
              : undefined,
            "stale": !!metricsKeyDisplay.right?.stale,
            "data-tooltip": metricsKeyDisplay.right?.stale
              ? translate("sidebar.selection-info.metrics-key.stale.tooltip")
              : undefined,
            "numDigits": 1,
            "evaluateExpression": async (input) =>
              await this._evaluateSidebearingInput(input, varGlyphController, "right"),
            "recordExtraChanges": (glyph, layerInfo) =>
              this._recordPendingMetricsKey(glyph, layerInfo, "right"),
            "disabled": glyphController.rightMargin == undefined,
            "getValue": (layerGlyph, layerGlyphController, fieldItem) => {
              return layerGlyphController.rightMargin;
            },
            "setValue": (layerGlyph, layerGlyphController, fieldItem, value) => {
              setRightMarginOnLayer(layerGlyph, layerGlyphController, value);
            },
          },
        });
        if (this._glyphHasMetricsKeys(varGlyphController)) {
          formContents.push({
            type: "single-icon",
            element: html.createDomElement("icon-button", {
              "src": "/tabler-icons/refresh.svg",
              "style": "width: 1.3em; height: 1.3em;",
              "disabled": glyphLocked || this.fontController.readOnly,
              "data-tooltip": translate(
                "sidebar.selection-info.metrics-key.update.tooltip"
              ),
              "data-tooltipposition": "left",
              "onclick": async () => {
                await this._updateMetricsForGlyph(glyphName, varGlyphController);
                await this.update();
              },
            }),
          });
        }
        for (const side of ["left", "right"]) {
          if (!metricsKeyDisplay[side]) {
            continue;
          }
          const isConfirming = this._metricsUnlinkConfirm === side;
          formContents.push({
            type: "single-icon",
            element: html.createDomElement("icon-button", {
              "src": isConfirming ? "/tabler-icons/x.svg" : "/tabler-icons/unlink.svg",
              "style": "width: 1.1em; height: 1.1em;",
              "disabled": glyphLocked || this.fontController.readOnly,
              "data-tooltip": translate(
                isConfirming
                  ? "sidebar.selection-info.metrics-key.unlink.confirm"
                  : "sidebar.selection-info.metrics-key.unlink.tooltip"
              ),
              "data-tooltipposition": "left",
              "onclick": async () => {
                if (this._metricsUnlinkConfirm !== side) {
                  this._metricsUnlinkConfirm = side;
                  await this.update();
                  return;
                }
                this._metricsUnlinkConfirm = null;
                await this._unlinkMetricsKey(glyphName, varGlyphController, side);
                await this.update();
              },
            }),
          });
        }
        formContents.push({ type: "single-icon", element: this.letterspacerHost });
        formContents.push({
          type: "single-icon",
          element: this.skeletonDefaultsHost,
        });
        hostedPanelsInForm = true;
        formContents.push({
          type: "edit-text-double",
          key: '["kern-l-r"]',
          label: translate("sidebar.selection-info.kern-group-l-r"),
          field1: {
            key: '["kernLeft"]',
            value: kerningController.rightPairGroupMapping[glyphName] || "",
            setValuePlain: (fieldItem, value) => {
              kerningController.editGroupSide2(glyphName, value.trim());
            },
          },
          field2: {
            key: '["kernRight"]',
            value: kerningController.leftPairGroupMapping[glyphName] || "",
            setValuePlain: (fieldItem, value) => {
              kerningController.editGroupSide1(glyphName, value.trim());
            },
          },
        });
      }
    }

    const { pointIndices, componentIndices, backgroundImageIndices } =
      this._getSelection();

    if (glyphController) {
      formContents.push(
        ...this._setupDimensionsInfo(glyphController, pointIndices, componentIndices)
      );
    }

    for (const index of backgroundImageIndices) {
      assert(index === 0, "only a single bg image is supported");

      const backgroundImage = instance?.backgroundImage;
      if (!backgroundImage) {
        continue;
      }

      const backgroundImageKey = (...path) =>
        JSON.stringify(["backgroundImage", ...path]);

      formContents.push({ type: "divider" });
      formContents.push({
        type: "header",
        label: translate("sidebar.user-settings.glyph.background-image"),
        auxiliaryElement: html.createDomElement("icon-button", {
          "style": `width: 1.3em;`,
          "src": "/tabler-icons/refresh.svg",
          "onclick": (event) => this._resetTransformationForBackgroundImage(),
          "data-tooltip": translate(
            "sidebar.selection-info.component.reset-transformation"
          ),
          "data-tooltipposition": "left",
        }),
      });

      formContents.push({
        type: "color-picker",
        key: backgroundImageKey("color"),
        label: translate("background-image.labels.colorize"),
        continuousDelay: 150,
        allowNoColor: true,
        value: backgroundImage.color,
        parseColor: (value) => {
          const matches = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
          const channels = matches.slice(1, 4).map((ch) => parseInt(ch, 16) / 255);
          return { red: channels[0], green: channels[1], blue: channels[2] };
        },
        formatColor: (value) =>
          value ? rgbaToHex([value.red, value.green, value.blue]) : "#000000",
      });

      formContents.push({
        type: "edit-number-slider",
        key: backgroundImageKey("opacity"),
        label: translate("background-image.labels.opacity"),
        value: backgroundImage.opacity,
        minValue: 0,
        defaultValue: 1.0,
        maxValue: 1.0,
      });

      formContents.push({ type: "line-spacer" });

      addTransformationItems(
        formContents,
        backgroundImageKey,
        backgroundImage.transformation
      );
    }

    for (const index of componentIndices) {
      if (!instance) {
        break;
      }
      const component = instance.components[index];
      if (!component) {
        // Invalid selection
        continue;
      }
      const componentKey = (...path) => JSON.stringify(["components", index, ...path]);

      formContents.push({ type: "divider" });
      formContents.push({
        type: "header",
        label: translate("sidebar.selection-info.component", index),
      });
      formContents.push({
        type: "edit-text",
        key: componentKey("name"),
        label: translate("sidebar.selection-info.component.base-glyph"),
        value: component.name,
      });
      formContents.push({
        type: "header",
        label: translate("sidebar.selection-info.component.transformation"),
        auxiliaryElement: html.createDomElement("icon-button", {
          "style": `width: 1.3em;`,
          "src": "/tabler-icons/refresh.svg",
          "onclick": (event) => this._resetTransformationForComponent(index),
          "data-tooltip": translate(
            "sidebar.selection-info.component.reset-transformation"
          ),
          "data-tooltipposition": "left",
        }),
      });

      addTransformationItems(formContents, componentKey, component.transformation);

      const baseGlyph = await this.fontController.getGlyph(component.name);

      if (baseGlyph) {
        const showGlobalAxes =
          this.sceneController.applicationSettings
            .alwaysShowGlobalAxesInComponentLocation;

        const fontAxisNames = baseGlyph.continuousFontAxisNames;
        const selectedFontAxisNames = [...fontAxisNames].filter(
          (axisName) =>
            showGlobalAxes ||
            Object.values(varGlyphController.layers).some((layer) =>
              layer.glyph.components[index]?.location.hasOwnProperty(axisName)
            )
        );

        const glyphAxisNames = [...baseGlyph.glyphAxisNames];
        if (this.sceneController.applicationSettings.sortComponentLocationGlyphAxes) {
          glyphAxisNames.sort((a, b) => {
            const firstCharAIsUpper = a[0] === a[0].toUpperCase();
            const firstCharBIsUpper = b[0] === b[0].toUpperCase();
            if (firstCharAIsUpper != firstCharBIsUpper) {
              return firstCharBIsUpper ? -1 : 1;
            } else {
              return a < b ? -1 : +1;
            }
          });
        }

        const axisNames = [...selectedFontAxisNames, ...glyphAxisNames];

        const locationItems = [];

        // TODO: this needs more thinking, as the axes of *nested* components may also
        // be of interest. We would then need to be able to *add* such a value to
        // component.location. This could work somewhat similar to showing global axes.
        // Given we have no direct use case, we'll leave this for now.

        const combinedAxes = Object.fromEntries(
          baseGlyph.combinedAxes.map((axis) => [axis.name, axis])
        );

        for (const axisName of axisNames) {
          const isGlobalAxis = fontAxisNames.has(axisName);
          const axis = combinedAxes[axisName];
          const value = component.location[axis.name];
          const currentGlobalAxisLocationValue =
            this.sceneController.sceneSettingsController.model.fontLocationSourceMapped[
              axisName
            ] ?? axis.defaultValue;

          locationItems.push({
            type: "edit-number-slider",
            key: componentKey("location", axis.name),
            label: axis.name,
            value: value,
            minValue: axis.minValue,
            defaultValue: axis.defaultValue,
            maxValue: axis.maxValue,
            hasCheckBox: isGlobalAxis,
            fallbackValue: isGlobalAxis ? currentGlobalAxisLocationValue : undefined,
          });
        }

        if (locationItems.length || true) {
          formContents.push({
            type: "header",
            label: "Location",
            auxiliaryElement: html.div(
              {
                style: `width: auto; display: flex; flex-direction: row; gap: 0.15em;`,
              },
              [
                html.createDomElement("icon-button", {
                  "id": "component-axis-options-button",
                  "style": `width: 1.3em;`,
                  "src": "/tabler-icons/menu-2.svg",
                  "onclick": (event) => this.showComponentAxesOptionsMenu(event),
                  "data-tooltip": translate(
                    "sidebar.designspace-navigation.font-axes-view-options-button.tooltip"
                  ),
                  "data-tooltipposition": "left",
                }),
                html.createDomElement("icon-button", {
                  "style": `width: 1.3em;`,
                  "src": "/tabler-icons/refresh.svg",
                  "onclick": (event) => this._resetAxisValuesForComponent(index),
                  "data-tooltip": translate(
                    "sidebar.selection-info.component.reset-axis-values"
                  ),
                  "data-tooltipposition": "left",
                }),
              ]
            ),
          });
          formContents.push(...locationItems);
        }
      }
    }

    this._formFieldsByKey = {};
    for (const field of formContents) {
      if (field.fieldX) {
        this._formFieldsByKey[field.fieldX.key] = field.fieldX;
        this._formFieldsByKey[field.fieldY.key] = field.fieldY;
      } else {
        this._formFieldsByKey[field.key] = field;
      }
    }

    // The two hosted panels draw nothing while their host is out of the DOM,
    // and this rebuild is what puts it back. Their own toggle runs once, when
    // this panel is switched on, which on a fresh load is before this form has
    // ever been built — so they came up blank and stayed blank until the panel
    // was switched off and on again.
    //
    // Only on the rebuild that re-attaches the host, not on every one: this
    // form is rebuilt on every selection change, and redrawing both panels there
    // would replace a control the user is still holding.
    const hostsWereDetached =
      hostedPanelsInForm && !this.skeletonDefaultsHost.offsetParent;

    if (!formContents.length) {
      this.infoForm.setFieldDescriptions([
        { type: "text", value: translate("selection.none") },
      ]);
    } else {
      this.infoForm.setFieldDescriptions(formContents);
      if (glyphController) {
        await this._setupSelectionInfoHandlers(glyphName);
      }
    }

    if (hostsWereDetached) {
      await this.letterspacerPanel?.update();
      await this.skeletonDefaultsPanel?.update();
    }
  }

  showComponentAxesOptionsMenu(event) {
    const menuItems = [
      {
        title: translate("Show global axes"),
        callback: () => {
          this.sceneController.applicationSettings.alwaysShowGlobalAxesInComponentLocation =
            !this.sceneController.applicationSettings
              .alwaysShowGlobalAxesInComponentLocation;
        },
        checked:
          this.sceneController.applicationSettings
            .alwaysShowGlobalAxesInComponentLocation,
      },
      {
        title: translate("Sort glyph axes"),
        callback: () => {
          this.sceneController.applicationSettings.sortComponentLocationGlyphAxes =
            !this.sceneController.applicationSettings.sortComponentLocationGlyphAxes;
        },
        checked:
          this.sceneController.applicationSettings.sortComponentLocationGlyphAxes,
      },
    ];

    const button = this.infoForm.shadowRoot.querySelector(
      "#component-axis-options-button"
    );
    const buttonRect = button.getBoundingClientRect();
    showMenu(menuItems, { x: buttonRect.right, y: buttonRect.bottom });
  }

  async _toggleGlyphLock(varGlyph) {
    if (varGlyph.customData["fontra.glyph.locked"]) {
      const result = await dialog(
        translate("sidebar.selection-info.dialog.unlock-glyph.title", varGlyph.name),
        "",
        [
          { title: translate("dialog.cancel"), isCancelButton: true },
          { title: translate("dialog.yes"), isDefaultButton: true, resultValue: "ok" },
        ]
      );

      if (!result) {
        // User cancelled
        return;
      }
    }

    const iconElement = this.infoForm.shadowRoot.querySelectorAll("#glyphLocking")[0];
    iconElement.src = varGlyph.customData["fontra.glyph.locked"]
      ? "/tabler-icons/lock-open-2.svg"
      : "/tabler-icons/lock.svg";

    await this.sceneController.editGlyphAndRecordChanges(
      (glyph) => {
        if (glyph.customData["fontra.glyph.locked"]) {
          delete glyph.customData["fontra.glyph.locked"];
        } else {
          glyph.customData["fontra.glyph.locked"] = true;
        }
        return glyph.customData["fontra.glyph.locked"]
          ? translate("sidebar.selection-info.glyph-locking.tooltip.lock")
          : translate("sidebar.selection-info.glyph-locking.tooltip.unlock");
      },
      undefined,
      undefined,
      true // ignoreGlyphLock
    );
  }

  async _resetTransformationForComponent(componentIndex) {
    await this.sceneController.editGlyphAndRecordChanges((glyph) => {
      const editLayerGlyphs = this.sceneController.getEditingLayerFromGlyphLayers(
        glyph.layers
      );

      for (const [layerName, layerGlyph] of Object.entries(editLayerGlyphs)) {
        layerGlyph.components[componentIndex].transformation = getDecomposedIdentity();
      }
      return translate("sidebar.selection-info.component.reset-transformation");
    });
  }

  async _resetTransformationForBackgroundImage() {
    await this.sceneController.editGlyphAndRecordChanges((glyph) => {
      const editLayerGlyphs = this.sceneController.getEditingLayerFromGlyphLayers(
        glyph.layers
      );

      for (const [layerName, layerGlyph] of Object.entries(editLayerGlyphs)) {
        if (layerGlyph.backgroundImage) {
          layerGlyph.backgroundImage.transformation = getDecomposedIdentity();
        }
      }
      return translate("sidebar.selection-info.component.reset-transformation");
    });
  }

  async _resetAxisValuesForComponent(componentIndex) {
    const glyphController =
      await this.sceneController.sceneModel.getSelectedStaticGlyphController();
    const compo = glyphController.instance.components[componentIndex];
    const baseGlyph = await this.fontController.getGlyph(compo.name);
    if (!baseGlyph) {
      return;
    }

    const defaultValues = baseGlyph.combinedAxes.map((axis) => [
      axis.name,
      axis.defaultValue,
    ]);

    await this.sceneController.editGlyphAndRecordChanges((glyph) => {
      const editLayerGlyphs = this.sceneController.getEditingLayerFromGlyphLayers(
        glyph.layers
      );

      for (const [layerName, layerGlyph] of Object.entries(editLayerGlyphs)) {
        const compo = layerGlyph.components[componentIndex];
        for (const [axisName, axisValue] of defaultValues) {
          if (axisName in compo.location) {
            compo.location[axisName] = axisValue;
          }
        }
      }
      return translate("sidebar.selection-info.component.reset-axis-values");
    });
  }

  _setupDimensionsInfo(glyphController, pointIndices, componentIndices) {
    const dimensionsString = this._getDimensionsString(
      glyphController,
      pointIndices,
      componentIndices
    );
    const formContents = [];
    if (dimensionsString) {
      formContents.push({ type: "divider" });
      formContents.push({
        key: "dimensions",
        type: "text",
        label: translate("sidebar.selection-info.dimensions"),
        value: dimensionsString,
      });
    }
    return formContents;
  }

  async updateDimensions() {
    const glyphController =
      await this.sceneController.sceneModel.getSelectedStaticGlyphController();
    const { pointIndices, componentIndices } = this._getSelection();
    const dimensionsString = this._getDimensionsString(
      glyphController,
      pointIndices,
      componentIndices
    );
    if (this.infoForm.hasKey("dimensions")) {
      this.infoForm.setValue("dimensions", dimensionsString);
    }
  }

  _getSelection() {
    const { point, component, componentOrigin, componentTCenter, backgroundImage } =
      parseSelection(this.sceneController.selection);

    const componentIndices = [
      ...new Set([
        ...(component || []),
        ...(componentOrigin || []),
        ...(componentTCenter || []),
      ]),
    ].sort((a, b) => a - b);
    return {
      pointIndices: point || [],
      componentIndices,
      backgroundImageIndices: backgroundImage || [],
    };
  }

  _getDimensionsString(glyphController, pointIndices, componentIndices) {
    if (pointIndices.length === 1 && componentIndices.length === 0) {
      const handleDeltaString = this._getHandleDeltaString(
        glyphController,
        pointIndices
      );
      if (handleDeltaString) {
        return handleDeltaString;
      }
    }

    const selectionRects = [];
    if (pointIndices.length) {
      const instance = glyphController.instance;
      const selRect = rectFromPoints(
        pointIndices.map((i) => instance.path.getPoint(i)).filter((point) => !!point)
      );
      if (selRect) {
        selectionRects.push(selRect);
      }
    }
    for (const componentIndex of componentIndices) {
      const component = glyphController.components[componentIndex];
      if (!component || !component.controlBounds) {
        continue;
      }
      selectionRects.push(component.bounds);
    }
    if (!selectionRects.length && glyphController?.controlBounds) {
      selectionRects.push(glyphController.bounds);
    }
    if (selectionRects.length) {
      const selectionBounds = unionRect(...selectionRects);
      let { width, height } = rectSize(selectionBounds);
      width = round(width, 1);
      height = round(height, 1);
      return `↔ ${width} ↕ ${height}`;
    }
  }

  _getHandleDeltaString(glyphController, pointIndices) {
    if (pointIndices?.length !== 1) {
      return null;
    }
    const path = glyphController.path;
    const point = path.getPoint(pointIndices[0]);
    if (!point) {
      return null;
    }
    const { x, y, type } = point;
    if (!type) {
      return null;
    }
    const [contourIndex, pointIndex] = path.getContourAndPointIndex(pointIndices[0]);
    const numPoints = path.getNumPointsOfContour(contourIndex);
    const { isClosed } = path.contourInfo[contourIndex];

    const wrap = isClosed ? modulo : (i, n) => (i >= 0 && i < n ? i : null);

    const neighborIndices = [
      wrap(pointIndex - 1, numPoints),
      wrap(pointIndex + 1, numPoints),
    ].filter((i) => i !== null);

    const neighborPoints = neighborIndices
      .map((i) => path.getContourPoint(contourIndex, i))
      .filter((point) => !point.type);

    if (neighborPoints.length === 1) {
      const { x: baseX, y: baseY } = neighborPoints[0];
      const dx = x - baseX;
      const dy = y - baseY;
      return `↔ ${dx} ↕ ${dy}`;
    }
  }

  async _setupSelectionInfoHandlers(glyphName) {
    const varGlyph = await this.fontController.getGlyph(glyphName);

    this.infoForm.onFieldChange = async (fieldItem, value, valueStream) => {
      if (fieldItem.setValuePlain) {
        assert(!valueStream, "unexpected valueStream");
        fieldItem.setValuePlain(fieldItem, value);
      } else {
        await this._onFieldChangeForGlyph(
          glyphName,
          varGlyph,
          fieldItem,
          value,
          valueStream
        );
      }
    };
  }

  async _onFieldChangeForGlyph(glyphName, varGlyph, fieldItem, value, valueStream) {
    const changePath = JSON.parse(fieldItem.key);
    const senderInfo = { senderID: this, fieldKeyPath: changePath };

    const getFieldValue = fieldItem.getValue || defaultGetFieldValue;
    const setFieldValue = fieldItem.setValue || defaultSetFieldValue;
    const deleteFieldValue = fieldItem.deleteValue || defaultDeleteFieldValue;

    await this.sceneController.editGlyph(async (sendIncrementalChange, glyph) => {
      const layerInfo = [];
      for (const [layerName, layerGlyph] of Object.entries(
        this.sceneController.getEditingLayerFromGlyphLayers(glyph.layers)
      )) {
        const layerGlyphController = await this.fontController.getLayerGlyphController(
          glyphName,
          layerName,
          varGlyph.getSourceIndexForLayerName(layerName)
        );
        layerInfo.push({
          layerName,
          layerGlyph,
          layerGlyphController,
          orgValue: getFieldValue(layerGlyph, layerGlyphController, fieldItem),
        });
      }

      let changes;

      if (valueStream) {
        // Continuous changes (eg. slider drag)
        for await (const value of valueStream) {
          // An abandoned drag has nothing to commit; the rollback below the loop
          // is what puts the glyph back.
          if (isScrubCancelled(value)) {
            return;
          }
          for (const { layerGlyph, layerGlyphController, orgValue } of layerInfo) {
            if (orgValue !== undefined) {
              setFieldValue(layerGlyph, layerGlyphController, fieldItem, orgValue); // Ensure getting the correct undo change
            } else {
              deleteFieldValue(layerGlyph, layerGlyphController, fieldItem);
            }
          }
          changes = applyNewValue(
            glyph,
            layerInfo,
            value,
            fieldItem,
            this.multiEditChangesAreAbsolute
          );
          await sendIncrementalChange(changes.change, true); // true: "may drop"
        }
      } else {
        // Simple, atomic change
        changes = applyNewValue(
          glyph,
          layerInfo,
          value,
          fieldItem,
          this.multiEditChangesAreAbsolute
        );
      }

      const undoLabel =
        changePath.length == 1
          ? `${changePath.at(-1)}`
          : `${changePath.at(-2)}.${changePath.at(-1)}`;
      return {
        changes: changes,
        undoLabel: undoLabel,
        broadcast: true,
      };
    }, senderInfo);

    if (["xAdvance", "leftMargin", "rightMargin"].includes(changePath[0])) {
      this._updateGlyphMetrics(glyphName, changePath[0]);
    }
  }

  async _updateGlyphMetrics(glyphName, changedKey) {
    const keyMap = {
      xAdvance: "rightMargin",
      leftMargin: "xAdvance",
      rightMargin: "xAdvance",
    };
    const glyphController = await this.sceneController.sceneModel.getGlyphInstance(
      glyphName,
      this.sceneController.sceneSettings.editLayerName
    );

    const keyToUpdata = keyMap[changedKey];
    const fieldKey = JSON.stringify([keyToUpdata]);
    this.infoForm.setValue(fieldKey, glyphController[keyToUpdata]);
  }

  async _evaluateMetricsExpression(expression, varGlyphController, metricProperty) {
    const { mainLayerName, locations } = this._getEditingLocations(varGlyphController);
    return await resolveMetricsExpression(
      this.fontController,
      expression,
      metricProperty,
      locations,
      mainLayerName
    );
  }

  _glyphHasMetricsKeys(varGlyphController) {
    return glyphHasAnyMetricsKey(varGlyphController?.glyph);
  }

  async _resolveMetricsKeysForGlyph(glyphName, varGlyphController) {
    return await resolveMetricsKeysForGlyph(
      this.fontController,
      glyphName,
      varGlyphController
    );
  }

  // Drops the key at the level that governs this source, leaving the applied
  // margin in place. A source override is removed in preference to the shared
  // key, matching "reset to shared" (spec sections 4.4 and 4.9).
  async _unlinkMetricsKey(glyphName, varGlyphController, side) {
    if (this.fontController.readOnly) {
      return;
    }
    const layerName = this.sceneController.sceneSettings.editLayerName;
    const effective = getEffectiveMetricsKey(
      varGlyphController.glyph,
      varGlyphController.glyph.layers[layerName]?.glyph,
      side
    );
    if (!effective) {
      return;
    }

    await this.sceneController.editNamedGlyphAndRecordChanges(glyphName, (glyph) => {
      if (effective.level === "source") {
        deleteSidebearingKey(glyph.layers[layerName]?.glyph, side);
      } else {
        deleteSidebearingKey(glyph, side);
      }
      return "unlink metrics key";
    });
  }

  async _updateMetricsForGlyph(glyphName, varGlyphController) {
    if (this.fontController.readOnly) {
      return;
    }
    const pending = await this._resolveMetricsKeysForGlyph(
      glyphName,
      varGlyphController
    );
    if (!pending.length) {
      return;
    }

    const layerControllers = {};
    for (const { layerName } of pending) {
      if (layerControllers[layerName]) {
        continue;
      }
      layerControllers[layerName] = await this.fontController.getLayerGlyphController(
        glyphName,
        layerName,
        varGlyphController.getSourceIndexForLayerName(layerName)
      );
    }

    await this.sceneController.editNamedGlyphAndRecordChanges(glyphName, (glyph) => {
      for (const { layerName, side, value } of pending) {
        const layerGlyph = glyph.layers[layerName]?.glyph;
        if (!layerGlyph) {
          continue;
        }
        MARGIN_SETTERS[side](layerGlyph, layerControllers[layerName], value);
      }
      return "update sidebearings";
    });
  }

  // Resolves the current source's effective key for one side, for display only.
  // The live resolve doubles as the staleness test (spec section 4.8) -- no watcher.
  async _getMetricsKeyDisplay(varGlyphController, glyphController, side) {
    if (!varGlyphController || !glyphController) {
      return null;
    }
    const layerName = this.sceneController.sceneSettings.editLayerName;
    const layerGlyph = varGlyphController.glyph.layers[layerName]?.glyph;
    const effective = getEffectiveMetricsKey(
      varGlyphController.glyph,
      layerGlyph,
      side
    );
    if (!effective) {
      return null;
    }

    const metricProperty = SIDE_METRIC_PROPERTY[side];
    const { mainLayerName, locations } = this._getEditingLocations(varGlyphController);
    const result = await resolveMetricsExpression(
      this.fontController,
      effective.expression,
      metricProperty,
      locations,
      mainLayerName
    );

    if (result?.error) {
      return { ...effective, resolvedValue: undefined, error: result.error };
    }
    const resolvedValue = typeof result === "number" ? result : result?.value;
    return {
      ...effective,
      resolvedValue,
      stale: isMetricsValueStale(glyphController[metricProperty], resolvedValue),
    };
  }

  // Field entry point for a sidebearing. Decides whether the input creates a
  // persistent link (leading "=") or is a one-shot value, records the intent,
  // and returns the resolved value for the normal apply path.
  async _evaluateSidebearingInput(input, varGlyphController, side) {
    const metricProperty = SIDE_METRIC_PROPERTY[side];
    const parsed = parseMetricsKey(input);

    if (parsed.error) {
      this._pendingMetricsKeyEdit = null;
      return { error: parsed.error };
    }

    if (!parsed.isKey) {
      // A plain number or a bare one-shot reference breaks any existing link
      // at the level this field is bound to (spec section 4.4).
      this._pendingMetricsKeyEdit = { side, action: "clear" };
      return await this._evaluateMetricsExpression(
        input,
        varGlyphController,
        metricProperty
      );
    }

    const result = await this._evaluateMetricsExpression(
      parsed.expression,
      varGlyphController,
      metricProperty
    );
    if (result?.error) {
      this._pendingMetricsKeyEdit = null;
      return result;
    }

    this._pendingMetricsKeyEdit = {
      side,
      action: "set",
      expression: parsed.expression,
    };
    return result;
  }

  // Runs inside applyNewValue's recordChanges callback, so the key and the
  // margin land in one undo step. Writes at the level the field is bound to:
  // a source override if this side already has one, otherwise the shared key.
  _recordPendingMetricsKey(glyph, layerInfo, side) {
    const pending = this._pendingMetricsKeyEdit;
    this._pendingMetricsKeyEdit = null;
    if (!pending || pending.side !== side) {
      return;
    }

    const overriddenLayerNames = layerInfo
      .map(({ layerName }) => layerName)
      .filter(
        (layerName) =>
          getSidebearingKey(glyph.layers[layerName]?.glyph, side) !== undefined
      );

    if (pending.action === "clear") {
      if (overriddenLayerNames.length) {
        for (const layerName of overriddenLayerNames) {
          deleteSidebearingKey(glyph.layers[layerName].glyph, side);
        }
      } else {
        deleteSidebearingKey(glyph, side);
      }
      return;
    }

    if (overriddenLayerNames.length) {
      for (const layerName of overriddenLayerNames) {
        setSidebearingKey(glyph.layers[layerName].glyph, side, pending.expression);
      }
    } else {
      setSidebearingKey(glyph, side, pending.expression);
    }
  }

  _getEditingLocations(varGlyphController) {
    const layerNames = new Set(this.sceneController.editingLayerNames);
    const locations = {};
    for (const [sourceIndex, source] of enumerate(varGlyphController.sources)) {
      if (layerNames.has(source.layerName) && !locations[source.layerName]) {
        locations[source.layerName] = varGlyphController.getSourceLocation(source);
      }
    }
    return { mainLayerName: this.sceneController.editingLayerNames[0], locations };
  }
}

function addTransformationItems(formContents, keyFunc, transformation) {
  formContents.push({
    type: "edit-number-x-y",
    label: translate("sidebar.selection-info.component.translate"),
    fieldX: {
      key: keyFunc("transformation", "translateX"),
      value: transformation.translateX,
    },
    fieldY: {
      key: keyFunc("transformation", "translateY"),
      value: transformation.translateY,
    },
  });

  formContents.push({
    type: "edit-angle",
    key: keyFunc("transformation", "rotation"),
    label: translate("sidebar.selection-info.component.rotation"),
    value: transformation.rotation,
  });

  formContents.push({
    type: "edit-number-x-y",
    label: translate("sidebar.selection-info.component.scale"),
    fieldX: {
      key: keyFunc("transformation", "scaleX"),
      value: transformation.scaleX,
    },
    fieldY: {
      key: keyFunc("transformation", "scaleY"),
      value: transformation.scaleY,
    },
  });

  formContents.push({
    type: "edit-number-x-y",
    label: translate("sidebar.selection-info.component.skew"),
    fieldX: {
      key: keyFunc("transformation", "skewX"),
      value: transformation.skewX,
    },
    fieldY: {
      key: keyFunc("transformation", "skewY"),
      value: transformation.skewY,
    },
  });

  formContents.push({
    type: "edit-number-x-y",
    label: translate("sidebar.selection-info.component.center"),
    fieldX: {
      key: keyFunc("transformation", "tCenterX"),
      value: transformation.tCenterX,
    },
    fieldY: {
      key: keyFunc("transformation", "tCenterY"),
      value: transformation.tCenterY,
    },
  });
}

function defaultGetFieldValue(glyph, glyphController, fieldItem) {
  const changePath = JSON.parse(fieldItem.key);
  return getNestedValue(glyph, changePath);
}

function defaultSetFieldValue(glyph, glyphController, fieldItem, value) {
  const changePath = JSON.parse(fieldItem.key);
  return setNestedValue(glyph, changePath, value);
}

function defaultDeleteFieldValue(glyph, glyphController, fieldItem) {
  const changePath = JSON.parse(fieldItem.key);
  return deleteNestedValue(glyph, changePath);
}

function getNestedValue(subject, path) {
  for (const pathElement of path) {
    if (subject === undefined) {
      throw new Error(`assert -- invalid change path: ${path}`);
    }
    subject = subject[pathElement];
  }
  return subject;
}

function setNestedValue(subject, path, value) {
  const key = path.slice(-1)[0];
  path = path.slice(0, -1);
  subject = getNestedValue(subject, path);
  subject[key] = value;
}

function deleteNestedValue(subject, path) {
  const key = path.slice(-1)[0];
  path = path.slice(0, -1);
  subject = getNestedValue(subject, path);
  delete subject[key];
}

function applyNewValue(glyph, layerInfo, value, fieldItem, absolute) {
  const setFieldValue = fieldItem.setValue || defaultSetFieldValue;
  const deleteFieldValue = fieldItem.deleteValue || defaultDeleteFieldValue;

  const primaryOrgValue = layerInfo[0].orgValue;
  const isNumber = typeof primaryOrgValue === "number";
  const delta =
    isNumber && !absolute && !value?.getValue ? value - primaryOrgValue : null;
  return recordChanges(glyph, (glyph) => {
    const layers = glyph.layers;
    for (const { layerName, layerGlyphController, orgValue } of layerInfo) {
      if (value == null) {
        deleteFieldValue(layers[layerName].glyph, layerGlyphController, fieldItem);
      } else {
        const layerValue = value?.getValue ? value.getValue(layerName) : value;

        let newValue =
          delta === null || orgValue === undefined ? layerValue : orgValue + delta;

        if (isNumber) {
          newValue = maybeClampValue(newValue, fieldItem.minValue, fieldItem.maxValue);
        }
        setFieldValue(
          layers[layerName].glyph,
          layerGlyphController,
          fieldItem,
          newValue
        );
      }
    }
    // Optional per-field hook: lets a field record extra changes (eg. a metrics
    // key) inside the same undo step as the value it just applied.
    fieldItem.recordExtraChanges?.(glyph, layerInfo, value);
  });
}

function maybeClampValue(value, min, max) {
  if (min !== undefined) {
    value = Math.max(value, min);
  }
  if (max !== undefined) {
    value = Math.min(value, max);
  }
  return value;
}

// Resolves every source's effective key for one glyph. Returns a flat, ordered
// list of margins to apply: left entries first, so the path translation happens
// before any right-margin write (spec section 5).
export async function resolveMetricsKeysForGlyph(
  fontController,
  glyphName,
  varGlyphController
) {
  const glyph = varGlyphController.glyph;
  const pending = { left: [], right: [] };

  for (const source of varGlyphController.sources) {
    if (source.inactive) {
      continue;
    }
    const layerName = source.layerName;
    const layerGlyph = glyph.layers[layerName]?.glyph;
    if (!layerGlyph) {
      continue;
    }
    const location = varGlyphController.getSourceLocation(source);

    for (const side of ["left", "right"]) {
      const effective = getEffectiveMetricsKey(glyph, layerGlyph, side);
      if (!effective) {
        continue;
      }
      if (isSelfReferenceSameSide(effective.expression, glyphName)) {
        // Identity: it would write back the value it just read (spec 7 case 3).
        continue;
      }
      const result = await resolveMetricsExpression(
        fontController,
        effective.expression,
        SIDE_METRIC_PROPERTY[side],
        { [layerName]: location },
        layerName
      );
      if (result?.error) {
        // Missing or unresolvable reference: skip this side, leave the real
        // margin untouched (spec section 7 cases 1 and 2).
        console.warn(
          `metrics key for ${glyphName}/${layerName}/${side}: ${result.error}`
        );
        continue;
      }
      const value = typeof result === "number" ? result : result?.value;
      if (!Number.isFinite(value)) {
        continue;
      }
      pending[side].push({ layerName, side, value });
    }
  }

  return [...pending.left, ...pending.right];
}

// True when the glyph has any key at all -- shared or on any source.
export function glyphHasAnyMetricsKey(glyph) {
  if (!glyph) {
    return false;
  }
  if (hasAnySidebearingKey(glyph)) {
    return true;
  }
  return Object.values(glyph.layers).some((layer) => hasAnySidebearingKey(layer.glyph));
}

// The adornment beside a keyed field: the resolved number, or a marker when the
// reference could not be resolved (spec section 7 cases 1 and 2).
function formatResolvedMetricsValue(keyDisplay) {
  if (keyDisplay.error || keyDisplay.resolvedValue == undefined) {
    return "?";
  }
  return String(round(keyDisplay.resolvedValue, 1));
}

// The single left-margin setter. Setting the left margin translates the whole
// outline, so it must run before any right-margin write in the same pass.
export function setLeftMarginOnLayer(layerGlyph, layerGlyphController, value) {
  const translationX = maybeClampValue(
    value - layerGlyphController.leftMargin,
    -layerGlyph.xAdvance,
    undefined
  );
  for (const i of range(0, layerGlyph.path.coordinates.length, 2)) {
    layerGlyph.path.coordinates[i] += translationX;
  }
  for (const compo of layerGlyph.components) {
    compo.transformation.translateX += translationX;
  }
  layerGlyph.xAdvance += translationX;
}

// The single right-margin setter.
export function setRightMarginOnLayer(layerGlyph, layerGlyphController, value) {
  const translationX = maybeClampValue(
    value - layerGlyphController.rightMargin,
    -layerGlyph.xAdvance,
    undefined
  );
  layerGlyph.xAdvance += translationX;
}

export const MARGIN_SETTERS = Object.freeze({
  left: setLeftMarginOnLayer,
  right: setRightMarginOnLayer,
});

// One implementation of the nameCapture -> compute -> instantiateController
// chain. Callers supply the locations to resolve at, so this serves both the
// editing-layer case (typing in the field) and the arbitrary-source case
// (Update / Update all), which must resolve sources that are not open.
export async function resolveMetricsExpression(
  fontController,
  expression,
  metricProperty,
  locations,
  mainLayerName
) {
  const sidebearingOpposites = {
    leftMargin: "rightMargin",
    rightMargin: "leftMargin",
  };

  const numericValue = Number(expression);
  if (!isNaN(numericValue)) {
    return numericValue;
  }

  const { names, namespace } = nameCapture(
    fontController.glyphMap,
    (nameObject, name) =>
      nameObject[name] ||
      (sidebearingOpposites[metricProperty] &&
        name.endsWith("!") &&
        nameObject[name.slice(0, -1)])
        ? 1
        : undefined
  );

  try {
    compute(expression, undefined, namespace);
  } catch (e) {
    return { error: e.message };
  }

  const layerVariables = {};
  for (const name of names) {
    const referencedGlyphName = name.endsWith("!") ? name.slice(0, -1) : name;
    const referencedGlyph = await fontController.getGlyph(referencedGlyphName);
    if (!referencedGlyph) {
      // Referenced glyph is missing (spec section 7 case 1): report rather than throw.
      return { error: `unknown glyph: ${referencedGlyphName}` };
    }
    for (const [layerName, location] of Object.entries(locations)) {
      const getGlyphFunc = fontController.getGlyph.bind(fontController);
      const instanceController = await referencedGlyph.instantiateController(
        location,
        layerName,
        getGlyphFunc
      );
      if (!layerVariables[layerName]) {
        layerVariables[layerName] = {};
      }
      layerVariables[layerName][referencedGlyphName] =
        instanceController[metricProperty];
      if (name.endsWith("!") && sidebearingOpposites[metricProperty]) {
        layerVariables[layerName][referencedGlyphName + "!"] =
          instanceController[sidebearingOpposites[metricProperty]];
      }
    }
  }

  return {
    getValue: (layerName) => {
      try {
        return ensureFiniteNumber(
          compute(expression, undefined, layerVariables[layerName])
        );
      } catch (e) {
        console.error(e);
      }
      return 0;
    },
    value: ensureFiniteNumber(
      compute(expression, undefined, layerVariables[mainLayerName])
    ),
  };
}

function makeCodePointsString(codePoints) {
  return (codePoints || [])
    .map(
      (code) =>
        `${makeUPlusStringFromCodePoint(code)}\u00A0(${getCharFromCodePoint(code)})`
    )
    .join(" ");
}

function ensureFiniteNumber(value, fallback = 0) {
  if (isNaN(value) || Math.abs(value) === Infinity) {
    console.log(`bad expression result: ${value}, fall back to 0`);
    value = fallback;
  }
  return value;
}

customElements.define("panel-selection-info", SelectionInfoPanel);

import { recordChanges } from "@fontra/core/change-recorder.js";
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { isScrubCancelled } from "@fontra/core/number-scrub.js";
import {
  DEFAULT_SKELETON_WIDTH,
  SKELETON_SOURCE_DEFAULT_FALLBACKS,
  SKELETON_SOURCE_DEFAULT_KEYS,
  getSkeletonData,
  getSkeletonGlyphCase,
  getSkeletonPointWidth,
  getSourceSkeletonDefaultsValue,
  setSkeletonPointTotalWidth,
  setSourceSkeletonDefaultsValues,
} from "@fontra/core/skeleton-model.js";
import { dialog } from "@fontra/web-components/modal-dialog.js";
import { Form } from "@fontra/web-components/ui-form.js";
import {
  CAP_ANGLE_MAX,
  CAP_ANGLE_MIN,
  CAP_RADIUS_POSITIONS,
  capRadiusIndexFromRatio,
  capRadiusRatioFromIndex,
} from "./panel-skeleton-parameters.js";
import Panel from "./panel.js";
import { editSkeleton } from "./skeleton-editing.js";

// Cap default values are stored in model units (radius ratio, tension 0–1)
// but edited with the same sliders as the skeleton parameters panel (radius
// as 1-based log-scale position, tension in percent).
const CAP_DISPLAY_CONVERTERS = {
  capRadiusRatio: {
    toDisplay: (value) => capRadiusIndexFromRatio(Number(value)) + 1,
    fromDisplay: (value) => capRadiusRatioFromIndex(Number(value) - 1),
  },
  capTension: {
    toDisplay: (value) => Math.round(Number(value) * 100),
    fromDisplay: (value) => Number(value) / 100,
  },
};

// Master-wide skeleton defaults (1.3/1.4): per-source base widths (by glyph
// case) and cap parameter presets. Hosted in the glyph panel below the
// letterspacer; formerly a section of the skeleton parameters panel.
export default class SkeletonDefaultsPanel extends Panel {
  identifier = "skeleton-defaults";
  iconPath = "/tabler-icons/bone.svg";

  constructor(editorController) {
    super(editorController);
    this._customDeleteConfirm = null;
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

    this.updateBound = this.update.bind(this);
    this.sceneSettingsController.addKeyListener(
      ["fontLocationSourceMapped", "selectedGlyphName"],
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

  // ---- Source defaults access (same resolution as the skeleton panel) ------

  _getEffectiveSource() {
    const location =
      this.sceneController.sceneSettings.fontLocationSourceMapped ||
      this.sceneController.sceneSettings.fontLocationSource ||
      {};
    const sourceId =
      this.fontController.fontSourcesInstancer?.getSourceIdentifierForLocation(
        location
      ) || this.fontController.defaultSourceIdentifier;
    return {
      sourceId,
      source: sourceId ? this.fontController.sources?.[sourceId] : null,
    };
  }

  _sourceDefault(key) {
    const { source } = this._getEffectiveSource();
    const fallback = SKELETON_SOURCE_DEFAULT_FALLBACKS[key];
    return source ? getSourceSkeletonDefaultsValue(source, key, fallback) : fallback;
  }

  async _persistSourceDefaults(values, undoLabel) {
    if (this.fontController.readOnly) {
      return;
    }
    const { sourceId } = this._getEffectiveSource();
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
        undoLabel || "edit skeleton defaults",
        this
      );
      await this._refreshDesignspacePanel();
    }
  }

  async _refreshDesignspacePanel() {
    const panel = this.editorController.getSidebarPanel?.("designspace-navigation");
    if (panel?.refreshSourcesAndStatus) {
      await panel.refreshSourcesAndStatus();
    }
  }

  // ---- Custom width profiles (donor: addCustomWidthRows) --------------------

  _getCustomWidthList(key) {
    const list = this._sourceDefault(key);
    if (!Array.isArray(list)) {
      return [];
    }
    return list
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        name: typeof item.name === "string" ? item.name : "",
        value: Number.isFinite(Number(item.value)) ? Number(item.value) : 0,
      }));
  }

  _buildCustomWidthRows(formContents, customKey) {
    const list = this._getCustomWidthList(customKey);
    const persist = async (next) => {
      await this._persistSourceDefaults(
        { [customKey]: next },
        translate("sidebar.skeleton-parameters.undo.set-defaults")
      );
      await this.update();
    };
    list.forEach((item, index) => {
      const rowId = `${customKey}:${index}`;
      const isConfirming = this._customDeleteConfirm === rowId;
      const nameInput = html.input({
        type: "text",
        value: item.name,
        style: "width: 7em;",
        onchange: async (event) => {
          const next = this._getCustomWidthList(customKey);
          if (!next[index]) {
            return;
          }
          next[index] = { ...next[index], name: String(event.target.value ?? "") };
          this._customDeleteConfirm = null;
          await persist(next);
        },
      });
      const valueInput = html.input({
        type: "number",
        value: item.value,
        style: "width: 4.5em;",
        onchange: async (event) => {
          const next = this._getCustomWidthList(customKey);
          if (!next[index]) {
            return;
          }
          const numeric = Number(event.target.value);
          next[index] = {
            ...next[index],
            value: Number.isFinite(numeric) ? numeric : 0,
          };
          this._customDeleteConfirm = null;
          await persist(next);
        },
      });
      // Two-click delete: first click arms (trash -> x), second click deletes.
      const deleteButton = html.createDomElement("icon-button", {
        "src": isConfirming ? "/tabler-icons/x.svg" : "/tabler-icons/trash.svg",
        "style": "width: 1.1em; height: 1.1em;",
        "data-tooltip": translate(
          isConfirming
            ? "sidebar.skeleton-parameters.custom-widths.confirm-delete"
            : "sidebar.skeleton-parameters.custom-widths.delete"
        ),
        "data-tooltipposition": "left",
        "onclick": async () => {
          if (this._customDeleteConfirm !== rowId) {
            this._customDeleteConfirm = rowId;
            await this.update();
            return;
          }
          const next = this._getCustomWidthList(customKey);
          if (!next[index]) {
            return;
          }
          next.splice(index, 1);
          this._customDeleteConfirm = null;
          await persist(next);
        },
      });
      formContents.push({
        type: "single-icon",
        element: html.div({ style: "display:flex; gap:0.35rem; align-items:center;" }, [
          nameInput,
          valueInput,
          deleteButton,
        ]),
      });
    });
    formContents.push({
      type: "single-icon",
      element: html.div({}, [
        html.button(
          {
            onclick: async () => {
              const next = this._getCustomWidthList(customKey);
              next.push({ name: `Custom ${next.length + 1}`, value: 0 });
              this._customDeleteConfirm = null;
              await persist(next);
            },
          },
          [translate("sidebar.skeleton-parameters.custom-widths.add")]
        ),
      ]),
    });
  }

  // ---- Form ----------------------------------------------------------------

  _pushNumber(formContents, key, labelKey) {
    formContents.push({
      type: "edit-number",
      key: `default:${key}`,
      label: translate(`sidebar.skeleton-parameters.${labelKey}`),
      value: this._sourceDefault(key),
    });
  }

  // Shift every rib of every skeleton glyph of `glyphCase` in the edited
  // master by `delta`, preserving each rib's offset relative to the master
  // width (mw+offset semantics) and its left/right distribution.
  async _recalculateRibWidths(glyphCase, delta) {
    const { sourceId } = this._getEffectiveSource();
    const fontSource = this.fontController.sources?.[sourceId];
    if (!fontSource) {
      return;
    }
    const location = fontSource.location || {};
    for (const glyphName of Object.keys(this.fontController.glyphMap || {})) {
      if (getSkeletonGlyphCase(glyphName) !== glyphCase) {
        continue;
      }
      let varGlyphController;
      try {
        varGlyphController = await this.fontController.getGlyph(glyphName);
      } catch (error) {
        continue;
      }
      if (!varGlyphController) {
        continue;
      }
      let sourceIndex;
      try {
        sourceIndex = varGlyphController.getSourceIndex(location);
      } catch (error) {
        sourceIndex = undefined;
      }
      if (sourceIndex === undefined || sourceIndex === null) {
        continue;
      }
      const layerName = varGlyphController.sources[sourceIndex]?.layerName;
      const layerGlyph = layerName && varGlyphController.layers?.[layerName]?.glyph;
      if (!layerGlyph || !getSkeletonData(layerGlyph)) {
        continue;
      }
      await this.sceneController.editNamedGlyphAndRecordChanges(
        glyphName,
        (glyph) => {
          const target = glyph.layers[layerName]?.glyph;
          if (target && getSkeletonData(target)) {
            editSkeleton(target, (working) => {
              for (const contour of working.contours) {
                contour.defaultWidth = Math.max(
                  0,
                  (contour.defaultWidth ?? DEFAULT_SKELETON_WIDTH) + delta
                );
                for (const point of contour.points) {
                  if (point.type || !point.width) {
                    continue;
                  }
                  const total = getSkeletonPointWidth(point, contour.defaultWidth);
                  setSkeletonPointTotalWidth(
                    point,
                    contour.defaultWidth,
                    Math.max(0, total + delta)
                  );
                }
              }
            });
          }
          return translate("sidebar.skeleton-parameters.recalc-ribs.undo");
        },
        this,
        false
      );
    }
  }

  async update() {
    if (!this.infoForm.contentElement.offsetParent) {
      return;
    }
    await this.fontController.ensureInitialized;

    const glyphName = this.sceneController.sceneSettings?.selectedGlyphName;
    const glyphCase = getSkeletonGlyphCase(glyphName);
    const isLower = glyphCase === "lowercase";
    const K = SKELETON_SOURCE_DEFAULT_KEYS;
    const baseKey = isLower ? K.WIDTH_LOWERCASE_BASE : K.WIDTH_CAPITAL_BASE;
    const horizKey = isLower
      ? K.WIDTH_LOWERCASE_HORIZONTAL
      : K.WIDTH_CAPITAL_HORIZONTAL;
    const contrastKey = isLower ? K.WIDTH_LOWERCASE_CONTRAST : K.WIDTH_CAPITAL_CONTRAST;
    const distKey = isLower
      ? K.WIDTH_LOWERCASE_DISTRIBUTION
      : K.WIDTH_CAPITAL_DISTRIBUTION;

    const formContents = [
      {
        type: "header",
        label: translate("sidebar.skeleton-parameters.source-defaults"),
      },
      {
        type: "text",
        value: translate(
          isLower
            ? "sidebar.skeleton-parameters.case.lowercase"
            : "sidebar.skeleton-parameters.case.uppercase"
        ),
      },
    ];
    this._pushNumber(formContents, baseKey, "default-base");
    this._pushNumber(formContents, horizKey, "default-horizontal");
    this._pushNumber(formContents, contrastKey, "default-contrast");
    formContents.push({
      type: "edit-number-slider",
      key: `default:${distKey}`,
      label: translate("sidebar.skeleton-parameters.default-distribution"),
      value: this._sourceDefault(distKey),
      minValue: -100,
      defaultValue: 0,
      maxValue: 100,
      step: 10,
    });
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.custom-widths"),
    });
    this._buildCustomWidthRows(
      formContents,
      isLower ? K.CUSTOM_WIDTHS_LOWERCASE : K.CUSTOM_WIDTHS_UPPERCASE
    );
    formContents.push({ type: "divider" });
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.new-serif"),
    });
    this._pushNumber(formContents, K.SERIF_NEW_WING_LENGTH, "serif-wing-length");
    this._pushNumber(formContents, K.SERIF_NEW_TIP_THICKNESS, "serif-tip-thickness");
    this._pushNumber(formContents, K.SERIF_NEW_WING_SLOPE, "serif-wing-slope");
    formContents.push({ type: "divider" });
    formContents.push({
      type: "header",
      label: translate("sidebar.skeleton-parameters.default-caps"),
    });
    formContents.push({
      type: "edit-number-slider",
      key: `default:${K.CAP_RADIUS_RATIO}`,
      label: translate("sidebar.skeleton-parameters.cap-radius"),
      value: CAP_DISPLAY_CONVERTERS.capRadiusRatio.toDisplay(
        this._sourceDefault(K.CAP_RADIUS_RATIO)
      ),
      minValue: 1,
      defaultValue: CAP_DISPLAY_CONVERTERS.capRadiusRatio.toDisplay(
        SKELETON_SOURCE_DEFAULT_FALLBACKS[K.CAP_RADIUS_RATIO]
      ),
      maxValue: CAP_RADIUS_POSITIONS,
      step: 1,
    });
    formContents.push({
      type: "edit-number-slider",
      key: `default:${K.CAP_TENSION}`,
      label: translate("sidebar.skeleton-parameters.cap-tension"),
      value: CAP_DISPLAY_CONVERTERS.capTension.toDisplay(
        this._sourceDefault(K.CAP_TENSION)
      ),
      minValue: 0,
      defaultValue: CAP_DISPLAY_CONVERTERS.capTension.toDisplay(
        SKELETON_SOURCE_DEFAULT_FALLBACKS[K.CAP_TENSION]
      ),
      maxValue: 100,
      step: 5,
    });
    formContents.push({
      type: "edit-number-slider",
      key: `default:${K.CAP_ANGLE}`,
      label: translate("sidebar.skeleton-parameters.cap-angle"),
      value: this._sourceDefault(K.CAP_ANGLE),
      minValue: CAP_ANGLE_MIN,
      defaultValue: SKELETON_SOURCE_DEFAULT_FALLBACKS[K.CAP_ANGLE],
      maxValue: CAP_ANGLE_MAX,
      step: 1,
    });
    this._pushNumber(formContents, K.CAP_DISTANCE, "cap-distance");

    this.infoForm.setFieldDescriptions(formContents);
    this.infoForm.onFieldChange = async (fieldItem, value, valueStream) => {
      const [group, name] = String(fieldItem.key).split(":");
      if (group !== "default") {
        return;
      }
      let finalValue = value;
      if (valueStream) {
        for await (const streamedValue of valueStream) {
          // An abandoned drag has nothing to commit.
          if (isScrubCancelled(streamedValue)) {
            return;
          }
          finalValue = streamedValue;
        }
      }
      const K2 = SKELETON_SOURCE_DEFAULT_KEYS;
      const baseCase =
        name === K2.WIDTH_CAPITAL_BASE
          ? "uppercase"
          : name === K2.WIDTH_LOWERCASE_BASE
            ? "lowercase"
            : null;
      const oldValue = this._sourceDefault(name);
      const storedValue =
        CAP_DISPLAY_CONVERTERS[name]?.fromDisplay(finalValue) ?? finalValue;
      await this._persistSourceDefaults(
        { [name]: storedValue },
        translate("sidebar.skeleton-parameters.undo.set-defaults")
      );
      // 1.3: rib widths can follow the master width as mw+offset — offer an
      // opt-in recalculation when the master base width changes
      const delta = Number(finalValue) - Number(oldValue);
      if (baseCase && Number.isFinite(delta) && delta !== 0) {
        const result = await dialog(
          translate("sidebar.skeleton-parameters.recalc-ribs.title"),
          translate("sidebar.skeleton-parameters.recalc-ribs.body", delta),
          [
            {
              title: translate("sidebar.skeleton-parameters.recalc-ribs.keep"),
              resultValue: "keep",
              isCancelButton: true,
            },
            {
              title: translate("sidebar.skeleton-parameters.recalc-ribs.recalc"),
              resultValue: "recalc",
              isDefaultButton: true,
            },
          ]
        );
        if (result === "recalc") {
          await this._recalculateRibWidths(baseCase, delta);
        }
      }
      await this.update();
    };
  }
}

customElements.define("panel-skeleton-defaults", SkeletonDefaultsPanel);

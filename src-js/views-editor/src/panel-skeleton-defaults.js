import { recordChanges } from "@fontra/core/change-recorder.js";
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { isScrubCancelled } from "@fontra/core/number-scrub.js";
import {
  DEFAULT_SKELETON_WIDTH,
  SERIF_PRESET_FIELDS,
  SKELETON_SOURCE_DEFAULT_FALLBACKS,
  SKELETON_SOURCE_DEFAULT_KEYS,
  getSkeletonData,
  getSkeletonGlyphCase,
  getSkeletonPointWidth,
  getSourceSkeletonDefaultsValue,
  makeSerifPreset,
  normalizeTerminalPreset,
  setSkeletonPointTotalWidth,
  setSourceSkeletonDefaultsValues,
} from "@fontra/core/skeleton-model.js";
import "@fontra/web-components/data-table.js"; // for <data-table>, ticket 68
import "@fontra/web-components/labeled-toggle.js"; // for <labeled-toggle>, ticket 67
import "@fontra/web-components/multi-select-dropdown.js"; // for <multi-select-dropdown>, ticket 69
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
import {
  captureSelectionWidthPreset,
  collectSkeletonPanelSelection,
} from "./skeleton-panel-model.js";

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

// One name for one thing: the preset editor borrows the parameters panel's own
// field labels rather than inventing a second set.
const SERIF_FIELD_LABELS = {
  wingLength: "serif-wing-length",
  tipThickness: "serif-tip-thickness",
  wingSlope: "serif-wing-slope",
  tipCutAngle: "serif-tip-cut",
  reach: "serif-reach",
  tension: "serif-tension",
  concavity: "serif-concavity",
  easeDistance: "serif-ease-distance",
  easeCurvature: "serif-ease-curvature",
};

const SKELETON_SETTINGS_STYLES = `
  .skeleton-settings-section {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-bottom: 0.75rem;
  }

  .skeleton-settings-heading {
    font-weight: bold;
  }

  .skeleton-settings-heading-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
  }

  .skeleton-settings-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }

  .skeleton-presets-table {
    width: 100%;
    border-collapse: collapse;
  }

  .skeleton-presets-table th {
    text-align: left;
    font-weight: normal;
    opacity: 0.7;
  }

  .skeleton-presets-table td {
    padding: 0.15rem 0.2rem;
    vertical-align: top;
  }

  .skeleton-presets-table input[type="text"] {
    width: 100%;
    box-sizing: border-box;
  }

  .skeleton-presets-table input[type="number"] {
    width: 4em;
  }

  .skeleton-presets-table icon-button {
    width: 1.1em;
    height: 1.1em;
  }

  .preset-origin {
    font-size: 0.85em;
    opacity: 0.55;
  }
`;

// Ticket 67 (UI-REFACTOR.md §6.1, §6.2): the Skeleton settings tab, in the
// right sidebar. It holds the generator setting Delete collapsing points and
// the master-wide source defaults: the width presets, the serif presets and
// the default caps. The defaults used to be hosted in the Metrics panel.
export default class SkeletonSettingsPanel extends Panel {
  identifier = "skeleton-settings";
  iconPath = "/tabler-icons/bone.svg";

  constructor(editorController) {
    super(editorController);
    this._customDeleteConfirm = null;
    // Only one preset shows its fields at a time. Twenty numbers per preset
    // makes an all-open list unreadable.
    this._expandedSerifPreset = null;
    this.infoForm = new Form();
    // Delete collapsing points is a labeled toggle standing alone
    // (UI-NOMENCLATURE.md §14.1), with its warning under it while it is on.
    this.dropDeadPointsToggle = html.createDomElement("labeled-toggle", {
      label: translate("sidebar.skeleton-parameters.drop-dead-points"),
    });
    this.dropDeadPointsToggle.addEventListener("change", () =>
      this._setDropDeadPoints(this.dropDeadPointsToggle.checked)
    );
    this.dropDeadPointsWarning = html.div({ style: "opacity: 0.7;" }, [
      translate("sidebar.skeleton-parameters.drop-dead-points.warning"),
    ]);
    // Ticket 68: the width presets table, built once and refilled on update.
    this._appendStyle(SKELETON_SETTINGS_STYLES);
    this.widthPresetTable = html.createDomElement("data-table");
    this.widthPresetTable.tableClassName = "skeleton-presets-table";
    this.widthPresetTable.columns = [
      { label: translate("sidebar.skeleton-settings.column.name") },
      { label: translate("sidebar.skeleton-settings.column.width") },
      { label: translate("sidebar.skeleton-settings.column.side") },
      { label: "" },
    ];
    // Ticket 69: the table's filters. Every master and case shows until one is
    // picked.
    this._widthPresetFilter = { master: null, case: null };
    this.widthPresetFilters = this._makePresetFilterBar(this._widthPresetFilter, () =>
      this._renderWidthPresetRows()
    );
    this.widthPresetsSection = html.div({ class: "skeleton-settings-section" }, [
      html.div({ class: "skeleton-settings-heading-row" }, [
        html.div({ class: "skeleton-settings-heading" }, [
          translate("sidebar.skeleton-settings.width-presets"),
        ]),
        this.widthPresetFilters.element,
      ]),
      this.widthPresetTable,
      // Ticket 70: New preset adds a row in the filtered master and case;
      // Preset from selection stores the selection's total and projection.
      html.div({ class: "skeleton-settings-filters" }, [
        html.button({ onclick: () => this._addWidthPreset(null) }, [
          translate("sidebar.skeleton-settings.new-preset"),
        ]),
        (this.widthPresetFromSelectionButton = html.button(
          {
            onclick: () => {
              const captured = this._captureSelectionWidthPreset();
              if (captured) {
                this._addWidthPreset(captured);
              }
            },
          },
          [translate("sidebar.skeleton-settings.preset-from-selection")]
        )),
      ]),
    ]);
    this.contentElement.appendChild(
      html.div(
        { class: "panel-section panel-section--flex panel-section--scrollable" },
        [
          html.div(
            {
              style:
                "display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 0.75rem;",
            },
            [this.dropDeadPointsToggle, this.dropDeadPointsWarning]
          ),
          this.widthPresetsSection,
          this.infoForm,
        ]
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
    // A selection change only decides whether there is anything to capture,
    // so it refreshes that button and leaves the tables alone.
    this.sceneSettingsController.addKeyListener("selection", () =>
      this._refreshFromSelectionButtons()
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

  // Writes to one master: the edited one, unless a caller names another. The
  // preset tables list every master, so a row writes to its own.
  async _persistSourceDefaults(values, undoLabel, targetSourceId = null) {
    if (this.fontController.readOnly) {
      return;
    }
    const sourceId = targetSourceId ?? this._getEffectiveSource().sourceId;
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

  // The setting lives with the master, because the outline it changes is
  // written into the master's glyphs. It applies to every outline the
  // generator writes, not to the points that happen to be selected.
  async _setDropDeadPoints(on) {
    await this._persistSourceDefaults(
      { [SKELETON_SOURCE_DEFAULT_KEYS.SERIF_REMOVE_COLLAPSED]: on === true },
      translate("sidebar.skeleton-parameters.undo.set-defaults")
    );
    this.dropDeadPointsWarning.hidden = on !== true;
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

  async _refreshDesignspacePanel() {
    const panel = this.editorController.getSidebarPanel?.("designspace-navigation");
    if (panel?.refreshSourcesAndStatus) {
      await panel.refreshSourcesAndStatus();
    }
  }

  // ---- Width presets table (ticket 68) ----------------------------------------
  // One table for every master and every case (§6.3). Each master stores its
  // own list; a row is one entry of one master's list and writes back to that
  // master. Base, Horizontal and Contrast are ordinary rows under those names.

  // One master's preset list, as a copy to edit.
  _sourcePresetList(sourceId, key) {
    const source = this.fontController.sources?.[sourceId];
    const list = source ? getSourceSkeletonDefaultsValue(source, key, []) : [];
    return Array.isArray(list) ? list.map((item) => ({ ...item })) : [];
  }

  async _writeWidthPresets(sourceId, next) {
    this._customDeleteConfirm = null;
    await this._persistSourceDefaults(
      { [SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_PRESETS]: next },
      translate("sidebar.skeleton-parameters.undo.set-defaults"),
      sourceId
    );
    await this.update();
  }

  async _editWidthPreset(sourceId, index, patch) {
    const next = this._sourcePresetList(
      sourceId,
      SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_PRESETS
    );
    const previous = next[index];
    if (!previous) {
      return;
    }
    next[index] = { ...previous, ...patch };
    await this._writeWidthPresets(sourceId, next);
    // Rib widths can follow the master width as mw+offset (1.3), so a Base
    // width changed on the edited master offers to recalculate them, as the
    // Base field did.
    const delta = Number(next[index].width) - Number(previous.width);
    if (
      "width" in patch &&
      previous.name === "Base" &&
      previous.side === "both" &&
      sourceId === this._getEffectiveSource().sourceId &&
      Number.isFinite(delta) &&
      delta !== 0
    ) {
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
        await this._recalculateRibWidths(previous.case, delta);
      }
    }
  }

  // The skeleton selection of the edited layer, the way the Selection panel
  // reads it: the edit layer's ids are the canonical ones (WS-9).
  _currentSkeletonPanelSelection() {
    const positionedGlyph =
      this.sceneController.sceneModel?.getSelectedPositionedGlyph?.() || null;
    if (!positionedGlyph) {
      return null;
    }
    const editLayerName =
      this.sceneSettingsController.model?.editLayerName ||
      positionedGlyph.glyph?.layerName;
    const layerGlyph =
      (editLayerName &&
        positionedGlyph.varGlyph?.glyph?.layers?.[editLayerName]?.glyph) ||
      positionedGlyph.glyph;
    const skeletonData = getSkeletonData(layerGlyph);
    return skeletonData
      ? collectSkeletonPanelSelection({
          selection: this.sceneController.selection,
          skeletonData,
        })
      : null;
  }

  _captureSelectionWidthPreset() {
    const panelSelection = this._currentSkeletonPanelSelection();
    return panelSelection ? captureSelectionWidthPreset(panelSelection) : null;
  }

  _refreshFromSelectionButtons() {
    if (this.widthPresetFromSelectionButton) {
      this.widthPresetFromSelectionButton.disabled =
        !!this.fontController?.readOnly || !this._captureSelectionWidthPreset();
    }
  }

  // One new row, in the filtered master and case, or the edited glyph's where
  // a filter shows all. `captured` carries a selection's width and side.
  async _addWidthPreset(captured) {
    const sourceId =
      this._widthPresetFilter.master ?? this._getEffectiveSource().sourceId;
    if (!sourceId) {
      return;
    }
    const glyphCase =
      this._widthPresetFilter.case ??
      getSkeletonGlyphCase(this.sceneController.sceneSettings?.selectedGlyphName);
    const next = this._sourcePresetList(
      sourceId,
      SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_PRESETS
    );
    const count = next.filter((preset) => preset.case === glyphCase).length;
    next.push({
      name: `${translate("sidebar.skeleton-parameters.width-preset")} ${count + 1}`,
      width: captured?.width ?? DEFAULT_SKELETON_WIDTH,
      side: captured?.side ?? "both",
      case: glyphCase,
    });
    await this._writeWidthPresets(sourceId, next);
  }

  // The trash takes two presses: the first arms it, the second deletes.
  async _deleteWidthPreset(sourceId, index, rowId) {
    if (this._customDeleteConfirm !== rowId) {
      this._customDeleteConfirm = rowId;
      this._renderWidthPresetRows();
      return;
    }
    const next = this._sourcePresetList(
      sourceId,
      SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_PRESETS
    );
    if (!next[index]) {
      return;
    }
    next.splice(index, 1);
    await this._writeWidthPresets(sourceId, next);
  }

  // A table header's filters (§6.5): Current, then a Master and a Case
  // dropdown, each single-choice with All first. `state` holds the picked
  // master id and case, null for All. Current sets both to the edited glyph's
  // master and case. `refresh` redraws the dropdowns from `state`.
  _makePresetFilterBar(state, onChange) {
    const ALL = "*";
    const dropdown = (field) => {
      const element = html.createDomElement("multi-select-dropdown");
      element.singleChoice = true;
      element.addEventListener("change", (event) => {
        const [value] = [].concat(event.detail.checked);
        state[field] = value == null || value === ALL ? null : value;
        onChange();
      });
      return element;
    };
    const master = dropdown("master");
    const glyphCase = dropdown("case");
    const current = html.button(
      {
        onclick: () => {
          state.master = this._getEffectiveSource().sourceId ?? null;
          state.case = getSkeletonGlyphCase(
            this.sceneController.sceneSettings?.selectedGlyphName
          );
          onChange();
        },
      },
      [translate("sidebar.skeleton-settings.filter.current")]
    );
    const option = (value, label, picked) => ({ value, label, checked: picked });
    const refresh = () => {
      const sources = Object.entries(this.fontController.sources || {});
      master.items = [
        option(ALL, translate("sidebar.skeleton-settings.filter.all"), !state.master),
        ...sources.map(([id, source]) =>
          option(id, source.name || id, state.master === id)
        ),
      ];
      const pickedSource = state.master && this.fontController.sources?.[state.master];
      master.label = pickedSource
        ? pickedSource.name || state.master
        : translate("sidebar.skeleton-settings.filter.master");
      glyphCase.items = [
        option(ALL, translate("sidebar.skeleton-settings.filter.all"), !state.case),
        ...["uppercase", "lowercase"].map((value) =>
          option(
            value,
            translate(`sidebar.skeleton-settings.case.${value}`),
            state.case === value
          )
        ),
      ];
      glyphCase.label = state.case
        ? translate(`sidebar.skeleton-settings.case.${state.case}`)
        : translate("sidebar.skeleton-settings.filter.case");
    };
    return {
      element: html.div({ class: "skeleton-settings-filters" }, [
        current,
        master,
        glyphCase,
      ]),
      refresh,
      matches: (sourceId, presetCase) =>
        (!state.master || state.master === sourceId) &&
        (!state.case || state.case === presetCase),
    };
  }

  _renderWidthPresetRows() {
    const tbody = this.widthPresetTable.tbody;
    tbody.innerHTML = "";
    this.widthPresetFilters.refresh();
    this._refreshFromSelectionButtons();
    const readOnly = !!this.fontController.readOnly;
    for (const [sourceId, source] of Object.entries(
      this.fontController.sources || {}
    )) {
      const list = this._sourcePresetList(
        sourceId,
        SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_PRESETS
      );
      list.forEach((preset, index) => {
        if (!this.widthPresetFilters.matches(sourceId, preset.case)) {
          return;
        }
        const rowId = `${sourceId}:${index}`;
        const nameInput = html.input({
          type: "text",
          value: preset.name || "",
          disabled: readOnly,
          onchange: (event) =>
            this._editWidthPreset(sourceId, index, {
              name: String(event.target.value ?? ""),
            }),
        });
        const widthInput = html.input({
          type: "number",
          value: Number(preset.width) || 0,
          disabled: readOnly,
          onchange: (event) => {
            const numeric = Number(event.target.value);
            this._editWidthPreset(sourceId, index, {
              width: Number.isFinite(numeric) ? numeric : 0,
            });
          },
        });
        const sideSelect = html.select(
          {
            disabled: readOnly,
            onchange: (event) =>
              this._editWidthPreset(sourceId, index, { side: event.target.value }),
          },
          ["both", "left", "right"].map((side) =>
            html.option({ value: side, selected: preset.side === side }, [
              translate(`sidebar.skeleton-settings.side.${side}`),
            ])
          )
        );
        const confirming = this._customDeleteConfirm === rowId;
        const trash = html.createDomElement("icon-button", {
          "src": confirming ? "/tabler-icons/x.svg" : "/tabler-icons/trash.svg",
          "data-tooltip": translate(
            confirming
              ? "sidebar.skeleton-parameters.custom-widths.confirm-delete"
              : "sidebar.skeleton-parameters.custom-widths.delete"
          ),
          "data-tooltipposition": "left",
        });
        trash.disabled = readOnly;
        trash.onclick = () => this._deleteWidthPreset(sourceId, index, rowId);
        tbody.appendChild(
          html.createDomElement("tr", { "data-row-id": rowId }, [
            html.td({}, [
              nameInput,
              html.div({ class: "preset-origin" }, [
                `${source.name || sourceId} · ${translate(
                  `sidebar.skeleton-settings.case.${preset.case}`
                )}`,
              ]),
            ]),
            html.td({}, [widthInput]),
            html.td({}, [sideSelect]),
            html.td({}, [trash]),
          ])
        );
      });
    }
  }

  // ---- Serif presets --------------------------------------------------------

  // One named terminal shape per entry, held in the master. Same storage shape
  // as the custom width list; the interface differs because a width preset is
  // one number and a serif is twenty.
  _getSerifPresetList() {
    const list = this._sourceDefault(SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_SERIFS);
    if (!Array.isArray(list)) {
      return [];
    }
    // Read through the model's normalizer, so an old one-wing preset and a
    // whole-terminal one arrive in the same shape.
    return list
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const { type, case: _case, ...preset } = normalizeTerminalPreset("serif", item);
        return preset;
      });
  }

  async _persistSerifPresets(next) {
    await this._persistSourceDefaults(
      { [SKELETON_SOURCE_DEFAULT_KEYS.CUSTOM_SERIFS]: next },
      translate("sidebar.skeleton-parameters.undo.set-defaults")
    );
    await this.update();
  }

  _buildSerifPresetRows(formContents) {
    const list = this._getSerifPresetList();
    list.forEach((item, index) => {
      const rowId = `serifPreset:${index}`;
      const isConfirming = this._customDeleteConfirm === rowId;
      const isExpanded = this._expandedSerifPreset === index;
      const nameInput = html.input({
        type: "text",
        value: item.name,
        style: "width: 7em;",
        onchange: async (event) => {
          const next = this._getSerifPresetList();
          if (!next[index]) {
            return;
          }
          next[index] = { ...next[index], name: String(event.target.value ?? "") };
          this._customDeleteConfirm = null;
          await this._persistSerifPresets(next);
        },
      });
      const expandButton = html.createDomElement("icon-button", {
        "src": isExpanded
          ? "/tabler-icons/chevron-up.svg"
          : "/tabler-icons/chevron-right.svg",
        "style": "width: 1.1em; height: 1.1em;",
        "data-tooltip": translate("sidebar.skeleton-parameters.serif-presets.edit"),
        "data-tooltipposition": "left",
        "onclick": async () => {
          this._expandedSerifPreset = isExpanded ? null : index;
          this._customDeleteConfirm = null;
          await this.update();
        },
      });
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
          const next = this._getSerifPresetList();
          if (!next[index]) {
            return;
          }
          next.splice(index, 1);
          this._customDeleteConfirm = null;
          this._expandedSerifPreset = null;
          await this._persistSerifPresets(next);
        },
      });
      formContents.push({
        type: "single-icon",
        element: html.div({ style: "display:flex; gap:0.35rem; align-items:center;" }, [
          expandButton,
          nameInput,
          deleteButton,
        ]),
      });
      if (isExpanded) {
        this._pushSerifPresetFields(formContents, index, item);
      }
    });
    formContents.push({
      type: "single-icon",
      element: html.div({}, [
        html.button(
          {
            onclick: async () => {
              const next = this._getSerifPresetList();
              next.push(makeSerifPreset(`Serif ${next.length + 1}`));
              this._customDeleteConfirm = null;
              this._expandedSerifPreset = next.length - 1;
              await this._persistSerifPresets(next);
            },
          },
          [translate("sidebar.skeleton-parameters.custom-widths.add")]
        ),
      ]),
    });
  }

  // The same grouping the parameters panel uses, so one shape reads the same
  // way whether it is drawn on a glyph or stored in the master.
  _pushSerifPresetFields(formContents, index, preset) {
    const groups = [
      ["serif-group-wing", ["wingLength", "tipThickness", "wingSlope", "tipCutAngle"]],
      ["serif-group-bracket", ["reach", "tension", "concavity"]],
      ["serif-group-easing", ["easeDistance", "easeCurvature"]],
    ];
    for (const [groupKey, fields] of groups) {
      formContents.push({
        type: "text",
        value: translate(`sidebar.skeleton-parameters.${groupKey}`),
      });
      for (const field of fields) {
        formContents.push({
          type: "edit-number",
          key: `serifPreset:${index}:${field}`,
          label: translate(`sidebar.skeleton-parameters.${SERIF_FIELD_LABELS[field]}`),
          // This editor shows one wing, the left; a field typed here writes
          // both halves.
          value: preset.left[field],
        });
      }
    }
    formContents.push({
      type: "edit-number",
      key: `serifPreset:${index}:undersideCup`,
      label: translate("sidebar.skeleton-parameters.serif-underside-cup"),
      value: preset.undersideCup,
    });
  }

  async _onSerifPresetFieldChange(index, field, value) {
    const next = this._getSerifPresetList();
    if (!next[index]) {
      return;
    }
    const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
    const preset = next[index];
    next[index] =
      SERIF_PRESET_FIELDS.includes(field) && field in preset.left
        ? {
            ...preset,
            left: { ...preset.left, [field]: numeric },
            right: { ...preset.right, [field]: numeric },
          }
        : { ...preset, [field]: numeric };
    await this._persistSerifPresets(next);
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

    const K = SKELETON_SOURCE_DEFAULT_KEYS;

    const dropDeadPoints = this._sourceDefault(K.SERIF_REMOVE_COLLAPSED) === true;
    this.dropDeadPointsToggle.checked = dropDeadPoints;
    this.dropDeadPointsToggle.disabled = !!this.fontController.readOnly;
    this.dropDeadPointsWarning.hidden = !dropDeadPoints;

    this._renderWidthPresetRows();

    const formContents = [
      {
        type: "header",
        label: translate("sidebar.skeleton-parameters.serif-presets"),
      },
    ];
    this._buildSerifPresetRows(formContents);
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
      const [group, name, field] = String(fieldItem.key).split(":");
      if (group === "serifPreset") {
        await this._onSerifPresetFieldChange(Number(name), field, value);
        return;
      }
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
      const oldValue = this._sourceDefault(name);
      const storedValue =
        CAP_DISPLAY_CONVERTERS[name]?.fromDisplay(finalValue) ?? finalValue;
      await this._persistSourceDefaults(
        { [name]: storedValue },
        translate("sidebar.skeleton-parameters.undo.set-defaults")
      );
      await this.update();
    };
  }
}

customElements.define("panel-skeleton-settings", SkeletonSettingsPanel);

import { applicationSettingsController } from "@fontra/core/application-settings.js";
import { recordChanges } from "@fontra/core/change-recorder.js";
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { MAX_TIP_CUT_ANGLE } from "@fontra/core/serif-geometry.js";
import {
  DEFAULT_SERIF_PRESET,
  DEFAULT_SKELETON_WIDTH,
  SKELETON_SOURCE_DEFAULT_FALLBACKS,
  SKELETON_SOURCE_DEFAULT_KEYS,
  getSkeletonData,
  getSkeletonGlyphCase,
  getSkeletonPointWidth,
  getSourceSkeletonDefaultsValue,
  getTerminalPresetFields,
  getTerminalPresetSourceKey,
  normalizeTerminalPreset,
  setSkeletonPointTotalWidth,
  setSourceSkeletonDefaultsValues,
} from "@fontra/core/skeleton-model.js";
import {
  actionsCell,
  editableCell,
  rowAction,
  selectCell,
  tableCell,
  tableRow,
} from "@fontra/web-components/data-table.js"; // for <data-table>, ticket 68
import "@fontra/web-components/labeled-toggle.js"; // for <labeled-toggle>, ticket 67
import "@fontra/web-components/text-button.js";
import "@fontra/web-components/multi-select-dropdown.js"; // for <multi-select-dropdown>, ticket 69
import "@fontra/web-components/chain-link.js"; // for <chain-link>, ticket 74
import "@fontra/web-components/input-field-large.js"; // for <input-field-large>, ticket 74
import "@fontra/web-components/segmented-control.js"; // for <segmented-control>, ticket 74
import { dialog, dialogSetup } from "@fontra/web-components/modal-dialog.js";
import {
  CAP_ANGLE_MAX,
  CAP_ANGLE_MIN,
  CAP_BALL_EASING_MAX,
  CAP_BALL_MAX,
  CAP_BALL_MIN,
  CAP_RADIUS_POSITIONS,
  CAP_SHAPE_MAX,
  CAP_SHAPE_MIN,
  SERIF_FIELD_GROUPS,
  SERIF_PERCENT_FIELD_BOUNDS,
  TERMINAL_FIELD_FALLBACKS,
  capRadiusIndexFromRatio,
  capRadiusRatioFromIndex,
} from "./panel-skeleton-parameters.js";
import Panel from "./panel.js";
import { editSkeleton } from "./skeleton-editing.js";
import {
  setPanelContourSingleSided,
  setPanelPointWidthPreset,
  setPanelTerminalPreset,
} from "./skeleton-panel-edits.js";
import {
  captureSelectionTerminalPreset,
  captureSelectionWidthPreset,
  collectSkeletonPanelSelection,
  collectWidthEditPoints,
  summarizeSkeletonContourSelection,
} from "./skeleton-panel-model.js";

// The terminal kinds with fields, in the order the Terminal section's kind
// picker shows them. Flat has no fields and so no presets.
const TERMINAL_PRESET_KINDS = ["square", "round", "drop", "serif"];

const SKELETON_SETTINGS_STYLES = `
  .presets-card,
  .preset-tab {
    gap: 12px;
  }

  .preset-tab {
    display: flex;
    flex-direction: column;
  }

  .preset-tab[hidden] {
    display: none;
  }

  .preset-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .preset-heading-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .preset-heading-row > .button-row {
    gap: 4px;
  }

  /* Current sits 8px before the dropdowns. */
  .preset-heading-row > .button-row > .button-row {
    padding-right: 8px;
  }
`;

// Ticket 67 (UI-REFACTOR.md §6.1, §6.2): the Skeleton settings tab, in the
// right sidebar. It holds the generator setting Delete collapsing points and
// the master-wide source defaults: the width and terminal presets. The
// defaults used to be hosted in the Metrics panel.
// button/text, size S (Figma 414:31310).
function textKey(label, onClick) {
  return html.createDomElement("text-button", { label, size: "S", onclick: onClick });
}

export default class SkeletonSettingsPanel extends Panel {
  identifier = "skeleton-settings";
  iconPath = "/tabler-icons/bone.svg";

  constructor(editorController) {
    super(editorController);
    this._customDeleteConfirm = null;
    // Delete collapsing points is a labeled toggle standing alone
    // (UI-NOMENCLATURE.md §14.1), with its warning under it while it is on.
    this.dropDeadPointsToggle = html.createDomElement("labeled-toggle", {
      label: translate("sidebar.skeleton-parameters.drop-dead-points"),
    });
    this.dropDeadPointsToggle.addEventListener("change", () =>
      this._setDropDeadPoints(this.dropDeadPointsToggle.checked)
    );
    // Shift+Z's mode: turn the handle's angle only, or angle and length. An
    // application setting; each drag writes it into the handle it turns.
    this.handTurnAngleOnlyToggle = html.createDomElement("labeled-toggle", {
      label: translate("sidebar.skeleton-settings.hand-turn-angle-only"),
    });
    this.handTurnAngleOnlyToggle.checked =
      applicationSettingsController.model.skeletonHandTurnKeepsLength === true;
    this.handTurnAngleOnlyToggle.addEventListener("change", () => {
      applicationSettingsController.model.skeletonHandTurnKeepsLength =
        this.handTurnAngleOnlyToggle.checked;
    });
    this.dropDeadPointsWarning = html.div({ style: "opacity: 0.7;" }, [
      translate("sidebar.skeleton-parameters.drop-dead-points.warning"),
    ]);
    // Simplify and harmonize serif easings: its own toggle, beside Delete
    // collapsing points and independent of it, with the same warning, because
    // it too removes points.
    this.simplifyEasingToggle = html.createDomElement("labeled-toggle", {
      label: translate("sidebar.skeleton-parameters.simplify-easing"),
    });
    this.simplifyEasingToggle.addEventListener("change", () =>
      this._setMasterOutlineOption(
        SKELETON_SOURCE_DEFAULT_KEYS.SERIF_SIMPLIFY_EASING,
        this.simplifyEasingToggle.checked
      )
    );
    this.simplifyEasingWarning = html.div({ style: "opacity: 0.7;" }, [
      translate("sidebar.skeleton-parameters.drop-dead-points.warning"),
    ]);
    // PRESETS (Figma 4109:3396): the width and terminal presets, each a heading with its filters over a table and its
    // two buttons. The Grid tab (Figma 4129:3638) has no backend yet; it is
    // shown and disabled.
    this._appendStyle(SKELETON_SETTINGS_STYLES);
    const presetTable = (columns, storageKey) => {
      const table = html.createDomElement("data-table");
      // table, look "select" (Figma 4109:3669).
      table.look = "select";
      table.columns = columns;
      table.resizable = true;
      table.minHeight = 48;
      table.style.setProperty("--data-table-height", "110px");
      table.heightStorageKey = storageKey;
      return table;
    };
    const presetSection = (title, filters, table, buttons) =>
      html.div({ class: "preset-section" }, [
        html.div({ class: "preset-heading-row" }, [
          html.div({ class: "card-subheading" }, [title]),
          filters,
        ]),
        table,
        html.div({ class: "button-row" }, buttons),
      ]);

    // Ticket 68: the width presets table, built once and refilled on update.
    this.widthPresetTable = presetTable(
      [
        { label: translate("sidebar.skeleton-settings.column.name") },
        { label: translate("sidebar.skeleton-settings.column.width") },
        { label: translate("sidebar.skeleton-settings.column.side") },
        { label: "" },
      ],
      "fontra-skeleton-width-presets-height"
    );
    // Ticket 69: the table's filters. Every master and case shows until one is
    // picked.
    this._widthPresetFilter = { master: null, case: null };
    this.widthPresetFilters = this._makePresetFilterBar(this._widthPresetFilter, () =>
      this._renderWidthPresetRows()
    );
    // Ticket 70: New preset adds a row in the filtered master and case;
    // Preset from selection stores the selection's total and projection.
    this.widthPresetFromSelectionButton = textKey("create from selection", () => {
      const captured = this._captureSelectionWidthPreset();
      if (captured) {
        this._addWidthPreset(captured);
      }
    });
    this.widthPresetsSection = presetSection(
      "width",
      this.widthPresetFilters.element,
      this.widthPresetTable,
      [
        textKey("new preset", () => this._addWidthPreset(null)),
        this.widthPresetFromSelectionButton,
      ]
    );
    // Ticket 71: the terminal presets table, every kind with fields, every
    // master, built once and refilled on update.
    this.terminalPresetTable = presetTable(
      [
        { label: translate("sidebar.skeleton-settings.column.type") },
        { label: translate("sidebar.skeleton-settings.column.name") },
        { label: "" },
      ],
      "fontra-skeleton-terminal-presets-height"
    );
    this._terminalPresetFilter = { master: null, case: null, type: null };
    this.terminalPresetFilters = this._makePresetFilterBar(
      this._terminalPresetFilter,
      () => this._renderTerminalPresetRows()
    );
    // Ticket 73: New preset adds a row of the filtered kind, master and case;
    // Preset from selection stores the selected terminal's kind and shape.
    this.terminalPresetFromSelectionButton = textKey("create from selection", () => {
      const captured = this._captureSelectionTerminalPreset();
      if (captured) {
        this._addTerminalPreset(captured);
      }
    });
    this.terminalPresetsSection = presetSection(
      "terminal",
      this.terminalPresetFilters.element,
      this.terminalPresetTable,
      [
        textKey("new preset", () => this._addTerminalPreset(null)),
        this.terminalPresetFromSelectionButton,
      ]
    );

    // Grid presets (Figma 4129:3638): no backend yet.
    const gridTable = presetTable(
      [{ label: "name" }, { label: "primary" }, { label: "secondary" }, { label: "" }],
      "fontra-grid-presets-height"
    );
    const disabledKey = (label) => {
      const button = textKey(label, () => {});
      button.disabled = true;
      return button;
    };
    const gridSection = presetSection("grid", html.div(), gridTable, [
      disabledKey("new preset"),
      disabledKey("create from selection"),
    ]);
    gridSection.hidden = true;

    // The pen's width is the skeleton pen's own setting, in the canvas
    // corner while the pen is out (edit-tools-skeleton.js).
    const skeletonTab = html.div({ class: "preset-tab" }, [
      this.widthPresetsSection,
      this.terminalPresetsSection,
    ]);
    const tabs = html.createDomElement("segmented-control", {
      options: [
        { value: "skeleton", label: "Skeleton" },
        { value: "grid", label: "Grid" },
      ],
      value: "skeleton",
    });
    tabs.setAttribute("small", "");
    tabs.addEventListener("change", (event) => {
      skeletonTab.hidden = event.detail.value !== "skeleton";
      gridSection.hidden = event.detail.value !== "grid";
    });

    this.contentElement.appendChild(
      html.div({ class: "panel-section--flex card-column" }, [
        html.div({ class: "card card--headed presets-card" }, [
          html.div({ class: "card-heading-row" }, [
            html.div({ class: "card-heading" }, ["presets"]),
            tabs,
          ]),
          skeletonTab,
          gridSection,
        ]),
        // The generator's settings; not in the presets design, so they keep
        // their own card.
        html.div({ class: "card card--headed" }, [
          html.div({ class: "card-heading-row" }, [
            html.div({ class: "card-heading" }, ["settings"]),
          ]),
          this.dropDeadPointsToggle,
          this.dropDeadPointsWarning,
          this.simplifyEasingToggle,
          this.simplifyEasingWarning,
          this.handTurnAngleOnlyToggle,
        ]),
      ])
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
    await this._setMasterOutlineOption(
      SKELETON_SOURCE_DEFAULT_KEYS.SERIF_REMOVE_COLLAPSED,
      on
    );
  }

  // Both master outline options go through here: store the setting, show or
  // hide its warning, and regenerate the open glyph so it takes effect.
  async _setMasterOutlineOption(key, on) {
    await this._persistSourceDefaults(
      { [key]: on === true },
      translate("sidebar.skeleton-parameters.undo.set-defaults")
    );
    const warning =
      key === SKELETON_SOURCE_DEFAULT_KEYS.SERIF_SIMPLIFY_EASING
        ? this.simplifyEasingWarning
        : this.dropDeadPointsWarning;
    warning.hidden = on !== true;
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

  _captureSelectionTerminalPreset() {
    return captureSelectionTerminalPreset(
      this._currentSkeletonPanelSelection(),
      TERMINAL_FIELD_FALLBACKS
    );
  }

  _refreshFromSelectionButtons() {
    const readOnly = !!this.fontController?.readOnly;
    if (this.widthPresetFromSelectionButton) {
      this.widthPresetFromSelectionButton.disabled =
        readOnly || !this._captureSelectionWidthPreset();
    }
    if (this.terminalPresetFromSelectionButton) {
      this.terminalPresetFromSelectionButton.disabled =
        readOnly || !this._captureSelectionTerminalPreset();
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
  // master and case. While any filter is set the button reads Reset, and a
  // press clears them all. `refresh` redraws the dropdowns from `state`.
  _makePresetFilterBar(state, onChange, { withType = false } = {}) {
    const ALL = "*";
    const dropdown = (field) => {
      const element = html.createDomElement("multi-select-dropdown");
      element.singleChoice = true;
      // Figma 4109:3960: 92px wide, 20px high.
      element.style.setProperty("--multi-select-dropdown-width", "92px");
      element.style.setProperty("--multi-select-dropdown-height", "20px");
      element.addEventListener("change", (event) => {
        const [value] = [].concat(event.detail.checked);
        state[field] = value == null || value === ALL ? null : value;
        onChange();
      });
      return element;
    };
    const master = dropdown("master");
    const glyphCase = dropdown("case");
    // Ticket 72: the terminal table adds a Type dropdown.
    const type = withType ? dropdown("type") : null;
    // Current (Figma 4109:3917): a toggle, on while the filters are the edited
    // glyph's master and case. Picking a filter by hand turns it off.
    const currentFilter = () => ({
      master: this._getEffectiveSource().sourceId ?? null,
      case: getSkeletonGlyphCase(this.sceneController.sceneSettings?.selectedGlyphName),
    });
    const currentToggle = html.createDomElement("labeled-toggle");
    currentToggle.addEventListener("change", () => {
      const target = currentToggle.checked
        ? currentFilter()
        : { master: null, case: null };
      state.master = target.master;
      state.case = target.case;
      if (withType) {
        state.type = null;
      }
      onChange();
    });
    const current = html.div({ class: "button-row" }, [
      html.span({ class: "field-label" }, [
        translate("sidebar.skeleton-settings.filter.current"),
      ]),
      currentToggle,
    ]);
    // "All" leaves the dropdown reading as its field name (Master, Case, Type).
    const option = (value, label, picked) => ({
      value,
      label,
      checked: picked,
      showsLabel: value === ALL,
    });
    // The filters start on Current: the first refresh that knows the edited
    // source sets the master and case, once.
    let seeded = false;
    const refresh = () => {
      if (!seeded) {
        const sourceId = this._getEffectiveSource()?.sourceId;
        if (sourceId) {
          seeded = true;
          state.master = sourceId;
          state.case = getSkeletonGlyphCase(
            this.sceneController.sceneSettings?.selectedGlyphName
          );
        }
      }
      const target = currentFilter();
      currentToggle.checked =
        state.master === target.master && state.case === target.case && !state.type;
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
      if (type) {
        type.items = [
          option(ALL, translate("sidebar.skeleton-settings.filter.all"), !state.type),
          ...TERMINAL_PRESET_KINDS.map((kind) =>
            option(
              kind,
              translate(`sidebar.skeleton-parameters.cap-style.${kind}`),
              state.type === kind
            )
          ),
        ];
        type.label = state.type
          ? translate(`sidebar.skeleton-parameters.cap-style.${state.type}`)
          : translate("sidebar.skeleton-settings.filter.type");
      }
    };
    return {
      element: html.div({ class: "button-row" }, [
        current,
        ...(type ? [type] : []),
        master,
        glyphCase,
      ]),
      refresh,
      matches: (sourceId, presetCase, presetType) =>
        (!state.master || state.master === sourceId) &&
        (!state.case || state.case === presetCase) &&
        (!state.type || state.type === presetType),
    };
  }

  _renderWidthPresetRows() {
    this.widthPresetFilters.refresh();
    this._refreshFromSelectionButtons();
    const readOnly = !!this.fontController.readOnly;
    const captured = this._captureSelectionWidthPreset();
    const items = [];
    for (const [sourceId, source] of Object.entries(
      this.fontController.sources || {}
    )) {
      const list = this._sourcePresetList(
        sourceId,
        SKELETON_SOURCE_DEFAULT_KEYS.WIDTH_PRESETS
      );
      list.forEach((preset, index) => {
        if (this.widthPresetFilters.matches(sourceId, preset.case)) {
          items.push({
            rowId: `${sourceId}:${index}`,
            sourceId,
            source,
            preset,
            index,
          });
        }
      });
    }
    this.widthPresetTable.setRows(
      items,
      ({ rowId, sourceId, source, preset, index }) =>
        tableRow(
          rowId,
          [
            tableCell([
              editableCell({
                value: preset.name || "",
                disabled: readOnly,
                onCommit: (name) => this._editWidthPreset(sourceId, index, { name }),
              }),
            ]),
            tableCell(
              editableCell({
                type: "number",
                value: Number(preset.width) || 0,
                disabled: readOnly,
                className: "preset-width",
                onCommit: (width) => this._editWidthPreset(sourceId, index, { width }),
              }),
              { align: "right" }
            ),
            tableCell(
              selectCell({
                value: preset.side,
                disabled: readOnly,
                options: ["both", "left", "right"].map((side) => ({
                  value: side,
                  label: translate(`sidebar.skeleton-settings.side.${side}`),
                })),
                onChange: (side) => this._editWidthPreset(sourceId, index, { side }),
              })
            ),
            actionsCell([
              this._presetApplyAction(readOnly, () => this._applyWidthPreset(preset)),
              this._presetUpdateAction(readOnly || !captured, () =>
                this._editWidthPreset(sourceId, index, {
                  width: captured.width,
                  side: captured.side,
                })
              ),
              this._presetDeleteAction(rowId, readOnly, () =>
                this._deleteWidthPreset(sourceId, index, rowId)
              ),
            ]),
          ],
          { title: this._presetOrigin(source, sourceId, preset) }
        ),
      { rowId: (item) => item.rowId }
    );
  }

  // Apply writes the row's preset to the selected skeleton points, as picking
  // it in the Selection tab does. With nothing selected it does nothing.
  _presetApplyAction(readOnly, onClick) {
    return rowAction({
      src: "/tabler-icons/check.svg",
      tooltip: translate("sidebar.skeleton-settings.apply"),
      tooltipPosition: "left",
      disabled: readOnly,
      onClick,
    });
  }

  // Update rewrites the row's values from the selection, keeping its name.
  _presetUpdateAction(disabled, onClick) {
    return rowAction({
      src: "/tabler-icons/refresh.svg",
      tooltip: translate("sidebar.skeleton-settings.update-from-selection"),
      tooltipPosition: "left",
      disabled,
      onClick,
    });
  }

  async _applyWidthPreset(preset) {
    const panelSelection = this._currentSkeletonPanelSelection();
    const points = panelSelection ? collectWidthEditPoints(panelSelection) : [];
    if (!points.length) {
      return;
    }
    const contours = panelSelection.contours || [];
    const target =
      preset.side === "left" || preset.side === "right" ? preset.side : null;
    const current = summarizeSkeletonContourSelection(contours).singleSided;
    if (contours.length && (current.mixed || (current.value ?? null) !== target)) {
      const settings = applicationSettingsController.model;
      await setPanelContourSingleSided(
        this.sceneController,
        contours,
        target,
        translate("sidebar.skeleton-parameters.undo.set-single-sided"),
        {
          keepForm: settings.skeletonSideModeKeepsForm === true,
          keepEdits: settings.skeletonSideModeKeepsEdits === true,
          presetWrite: true,
        }
      );
    }
    await setPanelPointWidthPreset(
      this.sceneController,
      points,
      { name: preset.name, width: Number(preset.width), side: preset.side },
      translate("sidebar.skeleton-parameters.undo.set-total-width")
    );
  }

  async _applyTerminalPreset(type, preset) {
    const panelSelection = this._currentSkeletonPanelSelection();
    const points = panelSelection ? collectWidthEditPoints(panelSelection) : [];
    if (!points.length) {
      return;
    }
    await setPanelTerminalPreset(
      this.sceneController,
      points,
      type,
      preset,
      translate("sidebar.skeleton-parameters.undo.set-cap")
    );
  }

  // The source and case a row belongs to, as its tooltip.
  _presetOrigin(source, sourceId, preset) {
    return `${source.name || sourceId} · ${translate(
      `sidebar.skeleton-settings.case.${preset.case}`
    )}`;
  }

  // The trash takes two presses; the armed trash stays visible as a cross.
  _presetDeleteAction(rowId, readOnly, onClick) {
    const confirming = this._customDeleteConfirm === rowId;
    return rowAction({
      src: confirming ? "/tabler-icons/x.svg" : "/tabler-icons/trash.svg",
      tooltip: translate(
        confirming
          ? "sidebar.skeleton-parameters.custom-widths.confirm-delete"
          : "sidebar.skeleton-parameters.custom-widths.delete"
      ),
      tooltipPosition: "left",
      reveal: confirming ? "always" : "dim",
      disabled: readOnly,
      onClick,
    });
  }

  // ---- Terminal presets table (ticket 71) -------------------------------------
  // Square, Rounded, Ball and Serif presets of every master (§6.4). Each kind
  // keeps its own list in each master; a row is one entry of one kind's list
  // and writes back to it.

  // One kind's list in one master, read through the model's normalizer, so an
  // old one-wing serif and a whole-terminal one arrive in the same shape.
  _terminalPresetList(sourceId, type) {
    return this._sourcePresetList(sourceId, getTerminalPresetSourceKey(type)).map(
      (preset) => normalizeTerminalPreset(type, preset)
    );
  }

  async _writeTerminalPresets(sourceId, type, next) {
    this._customDeleteConfirm = null;
    await this._persistSourceDefaults(
      { [getTerminalPresetSourceKey(type)]: next },
      translate("sidebar.skeleton-parameters.undo.set-defaults"),
      sourceId
    );
    await this.update();
  }

  async _editTerminalPreset(sourceId, type, index, patch) {
    const next = this._terminalPresetList(sourceId, type);
    if (!next[index]) {
      return;
    }
    next[index] = normalizeTerminalPreset(type, { ...next[index], ...patch });
    await this._writeTerminalPresets(sourceId, type, next);
  }

  // One new row. A captured preset brings its own kind; otherwise the kind is
  // the filtered one, or Serif where the filter shows all, starting on the
  // shape a fresh terminal of that kind shows. Master and case are the
  // filtered ones, or the edited glyph's.
  async _addTerminalPreset(captured) {
    const type = captured?.type ?? this._terminalPresetFilter.type ?? "serif";
    const sourceId =
      this._terminalPresetFilter.master ?? this._getEffectiveSource().sourceId;
    if (!sourceId) {
      return;
    }
    const glyphCase =
      this._terminalPresetFilter.case ??
      getSkeletonGlyphCase(this.sceneController.sceneSettings?.selectedGlyphName);
    const shape =
      captured?.shape ??
      (type === "serif"
        ? DEFAULT_SERIF_PRESET
        : Object.fromEntries(
            getTerminalPresetFields(type).map((field) => [
              field,
              TERMINAL_FIELD_FALLBACKS[field],
            ])
          ));
    const next = this._terminalPresetList(sourceId, type);
    const count = next.filter((preset) => preset.case === glyphCase).length;
    next.push(
      normalizeTerminalPreset(type, {
        ...shape,
        name: `${translate("sidebar.skeleton-parameters.width-preset")} ${count + 1}`,
        case: glyphCase,
      })
    );
    await this._writeTerminalPresets(sourceId, type, next);
  }

  // Ticket 74: every field of one preset in a modal dialog, built from the
  // Terminal section's own controls. Edits change a working copy; OK writes it
  // back as one step and Cancel drops it. A serif preset holds both halves,
  // every link, the cup and the angle (the 2026-09-14 decision), so its dialog
  // shows all of them; the other kinds show their shape fields only.
  async _editTerminalPresetDialog(sourceId, type, index) {
    const preset = this._terminalPresetList(sourceId, type)[index];
    if (!preset) {
      return;
    }
    const working = structuredClone(preset);
    const presetDialog = await dialogSetup(
      translate("sidebar.skeleton-settings.edit-preset", preset.name || ""),
      null,
      [
        { title: translate("dialog.cancel"), isCancelButton: true },
        { title: translate("dialog.okay"), isDefaultButton: true, resultValue: true },
      ]
    );
    presetDialog.setContent(this._buildTerminalPresetEditor(type, working));
    if (!(await presetDialog.run())) {
      return;
    }
    const next = this._terminalPresetList(sourceId, type);
    if (!next[index]) {
      return;
    }
    next[index] = normalizeTerminalPreset(type, {
      ...working,
      name: next[index].name,
      case: next[index].case,
    });
    await this._writeTerminalPresets(sourceId, type, next);
  }

  _buildTerminalPresetEditor(type, working) {
    const label = (key) => translate(`sidebar.skeleton-parameters.${key}`);
    // One compact scrub field over a stored number. `toDisplay` and
    // `fromDisplay` are the Terminal section's own conversions.
    const field = (
      labelKey,
      value,
      bounds,
      onValue,
      { toDisplay = Math.round, fromDisplay = (v) => v } = {}
    ) => {
      const element = html.createDomElement("input-field-large", {
        label: label(labelKey),
        integer: true,
      });
      element.minValue = bounds.minValue;
      element.maxValue = bounds.maxValue;
      element.value = toDisplay(Number(value) || 0);
      element.style.flex = "1 1 0";
      element.style.minWidth = "0";
      // A drag reports every frame, and an abandoned one reports its start
      // value, so every report is simply the value now.
      element.addEventListener("change", (event) =>
        onValue(fromDisplay(Number(event.detail.value)))
      );
      element._toDisplay = toDisplay;
      return element;
    };
    const percent = {
      toDisplay: (v) => Math.round(v * 100),
      fromDisplay: (v) => v / 100,
    };
    const row = (children) =>
      html.div(
        { style: "display: flex; gap: 0.35rem; align-items: center;" },
        children
      );
    const group = (labelKey, rows) =>
      html.div({ style: "display: flex; flex-direction: column; gap: 0.35rem;" }, [
        html.span({ style: "opacity: 0.7;" }, [label(labelKey)]),
        ...rows,
      ]);
    const set = (key) => (value) => (working[key] = value);
    const container = (children) =>
      html.div(
        {
          style:
            "display: flex; flex-direction: column; gap: 0.75rem; min-width: 22em;",
        },
        children
      );

    if (type === "square") {
      return container([
        row([
          field(
            "cap-angle",
            working.capAngle,
            { minValue: CAP_ANGLE_MIN, maxValue: CAP_ANGLE_MAX },
            set("capAngle")
          ),
          field(
            "cap-distance",
            working.capDistance,
            { minValue: 0 },
            set("capDistance")
          ),
        ]),
      ]);
    }
    if (type === "round") {
      return container([
        row([
          field(
            "cap-radius",
            working.capRadiusRatio,
            { minValue: 1, maxValue: CAP_RADIUS_POSITIONS },
            set("capRadiusRatio"),
            {
              toDisplay: (v) => capRadiusIndexFromRatio(v) + 1,
              fromDisplay: (v) => capRadiusRatioFromIndex(v - 1),
            }
          ),
          field(
            "cap-tension",
            working.capTension,
            { minValue: 0, maxValue: 100 },
            set("capTension"),
            percent
          ),
        ]),
      ]);
    }
    if (type === "drop") {
      return container([
        row([
          field(
            "cap-ball",
            working.capBallRatio,
            { minValue: CAP_BALL_MIN, maxValue: CAP_BALL_MAX },
            set("capBallRatio"),
            percent
          ),
          field(
            "cap-ball-shape",
            working.capBallShape,
            { minValue: CAP_SHAPE_MIN, maxValue: CAP_SHAPE_MAX },
            set("capBallShape"),
            percent
          ),
        ]),
        row([
          field(
            "cap-ball-easing",
            working.capBallEasing,
            { minValue: 0, maxValue: CAP_BALL_EASING_MAX },
            set("capBallEasing"),
            percent
          ),
          field(
            "cap-ball-ease-curvature",
            working.capBallEaseCurvature,
            { minValue: 0, maxValue: 100 },
            set("capBallEaseCurvature"),
            percent
          ),
        ]),
      ]);
    }

    // Serif: one chained row per half field, as the Terminal section draws it.
    const halfBounds = (halfField) =>
      SERIF_PERCENT_FIELD_BOUNDS[halfField] ??
      (halfField === "wingSlope"
        ? {}
        : halfField === "tipCutAngle"
          ? { minValue: -MAX_TIP_CUT_ANGLE, maxValue: MAX_TIP_CUT_ANGLE }
          : { minValue: 0 });
    const halfGroups = SERIF_FIELD_GROUPS.map(([groupKey, fields]) =>
      group(
        groupKey,
        fields.map((halfField) => {
          const conversion = halfField in SERIF_PERCENT_FIELD_BOUNDS ? percent : {};
          const right = field(
            `serif-field.${halfField}`,
            working.right[halfField],
            halfBounds(halfField),
            (value) => (working.right[halfField] = value),
            conversion
          );
          const left = field(
            `serif-field.${halfField}`,
            working.left[halfField],
            halfBounds(halfField),
            (value) => {
              working.left[halfField] = value;
              // A closed chain is one number for both halves.
              if (working.links[halfField]) {
                working.right[halfField] = value;
                right.value = right._toDisplay(value);
              }
            },
            conversion
          );
          const chain = html.createDomElement("chain-link", {
            tooltip: label("linked"),
          });
          chain.linked = working.links[halfField];
          right.disabled = working.links[halfField];
          chain.addEventListener("change", (event) => {
            working.links[halfField] = event.detail.linked;
            right.disabled = event.detail.linked;
            if (event.detail.linked) {
              working.right[halfField] = working.left[halfField];
              right.value = right._toDisplay(working.left[halfField]);
            }
          });
          return row([left, chain, right]);
        })
      )
    );
    const cup = group("serif-group-cup", [
      row([
        field(
          "serif-underside-cup",
          working.undersideCup,
          { minValue: 0 },
          set("undersideCup")
        ),
        field(
          "serif-underside-cup-balance",
          working.undersideCupBalance,
          { minValue: -100, maxValue: 100 },
          set("undersideCupBalance"),
          percent
        ),
        field(
          "serif-underside-cup-tension",
          working.undersideCupTension,
          { minValue: 0, maxValue: 100 },
          set("undersideCupTension"),
          percent
        ),
      ]),
    ]);
    // Angle: Free (the tilt mode, where Tilt is live), Vertical, Horizontal.
    const free = working.axisMode === "perpendicular" || working.axisMode === "tilt";
    const tilt = field(
      "serif-axis-tilt",
      working.axisTilt,
      { minValue: -40, maxValue: 40 },
      (value) => {
        working.axisMode = "tilt";
        working.axisTilt = value;
      }
    );
    tilt.disabled = !free;
    const axisControl = html.createDomElement("segmented-control", {
      options: [
        ["tilt", "free"],
        ["vertical", "vertical"],
        ["horizontal", "horizontal"],
      ].map(([value, key]) => ({ value, label: label(`force-angle.${key}`) })),
    });
    axisControl.value = free
      ? "tilt"
      : ["vertical", "horizontal"].includes(working.axisMode)
        ? working.axisMode
        : undefined;
    axisControl.addEventListener("change", (event) => {
      working.axisMode = event.detail.value;
      tilt.disabled = event.detail.value !== "tilt";
    });
    const angle = group("serif-group-angle", [row([axisControl]), row([tilt])]);
    return container([...halfGroups, cup, angle]);
  }

  // The trash takes two presses: the first arms it, the second deletes.
  async _deleteTerminalPreset(sourceId, type, index, rowId) {
    if (this._customDeleteConfirm !== rowId) {
      this._customDeleteConfirm = rowId;
      this._renderTerminalPresetRows();
      return;
    }
    const next = this._terminalPresetList(sourceId, type);
    if (!next[index]) {
      return;
    }
    next.splice(index, 1);
    await this._writeTerminalPresets(sourceId, type, next);
  }

  _renderTerminalPresetRows() {
    this.terminalPresetFilters.refresh();
    const readOnly = !!this.fontController.readOnly;
    const captured = this._captureSelectionTerminalPreset();
    const items = [];
    for (const [sourceId, source] of Object.entries(
      this.fontController.sources || {}
    )) {
      for (const type of TERMINAL_PRESET_KINDS) {
        this._terminalPresetList(sourceId, type).forEach((preset, index) => {
          if (this.terminalPresetFilters.matches(sourceId, preset.case, type)) {
            items.push({
              rowId: `${sourceId}:${type}:${index}`,
              sourceId,
              source,
              type,
              preset,
              index,
            });
          }
        });
      }
    }
    this.terminalPresetTable.setRows(
      items,
      ({ rowId, sourceId, source, type, preset, index }) =>
        tableRow(
          rowId,
          [
            tableCell(translate(`sidebar.skeleton-parameters.cap-style.${type}`)),
            tableCell([
              editableCell({
                value: preset.name || "",
                disabled: readOnly,
                onCommit: (name) =>
                  this._editTerminalPreset(sourceId, type, index, { name }),
              }),
            ]),
            actionsCell([
              this._presetApplyAction(readOnly, () =>
                this._applyTerminalPreset(type, preset)
              ),
              // Ticket 74: the pencil opens the preset's fields in a dialog.
              rowAction({
                src: "/tabler-icons/pencil.svg",
                tooltip: translate("sidebar.skeleton-settings.edit"),
                tooltipPosition: "left",
                disabled: readOnly,
                onClick: () => this._editTerminalPresetDialog(sourceId, type, index),
              }),
              this._presetUpdateAction(readOnly || captured?.type !== type, () =>
                this._editTerminalPreset(sourceId, type, index, captured.shape)
              ),
              this._presetDeleteAction(rowId, readOnly, () =>
                this._deleteTerminalPreset(sourceId, type, index, rowId)
              ),
            ]),
          ],
          { title: this._presetOrigin(source, sourceId, preset) }
        ),
      { rowId: (item) => item.rowId }
    );
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
    if (!this.contentElement.offsetParent) {
      return;
    }
    await this.fontController.ensureInitialized;

    const K = SKELETON_SOURCE_DEFAULT_KEYS;

    const dropDeadPoints = this._sourceDefault(K.SERIF_REMOVE_COLLAPSED) === true;
    this.dropDeadPointsToggle.checked = dropDeadPoints;
    this.dropDeadPointsToggle.disabled = !!this.fontController.readOnly;
    this.dropDeadPointsWarning.hidden = !dropDeadPoints;
    const simplifyEasing = this._sourceDefault(K.SERIF_SIMPLIFY_EASING) === true;
    this.simplifyEasingToggle.checked = simplifyEasing;
    this.simplifyEasingToggle.disabled = !!this.fontController.readOnly;
    this.simplifyEasingWarning.hidden = !simplifyEasing;

    this._renderWidthPresetRows();
    this._renderTerminalPresetRows();
  }
}

customElements.define("panel-skeleton-settings", SkeletonSettingsPanel);

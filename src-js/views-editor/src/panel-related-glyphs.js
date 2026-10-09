import {
  getCodePointFromGlyphName,
  getSuggestedGlyphName,
} from "@fontra/core/glyph-data.js";
import * as html from "@fontra/core/html-utils.js";
import { applicationSettingsController } from "@fontra/core/application-settings.js";
import { planGlyphBuild, readDecomposition } from "@fontra/core/composition-build.js";
import { translate } from "@fontra/core/localization.js";
import { checkmark } from "@fontra/core/ui-utils.js";
import { unicodeMadeOf, unicodeUsedBy } from "@fontra/core/unicode-utils.js";
import {
  attachComponent,
  buildGlyph,
  buildGlyphs,
  computeMarkCloud,
  detachComponent,
  overrideComponent,
  readCompositionState,
  targetsForMark,
  undoBuildGlyphs,
  updateComponent,
} from "./composition-editing.js";
import Panel from "./panel.js";

import { getCharFromCodePoint, throttleCalls } from "@fontra/core/utils.ts";
import { GlyphCellView } from "@fontra/web-components/glyph-cell-view.js";
import { GlyphCell } from "@fontra/web-components/glyph-cell.js";
import "@fontra/web-components/labeled-toggle.js";
import { showMenu } from "@fontra/web-components/menu-panel.js";
import "@fontra/web-components/overflow-popover.js";
import "@fontra/web-components/text-button.js";
import { Accordion } from "@fontra/web-components/ui-accordion.js";

// A composition row's actions as icons (Figma 4156:3268).
const COMPOSITION_ACTION_ICONS = {
  "composition.button.attach": "/tabler-icons/link.svg",
  "composition.button.detach": "/tabler-icons/unlink.svg",
  "composition.button.update": "/tabler-icons/refresh.svg",
  "composition.button.override": "/tabler-icons/lock.svg",
};

export default class RelatedGlyphPanel extends Panel {
  identifier = "related-glyphs";
  iconPath = "/tabler-icons/binary-tree-2.svg";
  tabLabel = "compose";

  // COMPOSE GLYPHS (Figma 4122:9325): the mark cloud switch, then the
  // composition heading, its component table, its buttons and the previews.
  static styles = `
    .compose-card {
      flex: 1 0 auto;
      gap: 12px;
    }

    .compose-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-height: 0;
      flex: 1;
    }

    .compose-heading-row {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    .compose-heading-row > overflow-popover {
      width: 16px;
      height: 16px;
    }

    .compose-table th:first-child,
    .compose-table td:first-child {
      width: 84px;
    }

    .compose-component {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .compose-component > span {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .compose-actions {
      display: flex;
      gap: 2px;
    }

    .compose-report.broken {
      color: #d08b00;
    }

    /* Its section switches run to the card's edges. */
    glyph-cell-view {
      flex: 1;
      min-height: 240px;
      margin: 0 -8px;
      overflow: hidden;
    }
  `;

  constructor(editorController) {
    super(editorController);
    this.throttledUpdate = throttleCalls((senderID) => this.update(senderID), 100);
    this.sceneController = this.editorController.sceneController;

    this.sceneController.sceneSettingsController.addKeyListener(
      ["selectedGlyphName", "editLayerName"],
      (event) => this.throttledUpdate()
    );

    // An edit inside the open glyph moves an anchor or a component, and either
    // of those changes what the composition rows report. The listener follows
    // the open glyph, so it is re-registered whenever the selection moves.
    this._compositionGlyphListener = () => this.throttledUpdate();
    this._compositionListenerGlyphName = null;
    this.sceneController.sceneSettingsController.addKeyListener(
      ["selectedGlyphName"],
      (event) => this.followGlyphForComposition(event.newValue)
    );

    this.fontController.addChangeListener({ glyphMap: null }, (event) => {
      // The font gained or lost a glyph, so the related list itself can differ.
      this._sectionsGlyphName = null;
      this.throttledUpdate();
    });
  }

  getContentElement() {
    this.glyphCellView = new GlyphCellView(
      this.editorController.fontController,
      this.editorController.sceneSettingsController,
      { glyphSelectionKey: "relatedGlyphsGlyphSelection" }
    );

    // The tiles hold the drawing they were given. An edit to a glyph one of
    // them shows dims that tile instead of redrawing it, and the redraw icon
    // solves them all again. This is the same bargain the attachment rows
    // make: the editor reports what moved and never answers for the designer.
    this.glyphCellView.onStaleChanged = () => this.updateRefreshButton();

    this.glyphCellView.onOpenSelectedGlyphs = (event) => this.openSelectedGlyphs(event);

    this.glyphCellView.onCellContextMenu = (event, glyphCell) =>
      this.handleContextMenu(event, glyphCell);

    this.relatedStatusElement = html.div({ class: "field-label" });
    this.glyphCellView.onNoGlyphsToDisplay = () => {
      this.relatedStatusElement.textContent = translate(
        "sidebar.related-glyphs.no-related-glyphs-or-characters-were-found"
      );
    };

    // The redraw icon shows only while the previews hold still.
    this.refreshButtonElement = html.createDomElement("icon-button", {
      "src": "/tabler-icons/refresh.svg",
      "data-tooltip": translate("sidebar.related-glyphs.refresh"),
      "data-tooltipposition": "left",
      "onclick": () => {
        // Rebuild the lists too: a glyph may have gained or lost a component
        // while the tiles were holding still.
        this._sectionsGlyphName = null;
        this.glyphCellView.refreshStaleCells();
        this.update();
      },
    });

    const settings = html.createDomElement("overflow-popover", {
      "data-tooltip": "Settings",
      "data-tooltipposition": "left",
    });
    settings.setAttribute("settings-card", "");
    settings.content = this._buildSettingsCard();

    this.compositionTableHost = html.div();
    this.compositionButtonsElement = html.div({ class: "button-row" });
    this.compositionReportElement = html.div({ class: "field-label compose-report" });

    return html.div({ class: "panel" }, [
      html.div({ class: "panel-section--flex card-column" }, [
        html.div({ class: "card card--headed compose-card" }, [
          html.div({ class: "card-heading-row" }, [
            html.div({ class: "card-heading" }, ["compose glyphs"]),
          ]),
          this._buildMarkCloudAccordion(),
          html.div({ class: "compose-section" }, [
            html.div({ class: "compose-heading-row" }, [
              html.div({ class: "card-subheading" }, [translate("composition.title")]),
              this.refreshButtonElement,
              settings,
            ]),
            this.compositionTableHost,
            this.compositionButtonsElement,
            this.compositionReportElement,
            this.relatedStatusElement,
            this.glyphCellView,
          ]),
        ]),
      ]),
    ]);
  }

  // The settings overflow (Figma 4123:10164): live previews, and two filters
  // on the previews. The mark cloud ignores the filters.
  _buildSettingsCard() {
    const settings = applicationSettingsController.model;
    const toggle = (label, key, onChange) => {
      const element = html.createDomElement("labeled-toggle", { label });
      element.checked = !!settings[key];
      element.addEventListener("change", () => {
        settings[key] = element.checked;
        onChange();
      });
      return element;
    };
    const refilter = () => {
      this._sectionsGlyphName = null;
      this.throttledUpdate();
    };
    const toggles = [
      toggle(
        translate("sidebar.related-glyphs.live-previews").toLowerCase(),
        "relatedGlyphsLivePreviews",
        () => {
          this.glyphCellView.setDeferUpdates(!settings.relatedGlyphsLivePreviews);
          this.updateRefreshButton();
        }
      ),
      toggle("show only added glyphsets", "relatedGlyphsOnlyAddedGlyphSets", refilter),
      toggle("show only glyphs with anchors", "relatedGlyphsOnlyWithAnchors", refilter),
    ];
    this.updateRefreshButton();

    return html.div({ class: "settings-card" }, [
      html.div({ class: "settings-card-heading" }, ["settings"]),
      html.div({ class: "settings-card-body" }, toggles),
    ]);
  }

  // The previews' filters. "Added glyphsets" keeps the glyphs of the font and
  // of the ticked glyph sets, dropping what only the Unicode tables suggest;
  // "with anchors" keeps the glyphs that compose by anchors (glyphHasAnchors).
  async filterPreviewGlyphs(glyphsPromise) {
    const settings = applicationSettingsController.model;
    let glyphs = await glyphsPromise;
    if (settings.relatedGlyphsOnlyAddedGlyphSets) {
      const combinedGlyphMap =
        this.sceneController.sceneSettings.combinedGlyphMap || {};
      glyphs = glyphs.filter(
        ({ glyphName }) =>
          glyphName in combinedGlyphMap || this.fontController.hasGlyph(glyphName)
      );
    }
    if (settings.relatedGlyphsOnlyWithAnchors) {
      const hasAnchors = await Promise.all(
        glyphs.map(({ glyphName }) => this.glyphHasAnchors(glyphName))
      );
      glyphs = glyphs.filter((glyph, index) => hasAnchors[index]);
    }
    return glyphs;
  }

  // A glyph passes when its parts compose by their anchors -- a build would
  // attach them, or already has -- or when it carries anchors itself.
  async glyphHasAnchors(glyphName) {
    const { combinedGlyphMap, combinedCharacterMap } =
      this.sceneController.sceneSettings;
    try {
      const plan = await planGlyphBuild(
        this.fontController,
        glyphName,
        combinedGlyphMap,
        combinedCharacterMap
      );
      if (plan.status === "built" || plan.status === "skipped") {
        return true;
      }
      const varGlyph = await this.fontController.getGlyph(glyphName);
      return Object.values(varGlyph?.layers || {}).some(
        (layer) => layer.glyph.anchors?.length
      );
    } catch (error) {
      return false;
    }
  }

  // mark cloud (Figma 4122:10021): an accordion switch with the cloud's
  // on/off in its header, over a checkmark per mark.
  _buildMarkCloudAccordion() {
    const settings = applicationSettingsController.model;
    const toggle = html.createDomElement("labeled-toggle", {
      title: translate("composition.mark-cloud").toLowerCase(),
    });
    toggle.checked = !!settings.compositionMarkCloudOn;
    toggle.addEventListener("change", () => {
      settings.compositionMarkCloudOn = toggle.checked;
      this.throttledUpdate();
    });

    this.markCloudContent = html.div();
    this.markCloudAccordion = new Accordion();
    this.markCloudAccordion.setAttribute("switch", "");
    this.markCloudAccordion.items = [
      {
        label: translate("composition.mark-cloud").toLowerCase(),
        open: true,
        auxiliaryHeaderElement: toggle,
        content: this.markCloudContent,
      },
    ];
    return this.markCloudAccordion;
  }

  updateRefreshButton() {
    this.refreshButtonElement.hidden =
      !!applicationSettingsController.model.relatedGlyphsLivePreviews;
    this.refreshButtonElement.toggleAttribute(
      "on",
      !!this.glyphCellView?.hasStaleCells
    );
  }

  followGlyphForComposition(glyphName) {
    if (this._compositionListenerGlyphName === glyphName) {
      return;
    }
    if (this._compositionListenerGlyphName) {
      this.fontController.removeGlyphChangeListener(
        this._compositionListenerGlyphName,
        this._compositionGlyphListener
      );
    }
    this._compositionListenerGlyphName = glyphName || null;
    if (glyphName) {
      this.fontController.addGlyphChangeListener(
        glyphName,
        this._compositionGlyphListener
      );
    }
  }

  // The panel computes nothing. It asks the write-path module for the state and
  // calls that module for every action. Spec section 9.
  async updateComposition() {
    const glyphName = this.sceneController.sceneSettings.selectedGlyphName;
    const buttons = [];
    if (glyphName) {
      // Build is offered only where the character is made of something. On an
      // unaccented letter or on a mark there is nothing to build from, and a
      // button that only ever refuses is worse than no button.
      const decomposition = readDecomposition(
        this.fontController,
        glyphName,
        this.sceneController.sceneSettings.combinedGlyphMap,
        this.sceneController.sceneSettings.combinedCharacterMap
      );
      const canBuild = decomposition.status === "ok";
      const markTargets = targetsForMark(this.sceneController, glyphName);
      buttons.push(
        html.createDomElement("text-button", {
          label: translate("composition.button.build").toLowerCase(),
          size: "S",
          disabled: !canBuild,
          onclick: async () => {
            const result = await buildGlyph(this.sceneController, glyphName);
            if (result.status === "refused") {
              this.compositionReport = translate(
                "composition.refused",
                translate(`composition.refusal.${result.reason}`)
              );
            } else {
              this.compositionReport = null;
            }
            this.throttledUpdate();
          },
        }),
        html.createDomElement("text-button", {
          label: translate("composition.button.compose-all").toLowerCase(),
          size: "S",
          disabled: !markTargets.length,
          onclick: async () => {
            const report = await buildGlyphs(this.sceneController, markTargets);
            this.compositionReport = translate(
              "composition.report",
              report.built.length,
              report.skipped.length,
              report.refused.length
            );
            // Ctrl+Z cannot take a batch back: its records are on the built
            // glyphs' own stacks, and this glyph's stack is empty. So the
            // batch keeps what it needs to undo itself, and offers it here.
            this.compositionBatch = report.record.length
              ? { markGlyphName: glyphName, record: report.record }
              : null;
            this.throttledUpdate();
          },
        })
      );

      if (this.compositionBatch?.markGlyphName === glyphName) {
        buttons.push(
          html.createDomElement("text-button", {
            label: translate(
              "composition.button.undo-compose-all",
              this.compositionBatch.record.length
            ).toLowerCase(),
            size: "S",
            onclick: async () => {
              await undoBuildGlyphs(this.sceneController, this.compositionBatch.record);
              this.compositionBatch = null;
              this.compositionReport = null;
              this.throttledUpdate();
            },
          })
        );
      }
    }
    this.compositionButtonsElement.replaceChildren(...buttons);
    this.compositionReportElement.textContent = this.compositionReport || "";
    this.compositionReportElement.classList.toggle("broken", !!this.compositionReport);

    await this.updateMarkCloud(glyphName);

    const { rows } = await readCompositionState(this.sceneController);
    this.compositionTableHost.replaceChildren(
      rows.length
        ? this._buildCompositionTable(rows)
        : html.div({ class: "field-label" }, [
            glyphName ? translate("composition.no-components") : "",
          ])
    );
  }

  // The component table (Figma 4156:3200): ANCHOR and COMPONENT, the row's
  // actions at the component's end. The state and any refusal are the row's
  // tooltip.
  _buildCompositionTable(rows) {
    const cell = (tag, children) => html.createDomElement(tag, {}, children);
    const tr = (cells, attributes = {}) =>
      html.createDomElement("tr", attributes, cells);
    return html.createDomElement("table", { class: "static-table compose-table" }, [
      tr([cell("th", ["anchor"]), cell("th", ["component"])]),
      ...rows.map((row) => {
        const tooltip = [
          translate(`composition.state.${row.state}`),
          row.refusal ? translate(`composition.refusal.${row.refusal}`) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const actions = this.compositionButtonsFor(row).map(([labelKey, action]) =>
          html.createDomElement("icon-button", {
            "src": COMPOSITION_ACTION_ICONS[labelKey],
            "data-tooltip": translate(labelKey),
            "data-tooltipposition": "left",
            "onclick": async () => {
              await action(this.sceneController, row.componentIndex);
              this.throttledUpdate();
            },
          })
        );
        return tr(
          [
            cell("td", [row.anchorName || "-"]),
            cell("td", [
              html.div({ class: "compose-component" }, [
                html.span({}, [row.componentName]),
                html.div({ class: "compose-actions" }, actions),
              ]),
            ]),
          ],
          { "data-tooltip": tooltip, "data-tooltipposition": "top" }
        );
      }),
    ]);
  }

  // The cloud lists every glyph of the font with an underscore anchor matching
  // one of the open glyph's anchors; it has no other condition. The section
  // is always there; where nothing matches it says so.
  // The switch and the ticks are view preferences, so they live in
  // localStorage per decision D9.
  async updateMarkCloud(glyphName) {
    const model = this.sceneController.sceneModel;
    model.compositionMarkCloud = [];
    // ponytail: every glyph of the font is a candidate, so the first solve
    // loads them all; narrow to marks by category if large fonts stall here.
    const candidates =
      glyphName && this.fontController.hasGlyph(glyphName)
        ? Object.keys(this.fontController.glyphMap).filter((name) => name !== glyphName)
        : [];
    const placeable = candidates.length
      ? await computeMarkCloud(this.sceneController, glyphName, candidates)
      : [];
    const markNames = [...new Set(placeable.map((mark) => mark.glyphName))];
    if (!markNames.length) {
      this.markCloudContent.replaceChildren(
        html.div({ class: "field-label" }, [translate("composition.no-cloud-marks")])
      );
      this.editorController.canvasController.requestUpdate();
      return;
    }

    const settings = applicationSettingsController.model;
    const sets = settings.compositionMarkCloudSets || {};
    const enabled = new Set(sets[glyphName] ?? markNames);

    const parts = [
      html.div(
        { class: "checkmark-wrap" },
        markNames.map((markName) =>
          checkmark(enabled.has(markName), markName, (checked) => {
            const next = new Set(enabled);
            if (checked) {
              next.add(markName);
            } else {
              next.delete(markName);
            }
            settings.compositionMarkCloudSets = {
              ...sets,
              [glyphName]: [...next],
            };
            this.throttledUpdate();
          })
        )
      ),
    ];

    // A mark carrying more than one underscore anchor name is drawn once per
    // name, and it is flagged here. Spec section 8.
    const drawnPerMark = {};
    for (const mark of placeable) {
      drawnPerMark[mark.glyphName] = (drawnPerMark[mark.glyphName] || 0) + 1;
    }
    for (const [markName, count] of Object.entries(drawnPerMark)) {
      if (count > 1) {
        parts.push(
          html.div({ class: "field-label compose-report broken" }, [
            `${markName}: ${translate("composition.multi-anchor-mark")}`,
          ])
        );
      }
    }
    this.markCloudContent.replaceChildren(...parts);

    model.compositionMarkCloud = settings.compositionMarkCloudOn
      ? placeable.filter((mark) => enabled.has(mark.glyphName))
      : [];
    this.editorController.canvasController.requestUpdate();
  }

  // The state decides what the designer can do about it. Spec section 6.
  compositionButtonsFor(row) {
    switch (row.state) {
      case "unattached":
        return row.anchorName ? [["composition.button.attach", attachComponent]] : [];
      case "inSync":
        return [["composition.button.detach", detachComponent]];
      case "outOfDate":
        return [
          ["composition.button.update", updateComponent],
          ["composition.button.override", overrideComponent],
          ["composition.button.detach", detachComponent],
        ];
      case "detached":
        return [
          ["composition.button.update", updateComponent],
          ["composition.button.detach", detachComponent],
        ];
      case "broken":
        return [["composition.button.detach", detachComponent]];
      default:
        return [];
    }
  }

  async update() {
    const glyphName = this.sceneController.sceneSettings.selectedGlyphName;
    this.followGlyphForComposition(glyphName);
    await this.updateComposition();
    const character = glyphName
      ? getCharFromCodePoint(
          this.fontController.codePointForGlyph(glyphName) ||
            getCodePointFromGlyphName(glyphName)
        ) || ""
      : "";
    const codePoint = character ? character.codePointAt(0) : undefined;

    this.relatedStatusElement.textContent = "";

    if (glyphName) {
      const sectionDefinitions = [
        {
          labelKey: "sidebar.related-glyphs.alternate-glyphs",
          getRelatedGlyphsFunc: getRelatedGlyphsByExtension,
        },
        {
          labelKey: "sidebar.related-glyphs.components-used-by-this-glyph",
          getRelatedGlyphsFunc: getComponentGlyphs,
        },
        {
          labelKey: "sidebar.related-glyphs.glyphs-using-this-glyph-as-a-component",
          getRelatedGlyphsFunc: getUsedByGlyphs,
          // These two list the glyphs built on top of the open one. Editing the
          // open glyph moves them on screen, but nothing has re-solved where
          // their components sit, so a live redraw shows a state the font has
          // not settled on. They hold their drawing and report it stale.
          deferUpdates: true,
        },
        {
          labelKey: "sidebar.related-glyphs.character-decomposition",
          getRelatedGlyphsFunc: getUnicodeDecomposed,
        },
        {
          labelKey: "sidebar.related-glyphs.character-decompose-with-character",
          getRelatedGlyphsFunc: getUnicodeUsedBy,
          deferUpdates: true,
        },
      ];

      // Rebuilding the sections replaces every cell, which would throw away
      // what the tiles are holding and quietly redraw them all. So the list is
      // rebuilt only when it can actually have changed: a different glyph is
      // open, or the font gained or lost glyphs. An edit inside a glyph leaves
      // the tiles alone, and they report themselves stale instead.
      if (this._sectionsGlyphName !== glyphName) {
        this._sectionsGlyphName = glyphName;
        const sections = sectionDefinitions.map(
          ({ labelKey, getRelatedGlyphsFunc, deferUpdates }) => ({
            label: translate(labelKey),
            glyphs: this.filterPreviewGlyphs(
              getRelatedGlyphsFunc(this.fontController, glyphName, codePoint)
            ),
            deferUpdates:
              deferUpdates &&
              !applicationSettingsController.model.relatedGlyphsLivePreviews,
          })
        );
        this.glyphCellView.setGlyphSections(sections, true);
      }
    } else {
      this._sectionsGlyphName = null;
      this.glyphCellView.setGlyphSections([], true);

      this.relatedStatusElement.textContent = translate(
        "sidebar.related-glyphs.no-glyph-selected"
      );
    }
  }

  openSelectedGlyphs(event) {
    const selectedGlyphInfo = this.glyphCellView.getSelectedGlyphInfo(true);
    if (!selectedGlyphInfo.length) {
      return;
    }
    this.insertGlyphIntoTextString(
      selectedGlyphInfo,
      event.altKey ? 1 : 0,
      !event.altKey
    );
  }

  insertGlyphIntoTextString(selectedGlyphInfo, where, select) {
    const glyphInfos = selectedGlyphInfo.map((glyphInfo) => ({
      glyphName: glyphInfo.glyphName,
      character: getCharFromCodePoint(glyphInfo.codePoints[0]),
    }));
    this.editorController.insertGlyphInfos(glyphInfos, where, select);
  }

  handleContextMenu(event, glyphCell) {
    event.preventDefault();

    const selectedGlyphInfo = this.glyphCellView.getSelectedGlyphInfo(true);
    if (!selectedGlyphInfo.length) {
      return;
    }

    const items = [
      {
        title: translate("sidebar.related-glyphs.replace-selected-glyph"),
        callback: () => {
          this.insertGlyphIntoTextString(selectedGlyphInfo, 0, true);
        },
      },
      {
        title: translate("sidebar.related-glyphs.insert-after-selected-glyph"),
        callback: () => {
          this.insertGlyphIntoTextString(selectedGlyphInfo, 1, false);
        },
      },
      {
        title: translate(
          "sidebar.related-glyphs.insert-after-selected-glyph-and-select"
        ),
        callback: () => {
          this.insertGlyphIntoTextString(selectedGlyphInfo, 1, true);
        },
      },
      {
        title: translate("sidebar.related-glyphs.insert-before-selected-glyph"),
        callback: () => {
          this.insertGlyphIntoTextString(selectedGlyphInfo, -1, false);
        },
      },
      {
        title: translate(
          "sidebar.related-glyphs.insert-before-selected-glyph-and-select"
        ),
        callback: () => {
          this.insertGlyphIntoTextString(selectedGlyphInfo, -1, true);
        },
      },
    ];
    const { x, y } = event;
    showMenu(items, { x: x + 1, y: y - 1 });
  }

  async toggle(on, focus) {
    if (on) {
      this.update();
    }
  }
}

function getRelatedGlyphsByExtension(fontController, targetGlyphName, targetCodePoint) {
  const targetBaseGlyphName = targetGlyphName.split(".")[0];
  const glyphNames = Object.keys(fontController.glyphMap)
    .filter((glyphName) => {
      const baseGlyphName = glyphName.split(".")[0];
      return baseGlyphName == targetBaseGlyphName && glyphName != targetGlyphName;
    })
    .sort();
  return addCharInfo(fontController, glyphNames);
}

async function getComponentGlyphs(fontController, targetGlyphName, targetCodePoint) {
  const varGlyph = await fontController.getGlyph(targetGlyphName);
  const componentNames = [...(varGlyph?.getAllComponentNames() || [])];
  componentNames.sort();

  return addCharInfo(fontController, componentNames);
}

async function getUsedByGlyphs(fontController, targetGlyphName, targetCodePoint) {
  const glyphNames = await fontController.findGlyphsThatUseGlyph(targetGlyphName);
  return addCharInfo(fontController, glyphNames);
}

async function getUnicodeDecomposed(fontController, targetGlyphName, targetCodePoint) {
  return await _getRelatedUnicode(
    fontController,
    targetGlyphName,
    targetCodePoint,
    unicodeMadeOf
  );
}

async function getUnicodeUsedBy(fontController, targetGlyphName, targetCodePoint) {
  return await _getRelatedUnicode(
    fontController,
    targetGlyphName,
    targetCodePoint,
    unicodeUsedBy
  );
}

async function _getRelatedUnicode(
  fontController,
  targetGlyphName,
  targetCodePoint,
  uniFunc
) {
  const codePoint =
    fontController.codePointForGlyph(targetGlyphName) || targetCodePoint;
  if (!codePoint) {
    return [];
  }
  const usedByCodePoints = uniFunc(codePoint);
  const glyphInfo = [];
  for (const codePoint of usedByCodePoints) {
    const glyphName =
      fontController.characterMap[codePoint] || getSuggestedGlyphName(codePoint);
    glyphInfo.push({ glyphName, codePoints: [codePoint] });
  }
  return glyphInfo;
}

function addCharInfo(fontController, glyphNames) {
  const glyphMap = fontController.glyphMap;
  return glyphNames.map((glyphName) => {
    return { glyphName, codePoints: glyphMap[glyphName] || [] };
  });
}

customElements.define("panel-related-glyph", RelatedGlyphPanel);

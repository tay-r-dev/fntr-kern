import {
  getCodePointFromGlyphName,
  getSuggestedGlyphName,
} from "@fontra/core/glyph-data.js";
import * as html from "@fontra/core/html-utils.js";
import { applicationSettingsController } from "@fontra/core/application-settings.js";
import { readDecomposition } from "@fontra/core/composition-build.js";
import { translate } from "@fontra/core/localization.js";
import { unicodeMadeOf, unicodeUsedBy } from "@fontra/core/unicode-utils.js";
import {
  attachComponent,
  buildGlyph,
  buildGlyphs,
  computeMarkCloud,
  markCandidatesForBase,
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
import { showMenu } from "@fontra/web-components/menu-panel.js";

export default class RelatedGlyphPanel extends Panel {
  identifier = "related-glyphs";
  iconPath = "/tabler-icons/binary-tree-2.svg";

  static styles = `
    glyph-cell-view {
      flex: 1;
      overflow: hidden;
      height: 100%;
    }

    .related-glyphs-section {
      height: 100%;
      display: flex;
      gap: 1em;
      flex-direction: column;
    }

    .no-related-glyphs {
      color: #999;
      padding-top: 1em;
    }

    .composition-rows {
      display: flex;
      flex-direction: column;
      gap: 0.4em;
      padding-top: 0.5em;
    }

    .composition-row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.4em;
    }

    .composition-row-name {
      font-weight: bold;
    }

    .composition-row-state {
      color: #999;
    }

    .composition-row-state.out-of-date,
    .composition-row-state.broken {
      color: #d08b00;
    }
  `;

  constructor(editorController) {
    super(editorController);
    this.throttledUpdate = throttleCalls((senderID) => this.update(senderID), 100);
    this.sceneController = this.editorController.sceneController;

    this.setupGlyphRelationshipsElement();

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

    this.fontController.addChangeListener({ glyphMap: null }, (event) =>
      this.throttledUpdate()
    );
  }

  getContentElement() {
    this.glyphCellView = new GlyphCellView(
      this.editorController.fontController,
      this.editorController.sceneSettingsController,
      { glyphSelectionKey: "relatedGlyphsGlyphSelection" }
    );

    this.glyphCellView.onOpenSelectedGlyphs = (event) => this.openSelectedGlyphs(event);

    this.glyphCellView.onCellContextMenu = (event, glyphCell) =>
      this.handleContextMenu(event, glyphCell);

    this.glyphCellView.onNoGlyphsToDisplay = () => {
      this.relatedGlyphsHeaderElement.appendChild(
        html.div({ class: "no-related-glyphs" }, [
          translate(
            "sidebar.related-glyphs.no-related-glyphs-or-characters-were-found"
          ),
        ])
      );
    };

    return html.div(
      {
        class: "panel",
      },
      [
        html.div({ class: "panel-section" }, [
          html.div({ id: "composition-header" }, [translate("composition.title")]),
          html.div({ id: "composition-rows", class: "composition-rows" }, []),
        ]),
        html.div(
          {
            class: "panel-section panel-section--flex related-glyphs-section",
          },
          [
            html.div({ id: "related-glyphs-header" }, [
              translate("sidebar.related-glyphs.related-glyphs"),
            ]),
            this.glyphCellView,
          ]
        ),
      ]
    );
  }

  setupGlyphRelationshipsElement() {
    this.relatedGlyphsHeaderElement = this.contentElement.querySelector(
      "#related-glyphs-header"
    );
    this.compositionHeaderElement =
      this.contentElement.querySelector("#composition-header");
    this.compositionRowsElement =
      this.contentElement.querySelector("#composition-rows");
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
    this.compositionRowsElement.innerHTML = "";
    this.compositionHeaderElement.innerHTML = `<b>${translate(
      "composition.title"
    )}</b>`;

    const glyphName = this.sceneController.sceneSettings.selectedGlyphName;
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
      this.compositionRowsElement.appendChild(
        html.div({ class: "composition-row" }, [
          html.button(
            {
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
            },
            [translate("composition.button.build")]
          ),
          html.button(
            {
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
            },
            [translate("composition.button.compose-all")]
          ),
        ])
      );

      if (this.compositionBatch?.markGlyphName === glyphName) {
        this.compositionRowsElement.appendChild(
          html.div({ class: "composition-row" }, [
            html.button(
              {
                onclick: async () => {
                  await undoBuildGlyphs(
                    this.sceneController,
                    this.compositionBatch.record
                  );
                  this.compositionBatch = null;
                  this.compositionReport = null;
                  this.throttledUpdate();
                },
              },
              [
                translate(
                  "composition.button.undo-compose-all",
                  this.compositionBatch.record.length
                ),
              ]
            ),
          ])
        );
      }
    }
    if (this.compositionReport) {
      this.compositionRowsElement.appendChild(
        html.div({ class: "composition-row-state broken" }, [this.compositionReport])
      );
    }

    await this.updateMarkCloud(glyphName);

    const { rows } = await readCompositionState(this.sceneController);
    if (!rows.length) {
      this.compositionRowsElement.appendChild(
        html.div({ class: "no-related-glyphs" }, [
          translate("composition.no-components"),
        ])
      );
      return;
    }

    for (const row of rows) {
      const parts = [
        html.span({ class: "composition-row-name" }, [row.componentName]),
        html.span({ class: "composition-row-state" }, [
          translate(`composition.state.${row.state}`),
        ]),
      ];
      if (row.anchorName) {
        parts.push(html.span({}, [row.anchorName]));
      }
      if (row.refusal) {
        parts.push(
          html.span({ class: "composition-row-state broken" }, [
            translate(`composition.refusal.${row.refusal}`),
          ])
        );
      }
      for (const [labelKey, action] of this.compositionButtonsFor(row)) {
        parts.push(
          html.button(
            {
              onclick: async () => {
                await action(this.sceneController, row.componentIndex);
                this.throttledUpdate();
              },
            },
            [translate(labelKey)]
          )
        );
      }
      this.compositionRowsElement.appendChild(
        html.div({ class: "composition-row" }, parts)
      );
    }
  }

  // The cloud controls appear only where the open glyph carries a plain anchor,
  // which is the base-glyph case. On a mark they are absent. The switch and the
  // ticks are view preferences, so they live in localStorage per decision D9.
  async updateMarkCloud(glyphName) {
    const model = this.sceneController.sceneModel;
    model.compositionMarkCloud = [];
    if (!glyphName) {
      return;
    }
    const candidates = markCandidatesForBase(this.sceneController, glyphName);
    if (!candidates.length) {
      return;
    }

    const settings = applicationSettingsController.model;
    const sets = settings.compositionMarkCloudSets || {};
    const enabled = new Set(sets[glyphName] ?? candidates);

    const onSwitch = html.input({
      type: "checkbox",
      checked: !!settings.compositionMarkCloudOn,
      onchange: (event) => {
        settings.compositionMarkCloudOn = event.target.checked;
        this.throttledUpdate();
      },
    });
    this.compositionRowsElement.appendChild(
      html.div({ class: "composition-row" }, [
        onSwitch,
        html.span({}, [translate("composition.mark-cloud")]),
      ])
    );

    for (const markName of candidates) {
      this.compositionRowsElement.appendChild(
        html.div({ class: "composition-row" }, [
          html.input({
            type: "checkbox",
            checked: enabled.has(markName),
            onchange: (event) => {
              const next = new Set(enabled);
              if (event.target.checked) {
                next.add(markName);
              } else {
                next.delete(markName);
              }
              settings.compositionMarkCloudSets = {
                ...sets,
                [glyphName]: [...next],
              };
              this.throttledUpdate();
            },
          }),
          html.span({}, [markName]),
        ])
      );
    }

    if (!settings.compositionMarkCloudOn) {
      return;
    }
    const placed = await computeMarkCloud(
      this.sceneController,
      glyphName,
      candidates.filter((name) => enabled.has(name))
    );
    model.compositionMarkCloud = placed;
    this.editorController.canvasController.requestUpdate();

    // A mark carrying more than one underscore anchor name is drawn once per
    // name, and it is flagged here. Spec section 8.
    const drawnPerMark = {};
    for (const mark of placed) {
      drawnPerMark[mark.glyphName] = (drawnPerMark[mark.glyphName] || 0) + 1;
    }
    for (const [markName, count] of Object.entries(drawnPerMark)) {
      if (count > 1) {
        this.compositionRowsElement.appendChild(
          html.div({ class: "composition-row-state broken" }, [
            `${markName}: ${translate("composition.multi-anchor-mark")}`,
          ])
        );
      }
    }
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

    const varGlyphController =
      await this.sceneController.sceneModel.getSelectedVariableGlyphController();
    const varGlyph = varGlyphController?.glyph;

    const displayGlyphString =
      character && character != glyphName ? `“${character}”, ${glyphName}` : glyphName;

    this.relatedGlyphsHeaderElement.innerHTML = glyphName
      ? `<b>${translate("sidebar.related-glyphs.title", displayGlyphString)}</b>`
      : `<b>${translate("sidebar.related-glyphs")}</b>`;

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
        },
        {
          labelKey: "sidebar.related-glyphs.character-decomposition",
          getRelatedGlyphsFunc: getUnicodeDecomposed,
        },
        {
          labelKey: "sidebar.related-glyphs.character-decompose-with-character",
          getRelatedGlyphsFunc: getUnicodeUsedBy,
        },
      ];

      const sections = sectionDefinitions.map(({ labelKey, getRelatedGlyphsFunc }) => ({
        label: translate(labelKey),
        glyphs: getRelatedGlyphsFunc(this.fontController, glyphName, codePoint),
      }));
      this.glyphCellView.setGlyphSections(sections, true);
    } else {
      this.glyphCellView.setGlyphSections([], true);

      this.relatedGlyphsHeaderElement.appendChild(
        html.div({ class: "no-related-glyphs" }, [
          translate("sidebar.related-glyphs.no-glyph-selected"),
        ])
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

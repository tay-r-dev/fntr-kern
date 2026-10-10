import {
  actionsCell,
  rowAction,
  tableCell,
  tableRow,
} from "@fontra/web-components/data-table.js";
import { IconButton } from "@fontra/web-components/icon-button.js"; // required for "icon-button"
import "@fontra/web-components/text-button.js";
import { dialogSetup, message } from "@fontra/web-components/modal-dialog.js";
import * as html from "./html-utils.js";
import { translate } from "./localization.js";
import { ObservableController } from "./observable-object.ts";
import { glyphSetDataFormats } from "./parse-glyphset.js";
import { union } from "./set-ops.js";
import {
  labeledCheckbox,
  labeledPopupSelect,
  checkmark,
  labeledTextInput,
  popupSelect,
} from "./ui-utils.js";
import { fetchJSON } from "./utils.ts";

export class GlyphSetsUIController {
  constructor(settingsController, options) {
    const {
      label,
      id,
      collectionKey,
      selectionKey,
      addGlyphSetToolTip,
      copyToLabel,
      otherCollectionKey,
      accordionId,
    } = options;

    this.settingsController = settingsController;
    this.settings = settingsController.model;
    this.collectionKey = collectionKey;
    this.selectionKey = selectionKey;
    this.copyToLabel = copyToLabel;
    this.otherCollectionKey = otherCollectionKey;
    this.accordionId = accordionId;

    this.addGlyphSetToolTip = addGlyphSetToolTip;
    this.glyphSetErrorButtons = {};
    this.accordionItem = {
      label,
      id,
      content: html.div(),
      open: true,
    };

    settingsController.addKeyListener([collectionKey, selectionKey], (event) =>
      this.updateGlyphSets()
    );

    settingsController.addKeyListener(
      "glyphSetErrors",
      (event) => {
        const allKeys = union(
          new Set(Object.keys(event.oldValue || {})),
          Object.keys(event.newValue)
        );
        for (const key of allKeys) {
          if (event.oldValue?.[key] === event.newValue[key]) {
            continue;
          }

          const isLoading = event.newValue[key] === "...";

          const errorButton = this.glyphSetErrorButtons[key];
          if (!errorButton) {
            continue;
          }

          errorButton.src = isLoading ? "loader-2" : "alert-triangle";

          errorButton.classList.toggle(
            "glyphset-error",
            !!(event.newValue[key] && event.newValue[key] !== "...")
          );

          errorButton.classList.toggle("loading", event.newValue[key] === "...");
        }
      },
      true
    );

    this.updateGlyphSets();
  }

  updateGlyphSets() {
    this.accordionItem.content.innerHTML = "";
    this.accordionItem.content.appendChild(this.makeGlyphSetsUI());
  }

  async addGlyphSet(event) {
    const { glyphSets, custom } = await runAddGlyphSetDialog(
      this.settings[this.collectionKey]
    );

    if (custom) {
      await this.editGlyphSet(event);
    } else if (glyphSets) {
      this.settings[this.collectionKey] = glyphSets;
    }

    const accordion = document.getElementById(this.accordionId);
    accordion?.openCloseAccordionItem(this.accordionItem, true);
  }

  async editGlyphSet(event, glyphSetInfo = null) {
    const glyphSet = await runEditGlyphSetDialog(glyphSetInfo);
    if (!glyphSet) {
      return;
    }

    const glyphSets = {
      ...this.settings[this.collectionKey],
    };
    if (glyphSetInfo?.url) {
      delete glyphSets[glyphSetInfo.url];
    }
    glyphSets[glyphSet.url] = glyphSet;
    this.settings[this.collectionKey] = glyphSets;
  }

  deleteGlyphSet(event, glyphSetInfo) {
    const glyphSets = {
      ...this.settings[this.collectionKey],
    };
    delete glyphSets[glyphSetInfo.url];
    this.settings[this.collectionKey] = glyphSets;
  }

  reloadGlyphSet(event, glyphSet) {
    this.settings[this.collectionKey] = {
      ...this.settings[this.collectionKey],
      [glyphSet.url]: { ...glyphSet },
    };
  }

  copyGlyphSet(event, glyphSet) {
    this.settings[this.otherCollectionKey] = {
      ...this.settings[this.otherCollectionKey],
      [glyphSet.url]: glyphSet,
    };
  }

  // The glyph sets as a table (Figma 4099:10349, look "select"): the shown
  // tick, the name and the row actions, over the add button. The head tick
  // shows or hides them all.
  makeGlyphSetsUI() {
    const glyphSets = this.prepareGlyphSets(this.settings[this.collectionKey]);
    const selected = new Set(this.settings[this.selectionKey]);
    const setSelected = (keys) => {
      this.settings[this.selectionKey] = [...keys];
    };

    const table = html.createDomElement("data-table");
    table.look = "select";
    table.selectAllClassName = "checkmark";
    table.columns = [{ label: "", selectAll: true }, { label: "name" }, { label: "" }];
    table.resizable = true;
    table.minHeight = 48;
    table.style.setProperty("--data-table-height", "76px");
    table.heightStorageKey = `fontra-glyph-sets-table-height-${this.collectionKey}`;
    table.onSelectAllChange = (checked) =>
      setSelected(checked ? glyphSets.map(({ key }) => key) : []);
    table.setRows(
      glyphSets,
      ({ key, label, glyphSet }) =>
        tableRow(key, [
          tableCell([
            checkmark(selected.has(key), "", (checked) => {
              const keys = new Set(selected);
              checked ? keys.add(key) : keys.delete(key);
              setSelected(keys);
            }),
          ]),
          tableCell([label]),
          actionsCell(glyphSet.url ? this.glyphSetActions(glyphSet) : []),
        ]),
      { rowId: ({ key }) => key }
    );
    const shownCount = glyphSets.filter(({ key }) => selected.has(key)).length;
    table.setSelectAllState({
      checked: !!glyphSets.length && shownCount === glyphSets.length,
      indeterminate: shownCount > 0 && shownCount < glyphSets.length,
    });

    return html.div({ class: "glyph-set-container" }, [
      table,
      html.createDomElement("text-button", {
        "label": "add",
        "size": "S",
        "data-tooltip": this.addGlyphSetToolTip,
        "onclick": (event) => this.addGlyphSet(event),
      }),
    ]);
  }

  prepareGlyphSets(glyphSets) {
    return Object.entries(glyphSets)
      .map(([key, glyphSet]) => ({ key, label: glyphSet.name, glyphSet }))
      .sort((a, b) => {
        if (a.label == b.label) {
          return 0;
        }
        if (!a.key) {
          return -1;
        } else if (!b.key) {
          return 1;
        }
        return a.label < b.label ? -1 : 1;
      });
  }

  // Edit, copy to the other collection, reload and delete; the error button
  // shows only while the set failed to load.
  glyphSetActions(glyphSet) {
    return [
      this.makeGlyphSetErrorButton(glyphSet),
      rowAction({
        src: "pencil",
        tooltip: translate("action-topics.menu.edit"),
        onClick: (event) => this.editGlyphSet(event, glyphSet),
      }),
      rowAction({
        src: "arrow-big-right",
        tooltip: translate("glyph-organizing.glyph-set.copy-to", this.copyToLabel),
        onClick: (event) => this.copyGlyphSet(event, glyphSet),
      }),
      rowAction({
        src: "refresh",
        tooltip: translate("glyph-organizing.glyph-set.reload"),
        onClick: (event) => this.reloadGlyphSet(event, glyphSet),
      }),
      rowAction({
        src: "delete",
        tooltip: translate("action.delete"),
        onClick: (event) => this.deleteGlyphSet(event, glyphSet),
      }),
    ];
  }

  makeGlyphSetErrorButton(glyphSet) {
    const errorButton = rowAction({
      src: "alert-triangle",
      reveal: "always",
      className: "glyphset-error-button",
      onClick: () => {
        const errorMessage = this.settings.glyphSetErrors[glyphSet.url];
        if (errorMessage) {
          message(`The glyph set “${glyphSet.name}” could not be loaded`, errorMessage);
        }
      },
    });
    const error = this.settings.glyphSetErrors?.[glyphSet.url];
    errorButton.classList.toggle("glyphset-error", !!(error && error !== "..."));
    errorButton.classList.toggle("loading", error === "...");

    this.glyphSetErrorButtons[glyphSet.url] = errorButton;

    return errorButton;
  }
}

export class CheckboxGroup {
  constructor(settingsController, settingsKey) {
    this.checkboxController = makeCheckboxController(settingsController, settingsKey);
  }

  makeCheckboxUI(checkboxItems) {
    // Ensure the checkboxController has items for every key, as we need
    // to iterate over them in response to selection changes
    checkboxItems.forEach(({ key }) => {
      if (this.checkboxController.model[key] === undefined) {
        this.checkboxController.model[key] = false;
      }
    });

    return html.div({ class: "checkbox-group" }, [
      ...checkboxItems
        .map(({ key, label, extraItem }) => [
          labeledCheckbox(label, this.checkboxController, key),
          extraItem ? extraItem : html.div(),
        ])
        .flat(),
    ]);
  }
}

function makeCheckboxController(settingsController, settingsKey) {
  const settings = settingsController.model;

  const checkboxController = new ObservableController(
    Object.fromEntries(settings[settingsKey].map((key) => [key, true]))
  );

  checkboxController.addListener((event) => {
    if (!event.senderInfo?.sentFromSettings) {
      settings[settingsKey] = Object.entries(checkboxController.model)
        .filter(([key, value]) => value)
        .map(([key, value]) => key);
    }
  });

  settingsController.addKeyListener(settingsKey, (event) => {
    checkboxController.withSenderInfo({ sentFromSettings: true }, () => {
      Object.entries(checkboxController.model).forEach(([key, value]) => {
        checkboxController.model[key] = event.newValue.includes(key);
      });
    });
  });

  return checkboxController;
}

let glyphSetPresets;

fetchJSON("/data/glyphset-presets.json", { cache: "no-cache" }).then((result) => {
  glyphSetPresets = result;
});

async function runAddGlyphSetDialog(initialGlyphSets) {
  const dialog = new AddPresetGlyphSetDialog(initialGlyphSets);
  return await dialog.run();
}

const CHECKBOX_PREFIX = "checkbox-";
const SELECTED_GLYPHSET_LOCAL_STORAGE_KEY = "fontra-selected-glyphset-collection";

class AddPresetGlyphSetDialog {
  static styles = `
    .content-container {
      display: grid;
      grid-template-columns: max-content auto;
      align-items: center;
      align-content: start;
      gap: 0.5em;
      height: calc(80vh - 10em); /* Nasty: the 10em value depends on the rest of the contents */
    }

    .checkbox-container {
      height: 100%;
      overflow: scroll;
    }

    .checkbox-group {
      display: grid;
    }

    a {
      color: var(--foreground-color);
      text-decoration: underline;
    }

    a.suggest-link {
      font-style: italic;
    }

    .collection-popup {
      width: 18em;
    }
  `;

  constructor(initialGlyphSets) {
    this.initialGlyphSets = initialGlyphSets;
    this.dialogController = new ObservableController({
      ...Object.fromEntries(
        Object.values(initialGlyphSets).map((glyphSet) => [
          CHECKBOX_PREFIX + glyphSet.url,
          true,
        ])
      ),
    });

    this.sourceURLElement = html.a(
      {
        id: "info-link",
        target: "_blank",
      },
      [this.dialogController.model.sourceURL || ""]
    );
    this.checkboxContainer = html.div({ class: "checkbox-container" });

    const collectionNames = glyphSetPresets.map((collection) => collection.name);
    collectionNames.sort();

    this.dialogContent = html.div({ class: "content-container" }, [
      ...labeledPopupSelect(
        translate("glyph-organizing.glyph-set.collection"),
        this.dialogController,
        "collectionName",
        collectionNames.map((name) => ({ value: name, label: name })),
        { class: "collection-popup" }
      ),
      html.div(),
      html.a(
        {
          href: "https://github.com/fontra/fontra/discussions/1943",
          target: "_blank",
          class: "suggest-link",
        },
        ["Suggest more glyph set collections"]
      ),
      html.label({ for: "info-link", style: "text-align: right;" }, [
        translate("glyph-organizing.glyph-set.source-link"),
      ]),
      this.sourceURLElement,
      html.div(), // grid cell filler
      this.checkboxContainer,
    ]);

    this.dialogController.addKeyListener("collectionName", (event) => {
      this.setSelectedGlyphsetCollection(event.newValue);
      localStorage.setItem(SELECTED_GLYPHSET_LOCAL_STORAGE_KEY, event.newValue);
    });

    this.dialogController.model.collectionName =
      localStorage.getItem(SELECTED_GLYPHSET_LOCAL_STORAGE_KEY) || "Google Fonts";
  }

  setSelectedGlyphsetCollection(collectionName) {
    const collection = glyphSetPresets.find(
      (collection) => collection.name === collectionName
    );
    this.sourceURLElement.href = collection.sourceURL;
    this.sourceURLElement.innerText = collection.sourceURL;
    this.checkboxContainer.innerHTML = "";
    this.checkboxContainer.appendChild(this.checkboxesForCollection(collection));
  }

  checkboxesForCollection(collection) {
    const checkboxes = collection.glyphSets.map((glyphSet) => {
      const key = CHECKBOX_PREFIX + glyphSet.url;
      return labeledCheckbox(glyphSet.name, this.dialogController, key);
    });
    return html.div({}, checkboxes);
  }

  async run() {
    const dialog = await dialogSetup(
      translate("glyph-organizing.glyph-set.add-remove-glyph-set"),
      "",
      [
        {
          title: translate(
            "glyph-organizing.glyph-set.add-custom-glyph-set.menu-title"
          ),
          resultValue: "custom",
        },
        { title: translate("dialog.cancel"), isCancelButton: true },
        {
          title: translate("dialog.save"),
          isDefaultButton: true,
          resultValue: "add",
        },
      ]
    );

    dialog.appendStyle(this.constructor.styles);
    dialog.setContent(this.dialogContent);

    const result = await dialog.run();
    if (result === "custom") {
      return { custom: true };
    } else if (result !== "add") {
      return {};
    }

    const allGlyphSetsByURL = {};
    for (const collection of glyphSetPresets) {
      for (const glyphSet of collection.glyphSets) {
        allGlyphSetsByURL[glyphSet.url] = { glyphSet, collection };
      }
    }
    const glyphSets = { ...this.initialGlyphSets };
    for (const [key, value] of Object.entries(this.dialogController.model)) {
      if (!key.startsWith(CHECKBOX_PREFIX)) {
        continue;
      }
      const url = key.slice(CHECKBOX_PREFIX.length);
      if (!url) {
        continue;
      }
      if (value) {
        if (allGlyphSetsByURL[url]) {
          const { glyphSet, collection } = allGlyphSetsByURL[url];
          glyphSets[url] = { ...collection.dataOptions, ...glyphSet };
        }
      } else {
        delete glyphSets[url];
      }
    }
    return { glyphSets };
  }
}

async function runEditGlyphSetDialog(glyphSetInfo) {
  const isEditing = !!glyphSetInfo;
  glyphSetInfo = {
    dataFormat: "glyph-names",
    codePointIsDecimal: false,
    ...glyphSetInfo,
  };
  const dialogController = new ObservableController(glyphSetInfo);

  const validateInput = () => {
    let valid = true;
    let url;
    try {
      url = new URL(dialogController.model.url);
    } catch (e) {
      valid = false;
    }
    if (url?.pathname.length <= 1 || !url?.hostname.includes(".")) {
      valid = false;
    }
    if (!dialogController.model.name) {
      valid;
    }
    // TODO: warningsElement: say what/why it's invalid
    dialog.defaultButton.classList.toggle("disabled", !valid);
  };

  const updateDataFormat = () => {
    dialog.style.setProperty(
      "--glyphset-data-format-tsv-csv-display",
      dialogController.model.dataFormat === "tsv/csv" ? "initial" : "none"
    );
  };

  dialogController.addListener((event) => validateInput());
  dialogController.addKeyListener("dataFormat", (event) => updateDataFormat());

  const dialog = await dialogSetup(
    translate(
      isEditing
        ? "glyph-organizing.glyph-set.edit"
        : "glyph-organizing.glyph-set.add-custom-glyph-set"
    ),
    "",
    [
      { title: translate("dialog.cancel"), isCancelButton: true },
      {
        title: translate(isEditing ? "dialog.save" : "dialog.add"),
        isDefaultButton: true,
        disabled: true,
      },
    ]
  );

  validateInput();
  updateDataFormat();

  const contentStyle = `
  .glyph-set-dialog-content {
    display: grid;
    gap: 0.5em;
    grid-template-columns: max-content auto;
    align-items: center;
    width: 38em;
  }

  .code-point-popup {
    width: max-content;
  }

  .tsv-csv-only {
    display: var(--glyphset-data-format-tsv-csv-display, initial);
  }
  `;

  dialog.appendStyle(contentStyle);

  const codePointIsDecimal = [
    { value: false, label: "Hexadecimal" },
    { value: true, label: "Decimal" },
  ];

  dialog.setContent(
    html.div({ class: "glyph-set-dialog-content" }, [
      ...labeledTextInput("Name", dialogController, "name"),
      ...labeledTextInput("URL", dialogController, "url"),
      ...labeledTextInput("Note", dialogController, "note"),
      ...labeledPopupSelect(
        "Data format",
        dialogController,
        "dataFormat",
        glyphSetDataFormats
      ),
      ...labeledTextInput("Comment characters", dialogController, "commentChars"),
      html.div({ class: "tsv-csv-only" }), // grid cell filler
      labeledCheckbox("Has header", dialogController, "hasHeader", {
        class: "tsv-csv-only",
      }),
      ...labeledTextInput("Glyph name column", dialogController, "glyphNameColumn", {
        class: "tsv-csv-only",
        labelClass: "tsv-csv-only",
      }),
      ...labeledTextInput("Code point column", dialogController, "codePointColumn", {
        class: "tsv-csv-only",
        labelClass: "tsv-csv-only",
      }),
      ...labeledPopupSelect(
        "Code point",
        dialogController,
        "codePointIsDecimal",
        codePointIsDecimal,
        { class: "code-point-popup tsv-csv-only", labelClass: "tsv-csv-only" }
      ),
    ])
  );
  const result = await dialog.run();
  return !!(result && glyphSetInfo.name && glyphSetInfo.url) ? glyphSetInfo : null;
}

export function getGlyphSetsUIControllers(settingsController, accordionId) {
  return [
    new GlyphSetsUIController(settingsController, {
      label: translate("glyph-organizing.project-glyph-sets"),
      id: "project-glyph-sets",
      collectionKey: "projectGlyphSets",
      selectionKey: "projectGlyphSetSelection",
      addGlyphSetToolTip: "Add a glyph set to the project",
      copyToLabel: translate("glyph-organizing.my-glyph-sets"),
      otherCollectionKey: "myGlyphSets",
      accordionId,
    }),
    new GlyphSetsUIController(settingsController, {
      label: translate("glyph-organizing.my-glyph-sets"),
      id: "my-glyph-sets",
      collectionKey: "myGlyphSets",
      selectionKey: "myGlyphSetSelection",
      addGlyphSetToolTip: "Add a glyph set to my sets",
      copyToLabel: translate("glyph-organizing.project-glyph-sets"),
      otherCollectionKey: "projectGlyphSets",
      accordionId,
    }),
  ];
}

import { applicationSettingsController } from "@fontra/core/application-settings.js";
import { getGlyphInfoFromCodePoint } from "@fontra/core/glyph-data.js";
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { features, languages, scripts } from "@fontra/core/opentype-tags.js";
import { checkmark } from "@fontra/core/ui-utils.js";
import "@fontra/web-components/labeled-toggle.js";
import "@fontra/web-components/multi-select-dropdown.js";
import "@fontra/web-components/segmented-control.js";
import { Accordion } from "@fontra/web-components/ui-accordion.js";
import "@fontra/web-components/ui-text-input.js";
import Panel from "./panel.js";

// These features are on by default. See hb-ot-shape.cc
const commonOnFeatures = [
  "abvm",
  "blwm",
  "ccmp",
  "locl",
  "mark",
  "mark-emulated",
  "mkmk",
  "mkmk-emulated",
  "rlig",
  "rvrn",
  "rand",
  "Harf",
  "HARF",
  "Buzz",
  "BUZZ",
];

// These features are on by default for horizontal writing. See hb-ot-shape.cc
const horizontalOnFeatures = new Set([
  ...commonOnFeatures,
  "calt",
  "clig",
  "curs",
  "curs-emulated",
  "dist",
  "kern",
  "kern-emulated",
  "liga",
  "rclt",
]);

// These features are on by default for vertical writing. See hb-ot-shape.cc
const verticalOnFeatures = new Set([...commonOnFeatures, "vert"]);

// HarfBuzz may toggle these features. See hb-ot-shape.cc
const miscDynamicFeatures = [
  "frac", // for automatic fractions
  "numr", // for automatic fractions
  "dnom", // for automatic fractions
  "ltra",
  "ltrm",
  "rtla",
  "rtlm",
  "vkrn",
];

// HarfBuzz may toggle these features. See hb-ot-shaper-*.cc
const dynamicFeatures = new Set([
  ...miscDynamicFeatures,
  "abvf", // indic, khmer, use
  "abvs", // indic, khmer, myanmar, use
  "akhn", // indic, use
  "blwf", // indic, khmer, myanmar, use
  "blws", // indic, khmer, myanmar, use
  // "calt", // arabic, hangul
  // "ccmp", // arabic, indic, khmer, myanmar, use
  "cfar", // khmer
  "cjct", // indic, use
  "clig", // arabic, khmer
  "cswh", // arabic
  "fin2", // arabic
  "fin3", // arabic
  "fina", // arabic, use
  "half", // indic, use
  "haln", // indic, use
  "init", // arabic, indic, use
  "isol", // arabic, use
  "liga", // arabic, indic, khmer. NOTE: khmer turns liga *off*
  "ljmo", // hangul
  // "locl", // arabic, indic, khmer, myanmar, use
  "med2", // arabic
  "medi", // arabic, use
  "mset", // arabic
  "nukt", // indic, use
  "pref", // indic, khmer, myanmar, use
  "pres", // indic, khmer, myanmar, use
  "pstf", // indic, khmer, myanmar, use
  "psts", // indic, khmer, myanmar, use
  // "rclt", // arabic
  "rkrf", // indic, use
  // "rlig", // arabic
  "rphf", // indic, myanmar, use
  "stch", // arabic
  "tjmo", // hangul
  "vatu", // indic, use
  "vjmo", // hangul
]);

// The feature tables listed under the shaping switch, in this order.
const FEATURE_TABLES = ["GSUB", "GPOS-emulated", "GPOS"];

export default class TextEntryPanel extends Panel {
  identifier = "text-entry";
  iconPath = "/images/texttool.svg";

  // Figma 4098:7786: INPUT TEXT and TEXT SHAPING cards.
  static styles = `
    .text-input-card {
      gap: 6px;
    }

    .text-shaping-card {
      gap: 10px;
    }

    .features-errors {
      display: flex;
      align-items: flex-start;
      gap: 4px;
      font: var(--ui-text-label-xs);
      letter-spacing: var(--ui-tracking);
      color: var(--fontra-light-red-color);
      text-decoration: none;
      cursor: pointer;
    }

    .features-errors.hidden {
      display: none;
    }

    .features-errors > inline-svg {
      flex: none;
      width: 12px;
      height: 12px;
    }

    .shaping-header-controls {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .shaping-header-controls > icon-button {
      width: 16px;
      height: 16px;
    }
  `;

  constructor(editorController) {
    super(editorController);

    this.textSettingsController = this.editorController.sceneSettingsController;
    this.sceneController = this.editorController.sceneController;
    this.textSettings = this.editorController.sceneSettingsController.model;

    this.textSettingsController.addKeyListener(
      ["featureSettings", "applyTextShaping", "shaperInfo", "dumbShaperInfo"],
      async (event) => this.updateFeatures(await this.getShaper())
    );

    this.setupTextEntryElement();
    this.setupTextShapingCard();
  }

  getContentElement() {
    // Figma 379:22418: the alignment is the heading's pill segmented control.
    const align = html.createDomElement("segmented-control", {
      options: ["left", "center", "right"].map((value) => ({
        value,
        label: `Align ${value}`,
        icon: `/images/align${value}.svg`,
      })),
      value: this.editorController.sceneSettingsController.model.align,
    });
    align.setAttribute("small", "");
    align.addEventListener("change", (event) => {
      this.textSettings.align = event.detail.value;
    });
    this.editorController.sceneSettingsController.addKeyListener("align", (event) => {
      align.value = event.newValue;
    });

    return html.div({ class: "panel" }, [
      html.div({ class: "panel-section--flex card-column" }, [
        html.div({ class: "card card--headed text-input-card" }, [
          html.div({ class: "card-heading-row" }, [
            html.div({ class: "card-heading" }, ["input text"]),
            align,
          ]),
          html.createDomElement("ui-text-input", {
            id: "text-entry-textarea",
            multiline: true,
          }),
        ]),
        html.div({ class: "card card--headed text-shaping-card" }, [
          html.div({ class: "card-heading-row" }, [
            html.div({ class: "card-heading" }, ["text shaping"]),
          ]),
          html.div({ id: "text-shaping-placeholder" }),
        ]),
      ]),
    ]);
  }

  async getShaper() {
    const applyTextShaping = this.textSettings.applyTextShaping;

    const shaperInfoPromise = applyTextShaping
      ? this.textSettings.shaperInfo
      : this.textSettings.dumbShaperInfo;

    if (!shaperInfoPromise) {
      return null;
    }

    const { shaper, messages, canEmulateSomeGPOS } = await shaperInfoPromise;

    if (applyTextShaping != this.textSettings.applyTextShaping) {
      // The setting was changed since we were called: ignore, or else we may
      // override the correct things that may have been set up before us.
      return;
    }

    const errorMessages = messages.filter((message) => message.level != "warning");
    const numberOfErrorsMessage = errorMessages.length == 1 ? "an error" : "errors";

    this.updateShaperError(
      errorMessages.length
        ? `The OpenType feature code contains ${numberOfErrorsMessage}`
        : null,
      errorMessages[0]
    );

    return shaper;
  }

  setupTextEntryElement() {
    this.textEntryElement = this.contentElement.querySelector("#text-entry-textarea");
    this.textEntryElement.value = this.textSettings.text;

    this.textSettingsController.addKeyListener(
      "text",
      (event) => {
        if (event.senderInfo !== this) {
          this.textEntryElement.value = event.newValue;
        }
        this.adjustTextEntryAlignment();
      },
      true
    );

    this.textEntryElement.addEventListener("input", () => {
      this.textSettingsController.setItem("text", this.textEntryElement.value, this);
      this.textSettings.selectedGlyph = null;
    });
  }

  // TEXT SHAPING (Figma 4098:7879): Direction, Script and Language, then the
  // shaping switch over the features. Off, the features are disabled.
  setupTextShapingCard() {
    this.textSettingsController.addKeyListener("textScript", async (event) => {
      const shaper = await this.getShaper();
      if (shaper) {
        this.updateLanguages(shaper.getScriptAndLanguageInfo());
      }
    });

    this.textScriptOptions = [
      { label: translate("sidebar.text-entry.automatic"), value: null },
    ];
    this.textLanguageOptions = [{ label: "Default (dflt)", value: null }];

    const direction = this._makeDropdown(
      translate("sidebar.text-entry.direction"),
      "textDirection",
      [
        { value: null, label: translate("sidebar.text-entry.automatic") },
        {
          value: "ltr",
          label: translate("sidebar.text-entry.direction.left-to-right"),
        },
        {
          value: "rtl",
          label: translate("sidebar.text-entry.direction.right-to-left"),
        },
      ]
    );
    const script = this._makeDropdown(
      translate("sidebar.text-entry.script"),
      "textScript",
      this.textScriptOptions
    );
    const language = this._makeDropdown(
      translate("sidebar.reference-font.language"),
      "textLanguage",
      this.textLanguageOptions
    );
    this._syncScriptDropdown = script.sync;
    this._syncLanguageDropdown = language.sync;

    this.featuresErrorElement = html.a(
      {
        class: "features-errors hidden",
        href: "", // will get filled in later
        target: `fontra.fontinfo.${this.editorController.projectIdentifier}`,
      },
      [
        html.createDomElement("inline-svg", { src: "/tabler-icons/bug.svg" }),
        html.span({}, [""]),
      ]
    );

    const shapingToggle = html.createDomElement("labeled-toggle", {
      title: translate("sidebar.text-entry.apply-text-shaping"),
    });
    shapingToggle.checked = !!this.textSettings.applyTextShaping;
    shapingToggle.addEventListener("change", () => {
      this.textSettings.applyTextShaping = shapingToggle.checked;
    });
    this.textSettingsController.addKeyListener("applyTextShaping", (event) => {
      shapingToggle.checked = !!event.newValue;
    });

    const resetButton = html.createDomElement("icon-button", {
      "src": "/tabler-icons/refresh.svg",
      "onclick": () => this.resetFeatures(),
      "data-tooltip": translate("sidebar.text-entry.reset-features", "all"),
      "data-tooltipposition": "left",
    });

    this.featuresElement = html.div({ class: "checkmark-wrap" });

    const accordion = new Accordion();
    accordion.setAttribute("switch", "");
    accordion.items = [
      {
        label: translate("sidebar.text-entry.apply-text-shaping"),
        open: true,
        auxiliaryHeaderElement: html.div({ class: "shaping-header-controls" }, [
          resetButton,
          shapingToggle,
        ]),
        content: html.div({}, [
          checkmark(
            applicationSettingsController.model.disableAdHocMarks,
            "Disable ad-hoc mark detection",
            (checked) => {
              applicationSettingsController.model.disableAdHocMarks = checked;
            }
          ),
          this.featuresElement,
        ]),
      },
    ];

    this.contentElement
      .querySelector("#text-shaping-placeholder")
      .replaceWith(
        direction.element,
        script.element,
        language.element,
        this.featuresErrorElement,
        accordion
      );
  }

  // A one-choice dropdown (select/dropdown, Figma 2004:29427) with its label
  // above, kept in step with the scene setting `key`. `options` may change in
  // place; `sync` redraws it.
  _makeDropdown(label, key, options) {
    const element = html.createDomElement("multi-select-dropdown", {
      label,
      labelAbove: true,
      singleChoice: true,
    });
    const sync = () => {
      element.items = options.map((option) => ({
        value: option.value ?? "",
        label: option.label,
        checked: (option.value ?? "") === (this.textSettings[key] ?? ""),
      }));
    };
    sync();
    element.addEventListener("change", (event) => {
      this.textSettings[key] = event.detail.checked || null;
    });
    this.textSettingsController.addKeyListener(key, sync);
    return { element, sync };
  }

  async resetFeatures() {
    const shaper = await this.getShaper();
    if (!shaper) {
      return;
    }
    const featureSettings = { ...this.textSettings.featureSettings };
    for (const tableTag of FEATURE_TABLES) {
      for (const featureTag of Object.keys(shaper.getFeatureInfo(tableTag))) {
        delete featureSettings[featureTag];
      }
    }
    this.textSettings.featureSettings = featureSettings;
  }

  updateShaperError(error, errorMessage) {
    this.featuresErrorElement.classList.toggle("hidden", !error);
    this.featuresErrorElement.querySelector("span").innerText = error ?? "";

    if (errorMessage) {
      const opentypeFeaturesURL = new URL(window.location);
      opentypeFeaturesURL.pathname = "fontinfo.html";
      opentypeFeaturesURL.hash = `#opentype-feature-code-panel#C${errorMessage.span[0]}-${errorMessage.span[1]}`;
      this.featuresErrorElement.href = opentypeFeaturesURL;
    }
  }

  updateFeatures(shaper) {
    if (!shaper) {
      return;
    }

    const scriptAndLanguageInfo = shaper.getScriptAndLanguageInfo();

    this.textScriptOptions.splice(
      0,
      Infinity,
      { label: translate("sidebar.text-entry.automatic"), value: null },
      ...Object.keys(scriptAndLanguageInfo).map((script) => ({
        label: `${scripts[script] ?? script} (${script.trim()})`,
        value: script,
      }))
    );
    this._syncScriptDropdown();

    if (
      this.textSettings.textScript &&
      !this.textScriptOptions.find(
        (item) => item.value === this.textSettings.textScript
      )
    ) {
      this.textSettings.textScript = null;
    }

    this.updateLanguages(scriptAndLanguageInfo);

    const disabled = !this.textSettings.applyTextShaping;
    const controls = [];
    for (const tableTag of FEATURE_TABLES) {
      const info = shaper.getFeatureInfo(tableTag);
      for (const tag of Object.keys(info).sort()) {
        const cleanTag = tag.slice(0, 4); // strip "-emulated"
        const [featureDescription] = features[cleanTag] ?? [""];
        const label = info[tag]?.uiLabelName || featureDescription || cleanTag;

        // TODO: fix this for vertical layout once we support it.
        const emulateDefaultValue = info[tag]?.defaultOn ?? true;
        const defaultValue =
          horizontalOnFeatures.has(tag) && emulateDefaultValue
            ? true
            : dynamicFeatures.has(tag)
              ? undefined
              : false;

        controls.push(
          featureControl(this.textSettingsController, tag, label, {
            defaultValue,
            disabled,
          })
        );
      }
    }
    this.featuresElement.replaceChildren(...controls);
  }

  updateLanguages(scriptAndLanguageInfo) {
    const { textScript, textLanguage } = this.textSettingsController.model;
    const languages = textScript ? scriptAndLanguageInfo[textScript] || [] : [];
    const languageOptions = languages.map((language) => ({
      label: `${languages[language] || language} (${language.trim()})`,
      value: language,
    }));

    if (textLanguage && !languages.includes(textLanguage)) {
      this.textSettingsController.model.textLanguage = null;
    }

    this.textLanguageOptions.splice(1, Infinity, ...languageOptions);
    this._syncLanguageDropdown();
  }

  adjustTextEntryAlignment() {
    if (!this.textEntryElement.value) {
      return;
    }
    // Set the writing direction based on the first Letter in the text
    for (const char of this.textEntryElement.value) {
      const codePoint = char.codePointAt(0);
      const info = getGlyphInfoFromCodePoint(codePoint);
      if (info?.category === "Letter") {
        this.textEntryElement.dir = info?.direction == "RTL" ? "rtl" : "ltr";
        break;
      }
    }
  }

  focusTextEntry() {
    this.textEntryElement.focus();
  }

  async toggle(on, focus) {
    if (focus) {
      this.focusTextEntry();
    }
  }
}

// One feature's control, its tag in the tooltip. A feature HarfBuzz may switch
// by itself (no default) has three states -- automatic, on, off -- and is a
// segmented control; any other is a checkmark. A state equal to the default is
// not stored.
function featureControl(controller, featureTag, label, { defaultValue, disabled }) {
  const controllerKey = "featureSettings";
  const state = controller.model[controllerKey]?.[featureTag];
  const tooltip = featureTag.replace("-emulated", " (emulated)");

  const setState = (newState) => {
    const features = { ...controller.model[controllerKey] };
    if (newState !== defaultValue && newState !== undefined) {
      features[featureTag] = newState;
    } else {
      delete features[featureTag];
    }
    controller.model[controllerKey] = features;
  };

  if (defaultValue !== undefined) {
    return checkmark(state ?? defaultValue, label, setState, { disabled, tooltip });
  }

  const states = { auto: undefined, on: true, off: false };
  const control = html.createDomElement("segmented-control", {
    options: Object.keys(states).map((value) => ({ value, label: value })),
    value: state === undefined ? "auto" : state ? "on" : "off",
  });
  control.setAttribute("small", "");
  control.disabled = disabled;
  control.addEventListener("change", (event) => setState(states[event.detail.value]));
  return html.div({ "class": "segmented-row", "data-tooltip": tooltip }, [
    html.span({}, [label]),
    control,
  ]);
}

customElements.define("panel-text-entry", TextEntryPanel);

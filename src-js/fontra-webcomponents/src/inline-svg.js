// This isn't really a web component, just a custom element.

import { htmlToElement } from "@fontra/core/html-utils.js";
import { iconPath } from "@fontra/core/icons.js";

export class InlineSVG extends HTMLElement {
  constructor(src) {
    super();
    if (src) {
      this.setAttribute("src", src);
    }
  }

  static get observedAttributes() {
    return ["src"];
  }

  get src() {
    return this.getAttribute("src");
  }

  set src(value) {
    return this.setAttribute("src", value);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "src") {
      if (newValue) {
        this.fetchSVG(newValue);
      } else {
        this.innerHTML = "";
      }
    }
  }

  async fetchSVG(svgSRC) {
    const svgElement = (await cachedSVGElement(iconPath(svgSRC))).cloneNode(true);
    if (this.getAttribute("src") !== svgSRC) {
      return; // The icon changed while this one loaded.
    }
    this.replaceChildren(svgElement);
  }
}

// One download and one parse per icon file: icons that appear together share
// the pending download, and each one gets a copy of the parsed picture.
const svgElementCache = new Map();

function cachedSVGElement(svgSRC) {
  let svgElement = svgElementCache.get(svgSRC);
  if (!svgElement) {
    svgElement = fetch(svgSRC)
      .then((response) => response.text())
      .then((svgData) => {
        const element = htmlToElement(svgData);
        element.removeAttribute("width");
        element.removeAttribute("height");
        return element;
      })
      .catch((error) => {
        svgElementCache.delete(svgSRC); // A later icon tries again.
        throw error;
      });
    svgElementCache.set(svgSRC, svgElement);
  }
  return svgElement;
}

customElements.define("inline-svg", InlineSVG);

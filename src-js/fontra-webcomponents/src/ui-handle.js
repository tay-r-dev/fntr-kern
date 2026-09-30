import { UnlitElement } from "@fontra/core/html-utils.js";

// handle (Figma 379:22492): the small white tab with a 4x2 dot grid that
// sits on the bottom edge of a resizable box -- a table's scroll box, a
// multi-line text input. It grows a little and its shadow deepens on hover
// ("hover3"). The two looks are the design's own SVGs.
//
// The element only draws. Its owner places it (centred on its bottom edge)
// and listens for "handle-drag": pointerdown captures the pointer, and every
// move reports {dy} since the press in event.detail; "handle-drag-end"
// follows the release.
//
// `size` is "M" (28x8, the default) or "S" (26x7, the one input/text
// carries), a plain JS property like every UnlitElement component here.
export class UIHandle extends UnlitElement {
  static styles = `
    :host {
      display: block;
      width: 28px;
      height: 8px;
      cursor: row-resize;
      touch-action: none;
      background: url("/images/handle-rest.svg") center bottom / 28px 8.5px no-repeat;
      /* The SVG's shadow sits above its box. */
      overflow: visible;
    }

    :host(:hover),
    :host([dragging]) {
      background-image: url("/images/handle-hover.svg");
      background-size: 28px 9px;
    }

    :host([data-size="S"]) {
      width: 26px;
      height: 7px;
      background-image: url("/images/handle-input.svg");
      background-size: 26px 8px;
    }

    :host([data-size="S"]:hover),
    :host([data-size="S"][dragging]) {
      background-image: url("/images/handle-hover.svg");
      background-size: 26px 8.4px;
    }
  `;

  static properties = {
    size: { type: String },
  };

  constructor() {
    super();
    this.addEventListener("pointerdown", (event) => this._startDrag(event));
  }

  render() {
    this.setAttribute("data-size", this.size === "S" ? "S" : "M");
  }

  _startDrag(event) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    this.setPointerCapture(event.pointerId);
    this.toggleAttribute("dragging", true);
    this.dispatchEvent(new CustomEvent("handle-drag-start", { bubbles: true }));
    const onMove = (moveEvent) => {
      this.dispatchEvent(
        new CustomEvent("handle-drag", {
          bubbles: true,
          detail: { dy: moveEvent.clientY - startY },
        })
      );
    };
    const onEnd = () => {
      this.removeEventListener("pointermove", onMove);
      this.removeEventListener("pointerup", onEnd);
      this.removeEventListener("lostpointercapture", onEnd);
      this.toggleAttribute("dragging", false);
      this.dispatchEvent(new CustomEvent("handle-drag-end", { bubbles: true }));
    };
    this.addEventListener("pointermove", onMove);
    this.addEventListener("pointerup", onEnd);
    this.addEventListener("lostpointercapture", onEnd);
  }
}

customElements.define("ui-handle", UIHandle);

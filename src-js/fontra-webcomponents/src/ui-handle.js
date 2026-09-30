import { UnlitElement } from "@fontra/core/html-utils.js";

// handle (Figma 379:22492): the small white tab with a 4x2 dot grid that
// sits on the bottom edge of a resizable box -- a table's scroll box, a
// multi-line text input. Its look is the design's rest SVG with a hairline
// added round the top and sides and a slightly deeper shadow
// (/images/handle-edge.svg); the owner keeps it above its own edge.
//
// The element only draws. Its owner places it (centred on its bottom edge)
// and listens for "handle-drag": pointerdown captures the pointer, and every
// move reports {dy} since the press in event.detail; "handle-drag-end"
// follows the release.
//
// `size` is "M" (56x16, the default) or "S" (52x15, the one input/text
// carries), a plain JS property like every UnlitElement component here.
export class UIHandle extends UnlitElement {
  // Drawn at twice the design's size, so it is easy to take hold of, with a
  // hairline round its top and sides and a soft shadow, so it reads as a tab
  // laid over the field's edge. It does not change on hover.
  static styles = `
    :host {
      display: block;
      z-index: 2;
      width: 56px;
      height: 16px;
      cursor: row-resize;
      touch-action: none;
      background: url("/images/handle-edge.svg") center bottom / 56px 17px no-repeat;
      /* The SVG's shadow sits above its box. */
      overflow: visible;
    }

    :host([data-size="S"]) {
      width: 52px;
      height: 15px;
      background-size: 52px 15.8px;
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

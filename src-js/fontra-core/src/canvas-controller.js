import { normalizeRect, rectCenter, validateRect } from "./rectangle.ts";
import { assert, clamp, consolidateCalls, isNumber, withSavedState } from "./utils.ts";

const DEFAULT_MIN_MAGNIFICATION = 0.005;
const DEFAULT_MAX_MAGNIFICATION = 200;

export class CanvasController {
  constructor(canvas, magnificationChangedCallback) {
    this.canvas = canvas; // The HTML5 Canvas object
    this.context = canvas.getContext("2d");
    this.sceneView = undefined; // will be set later

    this.magnification = 1;
    this.origin = { x: this.canvasWidth / 2, y: 0.85 * this.canvasHeight }; // TODO choose y based on initial canvas height

    this._minMagnification = DEFAULT_MIN_MAGNIFICATION;
    this._maxMagnification = DEFAULT_MAX_MAGNIFICATION;

    this._magnificationChangedCallback = magnificationChangedCallback;

    const resizeObserver = new ResizeObserver((entries) => {
      this.setupSize();
      this.draw();
      // console.log('Size changed');
    });
    resizeObserver.observe(this.canvas.parentElement);

    this._setupScrollBlocker();

    canvas.addEventListener("wheel", (event) => this.handleWheel(event));

    // Safari pinch zoom:
    canvas.addEventListener("gesturestart", (event) =>
      this.handleSafariGestureStart(event)
    );
    canvas.addEventListener("gesturechange", (event) =>
      this.handleSafariGestureChange(event)
    );
    canvas.addEventListener("gestureend", (event) =>
      this.handleSafariGestureEnd(event)
    );

    // canvas.addEventListener("mousedown", async (e) => this.testing(e));
    // canvas.addEventListener("scroll", this.onEvent.bind(this));
    // canvas.addEventListener("touchstart", this.onEvent.bind(this), false);
    // canvas.addEventListener("touchmove", this.onEvent.bind(this), false);
    // canvas.addEventListener("touchend", this.onEvent.bind(this), false);
    // canvas.addEventListener("pointerdown", async (e) => this.testing(e), false);
    // canvas.addEventListener("pointermove", this.onEvent.bind(this), false);
    // canvas.addEventListener("pointerup", this.onEvent.bind(this), false);
    // canvas.addEventListener("pointercancel", this.onEvent.bind(this), false);

    this.setupSize();
    this.requestUpdate = consolidateCalls(() => this.draw());
    this.requestUpdate();
  }

  _setupScrollBlocker() {
    this._initialScrollTarget = null;
    this._scrollTimerID = null;

    document.addEventListener("wheel", (event) => {
      clearTimeout(this._scrollTimerID);
      if (!this._initialScrollTarget) {
        this._initialScrollTarget = event.target;
      }
      this._scrollTimerID = setTimeout(() => {
        this._initialScrollTarget = null;
      }, 100);
    });
  }

  _shouldBlockScroll(event) {
    return this._initialScrollTarget && this._initialScrollTarget !== this.canvas;
  }

  get canvasWidth() {
    const w = this.canvas.parentElement.getBoundingClientRect().width;
    assert(isNumber(w));
    return w;
  }

  get canvasHeight() {
    const h = this.canvas.parentElement.getBoundingClientRect().height;
    assert(isNumber(h));
    return h;
  }

  // Bug fix (kerning view, task 1): localPoint/getViewBox/setupSize used to
  // read canvas.parentElement.offsetLeft/offsetTop and treat them as if they
  // were the container's position relative to the VIEWPORT -- which is only
  // true when there is exactly one positioned ancestor between the canvas
  // container and the page's own top-left corner (editor.js's own layout
  // happens to have exactly that: .main-container's offsetParent,
  // .editor-container, itself sits flush at the viewport's origin, so
  // .main-container's offsetLeft/offsetTop happen to equal its real on-screen
  // position). offsetLeft/offsetTop are only ever relative to the nearest
  // POSITIONED ancestor (the element's own offsetParent), not the viewport --
  // they silently read 0 whenever an extra positioned wrapper sits between
  // the canvas container and the viewport, which is exactly what
  // views-kerning's three-column CSS grid introduces (#kerning-middle-top,
  // itself position:relative, becomes #kerning-view-container's offsetParent,
  // so its offsetLeft/offsetTop read 0 even though the whole middle column is
  // pushed right by the left sidebar's width). getBoundingClientRect() is
  // always relative to the viewport regardless of how many positioned
  // ancestors sit in between, which is why canvasWidth/canvasHeight above
  // already use it -- this getter reuses the same call so every consumer of
  // the container's screen position (this getter, localPoint, getViewBox)
  // agrees on one, DOM-nesting-independent source of truth.
  get canvasRect() {
    return this.canvas.parentElement.getBoundingClientRect();
  }

  get devicePixelRatio() {
    // return 1;  // To test normal resolution on Retina displays
    return window.devicePixelRatio;
  }

  setupSize() {
    const width = this.canvasWidth;
    const height = this.canvasHeight;
    const scale = this.devicePixelRatio;

    // We want to be sure that we have at least enough pixels to cover the
    // entire area of the canvas, accounting for dpi and browser scaling.
    //
    // To do this, we take the ceiling of the CSS pixel width and height
    // values multiplied by the pixel ratio, which is a number that should
    // be guaranteed to be equal to or greater than the final number of screen
    // pixels that the canvas element (or rather its container) takes up.
    this.canvas.width = Math.ceil(width * scale);
    this.canvas.height = Math.ceil(height * scale);

    // We then take those numbers and divide them back down by the scale
    // and tell the browser to display the canvas at that many CSS pixels
    // wide and tall. This should ensure that there is a 1 to 1 mapping
    // between pixels in the canvas's data buffer and pixels as displayed
    // on screen for the user.
    //
    // If we didn't do this, and just used the container's size, then the
    // browser might end up stretching the canvas data very slightly to
    // make it fit the final size. This isn't ideal but usually isn't
    // noticeable except in Safari where the scaling is switched to
    // nearest neighbor if the texture is more than 2K pixels wide,
    // which can cause a column or row of pixels in the center of
    // the canvas to be repeated and it's very noticeable.
    this.canvas.style.width = this.canvas.width / scale + "px";
    this.canvas.style.height = this.canvas.height / scale + "px";

    // See the canvasRect getter's comment above: viewport-relative, not
    // offsetParent-relative, so this scroll-position-preserving delta stays
    // correct regardless of how many positioned ancestors sit between the
    // canvas container and the viewport (e.g. a column-splitter drag in a
    // view like views-kerning that nests an extra positioned wrapper).
    const parentOffsetX = this.canvasRect.left;
    const parentOffsetY = this.canvasRect.top;

    if (this.previousOffsets) {
      // Try to keep the scroll position constant relative to the
      // parent container
      const dx = this.previousOffsets["parentOffsetX"] - parentOffsetX;
      const dy = this.previousOffsets["parentOffsetY"] - parentOffsetY;
      assert(isNumber(dx));
      assert(isNumber(dy));
      this.origin.x += dx;
      this.origin.y += dy;
    }
    this.previousOffsets = { parentOffsetX, parentOffsetY };
    this._dispatchEvent("viewBoxChanged", "canvas-size");
  }

  draw() {
    const scale = this.devicePixelRatio;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.sceneView) {
      return;
    }
    withSavedState(this.context, () => {
      this.context.scale(scale, scale);
      this.context.translate(this.origin.x, this.origin.y);
      this.context.scale(this.magnification, -this.magnification);
      this.sceneView.draw(this);
    });
  }

  setLangAttribute(lang) {
    this.canvas.setAttribute("lang", lang.trim() || "en");
    this.requestUpdate();
  }

  // Event handlers

  handleWheel(event) {
    event.preventDefault();

    if (this._shouldBlockScroll(event)) {
      // The scroll didn't start in the canvas: ignore
      return;
    }

    let { deltaX, deltaY, wheelDeltaX, wheelDeltaY } = event;
    // We try to detect whether the event comes from a "clunky" scroll wheel, one
    // that outputs rather large values for deltaY (this appears to be common on
    // Windows), so we can scale down to keep zoom speed and scroll speed in check.
    assert(isNumber(deltaX));
    assert(isNumber(deltaY));
    const clunkyScrollWheel =
      Math.abs(deltaY) > 50 && Math.abs(wheelDeltaY / deltaY) < 2;
    if (event.ctrlKey || event.altKey) {
      // Note: wheel events with ctrlKey down is *also* how zoom gestures on trackpads
      // are received, on both Windows and macOS.
      const scaleDown = clunkyScrollWheel ? 500 : event.ctrlKey ? 100 : 300;
      this._doPinchMagnify(event, 1 - deltaY / scaleDown);
    } else {
      const scaleDown = clunkyScrollWheel ? 3 : 1;
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        this.origin.x -= deltaX / scaleDown;
      } else {
        this.origin[event.shiftKey ? "x" : "y"] -= deltaY / scaleDown;
      }
      this.requestUpdate();
      this._dispatchEvent("viewBoxChanged", "origin");
    }
  }

  handleSafariGestureStart(event) {
    event.preventDefault();
    this._initialMagnification = this.magnification;
    this._doPinchMagnify(event, event.scale);
  }

  handleSafariGestureChange(event) {
    event.preventDefault();
    const zoomFactor = (this._initialMagnification * event.scale) / this.magnification;
    this._doPinchMagnify(event, zoomFactor);
  }

  handleSafariGestureEnd(event) {
    event.preventDefault();
    delete this._initialMagnification;
  }

  _clampMagnification() {
    const oldMagnification = this.magnification;
    this.magnification = clamp(
      this.magnification,
      this._minMagnification,
      this._maxMagnification
    );

    if (this.magnification !== oldMagnification) {
      this._magnificationChangedCallback?.(this.magnification);
      this.requestUpdate();
      this._dispatchEvent("viewBoxChanged", "magnification");
    }
  }

  set minMagnification(newValue) {
    // If there's no change then we don't have to do anything.
    if (newValue == this._minMagnification) {
      return;
    }

    this._minMagnification = newValue;

    this._clampMagnification();
  }

  set maxMagnification(newValue) {
    // If there's no change then we don't have to do anything.
    if (newValue == this._maxMagnification) {
      return;
    }

    this._maxMagnification = newValue;

    this._clampMagnification();
  }

  get minMagnification() {
    return this._minMagnification;
  }

  get maxMagnification() {
    return this._maxMagnification;
  }

  _doPinchMagnify(event, zoomFactor) {
    assert(isNumber(zoomFactor));
    const center = this.localPoint({ x: event.pageX, y: event.pageY });
    const prevMagnification = this.magnification;

    this.magnification = this.magnification * zoomFactor;
    this.magnification = clamp(
      this.magnification,
      this.minMagnification,
      this.maxMagnification
    );
    zoomFactor = this.magnification / prevMagnification;

    // adjust origin
    this.origin.x += (1 - zoomFactor) * center.x * prevMagnification;
    this.origin.y -= (1 - zoomFactor) * center.y * prevMagnification;
    this._magnificationChangedCallback?.(this.magnification);
    this.requestUpdate();
    this._dispatchEvent("viewBoxChanged", "magnification");
  }

  onEvent(event) {
    console.log(event.type, event);
    event.preventDefault();
  }

  async testing(event) {
    console.log("testing async 1");
    await new Promise((r) => setTimeout(r, 500));
    console.log("testing async 2");
  }

  // helpers

  localPoint(event) {
    if (event.x === undefined) {
      event = { x: event.pageX, y: event.pageY };
    }
    // See the canvasRect getter's comment above for why this is
    // getBoundingClientRect()-based rather than offsetLeft/offsetTop-based:
    // event.x/event.y (clientX/clientY on a real MouseEvent) are always
    // viewport-relative, and offsetLeft/offsetTop are not (they are relative
    // to the nearest positioned ancestor, which is not necessarily the
    // viewport's own origin).
    const rect = this.canvasRect;
    const x = (event.x - rect.left - this.origin.x) / this.magnification;
    const y = -(event.y - rect.top - this.origin.y) / this.magnification;

    assert(isNumber(x));
    assert(isNumber(y));
    return { x, y };
  }

  canvasPoint(point) {
    const x = point.x * this.magnification + this.origin.x;
    const y = -point.y * this.magnification + this.origin.y;
    assert(isNumber(x));
    assert(isNumber(y));
    return { x, y };
  }

  get onePixelUnit() {
    return 1 / this.magnification;
  }

  getViewBox() {
    const width = this.canvasWidth;
    const height = this.canvasHeight;
    // Same fix as localPoint above: viewport-relative, not offsetParent-
    // relative, so this composes correctly with the now-also-viewport-
    // relative localPoint() below.
    const rect = this.canvasRect;
    const left = rect.left;
    const top = rect.top;
    const bottomLeft = this.localPoint({ x: 0 + left, y: 0 + top });
    const topRight = this.localPoint({ x: width + left, y: height + top });
    const viewBox = normalizeRect({
      xMin: bottomLeft.x,
      yMin: bottomLeft.y,
      xMax: topRight.x,
      yMax: topRight.y,
    });
    validateRect(viewBox);
    return viewBox;
  }

  isActualViewBox(viewBox) {
    const canvasCenter = this.canvasPoint(rectCenter(viewBox));
    return (
      this.magnification === this._getProposedViewBoxMagnification(viewBox) &&
      Math.round(this.origin.x) ===
        Math.round(this.canvasWidth / 2 + this.origin.x - canvasCenter.x) &&
      Math.round(this.origin.y) ===
        Math.round(this.canvasHeight / 2 + this.origin.y - canvasCenter.y)
    );
  }

  setViewBox(viewBox) {
    validateRect(viewBox);
    this.magnification = this._getProposedViewBoxMagnification(viewBox);
    const canvasCenter = this.canvasPoint(rectCenter(viewBox));
    this.origin.x = this.canvasWidth / 2 + this.origin.x - canvasCenter.x;
    this.origin.y = this.canvasHeight / 2 + this.origin.y - canvasCenter.y;
    this._magnificationChangedCallback?.(this.magnification);
    this.requestUpdate();
    this._dispatchEvent("viewBoxChanged", "set-view-box");
  }

  getProposedViewBoxClampAdjustment(viewBox) {
    const magnification = this._getProposedViewBoxMagnification(viewBox);
    if (magnification < this.minMagnification) {
      return magnification / this.minMagnification;
    } else if (magnification > this.maxMagnification) {
      return magnification / this.maxMagnification;
    }
    return 1;
  }

  _getProposedViewBoxMagnification(viewBox) {
    validateRect(viewBox);
    const width = this.canvasWidth;
    const height = this.canvasHeight;
    assert(isNumber(width));
    assert(isNumber(height));
    const magnificationX = Math.abs(width / (viewBox.xMax - viewBox.xMin));
    const magnificationY = Math.abs(height / (viewBox.yMax - viewBox.yMin));
    return Math.min(magnificationX, magnificationY);
  }

  _dispatchEvent(eventName, detail) {
    const event = new CustomEvent(eventName, {
      bubbles: false,
      detail: detail,
    });
    this.canvas.dispatchEvent(event);
  }
}

// A scrub that the window edge does not stop, the way Figma's does. Once a
// press becomes a drag, the pointer is locked to the element and hidden, and a
// stand-in cursor is drawn instead. The stand-in leaves one edge of the window
// and comes back in at the opposite one, while the travel keeps counting.
//
// Where the browser refuses the lock, the drag goes on as a plain captured
// drag and the edge stops it again.
//
// ponytail: movementX is taken as CSS pixels. Some Chrome builds on scaled
// Windows displays report device pixels; divide by devicePixelRatio if the
// scrub feels too fast there.
export class LoopedScrub {
  constructor(element) {
    this.element = element;
    this.cursor = null;
    this.x = 0;
    this.y = 0;
  }

  // Call once, when the press has become a drag.
  begin(event) {
    this.x = event.clientX;
    this.y = event.clientY;
    this.lastX = event.clientX;
    try {
      const request = this.element.requestPointerLock?.();
      request?.catch?.(() => {});
    } catch (error) {
      // No lock: the drag stays a captured drag.
    }
  }

  get locked() {
    return document.pointerLockElement === this.element;
  }

  // The sideways travel of one move, in pixels.
  delta(event) {
    if (!this.locked) {
      const dx = event.clientX - this.lastX;
      this.lastX = event.clientX;
      return dx;
    }
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.x = (((this.x + event.movementX) % width) + width) % width;
    this.y = (((this.y + event.movementY) % height) + height) % height;
    this._drawCursor();
    return event.movementX;
  }

  end() {
    if (this.locked) {
      document.exitPointerLock();
    }
    this.cursor?.remove();
    this.cursor = null;
  }

  _drawCursor() {
    if (!this.cursor) {
      this.cursor = document.createElement("img");
      this.cursor.src = "/tabler-icons/arrows-horizontal.svg";
      this.cursor.style.cssText =
        "position: fixed; width: 20px; height: 20px; margin: -10px 0 0 -10px;" +
        " pointer-events: none; z-index: 100000;";
      document.body.appendChild(this.cursor);
    }
    this.cursor.style.left = `${this.x}px`;
    this.cursor.style.top = `${this.y}px`;
  }
}

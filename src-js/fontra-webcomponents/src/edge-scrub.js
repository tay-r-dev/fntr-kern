// A scrub that the screen edge does not stop. While the pointer is held
// against the left or right edge of the window, the value keeps moving on its
// own, in the direction of that edge, until the hand comes back.
//
// The browser cannot move a cursor past the edge of the screen. The one
// mechanism that reports travel past it, a pointer lock, makes the browser
// show a blocking notice for as long as the lock is held, on every drag that
// reaches an edge. So the travel past the edge is counted from time instead
// of from the hand, and nothing is locked.
//
// ponytail: a hand that stops pushing but stays against the edge keeps the
// value moving, the same way an edge-scroll does. Back off one pixel and it
// stops.
const EDGE_TICK_MS = 16;
const EDGE_PIXELS_PER_TICK = 4;

export class EdgeScrub {
  // `onEdgeTravel` is called with a sideways travel in pixels, the same unit
  // `delta` returns, for as long as the pointer stays against an edge.
  constructor(element, onEdgeTravel) {
    this.element = element;
    this.onEdgeTravel = onEdgeTravel;
    this.lastX = 0;
    this._direction = 0;
    this._timer = null;
  }

  // Call once, when the press has become a drag.
  begin(event) {
    this.lastX = event.clientX;
  }

  // The sideways travel of one move, in pixels.
  delta(event) {
    const dx = event.clientX - this.lastX;
    this.lastX = event.clientX;
    // Pointer capture keeps the events arriving after the pointer has left the
    // window, so a window edge is not an edge. What counts is the cursor going
    // nowhere: it sits at the edge and the move did not move it.
    let direction = 0;
    if (dx === 0) {
      if (event.clientX <= 0) {
        direction = -1;
      } else if (event.clientX >= window.innerWidth - 1) {
        direction = 1;
      }
    }
    this._setEdge(direction);
    return dx;
  }

  end() {
    this._setEdge(0);
  }

  _setEdge(direction) {
    if (direction === this._direction) {
      return;
    }
    this._direction = direction;
    clearInterval(this._timer);
    this._timer = null;
    if (direction) {
      this._timer = setInterval(
        () => this.onEdgeTravel?.(direction * EDGE_PIXELS_PER_TICK),
        EDGE_TICK_MS
      );
    }
  }
}

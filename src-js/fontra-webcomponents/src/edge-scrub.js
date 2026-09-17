// A scrub that the screen edge does not stop. While the cursor is held
// against the left or right edge of the window, every further move still
// counts as travel in the direction of that edge.
//
// The browser cannot move a cursor past the edge of the screen. The one
// mechanism that reports travel past it, a pointer lock, makes the browser
// show a blocking notice for as long as the lock is held, on every drag that
// reaches an edge. So the travel past the edge is counted one step per move
// instead, and nothing is locked. A hand that stops moving sends no moves and
// the value stands still.
//
// ponytail: a move dead against the edge with no cross travel at all reports
// nothing, so nothing counts. Real hands shake enough; a mouse driven by a
// script does not.
const EDGE_PIXELS_PER_MOVE = 4;

export class EdgeScrub {
  constructor(element) {
    this.element = element;
    this.lastX = 0;
  }

  // Call once, when the press has become a drag.
  begin(event) {
    this.lastX = event.clientX;
  }

  // The sideways travel of one move, in pixels.
  delta(event) {
    const dx = event.clientX - this.lastX;
    this.lastX = event.clientX;
    if (dx) {
      return dx;
    }
    // Pointer capture keeps the events arriving after the pointer has left the
    // window, so a window edge is not an edge. What counts is the cursor going
    // nowhere: it sits at the edge and the move did not move it.
    if (event.clientX <= 0) {
      return -EDGE_PIXELS_PER_MOVE;
    }
    if (event.clientX >= window.innerWidth - 1) {
      return EDGE_PIXELS_PER_MOVE;
    }
    return 0;
  }

  end() {}
}

// The design's scrollbars, drawn rather than native: browsers differ in what
// they let a page style (Firefox: no thinner than its "thin", no hover
// colour, no arrows), so a scroll box hides its own and these are drawn
// beside it. A 2px thumb in line 2, line 4 under the pointer, an arrow
// triangle at each end in the same colours, no track and no fill
// (shared.css's .scrollbar-rail). The box scrolls natively as before: wheel,
// keys and touch are the browser's; only the bars are ours.

const MIN_THUMB = 16;
// A rail's strip across (shared.css's .scrollbar-rail).
const RAIL = 8;
const ARROW_STEP = 40;
// A wheel 'line' (Firefox's delta mode 1), in pixels.
const WHEEL_LINE = 16;
const ARROW_REPEAT_DELAY = 300;
const ARROW_REPEAT_INTERVAL = 50;
const REVEAL_DELAY = 500;

// The thumb along a track of `trackLength`: as long as the share of the
// content shown (never under MIN_THUMB), at the scroll's place along it.
// Hidden while everything fits.
export function scrollbarThumb(scroll, scrollSize, clientSize, trackLength) {
  const range = scrollSize - clientSize;
  if (range <= 1 || trackLength <= 0) {
    return { visible: false, length: 0, offset: 0 };
  }
  const length = Math.min(
    trackLength,
    Math.max(MIN_THUMB, (trackLength * clientSize) / scrollSize)
  );
  const travel = trackLength - length;
  const offset =
    travel > 0 ? (Math.min(Math.max(scroll, 0), range) / range) * travel : 0;
  return { visible: true, length, offset };
}

// The scroll that puts the thumb at `offset` along its track.
export function scrollForThumbOffset(offset, scrollSize, clientSize, trackLength) {
  const range = scrollSize - clientSize;
  const { length } = scrollbarThumb(0, scrollSize, clientSize, trackLength);
  const travel = trackLength - length;
  if (range <= 0 || travel <= 0) {
    return 0;
  }
  return Math.min(Math.max(offset / travel, 0), 1) * range;
}

// Draws a vertical and a horizontal bar for `box`, a scroll box. The bars go
// beside it in its parent, which is made a positioning box if it is not one.
// `reveal: "hover"` keeps them hidden until the pointer has rested on a bar's
// strip for REVEAL_DELAY, and hides them once it leaves (a panel's column).
// Returns { update, setReserve }: `setReserve(px)` keeps a strip that high
// under the content for the sideways bar, scrolling or not, so it never
// covers a row.
export function attachScrollbars(box, { reveal = "always", reserve = 0 } = {}) {
  // A box has one pair of bars: a second call hands back the first pair,
  // hidden until rested on if this call asks for that.
  const attached = attachedScrollbars.get(box);
  if (attached) {
    if (reveal === "hover") {
      attached.revealOnRest();
    }
    return attached;
  }
  box.classList.add("drawn-scrollbars");
  const bars = [makeBar(box, "vertical"), makeBar(box, "horizontal")];
  let reserved = 0;
  let positionedHolder = null;

  const updateNow = () => {
    const parent = box.parentNode;
    if (!parent || !box.isConnected) {
      return;
    }
    for (const bar of bars) {
      if (bar.rail.parentNode !== parent) {
        parent.insertBefore(bar.rail, box.nextSibling);
      }
    }
    const holder = parent instanceof ShadowRoot ? parent.host : parent;
    if (holder !== positionedHolder) {
      positionedHolder = holder;
      if (getComputedStyle(holder).position === "static") {
        holder.style.position = "relative";
      }
    }
    const [vertical, horizontal] = bars;
    const both =
      box.scrollHeight - box.clientHeight > 1 && box.scrollWidth - box.clientWidth > 1;
    // Where both show, each stops short of the other's corner.
    vertical.place(both ? reserved || RAIL : 0);
    horizontal.place(both ? RAIL : 0, reserved);
  };

  // Scrolls, resizes and new contents all ask for one placing per frame: the
  // layout is read once, when the frame is drawn, not on every event.
  let frame = 0;
  const update = () => {
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateNow();
      });
    }
  };

  let revealing = false;
  const revealOnRest = () => {
    if (!revealing) {
      revealing = true;
      for (const bar of bars) {
        bar.revealOnRest();
      }
    }
  };
  if (reveal === "hover") {
    revealOnRest();
  }

  box.addEventListener("scroll", update, { passive: true });
  const resizeObserver = new ResizeObserver(update);
  resizeObserver.observe(box);
  const observeChildren = () => {
    for (const child of box.children) {
      resizeObserver.observe(child);
    }
  };
  observeChildren();
  new MutationObserver((records) => {
    for (const record of records) {
      for (const child of record.removedNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          resizeObserver.unobserve(child);
        }
      }
    }
    observeChildren();
    update();
  }).observe(box, { childList: true });

  const setReserve = (px) => {
    reserved = px;
    box.style.paddingBottom = px ? `${px}px` : "";
    bars[1].rail.classList.toggle("reserved", !!px);
    update();
  };
  setReserve(reserve);

  const handle = { update, setReserve, revealOnRest };
  attachedScrollbars.set(box, handle);
  return handle;
}

const attachedScrollbars = new WeakMap();

// Every box that scrolls gets the drawn bars, in the page and in every open
// shadow root, including boxes added later. A view calls this once at start.
// The boxes are found by their computed overflow, so no box has to ask.
export function drawScrollbarsEverywhere(root = document) {
  const pendingWalk = new Set();
  const pendingCheck = new Set();
  let frame = 0;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      // The bars restyle themselves on every scroll; that says nothing new.
      if (record.target.closest?.(".scrollbar-rail")) {
        continue;
      }
      // An inline style changes how its own element overflows. A resize gutter
      // writes one on the page root every frame, and walking the whole page
      // for it found nothing new.
      if (record.type === "attributes" && record.attributeName === "style") {
        pendingCheck.add(record.target);
      } else if (record.type === "attributes") {
        pendingWalk.add(record.target);
      }
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          pendingWalk.add(node);
        }
      }
    }
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        const plan = planScrollbarScan(pendingWalk, pendingCheck);
        pendingWalk.clear();
        pendingCheck.clear();
        for (const node of plan.walk) {
          if (node.isConnected) {
            walk(node);
          }
        }
        for (const element of plan.check) {
          if (element.isConnected && scrolls(element)) {
            attachScrollbars(element);
          }
        }
      });
    }
  });
  const observed = new WeakSet();
  const observe = (target) => {
    if (!observed.has(target)) {
      observed.add(target);
      // A class or style change can make a box scroll.
      observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }
  };
  const walk = (node) => {
    const stack = [node];
    while (stack.length) {
      const element = stack.pop();
      if (element.nodeType === Node.ELEMENT_NODE) {
        if (scrolls(element)) {
          attachScrollbars(element);
        }
        if (element.shadowRoot) {
          observe(element.shadowRoot);
          stack.push(...element.shadowRoot.children);
        }
      }
      stack.push(...element.children);
    }
  };
  observe(root);
  walk(root.documentElement ?? root);
}

// What one frame's changes ask for: trees to walk, and elements to check on
// their own. A node inside a tree already walked is dropped, through shadow
// roots to their hosts, so one batch visits each subtree once.
export function planScrollbarScan(walkNodes, checkNodes) {
  const insideWalked = (node) => {
    for (let up = node.parentNode ?? node.host; up; up = up.parentNode ?? up.host) {
      if (walkNodes.has(up)) return true;
    }
    return false;
  };
  const walk = [...walkNodes].filter((node) => !insideWalked(node));
  const check = [...checkNodes].filter(
    (node) => !walkNodes.has(node) && !insideWalked(node)
  );
  return { walk, check };
}

// Not the page itself, which has no parent to hold the bars, and not a
// control that draws its own. The bars are rails beside the box, so a box
// whose own children are rails (a rail holder) is left alone too.
const NO_DRAWN_BARS = new Set(["HTML", "BODY", "INPUT", "SELECT", "TEXTAREA"]);

function scrolls(element) {
  if (
    NO_DRAWN_BARS.has(element.tagName) ||
    element.classList.contains("scrollbar-rail") ||
    attachedScrollbars.has(element)
  ) {
    return false;
  }
  const style = getComputedStyle(element);
  // A box that hides its bars on purpose (a header scrolled by its rows) keeps
  // them hidden.
  if (style.scrollbarWidth === "none") {
    return false;
  }
  return /(auto|scroll)/.test(style.overflowY + " " + style.overflowX);
}

function makeBar(box, axis) {
  const vertical = axis === "vertical";
  const rail = document.createElement("div");
  rail.className = `scrollbar-rail ${axis}`;
  rail.hidden = true;
  const back = document.createElement("div");
  back.className = "scrollbar-arrow back";
  const track = document.createElement("div");
  track.className = "scrollbar-track";
  const thumb = document.createElement("div");
  thumb.className = "scrollbar-thumb";
  const forward = document.createElement("div");
  forward.className = "scrollbar-arrow forward";
  track.appendChild(thumb);
  rail.append(back, track, forward);

  const scrollPos = () => (vertical ? box.scrollTop : box.scrollLeft);
  const scrollSize = () => (vertical ? box.scrollHeight : box.scrollWidth);
  const clientSize = () => (vertical ? box.clientHeight : box.clientWidth);
  const trackLength = () => (vertical ? track.clientHeight : track.clientWidth);
  const scrollTo = (value) => {
    if (vertical) {
      box.scrollTop = value;
    } else {
      box.scrollLeft = value;
    }
  };

  const bar = {
    rail,
    // Lays the rail along the box's inner edge, short of the other bar's
    // corner by `corner`; the sideways bar sits in the reserved strip if
    // there is one.
    place(corner = 0, strip = 0) {
      const thumbBox = scrollbarThumb(
        scrollPos(),
        scrollSize(),
        clientSize(),
        Math.max(0, (vertical ? box.clientHeight : box.clientWidth) - corner - 16)
      );
      rail.hidden = !thumbBox.visible;
      if (!thumbBox.visible) {
        return;
      }
      const left = box.offsetLeft + box.clientLeft;
      const top = box.offsetTop + box.clientTop;
      if (vertical) {
        rail.style.left = `${left + box.clientWidth - rail.offsetWidth}px`;
        rail.style.top = `${top}px`;
        rail.style.height = `${box.clientHeight - corner}px`;
      } else {
        const height = strip || rail.offsetHeight;
        rail.style.left = `${left}px`;
        rail.style.top = `${top + box.clientHeight - height}px`;
        rail.style.width = `${box.clientWidth - corner}px`;
      }
      const thumbNow = scrollbarThumb(
        scrollPos(),
        scrollSize(),
        clientSize(),
        trackLength()
      );
      thumb.style[vertical ? "top" : "left"] = `${thumbNow.offset}px`;
      thumb.style[vertical ? "height" : "width"] = `${thumbNow.length}px`;
    },
    // Hidden until the pointer has rested on the rail for REVEAL_DELAY;
    // hidden again as it leaves, unless a drag holds it.
    revealOnRest() {
      rail.classList.add("reveal");
      let timer;
      rail.addEventListener("pointerenter", () => {
        clearTimeout(timer);
        timer = setTimeout(() => rail.classList.add("shown"), REVEAL_DELAY);
      });
      rail.addEventListener("pointerleave", () => {
        clearTimeout(timer);
        if (!thumb.classList.contains("dragging")) {
          rail.classList.remove("shown");
        }
      });
    },
  };

  // Dragging the thumb scrolls in step with it.
  thumb.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const start = vertical ? event.clientY : event.clientX;
    const startOffset = parseFloat(thumb.style[vertical ? "top" : "left"]) || 0;
    thumb.setPointerCapture(event.pointerId);
    thumb.classList.add("dragging");
    const onMove = (moveEvent) => {
      const delta = (vertical ? moveEvent.clientY : moveEvent.clientX) - start;
      scrollTo(
        scrollForThumbOffset(
          startOffset + delta,
          scrollSize(),
          clientSize(),
          trackLength()
        )
      );
    };
    const onEnd = () => {
      thumb.removeEventListener("pointermove", onMove);
      thumb.removeEventListener("pointerup", onEnd);
      thumb.removeEventListener("lostpointercapture", onEnd);
      thumb.classList.remove("dragging");
      if (!rail.matches(":hover")) {
        rail.classList.remove("shown");
      }
    };
    thumb.addEventListener("pointermove", onMove);
    thumb.addEventListener("pointerup", onEnd);
    thumb.addEventListener("lostpointercapture", onEnd);
  });

  // The wheel over a bar scrolls the box, as over the box itself; over the
  // sideways bar either wheel direction scrolls sideways.
  rail.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const unit =
        event.deltaMode === 1 ? WHEEL_LINE : event.deltaMode === 2 ? clientSize() : 1;
      if (vertical) {
        smoothScrollBy(box, event.deltaX * unit, event.deltaY * unit);
      } else {
        smoothScrollBy(box, (event.deltaX || event.deltaY) * unit, 0);
      }
    },
    { passive: false }
  );

  // A press on the track jumps a page toward the pointer.
  track.addEventListener("pointerdown", (event) => {
    if (event.target !== track || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const rect = thumb.getBoundingClientRect();
    const at = vertical ? event.clientY : event.clientX;
    const before = at < (vertical ? rect.top : rect.left);
    scrollTo(scrollPos() + (before ? -1 : 1) * clientSize() * 0.9);
  });

  // The arrows step, and keep stepping while held.
  for (const [arrow, sign] of [
    [back, -1],
    [forward, 1],
  ]) {
    arrow.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      const step = () => scrollTo(scrollPos() + sign * ARROW_STEP);
      step();
      let interval;
      const delay = setTimeout(() => {
        interval = setInterval(step, ARROW_REPEAT_INTERVAL);
      }, ARROW_REPEAT_DELAY);
      const stop = () => {
        clearTimeout(delay);
        clearInterval(interval);
        window.removeEventListener("pointerup", stop);
      };
      window.addEventListener("pointerup", stop);
    });
  }

  return bar;
}

// The wheel over a bar eases the box toward where the wheel has sent it, as
// the browser does over the box itself. Each notch adds to one target, so a
// fast wheel loses nothing to an animation it interrupts.
const SMOOTH_SCROLL_EASE = 0.3;
const smoothScrolls = new WeakMap();

function smoothScrollBy(box, dx, dy) {
  let state = smoothScrolls.get(box);
  if (!state) {
    state = { x: box.scrollLeft, y: box.scrollTop, frame: 0 };
    smoothScrolls.set(box, state);
  }
  if (!state.frame) {
    // A scroll from elsewhere since the last run moves the start.
    state.x = box.scrollLeft;
    state.y = box.scrollTop;
  }
  const clamp = (value, max) => Math.min(Math.max(value, 0), Math.max(max, 0));
  state.x = clamp(state.x + dx, box.scrollWidth - box.clientWidth);
  state.y = clamp(state.y + dy, box.scrollHeight - box.clientHeight);
  if (state.frame) {
    return;
  }
  // A share of what is left, but at least a whole pixel: the box may round
  // its scroll to pixels, and a smaller step would never arrive.
  const toward = (from, to) => {
    const left = to - from;
    const move = left * SMOOTH_SCROLL_EASE;
    return Math.abs(move) >= 1
      ? from + move
      : from + Math.sign(left) * Math.min(Math.abs(left), 1);
  };
  const step = () => {
    const left = toward(box.scrollLeft, state.x);
    const top = toward(box.scrollTop, state.y);
    box.scrollTo({ left, top, behavior: "instant" });
    const done =
      Math.abs(state.x - box.scrollLeft) < 1 && Math.abs(state.y - box.scrollTop) < 1;
    state.frame = done ? 0 : requestAnimationFrame(step);
  };
  state.frame = requestAnimationFrame(step);
}

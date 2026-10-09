// The design's scrollbars, drawn rather than native: browsers differ in what
// they let a page style (Firefox: no thinner than its "thin", no hover
// colour, no arrows), so a scroll box hides its own and these are drawn
// beside it. A 2px thumb in line 4, line 2 under the pointer, an arrow
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
  box.classList.add("drawn-scrollbars");
  const bars = [makeBar(box, "vertical"), makeBar(box, "horizontal")];
  let reserved = 0;

  const update = () => {
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
    if (getComputedStyle(holder).position === "static") {
      holder.style.position = "relative";
    }
    const [vertical, horizontal] = bars;
    const both =
      box.scrollHeight - box.clientHeight > 1 && box.scrollWidth - box.clientWidth > 1;
    // Where both show, each stops short of the other's corner.
    vertical.place(both ? reserved || RAIL : 0);
    horizontal.place(both ? RAIL : 0, reserved);
  };

  if (reveal === "hover") {
    for (const bar of bars) {
      bar.revealOnRest();
    }
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
  new MutationObserver(() => {
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

  return { update, setReserve };
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
        box.scrollBy({ left: event.deltaX * unit, top: event.deltaY * unit });
      } else {
        box.scrollBy({ left: (event.deltaX || event.deltaY) * unit });
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

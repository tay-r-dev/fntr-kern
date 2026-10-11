// The tooltip (Figma 4283:6057, styles in tooltip.css): a popover in the top
// layer, so it draws over everything and no panel edge clips it. It is fixed
// to the window, so it shows the same whether the anchor sits in the page or
// in a shadow root.
const TOOLTIP_DELAY = 600; // ms
const GAP = 6; // between the anchor and the tooltip, the arrow's 4px included
const MARGIN = 4; // from the window edge
const OPPOSITE = { top: "bottom", bottom: "top", left: "right", right: "left" };

// `title`, when given, is a heading line above the message.
function makeTooltip(message, title) {
  const tooltip = document.createElement("div");
  tooltip.className = "fontra-tooltip";
  tooltip.popover = "manual";
  if (title) {
    const heading = document.createElement("div");
    heading.className = "fontra-tooltip-title";
    heading.textContent = title;
    tooltip.append(heading);
  }
  tooltip.append(message);
  document.body.appendChild(tooltip);
  tooltip.showPopover();
  return tooltip;
}

// `side` is "top", "bottom", "left" or "right"; a side without room flips.
function placeTooltip(tooltip, anchor, side) {
  const a = anchor.getBoundingClientRect();
  const { width, height } = tooltip.getBoundingClientRect();
  const fits = {
    top: a.top - GAP - height >= MARGIN,
    bottom: a.bottom + GAP + height <= window.innerHeight - MARGIN,
    left: a.left - GAP - width >= MARGIN,
    right: a.right + GAP + width <= window.innerWidth - MARGIN,
  };
  if (!fits[side] && fits[OPPOSITE[side]]) {
    side = OPPOSITE[side];
  }
  const clamp = (value, size, limit) =>
    Math.min(limit - size - MARGIN, Math.max(MARGIN, value));
  const centerX = a.left + a.width / 2;
  const centerY = a.top + a.height / 2;
  let left, top;
  if (side === "top" || side === "bottom") {
    left = clamp(centerX - width / 2, width, window.innerWidth);
    top = side === "top" ? a.top - GAP - height : a.bottom + GAP;
  } else {
    left = side === "left" ? a.left - GAP - width : a.right + GAP;
    top = clamp(centerY - height / 2, height, window.innerHeight);
  }
  left = Math.round(left);
  top = Math.round(top);
  Object.assign(tooltip.style, { left: `${left}px`, top: `${top}px` });
  tooltip.dataset.side = side;
  // The arrow points at the anchor's middle, even when the tooltip is clamped.
  tooltip.style.setProperty("--tooltip-arrow-x", `${Math.round(centerX - left)}px`);
  tooltip.style.setProperty("--tooltip-arrow-y", `${Math.round(centerY - top)}px`);
}

// Shows every `data-tooltip` on the page, after the pointer rests on its
// element for TOOLTIP_DELAY. `data-tooltiptitle` adds a heading line.
// `data-tooltipposition` names the side; its
// corner forms ("top-left", ...) take the side. Call once per page.
export function showTooltipsEverywhere() {
  let anchor = null;
  let tooltip = null;
  let timer = null;

  const hide = () => {
    clearTimeout(timer);
    tooltip?.remove();
    tooltip = null;
  };

  const show = () => {
    const message = anchor?.isConnected && anchor.getAttribute("data-tooltip");
    if (!message) {
      return;
    }
    tooltip = makeTooltip(message, anchor.getAttribute("data-tooltiptitle"));
    const side = (anchor.getAttribute("data-tooltipposition") || "bottom").split("-")[0];
    placeTooltip(tooltip, anchor, side);
  };

  document.addEventListener(
    "pointerover",
    (event) => {
      const found =
        event
          .composedPath()
          .find((node) => node instanceof Element && node.hasAttribute("data-tooltip")) ??
        null;
      if (found === anchor) {
        return;
      }
      hide();
      anchor = found;
      if (anchor) {
        timer = setTimeout(show, TOOLTIP_DELAY);
      }
    },
    true
  );
  // The pointer left the window.
  document.addEventListener("pointerout", (event) => {
    if (!event.relatedTarget) {
      hide();
      anchor = null;
    }
  });
  // No tooltip while the element is pressed, or the page moves under it.
  for (const type of ["pointerdown", "wheel", "keydown"]) {
    window.addEventListener(type, hide, true);
  }
}

// The tooltip a two-press control shows after its first press: an icon has no
// text to change, so the warning appears beside it instead (UI-REFACTOR.md
// §4.4, §7.2). Lifted from the Letterspacer panel's Reverse guard. Returns a
// function that removes it.
export function showArmedTooltip(anchor, message) {
  if (!anchor || !message) {
    return () => {};
  }
  const tooltip = makeTooltip(message);
  placeTooltip(tooltip, anchor, "left");
  return () => tooltip.remove();
}

// A press anywhere but on the armed control disarms it. `anchor` is the armed
// control, or a function that returns it, for a control drawn anew while
// armed. One control is armed at a time: arming another stops watching for
// the last. `disarm` must do nothing when the control is no longer armed --
// a control pressed a second time may have disarmed itself already.
let stopWatchingClickAway = null;

export function disarmOnClickAway(anchor, disarm) {
  stopWatchingClickAway?.();
  const onPointerDown = (event) => {
    const element = typeof anchor === "function" ? anchor() : anchor;
    if (element && event.composedPath().includes(element)) {
      return;
    }
    stop();
    disarm();
  };
  const stop = () => {
    window.removeEventListener("pointerdown", onPointerDown, true);
    if (stopWatchingClickAway === stop) {
      stopWatchingClickAway = null;
    }
  };
  window.addEventListener("pointerdown", onPointerDown, true);
  stopWatchingClickAway = stop;
}

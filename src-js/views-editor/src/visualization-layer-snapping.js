import {
  glyphSelector,
  registerVisualizationLayerDefinition,
  strokeLine,
} from "./visualization-layer-definitions.js";

// A snap the designer cannot account for reads as a bug, so every held candidate
// is drawn back to the geometry it came from. A guide the designer placed and one
// the editor invented are drawn differently, because they behave differently -
// and that difference is a flag on the candidate, not its kind. A kind is a
// direction, and a metric and a point's own ray share one.

// The ring is animated on the changes, not forever. A candidate coming near opens
// the ring outward. Taking the snap pulls it in tight. Losing it lets the ring go
// slack and fade. Each is one short run, and once it has played the ring is still,
// so the canvas is left alone until the state changes again.
const TRANSITION_MS = 180;

const STATE = { none: 0, near: 1, snapped: 2 };

let ringState = STATE.none;
let ringSince = 0;
let animationPending = false;

function requestAnimationTick(controller) {
  if (animationPending) {
    return;
  }
  animationPending = true;
  requestAnimationFrame(() => {
    animationPending = false;
    controller.requestUpdate();
  });
}

function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}

registerVisualizationLayerDefinition({
  identifier: "fontra.snapping.guides",
  name: "sidebar.user-settings.snapping-guides",
  selectionFunc: glyphSelector("editing"),
  userSwitchable: true,
  defaultOn: true,
  zIndex: 600,
  screenParameters: {
    strokeWidth: 1,
    dash: 4,
    markerRadius: 3,
    nearRadius: 11,
    snappedRadius: 4.5,
  },
  colors: {
    permanentColor: "#00BFFF",
    smartColor: "#FF5FA2",
    suggestionColor: "#FF5FA2",
    ringColor: "#00BFFF",
  },
  colorsDarkMode: {
    permanentColor: "#00BFFFC0",
    smartColor: "#FF8FC0",
    suggestionColor: "#FF8FC0",
    ringColor: "#7FE0FF",
  },
  draw: (context, positionedGlyph, parameters, model, controller) => {
    const held = model.snapHeldCandidates || [];
    const indicator = model.snapIndicator;
    const { xMin, yMin, xMax, yMax } = controller.getViewBox();
    const reach = Math.max(Math.hypot(xMax - xMin, yMax - yMin), 2000);

    if (drawIndicator(context, parameters, indicator)) {
      requestAnimationTick(controller);
    }

    // A rival the designer has not chosen yet. Drawn faint and thin, so it reads
    // as on offer rather than as the guide in force.
    const suggestion = model.snapSuggestion;
    if (suggestion?.type === "line") {
      context.save();
      context.globalAlpha = 0.35;
      context.lineWidth = parameters.strokeWidth;
      context.strokeStyle = parameters.suggestionColor;
      context.setLineDash([parameters.dash, parameters.dash * 2]);
      strokeGuideLine(context, suggestion, reach);
      context.restore();
    }

    if (!held.length) {
      return;
    }
    context.lineWidth = parameters.strokeWidth;
    context.setLineDash([parameters.dash, parameters.dash]);
    for (const candidate of held) {
      if (candidate.type !== "line") {
        continue;
      }
      context.strokeStyle = candidate.permanent
        ? parameters.permanentColor
        : parameters.smartColor;
      strokeGuideLine(context, candidate, reach);
      context.beginPath();
      context.arc(
        candidate.source.x,
        candidate.source.y,
        parameters.markerRadius,
        0,
        2 * Math.PI
      );
      context.stroke();
    }
    context.setLineDash([]);
  },
});

// The line is drawn through the source, so the reason for the snap is visible.
function strokeGuideLine(context, candidate, reach) {
  strokeLine(
    context,
    candidate.source.x - candidate.dx * reach,
    candidate.source.y - candidate.dy * reach,
    candidate.source.x + candidate.dx * reach,
    candidate.source.y + candidate.dy * reach
  );
}

// Returns true while a transition is still running, which is the only time the
// layer asks for another frame.
function drawIndicator(context, parameters, indicator) {
  const now = Date.now();
  const state = !indicator
    ? STATE.none
    : indicator.snapped
      ? STATE.snapped
      : STATE.near;
  if (state !== ringState) {
    ringState = state;
    ringSince = now;
  }
  const progress = Math.min(1, (now - ringSince) / TRANSITION_MS);
  const eased = easeOut(progress);

  if (state === STATE.none) {
    if (progress >= 1 || !ringLast) {
      ringLast = null;
      return false;
    }
    // Letting go: the ring goes slack and fades where it last stood.
    drawRing(
      context,
      parameters,
      ringLast,
      ringLast.radius + eased * parameters.nearRadius,
      (1 - eased) * 0.6,
      parameters.strokeWidth
    );
    return true;
  }

  let radius;
  let alpha;
  let width;
  if (state === STATE.near) {
    // Coming near: the ring opens outward from nothing to its full circle.
    radius = parameters.nearRadius * (0.25 + 0.75 * eased);
    alpha = (0.25 + 0.5 * indicator.strength) * eased;
    width = parameters.strokeWidth;
  } else {
    // Taken: the ring pulls in tight and firms up.
    radius =
      parameters.nearRadius -
      eased * (parameters.nearRadius - parameters.snappedRadius);
    alpha = 1;
    width = parameters.strokeWidth * (1 + eased);
  }
  ringLast = { x: indicator.x, y: indicator.y, radius };
  drawRing(context, parameters, indicator, radius, alpha, width);
  return progress < 1;
}

let ringLast = null;

function drawRing(context, parameters, at, radius, alpha, width) {
  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = parameters.ringColor;
  context.lineWidth = width;
  context.setLineDash([]);
  context.beginPath();
  context.arc(at.x, at.y, Math.max(radius, 0.1), 0, 2 * Math.PI);
  context.stroke();
  context.restore();
}

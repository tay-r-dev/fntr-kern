// A gizmo: a control drawn on the canvas that is not part of the letter. It
// shows only once the cursor has rested near it, fades in and out, and grows
// when a click would take it. Tunni's gizmos and a ray's aim handle are gizmos.
// What each one controls and where it sits is its own feature's; this module
// knows only keys, points and colours.

// How the reveal behaves, in screen pixels and milliseconds. Live numbers the
// Visual panel's debug section edits, read at the moment they are needed.
export const GIZMO_TUNING_DEFAULTS = {
  revealRadius: 28,
  clickRadius: 10,
  revealDelay: 200,
  fadeDuration: 180,
  hoverDuration: 140,
};
export const GIZMO_TUNING = { ...GIZMO_TUNING_DEFAULTS };

// How long after a gizmo is dropped it still comes back without its reveal.
const RECENT_REARM_MS = 500;

// Ease out on the way in and ease in on the way out, so a gizmo arrives softly
// and leaves without lingering.
function ease(progress, rising) {
  return rising ? 1 - (1 - progress) ** 3 : progress ** 3;
}

//
// A gizmo shows only after the cursor has rested near it, and fades in and out.
//
// One gizmo is armed at a time. Hovering near a different one starts that one's
// delay and lets the armed one go; leaving every gizmo lets it go too. An armed
// gizmo is the only one a click reaches, and the hot one is the armed gizmo the
// cursor is close enough to click. Both states are eased, as two channels per
// key: `alpha` for showing and `hot` for the hover emphasis.
//
// Every hover event runs as a pass. A tool that answers the pointer without
// looking for gizmos, as the skeleton pen does while editing, never calls
// hover(), and the pass then lets the armed gizmo go.
//
export class GizmoReveal {
  constructor(requestUpdate) {
    this._requestUpdate = requestUpdate;
    this._armedKey = null;
    this._hotKey = null;
    this._draggedKey = null;
    this._pendingKey = null;
    this._timer = null;
    this._tweens = new Map();
    this._frame = null;
    this._hoveredThisPass = false;
    this._lastHot = false;
  }

  beginHoverPass() {
    this._hoveredThisPass = false;
  }

  endHoverPass() {
    if (!this._hoveredThisPass) {
      this.hover(null);
    }
  }

  // `hot`: the cursor is within the key's click catch. `delay` replaces the
  // reveal delay for this key, in milliseconds.
  hover(key, { hot = false, delay = GIZMO_TUNING.revealDelay } = {}) {
    this._hoveredThisPass = true;
    this._lastHot = hot;
    if (key === this._armedKey) {
      this._cancelPending();
    } else if (!key || key !== this._pendingKey) {
      // No key never matches a pending one: with nothing pending both are
      // empty, and treating that as "still pending" kept a shown gizmo up for
      // as long as the cursor stayed away from every gizmo.
      this._cancelPending();
      if (this._armedKey) {
        this._tweenTo("alpha", this._armedKey, 0);
        this._recentKey = this._armedKey;
        this._recentAt = performance.now();
        this._armedKey = null;
      }
      // A gizmo that was armed a moment ago comes straight back, with no delay
      // and no fade: an edit rebuilding the glyph can drop it from one hover
      // pass, and making the designer wait out the reveal again to grab the
      // gizmo they were just holding read as the drag lagging.
      if (
        key &&
        key === this._recentKey &&
        performance.now() - this._recentAt < RECENT_REARM_MS
      ) {
        this._armedKey = key;
        this._setNow("alpha", key, 1);
      } else if (key) {
        this._pendingKey = key;
        this._timer = setTimeout(() => {
          this._pendingKey = null;
          this._timer = null;
          this._armedKey = key;
          this._tweenTo("alpha", key, 1);
          this._setHot(this._lastHot ? key : null);
        }, delay);
      }
    }
    this._setHot(hot && key === this._armedKey ? key : null);
  }

  isArmed(key) {
    return !!key && key === this._armedKey;
  }

  alpha(key, now = performance.now()) {
    return this._value("alpha", key, now);
  }

  // 0 to 1: how far the hover emphasis has grown in.
  hotness(key, now = performance.now()) {
    return this._value("hot", key, now);
  }

  // The gizmo a drag holds, or none. Its handles show through the drag and fade after.
  setDragged(key) {
    if (key === this._draggedKey) {
      return;
    }
    if (this._draggedKey) {
      this._tweenTo("drag", this._draggedKey, 0);
    }
    this._draggedKey = key;
    if (key) {
      // At full strength from the first frame: a fade-in on the handles the
      // drag is moving made the start of every drag look slow.
      this._setNow("drag", key, 1);
    }
  }

  // Every key a drag shows, growing in or fading out, with its opacity.
  draggedKeys(now = performance.now()) {
    const keys = [];
    for (const tween of this._tweens.values()) {
      if (tween.channel !== "drag") {
        continue;
      }
      const alpha = this._value("drag", tween.key, now);
      if (alpha > 0) {
        keys.push({ key: tween.key, alpha });
      }
    }
    return keys;
  }

  _setHot(key) {
    if (key === this._hotKey) {
      return;
    }
    if (this._hotKey) {
      this._tweenTo("hot", this._hotKey, 0);
    }
    this._hotKey = key;
    if (key) {
      this._tweenTo("hot", key, 1);
    }
  }

  // A `slow` tween belongs to a subclass, which names its duration and linger.
  _duration(channel, slow = false) {
    return Math.max(
      channel === "hot" ? GIZMO_TUNING.hoverDuration : GIZMO_TUNING.fadeDuration,
      1
    );
  }

  _linger(slow) {
    return 0;
  }

  _value(channel, key, now) {
    const tween = this._tweens.get(`${channel}:${key}`);
    if (!tween) {
      return 0;
    }
    // A tween that starts later, an on-curve gizmo lingering, holds its value.
    const progress = Math.min(
      Math.max((now - tween.start) / this._duration(channel, tween.slow), 0),
      1
    );
    const rising = tween.to > tween.from;
    return tween.from + (tween.to - tween.from) * ease(progress, rising);
  }

  _cancelPending() {
    clearTimeout(this._timer);
    this._timer = null;
    this._pendingKey = null;
  }

  // Jump straight to `value`, with no tween.
  _setNow(channel, key, value) {
    this._tweens.set(`${channel}:${key}`, {
      channel,
      key,
      slow: false,
      from: value,
      to: value,
      start: performance.now(),
    });
    this._animate();
  }

  // A `slow` tween may linger before it fades out.
  _tweenTo(channel, key, to, slow = false) {
    const now = performance.now();
    const linger = to === 0 ? this._linger(slow) : 0;
    this._tweens.set(`${channel}:${key}`, {
      channel,
      key,
      slow,
      from: this._value(channel, key, now),
      to,
      start: now + linger,
    });
    this._animate();
  }

  _animate() {
    if (this._frame !== null) {
      return;
    }
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      const now = performance.now();
      let moving = false;
      for (const [id, tween] of this._tweens) {
        if (now - tween.start < this._duration(tween.channel, tween.slow)) {
          moving = true;
        } else if (tween.to === 0) {
          this._tweens.delete(id);
        }
      }
      this._requestUpdate();
      if (moving) {
        this._animate();
      }
    });
  }
}

// Draw one gizmo at its reveal's current opacity, as a filled circle or diamond.
// Nothing is drawn while the gizmo is fully hidden. The gizmo a click would take
// grows and gains a soft outline, both eased in and out by the reveal. `before` draws under
// the gizmo at the same opacity. `parameters.pixel` is one screen pixel in glyph
// units.
const HOVER_GROWTH = 0.45;
const HINT_ALPHA = 0.35;
const HINT_GAP = 2;
const HOVER_OUTLINE_WIDTH = 2.5;
const HOVER_OUTLINE_ALPHA = 0.4;

export function drawGizmo(
  context,
  reveal,
  key,
  point,
  parameters,
  { shape = "circle", before = null, hint = false } = {}
) {
  const alpha = reveal?.alpha(key) ?? 0;
  // A hidden gizmo leaves a faint ring where it sits, so the place to hover
  // for it can be found. The ring gives way as it shows.
  if (hint && alpha < 1) {
    const pixel = parameters.pixel ?? 1;
    context.save();
    context.globalAlpha = HINT_ALPHA * (1 - alpha);
    context.strokeStyle = parameters.gizmoColor;
    context.lineWidth = pixel;
    context.beginPath();
    context.arc(
      point.x,
      point.y,
      parameters.gizmoSize / 2 + HINT_GAP * pixel,
      0,
      2 * Math.PI
    );
    context.stroke();
    context.restore();
  }
  if (!(alpha > 0)) {
    return;
  }
  const hot = reveal?.hotness(key) ?? 0;
  const size = parameters.gizmoSize * (1 + HOVER_GROWTH * hot);
  const tracePath = (traceSize) => {
    context.beginPath();
    if (shape === "diamond") {
      const half = traceSize / 2;
      context.moveTo(point.x, point.y - half);
      context.lineTo(point.x + half, point.y);
      context.lineTo(point.x, point.y + half);
      context.lineTo(point.x - half, point.y);
      context.closePath();
    } else {
      context.arc(point.x, point.y, traceSize / 2, 0, 2 * Math.PI);
    }
  };
  context.save();
  context.globalAlpha = alpha;
  before?.();
  context.fillStyle = parameters.gizmoColor;
  tracePath(size);
  context.fill();
  if (hot > 0) {
    const outline = HOVER_OUTLINE_WIDTH * parameters.pixel;
    context.globalAlpha = alpha * HOVER_OUTLINE_ALPHA * hot;
    context.strokeStyle = parameters.gizmoColor;
    context.lineWidth = outline;
    tracePath(size + outline * (shape === "diamond" ? 2.8 : 2));
    context.stroke();
  }
  context.restore();
}

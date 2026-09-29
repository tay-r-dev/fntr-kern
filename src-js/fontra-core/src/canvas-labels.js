// The canvas labels, drawn from the typeCAD Figma file: label/simple, the pill every
// marker and ruler readout sits on, and label/Q, the Q-measure plaque. Both are cards
// with the same outline, drop shadow and background blur (drawCardBackground), set in
// Martian Mono, the app's fontra-ui-mono face.
//
// Every measurement here is in screen pixels. A layer passes them as screen parameters,
// which the layer machinery turns into glyph units at the current zoom, so the labels
// keep their size on screen at every zoom.
//
// The text is set in screen pixels too: a card scales the context to one screen pixel
// and sets its fonts at their screen sizes. A font size in glyph units would be a new
// font string at every zoom step, and the browser resolves, shapes and rasterises each
// new font afresh -- the lag on the first pass through a range of zooms.

const LABEL_FONT_FAMILY = "fontra-ui-mono, fontra-ui-regular, monospace";
// The canvas labels' weights: pills, plaques and readouts in Narrow Light, the
// handle and gizmo measurements a step lighter in Narrow ExtraLight. No page
// text asks for these faces, so load them up front, or the first labels draw
// in the fallback.
const LABEL_WEIGHT = 300;
const MEASURE_LABEL_WEIGHT = 200;
for (const weight of [LABEL_WEIGHT, MEASURE_LABEL_WEIGHT]) {
  globalThis.document?.fonts?.load(`${weight} semi-condensed 10px fontra-ui-mono`);
}

// The sizes a designer can tune by hand, from the "Labels (debug)" accordion in the
// left panel. Live: every draw reads them. The panel stores them per browser.
//
//   valueSize, smallSize: the pill's and the plaque's two font sizes, in screen pixels.
//     The pill grows with its value size; the plaque keeps its layout.
//   measureSize: the measurement labels on handles and gizmos, in font units, so they
//     grow on zoom in like the drawing does.
//   measureMinScreenSize: the smallest those labels get on screen, in screen pixels, so
//     they stay readable zoomed out.
//   measureMaxFade: how far, in per cent, those labels fade when held at the minimum
//     far out. The fade starts where the minimum takes over (measureLabelAlpha).
export const LABEL_TUNING_DEFAULTS = Object.freeze({
  valueSize: 9,
  smallSize: 7,
  measureSize: 6,
  measureMinScreenSize: 7,
  measureMaxFade: 60,
  showIcons: 1,
});

export const LABEL_TUNING = { ...LABEL_TUNING_DEFAULTS };
const LABEL_SEPARATOR = "•";
const LABEL_SHADOW_COLOR = "rgba(0, 0, 0, 0.2)";
// Figma's background blur, in CSS pixels.
const LABEL_BACKDROP_BLUR = 2;

// label/simple (node 333:17292). A fully rounded pill 18 high with 8 of padding each
// side; its values in Martian Mono at 9, the heading/h5 face, separated by a small grey
// bullet with 3 either side.
//
// `parts` is one value or several. `inverse` swaps fill and text, which is how a ruler
// tells a span in the white from a span in the black.
export function drawLabel(context, parameters, at, parts, { inverse = false } = {}) {
  const values = (Array.isArray(parts) ? parts : [parts]).filter(
    (part) => part !== undefined && part !== null && part !== ""
  );
  if (!values.length) {
    return;
  }
  const px = parameters.labelPixel;
  context.save();
  context.translate(at.x, at.y);
  context.scale(px, -px);
  context.textBaseline = "middle";
  context.textAlign = "left";

  const metrics = labelMetrics({ labelPixel: 1 });
  const items = [];
  values.forEach((value, i) => {
    if (i) {
      items.push({ text: LABEL_SEPARATOR, size: metrics.separatorSize });
    }
    items.push({ text: String(value), size: metrics.fontSize, value: true });
  });
  for (const item of items) {
    setLabelFont(context, item.size, TRACKING);
    item.width = context.measureText(item.text).width;
  }
  const gap = metrics.gap;
  const contentWidth =
    items.reduce((sum, item) => sum + item.width, 0) + gap * (items.length - 1);
  const width = contentWidth + 2 * metrics.paddingX;
  const height = metrics.height;
  const left = -width / 2;
  const top = -height / 2;

  const fill = inverse ? parameters.labelTextColor : parameters.labelFillColor;
  const ink = inverse ? parameters.labelFillColor : parameters.labelTextColor;
  drawCardBackground(context, left, top, width, height, height / 2, {
    fill,
    border: parameters.labelBorderWidth / px,
    borderColor: parameters.labelBorderColor,
  });

  let x = left + metrics.paddingX;
  for (const item of items) {
    setLabelFont(context, item.size, TRACKING);
    context.fillStyle = item.value ? ink : parameters.labelSeparatorColor;
    context.fillText(item.text, x, 0);
    x += item.width + gap;
  }
  context.restore();
}

// `labelPixel` is one screen pixel, which the layer turns into font units.
export const LABEL_SCREEN_PARAMETERS = {
  labelPixel: 1,
  labelBorderWidth: 1,
};

// The pill's measurements at the tuned value size. The frame draws a 9 value on an
// 18-high pill with 8 of padding and 3 around the bullet; all of it grows with the value
// size, so a larger value keeps the same pill around it.
export function labelMetrics(parameters) {
  const px = parameters.labelPixel;
  const k = LABEL_TUNING.valueSize / LABEL_TUNING_DEFAULTS.valueSize;
  return {
    fontSize: LABEL_TUNING.valueSize * px,
    separatorSize: LABEL_TUNING.smallSize * px,
    gap: 3 * k * px,
    paddingX: 8 * k * px,
    height: 18 * k * px,
  };
}

// The measurement labels on handles and gizmos: in font units, so they grow on zoom
// in, but never under the tuned minimum on screen, so they stay readable zoomed out.
// Read off the context's own transform, which is what the text will be drawn at.
export function measureLabelFontSize(context) {
  const m = context.getTransform();
  const pixel = globalThis.devicePixelRatio || 1;
  const screenPerUnit = Math.hypot(m.a, m.b) / pixel;
  const floor =
    screenPerUnit > 0 ? LABEL_TUNING.measureMinScreenSize / screenPerUnit : 0;
  return Math.max(LABEL_TUNING.measureSize, floor);
}

// The measurement labels' opacity. Opaque while they zoom; once the screen minimum
// holds them up, they fade as the zoom would have shrunk them: at half their zoomed
// size, half the tuned maximum fade, and towards the whole of it far out.
export function measureLabelAlpha(context) {
  const m = context.getTransform();
  const pixel = globalThis.devicePixelRatio || 1;
  const zoomedSize = (LABEL_TUNING.measureSize * Math.hypot(m.a, m.b)) / pixel;
  const minimum = LABEL_TUNING.measureMinScreenSize;
  if (!(minimum > 0) || zoomedSize >= minimum) {
    return 1;
  }
  return 1 - (LABEL_TUNING.measureMaxFade / 100) * (1 - zoomedSize / minimum);
}

export const LABEL_COLORS = {
  labelFillColor: "#FFFFFF",
  labelTextColor: "#303030",
  labelSeparatorColor: "#B4B4B4",
  labelBorderColor: "#1515150D",
};

export const LABEL_COLORS_DARK_MODE = {
  labelFillColor: "#303030",
  labelTextColor: "#F7F7F7",
  labelSeparatorColor: "#B4B4B4",
  labelBorderColor: "#1515150D",
};

const LABEL_BORDER_COLOR = "#1515150D";

// The card every label stands on: the background blur, then the fill with its drop
// shadow, then the outline, which runs outside the card so that it adds to the card's
// size rather than eating into its fill. The context is in screen orientation (y down).
function drawCardBackground(
  context,
  left,
  top,
  width,
  height,
  radius,
  { fill, border, borderColor = LABEL_BORDER_COLOR }
) {
  // A shadow is set in device pixels and ignores the transform, so it is one device
  // pixel's worth of the screen at every zoom.
  const pixel = globalThis.devicePixelRatio || 1;
  blurBehind(context, left, top, width, height, radius, LABEL_BACKDROP_BLUR * pixel);
  context.save();
  context.shadowColor = LABEL_SHADOW_COLOR;
  context.shadowOffsetY = pixel;
  context.shadowBlur = pixel;
  context.fillStyle = fill;
  context.beginPath();
  context.roundRect(left, top, width, height, radius);
  context.fill();
  context.restore();

  context.lineWidth = border;
  context.strokeStyle = borderColor;
  context.beginPath();
  context.roundRect(
    left - border / 2,
    top - border / 2,
    width + border,
    height + border,
    radius + border / 2
  );
  context.stroke();
}

// Figma's background blur: whatever is already drawn under the card, blurred, inside
// the card's shape. A canvas cannot blur what lies behind a shape, so the pixels under
// it are copied back onto themselves through a blur filter, clipped to the card. The
// copy is only of the card's own box, in device pixels, with room for the blur to reach
// in from outside it. `blur` is in device pixels.
function blurBehind(context, left, top, width, height, radius, blur) {
  if (!("filter" in context)) {
    return;
  }
  const m = context.getTransform();
  const corners = [
    [left, top],
    [left + width, top],
    [left, top + height],
    [left + width, top + height],
  ].map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
  const reach = Math.ceil(blur * 3);
  const canvas = context.canvas;
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))) - reach);
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))) - reach);
  const x1 = Math.min(
    canvas.width,
    Math.ceil(Math.max(...corners.map((c) => c.x))) + reach
  );
  const y1 = Math.min(
    canvas.height,
    Math.ceil(Math.max(...corners.map((c) => c.y))) + reach
  );
  if (x1 <= x0 || y1 <= y0) {
    return;
  }
  context.save();
  context.beginPath();
  context.roundRect(left, top, width, height, radius);
  context.clip();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.filter = `blur(${blur}px)`;
  context.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  context.restore();
}

// Figma's label/Q (typeCAD, node 333:17339): the Q-measure plaque. A white card with a
// 6 radius and 6 of padding, rows 5 apart; each row an icon and a value 6 apart. The
// value is Martian Mono at 9 in #303030; small print -- a header, or the distribution
// under a width -- is 7 in #8E8E8E. It carries the label's outline, shadow and
// background blur. The design has one variant, light, so the plaque is light in both
// themes.
//
//   plaque = {
//     header?: {left, right: [a, b]},   // small print across the top, a • b at right
//     rows: [{icon, value, sub?: [a, b]}],  // sub is small print under the value, a/b
//   }
//
// The plaque stands above `at`, centred on it, `offset` screen pixels clear.
export function drawPlaque(context, parameters, at, plaque, { onIconLoad } = {}) {
  // Laid out in screen pixels, in a context scaled to one screen pixel at `at`.
  const px = parameters.plaqueScale;
  const padding = PLAQUE.padding;
  const rowGap = PLAQUE.rowGap;
  const iconGap = PLAQUE.iconGap;
  // The two sizes are tuned; each line keeps the frame's proportion to its size.
  const valueSize = LABEL_TUNING.valueSize;
  const smallSize = LABEL_TUNING.smallSize;
  const valueLine = valueSize * PLAQUE.valueLineRatio;
  const smallLine = smallSize * PLAQUE.smallLineRatio;

  context.save();
  context.translate(at.x, at.y);
  context.scale(px, -px);
  context.textBaseline = "middle";
  context.textAlign = "left";

  const measure = (text, size, tracking) => {
    setLabelFont(context, size, tracking);
    return context.measureText(text).width;
  };

  // Lay the plaque out first, then draw it: its width is the widest row.
  const header = plaque.header;
  let headerWidth = 0;
  if (header) {
    setLabelFont(context, smallSize, TRACKING);
    headerWidth = Math.max(
      PLAQUE.minHeaderWidth,
      measure(header.left, smallSize, TRACKING) +
        iconGap +
        joinedWidth(context, header.right, "•", PLAQUE.headerSeparatorGap)
    );
  }
  const rows = plaque.rows.map((row) => {
    // With icons off a row is its value alone, without the icon's room or gap.
    const icon = LABEL_TUNING.showIcons ? PLAQUE_ICONS[row.icon] : null;
    const iconWidth = icon ? icon.width : 0;
    const iconHeight = icon ? icon.height : 0;
    const gap = icon ? iconGap : 0;
    const valueWidth = measure(row.value, valueSize, row.tracking ? TRACKING : 0);
    setLabelFont(context, smallSize, TRACKING);
    const subWidth = row.sub
      ? joinedWidth(context, row.sub, "/", PLAQUE.subSeparatorGap)
      : 0;
    const textHeight = valueLine + (row.sub ? smallLine : 0);
    return {
      ...row,
      icon,
      iconWidth,
      iconHeight,
      gap,
      width: iconWidth + gap + Math.max(valueWidth, subWidth),
      height: Math.max(iconHeight, textHeight),
    };
  });
  const contentWidth = Math.max(headerWidth, ...rows.map((row) => row.width));
  const contentHeight =
    (header ? smallLine + rowGap : 0) +
    rows.reduce((sum, row) => sum + row.height, 0) +
    rowGap * (rows.length - 1);
  const width = contentWidth + 2 * padding;
  const height = contentHeight + 2 * padding;
  const left = -width / 2;
  const top = -parameters.plaqueOffset / px - height;

  drawCardBackground(context, left, top, width, height, PLAQUE.radius, {
    fill: PLAQUE_COLORS.fill,
    border: parameters.labelBorderWidth / px,
  });

  let y = top + padding;
  if (header) {
    context.fillStyle = PLAQUE_COLORS.small;
    setLabelFont(context, smallSize, TRACKING);
    context.fillText(header.left, left + padding, y + smallLine / 2);
    const gap = PLAQUE.headerSeparatorGap;
    const rightWidth = joinedWidth(context, header.right, "•", gap);
    fillJoined(
      context,
      header.right,
      "•",
      gap,
      left + padding + contentWidth - rightWidth,
      y + smallLine / 2
    );
    y += smallLine + rowGap;
  }
  for (const row of rows) {
    const x = left + padding;
    // A one-line row centres its icon on the value; a row with small print under it
    // aligns the icon with the top, as the width row does.
    const iconTop = row.sub ? y : y + (row.height - row.iconHeight) / 2;
    if (row.icon) {
      drawPlaqueIcon(
        context,
        row.icon,
        x,
        iconTop,
        row.iconWidth,
        row.iconHeight,
        onIconLoad
      );
    }
    const textX = x + row.iconWidth + row.gap;
    const valueTop = row.sub ? y : y + (row.height - valueLine) / 2;
    context.fillStyle = PLAQUE_COLORS.value;
    setLabelFont(context, valueSize, row.tracking ? TRACKING : 0);
    context.fillText(row.value, textX, valueTop + valueLine / 2);
    if (row.sub) {
      context.fillStyle = PLAQUE_COLORS.small;
      setLabelFont(context, smallSize, TRACKING);
      fillJoined(
        context,
        row.sub,
        "/",
        PLAQUE.subSeparatorGap,
        textX,
        valueTop + valueLine + smallLine / 2
      );
    }
    y += row.height + rowGap;
  }
  context.restore();
}

// The plaque's measurements in screen pixels, straight from the frame. The layer's
// `plaqueScale` is one screen pixel in glyph units; the plaque scales the context by it.
const PLAQUE = {
  padding: 6,
  rowGap: 5,
  iconGap: 6,
  radius: 6,
  // Line heights over font sizes: 12 over 9 and 10 over 7 in the frame.
  valueLineRatio: 12 / 9,
  smallLineRatio: 10 / 7,
  minHeaderWidth: 46,
  // The room either side of the bullet between the header's two coordinates, and of
  // the slash in a width's left/right distribution. The frame sets both at none; the
  // slash reads cramped at none, so it is given two.
  headerSeparatorGap: 0,
  subSeparatorGap: 2,
};

// Values joined by a separator with `gap` either side of it, in the current font.
function joinedWidth(context, parts, separator, gap) {
  const items = joinedItems(parts, separator);
  return (
    items.reduce((sum, text) => sum + context.measureText(text).width, 0) +
    gap * (items.length - 1)
  );
}

function fillJoined(context, parts, separator, gap, x, y) {
  for (const text of joinedItems(parts, separator)) {
    context.fillText(text, x, y);
    x += context.measureText(text).width + gap;
  }
}

function joinedItems(parts, separator) {
  const items = [];
  parts.forEach((part, i) => {
    if (i) {
      items.push(separator);
    }
    items.push(String(part));
  });
  return items;
}

const PLAQUE_COLORS = {
  fill: "#FFFFFF",
  value: "#303030",
  small: "#8E8E8E",
};

export const PLAQUE_SCREEN_PARAMETERS = {
  plaqueScale: 1,
  plaqueOffset: 8,
  labelBorderWidth: 1,
};

// Martian Mono's tracking is -3 per cent.
const TRACKING = -0.03;

// The measurement labels' font at `size` glyph units, set at the tuned measure size
// with the context scaled to make up the difference, so that zooming out past the
// screen minimum does not make a new font string at every step. Returns the scale;
// the caller divides its coordinates by it. Call it inside save and restore.
export function setMeasureLabelFont(context, size) {
  const base = LABEL_TUNING.measureSize;
  const scale = size / base;
  context.scale(scale, scale);
  setLabelFont(context, base, TRACKING, MEASURE_LABEL_WEIGHT);
  return scale;
}

export function setLabelFont(
  context,
  size,
  tracking = TRACKING,
  weight = LABEL_WEIGHT
) {
  context.font = `${weight} ${size}px ${LABEL_FONT_FAMILY}`;
  context.fontStretch = "semi-condensed";
  context.letterSpacing = `${tracking * size}px`;
}

// The five icons, exported from the frame as they are, served from /images.
const PLAQUE_ICONS = {
  distance: { src: "/images/measure-distance.svg", width: 9, height: 9 },
  tension: { src: "/images/measure-tension.svg", width: 9, height: 9 },
  angle: { src: "/images/measure-angle.svg", width: 9, height: 9 },
  width: { src: "/images/measure-width.svg", width: 9, height: 11 },
  tangentialShift: {
    src: "/images/measure-tangential-shift.svg",
    width: 9,
    height: 9,
  },
};

const iconImages = new Map();

// An icon draws once its image has loaded. The first frame that asks for it starts the
// load and draws without it; `onLoad` asks for the frame again.
function drawPlaqueIcon(context, icon, x, top, width, height, onLoad) {
  if (typeof Image === "undefined") {
    return;
  }
  let image = iconImages.get(icon.src);
  if (!image) {
    image = new Image();
    image.onload = () => onLoad?.();
    image.src = icon.src;
    iconImages.set(icon.src, image);
  }
  if (image.complete && image.naturalWidth) {
    context.drawImage(image, x, top, width, height);
  }
}

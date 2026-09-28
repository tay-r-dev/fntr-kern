import {
  drawLabel,
  drawPlaque,
  LABEL_COLORS,
  LABEL_SCREEN_PARAMETERS,
  PLAQUE_SCREEN_PARAMETERS,
} from "@fontra/core/canvas-labels.js";
import { drawPointStyleLabel } from "@fontra/core/distance-angle.js";
import { expect } from "chai";

// A 2D context that keeps a transform and records every font it is given. The browser
// resolves each new font string afresh, so a zoom must not make a new one.
function recordingContext(scale) {
  let m = { a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 };
  const stack = [];
  const fonts = [];
  const context = {
    fonts,
    set font(value) {
      fonts.push(value);
    },
    get font() {
      return fonts.at(-1);
    },
    save: () => stack.push({ ...m }),
    restore: () => (m = stack.pop()),
    scale: (x, y) => (m = { ...m, a: m.a * x, b: m.b * x, c: m.c * y, d: m.d * y }),
    translate: (x, y) =>
      (m = { ...m, e: m.e + m.a * x + m.c * y, f: m.f + m.b * x + m.d * y }),
    setTransform: (a, b, c, d, e, f) => (m = { a, b, c, d, e, f }),
    getTransform: () => ({ ...m }),
    measureText: (text) => ({ width: String(text).length * 5 }),
    fillText() {},
    beginPath() {},
    roundRect() {},
    fill() {},
    stroke() {},
    clip() {},
    drawImage() {},
  };
  return context;
}

// The layer machinery turns screen parameters into glyph units at the zoom.
function atZoom(parameters, scale) {
  return Object.fromEntries(
    Object.entries(parameters).map(([key, value]) => [key, value / scale])
  );
}

describe("canvas labels keep one font across zoom", () => {
  it("a pill sets the same fonts at every zoom", () => {
    const fontsAt = (scale) => {
      const context = recordingContext(scale);
      drawLabel(
        context,
        { ...atZoom(LABEL_SCREEN_PARAMETERS, scale), ...LABEL_COLORS },
        { x: 10, y: 20 },
        ["12", "34"]
      );
      return context.fonts;
    };
    expect(fontsAt(0.37)).to.deep.equal(fontsAt(1));
    expect(fontsAt(2.9)).to.deep.equal(fontsAt(1));
  });

  it("a plaque sets the same fonts at every zoom", () => {
    const fontsAt = (scale) => {
      const context = recordingContext(scale);
      drawPlaque(context, atZoom(PLAQUE_SCREEN_PARAMETERS, scale), { x: 0, y: 0 }, {
        header: { left: "#3", right: ["10", "20"] },
        rows: [{ icon: "width", value: "40", sub: ["20", "20"] }],
      });
      return context.fonts;
    };
    expect(fontsAt(0.37)).to.deep.equal(fontsAt(1));
  });

  it("a measurement label held at its screen minimum sets the same font at every zoom", () => {
    const fontAt = (scale) => {
      const context = recordingContext(scale);
      drawPointStyleLabel(context, 0, 0, "12", "black");
      return context.fonts;
    };
    // Zoomed far out, where the minimum screen size holds the label up.
    expect(fontAt(0.05)).to.deep.equal(fontAt(0.08));
  });
});

import {
  drawLabel,
  drawPlaque,
  LABEL_COLORS,
  LABEL_TUNING,
  measureLabelAlpha,
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
      drawPlaque(
        context,
        atZoom(PLAQUE_SCREEN_PARAMETERS, scale),
        { x: 0, y: 0 },
        {
          header: { left: "#3", right: ["10", "20"] },
          rows: [{ icon: "width", value: "40", sub: ["20", "20"] }],
        }
      );
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

// label/Q (Figma 2004:29990): the values thin and condensed in text/base/basic/1,
// the header in text/base/basic/3, a width's distribution in icon/base/basic/2, a
// card with no outline.
describe("the plaque draws label/Q", () => {
  function drawn() {
    const context = recordingContext(1);
    const texts = [];
    let strokes = 0;
    context.fontStretch = "";
    context.fillText = (text) =>
      texts.push({
        text: String(text),
        font: context.font,
        stretch: context.fontStretch,
        color: context.fillStyle,
      });
    context.stroke = () => strokes++;
    drawPlaque(
      context,
      PLAQUE_SCREEN_PARAMETERS,
      { x: 0, y: 0 },
      {
        header: { left: "", right: ["10", "30"] },
        rows: [{ icon: "width", value: "40.0", sub: ["20.0", "20.0"] }],
      }
    );
    return { texts, strokes };
  }

  it("sets the value thin and condensed, in text/base/basic/1", () => {
    const value = drawn().texts.find((t) => t.text === "40.0");
    expect(value.font).to.match(/^200 /);
    expect(value.stretch).to.equal("condensed");
    expect(value.color).to.equal("#1E1E1E");
  });

  it("sets the distribution light and semi-condensed, in icon/base/basic/2", () => {
    const small = drawn().texts.find((t) => t.text === "20.0");
    expect(small.font).to.match(/^300 /);
    expect(small.stretch).to.equal("semi-condensed");
    expect(small.color).to.equal("#515151");
  });

  it("sets the header in text/base/basic/3", () => {
    const header = drawn().texts.find((t) => t.text === "30");
    expect(header.color).to.equal("#8D8D8D");
  });

  it("draws no outline", () => {
    expect(drawn().strokes).to.equal(0);
  });
});

describe("measurement labels fade below the screen minimum", () => {
  const at = (scale) => ({ getTransform: () => ({ a: scale, b: 0 }) });
  // measureSize 6 units, minimum 7 px: the cutoff is at 7/6 px per unit.
  const cutoff = LABEL_TUNING.measureMinScreenSize / LABEL_TUNING.measureSize;

  it("is opaque where the label still zooms", () => {
    expect(measureLabelAlpha(at(cutoff))).to.equal(1);
    expect(measureLabelAlpha(at(cutoff * 3))).to.equal(1);
  });

  it("fades gradually past the cutoff, towards the maximum transparency", () => {
    const max = LABEL_TUNING.measureMaxFade / 100;
    const half = measureLabelAlpha(at(cutoff / 2));
    expect(half).to.be.closeTo(1 - max / 2, 1e-9);
    expect(measureLabelAlpha(at(cutoff / 1000))).to.be.closeTo(1 - max, 1e-3);
    expect(measureLabelAlpha(at(cutoff * 0.9))).to.be.above(half);
  });
});

// Drawing a canvas onto itself through a filter makes a GPU canvas read its pixels
// back and wait for the GPU, once a label, every frame: the stall behind the zoom
// and drag lag. The cards are opaque, so nothing of it showed.
describe("canvas labels never read the canvas back", () => {
  function watchingContext() {
    const context = recordingContext(1);
    context.canvas = { width: 1000, height: 1000 };
    context.filter = "none";
    context.readBacks = 0;
    context.drawImage = (image) => {
      if (image === context.canvas) {
        context.readBacks++;
      }
    };
    return context;
  }

  it("a pill draws without reading the canvas", () => {
    const context = watchingContext();
    drawLabel(
      context,
      { ...LABEL_SCREEN_PARAMETERS, ...LABEL_COLORS },
      { x: 0, y: 0 },
      ["12"]
    );
    expect(context.readBacks).to.equal(0);
    expect(context.filter).to.equal("none");
  });

  it("a plaque draws without reading the canvas", () => {
    const context = watchingContext();
    drawPlaque(
      context,
      PLAQUE_SCREEN_PARAMETERS,
      { x: 0, y: 0 },
      {
        rows: [{ icon: "width", value: "40" }],
      }
    );
    expect(context.readBacks).to.equal(0);
    expect(context.filter).to.equal("none");
  });
});

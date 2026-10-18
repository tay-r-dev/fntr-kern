import { expect } from "chai";
import {
  planScrollbarScan,
  scrollForThumbOffset,
  scrollbarThumb,
} from "../src/scrollbars.js";

describe("scrollbarThumb", () => {
  it("is hidden when everything fits", () => {
    expect(scrollbarThumb(0, 100, 100, 80).visible).to.equal(false);
    expect(scrollbarThumb(0, 100.5, 100, 80).visible).to.equal(false);
  });

  it("is as long as the share shown, and moves with the scroll", () => {
    expect(scrollbarThumb(0, 400, 100, 80)).to.deep.equal({
      visible: true,
      length: 20,
      offset: 0,
    });
    expect(scrollbarThumb(300, 400, 100, 80).offset).to.equal(60);
    expect(scrollbarThumb(150, 400, 100, 80).offset).to.equal(30);
  });

  it("is never shorter than its minimum", () => {
    const thumb = scrollbarThumb(9900, 10000, 100, 80);
    expect(thumb.length).to.equal(16);
    expect(thumb.offset).to.equal(64);
  });
});

describe("scrollForThumbOffset", () => {
  it("maps a thumb position back to a scroll position, within range", () => {
    expect(scrollForThumbOffset(30, 400, 100, 80)).to.equal(150);
    expect(scrollForThumbOffset(-10, 400, 100, 80)).to.equal(0);
    expect(scrollForThumbOffset(500, 400, 100, 80)).to.equal(300);
  });
});

describe("planScrollbarScan", () => {
  const node = (parentNode = null) => ({ parentNode });
  const html = node();
  const panel = node(html);
  const item = node(panel);
  const shadow = { parentNode: null, host: item };
  const inShadow = node(shadow);

  it("checks a style change on its own element and walks nothing", () => {
    const plan = planScrollbarScan(new Set(), new Set([html]));
    expect(plan.walk).to.deep.equal([]);
    expect(plan.check).to.deep.equal([html]);
  });

  it("walks a tree once when an ancestor is already walked", () => {
    const plan = planScrollbarScan(new Set([panel, html, item]), new Set());
    expect(plan.walk).to.deep.equal([html]);
  });

  it("follows a shadow root to its host", () => {
    const plan = planScrollbarScan(new Set([panel, inShadow]), new Set([inShadow]));
    expect(plan.walk).to.deep.equal([panel]);
    expect(plan.check).to.deep.equal([]);
  });

  it("keeps separate trees separate", () => {
    const other = node(html);
    const plan = planScrollbarScan(new Set([panel, other]), new Set([html]));
    expect(plan.walk).to.deep.equal([panel, other]);
    expect(plan.check).to.deep.equal([html]);
  });
});

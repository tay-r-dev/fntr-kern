import { expect } from "chai";
import { scrollForThumbOffset, scrollbarThumb } from "../src/scrollbars.js";

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

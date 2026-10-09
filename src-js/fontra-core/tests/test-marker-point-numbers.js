import { expect } from "chai";
import { skeletonPointNumber } from "../src/marker-model.js";

describe("skeletonPointNumber", () => {
  const skeletonData = {
    contours: [
      { id: "a", points: [{ id: "a0" }, { id: "a1" }, { id: "a2" }] },
      { id: "empty", points: [] },
      { id: "b", points: [{ id: "b0" }, { id: "b1" }] },
    ],
  };

  it("counts the skeleton's points in one run across its contours", () => {
    expect(skeletonPointNumber(skeletonData, "a", "a0")).to.equal(0);
    expect(skeletonPointNumber(skeletonData, "a", "a2")).to.equal(2);
    expect(skeletonPointNumber(skeletonData, "b", "b0")).to.equal(3);
    expect(skeletonPointNumber(skeletonData, "b", "b1")).to.equal(4);
  });

  it("names nothing for a point that is gone", () => {
    expect(skeletonPointNumber(skeletonData, "b", "zz")).to.equal(null);
    expect(skeletonPointNumber(skeletonData, "zz", "a0")).to.equal(null);
    expect(skeletonPointNumber(null, "a", "a0")).to.equal(null);
  });
});

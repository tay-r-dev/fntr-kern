// Run from the repository root. The old output is captured at 635a1d3aa;
// the new output is always made by the working tree's actual generator.
import fs from "node:fs";
import { generateFromSkeleton } from "../src-js/fontra-core/src/skeleton-generator.js";
const original = JSON.parse(fs.readFileSync("docs/demos/bulb-before.json", "utf8"));
const data = {
  ...original,
  cases: original.cases.map((sample) => {
    const skeleton = {
      contours: [
        {
          id: 1,
          closed: false,
          defaultWidth: 80,
          points: original.points.map((point, index) => ({
            ...point,
            smooth: false,
            ...(index === 3
              ? {
                  capStyle: "drop",
                  capBallSide: "left",
                  capBallRatio: sample.ratio,
                  capBallShape: sample.shape,
                  capBallEasing: sample.easing,
                }
              : {}),
          })),
        },
      ],
    };
    const result = generateFromSkeleton(skeleton);
    return {
      ...sample,
      current: result.contours[0].points.map(({ x, y, type }) => [
        +x.toFixed(4),
        +y.toFixed(4),
        type ? "c" : null,
      ]),
    };
  }),
};
const template = fs.readFileSync("docs/demos/bulb-comparison.template.html", "utf8");
const fragment = template.replace("/* BULB_DATA */ null", JSON.stringify(data));
const standalone = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bulb terminal comparison</title><style>
:root{color-scheme:light dark;--background:light-dark(#faf9f5,#181a1d);--foreground:light-dark(#202329,#e9eaed);--muted-foreground:light-dark(#606772,#a6aab3);--border:light-dark(#d1d4d9,#474c55);--viz-series-1:light-dark(#217b93,#65c9df);--viz-series-2:light-dark(#b67515,#e7b05a);--font-size-base:14px}
body{margin:0;background:var(--background);color:var(--foreground);font:400 14px/1.5 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:24px}h1,h2{font-weight:500}h1{font-size:24px}h2{font-size:18px}.text-small{font-size:12px}.form-label{display:block}.form-range{width:100%;accent-color:var(--foreground)}.form-check{display:inline-flex;align-items:center;gap:8px}.form-check-input{accent-color:var(--foreground)}.tabular-nums{font-variant-numeric:tabular-nums}button,input{font:inherit}input{min-height:28px}
</style></head><body><main>${fragment}</main></body></html>`;
fs.writeFileSync("docs/demos/bulb-comparison.html", standalone);
if (process.argv[2]) fs.writeFileSync(process.argv[2], fragment);
console.log(`Generated ${data.cases.length} measured comparisons.`);

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { resetTensionBoundStats, tensionBoundStats } from "../../src/offset-cubic.js";
import { generateFromSkeleton } from "../../src/skeleton-generator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "data", "skeleton-generator", "fixtures.json"),
    "utf8"
  )
);
resetTensionBoundStats();
for (const fixture of fixtures) generateFromSkeleton(fixture.canonical);
console.log("fixtures:", JSON.stringify(tensionBoundStats));

resetTensionBoundStats();
for (let handle = 5; handle <= 120; handle += 5)
  for (let width = 5; width <= 120; width += 5)
    for (let taper = 0; taper <= 4; taper++) {
      generateFromSkeleton({
        contours: [
          {
            id: 1,
            closed: false,
            defaultWidth: width * 2,
            points: [
              {
                id: 1,
                x: 0,
                y: 0,
                smooth: false,
                width: { left: width, right: width },
              },
              { id: 2, x: handle, y: handle, type: "cubic" },
              { id: 3, x: 120 - handle, y: handle, type: "cubic" },
              {
                id: 4,
                x: 120,
                y: 0,
                smooth: false,
                width: { left: width * (1 + taper), right: width * (1 + taper) },
              },
            ],
          },
        ],
      });
    }
console.log("sweep:", JSON.stringify(tensionBoundStats));

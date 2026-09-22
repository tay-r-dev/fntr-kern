import { generateFromSkeleton } from "../src/skeleton-generator.js";
import { normalizeSkeletonData } from "../src/skeleton-model.js";
import { makeSerifWall, buildSerifTerminal, computeSerifFrame } from "../src/serif-geometry.js";
const make = (cap) => normalizeSkeletonData({ contours: [{ id: 4, defaultWidth: 80, capStyle: "butt", points: [
  { id: 8, x: 278, y: 472, capStyle: cap, serif: { axisMode: "perpendicular", left: { concavity: -1, tipThickness: 20, wingLength: 20, wingSlope: 29, easeDistance: 10, easeCurvature: 0.5 }, right: { concavity: -1, tipThickness: 20, wingLength: 20, wingSlope: 29 } } },
  { id: 9, x: 157, y: 572, type: "cubic" }, { id: 10, x: 91, y: 503, type: "cubic" },
  { id: 7, x: 91, y: 435, smooth: true }, { id: 6, x: 91, y: 377 },
  { id: 5, x: 94, y: 0, capStyle: cap, serif: { axisMode: "perpendicular", left: { concavity: 1, reach: 31, tension: 0.81, tipThickness: 20, wingLength: 20 }, right: { concavity: 1, reach: 31, tension: 0.81, tipThickness: 20, wingLength: 20 } } },
] }] });
const time = (label, f, n = 3000) => { for (let i = 0; i < 300; i++) f(); const t0 = performance.now(); for (let i = 0; i < n; i++) f(); console.log(label, ((performance.now() - t0) / n * 1000).toFixed(1), "us"); };
for (const cap of ["serif", "butt", "serif", "butt"]) { const d = make(cap); time(cap + " glyph", () => generateFromSkeleton(d)); }
const wall = [{u:40,v:0},{u:40,v:40},{u:60,v:90},{u:90,v:140}];
const params = { wingLength: 20, tipThickness: 20, wingSlope: 20, reach: 20, tension: 0.6, concavity: 0.7, easeDistance: 10, easeCurvature: 0.5 };
const frame = computeSerifFrame({ endpoint:{x:0,y:0}, tangent:{x:0,y:-1}, normal:{x:-1,y:0}, axisMode:"perpendicular" });
time("one wall", () => makeSerifWall(wall));
time("one terminal (2 walls + halves + cup)", () => buildSerifTerminal({ frame, leftWall: makeSerifWall(wall), rightWall: makeSerifWall(wall.map(p=>({u:-p.u,v:p.v}))), left: params, right: params, undersideCup: 3 }));

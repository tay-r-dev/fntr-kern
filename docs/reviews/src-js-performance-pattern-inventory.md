# All-src-js performance-pattern inventory

Review target: `02bbd755925f4eb8a5f00fc248853aac7ba1f756`. Scope: **all tracked code under `src-js`, regardless of whether inherited from Fontra or added by the fork**. This expands the earlier fork-focused triage.

Inventoried 832 tracked files; scanned 431 code/markup/style files, including tests and tooling. File counts by scope: markup/style: 112, runtime/tooling: 228, test: 91. JavaScript, TypeScript, CommonJS, ES modules, HTML, CSS and SVG are included. Remaining files are summarized below as assets/data/configuration; no dependencies were installed and no tests or application code were executed.

## What these results mean

There are 6,992 category occurrences on 6,601 distinct lines. **These are unverified candidates, not a list of performance bugs.** Categories overlap, and raw counts reflect file size and coding style as well as possible cost. A zero means no match in this heuristic scan, not a clean bill of health.

Every candidate, including inherited code, is listed below by file, category and exact line number. File links point to the reviewed commit. Test-only matches are labelled separately so they do not get mistaken for editor runtime costs.

The [feature audit](ui-ux-refactor-feature-audit.md) contains the findings already confirmed by contextual inspection. Its K3, H2, V4, SM2, SE2, SE3 and T3 entries describe expensive copies, repeated searches, rescoring and regeneration; D1 and T4 address lifecycle problems. Those findings are not inferred merely from this inventory.

## Method and limitations

The scan reads each tracked source file line by line using the category expressions below, skips standalone comment lines and records each category at most once per line. It applies no ancestry or added-line filter. It does not parse an AST, build a call graph, prove loop nesting, infer collection sizes, or establish listener ownership. Multiline expressions can be missed; strings and inline comments can match. Front mutations may be appropriate queues, awaits may express real dependencies, and maps or listeners may have bounded lifetimes.

Next inspection should prioritize operations in pointer events, rendering, bulk edits and persistent caches. Read their callers and cleanup paths before promoting a candidate to a finding. Preserve largest-file review order for the broader audit; inherited findings belong in the expanded review as well.

## Categories

| Category | Occurrences | Search expression |
| --- | ---: | --- |
| copy/serialization | 234 | `structuredClone\(&#124;JSON\.(?:stringify&#124;parse)\(&#124;new Map\([^)]*\w[^)]*\)&#124;\.copy\(` |
| collection search | 815 | `\.(?:find&#124;findIndex&#124;filter&#124;includes&#124;indexOf&#124;some&#124;every)\(` |
| collection transform | 1466 | `\.(?:map&#124;flatMap&#124;filter&#124;sort&#124;reverse)\(` |
| lifecycle registration | 505 | `(?:requestAnimationFrame&#124;setInterval&#124;setTimeout&#124;addEventListener&#124;addKeyListener)\(` |
| layout read | 55 | `(?:getBoundingClientRect\(&#124;\.(?:offsetWidth&#124;offsetHeight&#124;offsetParent&#124;clientWidth&#124;clientHeight)\b)` |
| front mutation/splice | 115 | `\.(?:unshift&#124;shift&#124;splice)\(` |
| await | 1250 | `\bawait\b` |
| loop | 2337 | `\b(?:for&#124;while)\s*(?:await\s*)?\(&#124;\.forEach\(` |
| DOM replacement/write | 154 | `\.(?:innerHTML&#124;innerText&#124;textContent)\s*=&#124;\.(?:replaceChildren&#124;setFieldDescriptions)\(` |
| CSS filter/animation | 61 | `(?:backdrop-filter&#124;filter&#124;box-shadow&#124;animation&#124;transition)\s*:` |


## Candidate locations

All entries below remain unverified. Numbers are source line numbers at the pinned review target.

### [src-js/fontra-core/assets/css/core.css](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/css/core.css)

- **CSS filter/animation:** 130, 162

### [src-js/fontra-core/assets/css/shared.css](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/css/shared.css)

- **CSS filter/animation:** 22

### [src-js/fontra-core/assets/css/tooltip.css](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/css/tooltip.css)

- **CSS filter/animation:** 190, 194

### [src-js/fontra-core/src/actions.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/actions.js)

- **collection search:** 317, 333, 342
- **collection transform:** 124
- **loop:** 124, 128, 165, 205, 295, 296

### [src-js/fontra-core/src/autokern-cache.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/autokern-cache.js)

- **collection search:** 225, 530, 551
- **collection transform:** 203, 225, 229, 257, 431, 530, 551
- **copy/serialization:** 131, 160, 184, 300, 401
- **loop:** 285, 301, 404, 464, 476, 484, 498, 504, 526, 553, 554

### [src-js/fontra-core/src/autokern-classes.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/autokern-classes.js)

- **collection search:** 206, 221
- **collection transform:** 200, 221, 222
- **copy/serialization:** 72
- **loop:** 101, 122, 161, 203, 205, 246, 251, 265

### [src-js/fontra-core/src/autokern-engine.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/autokern-engine.js)

- **collection transform:** 430
- **loop:** 42, 44, 54, 55, 70, 71, 76, 83, 84, 88, 112, 117, 118, 135, 184, 188, 198, 200, 217, 218, 222, 229, 230, 234, 259, 260, 275, 283, 307, 348, 363

### [src-js/fontra-core/src/axis-ui.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/axis-ui.js)

- **collection search:** 143, 241, 289, 418, 422, 423
- **collection transform:** 143, 241, 418, 419
- **layout read:** 231
- **lifecycle registration:** 116, 191, 206, 286, 308
- **loop:** 278, 325, 412

### [src-js/fontra-core/src/backend-api.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/backend-api.js)

- **await:** 71, 75, 80, 88, 93, 98, 103, 108
- **copy/serialization:** 77

### [src-js/fontra-core/src/canvas-controller.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/canvas-controller.js)

- **await:** 316
- **layout read:** 78, 84, 111
- **lifecycle registration:** 30, 33, 36, 39, 62, 67, 316

### [src-js/fontra-core/src/change-recorder.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/change-recorder.js)

- **front mutation/splice:** 32

### [src-js/fontra-core/src/changes.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/changes.js)

- **collection search:** 172
- **collection transform:** 135, 146, 172, 248, 250, 486, 568
- **copy/serialization:** 483, 486
- **front mutation/splice:** 52, 83, 104, 246, 248, 250
- **loop:** 99, 220, 226, 231, 296, 322, 357, 378, 402, 418, 482, 498, 499, 509, 526, 548, 549, 558

### [src-js/fontra-core/src/character-lines.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/character-lines.js)

- **collection transform:** 119
- **loop:** 13, 38, 120, 138, 140, 175, 183

### [src-js/fontra-core/src/classes.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/classes.js)

- **collection transform:** 61
- **loop:** 26

### [src-js/fontra-core/src/cmap.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/cmap.js)

- **collection search:** 180
- **front mutation/splice:** 182, 191
- **loop:** 26, 43, 44, 93, 94, 105, 189

### [src-js/fontra-core/src/coarse-grid-presets.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/coarse-grid-presets.js)

- **collection search:** 40
- **collection transform:** 40
- **loop:** 33, 56

### [src-js/fontra-core/src/composition-build.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/composition-build.js)

- **await:** 48, 53, 136, 157, 168
- **collection search:** 192, 212
- **collection transform:** 150, 162, 180, 236
- **loop:** 36, 47, 98, 153, 201, 209, 240, 245, 255, 264, 267

### [src-js/fontra-core/src/composition.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/composition.js)

- **collection search:** 46, 102, 107, 168
- **collection transform:** 46, 97, 102, 107, 108, 112, 121, 168
- **front mutation/splice:** 87, 162
- **loop:** 26, 61, 80, 177

### [src-js/fontra-core/src/convex-hull.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/convex-hull.js)

- **collection transform:** 90, 98, 106, 125
- **loop:** 19, 54, 135, 136, 162, 173

### [src-js/fontra-core/src/corner-overlap.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/corner-overlap.js)

- **collection search:** 140, 181, 185, 186
- **collection transform:** 139, 140, 157, 181, 192
- **copy/serialization:** 241
- **loop:** 115, 123, 146, 150, 210, 222, 243, 247

### [src-js/fontra-core/src/cross-axis-mapper.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/cross-axis-mapper.js)

- **collection search:** 15, 18, 44
- **collection transform:** 15, 18, 25
- **front mutation/splice:** 45, 46
- **loop:** 29, 58, 61, 91

### [src-js/fontra-core/src/curvature.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/curvature.js)

- **collection transform:** 549
- **loop:** 101, 115, 225, 266, 271, 425, 427, 440, 459, 490, 524, 528

### [src-js/fontra-core/src/discrete-variation-model.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/discrete-variation-model.js)

- **collection search:** 13, 14, 46, 55, 59, 191
- **collection transform:** 13, 14, 44, 54, 55, 59, 172, 239, 240, 246, 248, 276
- **copy/serialization:** 22, 121, 127, 166, 178, 274
- **loop:** 20, 65, 155, 187, 210, 259, 261

### [src-js/fontra-core/src/distance-angle.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/distance-angle.js)

- **collection transform:** 377, 1219, 1263
- **loop:** 97, 224, 536, 831, 889, 907, 920, 934, 1024, 1157, 1179, 1210, 1215, 1242, 1259, 1260, 1377, 1534, 1558, 1578

### [src-js/fontra-core/src/fit-cubic.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/fit-cubic.js)

- **collection transform:** 16, 112, 128
- **loop:** 30, 37, 148, 165, 171, 180

### [src-js/fontra-core/src/font-controller.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/font-controller.js)

- **await:** 77, 81, 82, 83, 84, 85, 86, 87, 88, 172, 178, 182, 186, 190, 194, 233, 311, 360, 418, 433, 435, 464, 537, 553, 564, 582, 594, 597, 615, 620, 652, 660, 664, 669, 715, 771, 783, 789, 791, 796, 814, 897, 925, 936, 946, 989, 990, 1041, 1046, 1066, 1072, 1095, 1113, 1272, 1278, 1286, 1291, 1297, 1304, 1305, 1310, 1311, 1437
- **collection search:** 225, 389, 699, 736, 738
- **collection transform:** 121, 207, 225, 229, 699, 736, 738, 1082, 1152, 1181, 1226
- **front mutation/splice:** 1350
- **lifecycle registration:** 751, 1000
- **loop:** 206, 372, 399, 420, 429, 430, 482, 489, 590, 593, 600, 607, 714, 746, 821, 829, 833, 844, 848, 864, 866, 884, 886, 903, 909, 924, 941, 1071, 1092, 1093, 1112, 1253

### [src-js/fontra-core/src/font-sources-instancer.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/font-sources-instancer.js)

- **collection search:** 18, 49
- **collection transform:** 18, 23, 26, 49, 56, 66

### [src-js/fontra-core/src/fontra-backend.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/fontra-backend.js)

- **await:** 20, 21, 22, 27, 39, 66, 114, 123, 131
- **collection transform:** 283
- **copy/serialization:** 66, 131, 165
- **front mutation/splice:** 41
- **loop:** 27, 46, 137, 147, 160, 189, 245, 270, 299, 318

### [src-js/fontra-core/src/fontra-menus.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/fontra-menus.js)

- **collection search:** 64, 200
- **collection transform:** 56, 133, 193
- **loop:** 24, 206

### [src-js/fontra-core/src/formatters.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/formatters.js)

- **copy/serialization:** 116

### [src-js/fontra-core/src/glyph-controller.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/glyph-controller.js)

- **await:** 413, 430, 469, 472, 486, 653, 1228, 1238, 1701, 1706, 1718
- **collection search:** 120, 128, 134, 241, 282, 343, 556, 576, 866, 926, 992, 993, 1003, 1054, 1108, 1280, 1329, 1494
- **collection transform:** 111, 119, 120, 128, 134, 241, 242, 250, 269, 272, 282, 283, 343, 443, 532, 555, 576, 586, 843, 940, 1000, 1003, 1005, 1016, 1021, 1176, 1191, 1276, 1329, 1391, 1406, 1419, 1453, 1463, 1493, 1494, 1498, 1505, 1523, 1532, 1536, 1570, 1573, 1617, 1651, 1659
- **copy/serialization:** 368
- **loop:** 150, 169, 177, 206, 207, 260, 305, 311, 331, 348, 366, 387, 460, 504, 538, 553, 581, 606, 652, 810, 818, 825, 864, 876, 889, 930, 953, 1091, 1127, 1199, 1226, 1244, 1252, 1293, 1303, 1304, 1313, 1335, 1380, 1459, 1499, 1508, 1512, 1550, 1551, 1554, 1569, 1595, 1633, 1679, 1704, 1716, 1723, 1733, 1755, 1757, 1758, 1771, 1773, 1774, 1778, 1779

### [src-js/fontra-core/src/glyph-data.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/glyph-data.js)

- **await:** 12, 13, 14, 25, 26
- **collection search:** 133, 140
- **collection transform:** 135, 139, 140, 143
- **front mutation/splice:** 42
- **loop:** 48, 56, 176

### [src-js/fontra-core/src/glyph-glif.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/glyph-glif.js)

- **collection transform:** 78
- **front mutation/splice:** 30
- **loop:** 11, 20, 29, 32, 39, 55, 63

### [src-js/fontra-core/src/glyph-organizer.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/glyph-organizer.js)

- **collection search:** 30, 77, 80, 90, 133, 138, 214, 215, 278, 279
- **collection transform:** 30, 67, 77, 80, 81, 86, 90, 97, 104, 128, 133, 168, 170
- **loop:** 117, 136, 157, 183, 208

### [src-js/fontra-core/src/glyph-raster.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/glyph-raster.js)

- **loop:** 55

### [src-js/fontra-core/src/glyphsets-controller.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/glyphsets-controller.js)

- **await:** 60, 105, 116, 128, 130, 210
- **collection search:** 65, 214, 227, 241
- **collection transform:** 57, 61, 65, 214, 227, 241, 280
- **lifecycle registration:** 200, 233, 247
- **loop:** 67, 68, 259

### [src-js/fontra-core/src/glyphsets-ui.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/glyphsets-ui.js)

- **CSS filter/animation:** 55
- **DOM replacement/write:** 136, 457, 458
- **await:** 150, 155, 165, 355, 471, 493, 565, 643
- **collection search:** 331, 339, 453, 545
- **collection transform:** 212, 222, 312, 325, 331, 332, 399, 415, 416, 423, 463
- **layout read:** 239
- **lifecycle registration:** 96, 98, 336, 443, 563
- **loop:** 105, 304, 338, 501, 502, 507

### [src-js/fontra-core/src/harmonization.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/harmonization.js)

- **collection search:** 536, 538, 560, 1971, 2033, 2193, 2227, 2297, 2380
- **collection transform:** 500, 536, 575, 607, 1420, 1472, 1630, 1696, 2043, 2108, 2193, 2194, 2213, 2280, 2294, 2305, 2380
- **copy/serialization:** 1355, 2162, 2213, 2426
- **loop:** 171, 268, 482, 492, 606, 800, 855, 902, 943, 974, 1116, 1118, 1235, 1252, 1254, 1281, 1322, 1414, 1423, 1425, 1430, 1431, 1477, 1491, 1505, 1518, 1521, 1566, 1588, 1662, 1676, 1695, 1741, 1744, 1858, 1885, 1931, 1963, 1995, 2025, 2068, 2214, 2283, 2293, 2357, 2394

### [src-js/fontra-core/src/harmonize-nearest.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/harmonize-nearest.js)

- **collection search:** 192
- **collection transform:** 104, 158, 188
- **loop:** 196, 205, 219, 225, 233

### [src-js/fontra-core/src/html-utils.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/html-utils.js)

- **DOM replacement/write:** 99, 137, 147
- **await:** 102
- **loop:** 46, 61, 111, 121, 128

### [src-js/fontra-core/src/kerning-controller.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/kerning-controller.js)

- **await:** 273, 277, 282, 476, 522, 534, 552, 554, 562, 596
- **collection search:** 110, 153, 200, 224, 228, 301, 302, 314, 315, 349, 365, 375, 404, 490
- **collection transform:** 152, 153, 167, 224, 302, 372, 375
- **front mutation/splice:** 319, 416, 422
- **loop:** 28, 79, 154, 155, 205, 238, 257, 296, 352, 353, 356, 410, 411, 488, 526, 534, 539, 576, 609, 610, 639

### [src-js/fontra-core/src/letterspacer-engine.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/letterspacer-engine.js)

- **collection search:** 184
- **collection transform:** 15, 21, 134, 135, 183, 184, 185
- **loop:** 5, 167

### [src-js/fontra-core/src/loader-spinner.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/loader-spinner.js)

- **await:** 5
- **lifecycle registration:** 19

### [src-js/fontra-core/src/local-font-engine.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/local-font-engine.js)

- **await:** 7, 11, 15, 19, 23, 27, 31, 35, 39, 43, 55

### [src-js/fontra-core/src/localization.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/localization.js)

- **lifecycle registration:** 85

### [src-js/fontra-core/src/lru-cache.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/lru-cache.js)

- **loop:** 92, 100, 108, 116

### [src-js/fontra-core/src/marker-measure.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/marker-measure.js)

- **collection search:** 162, 166, 168, 186
- **collection transform:** 52, 56, 148, 168, 172, 180, 216, 222, 226
- **loop:** 24, 66, 84

### [src-js/fontra-core/src/marker-model.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/marker-model.js)

- **collection search:** 189, 249, 290, 361, 406, 463, 468
- **collection transform:** 277, 281, 293, 368, 410
- **copy/serialization:** 307
- **loop:** 50, 70, 206, 208, 224, 226, 381, 403, 404, 438, 440

### [src-js/fontra-core/src/metrics-keys.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/metrics-keys.js)

- **collection search:** 62, 97
- **collection transform:** 97

### [src-js/fontra-core/src/mouse-tracker.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/mouse-tracker.js)

- **lifecycle registration:** 16, 17, 18, 19, 20, 21, 22, 28, 31

### [src-js/fontra-core/src/multi-panel.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/multi-panel.js)

- **collection search:** 180
- **collection transform:** 176
- **lifecycle registration:** 90
- **loop:** 61, 111, 136

### [src-js/fontra-core/src/natural-handle-solver.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/natural-handle-solver.js)

- **collection transform:** 74
- **loop:** 105, 315, 318, 321, 322, 329, 342

### [src-js/fontra-core/src/observable-object.ts](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/observable-object.ts)

- **await:** 149
- **collection search:** 52, 88
- **collection transform:** 52, 88
- **copy/serialization:** 254, 287, 292
- **lifecycle registration:** 123, 129, 180, 310
- **loop:** 65, 83, 176, 235, 248

### [src-js/fontra-core/src/offset-contour.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/offset-contour.js)

- **collection search:** 171, 367, 385, 417, 587, 596, 597, 710, 853
- **collection transform:** 587, 596, 597, 709, 710
- **loop:** 19, 27, 149, 167, 175, 216, 364, 653, 712, 802, 820, 851, 852, 900

### [src-js/fontra-core/src/opfs-write-worker.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/opfs-write-worker.js)

- **await:** 11, 24, 27, 30, 31, 32, 38
- **loop:** 26

### [src-js/fontra-core/src/opfs.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/opfs.js)

- **await:** 18, 22, 26, 30, 31, 37, 38, 48, 49, 54, 55, 59, 60, 61, 69, 75, 80, 81, 85, 89, 91, 92, 97, 99, 108, 113, 114, 119, 120, 121, 127, 136, 161
- **loop:** 31, 38, 98

### [src-js/fontra-core/src/parse-glyphset.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/parse-glyphset.js)

- **collection search:** 74, 81, 122
- **collection transform:** 69
- **loop:** 30, 37, 66, 121, 134, 135, 201

### [src-js/fontra-core/src/path-functions.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/path-functions.js)

- **collection search:** 26, 295, 320, 580, 646, 647, 651, 652, 1108, 1125, 1185, 1217, 1278, 1281
- **collection transform:** 35, 40, 57, 80, 101, 108, 115, 149, 198, 208, 241, 267, 289, 311, 320, 389, 425, 462, 476, 534, 574, 598, 619, 827, 940, 943, 950, 1010, 1041, 1065, 1071, 1108, 1125, 1287, 1293, 1320, 1324, 1358
- **front mutation/splice:** 391, 528, 556, 820, 1013, 1330
- **loop:** 79, 96, 102, 114, 144, 171, 223, 268, 270, 288, 298, 313, 334, 346, 416, 424, 429, 456, 463, 477, 483, 498, 573, 595, 627, 681, 686, 756, 773, 788, 802, 826, 835, 945, 960, 981, 990, 1056, 1058, 1070, 1072, 1081, 1102, 1117, 1134, 1153, 1173, 1185, 1189, 1207, 1273, 1274, 1299, 1311, 1337, 1363, 1367

### [src-js/fontra-core/src/path-hit-tester.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/path-hit-tester.js)

- **collection search:** 65
- **collection transform:** 65, 66, 78, 116, 129, 162
- **loop:** 17, 27, 32, 48, 49, 57, 97, 98, 111, 126, 140

### [src-js/fontra-core/src/queue-iterator.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/queue-iterator.js)

- **front mutation/splice:** 13, 44, 51

### [src-js/fontra-core/src/rectangle.ts](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/rectangle.ts)

- **copy/serialization:** 237
- **loop:** 84, 174

### [src-js/fontra-core/src/remote.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/remote.js)

- **await:** 5, 76, 147, 171
- **copy/serialization:** 101, 121, 157, 174
- **lifecycle registration:** 53
- **loop:** 186

### [src-js/fontra-core/src/representation-cache.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/representation-cache.js)

- **copy/serialization:** 17

### [src-js/fontra-core/src/scene-view.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/scene-view.js)

- **loop:** 15

### [src-js/fontra-core/src/serif-geometry.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/serif-geometry.js)

- **loop:** 216, 246, 261, 295, 347, 374, 649

### [src-js/fontra-core/src/set-ops.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/set-ops.js)

- **collection search:** 92
- **collection transform:** 92
- **loop:** 8, 17, 28, 38, 46, 56, 68, 86, 100, 109

### [src-js/fontra-core/src/shaper-controller.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/shaper-controller.js)

- **await:** 72, 74, 84, 125, 135, 136, 138, 144, 169, 171, 177, 216, 251, 257
- **collection search:** 183, 226, 245, 304, 316, 355
- **collection transform:** 131, 141, 148, 183, 184, 245, 304, 330, 332, 351, 352, 355, 356
- **front mutation/splice:** 318, 320
- **lifecycle registration:** 61
- **loop:** 39, 40, 215, 278

### [src-js/fontra-core/src/shaper.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/shaper.js)

- **collection search:** 26, 27, 33, 57, 296, 474
- **collection transform:** 26, 30, 57, 77, 179, 207, 230, 233, 329, 350, 366, 481, 571, 574, 923, 956, 969, 970, 978, 984
- **copy/serialization:** 373, 411, 491
- **front mutation/splice:** 817
- **loop:** 40, 253, 259, 321, 440, 456, 458, 460, 471, 473, 552, 601, 660, 677, 773, 842, 873, 910, 925, 962, 972, 973, 978

### [src-js/fontra-core/src/simple-compute.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/simple-compute.js)

- **collection search:** 107, 108, 167, 183
- **loop:** 54, 105, 122, 130, 166, 243

### [src-js/fontra-core/src/skeleton-from-contour.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/skeleton-from-contour.js)

- **collection search:** 37, 40
- **loop:** 83

### [src-js/fontra-core/src/skeleton-generator.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/skeleton-generator.js)

- **CSS filter/animation:** 3317, 3323
- **collection search:** 179, 552, 562, 1413, 1481, 2509, 4429, 4674
- **collection transform:** 143, 179, 241, 253, 260, 486, 538, 552, 562, 1442, 1546, 1547, 1578, 1584, 1626, 1652, 1693, 1726, 1730, 1767, 2509, 2510, 2700, 2730, 3201, 3237, 4869, 4870, 4894, 5141, 5328, 5439, 5448, 5694, 5865, 5874, 6465, 6544, 6546, 6584
- **copy/serialization:** 3359
- **front mutation/splice:** 2061, 2892, 2902, 3240, 3241, 5011, 5014
- **loop:** 120, 135, 152, 167, 185, 308, 309, 318, 537, 557, 568, 756, 773, 778, 849, 971, 1197, 1240, 1256, 1325, 1350, 1401, 1449, 1461, 1473, 1491, 1504, 1515, 1605, 1700, 1738, 1775, 1940, 1949, 2129, 2146, 2197, 2250, 2261, 2325, 2356, 2386, 2398, 2506, 2514, 2613, 3256, 3267, 3278, 3297, 3303, 3908, 4030, 4190, 4194, 4412, 4420, 4432, 4444, 4451, 4543, 4551, 4589, 4660, 4678, 4691, 4700, 5013, 5017, 5623, 5680, 5686, 5709, 5731, 5743, 5988, 5994, 6017, 6035, 6055, 6168, 6338, 6341, 6487, 6585

### [src-js/fontra-core/src/skeleton-insertions.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/skeleton-insertions.js)

- **collection search:** 182, 493, 512
- **collection transform:** 507, 508
- **loop:** 75, 107, 192, 327, 406, 439, 581

### [src-js/fontra-core/src/skeleton-model.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/skeleton-model.js)

- **collection search:** 227, 241, 496, 576, 651, 801, 886, 1274, 1290, 1304, 1423, 1471, 1476, 1580, 1607, 1665, 1684, 1717, 1782, 1788, 1809, 1842, 1900, 1908, 1910, 1917, 2086, 2179, 2554, 2555, 3242, 3415, 3637, 3666, 3795, 3798, 3977, 3983, 3986, 4343, 4351, 4356, 4516, 4578, 4959, 5165, 5262, 5332, 5349, 5355, 5408, 5421, 5427, 5443, 5446, 5522, 5586, 5594, 5696, 5765, 5805
- **collection transform:** 180, 391, 877, 889, 1005, 1170, 1173, 1176, 1235, 1274, 1423, 1520, 1552, 1606, 1607, 1644, 1665, 1666, 1684, 1716, 1717, 1788, 1908, 1910, 2554, 3009, 5245, 5262, 5319, 5331, 5379, 5610, 5620, 5833, 5848
- **copy/serialization:** 370
- **front mutation/splice:** 213, 1728, 1921, 2090
- **loop:** 318, 323, 332, 418, 427, 448, 543, 575, 650, 652, 885, 969, 981, 991, 1115, 1122, 1182, 1230, 1267, 1277, 1363, 1372, 1373, 1422, 1460, 1518, 1528, 1542, 1646, 1650, 1667, 1837, 1856, 1916, 1933, 1940, 1959, 1976, 1984, 1996, 2029, 2039, 2040, 2057, 2102, 2120, 2209, 2226, 2229, 2239, 2267, 2306, 2373, 2392, 2622, 2814, 2831, 2839, 2846, 2861, 2878, 2923, 2936, 2951, 3117, 3140, 3166, 3291, 3298, 3388, 3442, 3454, 3455, 3498, 3513, 3567, 3569, 3591, 3595, 3601, 3605, 3690, 3865, 3868, 4208, 4219, 4220, 4224, 4242, 4243, 4278, 4483, 4515, 4690, 4692, 4698, 4703, 4707, 4882, 4894, 4909, 4966, 5048, 5053, 5300, 5314, 5397, 5465, 5533, 5763

### [src-js/fontra-core/src/snapping.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/snapping.js)

- **collection search:** 348, 456, 458, 478, 515, 762, 785, 800, 812
- **collection transform:** 456, 483, 696, 697, 762, 785, 812, 816
- **loop:** 107, 111, 128, 311, 378, 468, 550, 611, 620, 686, 691, 732, 745, 762, 772, 773, 777, 785, 799

### [src-js/fontra-core/src/svg-utils.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/svg-utils.js)

- **collection transform:** 74
- **loop:** 5

### [src-js/fontra-core/src/task-pool.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/task-pool.js)

- **await:** 19
- **front mutation/splice:** 30

### [src-js/fontra-core/src/tension-aware-edit.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/tension-aware-edit.js)

- **collection search:** 347, 596, 702, 924
- **collection transform:** 302, 660, 676, 709, 736, 775, 776, 777, 802, 912, 917, 918, 921
- **copy/serialization:** 912
- **front mutation/splice:** 596, 643
- **loop:** 35, 46, 53, 191, 304, 309, 490, 495, 592, 601, 606, 623, 674, 675, 684, 712, 727, 732, 739, 741, 745, 751, 769, 804, 833, 846, 869, 871, 916, 927

### [src-js/fontra-core/src/theme-settings.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/theme-settings.js)

- **lifecycle registration:** 16

### [src-js/fontra-core/src/tunni-calculations.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/tunni-calculations.js)

- **collection search:** 687, 841, 913
- **collection transform:** 621, 687, 688, 689, 725, 838, 849
- **loop:** 573

### [src-js/fontra-core/src/ui-utils.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/ui-utils.js)

- **collection search:** 37, 211
- **collection transform:** 163, 220
- **layout read:** 39, 66
- **lifecycle registration:** 23, 49, 51, 58, 69, 139, 184, 190, 215, 276, 283, 290, 294
- **loop:** 91, 323

### [src-js/fontra-core/src/unicode-utils.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/unicode-utils.js)

- **collection transform:** 14
- **front mutation/splice:** 28
- **loop:** 25, 30

### [src-js/fontra-core/src/utils.ts](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/utils.ts)

- **await:** 328, 333, 339, 343, 344, 367, 368, 598, 797, 1048
- **collection search:** 128, 157, 289, 342, 491, 549, 550, 566, 574, 809, 920, 922, 986
- **collection transform:** 128, 129, 302, 424, 462, 491, 492, 539, 546, 548, 555, 714, 717, 753, 770, 809, 907, 920, 921, 922
- **copy/serialization:** 520, 619, 626, 1039, 1065
- **lifecycle registration:** 52, 81, 112, 509, 660, 835
- **loop:** 17, 191, 198, 205, 216, 220, 230, 231, 250, 252, 257, 288, 300, 340, 341, 418, 438, 442, 547, 560, 587, 689, 693, 716, 721, 796, 943, 981, 1047, 1075

### [src-js/fontra-core/src/var-array.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/var-array.js)

- **loop:** 16, 30, 39

### [src-js/fontra-core/src/var-funcs.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/var-funcs.js)

- **collection transform:** 109
- **loop:** 77, 92, 112

### [src-js/fontra-core/src/var-glyph.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/var-glyph.js)

- **collection transform:** 10, 13, 60, 80, 84, 88
- **loop:** 104, 109, 114

### [src-js/fontra-core/src/var-model.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/var-model.js)

- **collection search:** 24, 25, 240, 244, 250, 554, 555, 567
- **collection transform:** 12, 22, 23, 24, 25, 173, 192, 203, 204, 240, 243, 244, 249, 254, 255, 281, 288, 299, 554, 555, 567, 571, 587, 600, 619
- **copy/serialization:** 291
- **loop:** 33, 37, 45, 70, 96, 110, 111, 118, 120, 134, 138, 157, 160, 184, 185, 213, 230, 235, 263, 288, 340, 360, 378, 399, 441, 474, 504, 509, 528, 578, 596, 610

### [src-js/fontra-core/src/var-path.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/var-path.js)

- **await:** 1179
- **collection search:** 39, 152, 1205
- **collection transform:** 60, 64, 302, 687, 912, 1201
- **copy/serialization:** 681
- **front mutation/splice:** 278, 288, 334, 446, 447, 448, 455, 456, 462, 469, 470, 477, 1087
- **loop:** 72, 117, 130, 142, 157, 172, 185, 485, 534, 569, 586, 605, 611, 617, 627, 634, 660, 668, 726, 783, 799, 831, 845, 854, 883, 896, 930, 940, 970, 990, 1024, 1078, 1117, 1145, 1162, 1170, 1179, 1188

### [src-js/fontra-core/src/view-controller.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/view-controller.js)

- **await:** 20, 22, 41, 66, 110, 125, 133, 138, 146, 151, 159, 162, 189, 194, 222, 223, 228, 239
- **lifecycle registration:** 53
- **loop:** 81, 129, 215

### [src-js/fontra-core/tests/node-path.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/node-path.js)

- **await:** 34, 42, 50
- **loop:** 50

### [src-js/fontra-core/tests/scripts/make-skeleton-generator-fixtures.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/scripts/make-skeleton-generator-fixtures.js)

- **collection search:** 372
- **collection transform:** 468, 475
- **copy/serialization:** 377
- **loop:** 365, 498

### [src-js/fontra-core/tests/scripts/measure-gizmo-coherence.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/scripts/measure-gizmo-coherence.js)

- **collection search:** 34, 175
- **collection transform:** 37, 189, 190, 205
- **loop:** 16, 42, 49, 59, 60, 61, 156, 157, 243

### [src-js/fontra-core/tests/scripts/measure-skeleton-mirroring.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/scripts/measure-skeleton-mirroring.js)

- **collection transform:** 74, 76, 85, 87, 88, 90
- **loop:** 62

### [src-js/fontra-core/tests/test-autokern-cache.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-autokern-cache.js)

- **collection transform:** 260
- **loop:** 286, 384

### [src-js/fontra-core/tests/test-autokern-classes.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-autokern-classes.js)

- **collection transform:** 111, 170, 255, 298
- **copy/serialization:** 14, 15, 26, 33, 42, 67, 68, 79, 306, 308

### [src-js/fontra-core/tests/test-autokern-engine.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-autokern-engine.js)

- **loop:** 37, 85, 108, 110, 265, 266, 349, 350, 364, 383, 390, 402, 412, 452, 453, 461

### [src-js/fontra-core/tests/test-change-recorder.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-change-recorder.js)

- **copy/serialization:** 331
- **front mutation/splice:** 92, 112, 113
- **loop:** 296

### [src-js/fontra-core/tests/test-changes.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-changes.js)

- **loop:** 20, 40, 64, 77, 90, 323

### [src-js/fontra-core/tests/test-character-lines.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-character-lines.js)

- **collection transform:** 12, 15, 130, 131, 214
- **loop:** 18

### [src-js/fontra-core/tests/test-classes.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-classes.js)

- **await:** 54, 120
- **collection transform:** 5
- **loop:** 52, 58, 118, 122, 130, 137

### [src-js/fontra-core/tests/test-cmap.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-cmap.js)

- **loop:** 23, 43

### [src-js/fontra-core/tests/test-composition.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-composition.js)

- **collection transform:** 104

### [src-js/fontra-core/tests/test-corner-overlap.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-corner-overlap.js)

- **collection transform:** 59, 61, 70, 104, 106

### [src-js/fontra-core/tests/test-curvature-sampling.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-curvature-sampling.js)

- **collection search:** 243, 333, 373, 418, 419
- **collection transform:** 94, 95, 153, 243, 260, 262, 333, 418, 424
- **loop:** 71, 73, 133, 168, 191, 218, 231, 253, 263, 264, 375, 429, 471

### [src-js/fontra-core/tests/test-fit-cubic.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-fit-cubic.js)

- **collection transform:** 131

### [src-js/fontra-core/tests/test-font-controller.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-font-controller.js)

- **await:** 20, 23, 42, 54, 62, 63, 64, 66, 89, 98, 99, 106, 107

### [src-js/fontra-core/tests/test-glyph-controller.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-glyph-controller.js)

- **loop:** 55, 58, 488, 512

### [src-js/fontra-core/tests/test-harmonization.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-harmonization.js)

- **collection search:** 626, 2024
- **collection transform:** 381, 397, 492, 493, 617, 626, 665, 690, 915, 1028, 1030, 1230, 1257, 1345, 1488, 1530, 1768, 1781, 1886, 1931, 1956, 1976, 2086, 2280
- **copy/serialization:** 1700
- **loop:** 297, 401, 652, 673, 735, 780, 786, 792, 807, 823, 838, 855, 1075, 1350, 1391, 1396, 1699, 1957, 2151, 2178, 2219, 2276, 2319

### [src-js/fontra-core/tests/test-harmonize-nearest.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-harmonize-nearest.js)

- **collection transform:** 172, 177
- **loop:** 81, 122, 159, 171, 183

### [src-js/fontra-core/tests/test-kerning-controller.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-kerning-controller.js)

- **await:** 201, 203, 252, 347, 348
- **loop:** 208

### [src-js/fontra-core/tests/test-marker-anchoring.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-marker-anchoring.js)

- **copy/serialization:** 356, 365

### [src-js/fontra-core/tests/test-marker-measure.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-marker-measure.js)

- **collection transform:** 20, 75, 76
- **loop:** 25, 165, 189, 218

### [src-js/fontra-core/tests/test-natural-handle-solver.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-natural-handle-solver.js)

- **collection transform:** 596, 663, 689, 736, 839
- **copy/serialization:** 533
- **loop:** 167, 215, 232, 234, 353, 357, 366, 394, 612, 615, 616, 638, 656, 664, 679, 718, 719, 751, 781, 907

### [src-js/fontra-core/tests/test-number-scrub.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-number-scrub.js)

- **loop:** 107, 119, 130

### [src-js/fontra-core/tests/test-observable-object.ts](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-observable-object.ts)

- **await:** 15, 31, 45, 57, 72, 84, 88, 102, 105
- **lifecycle registration:** 39, 111

### [src-js/fontra-core/tests/test-offset-contour.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-offset-contour.js)

- **collection transform:** 200, 215
- **copy/serialization:** 91, 115, 117, 125, 143, 145, 252, 285, 286, 305, 307, 332, 355
- **loop:** 266

### [src-js/fontra-core/tests/test-offset-cubic.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-offset-cubic.js)

- **collection transform:** 281, 395, 402, 420, 427, 434, 438, 443
- **loop:** 231, 279, 280, 363, 391

### [src-js/fontra-core/tests/test-path-changes.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-path-changes.js)

- **copy/serialization:** 21
- **loop:** 25

### [src-js/fontra-core/tests/test-path-functions.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-path-functions.js)

- **collection transform:** 349, 357

### [src-js/fontra-core/tests/test-path-hit-tester.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-path-hit-tester.js)

- **loop:** 104

### [src-js/fontra-core/tests/test-queue-iterator.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-queue-iterator.js)

- **await:** 11, 24, 37, 52, 65, 80, 101
- **lifecycle registration:** 20, 32, 45, 48, 73, 88, 91, 94, 97
- **loop:** 11, 24, 37, 52, 65, 80, 101

### [src-js/fontra-core/tests/test-serif-geometry.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-serif-geometry.js)

- **collection search:** 680, 694, 700, 711, 719, 736, 744, 753, 761, 769, 779, 806, 826, 834, 841, 847, 854, 868, 880, 890, 897, 906
- **collection transform:** 330, 340, 516, 680, 694, 700, 711, 719, 736, 744, 753, 761, 769, 779, 806, 826, 834, 841, 847, 854, 868, 880, 890
- **loop:** 56, 73, 109, 171, 196, 198, 212, 232, 286, 356, 359, 442, 450, 468, 503, 535, 568, 595, 596, 767, 860, 866, 964, 966, 969, 986, 990, 1045, 1083, 1143, 1198, 1421, 1477

### [src-js/fontra-core/tests/test-shaper.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-shaper.js)

- **await:** 1795, 1810, 1831, 1835, 1839, 1845, 1851, 1867, 1871, 1875, 1897, 1903, 1909, 1915, 1921, 1927, 2045, 2052, 2057, 2071, 2091, 2092, 2101, 2112
- **collection transform:** 32, 245, 340, 429, 434, 438, 1797, 1833, 1836, 1842, 1848, 1854, 1869, 1872, 1878, 1900, 1906, 1912, 1918, 1924, 1930, 2026
- **loop:** 1790, 2039, 2069, 2112

### [src-js/fontra-core/tests/test-skeleton-corner-link.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-skeleton-corner-link.js)

- **copy/serialization:** 115
- **loop:** 57, 75

### [src-js/fontra-core/tests/test-skeleton-from-contour.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-skeleton-from-contour.js)

- **collection search:** 183
- **collection transform:** 75, 82, 89, 146, 147, 198
- **loop:** 122, 179

### [src-js/fontra-core/tests/test-skeleton-generator.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-skeleton-generator.js)

- **collection search:** 43, 56, 59, 60, 61, 62, 63, 67, 70, 71, 259, 265, 281, 286, 293, 319, 437, 443, 451, 606, 619, 620, 708, 897, 933, 1064, 1106, 1120, 1239, 1251, 1395, 1397, 1426, 1438, 1451, 1613, 1643, 1644, 1722, 1823, 1844, 1907, 1917, 2006, 2394, 2506, 2513, 2736, 2894, 2944, 2985, 3065, 3262, 3287, 3295, 3334, 3339, 3361, 3684, 3750, 3892, 4034, 4043, 4114, 4168, 4171, 4184, 4201, 4224, 4239, 4319, 4321
- **collection transform:** 58, 157, 238, 245, 261, 283, 316, 347, 349, 351, 382, 442, 605, 606, 616, 617, 619, 620, 709, 765, 897, 1105, 1203, 1204, 1239, 1240, 1251, 1252, 1259, 1299, 1305, 1369, 1395, 1397, 1400, 1426, 1427, 1438, 1439, 1451, 1453, 1454, 1540, 1741, 1742, 1822, 1953, 1955, 2006, 2074, 2075, 2124, 2194, 2244, 2303, 2393, 2394, 2395, 2491, 2506, 2513, 2529, 2544, 2565, 2616, 2617, 2893, 2944, 2984, 2985, 3082, 3083, 3096, 3188, 3243, 3262, 3263, 3287, 3295, 3333, 3334, 3460, 3512, 3557, 3558, 3605, 3683, 3684, 3835, 4000, 4034, 4039, 4040, 4113, 4114, 4119, 4127, 4168, 4171, 4172, 4184, 4201, 4223, 4224, 4318, 4319, 4321, 4327
- **copy/serialization:** 1278, 1317
- **loop:** 26, 84, 87, 90, 91, 101, 102, 117, 125, 156, 185, 188, 206, 212, 227, 262, 263, 284, 307, 317, 353, 363, 383, 389, 421, 422, 441, 632, 634, 700, 703, 721, 724, 735, 738, 754, 756, 772, 798, 801, 826, 832, 838, 858, 896, 913, 932, 963, 1063, 1122, 1133, 1267, 1311, 1364, 1413, 1541, 1612, 1628, 1629, 1854, 1912, 1913, 1931, 1933, 2042, 2082, 2091, 2154, 2155, 2256, 2403, 2411, 2490, 2663, 2674, 2735, 2765, 2795, 2839, 2862, 2900, 2917, 2945, 2958, 3064, 3107, 3175, 3179, 3212, 3215, 3230, 3269, 3274, 3359, 3363, 3498, 3509, 3601, 3651, 3655, 3661, 3681, 3687, 3748, 3752, 3849, 3858, 3900, 3946, 3980, 3986, 3993, 4004, 4021, 4023, 4042, 4109, 4139, 4141, 4155, 4175, 4188, 4211, 4226, 4271, 4276, 4324, 4355

### [src-js/fontra-core/tests/test-skeleton-insertion-straight.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-skeleton-insertion-straight.js)

- **collection search:** 12, 49, 84, 85, 87
- **collection transform:** 12, 49, 84, 85, 87
- **loop:** 8, 13, 21, 22

### [src-js/fontra-core/tests/test-skeleton-insertions.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-skeleton-insertions.js)

- **collection transform:** 28, 30, 32, 89
- **copy/serialization:** 231, 233, 316, 318, 371, 373
- **loop:** 34, 36, 55, 106, 122, 139, 189, 222, 259, 304, 347, 349, 359, 379, 414, 445, 476, 487, 513

### [src-js/fontra-core/tests/test-skeleton-interpolation.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-skeleton-interpolation.js)

- **collection transform:** 74, 76, 109
- **loop:** 110

### [src-js/fontra-core/tests/test-skeleton-model.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-skeleton-model.js)

- **collection search:** 721, 734, 815, 1341, 1352, 1394, 1446, 1637, 1638, 1642
- **collection transform:** 434, 702, 721, 1634, 1638, 1647, 1815, 1923, 1989, 2001, 2013, 2025, 2141, 2166, 2178, 2206, 2216
- **copy/serialization:** 1552, 2618, 2619
- **front mutation/splice:** 2160, 2214
- **loop:** 90, 105, 185, 704, 1345, 1362, 1390, 1650

### [src-js/fontra-core/tests/test-skeleton-modifiers.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-skeleton-modifiers.js)

- **collection search:** 765, 774
- **copy/serialization:** 46, 68, 90, 111, 138, 434, 458, 478, 509, 537, 560, 592, 616
- **loop:** 547, 587, 627, 772

### [src-js/fontra-core/tests/test-skeleton-ribs.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-skeleton-ribs.js)

- **collection search:** 767, 875, 880, 905, 987
- **collection transform:** 386, 389, 393, 476, 770, 771, 990, 991, 1263, 1308, 1385
- **loop:** 381, 384, 403, 404, 417, 423, 429, 518, 549, 637, 638, 665, 682, 710, 813, 899, 1017, 1067, 1390

### [src-js/fontra-core/tests/test-skeleton-side-mode.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-skeleton-side-mode.js)

- **collection transform:** 62, 93, 132, 133, 144, 153, 155, 163, 201, 202, 265
- **copy/serialization:** 49, 79
- **loop:** 123

### [src-js/fontra-core/tests/test-skeleton-source-defaults.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-skeleton-source-defaults.js)

- **collection search:** 131, 138
- **collection transform:** 131, 136
- **loop:** 119, 146, 149, 205, 301

### [src-js/fontra-core/tests/test-skeleton-tunni.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-skeleton-tunni.js)

- **collection search:** 638, 968, 969, 993, 994, 1026, 1027, 1040, 1041, 1049, 1050, 1057, 1067, 1119, 1178, 1188
- **collection transform:** 298, 361, 368, 394, 401, 634, 635, 641, 866, 968, 1040, 1043, 1049, 1054, 1169
- **loop:** 608, 640, 650, 826, 847, 884, 976, 996, 1055, 1118, 1177

### [src-js/fontra-core/tests/test-snapping.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-snapping.js)

- **collection search:** 456, 481, 795, 857, 858, 879, 896, 897, 914, 915, 921, 932, 956, 985, 1085, 1091, 1102, 1109, 1110
- **collection transform:** 319, 433, 447, 481, 485, 513, 795, 879, 985, 986, 987
- **loop:** 272, 519, 630, 648, 664, 804, 881, 925, 1095

### [src-js/fontra-core/tests/test-support.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-support.js)

- **await:** 11
- **copy/serialization:** 18, 23
- **loop:** 8

### [src-js/fontra-core/tests/test-tension-aware-edit.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-tension-aware-edit.js)

- **collection search:** 659
- **collection transform:** 13, 72, 397, 400, 402, 410, 447, 465, 487, 692, 704, 718
- **loop:** 176, 224, 233, 443, 448, 488, 568, 569, 646

### [src-js/fontra-core/tests/test-tunni-calculations.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-tunni-calculations.js)

- **collection transform:** 605
- **loop:** 186, 226, 319, 496, 549, 568, 606, 642, 648

### [src-js/fontra-core/tests/test-unicode-utils.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-unicode-utils.js)

- **collection transform:** 18, 32

### [src-js/fontra-core/tests/test-utils.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-utils.js)

- **await:** 109, 118, 121, 123, 523, 524, 531, 538, 539, 541, 574, 669, 677, 685, 692
- **lifecycle registration:** 82, 95, 137, 148, 152, 532

### [src-js/fontra-core/tests/test-var-array.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-var-array.js)

- **copy/serialization:** 10

### [src-js/fontra-core/tests/test-var-glyph.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-var-glyph.js)

- **copy/serialization:** 125
- **loop:** 112, 121

### [src-js/fontra-core/tests/test-var-model.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-var-model.js)

- **collection transform:** 353
- **copy/serialization:** 52, 53, 54, 55, 56
- **loop:** 96

### [src-js/fontra-core/tests/test-var-path.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-var-path.js)

- **await:** 1351
- **copy/serialization:** 90, 111, 362, 389, 595, 947, 977, 1000, 1024, 1046, 1061, 1301
- **loop:** 512, 543, 547, 550, 1593

### [src-js/fontra-webcomponents/src/armed-tooltip.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/armed-tooltip.js)

- **DOM replacement/write:** 12
- **layout read:** 33, 34

### [src-js/fontra-webcomponents/src/compact-scrub-field.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/compact-scrub-field.js)

- **DOM replacement/write:** 162, 262, 366
- **lifecycle registration:** 395, 406, 502, 503, 504, 505, 506

### [src-js/fontra-webcomponents/src/custom-data-list.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/custom-data-list.js)

- **DOM replacement/write:** 180, 181, 189, 214
- **await:** 138, 278, 286
- **collection search:** 56, 57, 59, 60, 66, 152, 205, 213, 233, 260, 292
- **collection transform:** 46, 54, 80, 89, 120, 135, 148
- **front mutation/splice:** 118
- **lifecycle registration:** 26, 132, 257, 271, 284
- **loop:** 16, 217

### [src-js/fontra-webcomponents/src/data-table.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/data-table.js)

- **DOM replacement/write:** 299, 362, 708, 772, 942
- **collection search:** 230, 325, 351, 562, 571, 650, 837, 911
- **collection transform:** 230, 325, 351, 598, 606, 837, 843, 911
- **layout read:** 636, 638, 654, 791, 809
- **lifecycle registration:** 265, 274, 303, 690, 698, 715, 718, 736, 758, 761, 831, 832, 833
- **loop:** 296, 637, 676, 774, 863, 922, 932

### [src-js/fontra-webcomponents/src/designspace-location.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/designspace-location.js)

- **loop:** 135, 142, 160, 164, 253

### [src-js/fontra-webcomponents/src/glyph-cell-view.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/glyph-cell-view.js)

- **DOM replacement/write:** 279, 291, 298
- **await:** 287, 457
- **collection search:** 256, 405, 413, 455, 986, 1002
- **collection transform:** 232, 404, 405, 413, 986, 1009
- **front mutation/splice:** 345
- **layout read:** 655, 684, 685, 784, 880, 892, 914, 921, 930, 937, 962, 966
- **lifecycle registration:** 44, 54, 58, 103, 129, 155, 164, 165, 305, 537, 712
- **loop:** 60, 77, 226, 249, 320, 347, 455, 473, 487, 496, 502, 594, 651, 855, 891, 916, 932, 947, 964, 998, 999, 1015, 1016

### [src-js/fontra-webcomponents/src/glyph-cell.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/glyph-cell.js)

- **CSS filter/animation:** 78
- **await:** 224
- **collection search:** 368
- **lifecycle registration:** 27
- **loop:** 24

### [src-js/fontra-webcomponents/src/glyph-search-field.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/glyph-search-field.js)

- **lifecycle registration:** 42

### [src-js/fontra-webcomponents/src/glyph-search-list.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/glyph-search-list.js)

- **collection search:** 163
- **collection transform:** 68, 173
- **lifecycle registration:** 80, 88

### [src-js/fontra-webcomponents/src/grouped-settings.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/grouped-settings.js)

- **collection transform:** 25

### [src-js/fontra-webcomponents/src/icon-button.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/icon-button.js)

- **CSS filter/animation:** 43

### [src-js/fontra-webcomponents/src/inline-svg.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/inline-svg.js)

- **DOM replacement/write:** 30, 39
- **await:** 36, 49, 50

### [src-js/fontra-webcomponents/src/labeled-toggle.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/labeled-toggle.js)

- **CSS filter/animation:** 50, 62
- **DOM replacement/write:** 93

### [src-js/fontra-webcomponents/src/menu-bar.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/menu-bar.js)

- **await:** 171
- **layout read:** 137
- **lifecycle registration:** 52, 53, 54, 57, 58, 59, 60, 64
- **loop:** 120, 200

### [src-js/fontra-webcomponents/src/menu-panel.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/menu-panel.js)

- **CSS filter/animation:** 64
- **await:** 151, 189, 406, 422
- **collection search:** 216, 320
- **collection transform:** 320
- **front mutation/splice:** 218
- **layout read:** 24, 204, 205, 351
- **lifecycle registration:** 142, 143, 462, 488, 489, 492
- **loop:** 38, 228, 328, 341, 447, 474

### [src-js/fontra-webcomponents/src/modal-dialog.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/modal-dialog.js)

- **CSS filter/animation:** 99, 124, 149, 153
- **DOM replacement/write:** 231, 236, 332
- **await:** 7, 13, 18, 34, 58
- **collection transform:** 197
- **lifecycle registration:** 53, 178, 181, 245
- **loop:** 203, 240, 255

### [src-js/fontra-webcomponents/src/multi-select-dropdown.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/multi-select-dropdown.js)

- **DOM replacement/write:** 130
- **collection search:** 258
- **collection transform:** 206, 258, 259
- **layout read:** 204
- **loop:** 239, 243

### [src-js/fontra-webcomponents/src/plugin-manager.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/plugin-manager.js)

- **await:** 54, 98, 101, 111, 130
- **collection search:** 122, 157
- **collection transform:** 157
- **lifecycle registration:** 47

### [src-js/fontra-webcomponents/src/popup-menu.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/popup-menu.js)

- **layout read:** 79, 83

### [src-js/fontra-webcomponents/src/range-slider.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/range-slider.js)

- **collection search:** 234, 248, 319, 327, 465, 531
- **collection transform:** 527, 531
- **loop:** 274

### [src-js/fontra-webcomponents/src/segmented-control.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/segmented-control.js)

- **collection transform:** 115

### [src-js/fontra-webcomponents/src/simple-settings.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/simple-settings.js)

- **collection transform:** 44, 53, 90

### [src-js/fontra-webcomponents/src/table-selection.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/table-selection.js)

- **collection search:** 32, 33, 44
- **collection transform:** 44, 62
- **copy/serialization:** 62

### [src-js/fontra-webcomponents/src/theme-support.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/theme-support.js)

- **collection transform:** 23
- **loop:** 8

### [src-js/fontra-webcomponents/src/ui-accordion.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/ui-accordion.js)

- **CSS filter/animation:** 40
- **loop:** 63, 117, 152

### [src-js/fontra-webcomponents/src/ui-form.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/ui-form.js)

- **DOM replacement/write:** 205, 461, 464
- **await:** 613
- **collection transform:** 858
- **lifecycle registration:** 280, 309, 419, 420, 421, 422, 423, 772, 785, 943, 944
- **loop:** 212, 428

### [src-js/fontra-webcomponents/src/ui-list.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/ui-list.js)

- **DOM replacement/write:** 333
- **collection search:** 255, 259, 369, 748
- **collection transform:** 255, 256
- **copy/serialization:** 306, 317
- **front mutation/splice:** 392
- **layout read:** 381, 382, 385
- **lifecycle registration:** 205, 210, 215, 478, 492, 495, 496, 701
- **loop:** 261, 297, 319, 362, 379, 394, 404, 449, 577, 647, 684, 688, 727, 803

### [src-js/projectmanager-filesystem/assets/landing.css](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/projectmanager-filesystem/assets/landing.css)

- **CSS filter/animation:** 105, 129, 155

### [src-js/projectmanager-filesystem/src/landing.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/projectmanager-filesystem/src/landing.js)

- **await:** 11
- **loop:** 15

### [src-js/views-applicationsettings/src/applicationsettings.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-applicationsettings/src/applicationsettings.js)

- **await:** 28
- **lifecycle registration:** 39

### [src-js/views-applicationsettings/src/panel-clipboard.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-applicationsettings/src/panel-clipboard.js)

- **DOM replacement/write:** 20
- **loop:** 23

### [src-js/views-applicationsettings/src/panel-display-language.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-applicationsettings/src/panel-display-language.js)

- **DOM replacement/write:** 27
- **collection transform:** 40
- **loop:** 30

### [src-js/views-applicationsettings/src/panel-editor-behavior.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-applicationsettings/src/panel-editor-behavior.js)

- **DOM replacement/write:** 20

### [src-js/views-applicationsettings/src/panel-plugins-manager.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-applicationsettings/src/panel-plugins-manager.js)

- **DOM replacement/write:** 18

### [src-js/views-applicationsettings/src/panel-server-info.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-applicationsettings/src/panel-server-info.js)

- **DOM replacement/write:** 24
- **await:** 6
- **collection transform:** 27

### [src-js/views-applicationsettings/src/panel-shortcuts.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-applicationsettings/src/panel-shortcuts.js)

- **CSS filter/animation:** 257
- **DOM replacement/write:** 64, 360, 366, 381, 390, 398, 405, 409
- **await:** 120
- **collection transform:** 33, 104
- **copy/serialization:** 149, 170
- **loop:** 22, 32, 104, 112, 131, 141, 171, 191, 205, 210, 301, 306, 336

### [src-js/views-applicationsettings/src/panel-theme-settings.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-applicationsettings/src/panel-theme-settings.js)

- **DOM replacement/write:** 20
- **loop:** 23

### [src-js/views-applicationsettings/src/start.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-applicationsettings/src/start.js)

- **await:** 7

### [src-js/views-editor/assets/editor.css](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/assets/editor.css)

- **CSS filter/animation:** 141, 196, 221, 369, 385, 432, 538

### [src-js/views-editor/src/base-expand-editing.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/base-expand-editing.js)

- **collection search:** 104
- **collection transform:** 143
- **copy/serialization:** 129, 138, 170
- **loop:** 34, 70, 116, 140, 182

### [src-js/views-editor/src/cjk-design-frame.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/cjk-design-frame.js)

- **await:** 74
- **lifecycle registration:** 44
- **loop:** 157, 161, 174

### [src-js/views-editor/src/composition-editing.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/composition-editing.js)

- **await:** 38, 50, 96, 101, 115, 118, 173, 204, 208, 215, 231, 235, 244, 253, 263, 272, 284, 332, 344, 352, 404, 406, 428, 434, 512, 520
- **collection search:** 72, 185
- **collection transform:** 40, 42, 382, 426, 444, 503
- **front mutation/splice:** 441
- **loop:** 53, 65, 124, 175, 216, 376, 401, 426, 435, 468, 495, 496, 519, 526

### [src-js/views-editor/src/edit-behavior-support.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/edit-behavior-support.js)

- **loop:** 48, 75, 146

### [src-js/views-editor/src/edit-behavior.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/edit-behavior.js)

- **collection search:** 222, 249, 290, 317, 769, 776
- **collection transform:** 221, 222, 248, 249, 289, 290, 310, 317, 318, 321, 324, 327, 367, 788
- **loop:** 141, 152, 165, 180, 359, 618, 622, 638, 650, 658, 666, 678, 701, 800, 817, 841, 881, 901, 912, 921

### [src-js/views-editor/src/edit-tools-base.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/edit-tools-base.js)

- **await:** 52
- **loop:** 52

### [src-js/views-editor/src/edit-tools-hand.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/edit-tools-hand.js)

- **await:** 21
- **loop:** 21

### [src-js/views-editor/src/edit-tools-knife.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/edit-tools-knife.js)

- **await:** 40, 44, 50, 54, 114
- **collection search:** 74
- **collection transform:** 74
- **copy/serialization:** 100
- **loop:** 54, 116, 140, 155, 182

### [src-js/views-editor/src/edit-tools-marker.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/edit-tools-marker.js)

- **await:** 153, 159, 170, 178, 179, 197, 198, 200, 221, 251
- **collection transform:** 282, 283

### [src-js/views-editor/src/edit-tools-metrics.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/edit-tools-metrics.js)

- **DOM replacement/write:** 886, 887, 900, 1492, 1494, 1496
- **await:** 174, 207, 291, 521, 526, 542, 560, 568, 598, 668, 708, 715, 729, 799, 814, 1083, 1097, 1107, 1136, 1192, 1274, 1292, 1294, 1435
- **collection search:** 42, 111, 647, 1399
- **collection transform:** 42, 111, 115, 630, 976, 1102, 1134, 1427, 1569
- **lifecycle registration:** 39, 48, 857, 858, 859, 860, 861, 1037, 1474, 1475, 1476, 1477, 1478
- **loop:** 51, 107, 120, 150, 174, 223, 359, 576, 597, 714, 729, 737, 813, 1097, 1149, 1329, 1366, 1412, 1421, 1445

### [src-js/views-editor/src/edit-tools-pen.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/edit-tools-pen.js)

- **await:** 272, 277, 279, 284, 313, 331, 351, 383, 387, 392, 393, 397, 405
- **collection transform:** 60, 337, 354, 732, 741, 781, 791
- **copy/serialization:** 59
- **loop:** 315, 333, 393, 564, 752, 944

### [src-js/views-editor/src/edit-tools-pointer.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/edit-tools-pointer.js)

- **await:** 314, 328, 330, 345, 359, 364, 378, 425, 455, 464, 513, 522, 526, 570, 589, 599, 631, 635, 639, 675, 706, 728, 741, 760, 771, 782, 816, 1019, 1048, 1098, 1179, 1197, 1199, 1295, 1355
- **collection search:** 659, 1175, 1176, 1219, 1221, 1332, 1334, 1483, 1484, 1515, 1543
- **collection transform:** 498, 627, 628, 686, 694, 702, 756, 981, 1074, 1106, 1225, 1361
- **copy/serialization:** 852
- **lifecycle registration:** 1525, 1529
- **loop:** 285, 291, 657, 662, 712, 729, 739, 772, 782, 1019, 1026, 1087, 1112, 1295, 1299, 1421, 1561, 1764, 1823

### [src-js/views-editor/src/edit-tools-power-ruler.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/edit-tools-power-ruler.js)

- **await:** 163, 277, 297
- **lifecycle registration:** 58, 60, 63, 73
- **loop:** 107, 120, 239, 244, 297

### [src-js/views-editor/src/edit-tools-shape.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/edit-tools-shape.js)

- **await:** 36, 42, 49, 87
- **collection transform:** 176
- **front mutation/splice:** 178, 179
- **loop:** 49, 96, 104, 168, 219

### [src-js/views-editor/src/edit-tools-skeleton.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/edit-tools-skeleton.js)

- **await:** 378, 386, 403, 413, 417, 419, 421, 427, 456, 493, 568, 612, 659, 872, 895, 1050, 1097, 1099, 1112
- **collection search:** 531, 641, 831, 1162, 1163, 1232
- **collection transform:** 234, 531, 641, 1105, 1162, 1163
- **copy/serialization:** 233
- **front mutation/splice:** 585, 924, 985, 1083, 1165
- **lifecycle registration:** 88, 89
- **loop:** 473, 612, 696, 699, 709, 951, 973, 1006, 1009, 1031, 1117, 1134, 1137, 1152, 1160, 1242

### [src-js/views-editor/src/editor.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/editor.js)

- **DOM replacement/write:** 1355, 1360, 2840, 3091
- **await:** 186, 911, 920, 947, 951, 953, 958, 962, 1003, 1017, 1034, 1045, 1053, 1443, 1450, 1496, 1515, 1525, 1530, 1545, 1555, 1559, 1679, 1702, 1711, 1733, 1756, 1767, 1769, 1811, 2105, 2107, 2121, 2180, 2188, 2210, 2213, 2224, 2273, 2292, 2298, 2308, 2323, 2330, 2336, 2340, 2372, 2382, 2526, 2528, 2534, 2571, 2581, 2732, 2741, 2751, 2776, 2789, 2873, 2888, 2990, 3020, 3041, 3128, 3142, 3244, 3440, 3458, 3482, 3496, 3526, 3533, 3546, 3615, 3620, 3640, 3661, 3669, 3694, 3730, 3739, 3754, 3866, 3874, 3879, 3880, 3890, 3892, 3893, 3899, 3935, 4150, 4158, 4209, 4239
- **collection search:** 218, 320, 796, 865, 1300, 1310, 1333, 1334, 1567, 1950, 2367, 2715, 2836, 2944, 3085, 3597, 3885, 4285
- **collection transform:** 672, 726, 796, 865, 869, 1305, 1361, 1446, 1950, 1951, 2039, 2041, 2049, 2057, 2131, 2139, 2201, 2249, 2362, 2367, 2368, 2374, 2445, 2446, 2447, 2565, 2566, 2655, 2689, 2715, 2718, 2743, 3222, 3223, 3224, 3323, 3627, 3630, 3664, 3682
- **copy/serialization:** 1363, 1818, 1951, 2247, 2471, 3920
- **front mutation/splice:** 1493, 2044, 2052, 2060, 2611, 2616, 2626, 3687
- **lifecycle registration:** 214, 270, 274, 278, 287, 291, 295, 299, 340, 343, 344, 346, 349, 364, 943, 968, 1133, 1217, 1218, 1273, 1322, 2854, 2857, 2860, 2880, 3103, 3106, 3109, 3112, 3115, 3135, 3636, 3659, 3719, 3726, 3737, 3951, 4082, 4087
- **loop:** 316, 328, 639, 674, 694, 700, 800, 907, 1103, 1109, 1147, 1168, 1210, 1267, 1274, 1285, 1377, 1386, 1408, 1468, 1531, 1560, 1883, 1912, 1937, 2043, 2051, 2059, 2155, 2205, 2309, 2322, 2342, 2390, 2398, 2405, 2412, 2434, 2478, 2479, 2594, 2610, 2615, 2620, 2658, 2664, 2691, 2697, 2760, 2790, 2826, 2991, 2992, 3042, 3074, 3245, 3286, 3287, 3313, 3386, 3389, 3392, 3399, 3408, 3417, 3457, 3479, 3481, 3491, 3509, 3510, 3532, 3547, 3808, 3822, 3915, 4142, 4163, 4173, 4183, 4193, 4219, 4246, 4254, 4269, 4278, 4284, 4290, 4295

### [src-js/views-editor/src/marker-editing.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/marker-editing.js)

- **await:** 54, 75, 121, 138, 144, 173, 186, 208, 225, 243, 251, 261, 275, 341, 355, 400
- **collection search:** 139, 262, 291, 296, 327, 332, 333, 424
- **collection transform:** 139, 145, 174, 187, 209, 226, 252, 262, 263, 276, 296, 344, 387, 502
- **loop:** 64, 88, 355, 384

### [src-js/views-editor/src/measure-interactions.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/measure-interactions.js)

- **collection transform:** 295
- **copy/serialization:** 495
- **lifecycle registration:** 56, 58, 60, 62
- **loop:** 170, 214, 272, 339, 345, 351, 361, 391, 416

### [src-js/views-editor/src/panel-characters-glyphs.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/panel-characters-glyphs.js)

- **CSS filter/animation:** 311
- **await:** 489, 702, 724
- **collection search:** 666, 805, 816, 847
- **collection transform:** 414, 421, 431, 498, 764, 765, 816, 821
- **copy/serialization:** 439
- **front mutation/splice:** 745, 786
- **layout read:** 388
- **lifecycle registration:** 43, 49, 56, 64, 114, 123, 126, 129, 211, 218, 225, 228
- **loop:** 543, 590, 638, 776, 796

### [src-js/views-editor/src/panel-designspace-navigation.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/panel-designspace-navigation.js)

- **CSS filter/animation:** 166
- **DOM replacement/write:** 1704, 1770, 1776, 1844, 3167, 3456, 3685
- **await:** 1973, 1974, 1975, 1976, 1982, 1983, 1984, 1985, 1992, 1993, 1994, 1995, 2080, 2083, 2117, 2120, 2199, 2387, 2426, 2443, 2444, 2449, 2460, 2502, 2542, 2545, 2620, 2659, 2726, 2830, 2863, 2899, 2902, 2949, 2954, 2972, 2991, 3004, 3018, 3035, 3051, 3068, 3080, 3095, 3309, 3322, 3463, 3471, 3519, 3530, 3543, 3562, 3572, 3576, 3663, 3667, 3679, 3680
- **collection search:** 1011, 1012, 2138, 2210, 2220, 2298, 2329, 2397, 2405, 2508, 2707, 2721, 2776, 2844, 3011, 3114, 3157, 3364, 3447
- **collection transform:** 838, 844, 845, 1013, 1037, 1076, 1863, 2307, 2355, 2397, 2508, 2600, 2614, 2673, 2693, 2740, 2757, 2928, 3276, 3294, 3364, 3622, 3706, 3736, 3803, 3851
- **copy/serialization:** 3039
- **front mutation/splice:** 2955, 3647, 3671
- **layout read:** 1843, 2365, 3850
- **lifecycle registration:** 484, 509, 514, 550, 1333, 1377, 1380, 1383, 1410, 1414, 1441, 1445, 1462, 1466, 1618, 1622, 1626, 1640, 1644, 1662, 1665, 1715, 1723, 1790, 1810, 1817, 1846, 1848, 1879, 1941, 1945, 1956, 1970, 1989, 2013, 2021, 2028, 2073, 2110, 2157, 2501, 2523, 2533, 2544, 2580, 2681, 3198, 3213, 3315, 3514, 3652, 3777, 3831
- **loop:** 115, 539, 544, 1457, 1603, 1613, 1621, 1688, 1694, 1712, 1733, 1741, 1782, 1797, 1819, 1827, 1864, 2140, 2389, 2412, 2436, 2476, 2548, 2561, 2632, 2642, 2869, 2958, 3116, 3126, 3228, 3693, 3725, 3843, 3884

### [src-js/views-editor/src/panel-glyph-note.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/panel-glyph-note.js)

- **DOM replacement/write:** 112
- **await:** 107, 140
- **lifecycle registration:** 47, 87, 98, 134

### [src-js/views-editor/src/panel-glyph-search.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/panel-glyph-search.js)

- **await:** 89
- **lifecycle registration:** 28, 31, 39, 51

### [src-js/views-editor/src/panel-letterspacer.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/panel-letterspacer.js)

- **CSS filter/animation:** 67, 68, 69, 70, 73, 74, 75, 76, 77, 78, 79, 82, 83, 84, 85, 86, 87, 90, 91, 92, 95, 96
- **DOM replacement/write:** 538, 541, 544, 547, 663, 1048
- **await:** 358, 456, 562, 563, 564, 569, 573, 574, 575, 577, 581, 584, 736, 744, 748, 756, 828, 844, 845, 888, 945, 946, 953, 976, 1029, 1036, 1042, 1061, 1203, 1205, 1230, 1257, 1283, 1311, 1408, 1434, 1448, 1453, 1491, 1502, 1516, 1534, 1543, 1546, 1561, 1634, 1643, 1648, 1843, 1864, 1865, 1880, 1889, 1893, 1931, 1936, 1938, 1943, 1964, 1968, 2031, 2038, 2044
- **collection search:** 893, 897, 910, 1330, 1375, 1385, 1388, 1695, 1719, 1742, 1743, 1744, 2032
- **collection transform:** 284, 646, 892, 893, 897, 1385, 1388, 1740
- **layout read:** 568, 1840
- **lifecycle registration:** 242, 301, 323, 1823
- **loop:** 763, 799, 868, 952, 990, 1019, 1035, 1111, 1317, 1356, 1360, 1390, 1421, 1469, 1657, 1705

### [src-js/views-editor/src/panel-markers.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/panel-markers.js)

- **await:** 163, 448, 462, 487, 495, 499, 503, 509, 513, 517, 521
- **collection search:** 280, 285, 288, 301, 394, 395, 447, 526, 534
- **collection transform:** 268, 285, 288, 394, 395, 450, 489, 534, 535
- **lifecycle registration:** 142, 471
- **loop:** 250, 276

### [src-js/views-editor/src/panel-reference-font.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/panel-reference-font.js)

- **DOM replacement/write:** 339, 586
- **await:** 132, 141, 160, 162, 163, 171, 172, 176, 177, 181, 182, 183, 333, 390, 477, 500, 509, 525, 537, 548, 552, 581, 642, 646, 669, 679
- **collection search:** 54, 117, 350, 439, 572, 573
- **collection transform:** 80, 107, 117, 118, 119, 139, 406, 409, 439, 447, 462, 572, 663
- **front mutation/splice:** 558
- **lifecycle registration:** 244, 253, 258, 267, 274, 534, 614, 636, 640, 644, 668, 681, 682
- **loop:** 142, 163, 276, 389, 418, 476, 579, 588

### [src-js/views-editor/src/panel-related-glyphs.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/panel-related-glyphs.js)

- **DOM replacement/write:** 256, 257, 529
- **await:** 280, 298, 325, 351, 353, 385, 460, 513, 523, 680, 688, 693, 702
- **collection search:** 463, 671
- **collection transform:** 463, 570, 606, 671, 675, 682, 733
- **lifecycle registration:** 104, 114
- **loop:** 363, 380, 432, 471, 474, 723

### [src-js/views-editor/src/panel-selection-info.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/panel-selection-info.js)

- **DOM replacement/write:** 702, 706
- **await:** 121, 124, 157, 165, 173, 185, 189, 194, 223, 279, 308, 335, 363, 364, 390, 394, 395, 413, 418, 580, 708, 713, 763, 783, 801, 814, 830, 832, 842, 880, 987, 994, 1013, 1018, 1035, 1055, 1086, 1088, 1101, 1113, 1127, 1153, 1184, 1198, 1211, 1218, 1249, 1286, 1293, 1548, 1733, 1746
- **collection search:** 588, 591, 925, 972, 976, 1079, 1334, 1582
- **collection transform:** 516, 588, 598, 619, 837, 902, 925, 972, 975, 976, 1333, 1334, 1803
- **copy/serialization:** 490, 551, 1006, 1107, 1433, 1438, 1443
- **layout read:** 160, 699, 744
- **lifecycle registration:** 60, 72, 85, 89, 93
- **loop:** 369, 481, 542, 622, 681, 806, 819, 847, 849, 931, 1015, 1035, 1041, 1207, 1219, 1341, 1351, 1362, 1448, 1481, 1528, 1539, 1637, 1640, 1731, 1738

### [src-js/views-editor/src/panel-selection.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/panel-selection.js)

- **await:** 35, 36

### [src-js/views-editor/src/panel-skeleton-defaults.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/panel-skeleton-defaults.js)

- **DOM replacement/write:** 1321
- **await:** 162, 178, 336, 381, 387, 395, 407, 424, 442, 447, 460, 473, 490, 565, 583, 783, 788, 797, 833, 847, 856, 868, 1120, 1204, 1225, 1262, 1329, 1340, 1344
- **collection search:** 558, 825, 1097
- **collection transform:** 437, 558, 623, 633, 647, 725, 776, 819, 825, 1009, 1012, 1093
- **copy/serialization:** 846
- **front mutation/splice:** 582, 1119
- **layout read:** 1259
- **lifecycle registration:** 142, 156, 173, 297, 303, 595, 893, 1040, 1100
- **loop:** 409, 680, 687, 1127, 1130, 1131, 1198, 1231, 1236, 1329

### [src-js/views-editor/src/panel-skeleton-parameters.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/panel-skeleton-parameters.js)

- **DOM replacement/write:** 1572
- **await:** 198, 436, 438, 902, 1181, 1186, 1197, 1247, 1251, 1262, 1266, 1352, 1378, 1382, 1393, 1397, 1425, 1429, 1435, 1476, 1732, 1734, 1736, 1738, 2195, 2251, 2265, 2272, 2274, 2276, 2278, 2280, 2282, 2296, 2307, 2317, 2330, 2345, 2363, 2375, 2386, 2388, 2390, 2392, 2394, 2396, 2409, 2458, 2471, 2494, 2501, 2506, 2510, 2514, 2520, 2527, 2541, 2564, 2572, 2585, 2591, 2597, 2606
- **collection search:** 215, 273, 294, 617, 618, 1064, 1065, 1215, 1229, 1297, 1757, 2360, 2372, 2426
- **collection transform:** 215, 223, 224, 238, 297, 602, 677, 773, 778, 850, 1158, 1214, 1215, 1216, 1229, 1277, 1288, 1296, 1297, 1298, 1550, 1684, 1695, 1705
- **copy/serialization:** 1337
- **layout read:** 1473
- **lifecycle registration:** 388, 416, 421, 435, 475, 607, 614, 632, 682, 732, 785, 808, 855, 897, 910, 1004
- **loop:** 198, 278, 483, 720, 721, 779, 1550, 1919, 1922, 1982, 1991, 2046, 2068, 2069, 2074, 2345

### [src-js/views-editor/src/panel-text-entry.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/panel-text-entry.js)

- **CSS filter/animation:** 133
- **DOM replacement/write:** 627, 680
- **await:** 178, 241, 266, 375
- **collection search:** 249, 659, 714
- **collection transform:** 249, 651, 677, 709
- **front mutation/splice:** 647, 718
- **layout read:** 619
- **lifecycle registration:** 176, 316, 348, 354, 363, 374
- **loop:** 272, 307, 320, 668, 682, 743, 756

### [src-js/views-editor/src/panel-transformation.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/panel-transformation.js)

- **DOM replacement/write:** 984, 1056
- **await:** 420, 669, 992, 1034, 1063, 1151, 1166, 1168, 1173, 1234, 1236, 1238, 1358, 1364, 1366, 1376, 1460, 1473, 1484, 1496, 1736, 1743, 1744
- **collection search:** 578, 579, 1003, 1270, 1411
- **collection transform:** 153, 929, 1246, 1270, 1387, 1411, 1632, 1700, 1721, 1761, 1900, 1902, 1912, 1913, 1916, 1926, 1928, 1938, 1940, 1950, 1951, 1954, 1964, 1966, 1986, 1987, 2050, 2051, 2107
- **front mutation/splice:** 1787
- **layout read:** 415
- **lifecycle registration:** 178, 210, 384, 385, 386, 387, 388, 395, 575, 605, 609, 610, 913, 941, 1560, 1574, 1575
- **loop:** 242, 254, 291, 312, 326, 433, 434, 992, 1013, 1158, 1175, 1183, 1278, 1358, 1420, 1460, 1481, 1538, 1607, 1655, 1656, 1661, 1695, 1698, 1704, 1708, 1712, 1716, 1757, 1771, 1983, 1998, 2027, 2039, 2078, 2080

### [src-js/views-editor/src/preset-header-control.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/preset-header-control.js)

- **DOM replacement/write:** 54, 75
- **collection search:** 95, 99
- **collection transform:** 101
- **lifecycle registration:** 28

### [src-js/views-editor/src/scene-controller.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/scene-controller.js)

- **await:** 236, 405, 432, 456, 518, 535, 590, 695, 702, 952, 1085, 1396, 1539, 1553, 1588, 1612, 1619, 1658, 1783, 1800, 1811, 1847, 1868, 1883, 1893, 1927, 1960, 1967, 1987, 2029, 2105, 2122, 2150, 2155, 2192, 2200, 2244, 2270, 2288, 2300, 2319, 2330, 2334, 2351, 2375, 2383, 2440, 2543, 2594, 2656, 2666
- **collection search:** 975, 976, 1013, 1153, 1273, 1289, 1312, 1427, 1432, 1435, 1445, 1468, 1473, 1749, 1826, 2057, 2146, 2315, 2357, 2405, 2547, 2808, 2815
- **collection transform:** 1013, 1091, 1153, 1272, 1273, 1282, 1289, 1359, 1407, 1426, 1427, 1432, 1435, 1445, 1468, 1469, 1473, 1503, 1574, 1623, 1635, 1825, 1826, 2145, 2146, 2164, 2194, 2314, 2315, 2367, 2546, 2547, 2756, 2836, 2955, 3010, 3031
- **copy/serialization:** 1423, 2062, 2624
- **front mutation/splice:** 1751, 1752, 2166, 2167, 2227, 2413, 3024
- **lifecycle registration:** 230, 251, 264, 271, 283, 296, 312, 334, 348, 357, 366, 607, 612, 618, 622, 632, 640, 648, 652, 656, 664, 674, 704, 1029, 1218, 1219
- **loop:** 415, 467, 963, 1171, 1186, 1410, 1418, 1585, 1620, 1626, 1635, 2157, 2162, 2202, 2206, 2216, 2245, 2258, 2271, 2273, 2336, 2355, 2370, 2391, 2397, 2403, 2412, 2441, 2464, 2570, 2605, 2631, 2661, 2662, 2820, 2845, 2869, 2893, 2907

### [src-js/views-editor/src/scene-model.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/scene-model.js)

- **await:** 136, 288, 296, 337, 413, 417, 421, 427, 446, 454, 479, 587, 622, 647, 708, 2366, 2397, 2399
- **collection search:** 318, 607, 611, 687, 689, 880, 1230, 1334, 1364, 1584, 2173
- **collection transform:** 579, 607, 608, 611, 681, 687, 689, 880, 1048, 1102, 1391, 1465, 1468, 1559, 1573, 1600, 1704, 1910, 2055, 2068, 2192, 2283, 2340, 2478
- **lifecycle registration:** 102, 123, 144, 160
- **loop:** 317, 353, 354, 437, 641, 893, 921, 932, 960, 964, 980, 1051, 1052, 1064, 1066, 1107, 1108, 1111, 1292, 1339, 1370, 1438, 1473, 1523, 1562, 1573, 1622, 1624, 1656, 1658, 1698, 1700, 1757, 1797, 1819, 1844, 1933, 1942, 1949, 1956, 1957, 1978, 2008, 2016, 2083, 2130, 2189, 2213, 2214, 2261, 2262, 2275, 2364, 2379, 2466, 2492, 2521, 2532, 2537, 2600, 2608

### [src-js/views-editor/src/sidebar.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/sidebar.js)

- **layout read:** 184
- **lifecycle registration:** 72, 182, 189, 190
- **loop:** 56

### [src-js/views-editor/src/skeleton-editing.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/skeleton-editing.js)

- **collection search:** 190, 197, 309, 375, 391, 534, 993, 1095, 1729, 1730, 1774, 1775, 1816, 1823, 1836, 1839, 1860, 1970, 1973
- **collection transform:** 309, 324, 348, 349, 356, 858, 862, 914, 960, 993, 1075, 1367, 1531, 1536, 1617, 1775
- **copy/serialization:** 281, 298, 299, 479, 543, 561, 764, 781, 848, 1614, 1615, 1727
- **loop:** 327, 350, 416, 463, 499, 520, 544, 587, 662, 681, 694, 704, 784, 797, 800, 880, 882, 885, 1005, 1124, 1169, 1197, 1237, 1267, 1306, 1368, 1406, 1479, 1490, 1491, 1534, 1544, 1568, 1639, 1679, 1737, 1859, 2014, 2068

### [src-js/views-editor/src/skeleton-panel-edits.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/skeleton-panel-edits.js)

- **await:** 97, 117, 134, 167, 266, 306, 320, 329, 340, 744, 789, 822, 864, 1438, 1483, 1630, 1679
- **collection search:** 81, 761, 762, 801, 971, 1039, 1055, 1182, 1212
- **collection transform:** 276, 793
- **copy/serialization:** 279, 280, 285, 286, 716, 1390, 1553
- **loop:** 108, 138, 171, 284, 292, 306, 359, 390, 421, 487, 749, 760, 826, 869, 979, 1105, 1135, 1449, 1512, 1527, 1561, 1593, 1641, 1649, 1659

### [src-js/views-editor/src/skeleton-panel-model.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/skeleton-panel-model.js)

- **collection search:** 80, 282, 325, 339, 376, 494
- **collection transform:** 301, 306, 311, 316, 321, 325, 329, 374, 387, 428, 430, 490, 494, 496, 508, 510, 513, 515, 517, 520, 523, 526, 529, 542, 548, 555, 559, 562, 604, 610, 617, 620, 684, 687, 694, 710, 713, 716, 719, 722, 765
- **copy/serialization:** 375, 376, 775, 780
- **loop:** 84, 99, 129, 147, 171, 222, 266, 267, 268, 269, 385, 444, 463, 540, 585, 650, 651, 731, 769, 778, 783

### [src-js/views-editor/src/snapping-interactions.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/snapping-interactions.js)

- **collection search:** 39, 232, 340, 357, 379, 413, 416, 438
- **collection transform:** 38, 60, 185, 186, 232, 243, 305
- **lifecycle registration:** 459, 460
- **loop:** 32, 33, 110, 143, 164, 170, 176, 178, 233, 242, 291, 317, 336, 356, 374, 382, 399, 412, 610

### [src-js/views-editor/src/start.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/start.js)

- **await:** 6

### [src-js/views-editor/src/tension-aware-editing.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/tension-aware-editing.js)

- **collection search:** 312
- **collection transform:** 207, 215, 278, 304, 324, 326
- **copy/serialization:** 61, 102, 104, 107, 202, 235
- **loop:** 109, 125, 212, 237, 239, 327

### [src-js/views-editor/src/tunni-gizmos.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/tunni-gizmos.js)

- **collection search:** 240
- **lifecycle registration:** 87, 95, 326, 404
- **loop:** 124, 128, 171, 193, 194, 231, 408

### [src-js/views-editor/src/tunni-interactions.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/tunni-interactions.js)

- **await:** 83, 100, 112, 166, 209, 227, 324, 508, 568, 689, 736, 821, 987, 1107
- **collection search:** 219, 378, 403, 417, 456, 518, 998
- **collection transform:** 79, 103, 213, 219, 408, 420, 488, 512, 518, 530, 927, 936, 944, 950, 992, 998, 1052
- **copy/serialization:** 381
- **loop:** 112, 157, 159, 227, 252, 383, 452, 529, 568, 605, 607, 823, 828, 1000, 1074, 1108

### [src-js/views-editor/src/visualization-layer-composition.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/visualization-layer-composition.js)

- **loop:** 36

### [src-js/views-editor/src/visualization-layer-definitions.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/visualization-layer-definitions.js)

- **collection search:** 84, 1093, 1756, 2041
- **collection transform:** 84, 552, 1093, 2041, 2046
- **front mutation/splice:** 78
- **loop:** 72, 110, 113, 297, 315, 388, 416, 426, 437, 468, 600, 608, 676, 729, 750, 761, 778, 996, 1000, 1022, 1030, 1055, 1092, 1114, 1160, 1206, 1295, 1300, 1318, 1363, 1381, 1394, 1414, 1445, 1484, 1500, 1512, 1561, 1616, 1680, 1690, 1837, 1838, 1842, 1862, 1868, 1890, 1897, 2019, 2022, 2043, 2142, 2184, 2196, 2207, 2218, 2284, 2291, 2385, 2420, 2457

### [src-js/views-editor/src/visualization-layer-letterspacer.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/visualization-layer-letterspacer.js)

- **loop:** 44, 49, 86, 113, 138

### [src-js/views-editor/src/visualization-layer-markers.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/visualization-layer-markers.js)

- **collection search:** 159, 325
- **collection transform:** 159, 325
- **loop:** 33, 36, 49, 63, 129, 160, 189, 325

### [src-js/views-editor/src/visualization-layer-skeleton.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/visualization-layer-skeleton.js)

- **collection search:** 333, 336, 1017
- **collection transform:** 225, 230, 240, 253, 258, 263, 268
- **loop:** 74, 95, 305, 318, 322, 394, 436, 440, 497, 500, 534, 539, 649, 687, 749, 786, 831, 874, 946, 1013, 1064, 1119, 1277, 1280, 1333

### [src-js/views-editor/src/visualization-layer-snapping.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/visualization-layer-snapping.js)

- **lifecycle registration:** 30
- **loop:** 94, 135, 140

### [src-js/views-editor/src/visualization-layers.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/visualization-layers.js)

- **collection search:** 12, 111, 124
- **collection transform:** 12, 13, 108, 111, 124
- **loop:** 58, 87, 88

### [src-js/views-fontinfo/src/fontinfo.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-fontinfo/src/fontinfo.js)

- **await:** 29, 43
- **lifecycle registration:** 45
- **loop:** 50, 51

### [src-js/views-fontinfo/src/panel-axes.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-fontinfo/src/panel-axes.js)

- **CSS filter/animation:** 658, 668, 675
- **DOM replacement/write:** 102, 399
- **await:** 120, 190, 227
- **collection search:** 349
- **collection transform:** 71, 348, 349, 350, 432, 449, 476, 509, 510, 515, 516, 517, 589, 593, 599, 600, 724, 730, 736, 772, 783, 807, 813, 821, 899, 912
- **front mutation/splice:** 225, 237, 770, 897
- **lifecycle registration:** 93, 129, 362, 777, 906, 933
- **loop:** 85, 95, 131, 135, 145, 581, 608, 942

### [src-js/views-fontinfo/src/panel-base.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-fontinfo/src/panel-base.js)

- **await:** 69, 80, 108
- **collection transform:** 24

### [src-js/views-fontinfo/src/panel-cross-axis-mapping.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-fontinfo/src/panel-cross-axis-mapping.js)

- **CSS filter/animation:** 202
- **DOM replacement/write:** 78, 382
- **await:** 127
- **collection search:** 44, 368
- **collection transform:** 44
- **front mutation/splice:** 125, 284
- **lifecycle registration:** 68
- **loop:** 50, 70, 248, 302, 308, 315, 326, 349, 471

### [src-js/views-fontinfo/src/panel-development-status-definitions.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-fontinfo/src/panel-development-status-definitions.js)

- **DOM replacement/write:** 70, 301
- **collection search:** 99, 193
- **collection transform:** 93, 94, 288
- **front mutation/splice:** 235
- **loop:** 59, 254, 279

### [src-js/views-fontinfo/src/panel-font-info.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-fontinfo/src/panel-font-info.js)

- **DOM replacement/write:** 89, 134
- **await:** 44, 52, 143, 150
- **collection search:** 103, 106
- **collection transform:** 45, 68, 102
- **copy/serialization:** 51, 71, 82
- **loop:** 96

### [src-js/views-fontinfo/src/panel-opentype-feature-code.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-fontinfo/src/panel-opentype-feature-code.js)

- **DOM replacement/write:** 291, 399
- **await:** 290, 365, 380, 388, 393
- **collection search:** 648
- **collection transform:** 402
- **loop:** 405, 627

### [src-js/views-fontinfo/src/panel-sources.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-fontinfo/src/panel-sources.js)

- **DOM replacement/write:** 117, 171, 225, 362, 855
- **await:** 159, 165, 195, 234, 245, 254, 264, 268, 283, 293, 299, 312, 321, 331, 337, 395, 412, 683, 693, 695, 867, 872, 1143, 1146, 1163, 1166, 1181, 1187, 1200, 1203
- **collection search:** 352, 512, 520, 539, 818, 821
- **collection transform:** 347, 375, 534, 566, 817, 887, 924, 944, 952, 1018, 1036
- **front mutation/splice:** 1016
- **lifecycle registration:** 370, 405, 1024
- **loop:** 173, 204, 309, 418, 539, 598, 664, 750, 880, 911, 1091, 1103, 1114, 1145, 1202

### [src-js/views-fontinfo/src/start.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-fontinfo/src/start.js)

- **await:** 6

### [src-js/views-fontoverview/assets/fontoverview.css](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-fontoverview/assets/fontoverview.css)

- **CSS filter/animation:** 17

### [src-js/views-fontoverview/src/fontoverview.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-fontoverview/src/fontoverview.js)

- **DOM replacement/write:** 1205
- **await:** 156, 160, 162, 226, 281, 334, 359, 477, 523, 529, 592, 607, 624, 648, 654, 658, 681, 704, 728, 785, 817, 831, 877, 900, 913, 952, 967, 990, 995, 1046, 1120, 1213
- **collection search:** 310, 661, 716, 724, 933, 968, 1017, 1223
- **collection transform:** 191, 309, 310, 317, 596, 602, 608, 660, 661, 662, 711, 729, 750, 776, 782, 968, 1012, 1017, 1192, 1195, 1223, 1239
- **copy/serialization:** 620, 838
- **lifecycle registration:** 168, 190, 199, 204, 209, 244, 275, 1208
- **loop:** 293, 739, 758, 789, 827, 904, 951, 973, 1077, 1135

### [src-js/views-fontoverview/src/panel-navigation.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-fontoverview/src/panel-navigation.js)

- **await:** 108, 133, 138
- **collection search:** 88
- **collection transform:** 152
- **front mutation/splice:** 147
- **lifecycle registration:** 82, 165, 176
- **loop:** 87, 122

### [src-js/views-fontoverview/src/start.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-fontoverview/src/start.js)

- **await:** 6

### [src-js/views-kerning/assets/kerning.css](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/assets/kerning.css)

- **CSS filter/animation:** 84, 914

### [src-js/views-kerning/src/autokern-worker.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/src/autokern-worker.js)

- **await:** 55
- **collection transform:** 101
- **loop:** 119, 126

### [src-js/views-kerning/src/edit-tools-select.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/src/edit-tools-select.js)

- **await:** 49

### [src-js/views-kerning/src/input-tokens.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/src/input-tokens.js)

- **collection search:** 34
- **collection transform:** 33, 34, 35, 51
- **loop:** 71, 72, 87, 100, 105, 106, 108, 109, 112, 146

### [src-js/views-kerning/src/kerning.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/src/kerning.js)

- **DOM replacement/write:** 774, 1384, 1450, 1453, 1546, 1559, 1566, 1581, 1605, 1725, 2151, 2169, 3204, 3206, 3708, 3739, 3752, 4020, 4456, 4500, 4694, 4706, 4710, 4716, 4727, 5029, 5036, 5172, 5195, 5235, 5244, 5429, 5589, 5780, 5901, 5902, 5904, 5906, 5923, 6009, 6013, 6024, 6032, 6036, 6040, 6093, 6126, 7282, 7391, 7545, 7667, 8301
- **await:** 273, 320, 322, 326, 364, 365, 373, 578, 624, 742, 743, 762, 1003, 1007, 1353, 1380, 1619, 1651, 1690, 1706, 1769, 1817, 1941, 1974, 2051, 2065, 2115, 2124, 2153, 2203, 2225, 2234, 2258, 2621, 2938, 3008, 4378, 4600, 4623, 4648, 4733, 4806, 4819, 4990, 5006, 5007, 5009, 5020, 5045, 5072, 5224, 5320, 5330, 5334, 5351, 5367, 5558, 5695, 5764, 5771, 5800, 5986, 6203, 6227, 6267, 6288, 6289, 6303, 6351, 6392, 6502, 6509, 6536, 6573, 6587, 6624, 6651, 7293, 7448, 7455, 7528, 7585, 7604, 8146, 8149, 8179, 8199
- **collection search:** 589, 1421, 1615, 1671, 1851, 1856, 2047, 2091, 2528, 2552, 3076, 3164, 3915, 3925, 4054, 4059, 4122, 4123, 4291, 4330, 4836, 4879, 5467, 5468, 6301, 6345, 6498, 7307, 7649, 7817, 7818, 7841
- **collection transform:** 369, 1421, 1422, 1425, 1615, 1791, 1851, 1852, 1856, 1857, 1965, 1969, 2047, 2463, 2525, 2549, 2629, 2899, 2910, 3076, 3080, 3157, 3164, 3189, 3393, 3571, 3709, 3915, 3925, 3971, 4038, 4121, 4122, 4123, 4208, 4209, 4215, 4290, 4291, 4330, 4683, 4776, 4835, 4851, 4879, 5158, 5345, 5552, 6301, 6302, 6324, 6345, 6388, 6498, 6499, 6552, 7298, 7307, 7458, 7649, 7784, 7806, 7818, 8020
- **copy/serialization:** 326, 372, 1966, 1970, 2190, 3189, 3203, 3719, 4038, 4659, 6325, 6389
- **layout read:** 6817, 6827, 6828, 6868
- **lifecycle registration:** 550, 551, 705, 706, 707, 708, 725, 755, 756, 872, 885, 893, 922, 927, 934, 988, 1079, 1095, 1104, 1113, 1124, 1300, 1325, 1332, 1494, 1501, 1509, 1512, 2432, 2433, 2444, 2469, 2481, 2493, 2503, 2531, 2555, 2636, 2649, 2777, 2786, 2792, 2810, 2818, 2850, 2861, 2871, 4728, 4937, 4940, 4943, 4969, 5043, 5219, 5222, 5226, 5276, 5620, 5790, 5798, 5929, 6824, 6922, 6927, 6928, 6934, 6969, 7287, 7332, 7393, 7552, 7560
- **loop:** 518, 771, 813, 818, 828, 869, 985, 1352, 1369, 1377, 1650, 1699, 1992, 2064, 2592, 2817, 2924, 2938, 2959, 3055, 3090, 3091, 3549, 3566, 3793, 3840, 3864, 3883, 3975, 4098, 4117, 4377, 4622, 4655, 4667, 4676, 4695, 4804, 4817, 5071, 5116, 5126, 5152, 5155, 5173, 5350, 5442, 5495, 5557, 5590, 5834, 5835, 5841, 5842, 5873, 5920, 6021, 6201, 6225, 6266, 6462, 6523, 6533, 6677, 6693, 6933, 6967, 7005, 7211, 7212, 7221, 7271, 7352, 7446, 7538, 7570, 7593, 7715, 7739, 7740, 7933, 7936, 8000, 8178, 8316, 8326

### [src-js/views-kerning/src/pair-preview-layout.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/src/pair-preview-layout.js)

- **collection transform:** 14
- **loop:** 22, 30

### [src-js/views-kerning/src/results-model.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/src/results-model.js)

- **collection search:** 109, 120, 154, 235, 236, 321, 322, 337, 354, 396, 410
- **collection transform:** 109, 301, 321, 322, 337, 396, 410
- **copy/serialization:** 23, 422
- **loop:** 174, 297, 372, 376, 421

### [src-js/views-kerning/src/start.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/src/start.js)

- **await:** 6

### [src-js/views-kerning/tests/test-aggregate-proposals.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/tests/test-aggregate-proposals.js)

- **collection search:** 305
- **collection transform:** 147, 148, 154
- **copy/serialization:** 222, 235, 407
- **loop:** 139

### [src-js/views-kerning/tests/test-async-revision-guard.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/tests/test-async-revision-guard.js)

- **await:** 31, 66, 73, 98, 100, 102

### [src-js/views-kerning/tests/test-controller-wiring.mjs](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/tests/test-controller-wiring.mjs)

- **await:** 365, 404, 413, 455, 509, 522, 528, 627, 636, 765
- **collection search:** 34, 35
- **collection transform:** 155, 193, 262, 294, 322, 323, 540, 596, 846
- **copy/serialization:** 38, 78, 170, 429, 502, 516, 517, 562, 563, 582, 596, 598, 600, 603, 641, 642, 657, 662, 712, 713, 846
- **front mutation/splice:** 278, 282
- **loop:** 110, 326, 365, 869

### [src-js/views-kerning/tests/test-input-tokens.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/tests/test-input-tokens.js)

- **collection transform:** 54

### [src-js/views-kerning/tests/test-pair-exceptions.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/tests/test-pair-exceptions.js)

- **await:** 88, 97, 105, 113, 141, 149, 176
- **loop:** 26

### [src-js/views-kerning/tests/test-pairtable-writes.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/tests/test-pairtable-writes.js)

- **await:** 80

### [src-js/views-kerning/tests/test-results-rows.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/tests/test-results-rows.js)

- **collection search:** 39, 49, 56, 67, 72
- **collection transform:** 39, 49, 56, 67, 72

### [src-js/views-kerning/tests/test-source-consistency.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/tests/test-source-consistency.js)

- **await:** 68, 75, 82, 100, 101
- **loop:** 19

### [src-js/views-kerning/tests/test-stale-rerun.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/tests/test-stale-rerun.js)

- **await:** 72, 73, 115, 173
- **collection search:** 88, 116, 186, 192
- **collection transform:** 88, 89, 90, 99
- **copy/serialization:** 118, 194
- **loop:** 30, 31, 46, 58, 59, 122, 134, 207

## Files without candidate matches

- [src-js/fontra-core/assets/css/multi-panel.css](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/css/multi-panel.css)
- [src-js/fontra-core/assets/images/aligncenter.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/aligncenter.svg)
- [src-js/fontra-core/assets/images/alignleft.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/alignleft.svg)
- [src-js/fontra-core/assets/images/alignright.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/alignright.svg)
- [src-js/fontra-core/assets/images/bullseye.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/bullseye.svg)
- [src-js/fontra-core/assets/images/cursor-rotate-bottom-center.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/cursor-rotate-bottom-center.svg)
- [src-js/fontra-core/assets/images/cursor-rotate-bottom-left.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/cursor-rotate-bottom-left.svg)
- [src-js/fontra-core/assets/images/cursor-rotate-bottom-right.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/cursor-rotate-bottom-right.svg)
- [src-js/fontra-core/assets/images/cursor-rotate-middle-left.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/cursor-rotate-middle-left.svg)
- [src-js/fontra-core/assets/images/cursor-rotate-middle-right.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/cursor-rotate-middle-right.svg)
- [src-js/fontra-core/assets/images/cursor-rotate-top-center.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/cursor-rotate-top-center.svg)
- [src-js/fontra-core/assets/images/cursor-rotate-top-left.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/cursor-rotate-top-left.svg)
- [src-js/fontra-core/assets/images/cursor-rotate-top-right.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/cursor-rotate-top-right.svg)
- [src-js/fontra-core/assets/images/fontra-icon.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/fontra-icon.svg)
- [src-js/fontra-core/assets/images/gear.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/gear.svg)
- [src-js/fontra-core/assets/images/hand.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/hand.svg)
- [src-js/fontra-core/assets/images/info.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/info.svg)
- [src-js/fontra-core/assets/images/kerningtool.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/kerningtool.svg)
- [src-js/fontra-core/assets/images/knifetool.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/knifetool.svg)
- [src-js/fontra-core/assets/images/layers.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/layers.svg)
- [src-js/fontra-core/assets/images/magnifyingglass.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/magnifyingglass.svg)
- [src-js/fontra-core/assets/images/markertool.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/markertool.svg)
- [src-js/fontra-core/assets/images/minus.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/minus.svg)
- [src-js/fontra-core/assets/images/ovaltool.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/ovaltool.svg)
- [src-js/fontra-core/assets/images/plus.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/plus.svg)
- [src-js/fontra-core/assets/images/pointer.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/pointer.svg)
- [src-js/fontra-core/assets/images/pointeradd.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/pointeradd.svg)
- [src-js/fontra-core/assets/images/pointeraddquad.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/pointeraddquad.svg)
- [src-js/fontra-core/assets/images/pointerscale.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/pointerscale.svg)
- [src-js/fontra-core/assets/images/rectangletool.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/rectangletool.svg)
- [src-js/fontra-core/assets/images/reference.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/reference.svg)
- [src-js/fontra-core/assets/images/ruler.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/ruler.svg)
- [src-js/fontra-core/assets/images/sidebearingtool.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/sidebearingtool.svg)
- [src-js/fontra-core/assets/images/skeleton-pen-single-sided.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/skeleton-pen-single-sided.svg)
- [src-js/fontra-core/assets/images/skeleton-pen.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/skeleton-pen.svg)
- [src-js/fontra-core/assets/images/skew.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/skew.svg)
- [src-js/fontra-core/assets/images/sliders.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/sliders.svg)
- [src-js/fontra-core/assets/images/texttool.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/images/texttool.svg)
- [src-js/fontra-core/assets/lang/de.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/lang/de.js)
- [src-js/fontra-core/assets/lang/en.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/lang/en.js)
- [src-js/fontra-core/assets/lang/es-419.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/lang/es-419.js)
- [src-js/fontra-core/assets/lang/es-ES.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/lang/es-ES.js)
- [src-js/fontra-core/assets/lang/fr.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/lang/fr.js)
- [src-js/fontra-core/assets/lang/it.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/lang/it.js)
- [src-js/fontra-core/assets/lang/ja.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/lang/ja.js)
- [src-js/fontra-core/assets/lang/nl.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/lang/nl.js)
- [src-js/fontra-core/assets/lang/pt-BR.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/lang/pt-BR.js)
- [src-js/fontra-core/assets/lang/pt-PT.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/lang/pt-PT.js)
- [src-js/fontra-core/assets/lang/tl.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/lang/tl.js)
- [src-js/fontra-core/assets/lang/zh-CN.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/lang/zh-CN.js)
- [src-js/fontra-core/assets/lang/zh-TW.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/lang/zh-TW.js)
- [src-js/fontra-core/assets/tabler-icons/alert-circle.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/alert-circle.svg)
- [src-js/fontra-core/assets/tabler-icons/alert-triangle.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/alert-triangle.svg)
- [src-js/fontra-core/assets/tabler-icons/antenna-bars-1.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/antenna-bars-1.svg)
- [src-js/fontra-core/assets/tabler-icons/antenna-bars-2.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/antenna-bars-2.svg)
- [src-js/fontra-core/assets/tabler-icons/antenna-bars-3.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/antenna-bars-3.svg)
- [src-js/fontra-core/assets/tabler-icons/antenna-bars-4.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/antenna-bars-4.svg)
- [src-js/fontra-core/assets/tabler-icons/antenna-bars-5.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/antenna-bars-5.svg)
- [src-js/fontra-core/assets/tabler-icons/arrow-big-right.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/arrow-big-right.svg)
- [src-js/fontra-core/assets/tabler-icons/arrow-move-right.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/arrow-move-right.svg)
- [src-js/fontra-core/assets/tabler-icons/arrows-horizontal.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/arrows-horizontal.svg)
- [src-js/fontra-core/assets/tabler-icons/binary-tree-2.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/binary-tree-2.svg)
- [src-js/fontra-core/assets/tabler-icons/bone.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/bone.svg)
- [src-js/fontra-core/assets/tabler-icons/bug.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/bug.svg)
- [src-js/fontra-core/assets/tabler-icons/check.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/check.svg)
- [src-js/fontra-core/assets/tabler-icons/chevron-right.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/chevron-right.svg)
- [src-js/fontra-core/assets/tabler-icons/chevron-up.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/chevron-up.svg)
- [src-js/fontra-core/assets/tabler-icons/circle-dot.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/circle-dot.svg)
- [src-js/fontra-core/assets/tabler-icons/circle-dotted.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/circle-dotted.svg)
- [src-js/fontra-core/assets/tabler-icons/columns.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/columns.svg)
- [src-js/fontra-core/assets/tabler-icons/dimensions.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/dimensions.svg)
- [src-js/fontra-core/assets/tabler-icons/dots-vertical.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/dots-vertical.svg)
- [src-js/fontra-core/assets/tabler-icons/external-link.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/external-link.svg)
- [src-js/fontra-core/assets/tabler-icons/eye-closed.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/eye-closed.svg)
- [src-js/fontra-core/assets/tabler-icons/eye.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/eye.svg)
- [src-js/fontra-core/assets/tabler-icons/flip-horizontal.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/flip-horizontal.svg)
- [src-js/fontra-core/assets/tabler-icons/flip-vertical.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/flip-vertical.svg)
- [src-js/fontra-core/assets/tabler-icons/focus-2.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/focus-2.svg)
- [src-js/fontra-core/assets/tabler-icons/horizontal-align-bottom.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/horizontal-align-bottom.svg)
- [src-js/fontra-core/assets/tabler-icons/horizontal-align-center.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/horizontal-align-center.svg)
- [src-js/fontra-core/assets/tabler-icons/horizontal-align-top.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/horizontal-align-top.svg)
- [src-js/fontra-core/assets/tabler-icons/language.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/language.svg)
- [src-js/fontra-core/assets/tabler-icons/layers-difference.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/layers-difference.svg)
- [src-js/fontra-core/assets/tabler-icons/layers-intersect-2.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/layers-intersect-2.svg)
- [src-js/fontra-core/assets/tabler-icons/layers-subtract.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/layers-subtract.svg)
- [src-js/fontra-core/assets/tabler-icons/layers-union.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/layers-union.svg)
- [src-js/fontra-core/assets/tabler-icons/layout-distribute-horizontal.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/layout-distribute-horizontal.svg)
- [src-js/fontra-core/assets/tabler-icons/layout-distribute-vertical.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/layout-distribute-vertical.svg)
- [src-js/fontra-core/assets/tabler-icons/link-plus.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/link-plus.svg)
- [src-js/fontra-core/assets/tabler-icons/link.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/link.svg)
- [src-js/fontra-core/assets/tabler-icons/loader-2.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/loader-2.svg)
- [src-js/fontra-core/assets/tabler-icons/lock-open-2.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/lock-open-2.svg)
- [src-js/fontra-core/assets/tabler-icons/lock.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/lock.svg)
- [src-js/fontra-core/assets/tabler-icons/maximize.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/maximize.svg)
- [src-js/fontra-core/assets/tabler-icons/menu-2.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/menu-2.svg)
- [src-js/fontra-core/assets/tabler-icons/minimize.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/minimize.svg)
- [src-js/fontra-core/assets/tabler-icons/notes.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/notes.svg)
- [src-js/fontra-core/assets/tabler-icons/pencil.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/pencil.svg)
- [src-js/fontra-core/assets/tabler-icons/refresh.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/refresh.svg)
- [src-js/fontra-core/assets/tabler-icons/resize.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/resize.svg)
- [src-js/fontra-core/assets/tabler-icons/rotate.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/rotate.svg)
- [src-js/fontra-core/assets/tabler-icons/ruler-measure.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/ruler-measure.svg)
- [src-js/fontra-core/assets/tabler-icons/settings.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/settings.svg)
- [src-js/fontra-core/assets/tabler-icons/shape.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/shape.svg)
- [src-js/fontra-core/assets/tabler-icons/spacing-horizontal.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/spacing-horizontal.svg)
- [src-js/fontra-core/assets/tabler-icons/tool.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/tool.svg)
- [src-js/fontra-core/assets/tabler-icons/trash.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/trash.svg)
- [src-js/fontra-core/assets/tabler-icons/unlink.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/unlink.svg)
- [src-js/fontra-core/assets/tabler-icons/vertical-align-center.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/vertical-align-center.svg)
- [src-js/fontra-core/assets/tabler-icons/vertical-align-left.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/vertical-align-left.svg)
- [src-js/fontra-core/assets/tabler-icons/vertical-align-right.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/vertical-align-right.svg)
- [src-js/fontra-core/assets/tabler-icons/x.svg](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/assets/tabler-icons/x.svg)
- [src-js/fontra-core/src/application-settings.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/application-settings.js)
- [src-js/fontra-core/src/errors.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/errors.js)
- [src-js/fontra-core/src/event-utils.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/event-utils.js)
- [src-js/fontra-core/src/font-info-data.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/font-info-data.js)
- [src-js/fontra-core/src/fontra-internal-data.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/fontra-internal-data.js)
- [src-js/fontra-core/src/fontra-internal-schema.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/fontra-internal-schema.js)
- [src-js/fontra-core/src/glyph-svg.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/glyph-svg.js)
- [src-js/fontra-core/src/number-scrub.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/number-scrub.js)
- [src-js/fontra-core/src/offset-cubic.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/offset-cubic.js)
- [src-js/fontra-core/src/opentype-tags.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/opentype-tags.js)
- [src-js/fontra-core/src/transform.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/transform.js)
- [src-js/fontra-core/src/unicode-scripts-blocks.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/unicode-scripts-blocks.js)
- [src-js/fontra-core/src/vector.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/vector.js)
- [src-js/fontra-core/src/webpack-base.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/src/webpack-base.js)
- [src-js/fontra-core/tests/test-coarse-grid-presets.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-coarse-grid-presets.js)
- [src-js/fontra-core/tests/test-cross-axis-mapper.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-cross-axis-mapper.js)
- [src-js/fontra-core/tests/test-discrete-variation-model.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-discrete-variation-model.js)
- [src-js/fontra-core/tests/test-distance-angle.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-distance-angle.js)
- [src-js/fontra-core/tests/test-font-sources-instancer.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-font-sources-instancer.js)
- [src-js/fontra-core/tests/test-fontra-internal-data.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-fontra-internal-data.js)
- [src-js/fontra-core/tests/test-formatters.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-formatters.js)
- [src-js/fontra-core/tests/test-glyph-data.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-glyph-data.js)
- [src-js/fontra-core/tests/test-glyph-svg.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-glyph-svg.js)
- [src-js/fontra-core/tests/test-letterspacer-engine.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-letterspacer-engine.js)
- [src-js/fontra-core/tests/test-lru-cache.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-lru-cache.js)
- [src-js/fontra-core/tests/test-marker-anchor.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-marker-anchor.js)
- [src-js/fontra-core/tests/test-marker-model.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-marker-model.js)
- [src-js/fontra-core/tests/test-metrics-keys.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-metrics-keys.js)
- [src-js/fontra-core/tests/test-rectangle.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-rectangle.js)
- [src-js/fontra-core/tests/test-simple-compute.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-simple-compute.js)
- [src-js/fontra-core/tests/test-transform.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-transform.js)
- [src-js/fontra-core/tests/test-unicode-scripts-blocks.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-unicode-scripts-blocks.js)
- [src-js/fontra-core/tests/test-var-funcs.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/tests/test-var-funcs.js)
- [src-js/fontra-core/webpack.config.cjs](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-core/webpack.config.cjs)
- [src-js/fontra-webcomponents/src/add-remove-buttons.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/add-remove-buttons.js)
- [src-js/fontra-webcomponents/src/chain-link.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/chain-link.js)
- [src-js/fontra-webcomponents/src/data-table-model.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/data-table-model.js)
- [src-js/fontra-webcomponents/src/overflow-button.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/overflow-button.js)
- [src-js/fontra-webcomponents/src/rotary-control.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/src/rotary-control.js)
- [src-js/fontra-webcomponents/tests/test-data-table-model.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/tests/test-data-table-model.js)
- [src-js/fontra-webcomponents/tests/test-table-selection.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/fontra-webcomponents/tests/test-table-selection.js)
- [src-js/projectmanager-filesystem/landing.html](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/projectmanager-filesystem/landing.html)
- [src-js/projectmanager-filesystem/src/start.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/projectmanager-filesystem/src/start.js)
- [src-js/views-applicationsettings/applicationsettings.html](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-applicationsettings/applicationsettings.html)
- [src-js/views-editor/editor.html](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/editor.html)
- [src-js/views-editor/src/panel.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/panel.js)
- [src-js/views-editor/src/selection-row-group-styles.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-editor/src/selection-row-group-styles.js)
- [src-js/views-fontinfo/fontinfo.html](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-fontinfo/fontinfo.html)
- [src-js/views-fontoverview/fontoverview.html](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-fontoverview/fontoverview.html)
- [src-js/views-kerning/kerning.html](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/kerning.html)
- [src-js/views-kerning/tests/test-analytics.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/tests/test-analytics.js)
- [src-js/views-kerning/tests/test-hidden-results.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/tests/test-hidden-results.js)
- [src-js/views-kerning/tests/test-phrase-restoration.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/tests/test-phrase-restoration.js)
- [src-js/views-kerning/tests/test-results-model.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/tests/test-results-model.js)
- [src-js/views-kerning/tests/ux-filters.test.js](https://github.com/tay-r-dev/fntr-kern/blob/02bbd755925f4eb8a5f00fc248853aac7ba1f756/src-js/views-kerning/tests/ux-filters.test.js)

## Non-code inventory

The other 401 tracked files are JSON/configuration, font/image binaries, text fixtures, CSV data and documentation. Their contents are not executable-pattern candidates; HTML and SVG markup were included in the scan.

import { ObservableController } from "./observable-object.ts";

export const applicationSettingsController = new ObservableController({
  clipboardFormat: "glif",
  rectSelectLiveModifierKeys: false,
  glyphSourcesSortOptions: "by-axis-value",
  alwaysShowGlobalAxesInComponentLocation: false,
  sortComponentLocationGlyphAxes: true,
  disableAdHocMarks: false,
  shapingDebuggerShowIneffectiveItems: false,
  // fork: coarse-grid panel settings (app-level, per D9 — not written to project files)
  coarseGridCustom: false,
  coarseGridBase: 5,
  coarseGridIncrement: 5,
  coarseGridDefaultSpacing: 10,
  // fork: speedpunk panel settings (app-level, per D9 — not written to project files)
  speedPunkPeakHeightUpm: 24,
  speedPunkReferenceTurnDegrees: 90,
  speedPunkColorFlatTurnDegrees: 30,
  speedPunkColorTightTurnDegrees: 120,
  speedPunkSharpness: 1,
  speedPunkOpacity: 0.5,
  // fork: harmonize panel settings (app-level, per D9 — not written to project files)
  harmonizeG3: false,
  harmonizeOtherSources: true,
  // 1 nearest, 2 canonical, 3 canonical with the joint free. See the design
  // document: one control names one construction.
  harmonizeMethod: 2,
  // Finish with one balance and one repair. See the design document.
  harmonizeEqualize: true,
  // fork: what a side-mode change does to the drawing (app-level, per D9 — not
  // written to project files). Off is the plain write: the centerline holds
  // still and the letter moves.
  skeletonSideModeKeepsForm: false,
  skeletonSideModeKeepsEdits: false,
  // fork: a straight running exactly across the axis being scaled stands still
  // by default, because travel along it is travel the scale never asked for.
  // On, both of its tension points travel, each to what its own curve asks.
  // A slanted straight always travels (app-level, per D9).
  slideBothTensionPoints: false,
  // fork: mark-cloud settings (app-level, per D9 — not written to project files)
  compositionMarkCloudOn: false,
  // fork: related-glyphs preview tiles follow their glyph live, or hold still
  // until asked (app-level, per D9 — not written to project files)
  relatedGlyphsLivePreviews: false,
  compositionMarkCloudSets: {},
});

// Node has no localStorage, and this module is reached from the node test
// suites through the editing modules they exercise. Importing it must not throw
// there. In a browser the guard is always true.
if (typeof localStorage !== "undefined") {
  applicationSettingsController.synchronizeWithLocalStorage(
    "fontra-application-settings-"
  );
}

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
  speedPunkReferenceRadiusUpm: 200,
  speedPunkColorFlatRadiusUpm: 400,
  speedPunkColorTightRadiusUpm: 180,
  speedPunkSharpness: 1,
  speedPunkOpacity: 0.5,
  // fork: harmonize panel settings (app-level, per D9 — not written to project files)
  harmonizeG3: false,
  harmonizeMoveOnCurve: false,
  harmonizeOtherSources: true,
  harmonizeEqualizeTension: false,
  harmonizeRealignHandles: false,
  // fork: mark-cloud settings (app-level, per D9 — not written to project files)
  compositionMarkCloudOn: false,
  // fork: related-glyphs preview tiles follow their glyph live, or hold still
  // until asked (app-level, per D9 — not written to project files)
  relatedGlyphsLivePreviews: false,
  compositionMarkCloudSets: {},
});

applicationSettingsController.synchronizeWithLocalStorage(
  "fontra-application-settings-"
);

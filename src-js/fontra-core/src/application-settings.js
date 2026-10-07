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
  // fork: the secondary grid, every Nth grid crossing, shown with custom spacing (app-level, per D9)
  coarseGridSecondaryMultiplier: 0,
  // fork: the grids' look, tuned in the Debug panel: black at these opacities,
  // dot diameters in screen pixels, zoomed out and with the unit grid showing
  gridFineOpacity: 0.06,
  gridMainOpacity: 0.11,
  gridSecondaryOpacity: 0.2,
  gridMainDotSize: 3,
  gridMainDotSizeZoomed: 4,
  gridSecondaryDotSize: 4,
  gridSecondaryDotSizeZoomed: 6,
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
  // The two G2 ticks. See `HARMONIZE_DEFAULTS` in harmonization.js.
  harmonizePreserveCurvature: false,
  harmonizeMoveOnCurve: false,
  // Finish with one balance and one repair. See the design document.
  harmonizeEqualize: true,
  // fork: what a side-mode change does to the drawing (app-level, per D9 — not
  // written to project files). Off is the plain write: the centerline holds
  // still and the letter moves.
  skeletonSideModeKeepsForm: false,
  skeletonSideModeKeepsEdits: false,
  // fork: Shift+Z on a corner or terminal handle turns its angle only; the
  // generator keeps the handle lengths it fits without the turn. Off, the
  // turned handles are refit and their lengths change too (app-level, per D9;
  // each drag writes the choice into the handle it turns).
  skeletonHandTurnKeepsLength: false,
  // fork: a straight running exactly across the axis being scaled stands still
  // by default, because travel along it is travel the scale never asked for.
  // On, both of its tension points travel, each to what its own curve asks.
  // A slanted straight always travels (app-level, per D9).
  slideBothTensionPoints: false,
  // fork: the tension-aware scale (held on X) slides tension points along their
  // straights to keep each curve's proportions. Off, it only adjusts handles
  // (app-level, per D9).
  preserveAspectRatio: true,
  // fork: mark-cloud settings (app-level, per D9 — not written to project files)
  compositionMarkCloudOn: false,
  // fork: related-glyphs preview tiles follow their glyph live, or hold still
  // until asked (app-level, per D9 — not written to project files)
  relatedGlyphsLivePreviews: false,
  // fork: the compose panel's previews list only glyphs from the font and the
  // added glyph sets, and optionally only glyphs carrying anchors
  relatedGlyphsOnlyAddedGlyphSets: true,
  relatedGlyphsOnlyWithAnchors: false,
  compositionMarkCloudSets: {},
  // fork: point-label kinds shown by the fontra.point.labels visualization
  // layer (app-level, per D9 — not written to project files). Single source
  // of truth for both the Measurements accordion checkboxes and the layers
  // that draw the labels (distance-angle.js, visualization-layer-skeleton.js).
  showLabelsDistance: true,
  showLabelsTension: true,
  showLabelsAngle: false,
  // The skeleton's own point labels, set apart from the outline's.
  showSkeletonLabelsDistance: true,
  showSkeletonLabelsTension: true,
  showSkeletonLabelsAngle: false,
  tunniLabelsAlwaysVisible: false,
  // Ticket 30/31: the Visual > Skeleton accordion. Off, the generated outline is
  // not drawn, and SpeedPunk can draw on the centerline instead. The centerline
  // has one thickness per state, in screen pixels.
  skeletonShowGeneratedGeometry: true,
  skeletonSpeedPunk: false,
  skeletonCenterlineWidth: 1.5,
  skeletonCenterlineWidthUngenerated: 3,
  // Percent. How strongly the skeleton rib lines draw; 0 hides them.
  skeletonRibsOpacity: 100,
});

// Node has no localStorage, and this module is reached from the node test
// suites through the editing modules they exercise. Importing it must not throw
// there. In a browser the guard is always true.
if (typeof localStorage !== "undefined") {
  applicationSettingsController.synchronizeWithLocalStorage(
    "fontra-application-settings-"
  );
}

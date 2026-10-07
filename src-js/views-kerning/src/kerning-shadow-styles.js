// The styles of everything the kerning view puts inside a shadow root: the
// bodies of its switch-mode accordions (filters; stale and new glyphs,
// visual settings, analytics) and the parameters card under the run tray.
// kerning.css cannot reach in there, so these live here once and are added
// to the page and to each of those roots (kerning.js's adoptKerningStyles).
export const KERNING_SHADOW_STYLES = `
/* A field's label over it: ui/label/XS. */
.kerning-field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.kerning-field-label {
  font: var(--ui-text-label-xs);
  letter-spacing: var(--ui-tracking);
  color: var(--text-base-basic-3);
}

/* Two fields side by side, 4px apart. */
.kerning-field-pair {
  display: flex;
  gap: 4px;
}

.kerning-field-pair > * {
  flex: 1 1 0;
  min-width: 0;
}

/* A body sits 10px under its switch, 12px in from the card's edge and 4px
   over the next switch's 10px gap: the 8px the accordion gives, plus this. */
.kerning-accordion-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 2px 4px 6px;
}

/* The last body ends 4px over the card's own 8px. */
#kerning-analytics-section {
  padding-bottom: 0;
  margin-bottom: -4px;
}

#kerning-stale-section {
  gap: 8px;
}

#kerning-stale-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  font: var(--ui-text-label-s);
  letter-spacing: var(--ui-tracking);
  color: var(--text-base-basic-3);
}

.kerning-dot-separator {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--text-base-basic-4);
}

.kerning-button-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

#kerning-stale-progress {
  margin: 0;
  font: var(--ui-text-label-s);
  letter-spacing: var(--ui-tracking);
  color: var(--text-base-basic-3);
}

#kerning-stale-progress:empty {
  display: none;
}

#kerning-stale-hint {
  width: 24px;
  height: 20px;
}

/* A sub-section's own label (Figma 4128:2911, 4128:2938): ui/heading/h5. */
.kerning-section-label {
  font: var(--ui-text-heading-h5);
  letter-spacing: var(--ui-tracking);
  color: var(--grey-deprecated-4);
}

/* The stripe opacity and the two checks (Figma 4128:2886). */
.kerning-visual-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Skip all suggestions (Figma 4128:2910): label over the switch, 40px. */
.kerning-skip-group {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 40px;
  padding-bottom: 1px;
  box-sizing: border-box;
}

#kerning-suggestion-preview-skip-all {
  width: 100%;
}

/* Ticket 10: the dialog content built by openAutokernParamsDialog. */
#kerning-parameters-dialog-fields {
  display: flex;
  flex-direction: column;
  gap: 0.35em;
}

/* Figma 4121:8980: 4px under the switch and 12px in from the card's edge
   (the accordion gives 8px), the toggle, the checks and the dropdowns 12px
   apart. */
#kerning-pairtable-filter-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 4px 4px;
}

/* The checks, 12px apart (Figma 4121:8982). */
#kerning-pairtable-switches {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

/* The four dropdowns share the row, 4px apart (Figma 4121:8986). */
#kerning-pairtable-filters {
  display: flex;
  gap: 4px;
}

#kerning-pairtable-filters > * {
  --multi-select-dropdown-width: 100%;
  flex: 1 1 0;
  min-width: 0;
}

/* Calibration (Figma 4128:2937): its label, one bordered table -- 24px rows,
   the glyph row ruled under -- and the settled reach under it. */
#kerning-calibration-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font: var(--ui-text-label-s);
  letter-spacing: var(--ui-tracking);
  color: var(--text-base-basic-3);
}

#kerning-calibration-body p {
  margin: 0;
}

.kerning-calibration-table {
  width: 100%;
  border: 1px solid var(--line-base-basic-1);
  border-radius: 6px;
  border-spacing: 0;
  color: var(--text-base-basic-2);
}

.kerning-calibration-table td {
  height: 24px;
  padding: 0 8px;
  box-sizing: border-box;
}

.kerning-calibration-table td:not(:last-child) {
  width: 60px;
}

.kerning-calibration-table tr:first-child td {
  border-bottom: 1px solid var(--line-base-basic-1);
}

.kerning-calibration-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 1px;
}

/* Analytics (Figma 4128:3085): a name and its count per row, two even
   columns, 7px apart. */
#kerning-analytics-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
  font: var(--ui-text-label-s);
  letter-spacing: var(--ui-tracking);
}

.kerning-analytics-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.kerning-analytics-row dt,
.kerning-analytics-row dd {
  flex: 1 1 0;
  min-width: 0;
  margin: 0;
}

.kerning-analytics-row dt {
  color: var(--text-base-basic-3);
}

.kerning-analytics-row dd {
  color: var(--text-base-basic-2);
  white-space: nowrap;
}

/* The two checks under the stripe opacity, 10px and 12px apart. */
.kerning-checkmark-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 12px;
}

/* The checkmark rows: our checkbox assets (fontra-core/assets/images),
   the same as the editor's designspace panel's checks. */
.kerning-checkmark-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font: var(--ui-text-label-s);
  letter-spacing: var(--ui-tracking);
  font-feature-settings: "case" 1;
  color: var(--kerning-label-color);
  white-space: nowrap;
}

.kerning-checkmark {
  appearance: none;
  box-sizing: border-box;
  flex: none;
  margin: 0;
  width: 14px;
  height: 14px;
  border: 1px solid rgba(21, 21, 21, 0.05);
  border-bottom: none;
  border-radius: 4px;
  background: var(--kerning-checkmark-color) center / contain no-repeat;
  cursor: pointer;
}

.kerning-checkmark-row:hover .kerning-checkmark {
  background-color: var(--kerning-checkmark-hover-color);
}

.kerning-checkmark:checked,
.kerning-checkmark-row:hover .kerning-checkmark:checked {
  border: none;
  background-color: transparent;
  background-image: url("/images/checkbox-on-rest.svg");
}

.kerning-checkmark-row:hover .kerning-checkmark:checked {
  background-image: url("/images/checkbox-on-hover.svg");
}

.kerning-checkmark:disabled {
  border: none;
  background: url("/images/checkbox-disabled.svg") center / contain no-repeat;
}
`;

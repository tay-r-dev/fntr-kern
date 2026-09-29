// A row of small labeled icon groups: a label, then its icon buttons, then the
// next label. Ticket 40 built it for Flip, Align, Distribute and Bools; ticket
// 47 uses it for Generation's Projection, Reset and Rib. One copy, appended to
// each form that draws such a row.
export const SELECTION_ROW_GROUP_STYLES = `
  /* Each label stands above its buttons: the row flows by column, two cells
     per column, so a label and the buttons after it share one column. */
  .selection-row-group {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: auto auto;
    justify-content: start;
    align-items: center;
    gap: 0.25em 1.5em;
  }

  /* Groups spread across the whole row. */
  .selection-row-group.spread {
    justify-content: space-between;
    column-gap: 0.5em;
  }

  .selection-row-group-label {
    white-space: nowrap;
  }

  .selection-row-group-icons {
    display: flex;
    align-items: center;
    /* The design's button/icon row (Figma 312:2780): 20px tiles, 2px apart. */
    gap: 2px;
  }

  .selection-row-group-icons icon-button {
    width: 20px;
    height: 20px;
  }

  .selection-row-group-icons input[type="number"] {
    width: 3.5em;
  }

  /* A tray: button/segmented's plate (Figma 287:15729) holding a group's
     buttons, an overflow set off by a line, and a segmented control drawn
     flat on the plate. */
  .selection-row-group-icons.tray {
    justify-self: start;
    gap: 1px;
    padding: 0;
    border-radius: 6px;
    background: #e0e0e0;
  }

  /* Each icon-button child drawn as segment/button (Figma 287:15640). The
     host is the outer face, with its lines and 2px/1px inset; the button in
     its shadow root is the inner container, set through its
     --icon-button-inner-* hooks. The icon is 16px throughout.

     rest     face #f5f5f5, line under;           inner #f5f5f5, square
     hover    face white, lines above and under;  inner #f7f7f7, radius 5
     press    face white, line above and at the   inner #f7f7f7, radius 5,
              outer side(s), none under;          2px padding
     on       face #f0f0f0, lines as press;       inner clear
     disabled as rest;                            inner at 30%

     A left segment rounds its left corners and takes the left side line, a
     right one the right; a middle one is square and takes both. */
  .selection-row-group-icons.tray icon-button {
    box-sizing: border-box;
    flex: 1 1 0;
    min-width: 0;
    width: auto;
    height: 24px;
    padding: 2px 1px;
    background: #f5f5f5;
    border: 0 solid #e0e0e0;
    border-bottom-width: 1px;
    --icon-button-icon-size: 16px;
    --icon-button-inner-fill: #f5f5f5;
    --icon-button-inner-border: transparent;
    --icon-button-inner-radius: 0;
    --icon-button-inner-hover-fill: #f7f7f7;
    --icon-button-inner-hover-border: transparent;
    --icon-button-inner-press-fill: #f7f7f7;
    --icon-button-inner-press-border: transparent;
    --icon-button-on-background-color: transparent;
  }

  .selection-row-group-icons.tray icon-button:first-child {
    border-radius: 6px 0 0 6px;
  }

  .selection-row-group-icons.tray icon-button:last-child {
    border-radius: 0 6px 6px 0;
  }

  .selection-row-group-icons.tray icon-button:hover {
    background: #fff;
    border-width: 1px 0;
    --icon-button-inner-radius: 5px;
  }

  .selection-row-group-icons.tray icon-button:active,
  .selection-row-group-icons.tray icon-button[on] {
    padding-bottom: 0;
    border-width: 1px 1px 0;
    --icon-button-inner-radius: 5px;
    --icon-button-inner-padding: 2px;
  }

  .selection-row-group-icons.tray icon-button:active {
    background: #fff;
  }

  .selection-row-group-icons.tray icon-button[on] {
    background: #f0f0f0;
    --icon-button-inner-fill: transparent;
  }

  .selection-row-group-icons.tray icon-button:first-child:is(:active, [on]) {
    border-right-width: 0;
  }

  .selection-row-group-icons.tray icon-button:last-child:is(:active, [on]) {
    border-left-width: 0;
  }

  .selection-row-group-icons.tray icon-button[disabled] {
    background: #f5f5f5;
    border-width: 0 0 1px;
    --icon-button-inner-opacity: 0.3;
  }

  .selection-row-group-icons.tray overflow-button,
  .selection-row-group-icons.tray overflow-popover {
    box-sizing: border-box;
    height: 24px;
    display: flex;
    align-items: center;
    padding: 0 0.15em;
    border-left: 1px solid #0002;
  }

  /* Every tile in a tray is one height: icon buttons, segments and the
     overflow alike. */
  .selection-row-group-icons.tray segmented-control {
    --segmented-control-tray-color: transparent;
    --segmented-control-border-color: transparent;
    --segmented-control-tray-padding: 0;
    --segmented-control-button-height: 100%;
  }

  /* Latch buttons stand alone, each with its own face (the design's
     button/latch, Figma 287:15701): three separate toggles in the Rib group,
     not segments of one plate. */
  .selection-row-group-icons.latches {
    justify-self: stretch;
    width: 100%;
  }

  .selection-row-group-icons.latches latch-button {
    flex: 1 1 0;
    min-width: 0;
    height: 24px;
  }

  /* A labeled group over its tray, and two such groups sharing a row half
     and half (the Transform and Skeleton panels). */
  .row-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    /* 12px to the next group, with the form's 8px row gap. */
    padding-bottom: 4px;
  }

  /* ui/heading/h5 */
  .row-group > .selection-row-group-label {
    font: var(--ui-text-heading-h5);
    letter-spacing: var(--ui-tracking);
    color: #8e8e8e;
  }

  .row-pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
  }

  .row-pair > .row-group {
    padding-bottom: 0;
  }

  .row-pair .tray {
    justify-self: stretch;
  }

  /* The redesigned panels' plain text takes the design's sizes in the old
     UI font: label/XS for row labels, values and whole-width rows, label/S
     for checks. The new components and headings bring Martian Mono. */
  .ui-form-label,
  .ui-form-value,
  .ui-form-full-width {
    font: var(--ui-text-label-s);
    letter-spacing: var(--ui-tracking);
    font-family: var(--ui-font-old);
  }

  .ui-form-label.checkbox,
  .ui-form-value.checkbox {
    font: var(--ui-text-label-m);
    letter-spacing: var(--ui-tracking-label-m);
    font-family: var(--ui-font-old);
  }
`;

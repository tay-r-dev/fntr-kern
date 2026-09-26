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
    gap: 0.35em;
  }

  .selection-row-group-icons icon-button {
    width: 1.5em;
    height: 1.5em;
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

  /* Each icon-button child styled from outside as segment/button (Figma
     287:15640): the host itself is the segment's face, since the button
     inside its shadow root stays transparent and 100% of the host box. */
  .selection-row-group-icons.tray icon-button {
    box-sizing: border-box;
    flex: 1 1 0;
    min-width: 0;
    width: auto;
    height: 24px;
    padding: 4px;
    background: #f5f5f5;
    border: none;
    border-bottom: 2px solid #e0e0e0;
  }

  .selection-row-group-icons.tray icon-button:first-child {
    border-radius: 6px 0 0 6px;
  }

  .selection-row-group-icons.tray icon-button:last-child {
    border-radius: 0 6px 6px 0;
  }

  .selection-row-group-icons.tray icon-button:hover {
    background: #fff;
    border-top: 1px solid #e0e0e0;
    border-bottom: 1px solid #e0e0e0;
  }

  .selection-row-group-icons.tray icon-button:active {
    background: #fcfcfc;
    border-top: 2px solid #e0e0e0;
    border-bottom: 1px solid #e0e0e0;
  }

  .selection-row-group-icons.tray icon-button[on] {
    background: #f0f0f0;
    border-top: 2px solid #e0e0e0;
    border-bottom: 1px solid #e0e0e0;
  }

  .selection-row-group-icons.tray icon-button[disabled] {
    opacity: 35%;
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
`;

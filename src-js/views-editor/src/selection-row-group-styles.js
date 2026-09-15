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

  /* A tray: one grey plate holding a group's buttons, an overflow set off by
     a line, and a segmented control drawn flat on the plate. */
  .selection-row-group-icons.tray {
    justify-self: start;
    gap: 2px;
    padding: 2px;
    border-radius: 0.35em;
    background: #8883;
  }

  .selection-row-group-icons.tray icon-button {
    box-sizing: border-box;
    width: 1.8em;
    height: 1.8em;
    padding: 0.35em;
  }

  .selection-row-group-icons.tray overflow-button,
  .selection-row-group-icons.tray overflow-popover {
    align-self: stretch;
    display: flex;
    align-items: center;
    padding: 0 0.2em;
    border-left: 1px solid #0002;
  }

  .selection-row-group-icons.tray segmented-control {
    --segmented-control-tray-color: transparent;
    --segmented-control-border-color: transparent;
  }
`;

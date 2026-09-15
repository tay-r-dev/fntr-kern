// A row of small labeled icon groups: a label, then its icon buttons, then the
// next label. Ticket 40 built it for Flip, Align, Distribute and Bools; ticket
// 47 uses it for Generation's Lock, Link and Reset. One copy, appended to each
// form that draws such a row.
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
`;

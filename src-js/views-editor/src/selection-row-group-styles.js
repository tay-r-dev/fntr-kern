// A row of small labeled icon groups: a label, then its icon buttons, then the
// next label. Ticket 40 built it for Flip, Align, Distribute and Bools; ticket
// 47 uses it for Generation's Lock, Link and Reset. One copy, appended to each
// form that draws such a row.
export const SELECTION_ROW_GROUP_STYLES = `
  .selection-row-group {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5em 1em;
  }

  .selection-row-group-label {
    font-size: 0.85em;
    opacity: 0.7;
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

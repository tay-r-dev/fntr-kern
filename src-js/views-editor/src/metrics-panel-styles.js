// Figma 4108:2089. The cards are white on the panel grey, ruled, 14px corners;
// headings ui/heading/h2, captions ui/label/XS, the info line ui/label/S.
export const METRICS_PANEL_STYLES = `
  .metrics-cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    box-sizing: border-box;
    overflow: hidden auto;
    background-color: var(--surface-base-basic-1);
  }

  .metrics-card {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 8px 8px;
    background-color: var(--ui-element-background-color);
    border: 1px solid var(--line-base-basic-1);
    border-radius: 14px;
  }

  .metrics-card[hidden],
  .metrics-host[hidden] {
    display: none;
  }

  .metrics-card--form {
    padding: 8px;
  }

  .metrics-heading-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
  }

  /* ui/heading/h2 */
  .metrics-heading {
    font: var(--ui-text-heading-h2);
    letter-spacing: var(--ui-tracking);
    text-transform: uppercase;
    color: var(--text-base-basic-5);
  }

  .metrics-heading-icon,
  .metrics-update {
    width: 16px;
    height: 16px;
  }

  /* The glyph's name and unicode, ruled under (ui/label/S). */
  .metrics-info {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line-base-basic-1);
    font: var(--ui-text-label-s);
    letter-spacing: var(--ui-tracking);
    font-feature-settings: "case" 1;
    color: var(--text-base-basic-3);
    white-space: nowrap;
    overflow: hidden;
  }

  .metrics-info-part {
    display: flex;
    gap: 4px;
    min-width: 0;
  }

  .metrics-info-dot {
    flex: none;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background-color: var(--text-base-basic-4);
  }

  .metrics-stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .metrics-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* ui/label/XS */
  .metrics-label {
    font: var(--ui-text-label-xs);
    letter-spacing: var(--ui-tracking);
    font-feature-settings: "case" 1;
    color: var(--text-base-basic-3);
  }

  .metrics-row {
    display: flex;
    gap: 4px;
  }

  .metrics-row > * {
    flex: 1 1 0;
    min-width: 0;
  }

  .metrics-key-controls {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
  }

  .metrics-key-controls icon-button {
    width: 16px;
    height: 16px;
  }
`;

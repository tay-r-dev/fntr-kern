import { themeColorCSS } from "./theme-support.js";

// checkmark (Figma 379:22544): a native checkbox with our checkbox assets
// (fontra-core/assets/images) and its name, ui/label/S. At rest a checked box
// is the grey check and an empty one the light box, both with grey names;
// hover lights the check lime or darkens the box, and darkens the name.
//
// A label.checkmark-row holding an input.checkmark and, optionally, the name.
// Add CHECKMARK_STYLES to every root the rows render in -- a page, a panel's
// shadow root, an accordion's or a popover's -- since no stylesheet reaches
// across a shadow boundary. The colours are defined on the row itself, so
// nothing else need be in that root.
const colors = {
  "checkmark-color": ["#e9e9e9", "#444444"],
  "checkmark-border-color": ["rgba(21, 21, 21, 0.05)", "rgba(255, 255, 255, 0.05)"],
  "checkmark-hover-color": ["#d9d9d9", "#555555"],
  "checkmark-hover-border-color": ["rgba(21, 21, 21, 0.1)", "rgba(255, 255, 255, 0.1)"],
  "checkmark-label-color": ["var(--text-base-basic-3)", "#9a9a9a"],
  "checkmark-label-hover-color": ["#303030", "#e0e0e0"],
  "checkmark-label-disabled-color": ["var(--text-base-basic-4)", "#6a6a6a"],
};

export const CHECKMARK_STYLES = `
${themeColorCSS(colors, ".checkmark-row")}

.checkmark-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font: var(--ui-text-label-s);
  letter-spacing: var(--ui-tracking);
  font-feature-settings: "case" 1;
  color: var(--checkmark-label-color);
  white-space: nowrap;
}

.checkmark {
  appearance: none;
  box-sizing: border-box;
  flex: none;
  margin: 0;
  width: 14px;
  height: 14px;
  border: 1px solid var(--checkmark-border-color);
  border-bottom: none;
  border-radius: 4px;
  background: var(--checkmark-color) center / contain no-repeat;
  cursor: pointer;
}

.checkmark-row:hover .checkmark {
  background-color: var(--checkmark-hover-color);
  border-color: var(--checkmark-hover-border-color);
}

.checkmark:checked,
.checkmark-row:hover .checkmark:checked {
  border: none;
  background-color: transparent;
  background-image: url("/images/checkbox-on-rest.svg");
}

.checkmark-row:hover .checkmark:checked {
  background-image: url("/images/checkbox-on-hover.svg");
}

.checkmark-row:hover {
  color: var(--checkmark-label-hover-color);
}

.checkmark-row:has(:disabled) {
  color: var(--checkmark-label-disabled-color);
  cursor: default;
}

.checkmark:disabled {
  border: none;
  background: url("/images/checkbox-disabled.svg") center / contain no-repeat;
}
`;

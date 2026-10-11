// smol (Figma 4102:1607): the small value box. 16px high, the XS label,
// 4px corners. At rest it is bare text; on hover it fills grey and its text
// darkens; while focused it is also ruled. On a selected row (`select`) it
// is lime text, white on hover, lime-ruled while focused. As a dropdown it
// carries a 5px arrow 2px after its text, in its text's colour.
//
// A table, the transform panel's rotate field and the slot slider rows all
// draw it. Components live in shadow roots, so each root the box sits in
// takes `smolCSS()` into its own styles. `hoverWithin` and `selectedWithin`
// name an ancestor whose hover or selected state the box shows too, as a
// table row's does.

export function smolCSS({ hoverWithin, selectedWithin } = {}) {
  // Each state's selectors, for the box and for the dropdown that holds it.
  // `ancestor` is the element whose state the box shows: the hover host, or
  // the selected row, which is also the row hovered.
  const box = (state, { select = false } = {}) => {
    const el = select ? ".smol.select" : ".smol";
    const ancestor = select ? selectedWithin : hoverWithin;
    const prefix = select && selectedWithin ? `${selectedWithin} ` : "";
    const variants = [el, ...(prefix ? [`${prefix}.smol`] : [])];
    if (state === "hover") {
      return [
        // Never over focus, which outranks hover.
        ...variants.map((variant) => `${variant}:hover:not(:disabled):not(:focus)`),
        ...(ancestor ? [`${ancestor}:hover .smol:not(:disabled):not(:focus)`] : []),
      ];
    }
    if (state === "focus") {
      return variants.map((variant) => `${variant}:focus`);
    }
    return variants;
  };
  const rule = (selectors, declarations) => {
    // The dropdown takes the box's colour for its arrow: the ancestor part
    // of a selector stays in front, the box part goes inside :has().
    const withDropdown = selectors.flatMap((selector) => {
      const split = selector.lastIndexOf(" ") + 1;
      return [
        selector,
        `${selector.slice(0, split)}.smol-dropdown:has(> ${selector.slice(split)})`,
      ];
    });
    return `${withDropdown.join(",\n  ")} {\n    ${declarations}\n  }`;
  };
  const text = (color) => `color: ${color};`;
  const fill = (background, border = "transparent") =>
    `background-color: ${background};\n    border-color: ${border};`;

  return `
  .smol {
    box-sizing: border-box;
    field-sizing: content;
    min-width: 16px;
    height: 16px;
    margin: 0;
    padding: 2px 3px;
    border: 1px solid transparent;
    border-radius: 4px;
    outline: none;
    background: transparent;
    font: var(--ui-text-label-xs);
    letter-spacing: var(--ui-tracking);
    font-feature-settings: "case" 1;
    text-align: center;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: textfield;
  }

  .smol::-webkit-outer-spin-button,
  .smol::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .smol-dropdown {
    position: relative;
    display: inline-flex;
    align-items: center;
    max-width: 100%;
  }

  .smol-dropdown > .smol {
    padding-right: 10px;
    cursor: pointer;
  }

  .smol-dropdown > .smol:disabled {
    cursor: default;
  }

  /* The arrow: 5px, 4px in from the right edge, the box's text colour. */
  .smol-dropdown::after {
    content: "";
    position: absolute;
    right: 4px;
    width: 5px;
    height: 5px;
    background: currentColor;
    mask: url("/images/arrow-down-s.svg") center / 5px 3.25px no-repeat;
    pointer-events: none;
  }

  ${rule(box("rest"), text("var(--text-base-basic-3)"))}

  ${rule(box("hover"), text("var(--text-base-basic-2)"))}

  ${rule(box("focus"), text("var(--text-base-basic-1)"))}

  ${box("hover").join(",\n  ")} {
    ${fill("var(--surface-base-basic-2)")}
  }

  ${box("focus").join(",\n  ")} {
    ${fill("var(--surface-base-basic-2)", "var(--line-base-basic-1)")}
  }

  ${rule(box("rest", { select: true }), text("var(--text-color-lime-basic-3)"))}

  ${rule(box("hover", { select: true }), text("var(--text-color-lime-basic-2)"))}

  ${rule(box("focus", { select: true }), text("var(--text-color-lime-basic-1)"))}

  ${box("hover", { select: true }).join(",\n  ")} {
    ${fill("var(--surface-base-basic-0)")}
  }

  ${box("focus", { select: true }).join(",\n  ")} {
    ${fill("var(--surface-base-basic-0)", "var(--line-color-lime-basic-1)")}
  }
`;
}

// The box as an entry: a native input.
export function smolEntry({
  value = "",
  type = "text",
  placeholder,
  title,
  disabled = false,
  className,
}) {
  const input = document.createElement("input");
  input.type = type;
  input.className = className ? `smol ${className}` : "smol";
  input.value = String(value ?? "");
  if (placeholder) {
    input.placeholder = placeholder;
  }
  if (title) {
    input.title = title;
  }
  input.disabled = disabled;
  return input;
}

// The box as a dropdown: a native select in a field that draws the arrow.
// `options` is [{value, label}]. The field's `select` is the select.
export function smolDropdown({
  value,
  options,
  disabled = false,
  className,
  onChange,
}) {
  const select = document.createElement("select");
  select.className = className ? `smol ${className}` : "smol";
  select.disabled = disabled;
  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label ?? option.value;
    element.selected = option.value === value;
    select.appendChild(element);
  }
  select.addEventListener("change", () => onChange?.(select.value));
  const field = document.createElement("span");
  field.className = "smol-dropdown";
  field.appendChild(select);
  field.select = select;
  return field;
}

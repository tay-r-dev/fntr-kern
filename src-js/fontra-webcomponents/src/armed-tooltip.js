// The tooltip a two-press control shows after its first press: an icon has no
// text to change, so the warning appears beside it instead (UI-REFACTOR.md
// §4.4, §7.2). Lifted from the Letterspacer panel's Reverse guard.
//
// Fixed to the document body, so it shows the same whether the anchor sits in
// the page or in a panel's shadow root. Returns a function that removes it.
export function showArmedTooltip(anchor, message) {
  if (!anchor || !message) {
    return () => {};
  }
  const tooltip = document.createElement("div");
  tooltip.textContent = message;
  Object.assign(tooltip.style, {
    position: "fixed",
    zIndex: "9999",
    maxWidth: "220px",
    padding: "8px 10px",
    borderRadius: "6px",
    fontSize: "0.85rem",
    lineHeight: "1.3",
    color: "var(--tooltip-foreground-color, #fff)",
    background: "var(--tooltip-background-color, #000)",
    boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
    pointerEvents: "none",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    boxSizing: "border-box",
  });

  document.body.appendChild(tooltip);

  const rect = anchor.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  const margin = 8;
  let left = rect.left - tipRect.width - margin;
  if (left < margin) {
    left = rect.right + margin;
  }
  if (left + tipRect.width > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - tipRect.width - margin);
  }
  let top = rect.top + rect.height / 2 - tipRect.height / 2;
  top = Math.min(window.innerHeight - tipRect.height - margin, Math.max(margin, top));

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;

  return () => tooltip.remove();
}

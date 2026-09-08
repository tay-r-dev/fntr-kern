// Pure, view-local helpers for the kerning view's Glyph and Pair inputs:
// token syntax (spec F22) and Ctrl+Click/Shift+Ctrl+Click serialization
// (spec F07). No DOM, no font writes.
//
// docs/superpowers/plans/2026-09-08-kerning-view-ux.md Task 6;
// docs/superpowers/kerning-ux-integration.md §8.1 (binding correction):
// Glyph and Pair inputs both hold a comma-separated list of single
// glyph-tokens -- neither input ever holds a pair-token. This module's
// grammar is identical for both inputs; how a Pair input's tokens combine
// with a Glyph input's tokens into concrete preview pairs is plan Task 7,
// added onto this same file.

// A single token's syntax, identical in the Glyph input and the Pair input
// (ledger §8.1: "there is no separate pair grammar, because neither input
// holds pairs, only lists of single tokens").
export function parseToken(text) {
  const t = text.trim();
  if (t.startsWith("%") && t.endsWith("%!")) {
    const name = t.slice(1, -2).trim();
    if (!name) {
      throw new Error("Enter a glyph name between % and %!");
    }
    return { kind: "member", name };
  }
  if ((t[0] === "/" || t[0] === "@") && t.length > 1) {
    return { kind: t[0] === "/" ? "glyph" : "class", name: t.slice(1) };
  }
  if ([...t].length === 1 && !["/", "@", "%"].includes(t)) {
    return { kind: "literal", name: t };
  }
  throw new Error("Use a character, /glyphname, @class, or %glyphname%!");
}

// Both the Glyph input and the Pair input hold a comma-separated list of
// tokens (ledger §8.1). An empty/blank string parses to no tokens at all,
// not an error -- an empty input is a valid, common state (F06: "Empty Pair
// input imposes no pair restriction").
export function parseTokenList(text) {
  return (text || "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(parseToken);
}

// Spec F07: "Shift+Ctrl+Click appends the clicked glyph, using comma
// separation." Serializes with the explicit "/name" notation (F22, F07's
// own "serialize the glyph using the supported notation") and ignores a
// duplicate addition (F07 recommended detail).
export function appendGlyphToken(input, name) {
  const parts = (input || "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const token = "/" + name;
  return [...new Set([...parts, token])].join(", ");
}

// Spec F07: "Ctrl+Click replaces the Glyph input with the clicked glyph."
export function replaceGlyphToken(name) {
  return "/" + name;
}

// Pure, view-local helpers for the kerning view's Glyph and Pair inputs:
// token syntax (spec F22), Ctrl+Click/Shift+Ctrl+Click serialization
// (spec F07), and -- once a token is resolved against real font data --
// the many-to-many cross product that supplies pair-mode preview (spec F06).
// No DOM, no font writes.
//
// docs/superpowers/plans/2026-09-08-kerning-view-ux.md Tasks 6/7;
// docs/superpowers/kerning-ux-integration.md §8.1 (binding correction):
// Glyph and Pair inputs both hold a comma-separated list of single
// glyph-tokens -- neither input ever holds a pair-token. "Pair" only means
// something relative to whatever is in "Glyph": the real preview pairs are
// every Glyph-input token cross-produced against every Pair-input token.

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

// Resolves one parsed token to the concrete glyph name(s) it names, against
// real font data. `resolver` is duck-typed to
// `{characterMap, glyphMap, classMembers(className, side)}` so this is
// testable without a real FontController/KerningController. `side` is
// "left" or "right" -- which class-membership map a `@ClassName` token
// resolves against (the Glyph input's tokens are always resolved on "left",
// the Pair input's on "right": ledger §8.1, "Pair" only makes sense as the
// other side of whatever is in "Glyph").
export function resolveTokenToGlyphNames(token, resolver, side) {
  switch (token.kind) {
    case "literal": {
      const codePoint = token.name.codePointAt(0);
      const glyphName = resolver.characterMap[codePoint];
      if (!glyphName) {
        throw new Error(`No glyph is mapped to "${token.name}"`);
      }
      return [glyphName];
    }
    case "glyph":
    case "member": {
      if (!resolver.glyphMap[token.name]) {
        throw new Error(`Unknown glyph name "${token.name}"`);
      }
      return [token.name];
    }
    case "class": {
      const members = resolver.classMembers(token.name, side) || [];
      if (!members.length) {
        throw new Error(`Unknown class "${token.name}"`);
      }
      return members;
    }
    default:
      throw new Error(`Unknown token kind "${token.kind}"`);
  }
}

// The many-to-many cross product (ledger §8.1: "every Glyph-input token
// paired with each Pair-input token"), also reused for a highlighted
// class-summary row's own two membership lists once that row type exists
// (ledger §8.1: "capped at 50 pairs... with the remainder disclosed as a
// count, not silently dropped").
export function crossProductPairs(leftNames, rightNames, maxPairs = 50) {
  const pairs = [];
  let truncated = false;
  outer: for (const left of leftNames) {
    for (const right of rightNames) {
      if (pairs.length >= maxPairs) {
        truncated = true;
        break outer;
      }
      pairs.push([left, right]);
    }
  }
  return { pairs, truncated };
}

// The full Glyph-input/Pair-input matching pipeline (plan Task 7's
// interface: "Input matching returns concrete pairs plus an explicit-choice
// flag"). `explicit` is true only when both inputs actually named at least
// one token and every token resolved -- F06: "Empty Pair input... must not
// automatically send the entire table into preview," which also means a
// half-empty Glyph/Pair combination produces no pairs, not a guess. An
// unresolvable token (unknown glyph/class name) is reported in `error`
// rather than thrown, so a caller can show it inline instead of silently
// producing a misleading match (F22 recommended detail).
export function pairsFromInputs(glyphText, pairText, resolver, maxPairs = 50) {
  let glyphTokens;
  let pairTokens;
  try {
    glyphTokens = parseTokenList(glyphText);
    pairTokens = parseTokenList(pairText);
  } catch (e) {
    return { pairs: [], truncated: false, explicit: false, error: e.message };
  }
  if (!glyphTokens.length || !pairTokens.length) {
    return { pairs: [], truncated: false, explicit: false, error: null };
  }
  try {
    const leftNames = [
      ...new Set(
        glyphTokens.flatMap((token) => resolveTokenToGlyphNames(token, resolver, "left"))
      ),
    ];
    const rightNames = [
      ...new Set(
        pairTokens.flatMap((token) => resolveTokenToGlyphNames(token, resolver, "right"))
      ),
    ];
    const { pairs, truncated } = crossProductPairs(leftNames, rightNames, maxPairs);
    return { pairs, truncated, explicit: true, error: null };
  } catch (e) {
    return { pairs: [], truncated: false, explicit: false, error: e.message };
  }
}

// Glyph-filter grammar and matching. Filtering never changes rule membership.
export function parseToken(text) {
  const name = text.trim();
  if (!name || /[%!]/u.test(name) || name === "@" || name === "/") {
    throw new Error("Enter a glyph name, character, or @class name.");
  }
  if (name.startsWith("@")) return { kind: "class", name: name.slice(1) };
  // Accept old slash-prefixed names, but always serialize plain names.
  return { kind: "glyph", name: name.replace(/^\//, "") };
}

export function parseTokenList(text) {
  return (text || "").split(",").map((s) => s.trim()).filter(Boolean).map(parseToken);
}

export function replaceGlyphToken(name) { return name; }

export function appendGlyphToken(input, name) {
  const names = parseTokenList(input).map((token) =>
    token.kind === "class" ? "@" + token.name : token.name);
  return [...new Set([...names, name])].join(", ");
}

export function resolveTokenToGlyphNames(token, resolver, side) {
  if (token.kind === "class") {
    const members = resolver.classMembers(token.name, side) || [];
    if (!members.length) throw new Error(`Unknown class "${token.name}"`);
    return members;
  }
  if (Object.hasOwn(resolver.glyphMap, token.name)) return [token.name];
  if ([...token.name].length === 1) {
    const name = resolver.characterMap[token.name.codePointAt(0)];
    if (name) return [name];
  }
  throw new Error(`Unknown glyph "${token.name}"`);
}

export function crossProductPairs(leftNames, rightNames, maxPairs = 50) {
  const pairs = [];
  for (const left of new Set(leftNames)) {
    for (const right of new Set(rightNames)) {
      if (pairs.length === maxPairs) return { pairs, truncated: true };
      pairs.push([left, right]);
    }
  }
  return { pairs, truncated: false };
}

export function resolveGlyphFilter(text, resolver) {
  try {
    const tokens = [...new Map(parseTokenList(text).map((token) =>
      [JSON.stringify(token), token])).values()];
    const left = new Set();
    const right = new Set();
    for (const token of tokens) {
      if (token.kind === "class") {
        const l = resolver.classMembers(token.name, "left") || [];
        const r = resolver.classMembers(token.name, "right") || [];
        if (!l.length && !r.length) throw new Error(`Unknown class "${token.name}"`);
        l.forEach((name) => left.add(name));
        r.forEach((name) => right.add(name));
      } else {
        for (const name of resolveTokenToGlyphNames(token, resolver)) {
          left.add(name);
          right.add(name);
        }
      }
    }
    return { left, right, count: tokens.length, error: null };
  } catch (error) {
    return { left: new Set(), right: new Set(), count: 0, error: error.message };
  }
}

export function pairMatchesGlyphFilter(left, right, filter, side = "both") {
  if (filter.error) return false;
  if (!filter.count) return true;
  const l = filter.left.has(left);
  const r = filter.right.has(right);
  if (filter.count > 1) return l && r;
  return side === "left" ? l : side === "right" ? r : l || r;
}

// Use the clicked occurrence's neighbors, never a cross-product or other lines.
export function adjacentPairsForGlyph(positionedLines, { lineIndex, glyphIndex }) {
  const glyphs = positionedLines[lineIndex]?.glyphs || [];
  const pairs = [];
  for (const index of [glyphIndex - 1, glyphIndex]) {
    if (index >= 0 && index + 1 < glyphs.length) {
      pairs.push([glyphs[index].glyphName, glyphs[index + 1].glyphName]);
    }
  }
  return pairs;
}

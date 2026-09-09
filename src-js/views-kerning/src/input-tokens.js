// Glyph-filter grammar and matching. Filtering never changes rule membership.
//
// A trailing "!" EXPOSES what the token names: a class member's own pair rows
// appear in the table beside the class rule that covers them, instead of being
// summarized by it. It is the narrow form of the "Show individual class
// members" checkbox, one glyph at a time. On a class token it exposes every
// member. On a glyph in no class it says nothing, because there is no summary
// standing in for that glyph's rows.
//
// "%" is not part of the grammar. It was half of a "%name%!" shape that has
// been removed; rejecting it outright keeps a typed leftover an error rather
// than a glyph name nothing can resolve.
export function parseToken(text) {
  let name = text.trim();
  let expose = false;
  if (name.endsWith("!")) {
    expose = true;
    name = name.slice(0, -1).trim();
  }
  if (!name || /[%!]/u.test(name) || name === "@" || name === "/") {
    throw new Error(
      "Enter a glyph name, character, or @class name. Add ! to show a class member's own rows."
    );
  }
  if (name.startsWith("@")) return { kind: "class", name: name.slice(1), expose };
  // Accept old slash-prefixed names, but always serialize plain names.
  return { kind: "glyph", name: name.replace(/^\//, ""), expose };
}

export function parseTokenList(text) {
  return (text || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseToken);
}

export function replaceGlyphToken(name) {
  return name;
}

// Serializes a token back to what the designer would have typed, exposure
// mark included -- a click that rewrites the field must not silently drop the
// "!" off a token already in it.
export function serializeToken(token) {
  const base = token.kind === "class" ? "@" + token.name : token.name;
  return token.expose ? base + "!" : base;
}

export function appendGlyphToken(input, name) {
  const names = parseTokenList(input).map(serializeToken);
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
    // Deduplicated on kind and name alone, never on the exposure mark, so
    // "a, a!" is one token asking for one glyph. Keying on the whole token
    // would make it two, and two tokens mean "pairs BETWEEN these", which
    // would silently turn one glyph's filter into an and-both-sides filter.
    const byName = new Map();
    for (const token of parseTokenList(text)) {
      const key = token.kind + ":" + token.name;
      const existing = byName.get(key);
      if (existing) {
        existing.expose = existing.expose || token.expose;
      } else {
        byName.set(key, { ...token });
      }
    }
    const tokens = [...byName.values()];
    const left = new Set();
    const right = new Set();
    const exposed = new Set();
    for (const token of tokens) {
      if (token.kind === "class") {
        const l = resolver.classMembers(token.name, "left") || [];
        const r = resolver.classMembers(token.name, "right") || [];
        if (!l.length && !r.length) throw new Error(`Unknown class "${token.name}"`);
        l.forEach((name) => left.add(name));
        r.forEach((name) => right.add(name));
        if (token.expose) {
          l.forEach((name) => exposed.add(name));
          r.forEach((name) => exposed.add(name));
        }
      } else {
        for (const name of resolveTokenToGlyphNames(token, resolver)) {
          left.add(name);
          right.add(name);
          if (token.expose) {
            exposed.add(name);
          }
        }
      }
    }
    return { left, right, exposed, count: tokens.length, error: null };
  } catch (error) {
    return {
      left: new Set(),
      right: new Set(),
      exposed: new Set(),
      count: 0,
      error: error.message,
    };
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

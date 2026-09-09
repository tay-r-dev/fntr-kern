// Class derivation for forkra "Kerning view and autokern" (spec §5, §5.3,
// workstream 2).
//
// Pure data-transform, no DOM: plain objects/Maps/arrays and numbers only.
// This module CONSUMES the flat cache and already-resolved glyph facts (it
// does not measure anything and it does not know what a "component" is or
// how Fontra represents one) -- the same discipline autokern-engine.js keeps
// for rasters ("the engine takes a raster, it does not make one").
//
// Every exported function returns NEW data. None of them mutate an input and
// none of them write a class assignment anywhere -- per spec §1, "the tool
// suggests, it never writes on its own." Callers decide whether to accept a
// proposal.
//
// ---------------------------------------------------------------------------
// Input contracts (designed here; no prior code defines a cache shape)
// ---------------------------------------------------------------------------
//
// cache: the flat measured pairs (spec §4), one entry per glyph pair:
//   Array<{ left: string, right: string, value: number }>
// `left`/`right` are glyph names. `value` is a number in whatever unit the
// caller uses (pixels, font units, whatever) -- this module never
// interprets the unit, it only compares differences against a caller-
// supplied tolerance in that same unit.
//
// side: one of the strings "left" or "right", naming which field of a cache
// entry addresses the glyph whose row/class is being derived. Spec §5:
// side 1 is the left member of a pair (a side-1 class is a statement about
// a glyph's right profile) and side 2 is the right member. Side "left"
// here means "group glyphs by their behaviour as the LEFT member of a
// pair" (Fontra's side 1); side "right" means side 2. The two sides are
// independent (spec §5) and every function below operates on one side at a
// time -- call it twice, once per side, to derive both.
//
// existing class assignments (per side): Map<glyphName, string|null>.
// A glyph absent from the map or mapped to null/undefined has no explicit
// class on that side. One map per side (they are independent, spec §5).
//
// composite base relationships: Map<compositeGlyphName, baseGlyphName>,
// already resolved by the caller -- this module does not resolve
// components, that is a font-data adapter's job (out of scope here, the
// same way glyph-raster.js is out of scope for workstream 1). A base may
// itself be a composite (chain); see inheritCompositeClasses below for how
// chains are resolved.
//
// script / Unicode category per glyph: Map<glyphName, string>, one map for
// script and a separate one for category. Used only as the cross-
// script/category merge guard (spec §5.3): "never merge across scripts or
// Unicode categories without asking."
//
// Proposed class: a plain array of glyph names, Array<string>, with no
// implied order. This module never assigns or invents a class NAME (spec
// §5.2: "a class's stored name is an address"); naming a proposal is a
// caller/view concern.

// ---------------------------------------------------------------------------
// Tactic 1: composite inheritance (spec §5.3)
// ---------------------------------------------------------------------------

// A composite with no explicit class of its own inherits its base's class.
// Never overwrites a glyph's own explicit class. Resolves a chain
// (composite of a composite) transitively -- a base that is itself a
// composite with no class of its own is resolved the same way, so a
// three-level chain (grandparent has a class, in-between composite has
// none, leaf composite has none) propagates the grandparent's class down
// the whole chain. A cycle in `compositeBases` (which should never occur in
// real font data) is guarded against and resolves to "no class" rather than
// looping forever.
//
// Returns a NEW Map; does not mutate `existingClasses` or `compositeBases`.
export function inheritCompositeClasses(existingClasses, compositeBases) {
  const result = new Map(existingClasses);
  const memo = new Map();

  function resolve(glyph, visiting) {
    if (memo.has(glyph)) {
      return memo.get(glyph);
    }
    const own = existingClasses.get(glyph);
    if (own != null) {
      memo.set(glyph, own);
      return own;
    }
    if (visiting.has(glyph)) {
      // Cycle guard: a composite chain that loops back on itself has
      // nothing sound to inherit.
      return null;
    }
    if (!compositeBases.has(glyph)) {
      memo.set(glyph, null);
      return null;
    }
    visiting.add(glyph);
    const base = compositeBases.get(glyph);
    const resolved = resolve(base, visiting);
    visiting.delete(glyph);
    memo.set(glyph, resolved);
    return resolved;
  }

  for (const glyph of compositeBases.keys()) {
    const own = existingClasses.get(glyph);
    if (own != null) {
      continue; // explicit class always wins, never overwritten
    }
    result.set(glyph, resolve(glyph, new Set()));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tactic 2: kern-row clustering (spec §5.3)
// ---------------------------------------------------------------------------

// Build, for the given side, Map<glyph, Map<otherGlyph, value>> -- one row
// per glyph, columns keyed by the glyph on the OTHER side of the pair.
function buildRows(cache, side) {
  const own = side === "left" ? "left" : "right";
  const other = side === "left" ? "right" : "left";
  const rows = new Map();
  for (const entry of cache) {
    const g = entry[own];
    const col = entry[other];
    let row = rows.get(g);
    if (!row) {
      row = new Map();
      rows.set(g, row);
    }
    row.set(col, entry.value);
  }
  return rows;
}

// Two glyphs are candidates to merge when: same script, same Unicode
// category, they share at least one column (no shared columns is no
// evidence, never a merge), and every shared column agrees within
// tolerance. The tolerance boundary is INCLUSIVE: a difference exactly
// equal to tolerance counts as "within" (documented deliberately, not by
// accident -- spec only says "within a tolerance", so the boundary itself
// belongs to the class rather than being an exception to it).
function rowsAgree(glyphA, glyphB, rows, tolerance, scripts, categories) {
  // "Never merge across scripts or Unicode categories WITHOUT ASKING" (spec
  // §5.3) is an absolute, so an unknown script/category must never be
  // silently treated as "same" just because two `undefined`s are strictly
  // equal to each other -- a glyph missing from either map blocks the merge
  // exactly like a genuine mismatch would.
  const scriptA = scripts.get(glyphA);
  const scriptB = scripts.get(glyphB);
  if (scriptA === undefined || scriptB === undefined || scriptA !== scriptB) {
    return false;
  }
  const categoryA = categories.get(glyphA);
  const categoryB = categories.get(glyphB);
  if (categoryA === undefined || categoryB === undefined || categoryA !== categoryB) {
    return false;
  }
  const rowA = rows.get(glyphA);
  const rowB = rows.get(glyphB);
  let sharedAny = false;
  for (const [col, valueA] of rowA) {
    if (!rowB.has(col)) {
      continue;
    }
    sharedAny = true;
    const valueB = rowB.get(col);
    if (Math.abs(valueA - valueB) > tolerance) {
      return false;
    }
  }
  return sharedAny;
}

// Clusters glyphs on one side of the cache into proposed classes.
//
// Clustering rule (a documented judgement call, spec §5.3 asks for one):
// pairwise agreement is not transitive under a tolerance (A~B and B~C does
// not imply A~C), so this does NOT use naive transitive closure /
// union-find over pairwise edges -- that would merge glyphs that do not
// themselves agree, on no evidence between them. Instead it requires every
// pair within a proposed class to mutually agree (a clique): glyphs are
// visited in ascending name order and each glyph joins the first existing
// cluster whose EVERY current member it agrees with; if it agrees fully
// with no existing cluster, it starts a new one. This is deterministic,
// principled (every member of an output class actually agrees with every
// other member, so the class is exact by the same definition spec §5.3
// gives it: "glyphs whose whole row of cached values agrees are one
// class"), and cheap (one pass, pairwise checks against small clusters).
// It is not guaranteed to find the globally largest possible clustering
// (that is a maximum-clique-partition problem); a smaller, entirely
// mutually-agreeing class is preferred here over a larger one with an
// internal disagreement.
//
// Only clusters with two or more members are returned -- a "cluster" of one
// glyph that agrees with nothing is not a merge and is not a proposal.
//
// Returns Array<Array<string>>, new arrays, does not mutate `cache`.
export function deriveKernRowClusters(cache, side, tolerance, scripts, categories) {
  const rows = buildRows(cache, side);
  const glyphs = [...rows.keys()].sort();

  const clusters = [];
  for (const glyph of glyphs) {
    let placed = false;
    for (const cluster of clusters) {
      const agreesWithAll = cluster.every((member) =>
        rowsAgree(glyph, member, rows, tolerance, scripts, categories)
      );
      if (agreesWithAll) {
        cluster.push(glyph);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push([glyph]);
    }
  }

  return clusters
    .filter((cluster) => cluster.length >= 2)
    .map((cluster) => [...cluster]);
}

// ---------------------------------------------------------------------------
// Spread (spec §5.2)
// ---------------------------------------------------------------------------

// Spread of a proposed class, for a given side, against every column
// (other-side glyph) the cache has data for on at least one member:
// per-column spread is max - min of the members' cached values against that
// column (a column only one member has data for trivially spreads 0 -- no
// disagreement is observable from a single value). `overall` is the worst
// (largest) per-column spread, since spec §5.2 uses spread as a quality
// readout ("tight means the class is right, wide means the class is
// wrong") and the worst column is what should surface a bad member.
//
// A class of one member has zero spread on every column and overall
// (documented convention: nothing to disagree with).
//
// Returns { perColumn: Map<otherGlyph, number>, overall: number }.
export function classSpread(members, cache, side) {
  const rows = buildRows(cache, side);
  const perColumn = new Map();

  for (const member of members) {
    const row = rows.get(member);
    if (!row) {
      continue;
    }
    for (const [col, value] of row) {
      let stats = perColumn.get(col);
      if (!stats) {
        stats = { min: value, max: value };
        perColumn.set(col, stats);
      } else {
        if (value < stats.min) stats.min = value;
        if (value > stats.max) stats.max = value;
      }
    }
  }

  const spreadByColumn = new Map();
  let overall = 0;
  for (const [col, stats] of perColumn) {
    const spread = stats.max - stats.min;
    spreadByColumn.set(col, spread);
    if (spread > overall) overall = spread;
  }

  return { perColumn: spreadByColumn, overall };
}

# Sidebearing Variables — Design Spec

**Date:** 2026-07-24
**Revised:** 2026-07-26 — storage verified (§3), letterspacer arbitration added
(§4.10), staleness narrowed to a single cause (§4.8)
**Branch:** `feature/sidebearing-variables`
**Status:** design — all open questions resolved; ready for a plan

---

## 1. Problem

Fontra's selection-info panel already lets you type a **glyph name** into a
sidebearing field instead of a number. Typing `n` into `o`'s left sidebearing
resolves `n`'s left margin and sets `o`'s left margin to that value. `n!` uses
`n`'s **opposite** (right) margin. Arbitrary expressions work too (`n + 10`,
`(a + b) / 2`), evaluated per editing layer.

**The gap:** this is a *one-shot* evaluation. The resolved number is written and
the reference is forgotten. If you later change `n`'s sidebearing, `o` does not
follow — the link never existed after the first keystroke.

This is the industry-standard **"metrics keys"** feature (Glyphs.app `=n` /
`=|n`, RoboFont metrics linking). The fork already has the hard part — the
expression evaluator (`_evaluateMetricsExpression`,
`panel-selection-info.js:929`). What's missing is **persisting** the reference
so it can be re-evaluated.

A prior fork attempt already prototyped this: commit `0327a50dd` ("persistent
sidebearings variables") on the abandoned `test/refactor` lineage. This spec
ports that idea cleanly onto the current baseline, using the decisions below.

---

## 2. The model (decided with the user)

Two distinct moments, deliberately behaving differently:

| Moment | Behavior |
| --- | --- |
| **Creating** a link (you type `=n`) | **Automatic.** Parse → resolve → set the margin → store the key. One action. |
| **Refreshing** an existing link (`n` changed later) | **Manual.** An **"Update" button** re-resolves the source's keys and re-applies them. |

A link is signalled by a leading **`=`** (`=n`, `=o!`, `=(a+b)/2`), matching
Glyphs/RoboFont. A bare glyph name (no `=`) keeps its current **one-shot**
behavior — evaluate once, store nothing. So the two intents are distinct and
both survive.

**Shared by default, source-override on demand.** A link you create is
**glyph-wide**: shared by every source (the expression re-resolves per source at
each source's location). When one master needs a different rule, a **source
override** control (§4.9) detaches just that source's side, giving it its own
expression that the others don't see. Default is simple; the power is opt-in.
See §3 for the two-level cascade.

This is explicitly **not** an automatic-propagation system. Editing `n` never
reaches out and rewrites `o` on its own. There is no reverse dependency index,
no cross-glyph write during normal editing, no cycle-driven cascade, no undo
pollution from glyphs you didn't touch. The one command that *does* touch other
glyphs — **Update all metrics** (§4.3) — is an explicit, user-triggered sweep,
not a side effect of editing. The user chose the button-driven model on purpose:
predictable, cheap, and the designer stays in control of *when* metrics
propagate.

---

## 3. Data model & persistence

Stored in the shared `fontra.internal` customData section infrastructure — the
same mechanism the skeleton uses (`fontra-internal-schema.js` /
`fontra-internal-data.js`), so it round-trips through every Fontra backend into
the user's project files.

**New section constant** in `FONTRA_INTERNAL_SECTIONS`:

```js
SIDEBEARING_KEYS: "sidebearingKeys"
```

**Two levels — a cascade** (matching the fork's own width fallback: contour
default → per-point override). One section name, `sidebearingKeys`, stored at two
entity levels:

| Level | Entity | Meaning |
| --- | --- | --- |
| **Shared** (default) | `VariableGlyph.customData` (glyph) | One key per side, shared by **all** sources. The everyday case. |
| **Source override** | `StaticGlyph.customData` (layer) | A per-side key that **shadows** the shared key **for that source only**. Opt-in. |

**`VariableGlyph.customData` verified as the right home** (2026-07-26, against the
tree — this was questioned and settled, don't re-litigate):

- It exists **upstream** (`src/fontra/core/classes.py:209`). Unlike
  `StaticGlyph.customData`, which is the fork's one-line backend change, this
  needs no backend work at all.
- It round-trips. The `.fontra` backend serializes the whole `VariableGlyph`; the
  designspace/UFO backend reads it at `designspace.py:636` and writes it at
  `:854` under the lib key `xyz.fontra.customData`. Upstream uses the same field
  for glyph locking (`designspace.py:635` comment).
- `var-glyph.js:15` deep-copies it, so keys survive glyph copy — the same
  guarantee skeleton persistence depends on.
- **The fork already writes here.** Letterspacer stores `referenceGlyphName` at
  glyph level (`panel-letterspacer.js:171`), persisted through
  `editNamedGlyphAndRecordChanges` (`:928`). The write path, including undo, is
  proven in this codebase — reuse it.

Two facts to know rather than worry about: UFO storage is physically the
**default** source's glyph lib, so copying a *non-default* UFO layer glyph
between fonts does not carry the keys (same limitation as glyph locking); and
`designspace.py:853` pops the note key out of `glyph.customData` during write,
which doesn't touch ours.

The one alternative — font-level customData keyed by glyph name — is worse: a
single hot object contended by every glyph edit, and it doesn't travel with the
glyph. `VariableGlyph.customData` is also the *only* per-glyph-not-per-source
location the format offers.

**Effective key** for (source *S*, side *D*) = source override `[S][D]` if
present, else the shared `[D]`, else none (plain number). The resolver (§4.7)
always evaluates the *effective* key.

**Shape** (identical at both levels; only present sides appear):

```js
// glyph-level (shared default)
varGlyph.glyph.customData["fontra.internal"].sidebearingKeys = {
  left:  { expression: "n" },    // stored WITHOUT the leading '='
  right: { expression: "o!" },
}
// layer-level (override for this source, only the overridden side present)
layerGlyph.customData["fontra.internal"].sidebearingKeys = {
  left:  { expression: "m" },    // this source's LSB keys to m instead of n
}
```

- `expression` — the reference the user typed, `=` stripped, stored raw (`n`,
  `o!`, `(a+b)/2`). The **only** stored field, and the source of truth for the
  link; replayed through the shared resolver (§4.7) on Update.

**No cached resolved value is persisted** (a change from the prototype, which
stored `value`). Reasons: (a) redundant — the authoritative resolved number
already lives in the real per-source margin; (b) a persisted cache is a *third*
copy that can silently disagree with both the real margin and the live-resolved
value; (c) resolving the current source's ≤2 effective expressions on panel build
is cheap. Resolving on display also powers the staleness highlight (§4.8).

A side with no key has no entry. An empty `sidebearingKeys` object is deleted at
its level, and so is an empty `fontra.internal` — no residue in clean glyphs.

**Why the real margin is still written:** because we also apply the resolved
value to the actual sidebearing, the font stays correct for any consumer that
doesn't understand keys (export, other editors). The key is *additive*
metadata, exactly like Glyphs writing both the number and the `=n`.

---

## 4. Behavior spec

### 4.1 Creating a link
1. User types `=` + a metrics reference (`=n`, `=o!`, `=(a+b)/2`) into a
   sidebearing field.
2. Write the key at the **level the field is bound to**: the **shared** (glyph)
   key by default, or the **source override** if this source+side is currently
   overridden (§4.9).
3. Resolve the effective key (§4.7) for each source it now governs, at each
   source's location, and apply the margin (§5).
4. Store `{ expression }` (the `=`-stripped string) at that level.
5. Field now shows the link (§4.5).

A bare reference without `=` runs the existing one-shot evaluation and stores
nothing.

### 4.2 Refreshing (the Update button — current glyph)
- A single **Update** button appears in the sidebearings row **only when the
  glyph has at least one key** (shared or any source override). Single press (it
  is idempotent and non-destructive — no confirm needed).
- Pressing it: for **every source**, resolve its **effective** key (§4.7) and
  re-apply (§5). One undo step (`"update sidebearings"`).
- Disabled when the glyph is locked or the font is read-only.

### 4.3 Refreshing everything (Update all — two-press)
- A font-wide **"Update all metrics"** command, exposed as an editor action
  (menu entry, shortcut-assignable) rather than a panel button, since it isn't
  scoped to the selected glyph.
- **Two-press confirm** (per the user): because it rewrites margins across the
  whole font, the first invocation arms and asks for confirmation; the second
  within a short window executes. (A menu action confirms via a dialog rather
  than the icon-swap used by in-panel buttons.)
- It enumerates every glyph, and for each **source** with an effective key,
  performs the same per-source re-resolve and re-apply as §4.2, skipping locked
  glyphs.
- **Atomic, single undo step.** Editing many glyphs by name in one undo record is
  an existing capability in the codebase (font-level `recordChanges` +
  `fontController.editFinal`). The plan reuses that mechanism.
- Still fully manual. No automatic/push behavior.
- Chain ordering (`a`←`b`, `b`←`c`) in a single pass: keys resolve from each
  reference's **current** margin, so a long chain may settle one link per pass.
  Run the pass **to a fixpoint** (bounded by glyph count; stop when a pass
  changes nothing). Cycles (§7.5) are the natural stop condition.
- Cost: a full glyph scan. Acceptable because it is explicit and infrequent; no
  reverse index is built — each source resolves only its own keys.

### 4.4 Clearing / unlinking
Operates on the level the field is bound to (shared, or the source override):
- **Type a plain number** into a keyed field → breaks the link **at its level**;
  the number stands. (Typing a new `=…` replaces the key at that level.)
- **Unlink button — two-press.** A small unlink icon on a keyed field, using the
  established armed-state pattern (`panel-skeleton-defaults.js:194-217`: first
  click swaps the icon and arms, second click executes). Removes the key **at its
  level** while **leaving the current margin value in place** — keep the number,
  drop the dependency.

Level semantics:
- Field bound to the **shared** key → unlink removes the shared key. Any source
  that has its own override is unaffected (cascade); inheriting sources lose the
  link.
- Field bound to a **source override** → unlink removes just that override; the
  source reverts to the shared key if one exists, else to a plain number. (This
  is the same effect as §4.9's "Reset to shared".)

### 4.5 Display
A keyed field must show both the link (the expression) and its current resolved
number. The prototype baked them into one string — `n (80)` — and then had to
regex-strip the `(80)` back off (`stripDisplaySuffix`) every time the field was
re-read. That is fragile (an editable string carrying non-editable content) and
is avoided here.

The field's editable value is the pure expression shown with its `=` (`=n`); the
resolved number is a **separate, non-editable adornment** (suffix label or
tooltip). No stripping, no parse ambiguity.

Implementation note: `ui-form`'s existing `displayValue` hook is wired only to
the **range-slider** widget (`ui-form.js:511`), not the `edit-number-x-y` fields
sidebearings use — so a small `ui-form` addition is needed to carry the
adornment on the number field.

### 4.6 Opposite-side (`!`) semantics
Preserved from the existing evaluator: `=n` → `n`'s same-side margin; `=n!` →
`n`'s opposite-side margin. No new syntax invented beyond the `=` prefix.

### 4.7 The shared resolver (one implementation)
Creating a link (§4.1), the live-display resolve (§4.5 / §4.8), per-glyph Update
(§4.2) and Update-all (§4.3) all go through **one** resolver — not the
prototype's two parallel copies (it duplicated the `instantiateController` loop).

It resolves **one source's effective expression** (§3 cascade — override else
shared) **at that source's location**: the referenced glyph is instantiated at
the same location, so a Bold key reads the referenced glyph's Bold margin.
Signature roughly: `resolveMetricsKey(fontController, expression, side, location)
→ number`. Picking the effective expression is the caller's job; the resolver
just evaluates a given string at a given location.

**Detail found in code:** the existing `_evaluateMetricsExpression` resolves only
over **editing** layers (`_getEditingLocations`). This feature must also resolve
for sources that aren't open (Update, Update-all). So the shared resolver is a
generalization parameterized by an explicit location, and
`_evaluateMetricsExpression` becomes a thin caller of it. One copy of the
`nameCapture` → `compute` → `instantiateController` chain.

### 4.8 Staleness highlight
When a referenced glyph's sidebearing has changed but Update has not been pressed,
the keyed field is **visually marked stale**. Mechanism (no new watchers): on
panel build, for each keyed side of the current source, the resolver produces the
*live* value; compare it to the source's *applied* margin. If they differ beyond
a rounding epsilon, render the field in a stale style (e.g. a warning tint /
marker on the number). Pressing Update clears it by definition. This is the
signal that tells the user *when* the manual Update is worth pressing.

Stale is tested against the **effective** key of the current source, so an
overridden source is judged by its own expression, an inheriting source by the
shared one.

**Stale means exactly one thing: the referenced glyph's sidebearing changed.**
It is the "press Update" signal and nothing else sets it. In particular a
letterspacer override does **not** produce a stale field — it deletes the key and
leaves a plain number (§4.10). Keeping the signal single-cause is what makes it
readable: a stale marker always means *the owner moved*, never *another tool
touched this*.

### 4.9 Source override control
A per-side toggle that detaches the current source from the shared key.

- **When a side is inheriting the shared key:** the field shows a small
  **"Override for this source"** button. Pressing it creates a source-level key
  for that side (seeded from the shared expression), bound to this source only.
  The field is now editable independently — a new `=…` here changes just this
  source; other sources keep following the shared key.
- **When a side is already overridden:** the button becomes **"Reset to shared"**
  — removes the source override, reverting the side to the shared key (or to a
  plain number if no shared key exists). This is the same operation as unlinking
  a source-override field (§4.4). Single-press is fine (it is non-destructive of
  the *number* — the margin value stays; only the override key is dropped).
- A visible **marker** distinguishes an overridden field from an inheriting one
  (e.g. a filled vs outline link icon), so "is this source special?" is legible
  at a glance.

**Naming** (decided, override-able by the user): concept **"source override"**;
button labels **"Override for this source"** / **"Reset to shared"**. Rejected
alternatives: "source-adjust" (vague about what it does), "detach source" (the
fork already uses *detach* for skeleton handles — reusing it here would blur two
unrelated concepts).

### 4.10 Letterspacer interaction — the second writer

Letterspacer (F6) also writes sidebearings, so a keyed side has two writers and
needs an arbitration rule.

**How letterspacer writes today** (verified 2026-07-26): its **Apply**
(`panel-letterspacer.js:493` `applySpacing`) does **not** go through the
selection-info margin path at all. It shifts the path directly
(`shiftPath`, `:570`) for the left side and sets `layerGlyph.xAdvance` (`:588`)
for the right, over every editing layer, inside its own
`editGlyphAndRecordChanges`. So without a guard it silently overwrites keyed
margins.

**The flag.** A **font-wide** setting in the **letterspacer panel**, beside the
existing `applyLSB` / `applyRSB` toggles, stored in the letterspacer
`fontra.internal` section at font level (next to `enabled`):

```js
LETTERSPACER_FONT_FIELDS.mayReplaceMetricsKeys   // default: false
```

It lives in the letterspacer panel because it modifies *letterspacer's* behavior
and is a policy you set once for the project; the sidebearings panel is where you
see the consequence, not where you set the rule.

**Semantics:**

| Flag | Letterspacer Apply on a keyed side |
| --- | --- |
| **Restrict** (default) | **Skips that side.** The key and its margin are untouched. The other side still applies normally. |
| **Allow** | **Replaces the variable with a number**: writes its computed margin and **deletes the key** at its effective level. The side becomes plain — no link, no stale marker. |

Allowing is therefore **destructive and font-wide in reach**: one Apply sweep can
wipe links across many glyphs, recoverable only by undo. Hence the default is
restrict, and the label must say what it does — *"Letterspacer may replace
metrics keys with numbers"* — not a vague "override".

**Implementation notes:**

- The guard belongs in `applySpacing`, per side, before the write.
- Skipping is cheap because the code already has a "preserve this side's margin"
  branch: `:590-592` recomputes `xAdvance` to hold the old right margin when LSB
  applies and RSB doesn't. Skipping a keyed right side reuses it verbatim.
  Skipping a keyed left side needs no new machinery — right-side application
  doesn't move the path.
- Deletion (allow case) removes the key at the level the source resolves to
  (§3 cascade): a source override if that's what governs the side, else the
  shared key. Deleting a shared key affects every inheriting source, so it
  happens once per glyph, not once per layer.
- Both branches must be inside letterspacer's existing single
  `editGlyphAndRecordChanges` so Apply stays one undo step.

---

## 5. Applying a margin

Once a key resolves to a number, applying it to a side **is just setting that
sidebearing** — the exact operation the field's existing `setValue` already
performs (`panel-selection-info.js:268-304`). The feature reuses that path; it
does not reimplement margin geometry.

This spec takes no position on how margin-setting works internally, and does not
change margin geometry (no metrics-tool changes, no skeleton-move work — those
are pre-existing concerns unrelated to this feature). The only requirement:
**create, per-glyph Update, and Update-all must all funnel through one
apply-margin call**, so the "how" lives in a single place regardless of what that
place does today.

**Letterspacer is the one exception, and it is not folded in.** Its Apply writes
margins by its own route (`shiftPath` + `xAdvance`, §4.10) and is not being
refactored onto this path — the feature only adds a *guard* to it. Two writers,
one arbitration rule; no shared implementation.

Note: setting the left margin repositions the glyph, which shifts what the right
margin means. When both sides are keyed, apply **left before right** so the
result is deterministic.

---

## 6. Files touched (anticipated)

| File | Change |
| --- | --- |
| `fontra-core/src/fontra-internal-schema.js` | add `SIDEBEARING_KEYS` section constant |
| `fontra-core/src/metrics-keys.js` *(new)* | pure helpers: parse/validate an expression as a key, format for display; mocha-tested (Q5) |
| `views-editor/src/panel-selection-info.js` | two-level key store (glyph customData shared + layer customData override) with effective-key resolution; override / reset-to-shared control (§4.9); display + override marker + staleness style (§4.8); per-glyph Update button; two-press unlink (§4.4); clear-on-number; generalize `_evaluateMetricsExpression` into the shared resolver (§4.7) |
| `views-editor/src/panel-letterspacer.js` | font-wide `mayReplaceMetricsKeys` toggle + field constant; per-side guard in `applySpacing` (§4.10) |
| `views-editor/src/editor.js` | register the **Update all metrics** action (§4.3) — menu entry + shortcut + confirm |
| `fontra-core/assets/lang/en.js` | UI strings (`Update`, unlink tooltip + confirm, `Update all metrics` + confirm, the letterspacer toggle label) |
| `fontra-webcomponents/src/ui-form.js` | number-field display **adornment** for the resolved value + a stale style hook (§4.5, §4.8); today `displayValue` only serves the range slider |

No backend change (customData already persists). The feature is a link layer on
top of the existing margin-setting path — it changes no margin geometry and no
other tool.

---

## 7. Corner cases

| # | Case | Handling |
| --- | --- | --- |
| 1 | Referenced glyph deleted / missing | Keep the key, skip the update — the real margin is left untouched; surface an error state on the field rather than crashing. |
| 2 | Referenced glyph has undefined margin (empty/no outline) | Skip that side's update; real margin untouched. |
| 3 | Self-reference same side (`o`'s left ← `=o`) | No-op identity; guard against writing. |
| 4 | Self-reference opposite side (`o`'s left ← `=o!`) | Legit (symmetry); allow. |
| 5 | Cycle (`a`←`b`, `b`←`a`) | Manual model makes this harmless: each Update resolves once from the referenced glyph's *current* margin, no cascade. Update-all's fixpoint pass (§4.3) stops when nothing changes. No cycle-breaker needed. |
| 6 | Both sides keyed | Apply **left first, then right** (left translates the path and shifts the raw right margin; deterministic order required). |
| 7 | Referenced glyph has no source at this location | `instantiateController` interpolates the referenced glyph at the source's location — already handled by the resolver. |
| 8 | Composite/component glyph | Reuses the existing margin-set path, which already handles components. |
| 9 | Locked glyph / read-only font | Update, Update-all (per glyph) and creation all skip/block. |
| 10 | Plain-number edit, or unlink, on a keyed field | Removes the key **at its level** (shared or override), keeps the number (§4.4). |
| 11 | Expression references several glyphs (`=(a+b)/2`) | Stored verbatim; Update replays it. No dependency tracking needed (no push). |
| 12 | Editing several sources at once, mixed effective keys | Field shows a **mixed** state (as margins already do for multi-source edits); Update/unlink/override act per source on each edited layer. |
| 13 | Override with the **same** expression as the shared key | Harmless redundancy; allowed. "Reset to shared" removes it cleanly. |
| 14 | Unlink the **shared** key while some sources are overridden | Inheriting sources lose the link; overridden sources keep their own key (cascade §4.4). |
| 15 | Override exists but shared key is a plain number (no shared key) | "Reset to shared" reverts the source to a plain number. |
| 16 | Letterspacer Apply on a keyed side, flag restricting (default) | Side skipped, key and margin untouched; the other side still applies (§4.10). |
| 17 | Letterspacer Apply on a keyed side, flag allowing | Margin written, key **deleted** at its effective level; the side becomes a plain number, not a stale key (§4.10, §4.8). |
| 18 | Letterspacer Apply, both sides keyed, flag restricting | Nothing applies. Report it rather than appearing to do nothing. |
| 19 | Letterspacer deletes a **shared** key (flag allowing) | Done once for the glyph, not per layer; every inheriting source loses the link, overridden sources keep their own (cascade §4.4). |

---

## 8. Open questions — decisions made, with justification

**Q0 — Link vs one-shot signal? — RESOLVED (user): `=` prefix.**
`=n` creates a persistent link; a bare `n` keeps the existing one-shot
evaluation. Matches Glyphs/RoboFont, self-documenting, preserves both behaviors.

**Q1 — Store the raw expression, or a parsed `{glyph, side}`?**
→ **Store the raw expression string** (`=`-stripped). Justification: the resolver
already handles full expressions; storing the string is *less* code than
re-parsing to a single ref, and it transparently supports `=(a+b)/2`. The
prototype stored a parsed ref and was thereby limited to single-glyph links.

**Q2 — Per glyph or per source? — RESOLVED (user): both, as a cascade.**
Default is a **glyph-wide shared** key (glyph customData); an opt-in **source
override** (layer customData) shadows it for one source (§3, §4.9). The resolver
evaluates the *effective* key per source at that source's location. This is the
fork's own contour-default → per-point-override idiom applied to metrics.

**Q3 — Terminology.**
→ Internally call them **metrics keys** (industry-standard, matches Glyphs/
RoboFont, unambiguous); keep user-facing copy plain ("Update"). Justification:
"variable" collides with Fontra's variable-glyph/axis vocabulary and would
confuse. The section constant stays `sidebearingKeys`. Open to the user's
preference on any visible label.

**Q4 — Controls? — RESOLVED (user).** All manual: per-glyph **Update** (single
press, idempotent); **Unlink** (two-press, §4.4); **Update all metrics**
(two-press, §4.3); **Override for this source / Reset to shared** (§4.9). No
automatic push. "Update all" is an editor action (menu/shortcut); the rest live
on the field/row.

**Q5 — Extract parse/format helpers into core (mocha-tested) or keep in the panel?**
→ **Extract** `parseMetricsKey` (handles the `=` prefix, `!`, glyph-map
validation) and `formatMetricsKeyDisplay` into a small core module with tests.
Justification: `views-editor` has no harness (rail R-G); this parse logic is
exactly what regresses silently. (No `stripDisplaySuffix` needed — the adornment
approach in Q7 removes the strip-on-read problem entirely.)

**Q6 — Mark a stale key? — RESOLVED (user): yes, required (§4.8).**
When a referenced sidebearing has changed but Update hasn't run, the field is
styled stale. It comes cheap: the live resolve done for display, compared against
the applied margin, *is* the staleness test — no watcher, no extra machinery.

**Q7 — Display the resolved value as an adornment or as a replacement string?**
→ **Adornment** (expression stays the editable value; number shown beside it),
not the prototype's baked-in `n (80)` string. Justification: an editable field
should not carry non-editable content that must be regex-stripped on every read
(`stripDisplaySuffix`) — that is a latent parse-bug surface. Confirmed cost
either way: `ui-form`'s `displayValue` currently serves only the range slider
(`ui-form.js:511`), so the `edit-number-x-y` field needs a small addition
regardless; adornment is the cleaner shape.

**Q8 — May letterspacer overwrite a keyed sidebearing? — RESOLVED (user):
opt-in, and it replaces the variable with a number (§4.10).**
A **font-wide flag in the letterspacer panel**, default **restrict**. When
allowed, letterspacer writes its computed margin and **deletes the key** — it
does not leave a stale link. Justification: the two states stay single-cause and
legible — stale always means *the referenced glyph moved* (§4.8), never *another
tool wrote here*. The flag is font-wide rather than per-glyph or per-side because
it is a property of letterspacer's behavior, set once for the project.

**Q9 — Is a separate "realize to number" button needed? — RESOLVED (user): no.**
The **Unlink** button (§4.4) already is it: two-press, drops the key, keeps the
number. Kept under that name; not renamed, and not split into unlink-vs-realize
variants. A stale field therefore bakes the number currently applied, which is
the value the user can see.

**Q10 — Is `VariableGlyph.customData` the right home for the shared key? —
RESOLVED (verified against the tree, §3).** Yes: upstream field, round-trips
through both backends, survives glyph copy, already written by letterspacer in
this fork, and the only per-glyph-not-per-source location the format offers.

---

## 9. Out of scope (explicit)

- Automatic push propagation (editing `n` rewriting `o`). Rejected by the user.
- A font-level named-variable table (a third shared entity). The reference model
  achieves the same visible result with less machinery.
- Kerning-value keys — this spec is sidebearings only.
- Any change to margin geometry, the metrics tool, or skeleton-move behavior —
  pre-existing concerns, not part of this link layer.
- Refactoring letterspacer onto a shared apply-margin path. The feature adds a
  guard to `applySpacing` (§4.10) and nothing more; letterspacer keeps writing
  margins its own way.

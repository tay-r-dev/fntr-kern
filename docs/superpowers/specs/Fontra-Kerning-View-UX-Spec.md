# Fontra kerning view — UX specification

Version: 1.0  
Date: 2026-09-08  
Basis: 33 user audit findings and the subsequent clarifications in this conversation.  
Status: agreed user-facing direction, with explicitly identified implementation investigations and open interaction details.

## 1. Purpose and scope

Make the kerning view predictable for reviewing class kerning, exposing individual class members, creating pair exceptions, reviewing autokern suggestions, and applying changes to deliberately selected results.

This specification describes the intended interface and observable behavior. It is not a description of what the existing code already implements. The supplied source files cover only part of the feature. Missing supporting code must not be treated as evidence that a capability is absent.

The original audit numbers are retained as `F01`–`F33`. Each has exactly one primary requirement below. Cross-references connect related behavior without creating additional audit findings.

Normative words:

- **Must**: agreed behavior or a direct consequence needed to make it consistent.
- **Recommended detail**: an implementation-ready UX proposal that has not been individually confirmed.
- **Open decision**: behavior the discussion has not settled.
- **Autokern investigation**: inspect the calculation/invalidation code before specifying the mechanism; do not infer it from the UI.

## 2. Core concepts

| Concept | Meaning in this view |
| --- | --- |
| Class membership | A glyph's membership on a particular kerning side. Creating a pair exception does not change membership. |
| Class rule | One stored kerning rule addressed to a class on one or both sides. |
| Unique | A glyph without a relevant class on the side being considered. |
| Exposed class member | A grouped glyph deliberately shown individually. Exposure alone creates no kerning rule. |
| Pair exception | An explicit glyph–glyph rule that takes precedence over applicable class kerning for that exact pair. |
| Current | The effective saved kerning value for a pair, or the saved rule value for a class-summary row. |
| Proposed | An autokern suggestion; displaying it does not save it to the font. |
| Delta | Proposed minus Current. Thresholds use its absolute magnitude. |
| Potential exception | A suggested member-pair value outside the class tolerance. It is a review candidate, not a saved exception. |
| Highlighted row | A row chosen for preview. |
| Ticked row | A row chosen as a target of Apply selected or Reset selected. |
| Hidden result | A result excluded from the normal table through the eye action. Hiding does not delete saved kerning. |
| Stale suggestion | A suggestion no longer reliable following a relevant change. Detection and rerun coverage require investigation. |

### 2.1 Invariants

1. Preview selection, action selection, class membership, and saved exception state are separate concepts.
2. Exposing a member, changing a filter, selecting a row, or changing preview mode must not write kerning.
3. A pair exception replaces the inherited value for that pair; it is not an additional adjustment on top of the class value.
4. Removing an exception deletes that explicit rule and restores inheritance. Writing zero is a different operation.
5. Grouped glyphs are represented by class-summary rows by default. Individual members appear only through deliberate exposure, saved exceptions, or the Potential exceptions view as specified below.
6. Class-summary rows remain available alongside deliberately exposed members, subject to the ordinary filters. Exposing a member must not itself remove its summary.
7. Actions must identify their scope. The same visible pair can be affected by an individual rule or a class rule; membership alone does not identify the winning rule.

## 3. A — Stale results and analytics

Original findings: **1, 2, 3, 23**. Count: **4**.

### F01 — Replace status filtering with a stale-glyph section

- Remove the current/applied/stale filter from the results controls.
- Add a **Stale glyphs** section in the right panel, showing affected glyphs, their count, and a rerun action.
- Stale glyphs must not disappear into a table-only status category. Their affected table rows use the warning presentation in F23.
- Recommended detail: show an explicit empty state when nothing requires recalculation.
- **Autokern investigation:** establish which changes make suggestions stale and how that state is persisted and cleared. Do not invent invalidation rules in the interface layer.

Acceptance: the removed filter is absent; stale glyphs are discoverable in the right panel even when the current table filters hide their pairs.

### F02 — Rerun stale glyphs only

- The stale section provides **Re-run stale glyphs**.
- The action requests a run restricted to the stale-glyph scope, rather than an unrestricted run.
- Show progress and the scope being processed. On completion, refresh affected results and the stale list.
- A failed or cancelled run must not label unprocessed results fresh.
- **Autokern investigation:** determine the necessary pair coverage when one glyph is stale, treatment of its class relationships, and how partial completion is tracked. “Stale glyphs only” does not by itself define the pair-generation algorithm.

Acceptance: the user can initiate a scoped rerun from the stale section and see which work remains if it does not complete.

### F03 — Add useful analytics

- Add an **Analytics** section to the right panel.
- Recommended initial contents: stale glyphs, saved pair exceptions, potential exceptions, and hidden results.
- Label each metric's scope, including whether it represents the active source, all available results, or filtered results. Avoid mixing glyph counts with pair counts under an ambiguous total.
- Recommended detail: activate a metric to reveal its corresponding section or table view where such navigation exists.
- **Open decision:** final metric selection. Do not present an invented quality score or unsupported confidence statistic.

Acceptance: each implemented metric has an understandable meaning and scope; the section is useful without requiring knowledge of the algorithm.

### F23 — Mark stale proposed values

- A row with an unreliable suggestion shows **`!`** in place of its Proposed number.
- Provide the explanation **Suggestion out of date — re-run required**, available by hover and keyboard focus.
- Recommended detail: show Delta as unavailable and disable applying that stale suggestion. Reset to zero remains a separate manual action.
- **Autokern investigation:** determine when a class-summary suggestion becomes stale because of its contributors.

Acceptance: the table does not display an obsolete suggestion as though it were current and reliable.

## 4. B — Selection and actions

Original findings: **4, 20, 24, 25, 33**. Count: **5**.

### F04 — Two independent selection layers

| Interaction | Required result |
| --- | --- |
| Ordinary row click | Highlight that row alone for preview. |
| Shift-click row | Add or remove that individual row from the highlighted set; never select an intervening range. |
| Check a highlighted row | Check every highlighted row. |
| Uncheck a highlighted row | Uncheck every highlighted row. |
| Check or uncheck an unhighlighted row | Change that row's tick only. |
| Checkbox click | Preserve the highlighted preview selection. |
| Apply selected / Reset selected | Target ticked rows only. |

- Highlighted rows populate pair-mode preview together.
- Highlight and tick styling must be distinguishable.
- Recommended detail: show a checked-row count near bulk actions and disable them when no rows are ticked.
- **Open decision:** how a highlighted class-summary row expands into concrete preview pairs and whether any display limit is needed. Do not silently assume only the class's representative glyph pair is sufficient.

Acceptance: a user can preview three nonadjacent rows, tick a different action set, and apply only to the ticks.

### F20 — Simplify actions and make Reset a double press

- Remove **Reset to current**, **Apply all**, and the manual-value input.
- Keep **Apply selected** and **Reset selected**.
- Reset writes an explicit value of **0**. It does not mean delete exception or restore inheritance.
- First press arms Reset and displays the target count. Second press commits to those same targets.
- Changing targets must cancel the armed state so the second press cannot affect a different set.
- Recommended detail: disarm on another action or leaving the view; use a clear armed label such as **Reset 4 rows to 0 — press again**.
- Apply and Reset must act on each row's represented address: a class-summary row targets its class rule; an individual row targets that pair. Their scope must be visible before execution.

Acceptance: one Reset press writes nothing; a second press with unchanged targets writes zero. Removing an exception remains available through its own control.

### F24 — Deselect

- Provide **Deselect** to clear both highlighted rows and ticks.
- Its scope is selection only.
- Preview falls back according to the input/selection rules in F06 when no highlighted rows remain.

Acceptance: no highlighted or ticked row remains after Deselect.

### F25 — Remove selection from filtered-out rows

- When a row leaves the displayed result set, remove both its highlight and its tick.
- Removing the filter must not restore either selection automatically.
- Update preview and action counts accordingly.
- Recommended detail: apply the same rule to tab changes and hiding a row, preventing actions on invisible selections. Scrolling outside the viewport does not count as filtering a row out.

Acceptance: selecting rows, filtering some away, and applying affects only still-displayed ticked rows.

### F33 — Preserve font-mode selection on right-click

- Right-clicking a font-mode glyph must preserve the current glyph selection.
- The context menu acts on the clicked glyph, including when that glyph is outside the selection.
- Recommended detail: identify the clicked glyph in the menu so its target is unambiguous.

Acceptance: a context action on an unselected glyph does not clear or replace the existing selection.

## 5. C — Inputs and preview layout

Original findings: **6, 7, 8, 22, 27, 28**. Count: **6**.

### F06 — Pair input and pair-preview eligibility

- Remove the exception input and replace it with **Pair**.
- Glyph and Pair inputs together restrict matching results and supply pairs to pair-mode preview.
- Empty Pair input imposes no pair restriction: show all pairs permitted by the other inputs and filters.
- Pair preview is disabled until pairs are available from deliberate input choices or highlighted table rows. An empty Pair input must not automatically send the entire table into preview.
- Pair preview displays pairs matching the left-pane inputs or pairs from highlighted rows.
- Recommended detail: highlighted rows take precedence while any remain; clearing them restores the input-driven preview, if valid pairs are specified.
- **Open decision:** exact parsing of multi-character pair text, including adjacent-pair extraction versus explicit pair tokens. The earlier question was answered in terms of preview scope, not text grammar. Preserve that distinction.

Acceptance: clearing Pair broadens the table without generating an all-results preview; selecting rows still enables pair preview.

### F07 — Explicit pointer-to-input shortcuts

- Ordinary clicks on preview glyphs do not change the Glyph input.
- **Ctrl+Click** replaces the Glyph input with the clicked glyph.
- **Shift+Ctrl+Click** appends the clicked glyph, using comma separation.
- Serialize the glyph using the supported notation in F22.
- Recommended detail: ignore duplicate additions and expose shortcuts in a tooltip or help text.

Acceptance: ordinary preview navigation leaves the input intact; modified clicks replace or extend it as specified.

### F08 — Dedicated preview toolbar and font glyphset selector

- Place Phrase / Pair / Font controls in their own section with an opaque background, outside the drawable preview area.
- Put the font-mode **Glyphset** dropdown in the same section.
- List available added glyphsets and filter displayed font-mode glyphs by the selected set.
- Keep this dropdown visible but disabled outside Font mode.
- The preview glyphset selector and the table glyphset filter in F14 have distinct scopes; neither should silently change the other.

Acceptance: controls do not overlap glyphs, and switching preview modes preserves an understandable, stable toolbar.

### F22 — Input notation and individual class-member exposure

| Notation | Meaning |
| --- | --- |
| `Ä` | Literal character. |
| `/Adieresis` | Explicit glyph name; usable for encoded and non-Unicode glyphs. |
| `@ClassName` | Class name; pair position identifies the relevant kerning side. |
| `%Adieresis%!` | Expose the named glyph's individual pair values outside the class-summary representation. |

- Use the notation consistently in Glyph and Pair inputs.
- Grouped glyphs are not shown individually in the default results table.
- `%glyphname%!` exposes requested individual members without removing class membership or writing exceptions.
- Add **Show individual class members**, off by default, for broad exposure without entering each member explicitly.
- Keep class-summary rows alongside exposed members, subject to the ordinary filters.
- Non-Unicode glyphs form a separate inclusion category, unchecked by default (F09). Slash syntax itself does not define Unicode status.
- Recommended detail: provide syntax help and an inline error for an unknown name instead of silently producing misleading matches.
- **Open decision:** whether an explicit name request overrides the unchecked Non-Unicode filter. Until decided, do not silently add an override behavior. A consistent recommended default is to retain the filter and explain why the named glyph is excluded.

Acceptance: exposing `Adieresis` reveals its individual rows while retaining its class summaries; no exception exists solely because it was exposed.

### F27 — Restore phrase preview after refresh

- Preserve the entered phrase across page refresh.
- Once the font and preview are ready, render the restored phrase without requiring a text edit.
- Recommended detail: retain the relevant preview mode and scope phrase persistence to the project so another font does not inherit unrelated text unintentionally.

Acceptance: refreshing a populated phrase preview restores visible text automatically.

### F28 — Compact class-assignment controls

- Move **Add selection to group** into the same button row as Left / Right / Both.
- Correct the middle-bottom pane layout so it does not need a vertical scrollbar at supported window sizes.
- Use responsive layout rather than clipping controls or making them unreachable.

Acceptance: class-assignment actions remain visible and operable without scrolling that control pane.

## 6. D — Table structure and filters

Original findings: **5, 9, 11, 13, 14, 16, 18, 32**. Count: **8**.

### F05 — Remove Hide current

- Remove the existing **Hide current** option.
- Column visibility and zero-current suggestion filtering are separate controls defined in F13.

Acceptance: no legacy Hide current control remains.

### F09 — Unicode-types dropdown

- Replace the row of category checkboxes with one multi-select dropdown.
- Include **Uppercase**, **Lowercase**, **Punctuation**, **Symbols**, **Combining diacritics**, and **Non-Unicode glyphs**.
- Non-Unicode glyphs means glyphs with no Unicode assignment; it is unchecked by default.
- Encoded glyphs entered with `/glyphname` retain their Unicode category.
- Accented letters such as `Ä` remain letters; they are not combining marks merely because they contain an accent.
- Do not silently classify an unknown glyph as punctuation or a mark based on appearance.
- **Open decision:** treatment of numbers, uncased letters, and other Unicode categories absent from the requested list; and whether a pair matches when either or both sides have a chosen type. Class-summary matching for mixed-category classes also needs an explicit rule.

Acceptance: the dropdown distinguishes a combining mark, an accented uppercase letter, and an unencoded alternate correctly.

### F11 — Remove buckets

- Remove bucket selection and bucket-based table sections.
- Use a single table per tab, with filters and class-summary rows rather than bucket headings.
- Do not relocate an existing exception into a membership bucket; its identity is shown on its row.

Acceptance: no unique/class bucket selector or bucket heading remains.

### F13 — Separate column visibility from row visibility

- Provide a **Columns** menu with independent visibility controls for Current, Proposed, and Delta.
- Hiding Proposed hides only that column; it does not hide rows or change action targets.
- Provide a separate **Hide zero-current suggestions** option.
- Its exact predicate is `Current == 0 && Proposed != 0`.
- Explain that predicate in helper text. Do not label it “Hide new pairs,” because zero does not establish that a rule is absent.
- Recommended detail: do not apply this predicate to stale/unavailable Proposed values; keep their warning visible unless another filter excludes the row.

Acceptance: hiding Proposed leaves the row count unchanged; enabling the separate filter removes exactly the rows matching its predicate.

### F14 — Main filters

| Filter | Selection | Options and behavior |
| --- | --- | --- |
| Side | Single | All / Left / Right. Narrows which side matches the glyph focus. |
| Unicode types | Multiple | Categories from F09. |
| Class relationship | Multiple | Class-to-class / Class-to-unique / Unique-to-unique / Class exceptions. |
| Glyphset | Single | All by default, plus available glyphsets. Filters table results. |

- Class-to-unique includes both orientations by design; Side provides directional narrowing.
- Multiple choices within a filter combine as alternatives; different filters narrow one another's results.
- Existing exceptions remain distinguishable by color, a textual/icon indicator, and the exception action.
- Keep the table Glyphset filter separate from the Font preview selector.
- **Open decision:** exact glyphset matching for pair rows and mixed-membership class summaries; treatment of zero choices in a multi-select; and how exposed but not-yet-exception members map into relationship filtering. Make these explicit before implementation rather than recreating hidden bucket rules.

Acceptance: selecting Class-to-unique covers both orientations, and the table glyphset defaults to All.

### F16 — Remove sign filtering

- Remove negative/positive filtering.
- Keep the signs on Current, Proposed, and Delta values; magnitude filtering is handled by F18.

Acceptance: there is no sign-filter control.

### F18 — Lower/upper delta bounds and class tolerance

- Retain the lower threshold for absolute Delta and add an upper threshold.
- Recommended labels: **Minimum |Δ|**, **Maximum |Δ|**, and **Class tolerance**.
- Recommended detail: use inclusive bounds; a blank maximum means no maximum. Reject a minimum greater than the maximum with an inline explanation.
- Class tolerance is separate from the delta interval and governs potential-exception eligibility, not column visibility.
- **Autokern investigation:** establish the comparison baseline, treatment of saved exceptions, and precise boundary behavior for class tolerance.

Acceptance: a delta of −20 and +20 are equally eligible under the same magnitude bounds; changing class tolerance changes the candidate review scope independently.

### F32 — Column order and row actions

Use this order:

**Glyph L (name) / Current / Proposed / Delta / Glyph R (name) / Override action / Hide action**

- Class-summary rows show class names in the corresponding glyph columns.
- Exposed members and saved exceptions show individual glyph names.
- Respect the Columns menu without reordering the remaining columns.
- The Potential exceptions tab exposes its create/apply-exception action in the override-action position.
- The Default view provides the lock in that position for eligible exposed members and saved exceptions, as clarified in F12.
- Hover-only controls must also appear on keyboard focus and have accessible action labels.

Acceptance: every row's names, numeric values, and applicable actions align under the same headers.

## 7. E — Exceptions and class suggestions

Original findings: **12, 19, 21**. Count: **3**.

### F12 — Explicit pair-exception control

- Provide a lock for an individual pair with applicable class kerning, including members exposed with `%glyphname%!` or Show individual class members.
- An inherited pair's lock is muted until hover or focus. A saved exception's indicator remains visible.
- Creating an exception saves an explicit glyph–glyph rule while preserving both glyphs' class memberships.
- Creating an exception without changing the number deliberately saves the current effective value. This is an intentional rule change even if appearance is unchanged.
- On a saved exception, the action becomes **Remove exception**. It deletes the explicit rule and restores the applicable inherited value; it does not copy that value into another explicit pair rule.
- Preview kerning adjustments edit an existing pair exception by default. An inherited pair continues to use class editing by default unless the user deliberately creates an exception.
- A class-summary row must not create an arbitrary representative-glyph exception. A concrete pair must be identified first.
- The interface needs accurate winning-rule and fallback information, including explicit zero values. Do not infer exception state solely from nonzero values, class membership, or a historical cache badge.
- Recommended detail: make creation/removal undoable and show the inherited value in a tooltip or row detail.

Acceptance: create `Ä × W = −30` over a −80 class rule; both memberships remain. Later class edits do not change the pair's −30. Removing the exception restores the class value then in effect.

### F19 — Separate Potential exceptions view

- Provide **Default** and **Potential exceptions** tabs immediately above the table.
- Potential exceptions displays individual member pairs whose suggestions fall outside class tolerance.
- Candidate detail rows are excluded from Default in normal class-summary browsing. Existing saved exceptions are included in Default, subject to filters.
- Explicit member exposure is a deliberate way to inspect individual rows in Default, including members that also qualify as candidates; it does not create an exception.
- Candidate status alone must never write font data.
- An apply-exception action must identify the exact pair and proposed value it will save.
- Recommended detail: keep saved exceptions in Default rather than duplicating them as “new exception” candidates. A revised suggestion for a saved exception is an update to that existing rule.
- **Autokern investigation:** current versus proposed class baseline, candidate detection with pre-existing exceptions, and the interaction between candidate detection and aggregate estimation.

Acceptance: a candidate can be inspected without saving it; accepting its proposed pair exception makes it an existing exception visible in Default.

### F21 — Median suggestions for class rows

- Class-to-class and class-to-unique rows show one aggregate Proposed value governed by the median of member-pair suggestions.
- Applying that summary writes the represented class rule, not a series of literal exceptions.
- Existing more-specific exceptions remain separate; the summary must not claim every member now has the aggregate effective value.
- Recommended detail: disclose contributing-pair count and excluded-result count in row details.
- **Autokern investigation:** eligibility of hidden, stale, missing, and candidate member suggestions; outlier handling; rounding; no-valid-contributor behavior; and interaction between tolerance filtering and median computation.
- Do not assert that hiding a result includes or excludes it from calculation until this investigation is resolved.

Acceptance: the summary displays one class proposal and makes its coverage understandable; implementation cannot pass numerical acceptance until the investigation decisions are documented.

## 8. F — Hidden results and visual language

Original findings: **10, 15, 17, 30, 31**. Count: **5**.

### F10 — Eye action for hiding

- Replace Mark junk with an eye button in the row's final action column.
- Reveal it on row hover and keyboard focus.
- Hiding removes the result from normal display without deleting kerning.
- If hiding removes a selected row, clear its selection under F25.
- **Open decision:** whether hiding a class summary hides only that displayed rule or also its member results. Do not silently cascade the action.

Acceptance: hiding a result removes it from normal browsing and leaves saved kerning intact.

### F15 — Distinguish classes, uniques, and exceptions

- Use consistent color coding for classes, uniques, and exceptions.
- Reinforce those distinctions with names, icons, or labels.
- Separate category styling from per-class membership colors so one does not overwrite the other.
- Ensure highlight and tick states remain discernible on every row type.

Acceptance: users can distinguish the three categories without relying exclusively on color.

### F17 — Show hidden

- Rename Show junk to **Show hidden**.
- When enabled, hidden rows reappear with a distinguishable hidden state and an eye action to restore them.
- Restoring visibility does not apply or reset a kerning value.

Acceptance: hide, reveal with Show hidden, and restore form a reversible visibility workflow.

### F30 — Class colors in preview tiles

- Show class-color indicators in both class preview and Font mode.
- Distinguish left-side and right-side memberships when their classes differ.
- Recommended detail: use two small edge indicators with class-name tooltips rather than painting the whole tile ambiguously.

Acceptance: Font mode communicates the same class membership colors as class preview.

### F31 — Remove editor-status tile colors

- Remove editor-status color coding from Font preview tiles.
- Retain class indicators, glyph selection, and necessary interaction states.

Acceptance: editor status does not compete with class colors in Font mode.

## 9. G — Live synchronization

Original finding: **26**. Count: **1**.

### F26 — Refresh table values after preview edits

- Reflect preview kerning changes in the table immediately as edits are reported: update Current, Delta where available, and exception state.
- Class edits update all affected displayed rows, respecting more-specific rules that remain in effect.
- Do not rerun autokern implicitly merely to refresh saved kerning values.
- Preserve selection and scroll position for rows that remain in the result set. Remove selection from rows that cease to match filters.
- Respect the active font/source consistently across the preview, displayed values, and action targets.
- Recommended detail: keep row identity stable during refresh to avoid unnecessary reconstruction that loses interaction state.

Acceptance: editing a pair or class in preview changes the relevant table values without reloading the page or editing the phrase.

## 10. H — Terminology

Original finding: **29**. Count: **1**.

### F29 — Replace “shadow” with clear rule language

“Shadowing” means a more-specific rule takes precedence over a broader one. For example, `Ä × W = −30` takes precedence over `@A × @V = −80` for that pair. The class rule remains available for other pairs.

- Use **Exception**, **Inherited value**, **Class value**, and **Remove exception** in user-facing text.
- Avoid “shadow” in labels and confirmations.
- Use **Potential exceptions** for unsaved candidates and **Pair exception** for a saved individual rule.

Acceptance: the UI explains which value applies without requiring the user to understand implementation terminology.

## 11. End-to-end acceptance scenarios

### 11.1 Review and apply selected proposals

1. Open Default with grouped members represented by class summaries.
2. Click one row, then Shift-click two nonadjacent rows. Exactly those three rows are highlighted; no range is selected.
3. Check one highlighted row. All three are ticked; preview remains unchanged.
4. Filter one row out. Its highlight and tick are removed; preview and action count shrink.
5. Apply selected. Only the two remaining ticked rows are targets, using their displayed rule scopes.

### 11.2 Expose a member and create an exception

1. With class kerning governing `ÄW`, enter `%Adieresis%!` and choose the relevant pair.
2. See the individual member row alongside its class summary.
3. Confirm that exposure alone has created no explicit pair rule.
4. Activate the pair's lock to create an exception at its current value.
5. Adjust the pair in preview. Only that exception changes; Current updates immediately.
6. Remove the exception. The pair inherits the applicable class value again.

### 11.3 Accept an autokern candidate

1. Open Potential exceptions.
2. Inspect a concrete member pair and its suggested value, with class context available.
3. Apply the suggestion explicitly as a pair exception.
4. Verify that the saved exception is available in Default with the correct indicator and effective value.
5. Verify that class memberships are unchanged.

### 11.4 Reset deliberately

1. Tick target rows and press Reset selected once.
2. Verify no values change and the button identifies the armed target count.
3. Change the ticked set. Verify Reset is disarmed.
4. Press twice with unchanged targets. Verify explicit zeros are written to the represented addresses.
5. Verify that zero-valued pair exceptions are still identifiable as exceptions.

### 11.5 Rerun stale work

1. Trigger a change that the investigated invalidation rules identify as stale.
2. See affected glyphs in the right panel and `!` instead of their obsolete proposals.
3. Run Re-run stale glyphs and observe progress.
4. On success, see refreshed proposals and cleared stale state for completed work. On failure or cancellation, unprocessed work remains stale.

### 11.6 Restore and navigate preview

1. Enter a phrase, refresh, and see it rendered without another text edit.
2. Ordinary-click a glyph: the Glyph input stays unchanged.
3. Ctrl+Click another glyph: the input is replaced. Shift+Ctrl+Click a third: it is appended with a comma.
4. In Font mode, select several glyphs and right-click an unselected glyph. Selection persists; the menu targets the clicked glyph.

## 12. Investigations and decisions before implementation

### 12.1 Autokern code investigations — do not assume

| Investigation | Related findings | Required outcome |
| --- | --- | --- |
| Stale-state lifecycle and scoped rerun | F01, F02, F23 | Define invalidating changes, required pair coverage, persistence, partial completion, and aggregate staleness. |
| Class suggestion calculation | F21 | Specify eligible contributors, median/outlier behavior, rounding, and unavailable-result handling. |
| Class tolerance and candidates | F18, F19, F21 | Specify reference value, comparison boundary, interaction with aggregate estimation, and saved-exception treatment. |
| Hidden-result effects on calculation | F10, F17, F21 | Establish whether hiding is display-only for the algorithm or an explicit computation exclusion; reflect the result in UI copy. |

The user-facing controls can be designed before these investigations, but numerical or invalidation behavior must not be invented to fill the gaps.

### 12.2 Remaining interaction decisions

1. Exact Pair-input grammar and class-row expansion into preview pairs (F04, F06, F22).
2. Explicit non-Unicode name requests versus the unchecked inclusion filter (F09, F22).
3. Unicode category coverage, pair-side matching, and mixed-class matching (F09).
4. Glyphset matching, empty multi-select semantics, and exposed-member relationship filtering (F14).
5. Hiding scope for class-summary rows (F10).
6. Final analytics metrics (F03).

Recommended details in this document provide concrete defaults where useful, but these unresolved choices must not be reported as already confirmed.

### 12.3 Necessary integration checks

- Confirm the controller can identify the actual winning rule and the fallback after deletion, including explicit zeros.
- Confirm edits, removal, preview refresh, and displayed values use the same active source.
- Confirm aggregate-row and member-row identity support selection preservation and correct action scope.
- Confirm exception creation/removal and multi-row writes participate in the intended undo behavior.

These are implementation prerequisites, not additional UX audit findings or claims of defects in omitted code.

## 13. Traceability — all 33 original findings

| Original entry | Requirement | Primary section | Subject |
| --- | --- | --- | --- |
| 1 | F01 | A | Replace status filter with stale section |
| 2 | F02 | A | Rerun stale glyphs only |
| 3 | F03 | A | Analytics |
| 4 | F04 | B | Individual Shift-click highlights and ticks |
| 5 | F05 | D | Remove Hide current |
| 6 | F06 | C | Pair input and preview scope |
| 7 | F07 | C | Ctrl-click input shortcuts |
| 8 | F08 | C | Preview toolbar and font glyphset selector |
| 9 | F09 | D | Unicode and non-Unicode dropdown |
| 10 | F10 | F | Eye action |
| 11 | F11 | D | Remove buckets |
| 12 | F12 | E | Pair exception lock and removal |
| 13 | F13 | D | Columns and zero-current suggestion filter |
| 14 | F14 | D | Side, relationship, category, and glyphset filters |
| 15 | F15 | F | Class/unique/exception colors |
| 16 | F16 | D | Remove sign filter |
| 17 | F17 | F | Show hidden |
| 18 | F18 | D | Delta interval and class tolerance |
| 19 | F19 | E | Potential exceptions tab |
| 20 | F20 | B | Removed actions and double-press zero reset |
| 21 | F21 | E | Median class suggestions |
| 22 | F22 | C | Input notation and exposed class members |
| 23 | F23 | A | Stale suggestion warning |
| 24 | F24 | B | Deselect |
| 25 | F25 | B | Clear selection when filtered out |
| 26 | F26 | G | Immediate table refresh |
| 27 | F27 | C | Restore phrase preview |
| 28 | F28 | C | Class-assignment control layout |
| 29 | F29 | H | Explain/replace shadow terminology |
| 30 | F30 | F | Preview tile class colors |
| 31 | F31 | F | Remove editor-status colors |
| 32 | F32 | D | Column order and action positions |
| 33 | F33 | B | Right-click selection preservation |

**Section total: A 4 + B 5 + C 6 + D 8 + E 3 + F 5 + G 1 + H 1 = 33.**

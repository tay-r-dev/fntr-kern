# 05: Merge the Transformation and Skeleton parameters panels

**Status:** ready-for-agent

**Blocked by:** None (can start immediately)

## Today

The editor registers two right-sidebar panels, TransformationPanel and SkeletonParametersPanel, each with its own tab and its own form. The skeleton panel shows its sections only when the selection holds skeleton geometry.

## Target

1. One panel called Selection replaces both tabs.
2. It shows the Transformation panel's current contents, then the skeleton panel's current contents, each in its current layout.
3. The skeleton part keeps its own visibility rule.

## Constraints

- Move, do not rewrite. Keep both form builders; the new panel composes them.
- The two panels' forms rebuild on different events today. Keep each part's own rebuild trigger, or a skeleton edit rebuilds the transform fields and takes the focus from a typed value.
- The Skeleton parameters panel's `formContentsLayoutSignature` in-place update must keep working.

## Done when

- [ ] The right sidebar has one Selection tab where it had two.
- [ ] Every control from both panels works as before.
- [ ] `node --check` passes on every touched file under `views-editor` and `fontra-webcomponents`.
- [ ] `npx prettier --write` has run on every touched file.
- [ ] The user's bundle-watch reports no compile error. Ask them; do not run the bundle.

## Manual matrix

Run in the running app and record each result in the commit message (rail R-G).

| # | Do | Expect |
| - | -- | ------ |
| 1 | Select outline points | Transform part live, skeleton part hidden |
| 2 | Select a skeleton point | Both parts shown |
| 3 | Arrow-key a skeleton width field five times | Focus stays in the field |

**Spec:** docs/superpowers/UI-REFACTOR.md §5.1. **Rails:** docs/superpowers/FEATURE-ARCHITECTURE-MAP.md §2. **Commit** after the ticket, `git add .`.

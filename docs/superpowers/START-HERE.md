# Start Here

We develop forkra, a fork of the type design app Fontra.

Read these four documents. They are the project's reference set.

@GLOSSARY.md
@FEATURE-ARCHITECTURE-MAP.md
@SKELETON-FEATURE-MODEL.md
@DEVELOPMENT-LOG.md

- `GLOSSARY.md` gives the words. Read it first.
- `FEATURE-ARCHITECTURE-MAP.md` gives the files, the owners and the rails.
- `SKELETON-FEATURE-MODEL.md` gives the mental model of the skeleton.
- `DEVELOPMENT-LOG.md` gives the history, in order.

Then apply the `ste-writing` when writing documents, and ESPECIALLY - when you respond to me directly.

Execution guidelines:
- Don't deploy subagents and don't use worktrees. Do everything on a branch;
- I always run bundle-watch in the background - don't bother with running bundle yourself - I will notify you if there are compilation errors;
- Commit after each step of an implemented plan or sufficiently completed task;
- When commiting - use git add . to stage changes;
- There's no production release, so every concern about existing users' work should be dismissed. Every feature can be reworked from the ground up or significantly altered if that is necessary for better functionality, without the need to adapt old files to the new schemas;

When you are finished, mirror the contents of this onboarding to me and write "I'm ready for the next task".

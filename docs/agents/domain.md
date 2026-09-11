# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the
codebase. Layout: **single-context**.

## Before exploring, read these

The reference set lives in `docs/superpowers/`, not in a root `CONTEXT.md`:

- **`GLOSSARY.md`** is the glossary. Read it first. It defines every type-design term and every
  term forkra invented.
- **`FEATURE-ARCHITECTURE-MAP.md`** says where the files are, who owns them, and the rails every
  feature obeys.
- **`FEATURE-MODEL.md`** is the mental model of each feature.
- **`DEVELOPMENT-LOG.md`** holds the faults that came back, the measurements, and the ideas that
  were built and withdrawn. Read the section for the feature you are about to touch.
- **`UI-NOMENCLATURE.md`** names every interface element. Read it before any UI work.

`docs/adr/` does not exist. If one appears, read the records that touch your area. If a file above
is missing, go on without it. Do not flag its absence and do not propose creating it.

## Use the glossary's vocabulary

When your output names a domain concept, use the term as `GLOSSARY.md` defines it. That document
marks several old names dead. Do not revive one. `UI-NOMENCLATURE.md` §13.3 lists five words this
project must stop using two ways.

If a concept you need is missing, that is a signal. Either you are inventing language the project
does not use, or there is a real gap worth recording.

## Flag conflicts

`FEATURE-MODEL.md` §9 and the development log record ideas that were measured and withdrawn. If
your output revives one, say so and give the reason it should reopen. Do not revive it silently.

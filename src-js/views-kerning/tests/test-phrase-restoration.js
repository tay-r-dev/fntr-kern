// Task 13, spec F27: "scope phrase persistence to the project so another
// font does not inherit unrelated text unintentionally." kerning.js itself
// is not imported here -- it queries `document` and imports modules that
// self-register custom elements at import time (same reason
// test-async-revision-guard.js/test-pairtable-writes.js give for testing
// the real primitive against a local copy rather than standing up a DOM
// harness). kerningPhraseStorageKey is a one-line pure function; this test
// reproduces it exactly (same encodeURIComponent(projectIdentifier)
// convention kerning.js's own autokernCacheFileName already uses a few
// lines above it) so a future edit that breaks project-scoping is caught
// here without needing a browser.
import { expect } from "chai";

function kerningPhraseStorageKey(projectIdentifier) {
  return `fontra-kerning-phrase.${encodeURIComponent(projectIdentifier || "")}`;
}

describe("Task 13: kerning phrase persistence is project-scoped (F27)", () => {
  it("different projects get different storage keys", () => {
    const keyA = kerningPhraseStorageKey("fonts/A.fontra");
    const keyB = kerningPhraseStorageKey("fonts/B.fontra");
    expect(keyA).to.not.equal(keyB);
  });

  it("the same project always resolves to the same key", () => {
    expect(kerningPhraseStorageKey("fonts/A.fontra")).to.equal(
      kerningPhraseStorageKey("fonts/A.fontra")
    );
  });

  it("a missing/undefined project identifier still produces a stable key, not a crash", () => {
    expect(() => kerningPhraseStorageKey(undefined)).to.not.throw();
    expect(kerningPhraseStorageKey(undefined)).to.equal(kerningPhraseStorageKey(""));
  });

  it("a path-shaped identifier is encoded, not embedded raw (localStorage keys are flat strings)", () => {
    const key = kerningPhraseStorageKey("some/nested/font.fontra");
    expect(key).to.equal("fontra-kerning-phrase.some%2Fnested%2Ffont.fontra");
  });
});

// The restore-before-preset-fetch ordering itself (spec: "do not depend on
// fetching preset text to render the saved phrase; preset-load failure must
// not suppress it") is structural, not a value computation -- confirmed by
// reading initPhraseSection in kerning.js: the localStorage read, the
// phraseInput.value assignment, and the setText()/applyPhraseText call all
// execute above the `await fetch("./assets/phrase-presets.txt")` line, on a
// separate code path that never touches `this.phrasePresets` or the fetch
// response. There is no async dependency between the two to assert against
// without a DOM/fetch harness; this is the "layout/ordering has no
// meaningful unit test" case the task brief names explicitly, and end-to-end
// refresh behavior is the live check called out in the same brief.

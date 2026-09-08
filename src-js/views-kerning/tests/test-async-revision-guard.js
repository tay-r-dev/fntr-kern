// Task 12, spec F26/§12.3: "reject a stale async read if the active source
// changed mid-flight." This reproduces the exact race
// loadAutokernCacheFromStorage (kerning.js) guards against -- a rapid
// double source switch where the FIRST source's async cache read resolves
// AFTER the second one already started -- using the identical guard
// primitive (isStaleAsyncResult) and the identical call shape kerning.js
// uses, against a fake async reader instead of real OPFS/DOM. kerning.js
// itself is not imported here (it queries `document`, and this project's
// existing tests -- test-pair-exceptions.js, test-pairtable-writes.js --
// establish the convention of testing the real controller-level mechanism
// directly rather than standing up a DOM harness for view glue).
import { expect } from "chai";
import { isStaleAsyncResult } from "../src/results-model.js";

// A minimal stand-in for the KerningViewController fields
// loadAutokernCacheFromStorage actually reads/writes:
// this.autokernCacheLoadRevision, this.autokernSource (via
// this._autokernSourceIdentifier), this.autokernCache. `reader` stands in
// for readAutokernCacheFromOPFS -- an async function of (source) so the
// test controls exactly when each call resolves, to force the race.
function makeLoader(reader) {
  const view = {
    autokernCacheLoadRevision: 0,
    _autokernSourceIdentifier: "a",
    autokernCache: null,
    installedSources: [], // records every source whose result was actually installed
  };
  view.loadAutokernCacheFromStorage = async function () {
    const revisionAtStart = ++this.autokernCacheLoadRevision;
    const sourceIdentifierAtStart = this._autokernSourceIdentifier;
    const entries = await reader(sourceIdentifierAtStart);
    if (
      isStaleAsyncResult(
        revisionAtStart,
        this.autokernCacheLoadRevision,
        sourceIdentifierAtStart,
        this._autokernSourceIdentifier
      )
    ) {
      return;
    }
    this.autokernCache = entries;
    this.installedSources.push(sourceIdentifierAtStart);
  };
  return view;
}

describe("Task 12: loadAutokernCacheFromStorage's revision/source guard", () => {
  it("a stale read that resolves AFTER a newer switch has already installed its result is dropped", async () => {
    // Source "a"'s read is deliberately slow; source "b"'s is fast, so "a"
    // resolves LAST even though it started FIRST.
    const resolvers = {};
    const reader = (source) =>
      new Promise((resolve) => {
        resolvers[source] = () => resolve(`entries-for-${source}`);
      });

    const view = makeLoader(reader);

    const firstLoad = view.loadAutokernCacheFromStorage(); // starts for "a"
    view._autokernSourceIdentifier = "b"; // designer switches sources immediately
    const secondLoad = view.loadAutokernCacheFromStorage(); // starts for "b"

    // "b" (the newer, currently-active source) resolves first and installs.
    resolvers["b"]();
    await secondLoad;
    expect(view.autokernCache).to.equal("entries-for-b");
    expect(view.installedSources).to.deep.equal(["b"]);

    // "a"'s slow read finally resolves -- it must NOT clobber "b"'s result,
    // even though "a" is what the user picked first.
    resolvers["a"]();
    await firstLoad;
    expect(view.autokernCache).to.equal("entries-for-b");
    expect(view.installedSources).to.deep.equal(["b"]);
  });

  it("switching away and back to the SAME source before the first read resolves still only installs the latest call's result", async () => {
    const resolvers = [];
    let callIndex = -1;
    const reader = (source) => {
      const index = ++callIndex;
      return new Promise((resolve) => {
        resolvers[index] = () => resolve(`entries-${index}-for-${source}`);
      });
    };

    const view = makeLoader(reader);

    const firstLoad = view.loadAutokernCacheFromStorage(); // call 0, source "a"
    view._autokernSourceIdentifier = "b";
    const secondLoad = view.loadAutokernCacheFromStorage(); // call 1, source "b"
    view._autokernSourceIdentifier = "a";
    const thirdLoad = view.loadAutokernCacheFromStorage(); // call 2, source "a" again

    // Resolve out of order: call 0 (earliest, now superseded twice) last.
    resolvers[2]();
    await thirdLoad;
    resolvers[1]();
    await secondLoad;
    resolvers[0]();
    await firstLoad;

    // Only call 2's result (the LAST call started) survives, even though
    // its source ("a") is the same as call 0's -- revision, not source
    // alone, is what decides "latest." Calls 0 and 1 are both superseded
    // and install nothing.
    expect(view.autokernCache).to.equal("entries-2-for-a");
    expect(view.installedSources).to.deep.equal(["a"]);
  });
});

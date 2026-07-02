// Units for the shared OSV "fixed in X" resolver used by dependency-scan and lockfile-drift. Own file so
// concurrent analyzer PRs don't collide. Runs against the compiled dist/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareNumericVersion, fixedOf } from "../dist/analyzers/osv-fixed.js";

test("compareNumericVersion: orders dotted-numeric releases, null when incomparable", () => {
  assert.equal(compareNumericVersion("2.0.0", "2.3.0"), -1);
  assert.equal(compareNumericVersion("2.3.0", "2.0.0"), 1);
  assert.equal(compareNumericVersion("2.0.0", "2.0.0"), 0);
  assert.equal(compareNumericVersion("2", "2.0.0"), 0); // shorter is zero-padded
  assert.equal(compareNumericVersion("1.10.0", "1.9.0"), 1); // numeric, not lexicographic (10 > 9)
  assert.equal(compareNumericVersion("v2.0.0", "2.1.0"), -1); // a leading v is tolerated
  assert.equal(compareNumericVersion("2.0.0-rc1", "2.0.0"), null); // prerelease → incomparable
  assert.equal(compareNumericVersion("1.0", "abc"), null); // non-numeric → incomparable
});

test("fixedOf: reports the fix for the range containing the queried version (CVE patched per major)", () => {
  // Fixed in 1.5.0 for the 0.x–1.x line AND 2.3.0 for the 2.x line, as two affected entries.
  const vuln = {
    id: "GHSA-multi",
    affected: [
      { ranges: [{ events: [{ introduced: "0" }, { fixed: "1.5.0" }] }] },
      { ranges: [{ events: [{ introduced: "2.0.0" }, { fixed: "2.3.0" }] }] },
    ],
  };
  assert.equal(fixedOf(vuln, "2.0.0"), "2.3.0"); // 2.x line → 2.3.0, NOT the first fix 1.5.0
  assert.equal(fixedOf(vuln, "1.2.0"), "1.5.0"); // 1.x line → 1.5.0
  assert.equal(fixedOf(vuln, "3.0.0"), null); // above every fixed segment → no applicable fix here

  // The same segments expressed as one range with alternating introduced/fixed events resolve identically.
  const oneRange = { id: "GHSA-seg", affected: [{ ranges: [{ events: [{ introduced: "0" }, { fixed: "1.5.0" }, { introduced: "2.0.0" }, { fixed: "2.3.0" }] }] }] };
  assert.equal(fixedOf(oneRange, "2.0.0"), "2.3.0");
});

test("fixedOf: falls back to a single unambiguous fix (else null) when no version match", () => {
  const single = { id: "GHSA-1", affected: [{ ranges: [{ events: [{ introduced: "0" }, { fixed: "1.5.0" }] }] }] };
  assert.equal(fixedOf(single), "1.5.0"); // no queried version → the single distinct fix
  assert.equal(fixedOf(single, "0.0.0-rc"), "1.5.0"); // incomparable version → fall back to the single fix
  const multi = { id: "GHSA-2", affected: [{ ranges: [{ events: [{ fixed: "1.5.0" }] }] }, { ranges: [{ events: [{ fixed: "2.3.0" }] }] }] };
  assert.equal(fixedOf(multi), null); // ambiguous, no version to disambiguate → null (never a wrong version)
  assert.equal(fixedOf({ id: "GHSA-3" }), null); // no affected data → null
});

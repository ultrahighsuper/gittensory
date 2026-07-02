// Shared OSV "fixed in X" remediation-version resolver for the dependency-scan and lockfile-drift analyzers
// (deduped from two identical copies). Given a CVE's OSV `affected` ranges and the queried dependency version,
// it reports the version that closes the vulnerable range CONTAINING that version — so a CVE patched separately
// per major (fixed in 1.5.0 for the 1.x line AND 2.3.0 for the 2.x line) tells a 2.x user to upgrade to 2.3.0,
// not 1.5.0. When the versions are not cleanly comparable (prerelease/non-numeric) or no range matches, it falls
// back to reporting a fix only when it is UNAMBIGUOUS (a single distinct `fixed` across all ranges), else null —
// so it never names a version that does not fix the queried line.

interface OsvEvent {
  introduced?: string;
  fixed?: string;
}
export interface OsvAffected {
  ranges?: Array<{ events?: Array<OsvEvent> }>;
}

/** Compare two dotted-numeric versions (e.g. `2.0.0` vs `2.3.0`) segment by segment. Returns -1/0/1, or null
 *  when either side is not a clean dotted-numeric release (a leading `v` is tolerated; prerelease/build/other
 *  text makes it incomparable). Callers treat null as "incomparable" and fall back, so a version is never
 *  mis-ordered by this heuristic. */
export function compareNumericVersion(a: string, b: string): number | null {
  const pa = parseNumericVersion(a);
  const pb = parseNumericVersion(b);
  if (pa === null || pb === null) return null;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

function parseNumericVersion(version: string): number[] | null {
  const core = version.trim().replace(/^v/i, "");
  if (!/^\d+(\.\d+)*$/.test(core)) return null;
  return core.split(".").map(Number);
}

/** The `fixed` version that closes the `[introduced, fixed)` segment CONTAINING `version`, walking each range's
 *  ordered events (OSV emits alternating `introduced`/`fixed` events per range). Null when no segment contains
 *  the version or the versions are incomparable. */
function fixedForVersion(affected: OsvAffected[], version: string): string | null {
  for (const entry of affected) {
    for (const range of entry.ranges ?? []) {
      let introduced: string | null = null;
      for (const event of range.events ?? []) {
        if (event.introduced !== undefined) {
          introduced = event.introduced;
        } else if (event.fixed) {
          const atOrAfterIntroduced = introduced === null || isAtLeast(version, introduced);
          if (atOrAfterIntroduced && compareNumericVersion(version, event.fixed) === -1) return event.fixed;
          introduced = null;
        }
      }
    }
  }
  return null;
}

function isAtLeast(version: string, floor: string): boolean {
  const cmp = compareNumericVersion(version, floor);
  return cmp === 0 || cmp === 1;
}

/** Resolve the OSV remediation version to surface as `Cve.fixedIn`. Prefers the fix for the range containing
 *  `queriedVersion`; falls back to a single unambiguous fix (else null) when no version is supplied, the versions
 *  are incomparable, or no range matches — never returning a version that does not fix the queried line. */
export function fixedOf(vuln: { affected?: OsvAffected[] }, queriedVersion?: string): string | null {
  const affected = vuln.affected ?? [];
  if (queriedVersion) {
    const matched = fixedForVersion(affected, queriedVersion);
    if (matched !== null) return matched;
  }
  const fixes = new Set<string>();
  for (const entry of affected) {
    for (const range of entry.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed) fixes.add(event.fixed);
      }
    }
  }
  const list = [...fixes];
  return list.length === 1 ? list[0]! : null;
}

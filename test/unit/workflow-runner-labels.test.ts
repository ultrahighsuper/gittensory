import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Normalize CRLF → LF so the `\n`-anchored job slices below are stable whether the workflow is checked out with
// Unix (CI) or Windows line endings.
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("workflow runner labels", () => {
  it("runs every CI job on GitHub-hosted ubuntu-latest runners, with no self-hosted pool (#2825)", () => {
    const workflow = read(".github/workflows/ci.yml");

    // #2825 moved validation off the self-hosted VPS onto GitHub-hosted runners while the self-hosted review
    // stack is CPU-constrained, so no job's runs-on may target the self-hosted/gittensory pool -- in either the
    // YAML `[self-hosted, gittensory]` array or the JSON `"self-hosted"` fork-aware expression. ("self-hosted"
    // may still appear in an explanatory comment or a path glob, so these assertions match the runs-on forms.)
    expect(workflow).not.toMatch(/runs-on:\s*\[\s*self-hosted/);
    expect(workflow).not.toContain('"self-hosted"');
    expect(workflow).not.toContain("|| 'self-hosted'");
    expect(workflow).not.toContain('"fork-ci"');

    // The single build/test job is still validate-code and the gate still waits on the same required jobs; the
    // per-language jobs stay collapsed into that one install (#2501, #2507).
    expect(workflow).toContain("validate-code:");
    expect(workflow).toContain("needs: [changes, validate-code, security]");
    expect(workflow).not.toContain("\n  lint:\n");
    expect(workflow).not.toContain("\n  test:\n");
    expect(workflow).not.toContain("\n  workers:\n");
    expect(workflow).not.toContain("\n  mcp:\n");
    expect(workflow).not.toContain("\n  rees:\n");
    expect(workflow).not.toContain("\n  ui:\n");

    // Every job -- including the build/test job that used to run on the self-hosted pool -- now runs on ubuntu-latest.
    const jobSlice = (name: string, next: string) =>
      workflow.slice(workflow.indexOf(`\n  ${name}:\n`), workflow.indexOf(`\n  ${next}:\n`));
    expect(jobSlice("changes", "validate-code")).toContain("runs-on: ubuntu-latest");
    expect(jobSlice("validate-code", "security")).toContain("runs-on: ubuntu-latest");
    expect(jobSlice("security", "validate")).toContain("runs-on: ubuntu-latest");
    expect(workflow.slice(workflow.indexOf("\n  validate:\n"))).toContain("runs-on: ubuntu-latest");
  });

  it("runs the scheduled dependency audit on a GitHub-hosted ubuntu-latest runner (#2825)", () => {
    const workflow = read(".github/workflows/audit.yml");

    // #2825 moved the scheduled audit off the self-hosted pool onto a GitHub-hosted runner too.
    expect(workflow).toContain("runs-on: ubuntu-latest");
    expect(workflow).not.toMatch(/runs-on:\s*\[\s*self-hosted/);
  });

  it("cancels a superseded selfhost.yml run instead of letting it run to completion (#2496)", () => {
    const workflow = read(".github/workflows/selfhost.yml");

    // Same push/pr split as ci.yml's own group, for the same reason: distinct main-branch pushes must not
    // cancel each other's validation, only a superseded run on the SAME ref/PR should be cancelled.
    expect(workflow).toContain(
      "group: selfhost-${{ github.ref }}-${{ github.event_name == 'push' && github.sha || 'pr' }}",
    );
    expect(workflow).toContain("cancel-in-progress: true");
    // Must be a literal boolean, not an expression -- ci.yml's own comment documents that an expression here
    // causes GitHub to fail the workflow at startup (startup_failure).
    expect(workflow).not.toMatch(/cancel-in-progress:\s*\$\{\{/);
  });
});

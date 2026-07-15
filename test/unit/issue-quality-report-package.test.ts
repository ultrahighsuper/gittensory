import { describe, expect, it } from "vitest";
import { buildIssueQualityReport } from "../../packages/loopover-engine/src/signals/issue-quality-report";
import type {
  IssueRecord,
  PullRequestRecord,
  RegistryRepoConfig,
  RepositoryRecord,
} from "../../packages/loopover-engine/src/types/predicted-gate-types";

function now(): string {
  return new Date().toISOString();
}

function registryConfig(overrides: Partial<RegistryRepoConfig> = {}): RegistryRepoConfig {
  return {
    repo: "acme/widgets",
    emissionShare: 1,
    issueDiscoveryShare: 0.5,
    labelMultipliers: {},
    maintainerCut: 0,
    raw: {},
    ...overrides,
  };
}

function repo(fullName: string, overrides: Partial<RepositoryRecord> = {}): RepositoryRecord {
  const [owner, name] = fullName.split("/");
  return {
    fullName,
    owner: owner!,
    name: name!,
    installationId: undefined,
    isInstalled: true,
    isRegistered: true,
    isPrivate: false,
    htmlUrl: `https://github.com/${fullName}`,
    defaultBranch: "main",
    registryConfig: registryConfig(),
    ...overrides,
  };
}

function issueDiscoveryRepo(fullName: string): RepositoryRecord {
  return repo(fullName, { registryConfig: registryConfig({ issueDiscoveryShare: 1 }) });
}

function directPrRepo(fullName: string): RepositoryRecord {
  return repo(fullName, { registryConfig: registryConfig({ issueDiscoveryShare: 0 }) });
}

function issue(repoFullName: string, number: number, title: string, overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    repoFullName,
    number,
    title,
    state: "open",
    authorLogin: "reporter",
    authorAssociation: "NONE",
    htmlUrl: `https://github.com/${repoFullName}/issues/${number}`,
    body: "x".repeat(220),
    createdAt: now(),
    updatedAt: now(),
    closedAt: null,
    labels: [],
    linkedPrs: [],
    ...overrides,
  };
}

function pr(repoFullName: string, number: number, overrides: Partial<PullRequestRecord> = {}): PullRequestRecord {
  return {
    repoFullName,
    number,
    title: `PR ${number}`,
    state: "open",
    authorLogin: "contributor",
    authorAssociation: "NONE",
    headSha: "abc",
    headRef: "branch",
    baseRef: "main",
    htmlUrl: `https://github.com/${repoFullName}/pull/${number}`,
    mergedAt: null,
    isDraft: false,
    mergeableState: "clean",
    reviewDecision: null,
    body: "",
    createdAt: now(),
    updatedAt: now(),
    closedAt: null,
    labels: [],
    linkedIssues: [],
    ...overrides,
  };
}

describe("buildIssueQualityReport (#6057 package-local export)", () => {
  it("keeps every fixed call-signature slot and returns ready for a detailed open issue with no linked work", () => {
    const r = issueDiscoveryRepo("acme/ready");
    const report = buildIssueQualityReport(r, [issue(r.fullName, 1, "Actionable")], [], r.fullName);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({
      number: 1,
      status: "ready",
      reasons: expect.arrayContaining(["Issue has enough body detail to evaluate.", "No active PR is linked in cached metadata."]),
    });
    expect(report.repoFullName).toBe("acme/ready");
  });

  it("marks linked open-PR issues do_not_use and downgrades thin bodies to needs_proof", () => {
    const r = issueDiscoveryRepo("acme/linked");
    const withPr = buildIssueQualityReport(
      r,
      [issue(r.fullName, 2, "Already claimed")],
      [pr(r.fullName, 9, { linkedIssues: [2], body: "Fixes #2" })],
      r.fullName,
    );
    expect(withPr.issues[0]?.status).toBe("do_not_use");

    const thin = buildIssueQualityReport(r, [issue(r.fullName, 3, "Thin", { body: "Short." })], [], r.fullName);
    expect(thin.issues[0]?.status).toBe("needs_proof");
  });

  it("accepts a prebuilt CollisionReport in the 6th positional slot and empty bounty/recent-merged arrays", () => {
    const r = directPrRepo("acme/direct");
    const issues = [issue(r.fullName, 4, "Direct lane", { body: "x".repeat(220), labels: ["bug"] })];
    const collisions = {
      repoFullName: r.fullName,
      generatedAt: now(),
      clusters: [],
      summary: { clusterCount: 0, highRiskCount: 0, itemsReviewed: 0 },
    };
    const report = buildIssueQualityReport(r, issues, [], r.fullName, [], collisions, []);
    expect(report.lane.lane).toBe("direct_pr");
    expect(report.issues[0]?.status).toBe("needs_proof");
    expect(report.issues[0]?.warnings.some((w) => /direct-PR first/i.test(w))).toBe(true);
  });

  it("defaults unknown absent bounty list and honors active/completed bounty lifecycle branches", () => {
    const r = issueDiscoveryRepo("acme/bounty");
    const openIssue = issue(r.fullName, 5, "Bountied");
    const active = buildIssueQualityReport(r, [openIssue], [], r.fullName, [
      {
        id: "b1",
        repoFullName: r.fullName,
        issueNumber: 5,
        status: "active",
        discoveredAt: now(),
        updatedAt: now(),
        payload: {},
      },
    ]);
    expect(active.issues[0]?.reasons.some((reason) => /Active bounty/i.test(reason))).toBe(true);

    const completed = buildIssueQualityReport(r, [openIssue], [], r.fullName, [
      {
        id: "b2",
        repoFullName: r.fullName,
        issueNumber: 5,
        status: "completed",
        discoveredAt: now(),
        updatedAt: now(),
        payload: {},
      },
    ]);
    expect(completed.issues[0]?.status).toBe("do_not_use");
  });
});

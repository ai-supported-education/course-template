import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getContentReviewStatus,
  prepareContentReview,
  recordContentReview,
  writeContentReviewAttestation
} from "../src/content-review.js";

describe("author content review", () => {
  it("builds ordered blind and consistency packets without answers", async () => {
    const root = await createWorkspace();
    const prepared = await prepareContentReview(root, "session", "01-02");
    const blind = await readFile(prepared.blindPacketPath, "utf8");
    const consistency = await readFile(prepared.consistencyPacketPath, "utf8");

    expect(blind).toContain("Previous explanation");
    expect(blind).toContain("Current explanation");
    expect(blind).toContain("Next contract");
    expect(blind).not.toContain("Secret rubric");
    expect(blind).not.toContain("acceptance marker");
    expect(blind).toContain("timestamp_ms,latency_ms");
    expect(blind).toContain("capture.pcap");
    expect(blind).toContain("not inlined");
    expect(blind).not.toContain("binary capture marker");
    expect(blind).not.toContain("Java verifier marker");
    expect(blind).not.toContain("custom consistency marker");
    expect(blind).not.toContain("private key marker");
    expect(blind).not.toContain("learner draft");

    expect(consistency).toContain("Secret rubric");
    expect(consistency).toContain("acceptance marker");
    expect(consistency).toContain("Java verifier marker");
    expect(consistency).toContain("custom consistency marker");
    expect(consistency).not.toContain("private key marker");
    expect(consistency).not.toContain("learner draft");
  });

  it("records a structured verdict and invalidates it after content changes", async () => {
    const root = await createWorkspace();
    const reportPath = path.join(root, "report.md");
    await writeFile(reportPath, validReport("PASS"));

    const record = await recordContentReview(
      root,
      "session",
      "01-02",
      "PASS",
      reportPath
    );
    expect(record.verdict).toBe("PASS");
    expect((await getContentReviewStatus(root, "session", "01-02")).current).toBe(
      true
    );
    const attestation = await writeContentReviewAttestation(
      root,
      "session",
      "01-02"
    );
    const publicRecord = JSON.parse(
      await readFile(attestation.path, "utf8")
    ) as Record<string, unknown>;
    expect(publicRecord.verdict).toBe("PASS");
    expect(publicRecord.contentHash).toBe(record.contentHash);
    expect(publicRecord.reportSha256).toMatch(/^[a-f0-9]{64}$/);

    const profilePath = path.join(root, "docs/course-profiles/software.md");
    await writeFile(profilePath, "# Changed software profile\n");
    expect((await getContentReviewStatus(root, "session", "01-02")).current).toBe(
      false
    );
    await expect(
      writeContentReviewAttestation(root, "session", "01-02")
    ).rejects.toThrow("актуальный записанный content-review PASS");
    await writeFile(
      profilePath,
      "# Software profile\nVerify public behavior.\n"
    );

    const readme = path.join(
      root,
      "modules/01-test/sessions/01-02/README.md"
    );
    await writeFile(readme, "# Changed material\n");
    const stale = await getContentReviewStatus(root, "session", "01-02");
    expect(stale.current).toBe(false);
    expect(stale.record?.contentHash).toBe(record.contentHash);
  });

  it("rejects an unstructured or mismatched report", async () => {
    const root = await createWorkspace();
    const reportPath = path.join(root, "report.md");
    await writeFile(reportPath, validReport("NEEDS_REWRITE"));

    await expect(
      recordContentReview(root, "session", "01-02", "PASS", reportPath)
    ).rejects.toThrow("не совпадает");
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "content-review-"));
  const sessions = [
    {
      id: "01-01",
      title: "Previous",
      minutes: 30,
      kind: "observe",
      outcome: "Previous outcome",
      done: "Previous done",
      checks: ["review"],
      evidence: {
        produces: ["previous explanation"],
        verifiedBy: ["agent"]
      },
      requires: [],
      introduces: ["previous-concept"],
      defers: []
    },
    {
      id: "01-02",
      title: "Current",
      minutes: 30,
      kind: "build",
      outcome: "Current outcome",
      done: "Current done",
      checks: ["unit", "review"],
      evidence: {
        produces: ["current artifact"],
        verifiedBy: ["automated", "agent"]
      },
      requires: ["previous-concept"],
      introduces: ["current-concept"],
      defers: ["next-concept"],
      contentReview: {
        consistency: ["teacher-check.txt"]
      }
    },
    {
      id: "01-03",
      title: "Next",
      minutes: 30,
      kind: "build",
      outcome: "Next outcome",
      done: "Next done",
      checks: ["unit"],
      evidence: {
        produces: ["next artifact"],
        verifiedBy: ["automated"]
      },
      requires: ["current-concept"],
      introduces: ["next-concept"],
      defers: []
    }
  ];
  const manifest = {
    version: 1,
    language: "en",
    audience: "Test learner",
    profiles: ["software"],
    assumedConcepts: [],
    estimatedHours: { min: 1, max: 2 },
    sessionPolicy: {
      minMinutes: 30,
      maxMinutes: 60,
      singleActiveSession: true,
      dependencyMode: "linear-by-default",
      startState: "green",
      finishState: "green"
    },
    modules: [
      {
        id: "01",
        slug: "test",
        title: "Test module",
        goal: "Test review packets",
        sessions
      }
    ],
    capstone: {
      id: "capstone",
      title: "Capstone",
      goal: "Capstone",
      sessions: []
    }
  };
  await mkdir(path.join(root, "curriculum"), { recursive: true });
  await mkdir(path.join(root, "docs/course-profiles"), { recursive: true });
  await writeFile(
    path.join(root, "docs/course-profiles/software.md"),
    "# Software profile\nVerify public behavior.\n"
  );
  await writeFile(
    path.join(root, "curriculum/course.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  for (const session of sessions) {
    const directory = path.join(
      root,
      "modules/01-test/sessions",
      session.id
    );
    await mkdir(directory, { recursive: true });
    const label =
      session.id === "01-01"
        ? "Previous explanation"
        : session.id === "01-02"
          ? "Current explanation"
          : "Next explanation";
    await writeFile(path.join(directory, "README.md"), `# ${label}\n`);
    await writeFile(path.join(directory, "rubric.md"), "# Secret rubric\n");
    await writeFile(
      path.join(directory, "exercise.test.tsx"),
      "// acceptance marker\n"
    );
    await writeFile(
      path.join(directory, "answers.json"),
      '{"reason":"learner draft"}\n'
    );
    if (session.id === "01-02") {
      await writeFile(
        path.join(directory, "measurements.csv"),
        "timestamp_ms,latency_ms\n0,12\n"
      );
      await writeFile(
        path.join(directory, "capture.pcap"),
        "binary capture marker"
      );
      await writeFile(
        path.join(directory, "VerifierTest.java"),
        "// Java verifier marker\n"
      );
      await writeFile(
        path.join(directory, "teacher-check.txt"),
        "custom consistency marker\n"
      );
      await writeFile(
        path.join(directory, "private.pem"),
        "private key marker\n"
      );
    }
  }

  return root;
}

function validReport(verdict: "PASS" | "NEEDS_REWRITE"): string {
  return [
    "# Content review",
    "",
    `Verdict: ${verdict}`,
    "",
    "## Learner reconstruction",
    "Understood.",
    "",
    "## Continuity",
    "Connected.",
    "",
    "## Findings",
    "No blockers.",
    "",
    "## Evidence and safety",
    "Evidence is reproducible and scoped.",
    "",
    "## Verdict rationale",
    "Complete."
  ].join("\n");
}

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getRoadmapReviewStatus,
  prepareRoadmapReview,
  recordRoadmapReview,
  writeRoadmapReviewAttestation
} from "../src/roadmap-review.js";

describe("roadmap review v3", () => {
  it("uses separate hashes and requires both independent PASS reports", async () => {
    const root = await createWorkspace();
    const prepared = await prepareRoadmapReview(root);
    expect(prepared.hashes.curriculum).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.hashes.subject).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await readFile(prepared.subjectPacketPath, "utf8")
    ).toContain("Source ledger");

    const curriculumReport = path.join(root, "curriculum-report.md");
    const subjectReport = path.join(root, "subject-report.md");
    await writeFile(curriculumReport, report("curriculum"));
    await writeFile(subjectReport, report("subject"));
    await recordRoadmapReview(root, "curriculum", "PASS", curriculumReport);
    await expect(writeRoadmapReviewAttestation(root)).rejects.toThrow(
      "два актуальных PASS"
    );
    await recordRoadmapReview(root, "subject", "PASS", subjectReport);
    expect((await getRoadmapReviewStatus(root)).current).toBe(true);
    const attestation = await writeRoadmapReviewAttestation(root);
    expect(attestation.value).toMatchObject({
      schemaVersion: 3,
      scope: "roadmap",
      verdict: "PASS",
      reviews: {
        curriculum: { verdict: "PASS" },
        subject: { verdict: "PASS" }
      }
    });

    const ledger = JSON.parse(
      await readFile(path.join(root, "curriculum/source-ledger.json"), "utf8")
    );
    ledger.sources[0].title = "Changed source title";
    await writeFile(
      path.join(root, "curriculum/source-ledger.json"),
      JSON.stringify(ledger)
    );
    const stale = await getRoadmapReviewStatus(root);
    expect(stale.reviews.curriculum.current).toBe(true);
    expect(stale.reviews.subject.current).toBe(false);
  });

  it("seals profiles, course context and toolchain into the subject packet", async () => {
    const root = await createWorkspace();
    const prepared = await prepareRoadmapReview(root);
    const packet = await readFile(prepared.subjectPacketPath, "utf8");

    expect(packet).toContain("## Course profile: software");
    expect(packet).toContain("Profile evidence boundary");
    expect(packet).toContain("## Course context: curriculum/context.md");
    expect(packet).toContain("Version-sensitive course context");
    expect(packet).toContain("### Toolchain: package.json");
    expect(packet).toContain('{"packageManager":"pnpm@10.5.0"}');

    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ packageManager: "pnpm@10.6.0" })
    );
    const changedToolchain = await prepareRoadmapReview(root);
    expect(changedToolchain.hashes.curriculum).toBe(prepared.hashes.curriculum);
    expect(changedToolchain.hashes.subject).not.toBe(prepared.hashes.subject);

    await writeFile(
      path.join(root, "curriculum/context.md"),
      "Version-sensitive course context changed\n"
    );
    const changedContext = await prepareRoadmapReview(root);
    expect(changedContext.hashes.curriculum).not.toBe(prepared.hashes.curriculum);
    expect(changedContext.hashes.subject).not.toBe(changedToolchain.hashes.subject);
  });
});

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "roadmap-review-"));
  const session = path.join(root, "modules/01-sample/sessions/01-01");
  await mkdir(path.join(root, "curriculum"), { recursive: true });
  await mkdir(path.join(root, "docs/course-profiles"), { recursive: true });
  await mkdir(session, { recursive: true });
  await writeFile(path.join(root, "README.md"), "# Course\n");
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ packageManager: "pnpm@10.5.0" })
  );
  await writeFile(
    path.join(root, "curriculum/context.md"),
    "Version-sensitive course context\n"
  );
  await writeFile(
    path.join(root, "docs/course-profiles/software.md"),
    "Profile evidence boundary\n"
  );
  await writeFile(path.join(session, "README.md"), "# Session\n");
  await writeFile(path.join(session, "rubric.md"), "# Rubric\n");
  await writeFile(
    path.join(root, "curriculum/course.json"),
    JSON.stringify({
      version: 1,
      reviewProtocol: "roadmap-subject-novice-consistency-v1",
      language: "ru",
      audience: "Experienced JavaScript developers",
      profiles: ["software"],
      courseContextFiles: ["curriculum/context.md"],
      toolchainFiles: ["package.json"],
      assumedConcepts: [],
      estimatedHours: { min: 1, max: 1 },
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
          slug: "sample",
          title: "Sample",
          goal: "Understand one concept",
          sessions: [
            {
              id: "01-01",
              title: "One",
              minutes: 30,
              kind: "observe",
              outcome: "Observe one",
              done: "Explain one",
              checks: ["review"],
              evidence: { produces: ["explanation"], verifiedBy: ["agent"] },
              requires: [],
              introduces: ["one"],
              defers: []
            }
          ]
        }
      ],
      capstone: { id: "capstone", title: "Capstone", goal: "Apply", sessions: [] }
    })
  );
  await writeFile(
    path.join(root, "curriculum/source-ledger.json"),
    JSON.stringify({
      schemaVersion: 1,
      sources: [
        {
          id: "standard",
          title: "Standard",
          url: "https://example.test/standard",
          kind: "standard",
          checkedAt: "2026-09-07",
          supports: ["one"]
        }
      ]
    })
  );
  return root;
}

function report(stage: "curriculum" | "subject"): string {
  const sections = stage === "curriculum"
    ? [
        "Roadmap reconstruction",
        "Audience and progression",
        "Session sizing",
        "Capstone traceability",
        "Findings",
        "Verdict rationale"
      ]
    : [
        "Coverage map",
        "Accuracy and currentness",
        "Runtime boundaries",
        "Source ledger audit",
        "Findings",
        "Verdict rationale"
      ];
  return ["# Report", "", "Verdict: PASS", "", ...sections.flatMap((section) => [
    `## ${section}`,
    "",
    "No blocking findings."
  ])].join("\n");
}

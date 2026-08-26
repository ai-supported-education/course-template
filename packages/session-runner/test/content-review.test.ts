import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTENT_REVIEW_OPENING_MARKER,
  CONTENT_REVIEW_PROTOCOL,
  formatPreparedContentReview,
  getContentReviewStatus,
  parseContentReviewStage,
  prepareContentReview,
  recordContentReview,
  writeContentReviewAttestation
} from "../src/content-review.js";

describe("author content review", () => {
  it("builds isolated novice and consistency packets without later-text leakage", async () => {
    const root = await createWorkspace();
    const prepared = await prepareContentReview(root, "session", "01-02");
    const novice = await readFile(prepared.novicePacketPath, "utf8");
    const blind = await readFile(prepared.blindPacketPath, "utf8");
    const consistency = await readFile(prepared.consistencyPacketPath, "utf8");
    const cliOutput = formatPreparedContentReview(prepared);

    expect(path.basename(prepared.novicePacketPath)).toBe("00-novice.md");
    expect(cliOutput).toContain("ДВУХ независимых fresh subagents");
    expect(cliOutput).toContain("fork_turns=none");
    expect(cliOutput).toContain("Novice-agent получает и читает только 00-novice.md");
    expect(cliOutput).toContain("consistency-agent не получает novice report");
    expect(cliOutput).toContain("--record novice session 01-02");
    expect(cliOutput).toContain("--record consistency session 01-02");

    expect(novice).toContain("Audience: Test learner");
    expect(novice).toContain("Assumed concepts: (none)");
    expect(novice).toContain("Title: Previous");
    expect(novice).toContain("Outcome: Previous outcome");
    expect(novice).toContain("DONE: Previous done");
    expect(novice).toContain("Module learning arc");
    expect(novice).toContain("Current explanation");
    expect(novice).not.toContain("Root learner welcome");
    expect(novice).not.toContain("Previous explanation");
    expect(novice).not.toContain("Current late explanation");
    expect(novice).not.toContain(CONTENT_REVIEW_OPENING_MARKER);
    expect(novice).not.toContain("Software profile");
    expect(novice).not.toContain("Canonical test audience");
    expect(novice).not.toContain("Secret rubric");
    expect(novice).not.toContain("hidden hint marker");
    expect(novice).not.toContain("reference solution marker");
    expect(novice).not.toContain("quiz data marker");
    expect(novice).not.toContain("learner draft");
    expect(novice).toContain("каждого центрального identifier, API");
    expect(novice).toContain("начальное состояние, событие или действие");
    expect(novice).toContain("не исправляет opening задним числом");
    expect(novice).toContain("необходимый для понимания ведущего примера, — MAJOR");
    expect(novice).toContain("## Reference audit");
    expect(novice).toContain("## Identifier and API audit");

    expect(blind).toContain("Previous explanation");
    expect(blind).toContain("Current explanation");
    expect(blind).toContain("Current late explanation");
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
    expect(blind).not.toContain("hidden hint marker");
    expect(blind).not.toContain("reference solution marker");
    expect(blind).not.toContain("quiz data marker");
    expect(blind).toContain("Canonical test audience");
    expect(blind).toContain("Module learning arc");
    expect(blind).not.toContain("Root learner welcome");
    expect(blind).not.toContain("Root late explanation");
    expect(blind).not.toContain("# Software profile");
    expect(blind).not.toContain("requires=[previous-concept]");
    expect(blind).toContain("Не открывайте `00-novice.md`");
    expect(blind).toContain("novice report");

    expect(consistency).toContain("Secret rubric");
    expect(consistency).toContain("acceptance marker");
    expect(consistency).toContain("Java verifier marker");
    expect(consistency).toContain("custom consistency marker");
    expect(consistency).not.toContain("private key marker");
    expect(consistency).not.toContain("learner draft");
    expect(consistency).not.toContain("hidden hint marker");
    expect(consistency).not.toContain("reference solution marker");
    expect(consistency).toContain("quiz data marker");
    expect(consistency).toContain("Canonical test audience");
    expect(consistency).not.toContain("Root learner welcome");
    expect(consistency).not.toContain("Root late explanation");
    expect(consistency).toContain("01-04 [planned]: Future contract");
    expect(consistency).toContain("Calm learner-facing language contract");
    expect(consistency).toContain("не должны получать или искать novice report");
    expect(consistency).toContain("## Continuity and profiles");
    expect(consistency).not.toContain("## First contact and language");
  });

  it("shows only root, module and target openings for the first course session", async () => {
    const root = await createWorkspace();
    const prepared = await prepareContentReview(root, "session", "01-01");
    const packet = await readFile(prepared.novicePacketPath, "utf8");

    expect(packet.indexOf("Root learner welcome")).toBeLessThan(
      packet.indexOf("Module learning arc")
    );
    expect(packet).toContain("это начало курса");
    expect(packet).toContain("Оцените каждый уровень отдельно");
    expect(packet.indexOf("Module learning arc")).toBeLessThan(
      packet.indexOf("Previous explanation")
    );
    expect(packet).not.toContain("Root late explanation");
    expect(packet).not.toContain("Module late explanation");
    expect(packet).not.toContain("Previous late explanation");
    expect(packet).not.toContain(CONTENT_REVIEW_OPENING_MARKER);
  });

  it("includes the full root overview in both consistency phases for first-course targets", async () => {
    const root = await createWorkspace();
    for (const [scope, id] of [
      ["session", "01-01"],
      ["module", "01"]
    ] as const) {
      const prepared = await prepareContentReview(root, scope, id);
      const blind = await readFile(prepared.blindPacketPath, "utf8");
      const consistency = await readFile(
        prepared.consistencyPacketPath,
        "utf8"
      );

      for (const packet of [blind, consistency]) {
        expect(packet).toContain("## Course overview");
        expect(packet).toContain("Source: README.md");
        expect(packet).toContain("Root learner welcome");
        expect(packet).toContain("Root late explanation");
      }
    }
  });

  it("keeps the root overview absent from later session and module packets", async () => {
    const root = await createTwoModuleWorkspace();
    for (const [scope, id] of [
      ["session", "01-02"],
      ["module", "02"]
    ] as const) {
      const prepared = await prepareContentReview(root, scope, id);
      const blind = await readFile(prepared.blindPacketPath, "utf8");
      const consistency = await readFile(
        prepared.consistencyPacketPath,
        "utf8"
      );

      for (const packet of [blind, consistency]) {
        expect(packet).toContain("Корневой README намеренно не включён");
        expect(packet).not.toContain("Root learner welcome");
        expect(packet).not.toContain("Root late explanation");
      }
    }
  });

  it("shows learner-visible previous summary and relevant openings for a later module", async () => {
    const root = await createTwoModuleWorkspace();
    const prepared = await prepareContentReview(root, "session", "02-01");
    const packet = await readFile(prepared.novicePacketPath, "utf8");

    expect(packet).not.toContain("Root learner welcome");
    expect(packet).toContain("Title: Next");
    expect(packet).toContain("Outcome: Next outcome");
    expect(packet).not.toContain("Next explanation");
    expect(packet.indexOf("Title: Next")).toBeLessThan(
      packet.indexOf("Second module entry")
    );
    expect(packet.indexOf("Second module entry")).toBeLessThan(
      packet.indexOf("Second module target")
    );
  });

  it("uses root only for the first module and includes every published session opening", async () => {
    const firstRoot = await createWorkspace();
    const firstPrepared = await prepareContentReview(firstRoot, "module", "01");
    const firstPacket = await readFile(firstPrepared.novicePacketPath, "utf8");
    expect(firstPacket.indexOf("Root learner welcome")).toBeLessThan(
      firstPacket.indexOf("Module learning arc")
    );
    expect(firstPacket).toContain("Previous explanation");
    expect(firstPacket).toContain("Current explanation");
    expect(firstPacket).toContain("Next explanation");

    const laterRoot = await createTwoModuleWorkspace();
    const laterPrepared = await prepareContentReview(laterRoot, "module", "02");
    const laterPacket = await readFile(laterPrepared.novicePacketPath, "utf8");
    expect(laterPacket).not.toContain("Root learner welcome");
    expect(laterPacket.indexOf("Title: Next")).toBeLessThan(
      laterPacket.indexOf("Second module entry")
    );
    expect(laterPacket.indexOf("Second module entry")).toBeLessThan(
      laterPacket.indexOf("Second module target")
    );
  });

  it("requires separate current PASS records and writes a schema v2 attestation", async () => {
    const root = await createWorkspace();
    const noviceReportPath = path.join(root, "novice-report.md");
    const consistencyReportPath = path.join(root, "consistency-report.md");
    await writeFile(noviceReportPath, validNoviceReport("PASS"));
    await writeFile(consistencyReportPath, validConsistencyReport("PASS"));

    const noviceRecord = await recordContentReview(
      root,
      "novice",
      "session",
      "01-02",
      "PASS",
      noviceReportPath
    );
    expect(noviceRecord.stage).toBe("novice");
    expect(path.basename(noviceRecord.reportPath)).toContain("-novice-");
    let status = await getContentReviewStatus(root, "session", "01-02");
    expect(status.reviews.novice.current).toBe(true);
    expect(status.reviews.consistency.record).toBeNull();
    expect(status.current).toBe(false);
    await expect(
      writeContentReviewAttestation(root, "session", "01-02")
    ).rejects.toThrow("два актуальных content-review PASS");

    const consistencyRecord = await recordContentReview(
      root,
      "consistency",
      "session",
      "01-02",
      "PASS",
      consistencyReportPath
    );
    expect(path.basename(consistencyRecord.reportPath)).toContain(
      "-consistency-"
    );
    expect(consistencyRecord.reportPath).not.toBe(noviceRecord.reportPath);
    status = await getContentReviewStatus(root, "session", "01-02");
    expect(status.current).toBe(true);

    const attestation = await writeContentReviewAttestation(
      root,
      "session",
      "01-02"
    );
    const publicRecord = JSON.parse(
      await readFile(attestation.path, "utf8")
    ) as {
      schemaVersion: number;
      verdict: string;
      contentHash: string;
      protocol: string;
      reviews: Record<"novice" | "consistency", Record<string, string>>;
    };
    expect(publicRecord.schemaVersion).toBe(2);
    expect(publicRecord.verdict).toBe("PASS");
    expect(publicRecord.contentHash).toBe(noviceRecord.contentHash);
    expect(publicRecord.reviews.novice.reviewedAt).toBe(
      noviceRecord.reviewedAt
    );
    expect(publicRecord.reviews.novice.verdict).toBe("PASS");
    expect(publicRecord.reviews.consistency.reviewedAt).toBe(
      consistencyRecord.reviewedAt
    );
    expect(publicRecord.reviews.novice.reportSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(publicRecord.reviews.consistency.reportSha256).toMatch(
      /^[a-f0-9]{64}$/
    );
    expect(publicRecord.protocol).toBe(CONTENT_REVIEW_PROTOCOL);
  });

  it("invalidates both stages after an opening or reviewed contract changes", async () => {
    const root = await createWorkspace();
    await recordBothPasses(root, "session", "01-02");
    expect((await getContentReviewStatus(root, "session", "01-02")).current).toBe(
      true
    );

    const languagePath = path.join(root, "docs/learner-facing-language.md");
    await writeFile(languagePath, "# Changed language contract\n");
    let status = await getContentReviewStatus(root, "session", "01-02");
    expect(status.reviews.novice.current).toBe(false);
    expect(status.reviews.consistency.current).toBe(false);
    await writeFile(
      languagePath,
      "# Learner-facing language\nCalm learner-facing language contract.\n"
    );

    const profilePath = path.join(root, "docs/course-profiles/software.md");
    await writeFile(profilePath, "# Changed software profile\n");
    status = await getContentReviewStatus(root, "session", "01-02");
    expect(status.current).toBe(false);
    await expect(
      writeContentReviewAttestation(root, "session", "01-02")
    ).rejects.toThrow("два актуальных content-review PASS");
    await writeFile(
      profilePath,
      "# Software profile\nVerify public behavior.\n"
    );

    const audiencePath = path.join(root, "curriculum/audience.md");
    await writeFile(audiencePath, "# Changed audience\n");
    expect((await getContentReviewStatus(root, "session", "01-02")).current).toBe(false);
    await writeFile(audiencePath, "# Audience\nCanonical test audience.\n");

    const moduleReadme = path.join(root, "modules/01-test/README.md");
    await writeFile(
      moduleReadme,
      learnerReadme("# Changed module arc", "Changed module late explanation")
    );
    status = await getContentReviewStatus(root, "session", "01-02");
    expect(status.reviews.novice.current).toBe(false);
    expect(status.reviews.consistency.current).toBe(false);
    await writeFile(
      moduleReadme,
      learnerReadme(
        "# Module learning arc\nFrom evidence to diagnosis.",
        "Module late explanation"
      )
    );

    const firstBefore = await prepareContentReview(root, "session", "01-01");
    await writeFile(
      path.join(root, "README.md"),
      learnerReadme("# Changed root entry", "Changed root late explanation")
    );
    const firstAfter = await prepareContentReview(root, "session", "01-01");
    expect(firstAfter.contentHash).not.toBe(firstBefore.contentHash);
    expect((await getContentReviewStatus(root, "session", "01-02")).current).toBe(
      true
    );

    const readme = path.join(
      root,
      "modules/01-test/sessions/01-02/README.md"
    );
    await writeFile(
      readme,
      learnerReadme("# Changed material", "Changed late material")
    );
    const stale = await getContentReviewStatus(root, "session", "01-02");
    expect(stale.current).toBe(false);
    expect(stale.reviews.novice.record?.contentHash).toBe(
      stale.reviews.consistency.record?.contentHash
    );
  });

  it("stales both stages for first session and module when only late root text changes", async () => {
    const root = await createWorkspace();
    await recordBothPasses(root, "session", "01-01");
    await recordBothPasses(root, "module", "01");

    await writeFile(
      path.join(root, "README.md"),
      learnerReadme(
        "# Root learner welcome",
        "Changed root text after the opening marker"
      )
    );

    for (const [scope, id] of [
      ["session", "01-01"],
      ["module", "01"]
    ] as const) {
      const status = await getContentReviewStatus(root, scope, id);
      expect(status.reviews.novice.current).toBe(false);
      expect(status.reviews.consistency.current).toBe(false);
      expect(status.current).toBe(false);
    }
  });

  it("treats legacy state and a public schema v1 file as no current v4 review", async () => {
    const root = await createWorkspace();
    const stateDirectory = path.join(root, ".authoring/content-review");
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(
      path.join(stateDirectory, "state.json"),
      JSON.stringify({
        schemaVersion: 1,
        records: {
          "session:01-02": {
            scope: "session",
            id: "01-02",
            verdict: "PASS",
            contentHash: "legacy",
            reviewedAt: "2026-01-01T00:00:00.000Z",
            reportPath: ".authoring/content-review/reports/legacy.md"
          }
        }
      })
    );
    await mkdir(path.join(root, "curriculum/reviews"), { recursive: true });
    await writeFile(
      path.join(root, "curriculum/reviews/session-01-02.json"),
      JSON.stringify({ schemaVersion: 1, protocol: "first-contact-blind-consistency-v3" })
    );

    const status = await getContentReviewStatus(root, "session", "01-02");
    expect(status.reviews.novice.record).toBeNull();
    expect(status.reviews.consistency.record).toBeNull();
    expect(status.current).toBe(false);
    await expect(
      writeContentReviewAttestation(root, "session", "01-02")
    ).rejects.toThrow("два актуальных content-review PASS");
  });

  it("blocks attestation when either current stage is NEEDS_REWRITE", async () => {
    const root = await createWorkspace();
    const novicePath = path.join(root, "novice.md");
    const consistencyPath = path.join(root, "consistency.md");
    await writeFile(novicePath, validNoviceReport("PASS"));
    await writeFile(consistencyPath, validConsistencyReport("NEEDS_REWRITE"));
    await recordContentReview(root, "novice", "session", "01-02", "PASS", novicePath);
    await recordContentReview(
      root,
      "consistency",
      "session",
      "01-02",
      "NEEDS_REWRITE",
      consistencyPath
    );

    expect((await getContentReviewStatus(root, "session", "01-02")).current).toBe(false);
    await expect(
      writeContentReviewAttestation(root, "session", "01-02")
    ).rejects.toThrow("два актуальных content-review PASS");
  });

  it("shows a planned next contract without claiming the course ended", async () => {
    const root = await createWorkspace();
    const prepared = await prepareContentReview(root, "session", "01-03");
    const blind = await readFile(prepared.blindPacketPath, "utf8");
    const consistency = await readFile(prepared.consistencyPacketPath, "utf8");

    expect(blind).toContain("01-04: Future contract");
    expect(blind).toContain("releaseStatus=planned");
    expect(blind).not.toContain("Это последний шаг курса");
    expect(consistency).toContain("Learner material для planned session ещё не опубликован");
  });

  it("reviews the current published module prefix and shows its planned tail", async () => {
    const root = await createWorkspace();
    const prepared = await prepareContentReview(root, "module", "01");
    const blind = await readFile(prepared.blindPacketPath, "utf8");
    expect(blind).toContain("Current explanation");
    expect(blind).toContain("01-04: Future contract");
    expect(blind).toContain("releaseStatus=planned");
  });

  it("validates novice and consistency report formats independently", async () => {
    const root = await createWorkspace();
    const reportPath = path.join(root, "report.md");
    await writeFile(reportPath, validNoviceReport("NEEDS_REWRITE"));

    await expect(
      recordContentReview(root, "novice", "session", "01-02", "PASS", reportPath)
    ).rejects.toThrow("не совпадает");
    await writeFile(
      reportPath,
      validNoviceReport("PASS").replace(
        "## Reference audit",
        "## Reference notes"
      )
    );
    await expect(
      recordContentReview(root, "novice", "session", "01-02", "PASS", reportPath)
    ).rejects.toThrow("## Reference audit");

    await writeFile(reportPath, validNoviceReport("PASS"));
    await expect(
      recordContentReview(root, "consistency", "session", "01-02", "PASS", reportPath)
    ).rejects.toThrow("## Learner reconstruction");

    await writeFile(
      reportPath,
      validConsistencyReport("PASS").replace(
        "## Continuity and profiles",
        "## Continuity"
      )
    );
    await expect(
      recordContentReview(root, "consistency", "session", "01-02", "PASS", reportPath)
    ).rejects.toThrow("## Continuity and profiles");
  });

  it("rejects missing opening marker in every required learner README", async () => {
    const root = await createWorkspace();
    await writeFile(
      path.join(root, "modules/01-test/sessions/01-02/README.md"),
      "# Current explanation\nNo marker.\n"
    );
    await expect(
      prepareContentReview(root, "session", "01-02")
    ).rejects.toThrow("отсутствует marker <!-- content-review:opening:end -->");

    await writeFile(
      path.join(root, "modules/01-test/sessions/01-02/README.md"),
      `# Current\n${CONTENT_REVIEW_OPENING_MARKER}\nMiddle\n${CONTENT_REVIEW_OPENING_MARKER}\nLate\n`
    );
    await expect(
      prepareContentReview(root, "session", "01-02")
    ).rejects.toThrow("должен встречаться ровно один раз");
  });

  it("requires the canonical learner-facing language contract", async () => {
    const root = await createWorkspace();
    await writeFile(
      path.join(root, "docs/learner-facing-language.md"),
      ""
    );

    await expect(
      prepareContentReview(root, "session", "01-01")
    ).rejects.toThrow("обязательный learner-facing language contract");
  });

  it("parses only canonical review stages", () => {
    expect(parseContentReviewStage("novice")).toBe("novice");
    expect(parseContentReviewStage("consistency")).toBe("consistency");
    expect(() => parseContentReviewStage("first-contact")).toThrow(
      "novice или consistency"
    );
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
    courseContextFiles: ["curriculum/audience.md"],
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
        sessions: [
          ...sessions,
          {
            id: "01-04",
            releaseStatus: "planned",
            title: "Future contract",
            minutes: 30,
            kind: "diagnose",
            outcome: "Diagnose a later case",
            requires: ["next-concept"],
            introduces: ["future-concept"],
            defers: []
          }
        ]
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
    path.join(root, "README.md"),
    learnerReadme("# Root learner welcome", "Root late explanation")
  );
  await writeFile(
    path.join(root, "docs/learner-facing-language.md"),
    "# Learner-facing language\nCalm learner-facing language contract.\n"
  );
  await writeFile(
    path.join(root, "docs/course-profiles/software.md"),
    "# Software profile\nVerify public behavior.\n"
  );
  await writeFile(
    path.join(root, "curriculum/course.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  await writeFile(
    path.join(root, "curriculum/audience.md"),
    "# Audience\nCanonical test audience.\n"
  );
  await mkdir(path.join(root, "modules/01-test"), { recursive: true });
  await writeFile(
    path.join(root, "modules/01-test/README.md"),
    learnerReadme(
      "# Module learning arc\nFrom evidence to diagnosis.",
      "Module late explanation"
    )
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
    await writeFile(
      path.join(directory, "README.md"),
      learnerReadme(`# ${label}`, `${label.replace("explanation", "late explanation")}`)
    );
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
      await writeFile(
        path.join(directory, "hints.md"),
        "hidden hint marker\n"
      );
      await writeFile(
        path.join(directory, "reference-solution.ts"),
        "// reference solution marker\n"
      );
      await writeFile(
        path.join(directory, "quiz.json"),
        '{"marker":"quiz data marker"}\n'
      );
    }
  }

  return root;
}

async function createTwoModuleWorkspace(): Promise<string> {
  const root = await createWorkspace();
  const manifestPath = path.join(root, "curriculum/course.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    modules: Array<{
      id: string;
      slug: string;
      title: string;
      goal: string;
      sessions: Array<Record<string, unknown>>;
    }>;
  };
  manifest.modules[0]!.sessions = manifest.modules[0]!.sessions.filter(
    (session) => session.releaseStatus !== "planned"
  );
  manifest.modules.push({
    id: "02",
    slug: "second",
    title: "Second module",
    goal: "Continue into a later module",
    sessions: [
      {
        id: "02-01",
        title: "Second module target",
        minutes: 30,
        kind: "observe",
        outcome: "Connect the modules",
        done: "The connection is explained",
        checks: ["review"],
        evidence: {
          produces: ["connection explanation"],
          verifiedBy: ["agent"]
        },
        requires: ["next-concept"],
        introduces: ["second-module-concept"],
        defers: []
      }
    ]
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const moduleDirectory = path.join(root, "modules/02-second");
  const sessionDirectory = path.join(moduleDirectory, "sessions/02-01");
  await mkdir(sessionDirectory, { recursive: true });
  await writeFile(
    path.join(moduleDirectory, "README.md"),
    learnerReadme("# Second module entry", "Second module late explanation")
  );
  await writeFile(
    path.join(sessionDirectory, "README.md"),
    learnerReadme("# Second module target", "Second target late explanation")
  );
  await writeFile(path.join(sessionDirectory, "rubric.md"), "# Rubric\n");

  return root;
}

async function recordBothPasses(
  root: string,
  scope: "session" | "module",
  id: string
): Promise<void> {
  const novicePath = path.join(root, "novice-pass.md");
  const consistencyPath = path.join(root, "consistency-pass.md");
  await writeFile(novicePath, validNoviceReport("PASS"));
  await writeFile(consistencyPath, validConsistencyReport("PASS"));
  await recordContentReview(root, "novice", scope, id, "PASS", novicePath);
  await recordContentReview(
    root,
    "consistency",
    scope,
    id,
    "PASS",
    consistencyPath
  );
}

function learnerReadme(opening: string, later: string): string {
  return `${opening.trimEnd()}\n\n${CONTENT_REVIEW_OPENING_MARKER}\n\n${later.trimEnd()}\n`;
}

function validNoviceReport(verdict: "PASS" | "NEEDS_REWRITE"): string {
  return [
    "# Novice content review",
    "",
    `Verdict: ${verdict}`,
    "",
    "## Opening reconstruction",
    "Initial state, event and observation are available.",
    "",
    "## Reference audit",
    "Every reference has an antecedent.",
    "",
    "## Identifier and API audit",
    "Every central identifier is introduced.",
    "",
    "## Findings",
    "No blockers.",
    "",
    "## Verdict rationale",
    "Complete."
  ].join("\n");
}

function validConsistencyReport(verdict: "PASS" | "NEEDS_REWRITE"): string {
  return [
    "# Content review",
    "",
    `Verdict: ${verdict}`,
    "",
    "## Learner reconstruction",
    "Understood.",
    "",
    "## Continuity and profiles",
    "Connected.",
    "",
    "## Evidence and safety",
    "Evidence is reproducible and scoped.",
    "",
    "## Findings",
    "No blockers.",
    "",
    "## Verdict rationale",
    "Complete."
  ].join("\n");
}

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTENT_REVIEW_PROTOCOL,
  formatPreparedContentReview,
  getContentReviewStatus,
  prepareContentReview,
  recordContentReview,
  writeContentReviewAttestation
} from "../src/content-review.js";

describe("author content review", () => {
  it("builds ordered first-contact, blind and consistency packets without leakage", async () => {
    const root = await createWorkspace();
    const prepared = await prepareContentReview(root, "session", "01-02");
    const firstContact = await readFile(
      prepared.firstContactPacketPath,
      "utf8"
    );
    const blind = await readFile(prepared.blindPacketPath, "utf8");
    const consistency = await readFile(prepared.consistencyPacketPath, "utf8");
    const cliOutput = formatPreparedContentReview(prepared);

    expect(path.basename(prepared.firstContactPacketPath)).toBe(
      "00-first-contact.md"
    );
    expect(cliOutput.indexOf("00-first-contact.md")).toBeLessThan(
      cliOutput.indexOf("01-blind.md")
    );
    expect(cliOutput.indexOf("01-blind.md")).toBeLessThan(
      cliOutput.indexOf("02-consistency.md")
    );
    expect(cliOutput).toContain("00 → 01 → 02");

    expect(firstContact).toContain("Module learning arc");
    expect(firstContact).toContain("Previous explanation");
    expect(firstContact).toContain("Current explanation");
    expect(firstContact).not.toContain("Root learner welcome");
    expect(firstContact).toContain(
      "отсутствие course opening в этом packet не является finding"
    );
    expect(firstContact).not.toContain("Test learner");
    expect(firstContact).not.toContain("Software profile");
    expect(firstContact).not.toContain("Canonical test audience");
    expect(firstContact).not.toContain("Secret rubric");
    expect(firstContact).not.toContain("hidden hint marker");
    expect(firstContact).not.toContain("reference solution marker");
    expect(firstContact).not.toContain("quiz data marker");
    expect(firstContact).not.toContain("learner draft");
    expect(firstContact.indexOf("Module learning arc")).toBeLessThan(
      firstContact.indexOf("Previous explanation")
    );
    expect(firstContact.indexOf("Previous explanation")).toBeLessThan(
      firstContact.indexOf("Current explanation")
    );
    expect(firstContact).toContain("остановитесь после первых 2–4 абзацев");
    expect(firstContact).toContain(
      "Оцените раздельно только те уровни входа, которые перечислены в scope note"
    );
    expect(firstContact).toContain(
      "позднее объяснение не исправляет первое впечатление"
    );

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
    expect(blind).not.toContain("hidden hint marker");
    expect(blind).not.toContain("reference solution marker");
    expect(blind).not.toContain("quiz data marker");
    expect(blind).toContain("Canonical test audience");
    expect(blind).toContain("Module learning arc");

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
    expect(consistency).toContain("01-04 [planned]: Future contract");
    expect(consistency).toContain("Calm learner-facing language contract");
    expect(consistency).toContain("## First contact and language");
    expect(consistency).toContain(
      "Раздельно оцените представленные в `00-first-contact.md` уровни входа"
    );
  });

  it("shows root, module and target in order for the first course session", async () => {
    const root = await createWorkspace();
    const prepared = await prepareContentReview(root, "session", "01-01");
    const packet = await readFile(prepared.firstContactPacketPath, "utf8");

    expect(packet.indexOf("Root learner welcome")).toBeLessThan(
      packet.indexOf("Module learning arc")
    );
    expect(packet).toContain("это начало курса");
    expect(packet).toContain("Оцените все три уровня");
    expect(packet.indexOf("Module learning arc")).toBeLessThan(
      packet.indexOf("Previous explanation")
    );
  });

  it("shows module, previous context and target for a later module session", async () => {
    const root = await createTwoModuleWorkspace();
    const prepared = await prepareContentReview(root, "session", "02-01");
    const packet = await readFile(prepared.firstContactPacketPath, "utf8");

    expect(packet).not.toContain("Root learner welcome");
    expect(packet).toContain(
      "отсутствие course opening в этом packet не является finding"
    );
    expect(packet.indexOf("Second module entry")).toBeLessThan(
      packet.indexOf("Next explanation")
    );
    expect(packet.indexOf("Next explanation")).toBeLessThan(
      packet.indexOf("Second module target")
    );
  });

  it("uses root only for the first module and keeps later module continuity", async () => {
    const firstRoot = await createWorkspace();
    const firstPrepared = await prepareContentReview(firstRoot, "module", "01");
    const firstPacket = await readFile(
      firstPrepared.firstContactPacketPath,
      "utf8"
    );
    expect(firstPacket.indexOf("Root learner welcome")).toBeLessThan(
      firstPacket.indexOf("Module learning arc")
    );

    const laterRoot = await createTwoModuleWorkspace();
    const laterPrepared = await prepareContentReview(laterRoot, "module", "02");
    const laterPacket = await readFile(
      laterPrepared.firstContactPacketPath,
      "utf8"
    );
    expect(laterPacket).not.toContain("Root learner welcome");
    expect(laterPacket).toContain(
      "отсутствие course opening в этом packet не является finding"
    );
    expect(laterPacket.indexOf("Next explanation")).toBeLessThan(
      laterPacket.indexOf("Second module entry")
    );
    expect(laterPacket.indexOf("Second module entry")).toBeLessThan(
      laterPacket.indexOf("Second module target")
    );
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
    expect(publicRecord.protocol).toBe(CONTENT_REVIEW_PROTOCOL);

    const languagePath = path.join(root, "docs/learner-facing-language.md");
    await writeFile(languagePath, "# Changed language contract\n");
    expect((await getContentReviewStatus(root, "session", "01-02")).current).toBe(
      false
    );
    await writeFile(
      languagePath,
      "# Learner-facing language\nCalm learner-facing language contract.\n"
    );

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

    const audiencePath = path.join(root, "curriculum/audience.md");
    await writeFile(audiencePath, "# Changed audience\n");
    expect((await getContentReviewStatus(root, "session", "01-02")).current).toBe(
      false
    );
    await writeFile(audiencePath, "# Audience\nCanonical test audience.\n");

    const moduleReadme = path.join(root, "modules/01-test/README.md");
    await writeFile(moduleReadme, "# Changed module arc\n");
    expect((await getContentReviewStatus(root, "session", "01-02")).current).toBe(
      false
    );
    await writeFile(
      moduleReadme,
      "# Module learning arc\nFrom evidence to diagnosis.\n"
    );

    const firstBefore = await prepareContentReview(root, "session", "01-01");
    await writeFile(path.join(root, "README.md"), "# Changed root entry\n");
    const firstAfter = await prepareContentReview(root, "session", "01-01");
    expect(firstAfter.contentHash).not.toBe(firstBefore.contentHash);
    expect((await getContentReviewStatus(root, "session", "01-02")).current).toBe(
      true
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

  it("rejects an unstructured or mismatched report", async () => {
    const root = await createWorkspace();
    const reportPath = path.join(root, "report.md");
    await writeFile(reportPath, validReport("NEEDS_REWRITE"));

    await expect(
      recordContentReview(root, "session", "01-02", "PASS", reportPath)
    ).rejects.toThrow("не совпадает");
  });

  it("requires the exact first-contact report heading", async () => {
    const root = await createWorkspace();
    const reportPath = path.join(root, "report.md");
    await writeFile(
      reportPath,
      validReport("PASS").replace(
        "## First contact and language",
        "## First contact and language notes"
      )
    );

    await expect(
      recordContentReview(root, "session", "01-02", "PASS", reportPath)
    ).rejects.toThrow("## First contact and language");
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
  await writeFile(path.join(root, "README.md"), "# Root learner welcome\n");
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
    "# Module learning arc\nFrom evidence to diagnosis.\n"
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
    "# Second module entry\n"
  );
  await writeFile(
    path.join(sessionDirectory, "README.md"),
    "# Second module target\n"
  );
  await writeFile(path.join(sessionDirectory, "rubric.md"), "# Rubric\n");

  return root;
}

function validReport(verdict: "PASS" | "NEEDS_REWRITE"): string {
  return [
    "# Content review",
    "",
    `Verdict: ${verdict}`,
    "",
    "## First contact and language",
    "The entry is contextual and readable.",
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

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReviewPacket } from "../src/review.js";
import type { CheckRun, FlatSession } from "../src/types.js";

describe("learner solution review packet", () => {
  it("includes profiles and heterogeneous evidence without leaking secrets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "solution-review-"));
    const directory = path.join(root, "modules/01-lab/sessions/01-01");
    await mkdir(directory, { recursive: true });
    await mkdir(path.join(root, "curriculum"), { recursive: true });
    await mkdir(path.join(root, "docs/course-profiles"), { recursive: true });
    await writeFile(
      path.join(root, "docs/course-profiles/lab.md"),
      "# Lab profile\nUse stop conditions.\n"
    );
    await writeFile(
      path.join(root, "curriculum/audience.md"),
      "# Audience\nCan use a terminal but cannot diagnose networks yet.\n"
    );
    await writeFile(
      path.join(root, "curriculum/course.json"),
      `${JSON.stringify(createManifest(), null, 2)}\n`
    );
    await writeFile(path.join(directory, "README.md"), "# Task\nMeasure locally.\n");
    await writeFile(path.join(directory, "rubric.md"), "# Rubric\nCheck evidence.\n");
    await writeFile(path.join(directory, "observations.csv"), "run,value\n1,42\n");
    await writeFile(path.join(directory, "capture.pcap"), "binary payload marker");
    await writeFile(path.join(directory, "private.pem"), "secret payload marker");

    const packet = await buildReviewPacket(root, createSession(), createCheck());

    expect(packet).toContain("Use stop conditions");
    expect(packet).toContain("cannot diagnose networks yet");
    expect(packet).toContain("observations.csv");
    expect(packet).toContain("run,value");
    expect(packet).toContain("capture.pcap");
    expect(packet).toContain("not inlined");
    expect(packet).not.toContain("binary payload marker");
    expect(packet).toContain("private.pem");
    expect(packet).not.toContain("secret payload marker");
    expect(packet).toContain("raw observations and conclusion");
  });
});

function createManifest(): Record<string, unknown> {
  return {
    version: 1,
    language: "en",
    audience: "Lab learner",
    profiles: ["lab"],
    courseContextFiles: ["curriculum/audience.md"],
    assumedConcepts: [],
    estimatedHours: { min: 0.5, max: 0.5 },
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
        slug: "lab",
        title: "Lab",
        goal: "Measure",
        sessions: [createSession().definition]
      }
    ],
    capstone: { id: "capstone", title: "Capstone", goal: "Apply", sessions: [] }
  };
}

function createSession(): FlatSession {
  return {
    index: 0,
    module: {
      id: "01",
      slug: "lab",
      title: "Lab",
      goal: "Measure",
      sessions: []
    },
    isCapstone: false,
    definition: {
      id: "01-01",
      title: "Observation",
      minutes: 30,
      kind: "measure",
      outcome: "Record an observation",
      done: "Evidence is complete",
      checks: ["review"],
      evidence: {
        produces: ["raw observations and conclusion"],
        verifiedBy: ["empirical", "agent"]
      },
      requires: [],
      introduces: ["observation"],
      defers: []
    }
  };
}

function createCheck(): CheckRun {
  return {
    sessionId: "01-01",
    checkedAt: "2026-08-22T00:00:00.000Z",
    contentHash: "test-hash",
    passed: true,
    results: [
      {
        label: "review",
        status: "manual",
        exitCode: null,
        output: "Agent review required."
      }
    ]
  };
}

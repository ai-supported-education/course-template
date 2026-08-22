import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { flattenManifest, loadManifest, validateManifest } from "../src/manifest.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

describe("course manifest", () => {
  it("loads any valid repository curriculum without depending on placeholder ids", async () => {
    const manifest = await loadManifest(workspaceRoot);
    const sessions = flattenManifest(manifest);

    expect(manifest.modules.length).toBeGreaterThan(0);
    expect(sessions.length).toBeGreaterThan(0);
    expect(new Set(sessions.map((session) => session.definition.id)).size).toBe(
      sessions.length
    );
    expect(sessions.every((session) => session.definition.evidence.produces.length > 0)).toBe(
      true
    );
  });

  it("reports invalid duration, kind and duplicate id", () => {
    const problems = validateManifest({
      profiles: [],
      assumedConcepts: [],
      sessionPolicy: { minMinutes: 30, maxMinutes: 60 },
      modules: [
        {
          id: "01",
          slug: "sample",
          sessions: [
            {
              id: "01-01",
              title: "One",
              minutes: 10,
              kind: "unknown",
              outcome: "",
              done: "",
              checks: ["mystery"],
              evidence: {
                produces: ["artifact"],
                verifiedBy: ["automated"]
              },
              requires: ["missing-prerequisite"],
              introduces: ["one"],
              defers: ["never-introduced"]
            },
            {
              id: "01-01",
              title: "Two",
              minutes: 40,
              kind: "build",
              outcome: "Outcome",
              done: "Done",
              checks: ["unit"],
              evidence: {
                produces: ["artifact"],
                verifiedBy: ["automated"]
              },
              requires: ["one"],
              introduces: ["two"],
              defers: []
            }
          ]
        }
      ],
      capstone: { sessions: [] }
    });

    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("minutes"),
        expect.stringContaining("unknown"),
        expect.stringContaining("дублирующийся session id"),
        expect.stringContaining("missing-prerequisite"),
        expect.stringContaining("never-introduced")
      ])
    );
  });

  it("requires deferred concepts to be introduced by a later session", () => {
    const problems = validateManifest({
      profiles: [],
      assumedConcepts: [],
      sessionPolicy: { minMinutes: 30, maxMinutes: 60 },
      modules: [
        {
          id: "01",
          slug: "sample",
          sessions: [
            {
              id: "01-01",
              title: "One",
              minutes: 30,
              kind: "build",
              outcome: "Outcome",
              done: "Done",
              checks: ["unit"],
              evidence: {
                produces: ["artifact-one"],
                verifiedBy: ["automated"]
              },
              requires: [],
              introduces: ["already-known"],
              defers: []
            },
            {
              id: "01-02",
              title: "Two",
              minutes: 30,
              kind: "build",
              outcome: "Outcome",
              done: "Done",
              checks: ["unit"],
              evidence: {
                produces: ["artifact-two"],
                verifiedBy: ["automated"]
              },
              requires: ["already-known"],
              introduces: [],
              defers: ["already-known", "future-concept"]
            },
            {
              id: "01-03",
              title: "Three",
              minutes: 30,
              kind: "build",
              outcome: "Outcome",
              done: "Done",
              checks: ["unit"],
              evidence: {
                produces: ["artifact-three"],
                verifiedBy: ["automated"]
              },
              requires: ["already-known"],
              introduces: ["future-concept"],
              defers: []
            }
          ]
        }
      ],
      capstone: { sessions: [] }
    });

    expect(problems).toContain(
      "01-02: defers содержит already-known, но concept вводится не позже этой сессии"
    );
    expect(problems.some((problem) => problem.includes("future-concept"))).toBe(
      false
    );
  });

  it("keeps evidence, checks and review file roles coherent", () => {
    const problems = validateManifest({
      profiles: ["lab", "lab"],
      assumedConcepts: [],
      sessionPolicy: { minMinutes: 30, maxMinutes: 60 },
      modules: [
        {
          id: "01",
          slug: "sample",
          sessions: [
            {
              id: "01-01",
              title: "One",
              minutes: 30,
              kind: "measure",
              outcome: "Outcome",
              done: "Done",
              checks: ["review"],
              evidence: {
                produces: ["measurements.csv"],
                verifiedBy: ["automated"]
              },
              contentReview: {
                learner: ["../secret.txt", "answers.json", "private.pem", "notes.md"],
                consistency: ["notes.md"]
              },
              requires: [],
              introduces: ["measurement"],
              defers: []
            }
          ]
        }
      ],
      capstone: { sessions: [] }
    });

    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("profiles содержит повторяющиеся"),
        expect.stringContaining("check review должен быть отражён"),
        expect.stringContaining("automated verification требует"),
        expect.stringContaining("небезопасный путь"),
        expect.stringContaining("answers.json нельзя включать"),
        expect.stringContaining("sensitive file private.pem"),
        expect.stringContaining("одновременно указан")
      ])
    );
  });
});

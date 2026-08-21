import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { flattenManifest, loadManifest, validateManifest } from "../src/manifest.js";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

describe("course manifest", () => {
  it("loads the valid template curriculum", async () => {
    const manifest = await loadManifest(workspaceRoot);
    const sessions = flattenManifest(manifest);

    expect(manifest.modules).toHaveLength(1);
    expect(sessions).toHaveLength(1);
    expect(new Set(sessions.map((session) => session.definition.id)).size).toBe(1);
    expect(sessions[0]?.definition.id).toBe("01-01");
  });

  it("reports invalid duration, kind and duplicate id", () => {
    const problems = validateManifest({
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
});

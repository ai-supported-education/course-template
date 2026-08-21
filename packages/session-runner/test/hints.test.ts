import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { revealNextHint } from "../src/hints.js";
import {
  createEmptyProgress,
  loadProgress,
  saveProgress
} from "../src/progress.js";
import type { CourseModule, FlatSession } from "../src/types.js";

const moduleDefinition: CourseModule = {
  id: "01",
  slug: "hints",
  title: "Hints",
  goal: "Hints",
  sessions: []
};

const session: FlatSession = {
  index: 0,
  module: moduleDefinition,
  isCapstone: false,
  definition: {
    id: "01-01",
    title: "Hints",
    minutes: 30,
    kind: "observe",
    outcome: "Outcome",
    done: "Done",
    checks: ["quiz"],
    requires: [],
    introduces: ["progressive-hints"],
    defers: []
  }
};

describe("progressive hints", () => {
  it("reveals only the next level and records it in progress", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "react-training-hints-"));
    await saveProgress(root, {
      ...createEmptyProgress(),
      activeSessionId: "01-01",
      startedAt: "2026-08-18T00:00:00.000Z"
    });

    const loader = async () =>
      JSON.stringify({
        levels: [
          { title: "Concept", body: "Think about snapshots." },
          { title: "Location", body: "Look at the handler." }
        ]
      });

    const first = await revealNextHint(root, [session], loader);
    expect(first.level).toBe(1);
    expect(first.hint.title).toBe("Concept");

    const second = await revealNextHint(root, [session], loader);
    expect(second.level).toBe(2);
    await expect(revealNextHint(root, [session], loader)).rejects.toThrow(
      "Все доступные"
    );
    expect((await loadProgress(root)).revealedHintLevel).toBe(2);
  });
});

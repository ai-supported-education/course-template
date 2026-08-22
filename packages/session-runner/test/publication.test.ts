import { describe, expect, it } from "vitest";
import {
  assertRoadmapSessionIsPublished,
  publishedCompletionLines
} from "../src/publication.js";
import type { FlatRoadmapSession } from "../src/types.js";

describe("publication boundary", () => {
  it("explains that a known planned id is not startable", () => {
    expect(() => assertRoadmapSessionIsPublished(roadmap(), "01-02")).toThrow(
      "есть в roadmap, но ещё не опубликована"
    );
    expect(() => assertRoadmapSessionIsPublished(roadmap(), "01-01")).not.toThrow();
  });

  it("names the first planned contract after the published prefix", () => {
    expect(publishedCompletionLines(roadmap())).toEqual([
      "Все опубликованные материалы завершены.",
      "Следующий пункт roadmap: 01-02 — Planned (ещё не опубликован)."
    ]);
  });

  it("reports full completion when no planned contracts remain", () => {
    expect(publishedCompletionLines([roadmap()[0]!])).toEqual([
      "Курс завершён."
    ]);
  });

  it("distinguishes an all-planned roadmap from completed material", () => {
    expect(publishedCompletionLines([roadmap()[1]!])).toEqual([
      "В курсе пока нет опубликованных сессий.",
      "Следующий пункт roadmap: 01-02 — Planned (ещё не опубликован)."
    ]);
  });
});

function roadmap(): FlatRoadmapSession[] {
  return [
    {
      index: 0,
      module: null,
      isCapstone: false,
      definition: {
        id: "01-01",
        title: "Published",
        minutes: 30,
        kind: "observe",
        outcome: "Outcome",
        done: "Done",
        checks: ["review"],
        evidence: { produces: ["artifact"], verifiedBy: ["agent"] },
        requires: [],
        introduces: ["one"],
        defers: []
      }
    },
    {
      index: 1,
      module: null,
      isCapstone: false,
      definition: {
        id: "01-02",
        releaseStatus: "planned",
        title: "Planned",
        minutes: 30,
        kind: "observe",
        outcome: "Later",
        requires: ["one"],
        introduces: ["two"],
        defers: []
      }
    }
  ];
}

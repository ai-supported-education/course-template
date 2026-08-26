import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatSessionSummary } from "../src/session-output.js";
import type { CourseModule, FlatSession } from "../src/types.js";
import { getSessionDirectory } from "../src/workspace.js";

describe("session output", () => {
  it("shows the course, module and card entry paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "session-output-"));
    const module: CourseModule = {
      id: "01",
      slug: "packets",
      title: "Packets",
      goal: "Trace one packet",
      sessions: []
    };
    const session: FlatSession = {
      index: 0,
      module,
      isCapstone: false,
      definition: {
        id: "01-01",
        title: "First packet",
        minutes: 40,
        kind: "observe",
        outcome: "Explain the packet path",
        done: "The path is explained",
        checks: ["review"],
        evidence: { produces: ["explanation"], verifiedBy: ["agent"] },
        requires: [],
        introduces: ["packet"],
        defers: []
      }
    };
    const cardReadme = path.join(getSessionDirectory(root, session), "README.md");
    await mkdir(path.dirname(cardReadme), { recursive: true });
    await writeFile(cardReadme, "# First packet\n");

    const output = formatSessionSummary(root, session, false);

    expect(output).toContain(`README курса: ${path.join(root, "README.md")}`);
    expect(output).toContain(
      `README главы: ${path.join(root, "modules/01-packets/README.md")}`
    );
    expect(output).toContain(`README карточки: ${cardReadme}`);
    expect(output).not.toContain("ещё не реализован");
  });
});

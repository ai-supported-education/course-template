import { describe, expect, it } from "vitest";
import {
  syncProgressBranch,
  type GitExecutor
} from "../src/course-sync.js";

describe("course sync", () => {
  it("updates master, merges it into the current progress branch and pushes both", async () => {
    const git = createFakeGit({ branch: "progress/anastet" });

    await expect(syncProgressBranch(git)).resolves.toEqual({
      baseBranch: "master",
      progressBranch: "progress/anastet"
    });

    expect(git.calls).toEqual([
      ["status", "--porcelain"],
      ["branch", "--show-current"],
      ["remote", "get-url", "origin"],
      ["remote", "get-url", "upstream"],
      ["fetch", "origin"],
      ["fetch", "upstream"],
      ["show-ref", "--verify", "--quiet", "refs/remotes/origin/progress/anastet"],
      ["merge", "--ff-only", "origin/progress/anastet"],
      ["switch", "master"],
      ["merge", "--ff-only", "origin/master"],
      ["merge", "--ff-only", "upstream/master"],
      ["push", "origin", "master"],
      ["switch", "progress/anastet"],
      ["merge", "--no-edit", "master"],
      ["push", "origin", "progress/anastet"]
    ]);
  });

  it("refuses to switch branches when the learner has uncommitted work", async () => {
    const git = createFakeGit({ status: " M answers.json\n" });

    await expect(syncProgressBranch(git)).rejects.toThrow("чистое рабочее дерево");
    expect(git.calls).toEqual([["status", "--porcelain"]]);
  });

  it("refuses to run from master", async () => {
    const git = createFakeGit({ branch: "master" });

    await expect(syncProgressBranch(git)).rejects.toThrow("progress/<имя>");
    expect(git.calls).toEqual([
      ["status", "--porcelain"],
      ["branch", "--show-current"]
    ]);
  });
});

function createFakeGit({
  branch = "progress/tester",
  status = ""
}: {
  branch?: string;
  status?: string;
} = {}): GitExecutor & { calls: string[][] } {
  const calls: string[][] = [];

  return {
    calls,
    async run(args) {
      calls.push(args);
      if (args[0] === "status") {
        return status;
      }
      if (args[0] === "branch") {
        return `${branch}\n`;
      }
      return "";
    }
  };
}

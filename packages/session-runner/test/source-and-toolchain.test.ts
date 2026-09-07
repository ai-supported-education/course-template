import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadSourceLedger,
  sourceLedgerSupports,
  validateSourceLedger
} from "../src/source-ledger.js";
import {
  hashToolchain,
  loadToolchainDocuments,
  validateToolchainPaths
} from "../src/toolchain.js";

describe("source ledger", () => {
  it("validates primary-source metadata and concept coverage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "source-ledger-"));
    await mkdir(path.join(root, "curriculum"));
    await writeFile(
      path.join(root, "curriculum/source-ledger.json"),
      JSON.stringify({
        schemaVersion: 1,
        sources: [
          {
            id: "ecma-262",
            title: "ECMAScript specification",
            url: "https://tc39.es/ecma262/",
            kind: "standard",
            checkedAt: "2026-09-07",
            supports: ["prototype-chain"]
          }
        ]
      })
    );
    const ledger = await loadSourceLedger(root);
    expect(sourceLedgerSupports(ledger, ["prototype-chain", "proxy"])).toEqual([
      "proxy"
    ]);
  });

  it("rejects non-https, duplicate and empty source contracts", () => {
    expect(
      validateSourceLedger({
        schemaVersion: 2,
        sources: [
          {
            id: "source",
            title: "",
            url: "http://example.test",
            kind: "blog",
            checkedAt: "today",
            supports: []
          },
          {
            id: "source",
            title: "Duplicate",
            url: "https://example.test",
            kind: "other-primary",
            checkedAt: "2026-09-07",
            supports: ["one"]
          }
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("schemaVersion"),
        expect.stringContaining("дублирующийся source id"),
        expect.stringContaining("https URL"),
        expect.stringContaining("неизвестный kind")
      ])
    );
  });
});

describe("toolchain files", () => {
  it("loads safe text files and changes the hash with their contents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "toolchain-"));
    await writeFile(path.join(root, "package.json"), "{}\n");
    const first = await hashToolchain(root, ["package.json"]);
    await writeFile(path.join(root, "package.json"), '{"type":"module"}\n');
    const second = await hashToolchain(root, ["package.json"]);
    expect(first).not.toBe(second);
    await expect(loadToolchainDocuments(root, ["package.json"])).resolves.toEqual([
      { path: "package.json", source: '{"type":"module"}\n' }
    ]);
  });

  it("rejects traversal, credentials and symlink components", async () => {
    expect(validateToolchainPaths(["../package.json", ".npmrc", "secret.json"])).toHaveLength(3);
    const root = await mkdtemp(path.join(os.tmpdir(), "toolchain-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "toolchain-outside-"));
    await writeFile(path.join(outside, "config.json"), "{}\n");
    await symlink(outside, path.join(root, "config"));
    await expect(loadToolchainDocuments(root, ["config/config.json"])).rejects.toThrow(
      "symlink запрещён"
    );
  });
});

import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export interface ToolchainDocument {
  path: string;
  source: string;
}

const allowedExtensions = new Set([
  "",
  ".cjs",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".mts",
  ".cts",
  ".toml",
  ".ts",
  ".txt",
  ".yaml",
  ".yml"
]);
const maxToolchainBytes = 512 * 1024;

export function validateToolchainPaths(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return ["toolchainFiles должен быть массивом путей"];
  }

  const problems: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !isSafeToolchainPath(item)) {
      problems.push(`toolchainFiles содержит небезопасный путь ${String(item)}`);
      continue;
    }
    if (seen.has(item)) {
      problems.push(`toolchainFiles содержит повторяющийся путь ${item}`);
    }
    seen.add(item);
  }
  return problems;
}

export async function loadToolchainDocuments(
  root: string,
  toolchainPaths: string[] = []
): Promise<ToolchainDocument[]> {
  const canonicalRoot = await realpath(root);
  const documents: ToolchainDocument[] = [];

  for (const relativePath of toolchainPaths) {
    if (!isSafeToolchainPath(relativePath)) {
      throw new Error(`Небезопасный toolchain path: ${relativePath}`);
    }
    const absolutePath = path.join(root, ...relativePath.split("/"));
    try {
      await assertNoSymlinkComponents(root, relativePath);
      const canonicalPath = await realpath(absolutePath);
      const relativeCanonical = path.relative(canonicalRoot, canonicalPath);
      if (
        relativeCanonical === ".." ||
        relativeCanonical.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeCanonical)
      ) {
        throw new Error("canonical path выходит за пределы workspace");
      }
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile() || fileStat.size === 0) {
        throw new Error("нужен непустой regular file");
      }
      if (fileStat.size > maxToolchainBytes) {
        throw new Error(`файл больше ${maxToolchainBytes} bytes`);
      }
      const bytes = await readFile(absolutePath);
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (source.includes("\0")) {
        throw new Error("файл содержит NUL и не считается текстовым");
      }
      documents.push({ path: relativePath, source });
    } catch (error) {
      throw new Error(
        `Не удалось прочитать toolchain file ${relativePath}: ${formatError(error)}`
      );
    }
  }

  return documents;
}

export async function hashToolchain(
  root: string,
  toolchainPaths: string[] = []
): Promise<string> {
  const hash = createHash("sha256");
  for (const document of await loadToolchainDocuments(root, toolchainPaths)) {
    hash.update(document.path);
    hash.update("\0");
    hash.update(document.source);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function isSafeToolchainPath(value: string): boolean {
  const segments = value.split("/");
  const basename = path.posix.basename(value).toLowerCase();
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    segments.every(
      (segment) => segment.length > 0 && segment !== "." && segment !== ".."
    ) &&
    !segments.some(isSensitiveSegment) &&
    allowedExtensions.has(path.posix.extname(basename))
  );
}

function isSensitiveSegment(value: string): boolean {
  const name = value.toLowerCase();
  if (name === ".npmrc" || name === ".env" || name.startsWith(".env.")) {
    return true;
  }
  const tokens = name.split(/[-_.]+/).filter(Boolean);
  return tokens.some((token) =>
    new Set([
      "credential",
      "credentials",
      "password",
      "passwords",
      "secret",
      "secrets",
      "token",
      "tokens"
    ]).has(token)
  );
}

async function assertNoSymlinkComponents(
  root: string,
  relativePath: string
): Promise<void> {
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const fileStat = await lstat(current);
    if (fileStat.isSymbolicLink()) {
      throw new Error(`symlink запрещён в toolchain path: ${relativePath}`);
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

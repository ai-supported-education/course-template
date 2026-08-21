import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ignoredNames = new Set(["node_modules", "dist", "coverage", ".DS_Store"]);

export async function hashDirectory(directory: string): Promise<string> {
  const hash = createHash("sha256");
  const files = await listFiles(directory);

  for (const file of files) {
    const relative = path.relative(directory, file);
    hash.update(relative);
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }

  return hash.digest("hex");
}

async function listFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (ignoredNames.has(entry.name)) {
      continue;
    }

    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listFiles(target)));
    } else if (entry.isFile()) {
      result.push(target);
    }
  }

  return result;
}

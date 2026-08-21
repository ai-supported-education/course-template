import { execFile } from "node:child_process";

export const SUPPORT_REF = "course-support";
export const SUPPORT_REFS = [
  `refs/remotes/upstream/${SUPPORT_REF}`,
  `refs/remotes/origin/${SUPPORT_REF}`,
  `refs/heads/${SUPPORT_REF}`
] as const;

export type SupportLoader = (root: string, relativePath: string) => Promise<string>;

export const readSupportFile: SupportLoader = async (root, relativePath) => {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  if (
    normalizedPath.startsWith("/") ||
    normalizedPath.split("/").includes("..")
  ) {
    throw new Error(`Некорректный support path: ${relativePath}`);
  }

  const failures: string[] = [];

  for (const ref of SUPPORT_REFS) {
    try {
      return await readFileFromRef(root, ref, normalizedPath);
    } catch (error) {
      failures.push(formatError(error));
    }
  }

  throw new Error(
    [
      `Не удалось прочитать support/${normalizedPath} из Git ref ${SUPPORT_REF}.`,
      "В fork выполните git fetch upstream; в обычном clone — git fetch origin.",
      ...failures
    ].join("\n")
  );
};

function readFileFromRef(
  root: string,
  ref: string,
  relativePath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", root, "show", `${ref}:support/${relativePath}`],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

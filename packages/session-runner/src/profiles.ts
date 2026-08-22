import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

export interface CourseProfileDocument {
  id: string;
  path: string;
  source: string;
}

export async function loadCourseProfileDocuments(
  root: string,
  profileIds: string[]
): Promise<CourseProfileDocument[]> {
  const documents: CourseProfileDocument[] = [];
  for (const id of profileIds) {
    const candidates = [
      path.join(root, "docs", "course-profiles", `${id}.md`),
      path.join(root, "docs", "stack-profiles", `${id}.md`)
    ];
    const existing: string[] = [];
    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        existing.push(candidate);
      }
    }
    if (existing.length === 0) {
      throw new Error(
        `Для profile ${id} нужен docs/course-profiles/${id}.md или docs/stack-profiles/${id}.md.`
      );
    }
    if (existing.length > 1) {
      throw new Error(
        `Profile ${id} определён одновременно в course-profiles и stack-profiles.`
      );
    }
    const profilePath = existing[0]!;
    documents.push({
      id,
      path: profilePath,
      source: await readFile(profilePath, "utf8")
    });
  }
  return documents;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

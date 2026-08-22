import type { FlatRoadmapSession } from "./types.js";

export function assertRoadmapSessionIsPublished(
  roadmap: FlatRoadmapSession[],
  id: string
): void {
  const session = roadmap.find((candidate) => candidate.definition.id === id);
  if (session?.definition.releaseStatus === "planned") {
    throw new Error(`Сессия ${id} есть в roadmap, но ещё не опубликована.`);
  }
}

export function publishedCompletionLines(
  roadmap: FlatRoadmapSession[]
): string[] {
  const nextPlanned = roadmap.find(
    (session) => session.definition.releaseStatus === "planned"
  );
  if (!nextPlanned) {
    return ["Курс завершён."];
  }
  const hasPublished = roadmap.some(
    (session) => session.definition.releaseStatus !== "planned"
  );
  return [
    hasPublished
      ? "Все опубликованные материалы завершены."
      : "В курсе пока нет опубликованных сессий.",
    `Следующий пункт roadmap: ${nextPlanned.definition.id} — ${nextPlanned.definition.title} (ещё не опубликован).`
  ];
}

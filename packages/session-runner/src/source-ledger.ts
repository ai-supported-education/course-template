import { readFile } from "node:fs/promises";
import path from "node:path";

export const SOURCE_LEDGER_PATH = "curriculum/source-ledger.json" as const;

export interface SourceLedgerEntry {
  id: string;
  title: string;
  url: string;
  kind:
    | "standard"
    | "runtime-documentation"
    | "compatibility-data"
    | "proposal"
    | "security-guidance"
    | "other-primary";
  checkedAt: string;
  supports: string[];
}

export interface SourceLedger {
  schemaVersion: 1;
  sources: SourceLedgerEntry[];
}

export async function loadSourceLedger(root: string): Promise<SourceLedger> {
  const ledgerPath = path.join(root, SOURCE_LEDGER_PATH);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(ledgerPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Не удалось прочитать ${SOURCE_LEDGER_PATH}: ${formatError(error)}`
    );
  }
  const problems = validateSourceLedger(value);
  if (problems.length > 0) {
    throw new Error(`Source ledger не прошёл проверку:\n- ${problems.join("\n- ")}`);
  }
  return value as SourceLedger;
}

export function validateSourceLedger(value: unknown): string[] {
  if (!isRecord(value)) {
    return ["корневое значение должно быть объектом"];
  }
  const problems: string[] = [];
  if (value.schemaVersion !== 1) {
    problems.push("schemaVersion должен быть равен 1");
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    problems.push("sources должен быть непустым массивом");
    return problems;
  }
  const ids = new Set<string>();
  for (const [index, source] of value.sources.entries()) {
    if (!isRecord(source)) {
      problems.push(`sources[${index}] должен быть объектом`);
      continue;
    }
    if (typeof source.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.id)) {
      problems.push(`sources[${index}].id должен быть portable id`);
    } else if (ids.has(source.id)) {
      problems.push(`дублирующийся source id ${source.id}`);
    } else {
      ids.add(source.id);
    }
    if (typeof source.title !== "string" || source.title.trim().length === 0) {
      problems.push(`${String(source.id)}: title обязателен`);
    }
    if (!isHttpsUrl(source.url)) {
      problems.push(`${String(source.id)}: url должен быть абсолютным https URL`);
    }
    if (
      ![
        "standard",
        "runtime-documentation",
        "compatibility-data",
        "proposal",
        "security-guidance",
        "other-primary"
      ].includes(String(source.kind))
    ) {
      problems.push(`${String(source.id)}: неизвестный kind ${String(source.kind)}`);
    }
    if (typeof source.checkedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt)) {
      problems.push(`${String(source.id)}: checkedAt должен быть YYYY-MM-DD`);
    }
    if (
      !Array.isArray(source.supports) ||
      source.supports.length === 0 ||
      !source.supports.every(
        (item) => typeof item === "string" && item.trim().length > 0
      )
    ) {
      problems.push(`${String(source.id)}: supports должен быть непустым массивом concept ids`);
    }
  }
  return problems;
}

export function sourceLedgerSupports(
  ledger: SourceLedger,
  concepts: Iterable<string>
): string[] {
  const supported = new Set(ledger.sources.flatMap((source) => source.supports));
  return [...concepts].filter((concept) => !supported.has(concept));
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

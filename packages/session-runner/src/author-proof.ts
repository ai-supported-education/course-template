import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCheckCommand } from "./checks.js";
import { hashDirectory } from "./content-hash.js";
import { flattenManifest, getSession, loadManifest } from "./manifest.js";
import { readSupportFile, type SupportLoader } from "./support.js";
import { hashToolchain } from "./toolchain.js";
import type { FlatSession, TargetableCheckLabel } from "./types.js";
import { getSessionDirectory } from "./workspace.js";

export interface AuthorProofEvidence {
  schemaVersion: 1;
  sessionId: string;
  checkedAt: string;
  sessionContentHash: string;
  toolchainHash: string;
  definitionHash: string;
  check: TargetableCheckLabel;
  starter: { status: "EXPECTED_FAILURE"; outputSha256: string };
  solution: { status: "PASS"; patchSha256: string; outputSha256: string };
  counterexamples: Array<{
    status: "EXPECTED_FAILURE";
    patchSha256: string;
    outputSha256: string;
  }>;
}

interface CommandResult {
  passed: boolean;
  output: string;
}

export async function runAuthorProof(
  root: string,
  sessionId: string,
  supportLoader: SupportLoader = readSupportFile
): Promise<{ path: string; value: AuthorProofEvidence }> {
  const manifest = await loadManifest(root);
  const session = getSession(flattenManifest(manifest), sessionId);
  const definition = session.definition.authorProof;
  if (!definition) {
    throw new Error(`Для ${sessionId} не задан authorProof.`);
  }

  const solutionPatch = await supportLoader(root, definition.solutionPatch);
  validatePatch(solutionPatch, definition.solutionPatch);
  const counterexamplePatches = await Promise.all(
    definition.counterexamplePatches.map(async (patchPath) => {
      const source = await supportLoader(root, patchPath);
      validatePatch(source, patchPath);
      return { path: patchPath, source };
    })
  );

  const starter = await runVariant(root, sessionId, definition.check);
  if (starter.passed) {
    throw new Error(
      `${sessionId}: starter неожиданно прошёл ${definition.check}; целевая ошибка потеряна.`
    );
  }
  if (!starter.output.includes(definition.expectedStarterFailure)) {
    throw new Error(
      `${sessionId}: starter упал не по ожидаемой причине. Не найдено: ${definition.expectedStarterFailure}`
    );
  }

  const solution = await runVariant(
    root,
    sessionId,
    definition.check,
    solutionPatch
  );
  if (!solution.passed) {
    throw new Error(`${sessionId}: минимальное решение не прошло:\n${solution.output}`);
  }

  const counterexamples: AuthorProofEvidence["counterexamples"] = [];
  for (const counterexample of counterexamplePatches) {
    const result = await runVariant(
      root,
      sessionId,
      definition.check,
      counterexample.source
    );
    if (result.passed) {
      throw new Error(
        `${sessionId}: counterexample ${counterexample.path} обошёл acceptance test.`
      );
    }
    counterexamples.push({
      status: "EXPECTED_FAILURE",
      patchSha256: sha256(counterexample.source),
      outputSha256: sha256(result.output)
    });
  }

  const value: AuthorProofEvidence = {
    schemaVersion: 1,
    sessionId,
    checkedAt: new Date().toISOString(),
    sessionContentHash: await hashDirectory(getSessionDirectory(root, session)),
    toolchainHash: await hashToolchain(root, manifest.toolchainFiles ?? []),
    definitionHash: sha256(JSON.stringify(definition)),
    check: definition.check,
    starter: {
      status: "EXPECTED_FAILURE",
      outputSha256: sha256(starter.output)
    },
    solution: {
      status: "PASS",
      patchSha256: sha256(solutionPatch),
      outputSha256: sha256(solution.output)
    },
    counterexamples
  };
  const outputPath = path.join(root, "curriculum", "proofs", `${sessionId}.json`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return { path: outputPath, value };
}

export async function verifyAuthorProofEvidence(
  root: string,
  session: FlatSession,
  supportLoader: SupportLoader = readSupportFile
): Promise<string[]> {
  const problems: string[] = [];
  const definition = session.definition.authorProof;
  if (!definition) {
    return [`${session.definition.id}: authorProof отсутствует`];
  }
  const proofPath = path.join(
    root,
    "curriculum",
    "proofs",
    `${session.definition.id}.json`
  );
  let proof: AuthorProofEvidence;
  try {
    proof = JSON.parse(await readFile(proofPath, "utf8")) as AuthorProofEvidence;
  } catch (error) {
    return [`${session.definition.id}: proof evidence не читается (${formatError(error)})`];
  }
  const manifest = await loadManifest(root);
  const expectedSessionHash = await hashDirectory(getSessionDirectory(root, session));
  const expectedToolchainHash = await hashToolchain(
    root,
    manifest.toolchainFiles ?? []
  );
  if (proof.schemaVersion !== 1 || proof.sessionId !== session.definition.id) {
    problems.push(`${session.definition.id}: неверная proof schema или sessionId`);
  }
  if (proof.sessionContentHash !== expectedSessionHash) {
    problems.push(`${session.definition.id}: proof устарел после изменения session files`);
  }
  if (proof.toolchainHash !== expectedToolchainHash) {
    problems.push(`${session.definition.id}: proof устарел после изменения toolchain`);
  }
  if (proof.definitionHash !== sha256(JSON.stringify(definition))) {
    problems.push(`${session.definition.id}: proof устарел после изменения authorProof`);
  }
  if (proof.check !== definition.check) {
    problems.push(`${session.definition.id}: proof check не совпадает с manifest`);
  }
  try {
    const solution = await supportLoader(root, definition.solutionPatch);
    if (proof.solution?.patchSha256 !== sha256(solution)) {
      problems.push(`${session.definition.id}: solution patch изменился после proof`);
    }
    const expectedCounters = await Promise.all(
      definition.counterexamplePatches.map(async (patchPath) =>
        sha256(await supportLoader(root, patchPath))
      )
    );
    const actualCounters = proof.counterexamples?.map((item) => item.patchSha256) ?? [];
    if (JSON.stringify(actualCounters) !== JSON.stringify(expectedCounters)) {
      problems.push(`${session.definition.id}: counterexample patches изменились после proof`);
    }
  } catch (error) {
    problems.push(`${session.definition.id}: support patches недоступны (${formatError(error)})`);
  }
  return problems;
}

async function runVariant(
  root: string,
  sessionId: string,
  check: TargetableCheckLabel,
  patchSource?: string
): Promise<CommandResult> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "course-author-proof-"));
  const workspace = path.join(temporaryRoot, "workspace");
  try {
    await cp(root, workspace, {
      recursive: true,
      filter: (source) => {
        const relative = path.relative(root, source);
        if (!relative) {
          return true;
        }
        return !relative.split(path.sep).some((segment) =>
          [".authoring", ".git", ".training", "node_modules"].includes(segment)
        );
      }
    });
    const sourceNodeModules = path.join(root, "node_modules");
    try {
      const nodeModulesStat = await stat(sourceNodeModules);
      if (nodeModulesStat.isDirectory()) {
        await symlink(sourceNodeModules, path.join(workspace, "node_modules"), "dir");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    if (patchSource) {
      await applyPatch(workspace, patchSource);
    }
    const manifest = await loadManifest(workspace);
    const session = getSession(flattenManifest(manifest), sessionId);
    const command = buildCheckCommand(workspace, session, check);
    if (typeof command === "string") {
      return { passed: false, output: command };
    }
    return await execute(command.command, command.args, command.cwd);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function applyPatch(cwd: string, source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["apply", "--whitespace=nowarn", "-"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(Buffer.concat(chunks).toString("utf8").trim()));
      }
    });
    child.stdin.end(source);
  });
}

function execute(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) =>
      resolve({ passed: false, output: `spawn error: ${error.message}` })
    );
    child.on("close", (code) =>
      resolve({
        passed: code === 0,
        output: Buffer.concat(chunks).toString("utf8").trim()
      })
    );
  });
}

function validatePatch(source: string, name: string): void {
  if (!source.trim()) {
    throw new Error(`Patch ${name} пуст.`);
  }
  const fileMarkers = source
    .split("\n")
    .filter((line) => line.startsWith("+++ ") || line.startsWith("--- "));
  if (fileMarkers.length === 0) {
    throw new Error(`Patch ${name} не содержит unified diff file markers.`);
  }
  for (const marker of fileMarkers) {
    const raw = marker.slice(4).split("\t")[0]!;
    if (raw === "/dev/null") {
      continue;
    }
    const normalized = raw.replace(/^[ab]\//, "");
    const segments = normalized.split("/");
    if (
      normalized.startsWith("/") ||
      normalized.includes("\\") ||
      segments.some((segment) => segment === ".." || segment === ".git") ||
      segments[0] === "support"
    ) {
      throw new Error(`Patch ${name} содержит небезопасный path ${raw}.`);
    }
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

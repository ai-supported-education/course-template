import { execFile } from "node:child_process";

export interface GitExecutor {
  run(args: string[]): Promise<string>;
}

export interface CourseSyncResult {
  progressBranch: string;
  baseBranch: string;
}

const baseBranch = "master";
const originRemote = "origin";
const upstreamRemote = "upstream";

export async function syncProgressBranch(
  git: GitExecutor
): Promise<CourseSyncResult> {
  const status = await git.run(["status", "--porcelain"]);
  if (status.trim()) {
    throw new Error(
      "course:sync требует чистое рабочее дерево. Закоммитьте или временно уберите текущие изменения."
    );
  }

  const progressBranch = (await git.run(["branch", "--show-current"])).trim();
  if (!progressBranch.startsWith("progress/")) {
    throw new Error(
      `Запускайте course:sync из ветки progress/<имя>. Текущая ветка: ${progressBranch || "detached HEAD"}.`
    );
  }

  await assertRemote(git, originRemote);
  await assertRemote(git, upstreamRemote);
  await git.run(["fetch", originRemote]);
  await git.run(["fetch", upstreamRemote]);

  if (await hasRef(git, `refs/remotes/${originRemote}/${progressBranch}`)) {
    await mergeFastForward(git, `${originRemote}/${progressBranch}`, progressBranch);
  }

  await git.run(["switch", baseBranch]);
  await mergeFastForward(git, `${originRemote}/${baseBranch}`, baseBranch);
  await mergeFastForward(git, `${upstreamRemote}/${baseBranch}`, baseBranch);
  await git.run(["push", originRemote, baseBranch]);

  await git.run(["switch", progressBranch]);
  try {
    await git.run(["merge", "--no-edit", baseBranch]);
  } catch (error) {
    throw new Error(
      [
        `Конфликт при вливании ${baseBranch} в ${progressBranch}.`,
        "Вы остались на progress-ветке. Разрешите конфликт, выполните git add, git commit и git push origin текущая-ветка.",
        formatError(error)
      ].join("\n")
    );
  }

  await git.run(["push", originRemote, progressBranch]);
  return { progressBranch, baseBranch };
}

export function createGitExecutor(root: string): GitExecutor {
  return {
    run(args) {
      return new Promise((resolve, reject) => {
        execFile(
          "git",
          ["-C", root, ...args],
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
  };
}

async function assertRemote(git: GitExecutor, remote: string): Promise<void> {
  try {
    await git.run(["remote", "get-url", remote]);
  } catch {
    throw new Error(
      remote === upstreamRemote
        ? "Не настроен remote upstream. Добавьте официальный repository курса: git remote add upstream <URL-официального-курса>."
        : "Не настроен remote origin. Создайте personal fork и добавьте его как origin."
    );
  }
}

async function hasRef(git: GitExecutor, ref: string): Promise<boolean> {
  try {
    await git.run(["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

async function mergeFastForward(
  git: GitExecutor,
  source: string,
  target: string
): Promise<void> {
  try {
    await git.run(["merge", "--ff-only", source]);
  } catch (error) {
    throw new Error(
      [
        `Не удалось fast-forward обновить ${target} из ${source}.`,
        "Сначала разберите расхождение веток вручную; команда ничего не пушила.",
        formatError(error)
      ].join("\n")
    );
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

# Handoff: session runner

Runner читает `curriculum/course.json`, разрешает одну активную сессию и хранит
локальный progress в `.training/`. Он не решает упражнения, не запускает Codex и не
совершает скрытых Git-операций.

## Команды

- `session:validate` — валидировать manifest и посчитать реализованные карточки;
- `session:next` — показать одну ближайшую доступную карточку;
- `session:start <id>` — активировать доступную карточку;
- `session:check` — выполнить локальные checks из manifest;
- `session:review` — собрать пакет для отдельного agent review;
- `session:review --record PASS|NEEDS_WORK` — записать фактический verdict;
- `session:finish` — закрыть карточку после зелёного check и обязательного review;
- `session:hint` — выдать следующий уровень помощи из `course-support`;
- `course:sync` — обновить чистую personal progress-ветку из upstream.

Author-side команды не используют learner progress:

- `author:content-review session <id>` — собрать first-contact, blind и consistency
  packets;
- `author:content-review module <id>` — собрать module packet;
- `author:content-review --record <scope> <id> PASS|NEEDS_REWRITE --report <path>` — записать verdict с content hash;
- `author:content-review status <scope> <id>` — проверить актуальность PASS.
- `author:content-review attest <scope> <id>` — опубликовать компактную аттестацию
  актуального PASS в `curriculum/reviews/`.

CLI не запускает агента. Fresh subagent создаёт родительский Codex по правилам
`AGENTS.md`; локальные packets и records находятся в игнорируемой `.authoring/`.

## Добавление нового check

Check label появляется только после трёх доказательств: он зарегистрирован в
`packages/session-runner/src`, падает на starter по ожидаемой причине и проходит
после минимального решения. Manifest не хранит произвольные shell-команды.

Базовый runner поддерживает `quiz`, `review` и TypeScript/Vitest-реализации
`typecheck`, `unit`, `integration`. Последние три являются reference adapter для
software profile, а не универсальными командами Java, hardware или lab-курсов.
Остальные labels и другие adapters добавляются вместе с конкретным курсом и тестом
самого check.

## Manifest extensions

- `profiles` перечисляет контракты из `docs/course-profiles/` и
  `docs/stack-profiles/`; отсутствующий документ делает manifest невалидным.
- `evidence.produces` и `evidence.verifiedBy` обязательны у каждой сессии.
- `contentReview.learner|consistency|exclude` при необходимости переопределяет роль
  точного относительного файла в author packets. Небезопасные пути, дублирование
  ролей и включение `answers.json` отклоняются.

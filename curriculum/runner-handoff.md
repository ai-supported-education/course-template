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

Manifest `version: 1` — версия структуры карты курса. Термин «schema v3» ниже
относится только к review attestations; новый процесс выбирается отдельным
`reviewProtocol`.

- `author:roadmap-review` — собрать независимые curriculum и subject packets для
  полного roadmap;
- `author:roadmap-review --record ...`, `status`, `attest` — записать два verdict
  и schema v3 roadmap attestation;
- `author:proof [<id>...]` — воспроизвести red/green/counterexample proof каждой
  session с `typecheck`, `unit`, `integration` или `browser` в изолированных
  копиях;
- `author:content-review session <id>` — собрать subject, novice, blind и
  consistency packets;
- `author:content-review module <id>` — собрать module packet;
- `author:content-review --record novice <scope> <id> PASS|NEEDS_REWRITE --report <path>` — записать verdict novice-review с content hash;
- `author:content-review --record subject <scope> <id> PASS|NEEDS_REWRITE --report <path>` — записать независимый предметный verdict;
- `author:content-review --record consistency <scope> <id> PASS|NEEDS_REWRITE --report <path>` — записать независимый consistency verdict;
- `author:content-review status <scope> <id>` — проверить актуальность всех PASS.
- `author:content-review attest <scope> <id>` — опубликовать компактную аттестацию
  schema v3 с тремя актуальными PASS в `curriculum/reviews/`;
- `author:publication-check` — финальный gate актуальности roadmap, session/module
  attestations, support patches и author proofs.

CLI не запускает агентов. Родительский Codex создаёт fresh subagents по
правилам `AGENTS.md`. Novice сначала получает только `00-novice.md`; после
сохранения first-contact checkpoint в
`.authoring/content-review/checkpoints/<scope>-<id>-novice-opening.md` тот же агент отдельным follow-up
получает `01-blind.md` и проверяет весь learner-facing материал. Независимый
subject-agent отдельно сверяет утверждения и currentness с source ledger.
Consistency-agent не видит чужие checkpoint/report: он читает `01-blind.md`,
фиксирует reconstruction и только затем получает `02-consistency.md`. Локальные
packets и records находятся в игнорируемой `.authoring/`.

Все published course/module/session README содержат ровно один marker
`<!-- content-review:opening:end -->`. `00-novice.md` физически включает только
prefix до marker. Для начала курса полный корневой README входит также в
`01-blind.md` и `02-consistency.md`; later targets его не повторяют, но получают
краткие outcomes и DONE всех уже пройденных published-карточек. Protocol id
— `roadmap-subject-novice-consistency-v1`. Legacy
`novice-walkthrough-consistency-v8` и schema v2 остаются читаемыми для существующих
курсов. `02-consistency.md` также содержит
provenance всех prerequisites и полные learner README более ранних source sessions;
изменение такого source входит в hash зависимого review. `01-blind.md` содержит
полный learner-facing маршрут и используется обеими ролями независимо: novice —
после sealed opening, consistency — до авторского evidence. Записи прежних protocol
не считаются актуальными.

## Добавление нового check

Check label появляется только после трёх доказательств: он зарегистрирован в
`packages/session-runner/src`, падает на starter по ожидаемой причине и проходит
после минимального решения. Manifest не хранит произвольные shell-команды.

Базовый runner поддерживает `quiz`, `review`, `typecheck`, `unit`, `integration`
и `browser`. Для четырёх исполняемых checks `checkTargets` выбирает безопасный
относительный config/test path; Vitest targets могут быть `.js`, `.mjs`, `.ts` или
`.tsx`, а browser target запускается Playwright. Произвольные shell-команды
запрещены. Эти adapters являются
reference adapters для software profile, а не универсальными командами Java,
hardware или lab-курсов.
Остальные labels и другие adapters добавляются вместе с конкретным курсом и тестом
самого check.

## Manifest extensions

- `profiles` перечисляет контракты из `docs/course-profiles/` и
  `docs/stack-profiles/`; отсутствующий документ делает manifest невалидным.
- `evidence.produces` и `evidence.verifiedBy` обязательны у каждой сессии.
- `contentReview.learner|consistency|exclude` при необходимости переопределяет роль
  точного относительного файла в author packets. Небезопасные пути, дублирование
  ролей и включение `answers.json` отклоняются.
- `toolchainFiles` перечисляет lockfile и configs, изменение которых устаревает
  техническое доказательство и content-review, но не curriculum hash roadmap.
- `authorProof` связывает выбранный automated check с solution/counterexample
  patches в `course-support` и ожидаемой причиной падения starter.

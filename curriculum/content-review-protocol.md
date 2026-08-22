# Независимый content-review учебного материала

## Зачем нужен отдельный reviewer

Автор знает, что хотел сказать, и поэтому автоматически достраивает пропущенные
связи. Reviewer начинает без истории генерации и проверяет материал в том контексте,
который реально доступен учащемуся. Это проверка понятности и непрерывности маршрута,
а не корректности решения учащегося.

## Подготовка packet

Для одной карточки:

    pnpm author:content-review session 01-01

Для законченного раздела:

    pnpm author:content-review module 01

Planned-сессия является только roadmap и не имеет reviewable learner material.
Перед review автор переводит готовую карточку в `published` внутри feature branch.
Module review покрывает текущий published prefix; planned tail показывается как
контракт следующего шага без несуществующих learner files. Расширение prefix меняет
hash и требует нового module PASS.

Команда создаёт игнорируемую папку `.authoring/content-review/packets/...`:

- `01-blind.md` — audience, concept graph, предыдущий материал, текущие
  learner-facing файлы, README раздела, выбранные profile contracts и краткий
  контракт следующего шага;
- `02-consistency.md` — rubric, checks/evidence, profile contracts и соседние
  карточки.

`answers.json`, hints и solutions в packet не попадают. Quiz key скрыт от
blind-pass, но добавляется в `02-consistency.md` как acceptance evidence: reviewer
должен проверить соответствие вопроса автоматическому ключу после собственного
ответа. Сам Git ref `course-support` reviewer не открывает.

Документы из `courseContextFiles` входят в обе фазы и content hash. Используйте их
для канонической модели аудитории и других межсессионных ограничений, которые fresh
reviewer не должен угадывать из истории генерации. Допустимы только небольшие
текстовые файлы внутри `curriculum/` и `docs/`; hints, answers, solutions, secrets
и traversal paths отклоняются validator-ом.

По умолчанию learner files попадают в blind pass, а `rubric.md`, `quiz.json` и
распознанные test/spec files — только в consistency pass. Для нестандартных имён
укажите точные относительные пути в `session.contentReview.learner`,
`.consistency` или `.exclude`; ответы и secrets нельзя вернуть override-ом.

Текстовые форматы кода, конфигураций, Markdown, CSV/TSV и лабораторных журналов
встраиваются в packet. Остальные и слишком большие файлы перечисляются с размером
и SHA-256. Если binary artifact существенен для понимания или evidence, рядом
обязателен текстовый companion с происхождением, форматом и способом интерпретации.

## Запуск reviewer

Родительский Codex запускает новый subagent с `fork_turns="none"` и передаёт только
пути к двум packets. Reviewer не получает исходный prompt, обсуждение генерации,
предполагаемый ответ или авторское объяснение.

Reviewer обязан:

1. Прочитать только `01-blind.md` и письменно восстановить outcome, причинную
   модель, порядок примеров, задание, ограничения и DONE.
2. Зафиксировать неизвестные термины, скрытые prerequisites и места, где вывод
   приходится угадывать.
3. Только после этого открыть `02-consistency.md` и сверить README с concept graph,
   profiles, rubric, checks/evidence, предыдущей и следующей карточкой.
4. Отдельно проверить различение source fact / assumption / expected / observed /
   inference, воспроизводимость evidence и применимые safety boundaries.
5. Вернуть report по шаблону из packet. Файлы курса reviewer не изменяет.

## Verdict

- `BLOCKER` — материал противоречив, задача неразрешима из показанного контекста или
  требует ещё не введённого понятия.
- `MAJOR` — отсутствует существенная причинная связка, пример или handoff.
- `MINOR` — улучшение формулировки, порядка или навигации, не мешающее результату.

`PASS` разрешён только без открытых BLOCKER и MAJOR. В остальных случаях verdict —
`NEEDS_REWRITE`. Родительский агент исправляет материал и запускает нового fresh
reviewer: продолжение прежнего диалога не считается независимой проверкой.

## Запись результата

Сохраните ответ reviewer в локальный Markdown-файл и выполните:

    pnpm author:content-review --record session 01-01 PASS --report <path>
    pnpm author:content-review status session 01-01

Record связан с content hash текущей карточки и соседнего контекста. Любое изменение
этих материалов, README раздела, полного roadmap, выбранных course context files
или активных profile documents делает status `STALE_OR_MISSING`.
После актуального PASS создайте компактную публичную запись:

    pnpm author:content-review attest session 01-01

Она содержит content hash, verdict, время review и SHA-256 отчёта в
`curriculum/reviews/`, но не публикует внутренний report. После PASS всех карточек
module проходит отдельный review и attestation; только текущие session и module
PASS позволяют считать материал готовым к публикации.

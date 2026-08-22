# Структура репозитория курса

```text
.
├── AGENTS.md                         # поведение Codex
├── curriculum/
│   ├── course.json                   # каноническая карта и порядок
│   ├── audience.md                   # опциональный канонический audience context
│   ├── session-contract.md           # правила 30–60 минут и прогресса
│   ├── authoring-standard.md         # общий критерий готовности материала
│   └── reviews/                      # публичные hash attestations PASS
├── docs/
│   ├── course-profiles/              # компонуемые общие контракты
│   └── stack-profiles/               # правила конкретного стека
├── templates/                        # code/quiz/derive/lab/diagnostic каркасы
├── modules/
│   └── 01-<topic>/sessions/01-01/    # одна learner-facing карточка
│       ├── README.md                 # объяснение и задание
│       ├── rubric.md                 # критерии review
│       └── ...                       # starter, quiz, worksheet, raw evidence...
├── capstone/sessions/                # интеграционный проект
└── packages/session-runner/          # локальные команды обучения
```

Ветка `master` (или основная ветка курса) содержит только то, что можно безопасно
открывать учащемуся. В отдельном Git ref `course-support` находятся:

```text
support/
├── hints/<session-id>.json
├── quizzes/<session-id>.key.json
└── solutions/<session-id>/...
```

`course-support` не является секретным хранилищем: владелец clone может прочитать
любой Git ref. Его задача — убрать ответы и подсказки из обычного дерева IDE и
выдавать помощь постепенно через runner.

## Источники истины

- `course.json` определяет полный roadmap, статусы публикации, длительность,
  результат, а для published-сессий — DONE и checks.
- `courseContextFiles` перечисляет безопасные документы, которые должны видеть
  все author-side reviewers и изменение которых устаревает attestation.
- `profiles` выбирает дополнительные контракты, а `evidence` связывает DONE с
  проверяемыми артефактами.
- README карточки объясняет тему и задаёт упражнение.
- `rubric.md` определяет то, что проверяет Codex-review.
- checks проверяют воспроизводимые свойства; acceptance tests — частный случай для
  code exercise.
- `course-support` содержит только вспомогательные материалы.
- `.authoring/` содержит локальные packets и полные reports, а
  `curriculum/reviews/` — только компактные публичные аттестации.

Не дублируйте условия в тесте или в agent prompt так, чтобы они расходились с
README. Если поле manifest и README противоречат друг другу, исправляется источник
истины — manifest или описание задачи — до начала прохождения.

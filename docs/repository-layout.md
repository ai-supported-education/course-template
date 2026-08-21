# Структура репозитория курса

```text
.
├── AGENTS.md                         # поведение Codex
├── curriculum/
│   ├── course.json                   # каноническая карта и порядок
│   ├── session-contract.md           # правила 30–60 минут и прогресса
│   └── authoring-standard.md         # критерий готовности материала
├── modules/
│   └── 01-<topic>/sessions/01-01/    # одна learner-facing карточка
│       ├── README.md                 # объяснение и задание
│       ├── rubric.md                 # критерии review
│       └── ...                       # starter, tests или quiz
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

- `course.json` определяет порядок, длительность, результат, DONE и checks.
- README карточки объясняет тему и задаёт упражнение.
- `rubric.md` определяет то, что проверяет Codex-review.
- acceptance tests проверяют внешнее поведение упражнения.
- `course-support` содержит только вспомогательные материалы.

Не дублируйте условия в тесте или в agent prompt так, чтобы они расходились с
README. Если поле manifest и README противоречат друг другу, исправляется источник
истины — manifest или описание задачи — до начала прохождения.

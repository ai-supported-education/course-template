# Course support

Эта ветка дополняет основную ветку и не предназначена для обычной навигации
учащегося. Здесь размещаются progressive hints, ключи quiz и reference solutions.

Структура:

```text
support/
├── hints/<session-id>.json
├── quizzes/<session-id>.key.json
└── solutions/<session-id>/...
```

Не копируйте эти файлы в `master`. Runner читает их через `pnpm session:hint` и
локальный quiz check, раскрывая учащемуся только нужный уровень помощи.

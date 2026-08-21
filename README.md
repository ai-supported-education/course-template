# AI-supported course template

Базовый шаблон для репозитория учебного курса, который проходится в IDE короткими
сессиями. Это не готовый курс: после создания репозитория замените демонстрационную
карточку и заполните `curriculum/course.json` своей программой.

Шаблон сохраняет два важных разделения:

- автоматический `pnpm session:check` проверяет воспроизводимые факты локально;
- Codex-review проверяет смысл, объяснение и качество решения отдельным шагом.

Подсказки, ключи quiz и reference solutions живут в Git ref `course-support`, а не
рядом с упражнением. Это предотвращает случайные спойлеры при работе в IDE.

## Создать новый курс

Нажмите **Use this template** на GitHub, затем в новом репозитории:

    pnpm install
    pnpm session:validate
    pnpm session:next

Далее пройдите [руководство автора](docs/authoring-a-course.md). Сначала задайте
аудиторию и карту курса, затем подготовьте только первую реальную сессию. Остальные
карточки можно описать в manifest заранее, но не нужно выдавать учащемуся незрелые
материалы.

GitHub переносит из template только default branch, поэтому сразу создайте ref для
закрытых от случайного просмотра материалов:

    git switch -c course-support
    git push -u origin course-support
    git switch -

После этого добавляйте hints, ключи quiz и reference solutions только в эту ветку.

## Структура

- `curriculum/course.json` — порядок, длительность и условия DONE;
- `modules/` и `capstone/` — learner-facing материалы и упражнения;
- `packages/session-runner/` — локальный runner прогресса и checks;
- ветка `course-support` — progressive hints, quiz keys и reference solutions;
- [AGENTS.md](AGENTS.md) — контракт для Codex во время обучения и authoring.

Полная схема файлов — в [repository-layout.md](docs/repository-layout.md).

## Стековые правила

Базовый шаблон намеренно не привязан к фронтенду, FSD или React. Сравнение с
предыдущим стеком добавляйте только в переходных курсах, когда оно действительно
помогает понять новую модель.

Для React-курса есть отдельный [профиль](docs/stack-profiles/react.md). Только он
описывает, как и когда уместно преподавать Feature-Sliced Design.

## Personal progress

Официальный course repository остаётся чистым: учащийся держит решения и
`answers.json` в личном fork, в ветке `progress/<name>`. После создания fork он
добавляет официальный курс как `upstream`, делает `git fetch upstream` и запускает
`pnpm course:sync` из чистой progress-ветки. Команда обновляет personal `master` из
upstream и вливает его в текущую progress-ветку, не создавая коммитов с решениями в
официальном репозитории.

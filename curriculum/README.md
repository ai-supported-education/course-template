# Карта курса

`course.json` — каноническая карта: порядок modules, длительность, outcome, DONE,
profiles, checks и evidence. Здесь можно держать человеческий обзор маршрута, но не
вторую независимую версию требований.

В шаблоне есть один демонстрационный module `01-replace-me`. Замените его своим
первым разделом до публикации курса. Новые modules добавляйте в manifest и создавайте
одноимённую папку `modules/<id>-<slug>/sessions/<session-id>/`.

Перед добавлением карточки сверяйтесь с [контрактом сессии](session-contract.md) и
[стандартом материала](authoring-standard.md), выберите profiles по
[`docs/course-profiles`](../docs/course-profiles/README.md) и скопируйте ближайший
каркас из [`templates/sessions`](../templates/README.md).

Для нового курса включите
`reviewProtocol: "roadmap-subject-novice-consistency-v1"`, перечислите влияющие на
проверки файлы в `toolchainFiles` и замените placeholder в `source-ledger.json`
первичными источниками. До learner-facing генерации получите два независимых
roadmap PASS через `pnpm author:roadmap-review`; перед публикацией используйте
`pnpm author:publication-check`.

# Независимый content-review учебного материала

Protocol id: `novice-first-contact-consistency-v5`.

## Зачем нужны два reviewer

Автор знает, что хотел сказать, и автоматически достраивает пропущенные связи.
Предметный эксперт-reviewer делает то же самое: узнаёт API по имени, вспоминает
принятый паттерн и не замечает, что в самом тексте опоры нет.

Поэтому публикацию независимо проверяют два fresh subagent:

- **novice-reviewer** проверяет только первый контакт заявленной аудитории;
- **consistency-reviewer** восстанавливает весь материал, а затем сверяет его с
  авторским контрактом.

Они не получают историю генерации и отчёты друг друга. Это author-side проверка
материала, а не review решения учащегося.

## Opening marker

В каждом опубликованном корневом README, README module и README карточки ровно один
скрытый комментарий отмечает конец смыслового входа:

```markdown
<!-- content-review:opening:end -->
```

До него находятся опора, затруднение и ведущий вопрос. После него могут идти
outcome, подробная модель, примеры, задание и DONE. Marker не является заголовком и
не показывается в отрендеренном Markdown.

`00-novice.md` физически содержит только prefix каждого включённого README до
marker. Полный README туда не записывается. Поэтому позднее определение не может
ретроспективно сделать начальный фрагмент понятным. Отсутствующий, повторный или
неверно расположенный marker у published-материала блокирует сборку packet.

## Подготовка packet

Для одной карточки:

    pnpm author:content-review session 01-01

Для законченного опубликованного prefix раздела:

    pnpm author:content-review module 01

Planned-сессия остаётся roadmap и не имеет reviewable learner material. Перед
review автор переводит готовую карточку в `published` внутри feature branch.
Расширение published prefix меняет module hash и требует нового module review.

Команда создаёт игнорируемую папку `.authoring/content-review/packets/...` с тремя
фазами:

- `00-novice.md` — заявленная стартовая точка аудитории, learner-visible
  `outcome`/`done` предыдущей карточки для later session и только opening prefixes
  применимых README до `<!-- content-review:opening:end -->`;
- `01-blind.md` — полные learner-facing файлы карточки, безопасный контекст
  аудитории и материалы, необходимые для восстановления outcome, модели, задания и
  DONE, но без rubric и авторского acceptance intent; для начала курса сюда также
  входит полный корневой learner README;
- `02-consistency.md` — manifest/concept graph, rubric, checks/evidence, profile
  contracts, acceptance evidence, соседние карточки и provenance каждого
  prerequisite; для начала курса корневой README повторяется как course-level
  evidence.

Prerequisite provenance не приравнивает «известно до текущей карточки» к
«обязательно введено в immediate previous card». Для каждого `requires` packet
указывает одно из трёх состояний: concept входит в `assumedConcepts`, concept введён
конкретной более ранней published session либо источник отсутствует. Во втором
случае в `02-consistency.md` прикладывается полный learner-facing README source
session. Этот README входит в content hash зависимой проверки: его последующее
изменение делает review устаревшим.

Для первой опубликованной карточки курса novice packet включает opening корневого
README, первого module и карточки. Для later session вместо повторного корневого
README runner добавляет learner-visible результат предыдущей карточки, затем
opening module и текущей карточки. Отдельный handoff marker не нужен. Scope note в
packet точно перечисляет включённые уровни.

Для module review первая опубликованная глава начинается с course opening; более
поздняя — с результата предыдущей карточки. Далее следуют opening текущего module и
его published sessions. Каждый README всё равно обрывается на собственном marker.

Consistency-review первой карточки и первого module получает не только обрезанный
opening в отдельном novice packet, но и полный корневой README в обеих своих
фазах. Так consistency-agent может сначала восстановить learner route, а затем
проверить course-level promises и язык. Для later targets корневой README
намеренно не повторяется; их вход задают предыдущий learner-visible результат и
текущий module.

`answers.json`, hints и solutions не попадают в novice/blind phases. Quiz key
добавляется только в `02-consistency.md` как acceptance evidence. Reviewer не
открывает Git ref `course-support`.

Документы из `courseContextFiles` входят в blind/consistency phases и content hash,
но не раскрываются novice-reviewer вместо короткой заявленной стартовой точки.
Допустимы только небольшие текстовые файлы внутри `curriculum/` и `docs/`; hints,
answers, solutions, secrets и traversal paths отклоняются validator-ом.

По умолчанию learner files попадают в blind pass, а `rubric.md`, `quiz.json` и
распознанные test/spec files — только в consistency pass. Для нестандартных имён
укажите точные относительные пути в `session.contentReview.learner`,
`.consistency` или `.exclude`; ответы и secrets нельзя вернуть override-ом.

Текстовые форматы кода, конфигураций, Markdown, CSV/TSV и лабораторных журналов
встраиваются в packet. Остальные и слишком большие файлы перечисляются с размером
и SHA-256. Существенный binary artifact получает текстовый companion с
происхождением, форматом и способом интерпретации.

## Novice-review

Родительский Codex запускает subagent с `fork_turns="none"` и передаёт только путь
к `00-novice.md`. Агент не открывает repository, `01-blind.md`,
`02-consistency.md`, authoring rules, profiles, hints, answers или solutions.

Reviewer читает packet сверху вниз и фиксирует:

1. Какую стартовую ситуацию он понял, в чём затруднение и какой вопрос ведёт к
   практике.
2. Для каждой смысловой ссылки вроде «такой», «этот», «похожий» или «здесь» —
   точный уже прочитанный antecedent. Сами слова не запрещены.
3. Для каждого центрального identifier и API первого code block — строку, где имя
   объявлено либо роль объяснена до использования.
4. Есть ли у первого примера нового API исходное состояние, событие или действие,
   роли значимых имён и наблюдаемый результат.
5. Какие места удалось понять только благодаря собственным знаниям агента, а не
   заявленным prerequisites и opening.

Novice report начинается с H1 и отдельной строки
`Verdict: PASS|NEEDS_REWRITE`, после которой содержит разделы:

- `Opening reconstruction`;
- `Reference audit`;
- `Identifier and API audit`;
- `Findings`;
- `Verdict rationale`.

## Consistency-review

Второй независимый subagent также запускается с `fork_turns="none"`. Ему передают
только пути к `01-blind.md` и `02-consistency.md`; novice packet и novice report не
передаются.

Reviewer обязан:

1. Сначала прочитать только `01-blind.md` и письменно восстановить outcome,
   причинную модель, порядок примеров, задание, ограничения и DONE.
2. Зафиксировать неизвестные термины, скрытые prerequisites и места, где вывод
   приходится угадывать.
3. Только после этого открыть `02-consistency.md` и сверить README с concept graph,
   profiles, rubric, checks/evidence, предыдущей и следующей карточкой. Для каждого
   prerequisite проверить provenance и приложенный learner source, не делая вывод
   только по immediate previous card.
4. Проверить различение source fact / assumption / expected / observed / inference,
   воспроизводимость evidence и применимые safety boundaries.
5. Не читать и не учитывать выводы novice-reviewer.

Consistency report начинается с H1 и отдельной строки
`Verdict: PASS|NEEDS_REWRITE`, после которой содержит разделы:

- `Learner reconstruction`;
- `Continuity and profiles`;
- `Evidence and safety`;
- `Findings`;
- `Verdict rationale`.

Оба reviewer работают read-only и не пишут автору готовое вступление. Finding
называет точный фрагмент, эффект для заявленного учащегося и тип необходимого
исправления. Качество языка не сводится к подсчёту слов, англицизмов, заголовков или
показателю читаемости.

## Severity и verdict

- `BLOCKER` — материал противоречив, задача неразрешима из показанного контекста
  или требует ещё не введённого понятия.
- `MAJOR` — отсутствует существенная причинная связка, пример или handoff.
  Необъявленный и необъяснённый центральный identifier/API в opening всегда MAJOR,
  если без него нельзя понять ведущий пример. Неоднозначная ссылка становится
  MAJOR, когда теряется объект ведущего наблюдения или вопроса.
- `MINOR` — локальная неоднозначная ссылка или улучшение порядка/навигации, которое
  не мешает восстановить модель и выполнить карточку.

Объяснение, встреченное после opening marker, не понижает severity novice finding:
первый контакт уже состоялся без него. `PASS` разрешён только без открытых BLOCKER
и MAJOR; иначе verdict — `NEEDS_REWRITE`.

После любого исправления родительский агент запускает **двух новых** fresh
reviewers. Продолжение прежних диалогов и передача finding одного агента другому не
считаются независимой проверкой.

## Запись результата и attestation schema v2

Сохраните два отчёта в локальные Markdown-файлы и запишите фактические verdict:

    pnpm author:content-review --record novice session 01-01 PASS --report <path>
    pnpm author:content-review --record consistency session 01-01 PASS --report <path>
    pnpm author:content-review status session 01-01

Каждый record связан с общим content hash текущей карточки и соседнего контекста.
Изменение opening, полного learner material, language contract, roadmap,
courseContextFiles или активных profile documents делает обе записи
`STALE_OR_MISSING`. `status` отдельно показывает novice и consistency stages и
считает общий status зелёным только при двух актуальных PASS.

После двух PASS создайте публичную запись:

    pnpm author:content-review attest session 01-01

Публичный JSON использует `schemaVersion: 2` и
`protocol: "novice-first-contact-consistency-v5"`. В объекте `reviews` находятся
отдельные `novice` и `consistency`; для каждой проверки публикуются verdict, время
review и SHA-256 соответствующего локального отчёта. Общий content hash остаётся
на уровне attestation. Raw reports и packets остаются в `.authoring/`.

Attestation v1 и protocol до v5 не удовлетворяют v5 и автоматически считаются
устаревшими; старый одиночный PASS не мигрируется в один из новых stages. После
двойного PASS всех опубликованных карточек module проходит такую же пару review и
получает schema v2 attestation. Только актуальные двойные session и module PASS
считаются готовыми к публикации.

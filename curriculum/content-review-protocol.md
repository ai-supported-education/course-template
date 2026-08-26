# Независимый content-review учебного материала

Protocol id: `novice-walkthrough-consistency-v8`.

## Зачем нужны два reviewer

Автор знает, что хотел сказать, и автоматически достраивает пропущенные связи.
Предметный эксперт-reviewer делает то же самое: узнаёт API по имени, вспоминает
принятый паттерн и не замечает, что в самом тексте опоры нет.

Поэтому публикацию независимо проверяют два fresh subagent:

- **novice-reviewer** сначала фиксирует первый контакт без поздних подсказок, а
  затем проходит весь learner-facing материал до DONE;
- **consistency-reviewer** независимо восстанавливает весь материал, а затем
  сверяет его с авторским контрактом.

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
ретроспективно сделать начальный фрагмент понятным. После сохранения этого
first-contact checkpoint тот же novice-reviewer получает полный learner-facing
packet `01-blind.md`: защита открытия сохраняется, но понятность остальной карточки
тоже проверяется. Отсутствующий, повторный или неверно расположенный marker у
published-материала блокирует сборку packet.

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

- `00-novice.md` — первая фаза novice-review: заявленная стартовая точка
  аудитории, learner-visible `outcome`/`done` всех предыдущих published-карточек
  для later session и последовательность `opening session → её компактный
  learner-visible результат` для module review; результат одной карточки можно
  использовать только при чтении следующих openings. Сам packet содержит только
  opening prefixes применимых README до
  `<!-- content-review:opening:end -->`;
- `01-blind.md` — полные learner-facing файлы карточки, безопасный контекст
  аудитории и материалы, необходимые для восстановления outcome, модели, примеров,
  задания и DONE, но без rubric и авторского acceptance intent. После sealed
  checkpoint его получает novice-reviewer; независимо с него начинает
  consistency-reviewer. Для начала курса сюда также входит полный корневой learner
  README;
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
README runner добавляет компактные learner-visible результаты всех уже пройденных
published-карточек, затем opening module и текущей карточки. Так fresh reviewer
получает ту же учебную историю, на которую вправе опираться реальный учащийся, но
не видит поздние объяснения текущего материала. Отдельный handoff marker не нужен.
Scope note в packet точно перечисляет включённые уровни.

Для module review первая опубликованная глава начинается с course opening; более
поздняя — с результатов всех предыдущих published-карточек. Далее следуют opening
текущего module и его published sessions в реальном порядке прохождения. После
opening каждой session packet показывает её компактные `outcome` и `DONE`: они
становятся контекстом для следующей карточки, но не позволяют ретроспективно
смягчить finding текущего opening. Каждый README всё равно обрывается на
собственном marker.

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

## Novice-review: две фазы одного fresh-агента

Родительский Codex запускает subagent с `fork_turns="none"` и сначала передаёт
только путь к `00-novice.md`. Агент не открывает repository, `01-blind.md`,
`02-consistency.md`, authoring rules, profiles, hints, answers или solutions.

В первой фазе reviewer читает packet сверху вниз и фиксирует:

1. Какую стартовую ситуацию он понял, в чём затруднение и какой вопрос ведёт к
   практике.
2. Для каждой смысловой ссылки вроде «такой», «этот», «похожий» или «здесь» —
   точный уже прочитанный antecedent. Сами слова не запрещены.
3. Для каждого центрального identifier и API первого code block — строку, где имя
   объявлено либо роль объяснена до использования.
4. Есть ли у первого объясняющего примера нового API исходное состояние, событие
   или действие, роли значимых имён и наблюдаемый результат. Анонс будущего
   примера или пункт маршрута не считается таким примером сам по себе.
5. Какие места удалось понять только благодаря собственным знаниям агента, а не
   заявленным prerequisites и opening.

Результат первой фазы — отдельный checkpoint `CLEAR|REWRITE`, а не финальный
verdict по карточке. Родитель физически сохраняет checkpoint до продолжения. При
`REWRITE` материал исправляется, и обе независимые проверки затем запускаются
заново с новыми агентами. При `CLEAR` родитель продолжает тот же novice-диалог и
передаёт только `01-blind.md`.

Во второй фазе novice-reviewer проходит весь learner-facing packet в порядке
чтения учащегося и проверяет:

1. Можно ли восстановить причинную модель без rubric, tests, hints и авторского
   контекста.
2. Объяснён ли каждый новый термин и API до места, где он нужен для следующего
   вывода или примера.
3. Содержат ли примеры исходные значения, действие, наблюдение и явную связь с
   объясняемой моделью.
4. Достаточно ли текста и starter-артефактов, чтобы выполнить точное задание,
   получить evidence и доказать DONE без следующей карточки.
5. Связан ли текущий материал с доступным предыдущим результатом и следующим
   learner-visible contract без скрытого prerequisite.

Поздний текст может породить новый finding, но не позволяет переписать или
смягчить сохранённый first-contact checkpoint. Итоговый novice report начинается с
H1 и отдельной строки `Verdict: PASS|NEEDS_REWRITE`, после которой содержит
разделы:

- `Opening reconstruction`;
- `Reference audit`;
- `Identifier and API audit`;
- `Learner walkthrough`;
- `Explanation and examples`;
- `Task, evidence and DONE`;
- `Continuity`;
- `Findings`;
- `Verdict rationale`.

## Consistency-review

Второй независимый subagent также запускается с `fork_turns="none"`. Он не получает
`00-novice.md`, first-contact checkpoint или итоговый novice report. Сначала ему
передают только `01-blind.md`; `02-consistency.md` раскрывается отдельным follow-up
после письменной learner reconstruction.

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

Объяснение, встреченное после opening marker, не понижает severity finding из
sealed first-contact: первый контакт уже состоялся без него. Итоговый novice
`PASS` разрешён только без открытых BLOCKER и MAJOR и во вступлении, и в полном
learner walkthrough. Для consistency действует та же граница verdict; иначе
результат — `NEEDS_REWRITE`.

После любого исправления родительский агент запускает **двух новых** fresh
reviewers. Нельзя продолжать прежний novice checkpoint или consistency
reconstruction: они относятся к старой версии. Передача finding одного агента
другому не считается независимой проверкой.

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
`protocol: "novice-walkthrough-consistency-v8"`. В объекте `reviews` находятся
отдельные `novice` и `consistency`; для каждой проверки публикуются verdict, время
review и SHA-256 соответствующего локального отчёта. Общий content hash остаётся
на уровне attestation. Raw reports и packets остаются в `.authoring/`.

Attestation v1 и protocol до v8 не удовлетворяют v8 и автоматически считаются
устаревшими; старый одиночный PASS или novice PASS только по opening не мигрируется
в новый stage. После двойного PASS всех опубликованных карточек module проходит
такую же пару review и получает schema v2 attestation. Только актуальные двойные
session и module PASS считаются готовыми к публикации.

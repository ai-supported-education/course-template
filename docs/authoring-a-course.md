# Руководство автора курса

## 1. Зафиксируйте аудиторию и проверяемый финал

До списка тем опишите в `curriculum/course.json` конкретные входные знания,
ограничения среды и итоговый artifact capstone. Затем разложите путь назад на
результаты по 30–60 минут. Module может занимать часы, но каждая карточка должна
заканчиваться завершённым evidence и безопасным checkpoint.

Если краткой строки `audience` недостаточно, создайте канонический документ,
например `curriculum/audience.md`, и добавьте его в `courseContextFiles`. Эти
безопасные текстовые файлы входят в review packets и content hash, поэтому fresh
reviewer получает ту же модель аудитории, что и автор.

После `Use this template` замените не только placeholder module, но и корневой
README, название/описание repository и другие template placeholders. Для
намеренно короткого курса допустим пустой `capstone.sessions`, если последний
интеграционный результат уже явно завершён в обычной сессии и скрытого продолжения
нет.

Для каждой сессии заполните:

- `outcome` — что учащийся сможет наблюдаемо сделать;
- `done` — обязательный критерий завершения;
- `requires`, `introduces`, `defers` — границы понятий;
- `checks` — только реально подключённые runner checks;
- `evidence.produces` — какие артефакты останутся;
- `evidence.verifiedBy` — `automated`, `empirical`, `agent` и/или
  `manual-approval`.

Runner показывает учащемуся `title`, `outcome` и `done` до открытия карточки.
Формулируйте эти поля естественно и компактно; подробный перечень внутренних
invariants оставляйте в README, rubric и acceptance tests.

Полный маршрут можно зафиксировать до реализации. Для будущей карточки укажите
`releaseStatus: "planned"` и только roadmap-поля: `id`, `title`, `minutes`,
`kind`, `outcome`, `requires`, `introduces`, `defers`. Поля `done`, `checks`,
`evidence` и `contentReview` появляются при переводе в `published`. Опубликованные
карточки образуют непрерывный префикс курса; runner не открывает planned-материал.
Отсутствующий `releaseStatus` обратно совместимо означает `published`.

Третьего manifest-статуса для черновика нет. Full-contract карточку готовьте в
authoring feature branch: там переведите её в `published`, добавьте материалы и
пройдите checks/content-review. В default branch сессия попадёт только вместе с
актуальными PASS attestations. Module review всегда покрывает текущий published
prefix этого module. Когда следующая карточка становится published, прежний hash
устаревает и весь расширенный prefix проходит module review заново.

Не превращайте вводный module в двухчасовой «базовый блок». Две новые идеи, два
независимых результата или отдельный setup tail означают две карточки.

## 2. Постройте вход в курс, module и карточку

До объяснения первой модели прочитайте
[контракт learner-facing языка](learner-facing-language.md). Он общий для всех
предметов и не подключается через profile.

Напишите три связанные подводки:

1. Корневой README начинает с опыта аудитории и проблемы, ради которой существует
   курс, затем показывает конечный результат и маршрут коротких сессий.
2. README module объясняет переход от предыдущего результата, вопрос этой главы и
   evidence, который объединяет её карточки. Первый module опирается на стартовую
   точку аудитории.
3. README сессии перед outcome показывает конкретное наблюдение или прежний
   evidence, границу текущего объяснения и вопрос практики.

Завершите смысловой вход каждого опубликованного корневого README, README module и
README карточки точным скрытым marker:

```markdown
<!-- content-review:opening:end -->
```

Он ставится до outcome и подробного объяснения. Не переносите недостающую опору за
marker: novice-reviewer физически не увидит её в sealed first-contact phase, а
поздний текст не сможет исправить уже сохранённый finding.

Не начинайте learner-facing текст с каталога терминов, scope или команд. Эти
формальные разделы остаются обязательными, но становятся ответом на уже понятный
вопрос. Не копируйте во все карточки одинаковое `Введение`: используйте предметный
заголовок либо начинайте естественными абзацами сразу после названия.

Прочитайте три уровня подряд как учащийся. Между ними не должно быть скачка, для
которого нужно знать manifest, авторский замысел или будущую карточку. Здесь не
применяется проверка по числу слов, длине предложений или количеству англицизмов:
важно, выполняет ли текст коммуникативную функцию.

Затем перечитайте только prefix до каждого marker. Для слов «такой», «этот»,
«похожий» и «здесь» укажите конкретный antecedent выше по тексту. Для центральных
identifier/API первого code block укажите объявление или предшествующее объяснение
роли. Если приходится отвечать «это и так понятно» или ссылаться на поздний
раздел, opening ещё не готов. Первый пример нового API должен содержать начальное
состояние, событие, роли значимых имён и наблюдаемый результат.

## 3. Выберите компонуемые profiles

Добавьте минимальный набор ids в корневой `profiles`. Общие варианты и типовые
комбинации перечислены в [course-profiles](course-profiles/README.md). Stack-specific
контракт хранится в `docs/stack-profiles/<id>.md`; например, React/FSD подключается
только через `react`.

Runner требует документ для каждого выбранного id. Его текст входит в independent
review packet и content hash, поэтому reviewer видит те же ограничения, что автор.
Если предмету нужен новый профиль, добавьте узкое правило, а не меняйте общий
стандарт под один курс.

## 4. Выберите форму evidence, затем шаблон карточки

Используйте ближайший каркас из [templates](../templates/README.md): code, quiz,
derivation, measurement lab или diagnostic. Не все карточки должны иметь starter и
unit test.

README даёт достаточный контекст, чтобы учащийся мог объяснить результат:

1. смысловой мостик от знакомого опыта к вопросу карточки;
2. outcome, scope и входное состояние;
3. причинная модель;
4. два маленьких примера или полностью заданных сценария;
5. визуальная структура только там, где связи трудно понять линейно;
6. два правдоподобных неверных пути;
7. точное задание и ожидаемый evidence;
8. способы проверки и DONE;
9. для lab — preflight, baseline, stop conditions, cleanup/rollback.

Помечайте source fact, assumption, expected, observed и inference. Synthetic/sample
данные не называются результатом эксперимента. Текст для внимательного чтения
должен укладываться примерно в 10–15 минут.

## 5. Согласуйте checks с evidence

`pnpm session:check` — локальная автоматизация; он не запускает Codex. Базовый
runner знает `quiz`, `review` и TypeScript/Vitest-реализации `typecheck`, `unit`,
`integration`. Новый label без registry implementation не работает. Для другого
языка замените adapter и добавьте проверку, доказывающую его падение/успех.

Для code exercise starter сохраняет одну целевую проблему, acceptance test падает
по ожидаемой причине и проходит после минимального решения. Test проверяет
публичное поведение.

Для расчёта или lab автоматический test необязателен. Обычно используйте
`checks: ["review"]` и `verifiedBy: ["empirical", "agent"]`: raw evidence получает
учащийся, а агент сверяет процедуру и rubric. `manual-approval` применяйте только с
явно названной ролью и критерием, который нельзя честно автоматизировать.

Rubric копируется из `templates/rubric.md` и разделяет invariants, valid
alternatives, evidence/safety и optional improvements. Не маскируйте смысловую
оценку хрупким поиском строк.

## 6. Подготовьте quiz и progressive help

В `quiz.md` рядом с каждым вопросом показывайте весь код/сценарий, входные значения
и порядок действий. Учащийся пишет `reason` своими словами; вопрос не перечисляет
нужные тезисы ответа.

Hints, quiz keys и reference solutions не лежат в default branch. GitHub не
переносит дополнительные refs из template, поэтому в новом repository создайте:

```bash
git switch -c course-support
git push -u origin course-support
git switch -
```

В `course-support` подготовьте последовательные уровни: напоминание концепции,
область поиска, структура исправления/reference fragment. `session:hint` открывает
только следующий уровень.

## 7. Докажите карточку до content-review

Для каждой карточки:

1. Выполните `pnpm session:validate`.
2. Пройдите её из чистой копии как учащийся.
3. Проверьте заявленное исходное состояние и минимальный путь до DONE.
4. Для code exercise зафиксируйте ожидаемое падение starter и зелёный минимальный
   вариант; для lab — безопасный dry run/simulation и корректный cleanup.
5. Убедитесь, что evidence действительно позволяет применить rubric.

Не записывайте в материал результаты, которых не наблюдали. Если реальную среду
проверить нельзя, честно ограничьте evidence fixture/simulation.

## 8. Запустите двух независимых fresh reviewers

Соберите пакет:

```bash
pnpm author:content-review session <id>
```

Запустите novice-subagent с `fork_turns="none"` и передайте ему только путь к
`00-novice.md`. Он построчно проверяет opening prefixes, antecedents, identifiers и
полноту первого объясняющего примера, затем возвращает не финальный verdict, а
first-contact checkpoint `CLEAR|REWRITE`. Для later session packet перечисляет
outcomes и DONE всех уже пройденных published-карточек. В module review они
появляются между openings в реальном порядке прохождения: результат завершённой
карточки доступен следующей, но не исправляет её собственный opening задним числом.
Roadmap-preview при этом не считается исполнимым примером нового API. Сохраните checkpoint отдельным файлом. При `REWRITE`
исправьте материал и начните весь review заново. При `CLEAR` продолжите тот же
диалог и передайте агенту только `01-blind.md`: теперь он читает весь
learner-facing маршрут, проверяет объяснения, примеры, задание, evidence, DONE и
handoff, после чего возвращает итоговый novice `PASS|NEEDS_REWRITE`. Его ранние
выводы нельзя смягчить поздним объяснением.

Независимо запустите consistency-subagent с `fork_turns="none"`. Не передавайте
ему novice packet, checkpoint или report. Сначала дайте только `01-blind.md` и
попросите письменно реконструировать learner material. Лишь после этого откройте
`02-consistency.md`: агент сверяет profiles, concept graph, rubric, checks,
evidence, safety и соседние карточки. Для транзитивных prerequisites он использует
provenance-карту и приложенные learner README source sessions, а не требует
введения каждого concept в immediate previous card. Оба reviewer read-only; не
передавайте им авторские рассуждения или отчёт другого агента.

После отчёта:

```bash
pnpm author:content-review --record novice session <id> PASS --report <path>
pnpm author:content-review --record consistency session <id> PASS --report <path>
pnpm author:content-review status session <id>
pnpm author:content-review attest session <id>
```

При BLOCKER/MAJOR исправьте материал и используйте двух новых fresh subagents:
нельзя продолжать прежний novice checkpoint или consistency reconstruction, потому
что эти диалоги уже видели старую версию. Центральный неизвестный identifier в
opening остаётся MAJOR, даже если определён ниже marker. После двух PASS всех
карточек повторите парную процедуру для module и запишите module attestation. Raw
first-contact checkpoints, packets и reports остаются локально в `.authoring/`;
публичная schema v2 attestation хранит отдельные hash итоговых отчётов novice и
consistency.

## 9. Проведите пилот

Попросите реального учащегося пройти одну карточку без подсказок автора. Исправляйте
непонятное место в причинной связке, примере, входном состоянии или scope, а не
только в quiz key. Данные пилота не заменяют fresh content-review, но обнаруживают
ошибки оценки времени и среды.

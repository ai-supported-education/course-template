# Компонуемые профили курса

Общий стандарт задаёт форму короткой сессии, evidence и review. Profiles добавляют
только те ограничения, которые зависят от типа курса. Укажите их ids в корневом
поле `profiles` файла `curriculum/course.json`; runner требует одноимённый документ
в `docs/course-profiles/` или `docs/stack-profiles/` и включает его в независимый
content-review.

Выбирайте минимальный достаточный набор:

| Курс | Рекомендуемые profiles |
| --- | --- |
| Vue → React | `transition`, `software`, `react` |
| Node.js → Java | `transition`, `software` и отдельный `java`, если нужны правила стека |
| Алгоритмы | `software`, `quantitative` |
| Компьютерные сети | `lab`, `quantitative`, `network-safety` |
| ESP / SDR | `lab`, `quantitative`, `rf-safety` и при сетевой части `network-safety` |
| Математика + графический движок | `quantitative`, `software` |

Базовые profiles:

- [transition](transition.md) — перенос модели из уже знакомой области;
- [software](software.md) — исполняемый код и проверка публичного поведения;
- [quantitative](quantitative.md) — формулы, единицы, данные и погрешность;
- [lab](lab.md) — воспроизводимая практика с состоянием среды;
- [network-safety](network-safety.md) — безопасная сетевая область воздействия;
- [rf-safety](rf-safety.md) — приём, передача и RF-оборудование.

Profile не заменяет описание аудитории и prerequisites. Если курсу нужно новое
правило, создайте узкий документ с новым id; не изменяйте общий стандарт под один
стек. При конфликте применяется более безопасное и более узкое ограничение, а сам
конфликт должен быть устранён до публикации.

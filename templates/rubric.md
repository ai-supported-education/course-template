# Rubric: {{ session id — title }}

## Invariants

- [ ] {{ Наблюдаемый обязательный результат }}
- [ ] {{ Evidence существует и позволяет проверить DONE }}
- [ ] {{ Вывод следует из показанных фактов/наблюдений и допущений }}

## Valid alternatives

- {{ Допустимый другой метод, формат или реализация }}
- Любой иной способ допустим, если сохраняет invariants и ограничения карточки.

## Evidence and safety

- [ ] Expected, observed и inference не смешаны.
- [ ] {{ Для lab: scope, stop conditions и cleanup подтверждены }}
- [ ] Evidence не раскрывает secrets или чужие/персональные данные.

## Optional improvements

- {{ Идея, которая явно не блокирует PASS }}

## NEEDS_WORK

Верните `NEEDS_WORK`, если нарушен хотя бы один invariant либо evidence не позволяет
проверить обязательный результат. Optional improvements не блокируют `PASS`.

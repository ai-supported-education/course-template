# Stack profile: networking

Подключайте этот профиль только для курса по компьютерным сетям. Он дополняет
`lab`, `quantitative` и `network-safety`, но не добавляет правила конкретного
вендора оборудования.

## Причинная модель

- Объясняйте путь данных как последовательность решений и наблюдаемых сообщений,
  а не как список команд или уровней OSI для запоминания.
- На схеме и в тексте явно различайте interface, link-layer address, IP address,
  transport port, protocol message и application data.
- Не используйте ещё не введённые CIDR, route lookup, ARP/ND, NAT или TCP state как
  скрытое объяснение. Названное, но отложенное понятие укажите в `defers`.
- Если курс ограничен IPv4, прямо отмечайте, что изученное поведение не является
  универсальным свойством любого IP-трафика.

## Packet evidence

- Для обязательного пути используйте текстовый разбор `tshark`; GUI Wireshark
  может быть дополнительной визуализацией тех же полей.
- Публичные packet captures должны быть synthetic и сопровождаться provenance,
  SHA-256 и текстовым companion. Реальный пользовательский трафик не публикуется.
- Для live capture заранее ограничьте interface, BPF/display filter, target,
  длительность и максимальный объём. Raw capture и нормализованная интерпретация
  сохраняются отдельно.
- Timestamp, checksum offload, ephemeral ports, sequence numbers и другие
  изменчивые поля нельзя проверять как фиксированные без отдельного обоснования.

## Docker/Linux лаборатории

- Host предоставляет Docker Compose v2; изучаемые `ip`, `ping`, `ss`, `tcpdump`
  и `tshark` выполняются внутри Linux-контейнеров.
- По умолчанию topology использует isolated internal network без published ports,
  host networking, Docker socket и privileged containers.
- Capabilities выдаются минимально и только процессу, которому они нужны. Любая
  автоматизация печатает выполняемую Linux-команду и не скрывает целевой механизм.
- Курс обязан со временем перейти от готового guardrail runner к созданию
  topology самим учащимся, если Docker networking входит в outcomes.

Этот профиль не включает FSD, frontend architecture, RouterOS или другие
vendor-specific соглашения.

# Roadmap 1.1.0

## Memory folder contract

`memory/tree-index.md` стає canonical source of truth для структури папок бази знань.

Фізична файлова система не є source of truth. Папка може бути описана в `tree-index.md` до її фізичного створення. Якщо така папка використовується в `rmem write`, CLI створює відповідну директорію автоматично.

Derived backup/cache зберігається в `.rmem/index/tree-index.json`. Він використовується для перевірки та recovery, але не є silent fallback, якщо `tree-index.md` зламаний.

## Tree index format

Формат має бути простим Markdown, придатним для ручного редагування:

```md
# Memory Tree Index

<!-- rmem:tree-index start -->

- `project` — Загальна памʼять проєкту.
  - `project/architecture` — Архітектура, компоненти та системні рішення.
  - `project/rules` — Правила роботи агентів і розробників.

<!-- rmem:tree-index end -->
```

Статуси папок не вводяться. Вони не дають критично важливих функцій і ускладнюють формат.

## Existing memory migration

Автоматичне створення `tree-index.md` не виконується.

Якщо `memory/tree-index.md` відсутній, normal operations блокуються з `TREE_INDEX_NOT_FOUND`. Користувач або агент може явно виконати:

```bash
rmem tree generate
```

Команда сканує існуючу `memory/`, створює skeleton `tree-index.md` з порожніми описами і пропозицією заповнити їх вручну. `rmem check` повідомляє `MEMORY_FOLDER_DESCRIPTION_EMPTY` для незаповнених описів.

## Public folder commands

У public agent-facing API додаються:

```bash
rmem tree generate
rmem tree repair
rmem folder create <memory-path> --description <text>
rmem folder update <memory-path> --description <text>
rmem folder move <from-memory-path> <to-memory-path> [--description <text>]
rmem folder remove <memory-path> [--delete-files]
```

`folder create` і `folder update` редагують `memory/tree-index.md`, а не config files.

`folder move` оновлює `tree-index.md`, фізичну директорію якщо вона існує, document paths, `rmem.memoryPath`, registry, structural places, notes і vector index consistency.

`folder remove` за замовчуванням безпечний: архівує affected documents і прибирає active registry/index state. Фізичне рекурсивне видалення дозволене тільки з explicit `--delete-files`.

## Error model

Нові error codes:

- `TREE_INDEX_NOT_FOUND`
- `TREE_INDEX_INVALID`
- `MEMORY_FOLDER_NOT_FOUND`
- `MEMORY_FOLDER_ALREADY_EXISTS`
- `MEMORY_FOLDER_DESCRIPTION_EMPTY`
- `MEMORY_FOLDER_PROTECTED`

Якщо document target folder не описаний у `tree-index.md`, `rmem write` повертає `MEMORY_FOLDER_NOT_FOUND` з підказкою створити folder через `rmem folder create`.

## Area key model

Area identity має бути full path key, а не останній segment.

Це дозволяє однакові назви папок у різних гілках:

```text
project/backend/api
project/frontend/api
```

У derived структурах folder key дорівнює normalized memory path, наприклад `project/backend/api`.

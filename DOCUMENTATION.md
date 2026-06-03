# rmem-cli Documentation

`rmem-cli` — це TypeScript CLI для документно-орієнтованої памʼяті проєкту.

Документи Markdown є канонічним джерелом знань. Registry, structural places, notes, links, embeddings/search data і search reports є похідними проєкціями та мають перебудовуватися з документів.

## Зміст

- [Робоча модель](#робоча-модель)
- [Конфігурація](#конфігурація)
- [Структура сховища](#структура-сховища)
- [Document contract](#document-contract)
- [Public commands](#public-commands)
- [Dev commands](#dev-commands)
- [Provider setup](#provider-setup)
- [Формати відповідей](#формати-відповідей)
- [Error codes](#error-codes)
- [Приклади workflows](#приклади-workflows)

## Робоча модель

`rmem-cli` завжди працює від поточної директорії процесу:

```bash
cd /path/to/project
rmem check
```

Ця директорія вважається коренем памʼяті. У ній створюються:

```text
.rmem/
memory/
```

Усі agent-facing команди повертають structured JSON. Human-readable режим окремо не реалізований.

## Конфігурація

Основний конфігураційний файл:

```text
.rmem/config.yaml
```

Файл створюється автоматично під час першої команди `write`, якщо його ще немає.

Для сумісності підтримується fallback читання `.rmem/config.json`, але новий runtime config записується як `.rmem/config.yaml`.

### Default config

```yaml
schemaVersion: 1

memoryRoot: memory

areas:
  project:
    title: Project
    description: General project memory.

indexing:
  noteRebuildMode: sync

providers:
  llm:
    type: ollama
    endpoint: http://localhost:11434
    model: qwen2.5:7b

  embeddings:
    type: flagembedding
    endpoint: http://localhost:8765
    model: BAAI/bge-m3
```

### Поля config

#### `schemaVersion`

Тип: `number`

Версія схеми конфігурації. Поточне значення:

```yaml
schemaVersion: 1
```

#### `memoryRoot`

Тип: `string`

Директорія, де зберігаються canonical Markdown documents.

```yaml
memoryRoot: memory
```

Якщо `memoryRoot: memory`, документ `architecture/system.md` фізично зберігається тут:

```text
memory/architecture/system.md
```

#### `areas`

Тип:

```ts
Record<string, {
    title: string
    description?: string
    parent?: string
}>
```

Описує semantic memory areas, які використовуються в `rmem.memoryPath` документів.

Приклад:

```yaml
areas:
  project:
    title: Project
    description: Загальна памʼять проєкту.

  architecture:
    title: Architecture
    description: Архітектура, компоненти та системні рішення.
    parent: project

  memory:
    title: Memory
    description: Памʼять, індексація, пошук і агентські протоколи.
    parent: architecture
```

Документ із таким frontmatter:

```yaml
rmem:
  memoryPath:
    - project
    - architecture
    - memory
```

буде повʼязаний із цими configured areas.

#### `indexing.noteRebuildMode`

Тип:

```ts
'sync' | 'manual'
```

Режим оновлення derived notes після `write` або `edit`.

```yaml
indexing:
  noteRebuildMode: sync
```

Підтримувані значення:

- `sync` — notes перебудовуються під час document write/edit.
- `manual` — documents оновлюються, а projections можна перебудувати через `rmem dev notes rebuild` або `rmem dev index rebuild`.

#### `providers.llm`

Тип:

```ts
{
    type: 'ollama' | 'openai-compatible'
    endpoint: string
    model: string
    apiKey?: string
}
```

Default Windows-friendly config:

```yaml
providers:
  llm:
    type: ollama
    endpoint: http://localhost:11434
    model: qwen2.5:7b
```

#### `providers.embeddings`

Тип:

```ts
{
    type: 'flagembedding'
    endpoint: string
    model: string
}
```

Default Windows-friendly config:

```yaml
providers:
  embeddings:
    type: flagembedding
    endpoint: http://localhost:8765
    model: BAAI/bge-m3
```

## Структура сховища

```text
project-root/
  .rmem/
    config.yaml
    registry/
      state.json
    archive/
      <document-path>
  memory/
    <canonical-documents>.md
```

### `.rmem/registry/state.json`

Internal registry. Містить:

- document records
- structural places
- derived notes
- note links
- hashes
- archive state

Цей файл не є canonical source of truth.

### `.rmem/archive/`

Містить archived snapshots після `rmem remove`.

`remove` не видаляє canonical document із `memoryRoot`; він переводить документ у `status: archived` і також записує archived copy в `.rmem/archive/`.

### `memory/`

Canonical Markdown documents. Саме ці документи є джерелом знань.

## Document contract

Кожен document має містити:

1. YAML frontmatter
2. managed header
3. Markdown body

### Frontmatter schema

```yaml
---
title: System Memory
summary: Short summary
tags:
  - architecture
  - memory

rmem:
  schemaVersion: 1
  documentId: doc_system_memory
  kind: architecture
  status: active
  createdAt: 2026-06-03T10:00:00.000Z
  updatedAt: 2026-06-03T10:00:00.000Z
  revision: 1
  memoryPath:
    - project
    - architecture
  language: en
  aliases:
    - memory architecture
---
```

### Supported `kind`

```ts
type DocumentKind =
    | 'overview'
    | 'architecture'
    | 'decision'
    | 'rules'
    | 'spec'
    | 'guide'
    | 'reference'
    | 'journal'
    | 'research'
    | 'task-plan'
```

### Supported `status`

```ts
type DocumentStatus =
    | 'draft'
    | 'active'
    | 'deprecated'
    | 'archived'
    | 'needs-review'
```

### Supported `language`

```ts
type DocumentLanguage = 'uk' | 'en' | 'mixed'
```

### Managed header

Managed header генерується CLI:

```md
<!-- rmem:managed-header start -->

# System Memory

...

<!-- rmem:managed-header end -->
```

Не редагуйте managed header вручну. Після `write`, `edit` і `remove` він регенерується з frontmatter.

## Public commands

Public commands — це стабільний agent-facing API.

```bash
rmem search <query>
rmem list [memory-path]
rmem read <document-path>
rmem write <document-path> [--from <file>]
rmem edit <document-path>
rmem remove <document-path>
rmem check
```

### `rmem search <query>`

Шукає релевантні derived notes і повертає one-shot context report.

```bash
rmem search "архітектура памʼяті"
```

#### Аргументи

- `<query>` — пошуковий запит. Усі аргументи після `search` обʼєднуються в один рядок.

#### Опції

Немає.

#### Поведінка

Команда використовує:

- lexical matching
- deterministic embedding similarity
- simple score fusion
- note links як graph context

#### Відповідь

```ts
type SearchResponse = {
    ok: true
    query: string
    summary: string
    results: SearchResult[]
    recommendedReads: { path: string, reason: string }[]
    warnings: RmemWarning[]
}
```

Кожен result містить:

- `rank`
- `score`
- `note`
- `document`
- `memoryPath`
- `targetPlace`
- `linkedKnowledge`
- `recommendedCommands`

### `rmem list [memory-path]`

Показує configured memory areas і documents у memory path.

```bash
rmem list
rmem list project/architecture
```

#### Аргументи

- `[memory-path]` — optional path у форматі `project/architecture`.

#### Опції

Немає.

#### Відповідь

```ts
type ListResponse = {
    ok: true
    path: string[]
    area?: MemoryPathUnitReport
    items: MemoryListItem[]
}
```

### `rmem read <document-path>`

Читає canonical Markdown document через контрольований rmem layer.

```bash
rmem read architecture/system.md
```

#### Аргументи

- `<document-path>` — шлях відносно `memoryRoot`.

#### Опції

Немає.

#### Відповідь

```ts
type ReadDocumentResponse = {
    ok: true
    document: DocumentReport
    content: string
    documentHash: string
    warnings: RmemWarning[]
}
```

`documentHash` використовується для optimistic concurrency у `rmem edit`.

### `rmem write <document-path> [--from <file>]`

Створює або повністю замінює document.

```bash
rmem write architecture/system.md --from ./system.md
```

Через stdin:

```bash
printf '# System\n\nBody\n' | rmem write architecture/system.md
```

#### Аргументи

- `<document-path>` — шлях відносно `memoryRoot`.

#### Опції

- `--from <file>` — прочитати content із UTF-8 файлу.

#### Вхід

Якщо `--from` не передано, content читається зі stdin.

Content має бути valid UTF-8.

Якщо content не містить frontmatter, CLI створює default frontmatter:

- `kind: overview`
- `status: draft`
- `memoryPath: ['project']`
- `language: mixed`
- `revision: 1`

#### Поведінка

Команда:

1. читає content
2. нормалізує line endings
3. створює або валідує frontmatter
4. оновлює metadata
5. генерує managed header
6. перевіряє Markdown structure
7. атомарно записує document
8. оновлює registry
9. оновлює structural places
10. перебудовує або позначає derived notes згідно `indexing.noteRebuildMode`

#### Відповідь

```ts
type WriteDocumentResponse = {
    ok: true
    document: DocumentReport
    created: boolean
    changed: boolean
    documentHash: string
    affected: {
        staleNotes: number
        rebuiltNotes: number
        structuralPlaces: number
    }
    warnings: RmemWarning[]
}
```

### `rmem edit <document-path>`

Застосовує exact text replacement edits.

```bash
rmem edit architecture/system.md < edit-request.json
```

#### Аргументи

- `<document-path>` — шлях відносно `memoryRoot`.

#### Опції

Немає.

#### Вхід

JSON через stdin:

```json
{
    "documentHash": "optional-current-document-hash",
    "edits": [
        {
            "oldText": "Exact text from the current document",
            "newText": "Replacement text"
        }
    ]
}
```

#### Правила

- `oldText` має збігтися рівно один раз.
- Якщо збігів немає: `OLD_TEXT_NOT_FOUND`.
- Якщо збігів більше одного: `OLD_TEXT_AMBIGUOUS`.
- Якщо `documentHash` не збігається: `DOCUMENT_HASH_MISMATCH`.
- Якщо JSON невалідний: `INVALID_EDIT_REQUEST`.
- Якщо результат має невалідний Markdown: `INVALID_MARKDOWN`.

#### Рекомендований workflow

```bash
rmem read architecture/system.md
```

Взяти `documentHash` і exact text із `content`, потім:

```bash
rmem edit architecture/system.md < edit-request.json
```

### `rmem remove <document-path>`

Архівує document.

```bash
rmem remove architecture/old-decision.md
```

#### Аргументи

- `<document-path>` — шлях відносно `memoryRoot`.

#### Опції

Немає.

#### Поведінка

Команда:

1. читає поточний document
2. змінює `rmem.status` на `archived`
3. збільшує `revision`
4. оновлює `updatedAt`
5. регенерує managed header
6. записує archived copy у `.rmem/archive/<document-path>`
7. оновлює canonical document у `memoryRoot`
8. позначає повʼязані notes як `archived`

Canonical file не видаляється фізично.

### `rmem check`

Перевіряє consistency памʼяті.

```bash
rmem check
```

#### Аргументи

Немає.

#### Опції

Немає.

#### Перевіряє

- invalid UTF-8
- invalid frontmatter
- invalid document kind/status/memory path
- invalid Markdown structure
- managed header mismatch
- duplicate document IDs
- missing registry records
- document hash drift
- note references to missing documents
- note references to missing structural places
- stale active notes
- structural places referencing missing documents

#### Відповідь

```ts
type CheckResponse = {
    ok: true
    valid: boolean
    issues: RmemWarning[]
}
```

## Dev commands

Dev commands не є public agent-facing API. Вони призначені для діагностики, rebuild і tracing.

### `rmem dev notes list`

Повертає всі notes із registry.

```bash
rmem dev notes list
```

### `rmem dev notes rebuild`

Перебудовує notes і structural places для всіх non-archived documents.

```bash
rmem dev notes rebuild
```

### `rmem dev docs parse <document-path>`

Парсить document і повертає `DocumentReport` та structural places.

```bash
rmem dev docs parse architecture/system.md
```

### `rmem dev index rebuild`

Alias для rebuild derived index.

```bash
rmem dev index rebuild
```

Поточна реалізація виконує той самий rebuild, що й:

```bash
rmem dev notes rebuild
```

### `rmem dev embeddings status`

Показує статус deterministic embedding provider.

```bash
rmem dev embeddings status
```

Відповідь містить:

- `provider`
- `indexedNotes`
- `dimensions`

### `rmem dev links validate`

Перевіряє, що note links вказують на наявні notes.

```bash
rmem dev links validate
```

### `rmem dev providers check`

Перевіряє доступність configured LLM і embedding providers.

```bash
rmem dev providers check
```

Для default config команда перевіряє:

- Ollama API на `http://localhost:11434`
- BGE-M3 server `/health` на `http://localhost:8765`

### `rmem dev search trace <query>`

Повертає search report разом із діагностичним trace.

```bash
rmem dev search trace "memory indexing"
```

## Provider setup

### Ollama local LLM on Windows

Встановіть Ollama for Windows і завантажте модель:

```powershell
ollama pull qwen2.5:7b
```

Якщо поточна shell-сесія ще не бачить `ollama` у `PATH`, використовуйте повний шлях:

```powershell
& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" pull qwen2.5:7b
```

Перевірка:

```powershell
Invoke-RestMethod http://localhost:11434/api/tags
```

### BGE-M3 embeddings on Windows without Docker

Bundled server:

```text
tools/bge-m3-server
```

Рекомендований ізольований runtime:

```text
.runtime/bge-m3-venv
```

`.runtime/` виключено з git.

Install:

```powershell
py -3.11 -m venv .runtime\bge-m3-venv
.\.runtime\bge-m3-venv\Scripts\python.exe -m pip install --upgrade pip
.\.runtime\bge-m3-venv\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cu121
.\.runtime\bge-m3-venv\Scripts\python.exe -m pip install -r tools\bge-m3-server\requirements.txt
.\.runtime\bge-m3-venv\Scripts\python.exe -m pip install --force-reinstall --no-deps --no-cache-dir torch==2.5.1+cu121 --index-url https://download.pytorch.org/whl/cu121
```

Run:

```powershell
.\.runtime\bge-m3-venv\Scripts\python.exe -m uvicorn server:app --app-dir tools\bge-m3-server --host 127.0.0.1 --port 8765
```

Health:

```powershell
Invoke-RestMethod http://localhost:8765/health
```

Expected GPU health on RTX 3060:

```json
{
    "ok": true,
    "model": "BAAI/bge-m3",
    "device": "cuda",
    "cuda": true,
    "gpu": "NVIDIA GeForce RTX 3060"
}
```

Check from rmem:

```bash
rmem dev providers check
```

## Формати відповідей

### Success response

Успішні команди повертають:

```json
{
    "ok": true
}
```

Конкретні поля залежать від команди.

### Error response

Помилки повертають:

```ts
type RmemCommandError = {
    ok: false
    code: string
    message: string
    details?: unknown
    suggestion?: string
}
```

CLI встановлює non-zero exit code для `ok: false`.

## Error codes

Поточні stable error codes:

```ts
type RmemErrorCode =
    | 'CONFIG_NOT_FOUND'
    | 'INVALID_CONFIG'
    | 'DOCUMENT_NOT_FOUND'
    | 'DOCUMENT_ALREADY_EXISTS'
    | 'DOCUMENT_HASH_MISMATCH'
    | 'INVALID_FRONTMATTER'
    | 'INVALID_DOCUMENT_KIND'
    | 'INVALID_DOCUMENT_STATUS'
    | 'INVALID_MEMORY_PATH'
    | 'INVALID_MARKDOWN'
    | 'ENCODING_ERROR'
    | 'OLD_TEXT_NOT_FOUND'
    | 'OLD_TEXT_AMBIGUOUS'
    | 'MANAGED_HEADER_MISMATCH'
    | 'DUPLICATE_DOCUMENT_ID'
    | 'BROKEN_LINK'
    | 'STALE_INDEX'
    | 'EMBEDDING_PROVIDER_FAILED'
    | 'LLM_PROVIDER_FAILED'
    | 'WRITE_FAILED'
    | 'INVALID_EDIT_REQUEST'
```

## Приклади workflows

### Створити документ

```bash
cat ./architecture.md | rmem write architecture/system.md
```

або:

```bash
rmem write architecture/system.md --from ./architecture.md
```

### Знайти знання

```bash
rmem search "system memory architecture"
```

### Безпечно відредагувати документ

Прочитати документ:

```bash
rmem read architecture/system.md
```

Створити `edit-request.json`:

```json
{
    "documentHash": "<hash from rmem read>",
    "edits": [
        {
            "oldText": "Old exact text",
            "newText": "New exact text"
        }
    ]
}
```

Застосувати:

```bash
rmem edit architecture/system.md < edit-request.json
```

### Перевірити памʼять

```bash
rmem check
```

### Перебудувати derived notes вручну

```bash
rmem dev notes rebuild
```

або:

```bash
rmem dev index rebuild
```

## Обмеження поточної реалізації

- Ollama LLM provider і FlagEmbedding HTTP provider реалізовані та перевіряються через `rmem dev providers check`.
- Search pipeline ще не повністю використовує real provider embeddings для persistent vector index.
- Markdown validation перевіряє базову структуру: headings і fenced code blocks.
- YAML parser підтримує контрактні структури config/frontmatter, але не є повною YAML бібліотекою.

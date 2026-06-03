# rmem-cli Documentation

`rmem-cli` — це TypeScript CLI для документно-орієнтованої семантичної памʼяті проєкту.

Канонічним джерелом знань є тільки Markdown-документи. Registry, structural places, notes, links, embeddings і search reports є похідними проєкціями та мають перебудовуватися з документів.

## Робоча модель

Команди виконуються з кореня проєкту:

```bash
cd /path/to/project
rmem check
```

Після першого `write` створюються:

```text
.rmem/
memory/
```

Усі команди повертають structured JSON. Human-readable режим окремо не реалізований.

## Конфігурація

Основний файл:

```text
.rmem/config.yaml
```

Якщо config відсутній, `rmem write` створює default config. Для сумісності підтримується fallback читання `.rmem/config.json`, але новий config записується як YAML.

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

### `schemaVersion`

Тип: `number`.

Версія схеми конфігурації. Поточне значення: `1`.

### `memoryRoot`

Тип: `string`.

Директорія canonical Markdown documents відносно кореня проєкту.

```yaml
memoryRoot: memory
```

Документ `architecture/system.md` фізично зберігається як:

```text
memory/architecture/system.md
```

### `areas`

Тип:

```ts
Record<string, {
    title: string
    description?: string
    parent?: string
}>
```

Описує semantic memory areas, які використовуються в `rmem.memoryPath` документів.

```yaml
areas:
  project:
    title: Project
    description: Загальна памʼять проєкту.

  architecture:
    title: Architecture
    description: Архітектура, компоненти та системні рішення.
    parent: project
```

### `indexing.noteRebuildMode`

Тип: `'sync' | 'manual'`.

- `sync` — після `write` або `edit` notes і vector index перебудовуються синхронно.
- `manual` — documents оновлюються, а projections перебудовуються через `rmem dev notes rebuild` або `rmem dev index rebuild`.

### `providers.llm`

Тип:

```ts
{
    type: 'ollama' | 'openai-compatible'
    endpoint: string
    model: string
    apiKey?: string
}
```

LLM використовується як semantic compiler для derived notes. Він не є canonical source of truth. Якщо provider недоступний або повертає негрунтований JSON, CLI використовує deterministic note compiler і додає warning `LLM_PROVIDER_FAILED`.

Ollama config:

```yaml
providers:
  llm:
    type: ollama
    endpoint: http://localhost:11434
    model: qwen2.5:7b
```

OpenAI-compatible local server config:

```yaml
providers:
  llm:
    type: openai-compatible
    endpoint: http://localhost:8080/v1
    model: local-model
    apiKey: optional-token
```

### `providers.embeddings`

Тип:

```ts
{
    type: 'flagembedding'
    endpoint: string
    model: string
}
```

Embedding provider будує persistent vector index у `.rmem/registry/state.json`. Якщо provider недоступний, CLI будує deterministic fallback index і додає warning `EMBEDDING_PROVIDER_FAILED`.

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

Internal registry містить:

- document records
- structural places
- derived notes
- note links
- vector index records
- hashes
- archive state

Цей файл не є canonical source of truth.

### `.rmem/archive/`

Містить archived snapshots після `rmem remove`.

`remove` не видаляє canonical file фізично. Він переводить документ у `status: archived`, записує archived copy і позначає повʼязані notes як `archived`.

### `memory/`

Canonical Markdown documents. Саме ці файли є джерелом знань.

## Document contract

Кожен документ має містити:

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

Managed header генерується CLI з frontmatter:

```md
<!-- rmem:managed-header start -->

# System Memory

...

<!-- rmem:managed-header end -->
```

Не редагуйте managed header вручну. Після `write`, `edit` і `remove` він регенерується.

## Public commands

Public commands — стабільний agent-facing API:

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

Повертає one-shot context report.

```bash
rmem search "архітектура памʼяті"
```

Аргументи:

- `<query>` — пошуковий запит; усі аргументи після `search` обʼєднуються в один рядок.

Опції: немає.

Поведінка:

- використовує lexical matching
- використовує persistent vector index, якщо він fresh
- використовує deterministic fallback vector, якщо provider/index недоступний
- додає note links як graph context
- повертає canonical document locations і recommended commands

Відповідь:

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

### `rmem list [memory-path]`

Показує configured memory areas і documents.

```bash
rmem list
rmem list project/architecture
```

Аргументи:

- `[memory-path]` — optional path у форматі `project/architecture`.

Опції: немає.

### `rmem read <document-path>`

Читає canonical Markdown document через контрольований rmem layer.

```bash
rmem read architecture/system.md
```

Аргументи:

- `<document-path>` — шлях відносно `memoryRoot`.

Відповідь містить `documentHash`, який використовується для optimistic concurrency у `rmem edit`.

### `rmem write <document-path> [--from <file>]`

Створює або повністю замінює document.

```bash
rmem write architecture/system.md --from ./system.md
```

Через stdin:

```bash
printf '# System\n\nBody\n' | rmem write architecture/system.md
```

Аргументи:

- `<document-path>` — шлях відносно `memoryRoot`.

Опції:

- `--from <file>` — прочитати content з UTF-8 файлу.

Поведінка:

1. читає UTF-8 input
2. нормалізує line endings
3. створює або валідує frontmatter
4. оновлює metadata
5. генерує managed header
6. валідує Markdown
7. атомарно записує document
8. оновлює registry
9. оновлює structural places
10. у `sync` режимі перебудовує notes і vector index

### `rmem edit <document-path>`

Застосовує exact text replacement edits.

```bash
rmem edit architecture/system.md < edit-request.json
```

Input JSON через stdin:

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

Правила:

- `oldText` має збігтися рівно один раз.
- Якщо збігів немає: `OLD_TEXT_NOT_FOUND`.
- Якщо збігів більше одного: `OLD_TEXT_AMBIGUOUS`.
- Якщо `documentHash` не збігається: `DOCUMENT_HASH_MISMATCH`.
- Якщо JSON невалідний: `INVALID_EDIT_REQUEST`.
- Якщо результат має невалідний Markdown: `INVALID_MARKDOWN`.

### `rmem remove <document-path>`

Архівує document.

```bash
rmem remove architecture/old-decision.md
```

Поведінка:

1. читає current document
2. змінює `rmem.status` на `archived`
3. збільшує `revision`
4. оновлює `updatedAt`
5. регенерує managed header
6. записує archived copy у `.rmem/archive/<document-path>`
7. оновлює canonical document у `memoryRoot`
8. позначає повʼязані notes як `archived`

### `rmem check`

Перевіряє consistency памʼяті.

```bash
rmem check
```

Перевіряє:

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

## Dev commands

Dev commands не є public agent-facing API. Вони призначені для діагностики, rebuild і tracing.

### `rmem dev notes list`

Повертає всі notes із registry.

```bash
rmem dev notes list
```

### `rmem dev notes rebuild`

Перебудовує notes, structural places і vector index для всіх non-archived documents.

```bash
rmem dev notes rebuild
```

Відповідь містить:

- `rebuiltNotes`
- `embeddings.provider`
- `embeddings.model`
- `embeddings.indexedNotes`
- `embeddings.dimensions`
- `embeddings.fallbackUsed`
- `warnings`

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

Еквівалентно:

```bash
rmem dev notes rebuild
```

### `rmem dev embeddings status`

Показує стан persistent vector index.

```bash
rmem dev embeddings status
```

Відповідь містить:

- `provider`
- `model`
- `indexedNotes`
- `dimensions`
- `fresh`

### `rmem dev links validate`

Перевіряє, що note links вказують на наявні notes.

```bash
rmem dev links validate
```

### `rmem dev providers check`

Перевіряє доступність configured providers.

```bash
rmem dev providers check
```

Default config перевіряє:

- Ollama API на `http://localhost:11434`
- BGE-M3 server `/health` на `http://localhost:8765`

### `rmem dev search trace <query>`

Повертає search report і diagnostic trace.

```bash
rmem dev search trace "memory indexing"
```

Trace містить кількість documents/notes, active notes, vector index metadata і search strategy.

## Provider setup

### Ollama local LLM on Windows

Встановіть Ollama for Windows і завантажте модель:

```powershell
ollama pull qwen2.5:7b
```

Якщо shell ще не бачить `ollama` у `PATH`:

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

`.runtime/` має бути виключено з Git.

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

## Response formats

### Success response

Команди повертають JSON з `ok: true` і command-specific fields.

```json
{
    "ok": true
}
```

### Error response

Помилки повертаються як structured command error:

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

## Workflows

### Створити документ

```bash
rmem write architecture/system.md --from ./architecture.md
```

### Знайти знання

```bash
rmem search "system memory architecture"
```

### Безпечно відредагувати документ

```bash
rmem read architecture/system.md
rmem edit architecture/system.md < edit-request.json
```

### Перевірити памʼять

```bash
rmem check
```

### Перебудувати projections вручну

```bash
rmem dev notes rebuild
```

або:

```bash
rmem dev index rebuild
```

## Поточні обмеження

- Markdown validation перевіряє базову структуру: headings і fenced code blocks.
- YAML parser підтримує контрактні структури config/frontmatter, але не є повною YAML бібліотекою.
- LLM note compiler має grounding guard: негрунтований output відкидається на користь deterministic compiler.
- Normal CI не має вимагати Ollama або BGE-M3; provider failures дають fallback warnings.

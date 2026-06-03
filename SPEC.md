# Технічне завдання: `rmem-cli` v1.0

## 1. Назва проєкту

`rmem-cli` — документно-орієнтована семантична система памʼяті проєкту для розробників та AI-агентів.

## 2. Мета проєкту

Реалізувати TypeScript CLI-утиліту для роботи з проєктною памʼяттю, яка зберігається у Markdown-документах, але надає агентам контрольований інтерфейс для пошуку, читання, редагування, перевірки та семантичного розгортання знань.

Система має замінити ненадійний пошук через `rg/cat/sed` по Markdown-файлах і надати агенту один стабільний інструмент для роботи з памʼяттю проєкту.

Головна ідея:

```text
Documents = canonical source of truth
Notes = semantic index nodes
Links = topology of knowledge
Embeddings = semantic retrieval layer
CLI = controlled operating interface for agents
```

## 3. Ключові принципи

### 3.1. Document-first architecture

Markdown-документи є канонічним джерелом знань.

Записки, індекси, embeddings, links, search reports — це похідні представлення. Вони можуть бути перебудовані з документів.

Агент не редагує записки напряму в основному режимі. Агент редагує документи через `rmem-cli`.

### 3.2. Agent-safe interface

Агенту доступний малий набір публічних команд:

```bash
rmem search <query>
rmem list [memory-path]
rmem read <document-path>
rmem write <document-path>
rmem edit <document-path>
rmem remove <document-path>
rmem check
```

Усі інші команди мають бути в `rmem dev ...` і не вважаються основним агентським API.

### 3.3. One-shot search

`rmem search` не має змушувати агента виконувати ланцюжок команд.

Команда має одразу повертати context report:

* релевантні записки;
* документи;
* конкретні місця в документах;
* semantic memory path;
* повʼязані знання;
* короткі excerpts;
* рекомендовані наступні команди.

### 3.4. File-like editing

Команди редагування документів мають бути схожі на знайомий агентам файловий workflow.

Основний механізм редагування:

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

`rmem edit` має працювати як exact replace:

* якщо `oldText` знайдено рівно один раз — замінити;
* якщо не знайдено — помилка;
* якщо знайдено кілька разів — помилка;
* після зміни виконати validation, metadata update, atomic write, index update.

### 3.5. LLM is a semantic compiler, not a source of truth

Локальна LLM використовується для:

* semantic segmentation;
* генерації typed notes;
* aliases;
* tags;
* relation proposals;
* contextual summaries.

LLM не є джерелом істини.

Поля, які описують канонічний зміст, мають базуватися лише на source content.

### 3.6. BGE-M3 is the retrieval layer

`BAAI/bge-m3` використовується як embedding-модель для:

* dense semantic retrieval;
* пошуку схожих записок;
* пошуку можливих дублікатів;
* candidate linking;
* semantic neighborhood detection.

BGE-M3 не виконує chunking, metadata extraction або редагування знань.

## 4. Технологічний стек

### 4.1. Основна мова

TypeScript.

### 4.2. Runtime

Node.js.

Рекомендований режим:

```text
ESM modules
strict TypeScript
pnpm workspace-ready structure
```

### 4.3. CLI

Рекомендована бібліотека: `commander` або еквівалентна легка CLI-бібліотека.

CLI має підтримувати:

* JSON output за замовчуванням для agent-facing команд;
* human-readable output як додатковий режим, якщо це нескладно;
* чіткі exit codes;
* стабільні error codes.

### 4.4. Markdown parsing

Потрібен parser для:

* YAML frontmatter;
* heading tree;
* Markdown body;
* managed header block;
* source offsets або source anchors.

Можна використати готові бібліотеки, але внутрішні контракти мають бути власними.

### 4.5. Storage

Canonical storage:

```text
Markdown files in memory root
```

Internal storage:

```text
.rmem/
    config.yaml
    registry/
    index/
    cache/
    archive/
```

Для v1.0 допустимі два варіанти:

1. JSONL/JSON registry + local vector index.
2. SQLite registry + external/local vector index.

Вибір реалізації має бути простим, але інтерфейси мають не привʼязувати доменну логіку до конкретного storage backend.

### 4.6. Embedding backend

Має бути абстракція:

```ts
export interface EmbeddingProvider {
    embedTexts(texts: string[]): Promise<EmbeddingVector[]>
}
```

Початковий backend може викликати локальний Python/HTTP service з BGE-M3 або інший локальний embedding service.

Не хардкодити BGE-M3 у доменну логіку.

### 4.7. LLM backend

Має бути абстракція:

```ts
export interface LocalLlmProvider {
    generateJson<TInput, TOutput>(
        task: LlmTask<TInput, TOutput>,
        input: TInput
    ): Promise<TOutput>
}
```

Початковий backend може працювати через локальний HTTP endpoint, Ollama-compatible API або інший адаптер.

Доменна логіка не має залежати від конкретної моделі.

## 5. Публічні agent-facing команди

## 5.1. `rmem search <query>`

### Призначення

Знайти релевантні знання в системі памʼяті та повернути готовий context report.

### Поведінка

Команда має виконати:

1. query normalization;
2. lexical search;
3. dense semantic search;
4. note retrieval;
5. document retrieval;
6. score fusion;
7. graph expansion;
8. source context extraction;
9. search report generation.

### Вихідний формат

```ts
export type SearchResponse = {
    ok: true
    query: string
    summary: string
    results: SearchResult[]
    recommendedReads: RecommendedRead[]
    warnings: RmemWarning[]
}
```

```ts
export type SearchResult = {
    rank: number
    score: number

    note?: {
        id: string
        title: string
        type: NoteType
        status: NoteStatus
        sourceSummary: string
        contextualizedSummary?: string
    }

    document: {
        path: string
        documentId: string
        title: string
        kind: DocumentKind
        status: DocumentStatus
        summary?: string
    }

    memoryPath: MemoryPathUnitReport[]

    targetPlace?: {
        placeId: string
        headingPath: string[]
        excerptBefore?: string
        excerpt: string
        excerptAfter?: string
    }

    linkedKnowledge: LinkedKnowledgeReport[]

    recommendedCommands: string[]
}
```

### Search budget

Публічна команда не повинна вимагати від агента налаштовувати `topK`, `depth`, `mode`.

Внутрішній default budget:

```ts
export type SearchBudget = {
    maxNoteCandidates: number
    maxDocumentCandidates: number
    maxFinalReports: number
    maxLinkedKnowledgePerReport: number
    maxExcerptChars: number
    maxGraphDistance: number
}
```

Рекомендовані значення:

```ts
export const defaultSearchBudget: SearchBudget = {
    maxNoteCandidates: 30,
    maxDocumentCandidates: 10,
    maxFinalReports: 5,
    maxLinkedKnowledgePerReport: 8,
    maxExcerptChars: 1200,
    maxGraphDistance: 1
}
```

## 5.2. `rmem list [memory-path]`

### Призначення

Показати вміст semantic memory path.

### Поведінка

Команда повертає:

* опис поточного memory path;
* дочірні areas;
* документи в цій області;
* короткий summary для кожного документа.

### Вихід

```ts
export type ListResponse = {
    ok: true
    path: string[]
    area?: MemoryAreaReport
    items: MemoryListItem[]
}
```

## 5.3. `rmem read <document-path>`

### Призначення

Прочитати документ як файл, але через контрольований rmem layer.

### Поведінка

Команда повертає:

* metadata;
* повний Markdown content;
* document hash;
* warnings, якщо документ має проблеми.

### Вихід

```ts
export type ReadDocumentResponse = {
    ok: true
    document: DocumentReport
    content: string
    documentHash: string
    warnings: RmemWarning[]
}
```

## 5.4. `rmem write <document-path>`

### Призначення

Створити або повністю замінити документ.

### Вхід

Content передається через stdin або `--from <file>`.

### Поведінка

Команда має:

1. прочитати content;
2. перевірити UTF-8;
3. нормалізувати frontmatter;
4. створити metadata, якщо документа немає;
5. оновити `updatedAt`, якщо документ існує;
6. не змінювати `createdAt`, якщо документ існує;
7. перегенерувати managed header;
8. провалідувати Markdown;
9. виконати atomic write;
10. оновити structural index;
11. позначити affected notes як stale;
12. запустити note regeneration або створити rebuild task згідно конфігурації;
13. оновити embeddings/index для affected notes, якщо rebuild sync mode увімкнений.

### Вихід

```ts
export type WriteDocumentResponse = {
    ok: true
    document: DocumentReport
    created: boolean
    changed: boolean
    documentHash: string
    affected: AffectedIndexReport
    warnings: RmemWarning[]
}
```

## 5.5. `rmem edit <document-path>`

### Призначення

Точково змінити документ через exact replace edits.

### Вхід

JSON через stdin:

```ts
export type EditDocumentRequest = {
    documentHash?: string
    edits: ExactTextEdit[]
}
```

```ts
export type ExactTextEdit = {
    oldText: string
    newText: string
}
```

### Поведінка

Команда має:

1. прочитати поточний документ;
2. якщо передано `documentHash`, перевірити його;
3. для кожного edit знайти `oldText`;
4. якщо `oldText` не знайдено — повернути помилку `OLD_TEXT_NOT_FOUND`;
5. якщо `oldText` знайдено більше одного разу — повернути `OLD_TEXT_AMBIGUOUS`;
6. застосувати всі edits до in-memory content;
7. оновити `updatedAt`;
8. збільшити `revision`;
9. перегенерувати managed header;
10. провалідувати результат;
11. виконати atomic write;
12. оновити structural index;
13. позначити affected notes як stale;
14. перебудувати affected projections згідно конфігурації.

### Помилки

```ts
export type EditErrorCode =
    | 'DOCUMENT_NOT_FOUND'
    | 'DOCUMENT_HASH_MISMATCH'
    | 'OLD_TEXT_NOT_FOUND'
    | 'OLD_TEXT_AMBIGUOUS'
    | 'INVALID_EDIT_REQUEST'
    | 'INVALID_MARKDOWN'
    | 'ENCODING_ERROR'
    | 'ANCHOR_REMOVED'
    | 'WRITE_FAILED'
```

## 5.6. `rmem remove <document-path>`

### Призначення

Архівувати документ.

### Поведінка

`remove` не має фізично видаляти документ за замовчуванням.

Команда має:

1. перемістити документ в `.rmem/archive`;
2. оновити registry;
3. позначити документ як archived;
4. позначити notes як orphaned або archived;
5. оновити search index;
6. повернути звіт.

Фізичне видалення можна реалізувати тільки як dev/admin command, не як agent-facing behavior.

## 5.7. `rmem check`

### Призначення

Перевірити цілісність системи памʼяті.

### Перевірки

Команда має перевірити:

* валідність UTF-8;
* валідність YAML frontmatter;
* унікальність `documentId`;
* коректність `createdAt` / `updatedAt`;
* коректність `kind` / `status`;
* існування `memoryPath` у config;
* відповідність managed header frontmatter;
* валідність Markdown structure;
* broken document links;
* broken note links;
* stale notes;
* orphan notes;
* outdated embeddings;
* відсутні structural places;
* дублікати note ids;
* documents missing in registry;
* registry records missing source files.

### Вихід

```ts
export type CheckResponse = {
    ok: boolean
    summary: {
        documents: number
        notes: number
        staleNotes: number
        orphanNotes: number
        errors: number
        warnings: number
    }
    errors: RmemError[]
    warnings: RmemWarning[]
}
```

## 6. Dev/internal commands

Dev-команди потрібні для розробки, діагностики й тестування. Вони не входять у стандартний agent-facing skill.

Namespace:

```bash
rmem dev ...
```

Обовʼязковий мінімум:

```bash
rmem dev notes list
rmem dev notes read <note-id>
rmem dev notes search <query>
rmem dev notes report <note-id>
rmem dev notes stale
rmem dev notes rebuild

rmem dev docs parse <document-path>
rmem dev docs outline <document-path>
rmem dev docs places <document-path>

rmem dev index status
rmem dev index rebuild
rmem dev index affected

rmem dev embeddings status
rmem dev embeddings rebuild
rmem dev embeddings inspect <note-id>

rmem dev links list <note-id>
rmem dev links validate

rmem dev search-trace <query>
rmem dev doctor
```

Dev-команди можуть мати більше опцій. Agent-facing команди мають залишатися простими.

## 7. Document Contract

## 7.1. Markdown document structure

Кожен документ має мати:

1. YAML frontmatter;
2. managed header;
3. Markdown body.

Приклад:

```md
---
title: Архітектура памʼяті проєкту
summary: >
  Документи є канонічним джерелом знань, а записки
  використовуються як семантичні індексні вузли.
tags:
  - rmem
  - architecture

rmem:
  schemaVersion: 1
  documentId: doc_memory_architecture
  kind: architecture
  status: active
  createdAt: 2026-06-03T14:20:00+03:00
  updatedAt: 2026-06-03T15:10:00+03:00
  revision: 1
  memoryPath:
    - project
    - architecture
    - memory
  language: uk
  aliases:
    - документно-орієнтована памʼять
    - document-first memory
---

<!-- rmem:managed-header start -->

# Архітектура памʼяті проєкту

**Тип документа:** architecture  
**Статус:** active  
**Створено:** 2026-06-03 14:20  
**Оновлено:** 2026-06-03 15:10  
**Ревізія:** 1  
**Локація памʼяті:** Project → Architecture → Memory  
**Мова:** uk  

**Короткий зміст:**  
Документи є канонічним джерелом знань, а записки використовуються як семантичні індексні вузли.

<!-- rmem:managed-header end -->

## Контекст

...
```

## 7.2. Frontmatter schema

```ts
export type RmemDocumentFrontmatter = {
    title: string
    summary?: string
    tags?: string[]

    rmem: {
        schemaVersion: number
        documentId: string
        kind: DocumentKind
        status: DocumentStatus

        createdAt: string
        updatedAt: string
        revision: number

        memoryPath: string[]
        language: DocumentLanguage

        aliases?: string[]
        review?: {
            required: boolean
            reason?: string
        }
    }
}
```

```ts
export type DocumentKind =
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

```ts
export type DocumentStatus =
    | 'draft'
    | 'active'
    | 'deprecated'
    | 'archived'
    | 'needs-review'
```

```ts
export type DocumentLanguage =
    | 'uk'
    | 'en'
    | 'mixed'
```

## 7.3. Managed header rules

Managed header is generated from frontmatter.

Agents must not manually edit:

```md
<!-- rmem:managed-header start -->
...
<!-- rmem:managed-header end -->
```

`rmem-cli` must:

* create managed header if missing;
* update managed header after write/edit;
* report mismatch in `rmem check`;
* never treat managed header as canonical source content for notes.

## 7.4. Content hashing

Document content hash must be computed from normalized canonical content.

Hash should exclude:

* volatile index data;
* external registry data.

Recommended approach:

```text
hash = hash(frontmatter normalized without updatedAt? + body without managed header)
```

Important: avoid hash loops where updating hash changes content and changes hash again.

Do not store `contentHash` in frontmatter for v1.0. Store hashes in internal registry.

## 8. StructuralPlace Contract

Structural places represent addressable locations inside documents.

```ts
export type StructuralPlace = {
    id: string
    documentId: string
    documentPath: string

    headingPath: string[]
    title: string
    level: number
    orderIndex: number

    startOffset?: number
    endOffset?: number

    sourceHash: string
    summary?: string
}
```

Rules:

* generated from Markdown heading tree;
* body before first heading belongs to root place;
* code blocks and tables must not be split internally;
* very large sections may be internally segmented for note generation, but structural place remains document-level anchor;
* if heading changes, system should try to preserve place identity using previous hash and surrounding context.

## 9. Note Contract

Notes are semantic index nodes derived from document content.

```ts
export type MemoryNote = {
    id: string
    type: NoteType
    status: NoteStatus

    title: string

    sourceSummary: string
    canonicalStatement: string
    contextualizedSummary?: string

    retrievalText: string

    tags: string[]
    aliases: string[]
    entities: string[]

    source: {
        documentId: string
        documentPath: string
        structuralPlaceId: string
        headingPath: string[]
        sourceQuote: string
        sourceHash: string
    }

    links: NoteLink[]

    generated: {
        generator: string
        generatedAt: string
        sourceDocumentRevision: number
    }
}
```

```ts
export type NoteType =
    | 'concept'
    | 'fact'
    | 'rule'
    | 'decision'
    | 'warning'
    | 'example'
    | 'task'
    | 'question'
    | 'procedure'
```

```ts
export type NoteStatus =
    | 'active'
    | 'stale'
    | 'orphaned'
    | 'superseded'
    | 'needs-review'
    | 'archived'
```

## 9.1. Note grounding rules

`sourceSummary` and `canonicalStatement` must be based only on source content.

`contextualizedSummary` may use linked notes and broader memory context.

`retrievalText` may include:

* note title;
* type;
* source summary;
* canonical statement;
* contextualized summary;
* tags;
* aliases;
* entities;
* document title;
* memory path.

`retrievalText` is generated, not manually edited.

## 10. Link Contract

```ts
export type NoteLink = {
    targetNoteId: string
    type: NoteLinkType
    direction: 'outgoing'
    reason?: string
    confidence?: number
}
```

```ts
export type NoteLinkType =
    | 'source_of'
    | 'related_to'
    | 'depends_on'
    | 'refines'
    | 'example_of'
    | 'contradicts'
    | 'supersedes'
```

Rules:

* `source_of` links note to source structural place/document.
* `related_to`, `depends_on`, `refines`, `example_of` may be auto-applied above confidence threshold.
* `contradicts` and `supersedes` must be proposals unless explicitly confirmed.
* no automatic content rewrite of existing notes based on reverse linking.
* reverse linking may add links, aliases or tags only when safe.

## 11. Memory path config

Memory areas are configured separately from documents.

Example `.rmem/config.yaml`:

```yaml
schemaVersion: 1

memoryRoot: memory

areas:
  project:
    title: Project
    description: Загальна памʼять проєкту: правила, рішення, архітектура, контекст і робочі домовленості.

  architecture:
    title: Architecture
    description: Архітектура, компоненти, межі відповідальності та системні рішення.
    parent: project

  memory:
    title: Memory
    description: Система памʼяті, індексація, пошук і агентські протоколи.
    parent: architecture
```

`rmem check` must validate that each document `memoryPath` exists in config.

## 12. Note generation pipeline

## 12.1. Overview

The note generation pipeline must convert document structural places into semantic notes.

Pipeline:

```text
StructuralPlace
    ↓
semantic segmentation by local LLM
    ↓
BGE-M3 retrieves related existing notes
    ↓
LLM synthesizes typed notes
    ↓
validator checks grounding and schema
    ↓
BGE-M3 embeds generated notes
    ↓
candidate duplicate/link detection
    ↓
reverse link proposals
    ↓
commit safe changes
```

## 12.2. Stage A: semantic segmentation

Input:

```ts
export type SemanticSegmentationInput = {
    document: {
        documentId: string
        path: string
        title: string
        summary?: string
        kind: DocumentKind
    }

    memoryPath: MemoryPathUnitReport[]

    documentOutline: {
        placeId: string
        headingPath: string[]
        summary?: string
    }[]

    structuralPlace: {
        placeId: string
        headingPath: string[]
        beforeSummary?: string
        afterSummary?: string
    }

    content: string
}
```

Output:

```ts
export type SemanticSegmentationOutput = {
    segments: SemanticSegment[]
}
```

```ts
export type SemanticSegment = {
    id: string
    title: string
    segmentType: NoteType
    sourceQuote: string
    reason: string
    shouldBecomeNote: boolean
}
```

Rules:

* `sourceQuote` must exist in source content;
* segment must represent a meaningful unit;
* do not create notes for filler, repeated text or purely stylistic passages.

## 12.3. Stage B: candidate linking

For each segment:

1. build segment retrieval text;
2. run dense search over existing active notes;
3. run lexical search over titles/tags/entities/aliases;
4. merge top candidates.

```ts
export type CandidateLinkedNote = {
    noteId: string
    title: string
    type: NoteType
    status: NoteStatus
    summary: string
    score: number
    relationHint?: string
}
```

## 12.4. Stage C: note synthesis

Input:

```ts
export type NoteSynthesisInput = {
    document: DocumentReport
    memoryPath: MemoryPathUnitReport[]
    structuralPlace: StructuralPlace
    segment: SemanticSegment
    relatedNotes: CandidateLinkedNote[]
}
```

Output:

```ts
export type GeneratedNoteDraft = {
    type: NoteType
    title: string

    sourceSummary: string
    canonicalStatement: string
    contextualizedSummary?: string

    tags: string[]
    aliases: string[]
    entities: string[]

    links: ProposedNoteLink[]
}
```

```ts
export type ProposedNoteLink = {
    targetNoteId: string
    type: NoteLinkType
    reason: string
    confidence: number
}
```

Rules:

* source fields must not include facts from related notes;
* contextualized fields may reference related notes;
* generated note must be short enough for retrieval;
* note title must be self-contained.

## 12.5. Stage D: validation

Validator must check:

* valid schema;
* required fields;
* sourceQuote exists;
* links target existing notes;
* status is valid;
* note is not empty;
* note is not too long;
* no duplicated aliases/tags;
* source fields do not obviously include entities absent from source content, unless those entities are document-level metadata.

## 12.6. Stage E: embedding and duplicate detection

After validation:

1. build `retrievalText`;
2. generate embedding;
3. search for semantic duplicates;
4. if strong duplicate is found, mark new note as `needs-review` or link as `refines`;
5. do not silently delete or merge notes.

## 12.7. Stage F: reverse linking

For each new active note:

1. inspect top related existing notes;
2. propose backlinks;
3. auto-apply safe high-confidence links;
4. store risky changes as proposals.

Allowed automatic operations:

```text
add_link
add_tag
add_alias
```

Disallowed automatic operations:

```text
rewrite existing note content
delete note
merge notes
mark contradiction as final
supersede existing note as final
```

## 13. Indexing and synchronization

## 13.1. Registry records

Internal registry must track:

* documents;
* structural places;
* notes;
* links;
* embeddings;
* stale status;
* archive state.

## 13.2. After document write/edit

System must:

1. parse document;
2. update document registry;
3. update structural places;
4. detect affected places;
5. mark affected notes as stale;
6. regenerate affected notes according to sync policy;
7. update embeddings;
8. update search index.

## 13.3. Sync policy

v1.0 must support config:

```yaml
indexing:
  noteRebuildMode: sync
```

Allowed values:

```text
sync
manual
```

For `sync`:

* write/edit waits for affected note rebuild.

For `manual`:

* write/edit marks notes stale;
* `rmem dev notes rebuild` rebuilds notes.

Default for v1.0:

```text
sync
```

Agent-facing behavior must be correct even if some notes are stale. Search reports must clearly mark stale notes.

## 14. Error Contract

All commands return structured errors.

```ts
export type RmemCommandError = {
    ok: false
    code: string
    message: string
    details?: unknown
    suggestion?: string
}
```

Common error codes:

```ts
export type RmemErrorCode =
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
```

Each error must include a practical `suggestion` when possible.

## 15. Atomic write and encoding

All document writes must be atomic:

```text
write temp file
fsync temp file if practical
rename temp file to target path
```

Before writing:

* validate UTF-8;
* normalize line endings if configured;
* validate Markdown/frontmatter.

After writing:

* re-read file;
* verify content;
* update registry.

Never use partial writes for canonical documents.

## 16. TypeScript project structure

Recommended structure:

```text
packages/
  rmem-core/
    src/
      domain/
      documents/
      markdown/
      notes/
      links/
      search/
      indexing/
      embeddings/
      llm/
      storage/
      validation/
      errors/
  rmem-cli/
    src/
      commands/
      output/
      main.ts
  rmem-testkit/
    src/
      fixtures/
      helpers/
```

If not using a workspace initially, keep the same folder boundaries inside `src/`.

## 17. Code style

Use the following style:

* 4 spaces indentation;
* ESM modules;
* single quotes;
* no semicolons unless required;
* always use braces after control statements;
* strict TypeScript;
* avoid `any`;
* account for `undefined` from array access, `Map.get`, optional config fields;
* domain types must be explicit;
* IO code must be separated from domain logic.

Example:

```ts
export function assertDocumentKind(value: string): DocumentKind {
    if (isDocumentKind(value)) {
        return value
    }

    throw createRmemError({
        code: 'INVALID_DOCUMENT_KIND',
        message: `Invalid document kind: ${value}`,
        suggestion: 'Use one of the supported document kinds.'
    })
}
```

## 18. Testing strategy

The project must use focused testing based on contracts and critical workflows.

Do not write tests for every trivial function.

### 18.1. Required test categories

#### Contract tests

Must cover:

* Document Contract;
* Edit Contract;
* Note Contract;
* Search Report Contract;
* Error Contract.

#### Golden fixture tests

Create fixtures:

```text
fixtures/
  wiki-small/
  wiki-ukrainian-inflections/
  wiki-agent-rules/
  wiki-architecture-decisions/
  wiki-broken-documents/
```

Golden tests should verify:

* document parsing;
* frontmatter normalization;
* managed header generation;
* structural places extraction;
* search top results for known queries;
* stale note behavior;
* broken link detection;
* edit failure behavior.

#### Integration tests

Must cover full workflows:

```text
init memory
write document
search
read
edit document
check
search updated knowledge
remove document
check archive state
```

#### LLM-dependent tests

Do not assert exact generated text.

Assert properties:

* valid JSON;
* required fields exist;
* note count within expected range;
* note type is valid;
* sourceQuote exists in source;
* generated links target existing notes;
* no invalid status/type values.

Use mocked LLM provider for deterministic CI tests.

Real local LLM tests may be optional/manual.

#### Embedding tests

Use mocked embedding provider for deterministic CI tests.

Real BGE-M3 tests may be optional/manual.

### 18.2. Test budget principle

Test critical contracts and flows, not implementation details.

Do not create tests just to increase coverage numbers.

The goal is confidence in system behavior, not ceremonial test confetti.

## 19. Acceptance criteria for v1.0

The implementation is considered complete when:

1. Public CLI commands work:

   * `search`
   * `list`
   * `read`
   * `write`
   * `edit`
   * `remove`
   * `check`

2. Documents have:

   * valid frontmatter;
   * managed header;
   * stable document ID;
   * created/updated dates;
   * revision;
   * kind/status/language;
   * memoryPath.

3. `rmem edit` supports exact replace with:

   * hash check;
   * ambiguity detection;
   * atomic write;
   * metadata update;
   * validation.

4. Search returns one-shot context report with:

   * relevant notes;
   * documents;
   * target excerpts;
   * memory path descriptions;
   * linked knowledge;
   * recommended commands.

5. Note generation pipeline exists:

   * segmentation;
   * candidate retrieval;
   * typed note synthesis;
   * validation;
   * embedding;
   * link proposal;
   * reverse link safe updates.

6. Notes are clearly derived from documents:

   * status tracking;
   * stale detection;
   * source mapping;
   * source hash/revision tracking.

7. `rmem check` detects:

   * broken metadata;
   * broken links;
   * stale notes;
   * orphan notes;
   * invalid frontmatter;
   * managed header mismatch;
   * duplicate document IDs.

8. Dev commands exist for:

   * notes inspection;
   * docs parsing;
   * index rebuild;
   * embeddings status;
   * links validation;
   * search tracing.

9. Test suite covers:

   * contracts;
   * golden fixtures;
   * critical workflows;
   * mocked LLM;
   * mocked embeddings.

10. No agent-facing workflow requires direct use of `rg`, `cat`, `sed` or direct Markdown file editing.

## 20. Non-goals for v1.0

The following are not required:

* web UI;
* multi-user permissions;
* remote sync;
* cloud storage;
* distributed indexing;
* automatic Git commit management;
* full Ukrainian lemmatization;
* visual graph explorer;
* automatic destructive merge/delete of notes;
* direct agent-facing note editing.

## 21. Agent implementation rules

The implementing agent must follow these rules:

1. Do not edit memory documents directly outside `rmem-cli` workflows when testing the tool behavior.
2. Do not expose dev commands as normal agent-facing commands.
3. Keep domain logic independent from CLI parsing.
4. Keep providers abstract:

   * LLM provider;
   * embedding provider;
   * vector index provider;
   * registry storage.
5. Do not hardcode model-specific behavior in domain logic.
6. Always return structured JSON for agent-facing commands.
7. Always use stable error codes.
8. Do not silently ignore validation errors.
9. Do not auto-rewrite existing note content during reverse linking.
10. Treat Markdown documents as canonical source of truth.

## 22. Recommended implementation order

1. Project skeleton and TypeScript config.
2. Error/result contract.
3. Config loader.
4. Document frontmatter parser and validator.
5. Managed header generator.
6. Markdown structural parser.
7. Registry storage.
8. Public document commands:

   * list
   * read
   * write
   * edit
   * remove
   * check
9. Note data model.
10. Mock LLM provider and note generation pipeline.
11. Mock embedding provider and vector index abstraction.
12. Search pipeline with mocked providers.
13. Dev commands.
14. Real embedding provider adapter.
15. Real local LLM provider adapter.
16. Golden fixtures and integration tests.
17. Final validation against acceptance criteria.

## 23. Final product definition

`rmem-cli` v1.0 is complete when it behaves as a semantic file system for project memory:

```text
Agent searches once.
Agent receives a context report.
Agent reads canonical documents.
Agent edits documents through safe file-like commands.
rmem maintains metadata, notes, links, indexes and validation.
Documents remain the source of truth.
```

The system must make project memory searchable, editable and safe for agents without requiring agents to manually explore Markdown files or reconstruct context through repeated low-level search commands.

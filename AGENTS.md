# AGENTS.md

## Project

`rmem-cli` is a TypeScript CLI utility for document-oriented semantic project memory.

The system stores canonical knowledge in Markdown documents and builds derived semantic indexes, notes, links, embeddings, and search reports for AI agents and developers.

The primary goal is to provide a safe, controlled interface for project memory instead of relying on direct `rg`, `cat`, `sed`, or uncontrolled Markdown editing.

## Core Architecture

The project follows a document-first architecture.

```text
Documents = canonical source of truth
Notes = derived semantic index nodes
Links = topology of knowledge
Embeddings = semantic retrieval layer
CLI = controlled operating interface for agents
```

Markdown documents are the only canonical source of project knowledge.

Notes, links, embeddings, registries, indexes, and reports are derived projections and must be rebuildable from the documents.

## Critical Rules

### 1. Preserve UTF-8 Encoding

All project files must use UTF-8 encoding.

This applies to:

* TypeScript source files
* Markdown documents
* YAML files
* JSON / JSONL files
* fixtures
* test data
* generated registry files
* generated index files
* documentation

Do not introduce files with broken encoding, legacy encodings, mixed encodings, or invalid UTF-8 byte sequences.

When implementing file writes:

* validate input as UTF-8
* write output as UTF-8
* avoid lossy transcoding
* avoid platform-default encodings
* preserve Ukrainian text correctly
* normalize only when explicitly required by the project logic

If a file has invalid UTF-8, the tool must report an error instead of silently rewriting or corrupting it.

### 2. Documents Are Canonical

Do not treat notes, embeddings, or indexes as canonical data.

Documents are edited through public document commands:

```bash
rmem read <document-path>
rmem write <document-path>
rmem edit <document-path>
rmem remove <document-path>
```

Notes and indexes are internal projections.

Do not design workflows where agents edit notes as the main source of knowledge.

### 3. Agent-Facing API Must Stay Small

The public agent-facing CLI consists of:

```bash
rmem search <query>
rmem list [memory-path]
rmem read <document-path>
rmem write <document-path>
rmem edit <document-path>
rmem remove <document-path>
rmem check
```

Do not add new public commands unless the project specification explicitly requires them.

Diagnostic and development commands must be placed under:

```bash
rmem dev ...
```

Public commands must be stable, predictable, and suitable for AI agents.

### 4. Search Must Be One-Shot

`rmem search` must return a complete context report.

The agent should not need to run a chain of commands such as:

```bash
search -> note read -> note expand -> doc outline -> doc section -> related
```

Instead, `rmem search <query>` should return:

* relevant notes
* relevant documents
* document locations
* memory path descriptions
* target excerpts
* linked knowledge
* recommended next commands
* warnings about stale or incomplete data

### 5. Editing Must Be File-Like and Safe

`rmem edit` uses exact text replacement.

Expected request format:

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

Rules:

* `oldText` must match exactly once
* zero matches must return `OLD_TEXT_NOT_FOUND`
* multiple matches must return `OLD_TEXT_AMBIGUOUS`
* hash mismatch must return `DOCUMENT_HASH_MISMATCH`
* invalid Markdown must return `INVALID_MARKDOWN`
* invalid UTF-8 must return `ENCODING_ERROR`
* writes must be atomic

Do not implement fuzzy editing for public agent-facing workflows.

### 6. Never Silently Corrupt Project Memory

File writes must be atomic.

Required write flow:

```text
validate input
prepare new content in memory
validate Markdown/frontmatter
write temporary file
verify written content
rename temporary file to target path
update registry/index state
```

Never partially write canonical documents.

Never silently ignore validation errors.

Never silently repair broken files without reporting what was changed.

## TypeScript Rules

Use strict TypeScript.

Project code must follow these style rules:

* 4 spaces indentation
* ESM modules
* single quotes
* avoid semicolons unless required
* always use braces after control statements
* avoid `any`
* account for `undefined` from array access, `Map.get`, optional properties, and parsed input
* keep domain logic separate from CLI parsing
* keep IO logic separate from pure domain logic
* prefer explicit domain types over loose objects
* use stable error codes
* return structured results from command handlers

Example style:

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

## Project Structure

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

If the project is not implemented as a workspace at the beginning, keep the same logical boundaries inside `src/`.

Do not mix CLI command parsing with domain services.

Do not make storage, LLM, or embedding providers global hidden dependencies.

## Provider Abstractions

The project must keep external model integrations behind interfaces.

### Embedding Provider

```ts
export interface EmbeddingProvider {
    embedTexts(texts: string[]): Promise<EmbeddingVector[]>
}
```

The initial target model is `BAAI/bge-m3`, but domain logic must not be hardcoded to BGE-M3.

### Local LLM Provider

```ts
export interface LocalLlmProvider {
    generateJson<TInput, TOutput>(
        task: LlmTask<TInput, TOutput>,
        input: TInput
    ): Promise<TOutput>
}
```

The local LLM is used as a semantic compiler for notes.

It must not be treated as a canonical source of truth.

## Document Contract

Each memory document must contain:

1. YAML frontmatter
2. managed header
3. Markdown body

Example:

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

The managed header is generated by `rmem-cli`.

Agents and implementation code must not treat managed header content as canonical knowledge for note generation.

## Frontmatter Schema

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

Supported document kinds:

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

Supported statuses:

```ts
export type DocumentStatus =
    | 'draft'
    | 'active'
    | 'deprecated'
    | 'archived'
    | 'needs-review'
```

Supported languages:

```ts
export type DocumentLanguage =
    | 'uk'
    | 'en'
    | 'mixed'
```

## Note Contract

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

Supported note types:

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

Supported note statuses:

```ts
export type NoteStatus =
    | 'active'
    | 'stale'
    | 'orphaned'
    | 'superseded'
    | 'needs-review'
    | 'archived'
```

Rules:

* `sourceSummary` must be grounded in source content
* `canonicalStatement` must be grounded in source content
* `contextualizedSummary` may use related notes
* `retrievalText` is generated, not manually edited
* stale notes must be marked clearly in search results
* notes must not silently become canonical truth

## Link Contract

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

Automatic reverse linking may safely add:

* links
* tags
* aliases

Automatic reverse linking must not:

* rewrite existing note content
* delete notes
* merge notes
* mark contradictions as final
* supersede notes as final

Risky changes must be stored as proposals or marked `needs-review`.

## Error Handling

All command errors must be structured.

```ts
export type RmemCommandError = {
    ok: false
    code: string
    message: string
    details?: unknown
    suggestion?: string
}
```

Use stable error codes.

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

Do not throw raw errors from command handlers.

Convert internal failures into structured command errors.

## Testing Strategy

Use focused tests based on contracts and critical workflows.

Do not write tests for every trivial helper.

Required test groups:

### Contract Tests

Cover:

* Document Contract
* Edit Contract
* Note Contract
* Search Report Contract
* Error Contract
* UTF-8 validation behavior

### Golden Fixture Tests

Use fixtures:

```text
fixtures/
    wiki-small/
    wiki-ukrainian-inflections/
    wiki-agent-rules/
    wiki-architecture-decisions/
    wiki-broken-documents/
```

Verify:

* document parsing
* frontmatter normalization
* managed header generation
* structural places extraction
* search top results for known queries
* stale note behavior
* broken link detection
* edit failure behavior
* invalid UTF-8 detection

### Integration Tests

Cover complete workflows:

```text
write document
search
read
edit document
check
search updated knowledge
remove document
check archive state
```

### LLM and Embedding Tests

Use mocked providers for deterministic automated tests.

Do not require local LLM or BGE-M3 for normal CI.

Real local model tests may be manual or optional.

For LLM-dependent tests, assert properties, not exact wording:

* valid JSON
* required fields exist
* note type is valid
* sourceQuote exists in source content
* links target existing notes
* generated content does not violate note grounding rules

## Implementation Order

Recommended implementation order:

1. Project skeleton and TypeScript config
2. Shared result/error contract
3. Config loader
4. UTF-8 validation utilities
5. Document frontmatter parser and validator
6. Managed header generator
7. Markdown structural parser
8. Registry storage
9. Public document commands:

   * list
   * read
   * write
   * edit
   * remove
   * check
10. Note model
11. Mock LLM provider
12. Note generation pipeline
13. Mock embedding provider
14. Vector index abstraction
15. Search pipeline
16. Dev commands
17. Real embedding provider adapter
18. Real local LLM provider adapter
19. Golden fixtures
20. Integration tests
21. Final validation against acceptance criteria

## Acceptance Criteria

The project is ready when:

1. Public commands work:

   * `search`
   * `list`
   * `read`
   * `write`
   * `edit`
   * `remove`
   * `check`

2. All project files are valid UTF-8.

3. Documents have:

   * valid frontmatter
   * managed header
   * stable document ID
   * created/updated dates
   * revision
   * kind/status/language
   * memoryPath

4. `rmem edit` supports:

   * exact replacement
   * hash check
   * ambiguity detection
   * atomic write
   * metadata update
   * validation

5. Search returns a one-shot context report with:

   * relevant notes
   * documents
   * target excerpts
   * memory path descriptions
   * linked knowledge
   * recommended commands

6. Notes are derived from documents and include:

   * status tracking
   * stale detection
   * source mapping
   * source hash or revision tracking

7. `rmem check` detects:

   * invalid UTF-8
   * broken metadata
   * broken links
   * stale notes
   * orphan notes
   * invalid frontmatter
   * managed header mismatch
   * duplicate document IDs

8. Dev commands exist for:

   * notes inspection
   * docs parsing
   * index rebuild
   * embeddings status
   * links validation
   * search tracing

9. The test suite covers:

   * contracts
   * golden fixtures
   * critical workflows
   * mocked LLM
   * mocked embeddings

10. No normal agent-facing workflow requires direct use of `rg`, `cat`, `sed`, or direct Markdown file editing.

## Non-Goals

Do not implement unless explicitly requested:

* web UI
* multi-user permissions
* cloud sync
* remote collaboration
* distributed indexing
* automatic Git commit management
* visual graph explorer
* direct agent-facing note editing
* automatic destructive note merge/delete
* full Ukrainian lemmatization

## Final Instruction for Agents

Implement the system as a reliable semantic file system for project memory.

The agent should search once, receive a context report, read canonical documents, edit documents through safe file-like commands, and rely on `rmem-cli` to maintain metadata, notes, links, indexes, and validation.

Do not bypass the CLI design by directly manipulating memory documents or internal indexes.

Do not corrupt Ukrainian text.

Do not introduce non-UTF-8 files.

Do not treat generated notes as canonical truth.

# rmem-cli Architecture

`rmem-cli` реалізує document-first памʼять проєкту: Markdown-документи є єдиним канонічним джерелом знань, а registry, structural places, notes, links, embeddings і search reports є похідними projections.

Цей документ фіксує поточну архітектуру реалізації, межі відповідальності модулів і production-ready інваріанти, які не можна порушувати під час подальшого refactor.

## Архітектурна модель

```text
Markdown documents
    ↓ parse + validate
Frontmatter + managed header + body
    ↓ structural extraction
Structural places
    ↓ deterministic or LLM semantic compiler
Memory notes
    ↓ embedding provider
Vector index
    ↓ one-shot search
Search report
```

Канонічним станом є тільки файли в `memoryRoot`. Усі дані в `.rmem/registry/state.json` мають бути rebuildable з документів.

## Workspace boundaries

```text
packages/
    rmem-core/
        src/
            domain/
            documents/
            errors/
            indexing/
            notes/
            providers/
            search/
            storage/
            validation/
            commands/
                public.ts
                dev.ts
                internal.ts
                index.ts
            config.ts
            index.ts
            *.ts compatibility entrypoints
    rmem-cli/
        src/
            main.ts
tests/
tools/
```

Поточна структура має logical folders для domain, documents, validation, projections, providers і storage. Старі root-level файли в `packages/rmem-core/src/*.ts` залишаються compatibility entrypoints, щоб не ламати public exports з `@rmem/core`.

## Core module map

| Модуль | Відповідальність | Не повинен робити |
| --- | --- | --- |
| `domain/types.ts` | Domain contracts, command responses, provider interfaces | Виконувати IO або provider calls |
| `domain/hash.ts` | Stable hashing and line-ending normalization | Знати про filesystem paths |
| `domain/ids.ts` | Stable slug/document/place IDs | Читати або писати files |
| `errors/index.ts` | Structured command errors | Кидати raw CLI-specific помилки |
| `validation/encoding.ts` | UTF-8 validation | Робити lossy transcoding |
| `config.ts` | Load/default/validate `.rmem/config.yaml` | Ініціалізувати providers глобально |
| `documents/frontmatter.ts` | Parse/serialize supported YAML subset і document frontmatter | Приймати unsupported YAML silently |
| `documents/managed-header.ts` | Generate/replace/check managed header | Використовувати header як canonical knowledge |
| `documents/markdown.ts` | Markdown validation і structural place extraction | Виконувати semantic note generation |
| `storage/index.ts` | Registry IO, path resolution, atomic UTF-8 writes | Змінювати domain state без command layer |
| `notes/index.ts` | Deterministic/LLM note generation і grounding validation | Трактувати notes як canonical source |
| `indexing/embeddings.ts` | Mock embeddings, vector index build, freshness checks | Знати деталі HTTP provider contract |
| `providers/index.ts` | Ollama/OpenAI-compatible/FlagEmbedding adapters | Впливати на canonical documents |
| `search/index.ts` | One-shot search report composition | Вимагати agent command chaining |
| `commands/public.ts` | Public agent-facing command orchestration | Змішувати dev diagnostics або CLI parsing |
| `commands/dev.ts` | Diagnostic/development command orchestration | Додавати agent-facing workflows |
| `commands/internal.ts` | Shared command helpers for registry, notes and vector rebuilds | Ставати public workflow API |

## CLI boundary

`packages/rmem-cli/src/main.ts` відповідає тільки за:

- parsing `process.argv`
- читання stdin або `--from`
- виклик command handlers з `@rmem/core`
- JSON output
- process exit code

У CLI layer не повинно бути document parsing, registry mutation, provider logic або search ranking.

## Public command contract

Стабільна agent-facing поверхня:

```bash
rmem search <query>
rmem list [memory-path]
rmem read <document-path>
rmem write <document-path> [--from <file>]
rmem edit <document-path>
rmem remove <document-path>
rmem check
```

`rmem --version` є package metadata command, а не workflow command.

Усі diagnostic команди залишаються під `rmem dev ...`. Це зберігає малу public API поверхню й не змушує agent workflows працювати з internal projections напряму.

## Write/edit invariants

Canonical document writes мають проходити через такий порядок:

```text
normalize input in memory
validate UTF-8
parse frontmatter
validate Markdown
generate managed header
write canonical document atomically
verify registry projections
save registry atomically
```

`rmem edit` використовує тільки exact replacement:

- `oldText` має знайтися рівно один раз
- optional `documentHash` захищає від stale edits
- metadata revision/update time оновлюються command layer
- invalid Markdown/frontmatter блокує write
- generated projections не є fallback canonical state

## Registry and projection invariants

`.rmem/registry/state.json` містить:

- document records
- structural places
- derived notes
- optional vector index

Registry може бути stale або відсутнім, але не має бути єдиним джерелом знань. `rmem check` повинен виявляти drift між documents і registry, а `rmem dev notes rebuild` / `rmem dev index rebuild` мають відновлювати projections.

## Note generation

Notes генеруються з document body без managed header. Поточний pipeline:

1. extraction of structural places
2. LLM note compiler, якщо provider налаштований і доступний
3. grounding validation
4. deterministic fallback для ungrounded або failed LLM output
5. stale marking для попередніх notes цього document

LLM output не приймається як істина. Якщо `sourceQuote` не є exact substring source content або statement не проходить grounding guard, note замінюється deterministic fallback і warning повертається у command response.

## Embedding and search flow

Vector index records зберігають:

- `noteId`
- `provider`
- `model`
- `dimensions`
- `sourceHash`
- `textHash`
- vector values

Search використовує indexed dense vectors тільки якщо:

- index має vector для active notes
- source/text hashes актуальні
- provider/model сумісні з поточним config
- query embedding provider доступний

Якщо ці умови не виконані, search переходить на deterministic fallback і повертає warning. Це важливо для production: агент отримує результат за один виклик, але бачить, що semantic layer degraded.

## Provider architecture

External model integrations ізольовані інтерфейсами:

```ts
export interface EmbeddingProvider {
    embedTexts(texts: string[]): Promise<EmbeddingVector[]>
}
```

```ts
export interface LocalLlmProvider {
    generateJson<TInput, TOutput>(
        task: LlmTask<TInput, TOutput>,
        input: TInput
    ): Promise<TOutput>
}
```

Поточні adapters:

- Ollama LLM на `http://localhost:11434`
- OpenAI-compatible local HTTP LLM
- FlagEmbedding HTTP server для `BAAI/bge-m3`

Provider failures не повинні блокувати canonical document operations. Вони мають давати structured warning/error або fallback залежно від command context.

## Validation responsibilities

| Перевірка | Місце |
| --- | --- |
| invalid UTF-8 | `encoding.ts`, `storage.ts`, `checkCommand` |
| invalid frontmatter | `frontmatter.ts`, `checkCommand` |
| managed header mismatch | `managed-header.ts`, `checkCommand` |
| duplicate document IDs | `checkCommand` |
| registry drift | `checkCommand` |
| stale notes | `notes.ts`, `checkCommand` |
| stale/incompatible vector index | `embeddings.ts`, `checkCommand`, `search.ts` |
| provider health | `providers.ts`, `rmem dev providers check` |

## Production readiness matrix

| Area | Current state | Remaining production work |
| --- | --- | --- |
| Public CLI contract | Implemented | Keep stable; avoid adding public commands |
| Safe writes | Implemented | Add crash/concurrency stress tests |
| UTF-8 safety | Implemented | Add binary fixture regression tests if needed |
| Frontmatter parser | Supported subset implemented | Replace with audited YAML library only if full YAML is required |
| Notes | Deterministic + guarded LLM | Improve semantic quality without weakening grounding |
| Embeddings | Mock + FlagEmbedding HTTP | Add retry/backoff and batch-size tuning |
| Search | One-shot report with fallback warnings | Add richer linked-knowledge ranking |
| Provider tests | Mocked HTTP contracts | Add optional CI job for real local providers |
| Packaging | npm dry-run, install smoke and release workflow supported | Add changelog automation later |
| Observability | JSON warnings/errors | Add structured trace snapshots for regressions |

## Refactor rules

Подальший structural refactor має виконуватися в такому порядку:

1. Keep root compatibility entrypoints until package consumers can migrate.
2. Move `config.ts` only after config-specific tests cover YAML compatibility.
3. Keep command response contract tests updated before changing public/dev command behavior.
4. Keep `src/index.ts` public exports backward-compatible.
5. Run `npm test`, `npm run pack:dry-run`, UTF-8 scan, and optional real-model smoke.

Не можна одночасно змінювати структуру папок і поведінку command handlers. Це ускладнить аудит і може приховати semantic regressions.

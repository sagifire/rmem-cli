# Changelog

Усі суттєві зміни проєкту `rmem-cli` фіксуються в цьому файлі.

Формат базується на [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), а versioning має відповідати правилам із `docs/RELEASE.md`.

## [1.1.3] - 2026-06-04

### Added

- Added compact YAML as the default output format for agent-facing commands. The previous JSON output remains available with `--json`; `rmem read` now returns YAML metadata followed by raw Markdown in default mode.
- Added skill guidance that state-changing `rmem` commands must not be constrained by short timeouts because synchronous semantic indexing, local LLM calls, embedding generation, and vector index rebuilds can be slow.

### Fixed

- Fixed LLM note generation with Ollama when `sourceQuote` is grounded but whitespace-normalized by the model. The stored quote is mapped back to the original Markdown substring instead of falling back to the deterministic compiler.

### Tests

- Added regression tests for YAML default output, JSON compatibility via `--json`, `rmem read` YAML-plus-Markdown output, and whitespace-normalized grounded quotes.

## [1.1.2] - 2026-06-04

### Added

- Added `rmem init` as an idempotent project memory bootstrap command. It creates `.rmem/config.yaml`, `memory/`, and `memory/tree-index.md` when missing without overwriting an existing valid tree index.

### Fixed

- Fixed root `rmem list` output so direct child folders of `project` are visible without requiring a separate `rmem list project` call.
- Fixed document command validation to reject `project/...` document paths with a clear `INVALID_MEMORY_PATH` suggestion. Document paths are relative to `memory/`, while folder paths use semantic `project/...` memory paths.
- Fixed vector index rebuild for empty note sets so configured BGE-M3/FlagEmbedding providers are not called with `texts: []`.
- Fixed LLM note generation with Ollama: valid LLM notes are no longer discarded when only `canonicalStatement` is a paraphrase. The canonical statement is normalized to a grounded phrase from `sourceQuote`.
- Fixed LLM diagnostics by separating real provider failures (`LLM_PROVIDER_FAILED`) from grounding failures (`LLM_OUTPUT_GROUNDING_FAILED`).

### Tests

- Added regression tests for root folder listing, invalid `project/...` document paths, empty embedding rebuilds, and Ollama-style canonical paraphrase normalization.

## [1.1.1] - 2026-06-03

### Fixed

- Fixed `rmem folder move` for folders that exist only in `memory/tree-index.md` before any physical document write.
- Fixed `rmem folder move` validation to reject moving a folder into its own subtree.
- Fixed safe `rmem folder remove` archiving so unparsable UTF-8 documents are copied to `.rmem/archive` before original files are removed.
- Fixed `rmem tree repair` to validate `.rmem/index/tree-index.json` before restoring `memory/tree-index.md`.

### Tests

- Added regression tests for logical-only folder moves, self-subtree move rejection, safe removal of unparsable documents, and corrupted tree-index backup rejection.

## [1.1.0] - 2026-06-03

### Added

- Додано agent-facing folder commands: `folder create`, `folder update`, `folder move`, `folder remove`.
- Додано tree commands: `tree generate` і `tree repair`.
- Додано canonical `memory/tree-index.md` для опису структури папок бази знань.
- Додано derived backup/cache `.rmem/index/tree-index.json`.
- Додано full path folder keys, що дозволяє однакові назви папок у різних гілках.
- `rmem write` тепер повертає `MEMORY_FOLDER_NOT_FOUND`, якщо document path вказує на незареєстровану папку.

## [1.0.0] - 2026-06-03

### Added

- Додано document-first TypeScript workspace з packages `@rmem/core` і `rmem-cli`.
- Додано public CLI commands: `search`, `list`, `read`, `write`, `edit`, `remove`, `check`.
- Додано diagnostic commands під `rmem dev ...` для notes, docs parsing, index rebuild, embeddings status, links validation, providers check і search tracing.
- Додано safe Markdown document workflow з YAML frontmatter, managed header, exact edit replacement, UTF-8 validation і atomic writes.
- Додано derived notes, structural places, related links, vector index і one-shot search report.
- Додано provider adapters для Ollama, OpenAI-compatible local LLM і FlagEmbedding HTTP embeddings.
- Додано Windows-friendly BGE-M3 helper server у `tools/bge-m3-server`.
- Додано mocked provider contract tests, golden fixtures, command response contract tests, package export tests і package install smoke.
- Додано cross-platform CI workflow для Windows/Linux і manual release workflow з npm dry-run/provenance publish gates.
- Додано `DOCUMENTATION.md`, `docs/ARCHITECTURE.md`, `docs/RELEASE.md` і package-level README files.

### Changed

- Структуру `@rmem/core` розділено на logical folders: `domain`, `documents`, `commands`, `indexing`, `notes`, `providers`, `search`, `storage`, `validation`, `errors`.
- Root-level compatibility entrypoints збережено для стабільного public API.
- `npm run check` тепер виконує automated tests, install-from-tarball smoke і package dry-run.
- Package smoke і package dry-run переведено на Node scripts для Windows/Linux сумісності.

### Security

- Package `exports` для `@rmem/core` обмежує public import surface root module-ом і блокує internal deep imports.
- LLM note generation має grounding guard і fallback на deterministic compiler для ungrounded output.

### Validation

- `npm run check` проходить локально.
- Normal CI не потребує Ollama, BGE-M3, CUDA або Docker.

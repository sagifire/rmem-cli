# Changelog

Усі суттєві зміни проєкту `rmem-cli` фіксуються в цьому файлі.

Формат базується на [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), а versioning має відповідати правилам із `docs/RELEASE.md`.

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

# rmem-cli

`rmem-cli` is a TypeScript CLI for document-first semantic project memory.

Canonical knowledge lives in Markdown documents. Notes, links, structural places, registry data and search reports are derived projections that can be rebuilt from documents. Runtime configuration is stored in `.rmem/config.yaml`.

## Public Commands

```bash
rmem init
rmem search <query>
rmem list [memory-path]
rmem read <document-path>
rmem write <document-path> [--from <file>]
rmem edit <document-path>
rmem remove <document-path>
rmem folder create <memory-path> --description <text> [--title <text>]
rmem folder update <memory-path> --description <text> [--title <text>]
rmem folder move <from-memory-path> <to-memory-path> [--description <text>] [--title <text>]
rmem folder remove <memory-path> [--delete-files]
rmem tree generate
rmem tree repair
rmem check
rmem --version
```

Agent-facing commands return compact YAML by default. Use `--json` on any command to keep the previous structured JSON output. `rmem read` returns YAML metadata followed by the raw Markdown document.

## Development Commands

```bash
rmem dev notes list
rmem dev notes rebuild
rmem dev docs parse <document-path>
rmem dev index rebuild
rmem dev embeddings status
rmem dev links validate
rmem dev providers check
rmem dev search trace <query>
```

## Build and Test

```bash
npm install
npm test
npm run smoke:package
npm run pack:dry-run
npm run check
```

The implementation uses strict TypeScript, validates UTF-8 reads, validates core Markdown structure, writes canonical documents atomically, generates managed headers from frontmatter, and supports provider contracts for Ollama LLM and a bundled Windows-friendly BGE-M3 FlagEmbedding server.

Provider contracts, golden fixtures and a lightweight performance smoke are covered by automated tests. Normal CI does not require Ollama or BGE-M3.

`npm run smoke:package` packs both workspaces, installs the generated tarballs into `.runtime/package-install-smoke`, verifies the installed `rmem` binary, writes a memory document and runs `rmem check`.

The package smoke and dry-run scripts are Node-based and run on Windows and Linux CI.

Manual real-model smoke on Windows:

```powershell
npm run smoke:real-models
```

## Architecture

- Detailed command/config documentation: `DOCUMENTATION.md`
- Architecture, module boundaries and production matrix: `docs/ARCHITECTURE.md`
- Release checklist and publish gates: `docs/RELEASE.md`
- Release history: `CHANGELOG.md`

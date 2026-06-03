# rmem-cli

`rmem-cli` is a TypeScript CLI for document-first semantic project memory.

Canonical knowledge lives in Markdown documents. Notes, links, structural places, registry data and search reports are derived projections that can be rebuilt from documents. Runtime configuration is stored in `.rmem/config.yaml`.

## Public Commands

```bash
rmem search <query>
rmem list [memory-path]
rmem read <document-path>
rmem write <document-path> [--from <file>]
rmem edit <document-path>
rmem remove <document-path>
rmem check
```

Agent-facing commands return structured JSON by default.

## Development Commands

```bash
rmem dev notes list
rmem dev notes rebuild
rmem dev docs parse <document-path>
rmem dev index rebuild
rmem dev embeddings status
rmem dev links validate
rmem dev search trace <query>
```

## Build and Test

```bash
npm install
npm test
```

The implementation uses strict TypeScript, validates UTF-8 reads, validates core Markdown structure, writes canonical documents atomically, generates managed headers from frontmatter, and supports provider contracts for Ollama LLM and a bundled Windows-friendly BGE-M3 FlagEmbedding server.

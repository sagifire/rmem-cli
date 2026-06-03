# rmem-cli

Document-oriented semantic project memory CLI.

Canonical knowledge is stored in Markdown documents. Derived notes, links, structural places, registries and embeddings are rebuildable projections maintained by the CLI.

## Install

```bash
npm install -g rmem-cli
```

## Public commands

```bash
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
```

Diagnostic commands are available under `rmem dev ...`.

## Local providers

The CLI supports:

- Ollama-compatible local LLM providers
- OpenAI-compatible local HTTP LLM providers
- FlagEmbedding HTTP embeddings for `BAAI/bge-m3`

Normal automated tests do not require local model providers.

# @rmem/core

Core contracts and services for document-oriented semantic project memory.

This package contains the domain types, command handlers, document parsing, registry storage, note generation, provider adapters, vector indexing and search pipeline used by `rmem-cli`.

## Public API

The package exports only the root module:

```ts
import { searchCommand, writeCommand } from '@rmem/core'
```

Internal build paths such as `@rmem/core/commands/internal.js` are not exported and must not be imported by package consumers.

## Architecture

Documents are canonical. Notes, links, registry state and embeddings are derived projections and must remain rebuildable from documents.

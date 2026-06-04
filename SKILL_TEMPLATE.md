---
name: memory-of-relics
description: Document-oriented semantic project memory workflow powered by rmem-cli 1.1.3. Use for project tasks that require context from //memory, including architecture, rules, plans, tasks, docs, implementation decisions, and agent workflow requirements. If the user request is project-related and involves changes, planning, decisions, context, or implementation work, load this skill first.
license: MIT
---

# Memory of Relics

This skill defines how an agent works with document-oriented project memory through `rmem-cli`.

The goal is simple: use project memory as a controlled semantic filesystem, not as a pile of Markdown files searched and patched manually.

## Concepts

- `//` — project root.
- `//memory` — canonical project memory directory.
- `memory/tree-index.md` — canonical human-editable index of memory folders and their descriptions.
- `.rmem/index/tree-index.json` — derived backup/cache of `tree-index.md`, used for recovery only.
- `rmem-cli` — npm package that provides the `rmem` command.
- Memory document — canonical Markdown document in `//memory`.
- Memory folder — semantic folder path defined in `memory/tree-index.md`, for example `project/architecture`.
- Note — derived semantic index node generated from documents; notes are never canonical truth.
- Context report — `rmem search` output with relevant documents, notes, excerpts, links, memory paths, warnings, and recommended next commands.

## Core Rules

### Documents are canonical

Canonical knowledge lives in Markdown documents under `//memory`.

Derived notes, links, registries, vector indexes, embeddings, and search reports are projections. They can help retrieval, but they are not source of truth.

If knowledge must change, update the relevant canonical document through `rmem`.

### `tree-index.md` is canonical for folders

Folder descriptions and allowed memory paths come from:

```text
memory/tree-index.md
```

Expected format:

```md
# Memory Tree Index

<!-- rmem:tree-index start -->

- `project` — General project memory.
  - `project/architecture` — Architecture, components, and system decisions.
  - `project/rules` — Agent and developer operating rules.

<!-- rmem:tree-index end -->
```

Rules:

- Do not invent folder descriptions outside `tree-index.md`.
- A folder can be defined in `tree-index.md` before the physical directory exists.
- If a folder is defined but the directory does not exist, `rmem write` creates it automatically.
- If a physical folder exists but is not defined in `tree-index.md`, treat it as unregistered.
- If `tree-index.md` is missing or invalid, normal memory operations are blocked.

### Do not edit memory directly when `rmem` can do it

Do not use direct file operations as the main workflow for memory:

```bash
rg ...
cat ...
sed ...
echo ... >> ...
manual patch in //memory
```

Use controlled commands:

```bash
<rmem> search "..."
<rmem> read <document-path>
<rmem> edit <document-path>
<rmem> write <document-path> --from <file>
<rmem> folder create <memory-path> --description "..."
<rmem> check
```

Exception: direct manual editing of `memory/tree-index.md` is allowed because it is intentionally human-editable. After editing it, run `rmem check`.

### Preserve UTF-8

All memory files must be valid UTF-8.

Do not silently rewrite corrupted text. If `rmem` reports invalid UTF-8, report the issue and use a controlled fix.

## CLI Invocation

Use the first available command form consistently within the task:

```bash
pnpm exec rmem
npm exec rmem
npx -y rmem-cli
rmem
```

In this skill, `<rmem>` means the selected invocation.

Always start by checking the CLI when unsure:

```bash
<rmem> --version
```

Expected version for this template:

```yaml
ok: true
version: 1.1.3
```

Agent-facing commands return compact YAML by default. Add `--json` only when a tool or script must parse the old JSON response shape.

## Runtime Expectations

Do not impose short time limits on commands that change project memory state. State-changing commands can trigger synchronous semantic indexing, note generation, local LLM calls, embedding generation, and vector index rebuilds.

State-changing commands include:

```bash
<rmem> init
<rmem> write <document-path> [--from <file>]
<rmem> edit <document-path>
<rmem> remove <document-path>
<rmem> folder create <memory-path> --description <text>
<rmem> folder update <memory-path> --description <text>
<rmem> folder move <from-memory-path> <to-memory-path>
<rmem> folder remove <memory-path>
<rmem> tree generate
<rmem> tree repair
```

If an execution environment requires a timeout parameter, use a generous timeout for these commands rather than a short default. A slow response is expected when local models are active; treat timeout as an operational failure only after the command had enough time to finish indexing.

## Public Commands

Normal agent-facing commands:

```bash
<rmem> init
<rmem> search <query>
<rmem> list [memory-path]
<rmem> read <document-path>
<rmem> write <document-path> [--from <file>]
<rmem> edit <document-path>
<rmem> remove <document-path>
<rmem> folder create <memory-path> --description <text> [--title <text>]
<rmem> folder update <memory-path> --description <text> [--title <text>]
<rmem> folder move <from-memory-path> <to-memory-path> [--description <text>] [--title <text>]
<rmem> folder remove <memory-path> [--delete-files]
<rmem> tree generate
<rmem> tree repair
<rmem> check
<rmem> --version
```

Diagnostic commands live under `rmem dev ...`. Do not use them in normal workflow unless the user explicitly asks for diagnostics or the task is about `rmem-cli` development.

## Output Format

Default output is compact YAML:

```yaml
ok: true
```

Use `--json` when strict JSON is required:

```bash
<rmem> check --json
```

`rmem read` is special in default mode: it returns YAML metadata first, then `--- markdown ---`, then the raw canonical Markdown document. Do not treat the marker as part of the document content.

## Path Parameters

`rmem-cli` has two different path types. Do not mix them.

### Memory folder paths

Use semantic memory paths with the `project/` root only for folder/list commands:

```bash
<rmem> list project/rules
<rmem> folder create project/rules --description "Agent and developer operating rules."
<rmem> folder update project/rules --description "Updated rules description."
<rmem> folder move project/rules project/agent-rules --description "Agent rules."
<rmem> folder remove project/old-area
```

These paths refer to entries in `memory/tree-index.md`.

### Document paths

Use document paths relative to `//memory` for document commands. Never prefix document paths with `project/`.

Correct:

```bash
<rmem> write rules/agent-memory-and-iteration-reporting.md --from ./agent-rules.md
<rmem> read rules/agent-memory-and-iteration-reporting.md
<rmem> edit rules/agent-memory-and-iteration-reporting.md < edit-request.json
<rmem> remove rules/agent-memory-and-iteration-reporting.md
```

Incorrect:

```bash
<rmem> write project/rules/agent-memory-and-iteration-reporting.md --from ./agent-rules.md
```

Reason: `project/rules` is the semantic memory folder path, but `rules/agent-memory-and-iteration-reporting.md` is the physical document path under `//memory`.

Mapping examples:

| Memory folder path | Document path example |
| --- | --- |
| `project` | `overview.md` |
| `project/rules` | `rules/agent-rules.md` |
| `project/architecture` | `architecture/system.md` |

If `rmem` returns `INVALID_MEMORY_PATH` for a document command, remove the leading `project/` from the document path and retry.

## Standard Workflow

### Before project-related work

1. Select the `<rmem>` invocation.
2. If project memory is not initialized, run `<rmem> init`.
3. Run `<rmem> check`.
4. If check passes or only non-blocking warnings exist, run `<rmem> search` for task context.
5. Read recommended documents through `<rmem> read`.
6. Execute the user task.
7. If memory changes are needed, use `<rmem> edit`, `<rmem> write`, `<rmem> remove`, or `<rmem> folder ...`.
8. Run `<rmem> check` after memory changes.

### Search

Use one-shot search first:

```bash
<rmem> search "short description of the needed context"
```

Do not replace this with repeated `rg`/`cat` scans across `//memory`.

### Read

Read canonical documents when search recommends them:

```bash
<rmem> read architecture/memory-model.md
```

Use the returned `documentHash` for safe edits.

### Edit

Use exact replacement JSON:

```bash
<rmem> edit architecture/memory-model.md < edit-request.json
```

Request format:

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

- `oldText` must match exactly once.
- `OLD_TEXT_NOT_FOUND` means the current document does not contain the provided exact text.
- `OLD_TEXT_AMBIGUOUS` means the replacement span is too small.
- `DOCUMENT_HASH_MISMATCH` means read the document again and retry.

### Write

Use `write` to create or fully replace a document:

```bash
<rmem> write architecture/system.md --from ./system.md
```

If the target folder is not defined in `memory/tree-index.md`, `rmem` returns `MEMORY_FOLDER_NOT_FOUND`.

Fix by creating or defining the folder:

```bash
<rmem> folder create project/architecture --description "Architecture, components, and system decisions."
```

## Folder Workflow

### Create folder

Use when a new semantic memory area is needed:

```bash
<rmem> folder create project/architecture --description "Architecture, components, and system decisions."
```

This updates `memory/tree-index.md`. The physical folder may still be absent until the first document write.

### Update folder description

```bash
<rmem> folder update project/architecture --description "Updated architecture memory description."
```

This changes folder context for `list` and `search`.

### Move or rename folder

```bash
<rmem> folder move project/architecture project/design --description "Design knowledge."
```

This updates:

- `memory/tree-index.md`
- physical directory, if it exists
- affected document paths and `rmem.memoryPath`
- registry, structural places, notes, and vector index consistency

Do not manually rename memory folders in the filesystem when this command is available.

### Remove folder

Safe default:

```bash
<rmem> folder remove project/old-area
```

This archives affected documents and removes active index state.

Destructive deletion requires explicit user intent:

```bash
<rmem> folder remove project/old-area --delete-files
```

Do not use `--delete-files` unless the user explicitly requested physical recursive deletion.

## Tree Index Workflow

### Missing tree index

If `rmem check`, `search`, `write`, `list`, `read`, `edit`, or `remove` reports `TREE_INDEX_NOT_FOUND`, normal memory operations are blocked.

Recommended action:

```bash
<rmem> init
```

Then fill descriptions in `memory/tree-index.md` manually or with user-approved edits, and run:

```bash
<rmem> check
```

### Empty folder descriptions

`MEMORY_FOLDER_DESCRIPTION_EMPTY` means `tree-index.md` exists but has empty descriptions.

This is not a reason to invent descriptions. Ask the user or fill them only if the user asked you to maintain memory structure and enough context is available.

### Invalid tree index

If `TREE_INDEX_INVALID` appears:

1. Do not silently fall back to `.rmem/index/tree-index.json`.
2. Report the problem.
3. If appropriate, run:

```bash
<rmem> tree repair
```

4. Run `rmem check`.

## Memory Update Policy

Update memory only when:

- the user asks to update project memory;
- the task creates a durable decision, rule, plan, or architecture change;
- existing memory is wrong or obsolete;
- a new document is needed for durable project context.

Do not update memory for:

- temporary thoughts;
- guesses;
- unverified information;
- unrelated work;
- facts the user has not asked to preserve.

## Failure Handling

If `rmem` is unavailable:

- report it;
- do not automatically degrade into chaotic manual search over `//memory`;
- use direct filesystem access only if the user approves or the task cannot proceed otherwise.

If `rmem check` returns issues:

- do not ignore them;
- summarize the issue codes;
- fix only issues relevant to the task unless the user asks for a full repair;
- run `rmem check` again after fixes.

If `rmem search` finds no context:

- try one more refined search if useful;
- do not invent missing project context;
- state that memory has no relevant entry.

## Critical Prohibitions

Do not:

- treat notes, embeddings, registry, or search output as canonical truth;
- edit generated notes directly;
- physically delete memory documents unless the user explicitly requested deletion;
- use `--delete-files` without explicit user intent;
- silently repair invalid UTF-8;
- ignore `tree-index.md` errors;
- create undocumented folders outside `memory/tree-index.md`;
- use `rg` as the primary memory retrieval tool instead of `rmem search`.

## Short Agent Checklist

```text
1. Select rmem invocation.
2. Run rmem check.
3. If needed, repair or generate tree-index.md with user awareness.
4. Run rmem search for task context.
5. Read canonical documents with rmem read.
6. Do the task.
7. Update memory only when durable project knowledge changed.
8. Use folder commands before writing into new memory areas.
9. Run rmem check after memory changes.
10. Report used/changed memory documents and unresolved issues.
```

## Final Rule

Use `rmem-cli` as the controlled operating interface for project memory.

Do not treat `//memory` as a random Markdown dump.

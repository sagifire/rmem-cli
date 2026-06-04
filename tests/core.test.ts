import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import {
    checkCommand,
    createFolderCommand,
    devLinksValidateCommand,
    editCommand,
    generateLlmDerivedNotes,
    isCommandError,
    listCommand,
    loadConfig,
    parseDocumentMarkdown,
    readCommand,
    removeCommand,
    moveFolderCommand,
    removeFolderCommand,
    searchCommand,
    searchRegistry,
    treeGenerateCommand,
    treeRepairCommand,
    updateFolderCommand,
    writeCommand
} from '../packages/rmem-core/dist/index.js'

test('document workflow writes, reads, searches, edits and checks memory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
        await writeOfflineConfig(root)
        await createFolderCommand(root, 'project/architecture', {
            title: 'Architecture',
            description: 'Architecture memory.'
        })
        const write = await writeCommand(root, 'architecture/memory.md', '# Памʼять проєкту\n\nДокументи є джерелом істини.\n')
        assert.equal(write.ok, true)
        assert.equal(write.created, true)
        assert.equal(write.affected.rebuiltNotes > 0, true)
        await access(join(root, '.rmem', 'config.yaml'))

        const read = await readCommand(root, 'architecture/memory.md')
        assert.equal(read.ok, true)
        assert.equal(read.document.title, 'Памʼять проєкту')
        assert.equal(read.content.includes('<!-- rmem:managed-header start -->'), true)

        const search = await searchCommand(root, 'джерелом істини')
        assert.equal(search.ok, true)
        assert.equal(search.results.length > 0, true)

        const edit = await editCommand(root, 'architecture/memory.md', {
            documentHash: read.documentHash,
            edits: [
                {
                    oldText: 'Документи є джерелом істини.',
                    newText: 'Markdown документи є канонічним джерелом істини.'
                }
            ]
        })
        assert.equal(edit.ok, true)
        assert.equal(edit.document.revision, 2)

        const check = await checkCommand(root)
        assert.equal(check.ok, true)
        assert.equal(check.valid, true)

        const list = await listCommand(root)
        assert.equal(list.ok, true)
        assert.equal(list.items.some((item) => item.type === 'document'), true)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('edit rejects missing, ambiguous and mismatched exact replacements', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
        await writeOfflineConfig(root)
        await createFolderCommand(root, 'project/rules', {
            title: 'Rules',
            description: 'Rules.'
        })
        await writeCommand(root, 'rules/edit.md', '# Edit\n\nsame\nsame\n')
        const read = await readCommand(root, 'rules/edit.md')
        assert.equal(read.ok, true)

        const ambiguous = await editCommand(root, 'rules/edit.md', {
            edits: [{ oldText: 'same', newText: 'other' }]
        })
        assert.equal(isCommandError(ambiguous), true)
        if (isCommandError(ambiguous)) {
            assert.equal(ambiguous.code, 'OLD_TEXT_AMBIGUOUS')
        }

        const missing = await editCommand(root, 'rules/edit.md', {
            edits: [{ oldText: 'absent', newText: 'other' }]
        })
        assert.equal(isCommandError(missing), true)
        if (isCommandError(missing)) {
            assert.equal(missing.code, 'OLD_TEXT_NOT_FOUND')
        }

        const mismatch = await editCommand(root, 'rules/edit.md', {
            documentHash: 'bad',
            edits: [{ oldText: '# Edit', newText: '# Edit 2' }]
        })
        assert.equal(isCommandError(mismatch), true)
        if (isCommandError(mismatch)) {
            assert.equal(mismatch.code, 'DOCUMENT_HASH_MISMATCH')
        }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('check reports invalid UTF-8 documents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
        await writeOfflineConfig(root)
        await writeCommand(root, 'valid.md', '# Valid\n\nContent\n')
        const path = join(root, 'memory', 'broken.md')
        await writeFile(path, Buffer.from([0xff, 0xfe, 0xfd]))

        const check = await checkCommand(root)
        assert.equal(check.ok, true)
        assert.equal(check.valid, false)
        assert.equal(check.issues.some((issue) => issue.code === 'ENCODING_ERROR'), true)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('managed header is generated from frontmatter only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
        await writeOfflineConfig(root)
        await createFolderCommand(root, 'project/guide', {
            title: 'Guide',
            description: 'Guides.'
        })
        await writeCommand(root, 'guide/header.md', '# Header\n\nBody\n')
        const fullPath = join(root, 'memory', 'guide', 'header.md')
        const content = await readFile(fullPath, 'utf8')
        assert.equal(content.includes('**Ревізія:** 1'), true)
        assert.equal(content.includes('Body'), true)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('write rejects invalid Markdown before canonical write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
        await writeOfflineConfig(root)
        const result = await writeCommand(root, 'broken.md', '#Broken\n\nBody\n')
        assert.equal(isCommandError(result), true)
        if (isCommandError(result)) {
            assert.equal(result.code, 'INVALID_MARKDOWN')
        }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('remove archives without deleting canonical document file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
        await writeOfflineConfig(root)
        await createFolderCommand(root, 'project/archive', {
            title: 'Archive',
            description: 'Archived documents.'
        })
        await writeCommand(root, 'archive/me.md', '# Archive Me\n\nBody\n')
        const result = await removeCommand(root, 'archive/me.md')
        assert.equal(result.ok, true)
        const content = await readFile(join(root, 'memory', 'archive', 'me.md'), 'utf8')
        assert.equal(content.includes('status: archived'), true)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('folder commands manage agent-facing memory areas', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
        await writeOfflineConfig(root)

        const missing = await writeCommand(root, 'research/memory.md', '# Missing\n\nBody\n')
        assert.equal(isCommandError(missing), true)
        if (isCommandError(missing)) {
            assert.equal(missing.code, 'MEMORY_FOLDER_NOT_FOUND')
            assert.equal(missing.suggestion?.includes('rmem folder create project/research'), true)
        }

        const created = await createFolderCommand(root, 'project/research', {
            title: 'Research',
            description: 'Research notes.'
        })
        assert.equal(created.ok, true)
        assert.equal(created.created, true)
        assert.equal(created.folder.description, 'Research notes.')
        const treeContent = await readFile(join(root, 'memory', 'tree-index.md'), 'utf8')
        assert.equal(treeContent.includes('project/research'), true)

        const rootList = await listCommand(root)
        assert.equal(rootList.ok, true)
        assert.equal(rootList.items.some((item) => item.type === 'area' && item.key === 'project/research'), true)

        const invalidDocumentPath = await writeCommand(root, 'project/research/memory.md', '# Invalid\n\nBody\n')
        assert.equal(isCommandError(invalidDocumentPath), true)
        if (isCommandError(invalidDocumentPath)) {
            assert.equal(invalidDocumentPath.code, 'INVALID_MEMORY_PATH')
            assert.equal(invalidDocumentPath.suggestion?.includes('research/memory.md'), true)
        }

        const write = await writeCommand(root, 'research/memory.md', '# Memory Research\n\nDocuments define memory structure.\n')
        assert.equal(write.ok, true)
        assert.deepEqual(write.document.memoryPath, ['project', 'research'])

        const updated = await updateFolderCommand(root, 'project/research', {
            description: 'Updated research description.'
        })
        assert.equal(updated.ok, true)
        assert.equal(updated.folder.description, 'Updated research description.')

        const moved = await moveFolderCommand(root, 'project/research', 'project/discovery', {
            title: 'Discovery',
            description: 'Discovery knowledge.'
        })
        assert.equal(moved.ok, true)
        assert.equal(moved.moved, true)
        assert.equal(moved.affected.documents, 1)

        const movedRead = await readCommand(root, 'discovery/memory.md')
        assert.equal(movedRead.ok, true)
        assert.deepEqual(movedRead.document.memoryPath, ['project', 'discovery'])

        const removed = await removeFolderCommand(root, 'project/discovery')
        assert.equal(removed.ok, true)
        assert.equal(removed.removed, true)
        assert.equal(removed.affected.documents, 1)

        const check = await checkCommand(root)
        assert.equal(check.ok, true)
        assert.equal(check.valid, true)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('tree index gates memory operations and can be generated explicitly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
        await mkdir(join(root, 'memory', 'architecture'), { recursive: true })
        const blocked = await writeCommand(root, 'architecture/memory.md', '# Blocked\n\nBody\n')
        assert.equal(isCommandError(blocked), true)
        if (isCommandError(blocked)) {
            assert.equal(blocked.code, 'TREE_INDEX_NOT_FOUND')
        }

        const generated = await treeGenerateCommand(root)
        assert.equal(generated.ok, true)
        assert.equal(generated.created, true)
        assert.equal(generated.folders.some((folder) => folder.key === 'project/architecture'), true)

        const check = await checkCommand(root)
        assert.equal(check.ok, true)
        assert.equal(check.valid, false)
        assert.equal(check.issues.some((issue) => issue.code === 'MEMORY_FOLDER_DESCRIPTION_EMPTY'), true)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('memory folders use full path keys for duplicate segment names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
        await writeOfflineConfig(root)
        await createFolderCommand(root, 'project/backend', {
            description: 'Backend memory.'
        })
        await createFolderCommand(root, 'project/frontend', {
            description: 'Frontend memory.'
        })
        await createFolderCommand(root, 'project/backend/api', {
            description: 'Backend API memory.'
        })
        await createFolderCommand(root, 'project/frontend/api', {
            description: 'Frontend API memory.'
        })

        const backend = await writeCommand(root, 'backend/api/contracts.md', '# Backend API\n\nBackend contracts.\n')
        const frontend = await writeCommand(root, 'frontend/api/contracts.md', '# Frontend API\n\nFrontend contracts.\n')
        assert.equal(backend.ok, true)
        assert.equal(frontend.ok, true)
        assert.deepEqual(backend.document.memoryPath, ['project', 'backend', 'api'])
        assert.deepEqual(frontend.document.memoryPath, ['project', 'frontend', 'api'])
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('folder move supports logical-only folders and rejects self-subtree moves', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
        await writeOfflineConfig(root)
        const created = await createFolderCommand(root, 'project/logical', {
            description: 'Logical folder without physical directory.'
        })
        assert.equal(created.ok, true)

        const moved = await moveFolderCommand(root, 'project/logical', 'project/moved-logical')
        assert.equal(moved.ok, true)
        assert.equal(moved.moved, true)
        assert.equal(moved.affected.documents, 0)

        const list = await listCommand(root, 'project')
        assert.equal(list.ok, true)
        assert.equal(list.items.some((item) => item.type === 'area' && item.key === 'project/moved-logical'), true)

        const rejected = await moveFolderCommand(root, 'project/moved-logical', 'project/moved-logical/child')
        assert.equal(isCommandError(rejected), true)
        if (isCommandError(rejected)) {
            assert.equal(rejected.code, 'INVALID_MEMORY_PATH')
        }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('folder remove archives unparsable UTF-8 documents before deleting originals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
        await writeOfflineConfig(root)
        await createFolderCommand(root, 'project/broken', {
            description: 'Broken document folder.'
        })
        await writeCommand(root, 'broken/doc.md', '# Broken\n\nOriginal valid content.\n')
        await writeFile(join(root, 'memory', 'broken', 'doc.md'), '#Broken\n\nNo frontmatter but still UTF-8.\n', 'utf8')

        const removed = await removeFolderCommand(root, 'project/broken')
        assert.equal(removed.ok, true)
        assert.equal(removed.affected.documents, 1)

        const archived = await readFile(join(root, '.rmem', 'archive', 'broken', 'doc.md'), 'utf8')
        assert.equal(archived.includes('#Broken'), true)

        await assert.rejects(
            access(join(root, 'memory', 'broken', 'doc.md')),
            (error: unknown) => error instanceof Error
        )
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('tree repair rejects corrupted backup state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
        await writeOfflineConfig(root)
        await createFolderCommand(root, 'project/backup-test', {
            description: 'Backup test folder.'
        })
        await writeFile(join(root, '.rmem', 'index', 'tree-index.json'), JSON.stringify({
            schemaVersion: 1,
            treeIndexPath: 'memory/tree-index.md',
            folders: [{
                path: ['project', 'broken'],
                key: 'project/not-broken',
                area: {
                    title: 'Broken',
                    description: 'Broken backup.'
                }
            }]
        }, null, 4), 'utf8')

        const repaired = await treeRepairCommand(root)
        assert.equal(isCommandError(repaired), true)
        if (isCommandError(repaired)) {
            assert.equal(repaired.code, 'TREE_INDEX_INVALID')
        }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('check detects registry drift and invalid Markdown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
        await writeOfflineConfig(root)
        await writeCommand(root, 'drift.md', '# Drift\n\nOriginal\n')
        await writeFile(join(root, 'memory', 'drift.md'), '#Bad\n\nChanged\n', 'utf8')
        const check = await checkCommand(root)
        assert.equal(check.ok, true)
        assert.equal(check.valid, false)
        assert.equal(check.issues.some((issue) => issue.code === 'INVALID_FRONTMATTER' || issue.code === 'INVALID_MARKDOWN' || issue.code === 'STALE_INDEX'), true)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('derived notes create related links and link validation passes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
        await writeOfflineConfig(root)
        await writeCommand(root, 'a.md', '# Shared Architecture\n\nVector index stores project memory retrieval data.\n')
        await writeCommand(root, 'b.md', '# Related Architecture\n\nVector index stores related project memory signals.\n')
        const search = await searchCommand(root, 'related retrieval signals')
        assert.equal(search.ok, true)
        assert.equal(search.results.length > 0, true)
        assert.equal(search.results.some((result) => result.linkedKnowledge.length > 0), true)

        const links = await devLinksValidateCommand(root)
        assert.equal(links.ok, true)
        assert.equal(links.valid, true)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('CLI returns INVALID_EDIT_REQUEST for malformed edit JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
        await writeOfflineConfig(root)
        await writeCommand(root, 'cli.md', '# CLI\n\nBody\n')
        const cli = join(process.cwd(), 'packages', 'rmem-cli', 'dist', 'main.js')
        const result = spawnSync(process.execPath, [cli, 'edit', 'cli.md'], {
            cwd: root,
            input: '{bad json',
            encoding: 'utf8'
        })
        assert.equal(result.status, 1)
        const parsed = JSON.parse(result.stdout) as { code: string }
        assert.equal(parsed.code, 'INVALID_EDIT_REQUEST')
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('CLI returns version metadata', () => {
    const cli = join(process.cwd(), 'packages', 'rmem-cli', 'dist', 'main.js')
    const result = spawnSync(process.execPath, [cli, '--version'], {
        encoding: 'utf8'
    })

    assert.equal(result.status, 0)
    const parsed = JSON.parse(result.stdout) as { ok: boolean, version: string }
    assert.equal(parsed.ok, true)
    assert.equal(parsed.version, '1.1.1')
})

test('frontmatter parser decodes quoted scalar escapes', () => {
    const parsed = parseDocumentMarkdown([
        '---',
        'title: "Quoted \\"Memory\\""',
        '',
        'rmem:',
        '  schemaVersion: 1',
        '  documentId: doc_quoted',
        '  kind: overview',
        '  status: active',
        '  createdAt: 2026-06-03T00:00:00.000Z',
        '  updatedAt: 2026-06-03T00:00:00.000Z',
        '  revision: 1',
        '  memoryPath:',
        '    - project',
        '  language: en',
        '---',
        '',
        '# Quoted Memory',
        ''
    ].join('\n'))

    assert.equal(isCommandError(parsed), false)
    if (!isCommandError(parsed)) {
        assert.equal(parsed.frontmatter.title, 'Quoted "Memory"')
    }
})

test('frontmatter parser rejects unsupported YAML syntax explicitly', () => {
    const duplicate = parseDocumentMarkdown([
        '---',
        'title: First',
        'title: Second',
        '',
        'rmem:',
        '  schemaVersion: 1',
        '  documentId: doc_duplicate',
        '  kind: overview',
        '  status: active',
        '  createdAt: 2026-06-03T00:00:00.000Z',
        '  updatedAt: 2026-06-03T00:00:00.000Z',
        '  revision: 1',
        '  memoryPath:',
        '    - project',
        '  language: en',
        '---',
        '',
        '# Duplicate',
        ''
    ].join('\n'))

    assert.equal(isCommandError(duplicate), true)
    if (isCommandError(duplicate)) {
        assert.equal(duplicate.code, 'INVALID_FRONTMATTER')
        assert.equal(duplicate.message.includes('Duplicate mapping key'), true)
    }

    const misplacedSequence = parseDocumentMarkdown([
        '---',
        '- invalid',
        '---',
        '',
        '# Invalid',
        ''
    ].join('\n'))

    assert.equal(isCommandError(misplacedSequence), true)
    if (isCommandError(misplacedSequence)) {
        assert.equal(misplacedSequence.code, 'INVALID_FRONTMATTER')
        assert.equal(misplacedSequence.message.includes('Sequence item is not inside a sequence'), true)
    }
})

test('config loader rejects invalid areas shape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
        await mkdir(join(root, '.rmem'), { recursive: true })
        await writeFile(join(root, '.rmem', 'config.yaml'), [
            'schemaVersion: 1',
            'memoryRoot: memory',
            'areas: invalid',
            'indexing:',
            '  noteRebuildMode: sync',
            ''
        ].join('\n'), 'utf8')

        const config = await loadConfig(root)
        assert.equal(isCommandError(config), true)
        if (isCommandError(config)) {
            assert.equal(config.code, 'INVALID_CONFIG')
        }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('search falls back when vector index provider is incompatible', async () => {
    const registry = {
        schemaVersion: 1,
        documents: [{
            path: 'memory.md',
            document: {
                path: 'memory.md',
                documentId: 'doc_memory',
                title: 'Memory',
                kind: 'overview',
                status: 'active',
                revision: 1,
                memoryPath: ['project'],
                language: 'en'
            },
            documentHash: 'hash',
            contentHash: 'content',
            archived: false,
            updatedAt: '2026-06-03T00:00:00.000Z'
        }],
        places: [{
            id: 'place_memory',
            documentId: 'doc_memory',
            documentPath: 'memory.md',
            headingPath: ['Memory'],
            title: 'Memory',
            level: 1,
            orderIndex: 0,
            sourceHash: 'source'
        }],
        notes: [{
            id: 'note_memory',
            type: 'concept',
            status: 'active',
            title: 'Memory',
            sourceSummary: 'Vector index stores memory.',
            canonicalStatement: 'Vector index stores memory.',
            retrievalText: 'Vector index stores memory.',
            tags: [],
            aliases: [],
            entities: [],
            source: {
                documentId: 'doc_memory',
                documentPath: 'memory.md',
                structuralPlaceId: 'place_memory',
                headingPath: ['Memory'],
                sourceQuote: 'Vector index stores memory.',
                sourceHash: 'source'
            },
            links: [],
            generated: {
                generator: 'deterministic-semantic-compiler:v1',
                generatedAt: '2026-06-03T00:00:00.000Z',
                sourceDocumentRevision: 1
            }
        }],
        embeddings: {
            schemaVersion: 1,
            provider: 'mock-deterministic-embedding',
            model: 'deterministic-hash-v1',
            dimensions: 32,
            vectors: [{
                noteId: 'note_memory',
                vector: Array.from({ length: 32 }, () => 0),
                sourceHash: 'source',
                textHash: 'wrong',
                generatedAt: '2026-06-03T00:00:00.000Z'
            }],
            updatedAt: '2026-06-03T00:00:00.000Z'
        }
    } as Parameters<typeof searchRegistry>[0]['registry']

    const report = await searchRegistry({
        query: 'memory',
        registry,
        config: {
            schemaVersion: 1,
            memoryRoot: 'memory',
            areas: { project: { title: 'Project' } },
            indexing: { noteRebuildMode: 'sync' }
        },
        queryVector: Array.from({ length: 1024 }, () => 1),
        queryVectorProvider: 'flagembedding',
        queryVectorModel: 'BAAI/bge-m3'
    })

    assert.equal(report.ok, true)
    assert.equal(report.warnings.some((warning) => warning.message.includes('provider-incompatible')), true)
})

test('LLM grounding fallback marks deterministic generator', async () => {
    const notes = await generateLlmDerivedNotes({
        documentPath: 'memory.md',
        frontmatter: {
            title: 'Memory',
            tags: [],
            rmem: {
                schemaVersion: 1,
                documentId: 'doc_memory',
                kind: 'overview',
                status: 'active',
                createdAt: '2026-06-03T00:00:00.000Z',
                updatedAt: '2026-06-03T00:00:00.000Z',
                revision: 1,
                memoryPath: ['project'],
                language: 'en'
            }
        },
        places: [{
            id: 'place_memory',
            documentId: 'doc_memory',
            documentPath: 'memory.md',
            headingPath: ['Memory'],
            title: 'Memory',
            level: 1,
            orderIndex: 0,
            sourceHash: 'source'
        }],
        bodyByPlace: new Map([['place_memory', 'Grounded source content.']]),
        existingNotes: [],
        now: '2026-06-03T00:00:00.000Z',
        generator: 'ollama:qwen2.5:7b',
        llm: {
            async generateJson<TInput, TOutput>() {
                const output = {
                    title: 'Ungrounded',
                    sourceQuote: 'Text that is not in the source.',
                    canonicalStatement: 'Text that is not in the source.'
                }
                return output as TOutput
            }
        }
    })

    assert.equal(notes.length, 1)
    assert.equal(notes[0]?.generated.generator, 'deterministic-semantic-compiler:v1')
})

test('LLM canonical paraphrase is normalized without provider fallback', async () => {
    const notes = await generateLlmDerivedNotes({
        documentPath: 'memory.md',
        frontmatter: {
            title: 'Memory',
            tags: [],
            rmem: {
                schemaVersion: 1,
                documentId: 'doc_memory',
                kind: 'rules',
                status: 'active',
                createdAt: '2026-06-03T00:00:00.000Z',
                updatedAt: '2026-06-03T00:00:00.000Z',
                revision: 1,
                memoryPath: ['project'],
                language: 'en'
            }
        },
        places: [{
            id: 'place_memory',
            documentId: 'doc_memory',
            documentPath: 'memory.md',
            headingPath: ['Memory'],
            title: 'Memory',
            level: 1,
            orderIndex: 0,
            sourceHash: 'source'
        }],
        bodyByPlace: new Map([['place_memory', 'Agents must use rmem search before changing project memory. Agents must report iteration progress after significant changes.']]),
        existingNotes: [],
        now: '2026-06-03T00:00:00.000Z',
        generator: 'ollama:qwen2.5:7b',
        llm: {
            async generateJson<TInput, TOutput>() {
                const output = {
                    title: 'Agent rules',
                    sourceQuote: 'Agents must use rmem search before changing project memory. Agents must report iteration progress after significant changes.',
                    sourceSummary: 'Agents have rules for memory use and reporting.',
                    canonicalStatement: 'Agents should use rmem search before changing memory and report progress.'
                }
                return output as TOutput
            }
        }
    })

    assert.equal(notes.length, 1)
    assert.equal(notes[0]?.generated.generator, 'ollama:qwen2.5:7b')
    assert.equal(notes[0]?.canonicalStatement, 'Agents must use rmem search before changing project memory.')
})

async function writeOfflineConfig(root: string): Promise<void> {
    await mkdir(join(root, '.rmem'), { recursive: true })
    await mkdir(join(root, 'memory'), { recursive: true })
    await writeFile(join(root, '.rmem', 'config.yaml'), [
        'schemaVersion: 1',
        '',
        'memoryRoot: memory',
        '',
        'areas:',
        '  project:',
        '    title: Project',
        '    description: Offline test memory.',
        '',
        'indexing:',
        '  noteRebuildMode: sync',
        ''
    ].join('\n'), 'utf8')
    await writeFile(join(root, 'memory', 'tree-index.md'), treeIndex([
        ['project', 'Offline test memory.'],
        ['project/architecture', 'Architecture memory.'],
        ['project/rules', 'Rules.'],
        ['project/guide', 'Guides.'],
        ['project/archive', 'Archived documents.']
    ]), 'utf8')
}

function treeIndex(entries: [string, string][]): string {
    return [
        '# Memory Tree Index',
        '',
        '<!-- rmem:tree-index start -->',
        '',
        ...entries.map(([path, description]) => `${'  '.repeat(path.split('/').length - 1)}- \`${path}\` — ${description}`),
        '',
        '<!-- rmem:tree-index end -->',
        ''
    ].join('\n')
}

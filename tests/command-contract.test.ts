import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
    checkCommand,
    createFolderCommand,
    devDocsParseCommand,
    devEmbeddingsStatusCommand,
    devNotesListCommand,
    devSearchTraceCommand,
    listCommand,
    readCommand,
    searchCommand,
    writeCommand
} from '../packages/rmem-core/dist/index.js'

test('public command response contracts stay stable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-contract-'))
    try {
        await writeOfflineConfig(root)
        await createFolderCommand(root, 'project/architecture', {
            title: 'Architecture',
            description: 'Architecture memory.'
        })
        const write = await writeCommand(root, 'architecture/memory.md', '# Project Memory\n\nDocuments are canonical project memory.\n')
        assert.deepEqual(normalize(write), {
            ok: true,
            document: {
                path: 'architecture/memory.md',
                documentId: 'doc_architecture_memory_md',
                title: 'Project Memory',
                kind: 'overview',
                status: 'draft',
                revision: 1,
                memoryPath: ['project', 'architecture'],
                language: 'mixed',
                summary: 'Project Memory'
            },
            created: true,
            changed: true,
            documentHash: '<hash>',
            affected: {
                staleNotes: 0,
                rebuiltNotes: 1,
                structuralPlaces: 1
            },
            warnings: []
        })

        const list = await listCommand(root)
        assert.deepEqual(normalize(list), {
            ok: true,
            path: [],
            items: [
                {
                    type: 'area',
                    key: 'project',
                    title: 'Project',
                    description: 'Offline test memory.'
                },
                {
                    type: 'document',
                    key: 'architecture/memory.md',
                    title: 'Project Memory',
                    document: {
                        path: 'architecture/memory.md',
                        documentId: 'doc_architecture_memory_md',
                        title: 'Project Memory',
                        kind: 'overview',
                        status: 'draft',
                        revision: 1,
                        memoryPath: ['project', 'architecture'],
                        language: 'mixed',
                        summary: 'Project Memory'
                    }
                }
            ]
        })

        const read = await readCommand(root, 'architecture/memory.md')
        assert.deepEqual(normalize(read), {
            ok: true,
            document: {
                path: 'architecture/memory.md',
                documentId: 'doc_architecture_memory_md',
                title: 'Project Memory',
                kind: 'overview',
                status: 'draft',
                revision: 1,
                memoryPath: ['project', 'architecture'],
                language: 'mixed',
                summary: 'Project Memory'
            },
            content: '<content>',
            documentHash: '<hash>',
            warnings: []
        })

        const search = await searchCommand(root, 'canonical memory')
        const normalizedSearch = normalize(search)
        assert.equal(readObjectPath(normalizedSearch, ['ok']), true)
        assert.equal(readArrayLength(normalizedSearch, ['results']), 1)
        assert.equal(readObjectPath(normalizedSearch, ['results', 0, 'document', 'path']), 'architecture/memory.md')
        assert.equal(readArrayLength(normalizedSearch, ['results', 0, 'recommendedCommands']), 1)
        assert.equal(readArrayLength(normalizedSearch, ['recommendedReads']), 1)

        const check = await checkCommand(root)
        assert.deepEqual(normalize(check), {
            ok: true,
            valid: true,
            issues: []
        })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('dev command response contracts stay stable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-contract-'))
    try {
        await writeOfflineConfig(root)
        await createFolderCommand(root, 'project/guide', {
            title: 'Guide',
            description: 'Guides.'
        })
        await writeCommand(root, 'guide/search.md', '# Search Guide\n\nSearch reports return linked knowledge and commands.\n')

        const notes = await devNotesListCommand(root)
        const normalizedNotes = normalize(notes)
        assert.equal(readObjectPath(normalizedNotes, ['ok']), true)
        assert.equal(readArrayLength(normalizedNotes, ['notes']), 1)
        assert.equal(readObjectPath(normalizedNotes, ['notes', 0, 'source', 'documentPath']), 'guide/search.md')

        const parsed = await devDocsParseCommand(root, 'guide/search.md')
        const normalizedParsed = normalize(parsed)
        assert.equal(readObjectPath(normalizedParsed, ['ok']), true)
        assert.equal(readObjectPath(normalizedParsed, ['document', 'path']), 'guide/search.md')
        assert.equal(readArrayLength(normalizedParsed, ['places']), 1)

        const embeddings = await devEmbeddingsStatusCommand(root)
        assert.deepEqual(normalize(embeddings), {
            ok: true,
            provider: 'mock-deterministic-embedding',
            model: 'deterministic-hash-v1',
            indexedNotes: 1,
            dimensions: 32,
            fresh: true
        })

        const trace = await devSearchTraceCommand(root, 'linked knowledge')
        const normalizedTrace = normalize(trace)
        assert.equal(readObjectPath(normalizedTrace, ['ok']), true)
        assert.equal(readObjectPath(normalizedTrace, ['query']), 'linked knowledge')
        assert.equal(readObjectPath(normalizedTrace, ['trace', 'documents']), 1)
        assert.equal(readObjectPath(normalizedTrace, ['trace', 'notes']), 1)
        assert.equal(readObjectPath(normalizedTrace, ['report', 'ok']), true)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

function normalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => normalize(item))
    }

    if (typeof value === 'object' && value !== null) {
        const normalized: Record<string, unknown> = {}
        for (const [key, child] of Object.entries(value)) {
            if (key === 'generatedAt' || key === 'createdAt' || key === 'updatedAt') {
                normalized[key] = '<timestamp>'
            } else if (key === 'documentHash' || key === 'contentHash' || key === 'sourceHash' || key === 'textHash') {
                normalized[key] = '<hash>'
            } else if (key === 'vector') {
                normalized[key] = '<vector>'
            } else if (key === 'content') {
                normalized[key] = '<content>'
            } else {
                normalized[key] = normalize(child)
            }
        }
        return normalized
    }

    return value
}

function readObjectPath(value: unknown, path: (string | number)[]): unknown {
    let current = value
    for (const segment of path) {
        if (typeof segment === 'number') {
            if (!Array.isArray(current)) {
                return undefined
            }
            current = current[segment]
        } else {
            if (typeof current !== 'object' || current === null || !(segment in current)) {
                return undefined
            }
            current = (current as Record<string, unknown>)[segment]
        }
    }

    return current
}

function readArrayLength(value: unknown, path: (string | number)[]): number {
    const target = readObjectPath(value, path)
    return Array.isArray(target) ? target.length : -1
}

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
        ['project/guide', 'Guides.']
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

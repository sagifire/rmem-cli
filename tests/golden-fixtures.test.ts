import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
    isCommandError,
    searchCommand,
    writeCommand
} from '../packages/rmem-core/dist/index.js'

test('golden fixture wiki-small returns architecture memory result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-fixture-'))
    try {
        await writeOfflineConfig(root)
        const content = await readFixture('wiki-small', 'architecture.md')
        const write = await writeCommand(root, 'architecture.md', content)
        assert.equal(write.ok, true)

        const search = await searchCommand(root, 'canonical project memory')
        assert.equal(search.ok, true)
        assert.equal(search.results[0]?.document.path, 'architecture.md')
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('golden fixture Ukrainian memory remains searchable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-fixture-'))
    try {
        await writeOfflineConfig(root)
        const content = await readFixture('wiki-ukrainian-inflections', 'memory.md')
        const write = await writeCommand(root, 'memory.md', content)
        assert.equal(write.ok, true)

        const search = await searchCommand(root, 'архітектуру рішення правила')
        assert.equal(search.ok, true)
        assert.equal(search.results.length > 0, true)
        assert.equal(search.results[0]?.document.path, 'memory.md')
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('golden fixture agent rules preserves edit/read protocol knowledge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-fixture-'))
    try {
        await writeOfflineConfig(root)
        const content = await readFixture('wiki-agent-rules', 'rules.md')
        const write = await writeCommand(root, 'rules.md', content)
        assert.equal(write.ok, true)

        const search = await searchCommand(root, 'точну заміну rmem edit')
        assert.equal(search.ok, true)
        assert.equal(search.results[0]?.document.path, 'rules.md')
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('golden fixture broken documents are rejected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-fixture-'))
    try {
        await writeOfflineConfig(root)
        const content = await readFixture('wiki-broken-documents', 'broken-heading.md')
        const write = await writeCommand(root, 'broken-heading.md', content)
        assert.equal(isCommandError(write), true)
        if (isCommandError(write)) {
            assert.equal(write.code, 'INVALID_MARKDOWN')
        }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

async function readFixture(folder: string, file: string): Promise<string> {
    return readFile(join(process.cwd(), 'tests', 'fixtures', folder, file), 'utf8')
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
        '    description: Offline fixture memory.',
        '',
        'indexing:',
        '  noteRebuildMode: sync',
        ''
    ].join('\n'), 'utf8')
    await writeFile(join(root, 'memory', 'tree-index.md'), treeIndex([
        ['project', 'Offline fixture memory.']
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

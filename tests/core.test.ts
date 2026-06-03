import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import {
    checkCommand,
    devLinksValidateCommand,
    editCommand,
    isCommandError,
    listCommand,
    readCommand,
    removeCommand,
    searchCommand,
    writeCommand
} from '../packages/rmem-core/dist/index.js'

test('document workflow writes, reads, searches, edits and checks memory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
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
        await writeCommand(root, 'valid.md', '# Valid\n\nContent\n')
        const path = join(root, 'memory', 'broken.md')
        await import('node:fs/promises').then((fs) => fs.writeFile(path, Buffer.from([0xff, 0xfe, 0xfd])))

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
        await writeCommand(root, 'archive/me.md', '# Archive Me\n\nBody\n')
        const result = await removeCommand(root, 'archive/me.md')
        assert.equal(result.ok, true)
        const content = await readFile(join(root, 'memory', 'archive', 'me.md'), 'utf8')
        assert.equal(content.includes('status: archived'), true)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('check detects registry drift and invalid Markdown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-'))
    try {
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

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
    checkCommand,
    searchCommand,
    writeCommand
} from '../packages/rmem-core/dist/index.js'

test('performance smoke handles small multi-document corpus offline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rmem-perf-'))
    const startedAt = performance.now()

    try {
        await writeOfflineConfig(root)
        for (let index = 0; index < 25; index += 1) {
            const content = [
                `# Performance Document ${index}`,
                '',
                `Document ${index} describes project memory indexing, retrieval, notes and links.`,
                'The corpus is intentionally small enough for normal CI but catches accidental quadratic regressions.'
            ].join('\n')
            const write = await writeCommand(root, `performance/doc-${index}.md`, content)
            assert.equal(write.ok, true)
        }

        const search = await searchCommand(root, 'project memory retrieval links')
        assert.equal(search.ok, true)
        assert.equal(search.results.length > 0, true)

        const check = await checkCommand(root)
        assert.equal(check.ok, true)
        assert.equal(check.valid, true)

        const elapsedMs = performance.now() - startedAt
        assert.equal(elapsedMs < 10_000, true)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
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
        '    description: Offline performance memory.',
        '',
        'indexing:',
        '  noteRebuildMode: sync',
        ''
    ].join('\n'), 'utf8')
}

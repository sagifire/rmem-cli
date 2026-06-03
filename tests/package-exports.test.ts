import assert from 'node:assert/strict'
import test from 'node:test'

test('@rmem/core exposes only the root package API', async () => {
    const core = await import('@rmem/core')
    assert.equal(typeof core.searchCommand, 'function')
    assert.equal(typeof core.writeCommand, 'function')

    await assert.rejects(
        async () => {
            const internalPath = '@rmem/core/commands/internal.js'
            await import(internalPath)
        },
        (error: unknown) => {
            return typeof error === 'object'
                && error !== null
                && 'code' in error
                && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'
        }
    )
})

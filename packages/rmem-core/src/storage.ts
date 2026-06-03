import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RegistryState } from './types.js'
import { decodeUtf8 } from './encoding.js'

export function emptyRegistry(): RegistryState {
    return {
        schemaVersion: 1,
        documents: [],
        places: [],
        notes: []
    }
}

export async function readUtf8File(path: string): Promise<string> {
    const bytes = await readFile(path)
    return decodeUtf8(bytes)
}

export async function atomicWriteUtf8(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const tempPath = join(dirname(path), `.${randomUUID()}.tmp`)
    await writeFile(tempPath, content, { encoding: 'utf8' })
    const verify = await readUtf8File(tempPath)

    if (verify !== content) {
        await rm(tempPath, { force: true })
        throw new Error('Written content verification failed.')
    }

    await rename(tempPath, path)
}

export async function loadRegistry(root: string): Promise<RegistryState> {
    const path = registryPath(root)
    try {
        return normalizeRegistry(JSON.parse(await readUtf8File(path)) as Partial<RegistryState>)
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return emptyRegistry()
        }

        throw error
    }
}

function normalizeRegistry(registry: Partial<RegistryState>): RegistryState {
    const result: RegistryState = {
        schemaVersion: registry.schemaVersion ?? 1,
        documents: registry.documents ?? [],
        places: registry.places ?? [],
        notes: registry.notes ?? []
    }

    if (registry.embeddings !== undefined) {
        result.embeddings = registry.embeddings
    }

    return result
}

export async function saveRegistry(root: string, registry: RegistryState): Promise<void> {
    await atomicWriteUtf8(registryPath(root), `${JSON.stringify(registry, null, 4)}\n`)
}

export function registryPath(root: string): string {
    return join(root, '.rmem', 'registry', 'state.json')
}

export function resolveMemoryPath(root: string, memoryRoot: string, documentPath: string): string {
    const memoryRootPath = resolve(root, memoryRoot)
    const targetPath = resolve(memoryRootPath, normalize(documentPath))
    const relativePath = relative(memoryRootPath, targetPath)

    if (relativePath.startsWith('..') || relativePath === '..' || relativePath.includes(`..\\`) || relativePath.includes('../')) {
        throw new Error('Document path escapes memory root.')
    }

    return targetPath
}

export function toRegistryDocumentPath(documentPath: string): string {
    return normalize(documentPath).replace(/\\/g, '/')
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error
}

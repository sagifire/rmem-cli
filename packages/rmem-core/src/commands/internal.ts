import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { RegistryState, RmemConfig, RmemWarning, DocumentReport, WriteDocumentResponse } from '../types.js'
import { isCommandError } from '../errors.js'
import { serializeDocument } from '../frontmatter.js'
import { normalizeLineEndings, sha256 } from '../hash.js'
import { extractStructuralPlaces } from '../markdown.js'
import { stripManagedHeader } from '../managed-header.js'
import { loadRegistry, readUtf8File, saveRegistry } from '../storage.js'
import { generateDerivedNotes, generateLlmDerivedNotes, markNotesStale, validateGeneratedNote } from '../notes.js'
import { buildVectorIndex, MockEmbeddingProvider } from '../embeddings.js'
import { createEmbeddingProvider, createLlmProvider } from '../providers.js'

export async function updateRegistryAfterWrite(
    root: string,
    config: RmemConfig,
    documentPath: string,
    frontmatter: Parameters<typeof reportFromFrontmatter>[1],
    body: string,
    options: { created: boolean, changed: boolean, staleOnly: boolean }
): Promise<WriteDocumentResponse> {
    const registry = await loadRegistry(root)
    const report = reportFromFrontmatter(documentPath, frontmatter)
    const documentHash = hashDocument(frontmatter, body)
    const contentHash = sha256(stripManagedHeader(body))
    const places = extractStructuralPlaces({
        documentId: frontmatter.rmem.documentId,
        documentPath,
        body
    })
    const staleBefore = registry.notes.filter((note) => note.source.documentId === frontmatter.rmem.documentId && note.status !== 'archived').length
    registry.notes = markNotesStale(registry.notes, frontmatter.rmem.documentId)
    registry.places = registry.places.filter((place) => place.documentId !== frontmatter.rmem.documentId)
    registry.places.push(...places)
    registry.documents = registry.documents.filter((record) => record.path !== documentPath)
    registry.documents.push({
        path: documentPath,
        document: report,
        documentHash,
        contentHash,
        archived: false,
        updatedAt: frontmatter.rmem.updatedAt
    })

    let rebuiltNotes = 0
    const warnings: RmemWarning[] = []
    if (!options.staleOnly && config.indexing.noteRebuildMode === 'sync') {
        const bodyByPlace = bodyByPlaceId(body, places)
        const noteBuild = await generateNotesBestEffort({
            config,
            documentPath,
            frontmatter,
            places,
            bodyByPlace,
            existingNotes: registry.notes.filter((note) => note.source.documentId !== frontmatter.rmem.documentId),
            now: new Date().toISOString()
        })
        warnings.push(...noteBuild.warnings)
        const notes = noteBuild.notes.filter(validateGeneratedNote)
        registry.notes = registry.notes.filter((note) => note.source.documentId !== frontmatter.rmem.documentId)
        registry.notes.push(...notes)
        rebuiltNotes = notes.length
    }

    const embeddingRebuild = await rebuildVectorIndexBestEffort(config, registry)

    await saveRegistry(root, registry)

    return {
        ok: true,
        document: report,
        created: options.created,
        changed: options.changed,
        documentHash,
        affected: {
            staleNotes: staleBefore,
            rebuiltNotes,
            structuralPlaces: places.length
        },
        warnings: [...warnings, ...embeddingRebuild.warnings]
    }
}

export async function generateNotesBestEffort(input: {
    config: RmemConfig
    documentPath: string
    frontmatter: Parameters<typeof reportFromFrontmatter>[1]
    places: RegistryState['places']
    bodyByPlace: Map<string, string>
    existingNotes: RegistryState['notes']
    now: string
}): Promise<{ notes: RegistryState['notes'], warnings: RmemWarning[] }> {
    const llm = createLlmProvider(input.config)
    if (llm !== undefined) {
        try {
            const notes = await generateLlmDerivedNotes({
                documentPath: input.documentPath,
                frontmatter: input.frontmatter,
                places: input.places,
                bodyByPlace: input.bodyByPlace,
                existingNotes: input.existingNotes,
                now: input.now,
                llm: llm.provider,
                generator: `${llm.providerName}:${llm.model}`
            })
            const groundedFallbacks = notes.filter((note) => note.generated.generator === 'deterministic-semantic-compiler:v1').length
            return {
                notes,
                warnings: groundedFallbacks > 0
                    ? [{
                        code: 'LLM_OUTPUT_GROUNDING_FAILED',
                        message: 'LLM output failed grounding checks for some notes; deterministic note compiler was used for those notes.',
                        details: { fallbackNotes: groundedFallbacks }
                    }]
                    : []
            }
        } catch (error) {
            return {
                notes: generateDerivedNotes({
                    documentPath: input.documentPath,
                    frontmatter: input.frontmatter,
                    places: input.places,
                    bodyByPlace: input.bodyByPlace,
                    existingNotes: input.existingNotes,
                    now: input.now
                }),
                warnings: [{
                    code: 'LLM_PROVIDER_FAILED',
                    message: 'Configured LLM provider failed; deterministic note compiler was used.',
                    details: String(error)
                }]
            }
        }
    }

    return {
        notes: generateDerivedNotes({
            documentPath: input.documentPath,
            frontmatter: input.frontmatter,
            places: input.places,
            bodyByPlace: input.bodyByPlace,
            existingNotes: input.existingNotes,
            now: input.now
        }),
        warnings: []
    }
}

export type EmbeddingRebuildReport = {
    provider: string
    model: string
    indexedNotes: number
    dimensions: number
    fallbackUsed: boolean
}

export async function rebuildVectorIndexBestEffort(config: RmemConfig, registry: RegistryState): Promise<{
    report: EmbeddingRebuildReport
    warnings: RmemWarning[]
}> {
    const now = new Date().toISOString()
    const configured = createEmbeddingProvider(config)
    const warnings: RmemWarning[] = []

    try {
        registry.embeddings = await buildVectorIndex({
            notes: registry.notes,
            provider: configured.provider,
            providerName: configured.providerName,
            model: configured.model,
            now
        })

        return {
            report: {
                provider: registry.embeddings.provider,
                model: registry.embeddings.model,
                indexedNotes: registry.embeddings.vectors.length,
                dimensions: registry.embeddings.dimensions,
                fallbackUsed: false
            },
            warnings
        }
    } catch (error) {
        warnings.push({
            code: 'EMBEDDING_PROVIDER_FAILED',
            message: 'Configured embedding provider failed; deterministic fallback index was built.',
            details: String(error)
        })
    }

    const fallbackProvider = new MockEmbeddingProvider()
    registry.embeddings = await buildVectorIndex({
        notes: registry.notes,
        provider: fallbackProvider,
        providerName: 'mock-deterministic-embedding',
        model: 'deterministic-hash-v1',
        now
    })

    return {
        report: {
            provider: registry.embeddings.provider,
            model: registry.embeddings.model,
            indexedNotes: registry.embeddings.vectors.length,
            dimensions: registry.embeddings.dimensions,
            fallbackUsed: true
        },
        warnings
    }
}

export async function queryVectorBestEffort(config: RmemConfig, query: string): Promise<{
    vector: number[]
    provider: string
    model: string
    warnings: RmemWarning[]
}> {
    const configured = createEmbeddingProvider(config)
    const warnings: RmemWarning[] = []

    try {
        const vectors = await configured.provider.embedTexts([query])
        const vector = vectors[0]
        if (vector === undefined || vector.length === 0) {
            throw new Error('Embedding provider returned an empty query vector.')
        }

        return {
            vector,
            provider: configured.providerName,
            model: configured.model,
            warnings
        }
    } catch (error) {
        warnings.push({
            code: 'EMBEDDING_PROVIDER_FAILED',
            message: 'Configured embedding provider failed for query; deterministic fallback vector was used.',
            details: String(error)
        })
    }

    const fallbackProvider = new MockEmbeddingProvider()
    const vectors = await fallbackProvider.embedTexts([query])
    return {
        vector: vectors[0] ?? [],
        provider: 'mock-deterministic-embedding',
        model: 'deterministic-hash-v1',
        warnings
    }
}

export function reportFromFrontmatter(path: string, frontmatter: Parameters<typeof hashDocument>[0]): DocumentReport {
    const result: DocumentReport = {
        path,
        documentId: frontmatter.rmem.documentId,
        title: frontmatter.title,
        kind: frontmatter.rmem.kind,
        status: frontmatter.rmem.status,
        revision: frontmatter.rmem.revision,
        memoryPath: frontmatter.rmem.memoryPath,
        language: frontmatter.rmem.language
    }

    if (frontmatter.summary !== undefined) {
        result.summary = frontmatter.summary
    }

    return result
}

export function hashDocument(frontmatter: Parameters<typeof serializeDocument>[0], body: string): string {
    const stableFrontmatter = {
        ...frontmatter,
        rmem: {
            ...frontmatter.rmem,
            updatedAt: ''
        }
    }

    return sha256(serializeDocument(stableFrontmatter, stripManagedHeader(body)))
}

export function titleFromDocumentContent(content: string, documentPath: string): string {
    const heading = content.match(/^#\s+(.+)$/m)?.[1]
    if (heading !== undefined && heading.trim().length > 0) {
        return heading.trim()
    }

    return documentPath.replace(/\.[^.]+$/, '').split(/[\\/]/).at(-1) ?? 'Document'
}

export function firstParagraph(content: string): string | undefined {
    const paragraph = stripManagedHeader(content)
        .split(/\n\s*\n/)
        .map((part) => part.replace(/^#+\s+/gm, '').trim())
        .find((part) => part.length > 0)

    return paragraph?.slice(0, 300)
}

export function countOccurrences(content: string, oldText: string): number {
    if (oldText.length === 0) {
        return 0
    }

    let count = 0
    let offset = content.indexOf(oldText)
    while (offset !== -1) {
        count += 1
        offset = content.indexOf(oldText, offset + oldText.length)
    }

    return count
}

export async function tryReadExisting(path: string): Promise<string | undefined> {
    try {
        return normalizeLineEndings(await readUtf8File(path))
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return undefined
        }

        throw error
    }
}

export async function* listMarkdownFiles(root: string): AsyncGenerator<string> {
    let entries: import('node:fs').Dirent[]
    try {
        entries = await readdir(root, { withFileTypes: true })
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return
        }
        throw error
    }

    for (const entry of entries) {
        const fullPath = join(root, entry.name)
        if (entry.isDirectory()) {
            yield* listMarkdownFiles(fullPath)
        } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
            yield fullPath
        }
    }
}

export function bodyByPlaceId(body: string, places: { id: string, startOffset?: number, endOffset?: number }[]): Map<string, string> {
    const source = stripManagedHeader(body)
    const result = new Map<string, string>()
    for (const place of places) {
        result.set(place.id, source.slice(place.startOffset ?? 0, place.endOffset ?? source.length))
    }

    return result
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error
}

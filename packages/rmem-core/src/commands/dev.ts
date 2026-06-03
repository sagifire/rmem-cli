import type { CommandResult, DocumentReport, RegistryState, RmemWarning } from '../types.js'
import { commandError, isCommandError } from '../errors.js'
import { loadConfig } from '../config.js'
import { parseDocumentMarkdown } from '../frontmatter.js'
import { normalizeLineEndings } from '../hash.js'
import { extractStructuralPlaces } from '../markdown.js'
import { loadRegistry, readUtf8File, resolveMemoryPath, saveRegistry, toRegistryDocumentPath } from '../storage.js'
import { isVectorIndexFresh } from '../embeddings.js'
import { checkProviders } from '../providers.js'
import { searchRegistry } from '../search.js'
import {
    bodyByPlaceId,
    EmbeddingRebuildReport,
    generateNotesBestEffort,
    isNodeError,
    queryVectorBestEffort,
    rebuildVectorIndexBestEffort,
    reportFromFrontmatter
} from './internal.js'

export async function devRebuildCommand(root: string): Promise<CommandResult<{ ok: true, rebuiltNotes: number, embeddings: EmbeddingRebuildReport, warnings: RmemWarning[] }>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const registry = await loadRegistry(root)
    let rebuiltNotes = 0
    const warnings: RmemWarning[] = []

    for (const record of registry.documents.filter((item) => !item.archived)) {
        const fullPath = resolveMemoryPath(root, config.memoryRoot, record.path)
        const content = normalizeLineEndings(await readUtf8File(fullPath))
        const parsed = parseDocumentMarkdown(content)
        if (isCommandError(parsed)) {
            return parsed
        }

        const places = extractStructuralPlaces({
            documentId: parsed.frontmatter.rmem.documentId,
            documentPath: record.path,
            body: parsed.body
        })
        const bodyByPlace = bodyByPlaceId(parsed.body, places)
        const noteBuild = await generateNotesBestEffort({
            config,
            documentPath: record.path,
            frontmatter: parsed.frontmatter,
            places,
            bodyByPlace,
            existingNotes: registry.notes.filter((note) => note.source.documentId !== parsed.frontmatter.rmem.documentId),
            now: new Date().toISOString()
        })
        warnings.push(...noteBuild.warnings)
        const notes = noteBuild.notes
        rebuiltNotes += notes.length
        registry.notes = registry.notes.filter((note) => note.source.documentId !== parsed.frontmatter.rmem.documentId)
        registry.notes.push(...notes)
        registry.places = registry.places.filter((place) => place.documentId !== parsed.frontmatter.rmem.documentId)
        registry.places.push(...places)
    }

    const embeddingRebuild = await rebuildVectorIndexBestEffort(config, registry)
    await saveRegistry(root, registry)

    return {
        ok: true,
        rebuiltNotes,
        embeddings: embeddingRebuild.report,
        warnings: [...warnings, ...embeddingRebuild.warnings]
    }
}

export async function devNotesListCommand(root: string): Promise<CommandResult<{ ok: true, notes: RegistryState['notes'] }>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const registry = await loadRegistry(root)
    return {
        ok: true,
        notes: registry.notes
    }
}

export async function devDocsParseCommand(root: string, documentPath: string): Promise<CommandResult<{ ok: true, document: DocumentReport, places: RegistryState['places'] }>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const fullPath = resolveMemoryPath(root, config.memoryRoot, documentPath)
    try {
        const content = normalizeLineEndings(await readUtf8File(fullPath))
        const parsed = parseDocumentMarkdown(content)
        if (isCommandError(parsed)) {
            return parsed
        }

        return {
            ok: true,
            document: reportFromFrontmatter(toRegistryDocumentPath(documentPath), parsed.frontmatter),
            places: extractStructuralPlaces({
                documentId: parsed.frontmatter.rmem.documentId,
                documentPath: toRegistryDocumentPath(documentPath),
                body: parsed.body
            })
        }
    } catch (error) {
        return commandError({
            code: 'DOCUMENT_NOT_FOUND',
            message: `Document could not be parsed: ${documentPath}`,
            details: String(error),
            suggestion: 'Use rmem list to find an existing document.'
        })
    }
}

export async function devEmbeddingsStatusCommand(root: string): Promise<CommandResult<{ ok: true, provider: string, model: string, indexedNotes: number, dimensions: number | null, fresh: boolean }>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const registry = await loadRegistry(root)
    const index = registry.embeddings
    return {
        ok: true,
        provider: index?.provider ?? 'none',
        model: index?.model ?? 'none',
        indexedNotes: index?.vectors.length ?? 0,
        dimensions: index?.dimensions ?? null,
        fresh: isVectorIndexFresh(index, registry.notes)
    }
}

export async function devLinksValidateCommand(root: string): Promise<CommandResult<{ ok: true, valid: boolean, issues: RmemWarning[] }>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const registry = await loadRegistry(root)
    const noteIds = new Set(registry.notes.map((note) => note.id))
    const issues: RmemWarning[] = []

    for (const note of registry.notes) {
        for (const link of note.links) {
            if (!noteIds.has(link.targetNoteId)) {
                issues.push({
                    code: 'BROKEN_LINK',
                    message: 'Note link points to a missing target note.',
                    details: { noteId: note.id, targetNoteId: link.targetNoteId }
                })
            }
        }
    }

    return {
        ok: true,
        valid: issues.length === 0,
        issues
    }
}

export async function devSearchTraceCommand(root: string, query: string): Promise<CommandResult<{ ok: true, query: string, trace: unknown, report: Awaited<ReturnType<typeof searchRegistry>> }>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const registry = await loadRegistry(root)
    const queryEmbedding = await queryVectorBestEffort(config, query)
    const report = await searchRegistry({
        query,
        registry,
        config,
        queryVector: queryEmbedding.vector,
        queryVectorProvider: queryEmbedding.provider,
        queryVectorModel: queryEmbedding.model,
        warnings: queryEmbedding.warnings
    })

    return {
        ok: true,
        query,
        trace: {
            documents: registry.documents.length,
            notes: registry.notes.length,
            activeNotes: registry.notes.filter((note) => note.status === 'active').length,
            vectorIndex: registry.embeddings === undefined
                ? undefined
                : {
                    provider: registry.embeddings.provider,
                    model: registry.embeddings.model,
                    dimensions: registry.embeddings.dimensions,
                    vectors: registry.embeddings.vectors.length,
                    fresh: isVectorIndexFresh(registry.embeddings, registry.notes)
                },
            strategy: 'lexical-plus-vector-note-retrieval-with-document-context'
        },
        report
    }
}

export async function devProvidersCheckCommand(root: string): Promise<CommandResult<Awaited<ReturnType<typeof checkProviders>>>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    return checkProviders(config)
}


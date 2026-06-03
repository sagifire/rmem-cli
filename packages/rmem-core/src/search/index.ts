import type { MemoryPathUnitReport, RegistryState, RmemConfig, SearchResponse, SearchResult } from '../types.js'
import { MockEmbeddingProvider, cosineSimilarity, embedText, isVectorIndexCompatible, isVectorIndexFresh } from '../embeddings.js'

export async function searchRegistry(input: {
    query: string
    registry: RegistryState
    config: RmemConfig
    queryVector?: number[]
    queryVectorProvider?: string
    queryVectorModel?: string
    warnings?: SearchResponse['warnings']
}): Promise<SearchResponse> {
    const terms = tokenize(input.query)
    const fallbackQueryEmbedding = embedText(input.query)
    const vectorByNote = new Map((input.registry.embeddings?.vectors ?? []).map((vector) => [vector.noteId, vector.vector]))
    const hasFreshVectorIndex = isVectorIndexFresh(input.registry.embeddings, input.registry.notes)
    const hasCompatibleVectorIndex = input.queryVectorProvider !== undefined
        && input.queryVectorModel !== undefined
        && isVectorIndexCompatible(input.registry.embeddings, input.queryVectorProvider, input.queryVectorModel)
    const canUseVectorIndex = hasFreshVectorIndex && hasCompatibleVectorIndex
    const scored = input.registry.notes
        .filter((note) => note.status !== 'archived')
        .map((note) => {
            const document = input.registry.documents.find((candidate) => candidate.document.documentId === note.source.documentId)
            const place = input.registry.places.find((candidate) => candidate.id === note.source.structuralPlaceId)
            const lexicalScore = scoreText(note.retrievalText, terms)
            const indexedVector = vectorByNote.get(note.id)
            const denseScore = canUseVectorIndex && input.queryVector !== undefined && indexedVector !== undefined
                ? cosineSimilarity(input.queryVector, indexedVector)
                : cosineSimilarity(fallbackQueryEmbedding, embedText(note.retrievalText))
            const graphBoost = note.links.length > 0 ? 0.1 : 0
            const score = lexicalScore + denseScore + graphBoost
            return { note, document, place, score }
        })
        .filter((item) => item.document !== undefined && item.score > 0.05)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5)

    const results: SearchResult[] = scored.map((item, index) => {
        const document = item.document
        if (document === undefined) {
            throw new Error('Search candidate document is missing.')
        }

        const result: SearchResult = {
            rank: index + 1,
            score: item.score,
            note: {
                id: item.note.id,
                title: item.note.title,
                type: item.note.type,
                status: item.note.status,
                sourceSummary: item.note.sourceSummary
            },
            document: {
                path: document.path,
                documentId: document.document.documentId,
                title: document.document.title,
                kind: document.document.kind,
                status: document.document.status
            },
            memoryPath: memoryPathReport(document.document.memoryPath, input.config),
            linkedKnowledge: item.note.links.map((link) => {
                const linkedNote = input.registry.notes.find((note) => note.id === link.targetNoteId)
                const linked = {
                    noteId: link.targetNoteId,
                    title: linkedNote?.title ?? link.targetNoteId,
                    type: link.type
                }
                if (link.reason !== undefined) {
                    return {
                        ...linked,
                        reason: link.reason
                    }
                }

                return linked
            }),
            recommendedCommands: [
                `rmem read ${document.path}`
            ]
        }

        if (document.document.summary !== undefined) {
            result.document.summary = document.document.summary
        }

        if (item.note.contextualizedSummary !== undefined) {
            result.note = {
                id: item.note.id,
                title: item.note.title,
                type: item.note.type,
                status: item.note.status,
                sourceSummary: item.note.sourceSummary,
                contextualizedSummary: item.note.contextualizedSummary
            }
        }

        if (item.place !== undefined) {
            result.targetPlace = {
                placeId: item.place.id,
                headingPath: item.place.headingPath,
                excerpt: item.note.source.sourceQuote
            }
        }

        return result
    })

    return {
        ok: true,
        query: input.query,
        summary: results.length === 0
            ? 'No relevant memory notes were found.'
            : `Found ${results.length} relevant memory result(s).`,
        results,
        recommendedReads: results.map((result) => ({
            path: result.document.path,
            reason: 'Relevant canonical document for this query.'
        })),
        warnings: [
            ...(input.warnings ?? []),
            ...input.registry.notes.some((note) => note.status === 'stale')
                ? [{ code: 'STALE_INDEX', message: 'Some notes are stale and search results may need rebuild.' }]
                : [],
            ...canUseVectorIndex
                ? []
                : [{ code: 'STALE_INDEX', message: 'Vector index is missing, stale, or provider-incompatible; deterministic fallback embeddings were used.' }]
        ]
    }
}

export async function deterministicQueryVector(query: string): Promise<number[]> {
    const provider = new MockEmbeddingProvider()
    const vectors = await provider.embedTexts([query])
    return vectors[0] ?? []
}

export function memoryPathReport(path: string[], config: RmemConfig): MemoryPathUnitReport[] {
    return path.map((unit, index) => {
        const key = path.slice(0, index + 1).join('/')
        const area = config.areas[key]
        if (area === undefined) {
            return { key, title: unit }
        }

        const result: MemoryPathUnitReport = {
            key,
            title: area.title
        }

        if (area.description !== undefined) {
            result.description = area.description
        }

        return result
    })
}

function tokenize(value: string): string[] {
    return value
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((term) => term.trim())
        .filter((term) => term.length > 0)
}

function scoreText(text: string, terms: string[]): number {
    const lower = text.toLowerCase()
    let score = 0

    for (const term of terms) {
        const occurrences = lower.split(term).length - 1
        score += occurrences
    }

    return score
}

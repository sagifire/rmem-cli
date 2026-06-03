import type { EmbeddingProvider, EmbeddingVector, MemoryNote, VectorIndexState } from '../types.js'
import { sha256 } from '../hash.js'

export class MockEmbeddingProvider implements EmbeddingProvider {
    async embedTexts(texts: string[]): Promise<EmbeddingVector[]> {
        return texts.map((text) => embedText(text))
    }
}

export function embedText(text: string): EmbeddingVector {
    const dimensions = 32
    const vector = Array.from({ length: dimensions }, () => 0)
    const terms = tokenize(text)

    for (const term of terms) {
        const index = hashTerm(term) % dimensions
        const current = vector[index]
        if (current !== undefined) {
            vector[index] = current + 1
        }
    }

    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    if (magnitude === 0) {
        return vector
    }

    return vector.map((value) => value / magnitude)
}

export function cosineSimilarity(left: EmbeddingVector, right: EmbeddingVector): number {
    const length = Math.min(left.length, right.length)
    let score = 0

    for (let index = 0; index < length; index += 1) {
        score += (left[index] ?? 0) * (right[index] ?? 0)
    }

    return score
}

export async function buildVectorIndex(input: {
    notes: MemoryNote[]
    provider: EmbeddingProvider
    providerName: string
    model: string
    now: string
}): Promise<VectorIndexState> {
    const activeNotes = input.notes.filter((note) => note.status === 'active')
    const vectors = await input.provider.embedTexts(activeNotes.map((note) => note.retrievalText))
    const firstVector = vectors[0]
    const dimensions = firstVector?.length ?? 0

    if (vectors.length !== activeNotes.length) {
        throw new Error(`Embedding provider returned ${vectors.length} vector(s) for ${activeNotes.length} text(s).`)
    }

    if (activeNotes.length > 0 && dimensions === 0) {
        throw new Error('Embedding provider returned an empty vector.')
    }

    for (const vector of vectors) {
        if (vector.length !== dimensions) {
            throw new Error('Embedding provider returned vectors with inconsistent dimensions.')
        }
    }

    return {
        schemaVersion: 1,
        provider: input.providerName,
        model: input.model,
        dimensions,
        vectors: activeNotes.map((note, index) => ({
            noteId: note.id,
            vector: vectors[index] ?? [],
            sourceHash: note.source.sourceHash,
            textHash: sha256(note.retrievalText),
            generatedAt: input.now
        })),
        updatedAt: input.now
    }
}

export function isVectorIndexFresh(index: VectorIndexState | undefined, notes: MemoryNote[]): boolean {
    if (index === undefined) {
        return false
    }

    const activeNotes = notes.filter((note) => note.status === 'active')
    if (index.vectors.length !== activeNotes.length) {
        return false
    }

    const vectorByNote = new Map(index.vectors.map((vector) => [vector.noteId, vector]))
    for (const note of activeNotes) {
        const vector = vectorByNote.get(note.id)
        if (vector === undefined || vector.sourceHash !== note.source.sourceHash || vector.textHash !== sha256(note.retrievalText)) {
            return false
        }
    }

    return true
}

export function isVectorIndexCompatible(index: VectorIndexState | undefined, providerName: string, model: string): boolean {
    return index !== undefined
        && index.provider === providerName
        && index.model === model
        && index.dimensions > 0
}

function tokenize(value: string): string[] {
    return value
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter((term) => term.length > 0)
}

function hashTerm(value: string): number {
    let hash = 2166136261
    for (const char of value) {
        hash ^= char.codePointAt(0) ?? 0
        hash = Math.imul(hash, 16777619)
    }

    return Math.abs(hash)
}

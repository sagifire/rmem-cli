import type { EmbeddingProvider, EmbeddingVector } from './types.js'

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

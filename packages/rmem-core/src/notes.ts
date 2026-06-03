import type { MemoryNote, RmemDocumentFrontmatter, StructuralPlace } from './types.js'
import { sha256 } from './hash.js'

export function generateDerivedNotes(input: {
    documentPath: string
    frontmatter: RmemDocumentFrontmatter
    places: StructuralPlace[]
    bodyByPlace: Map<string, string>
    existingNotes: MemoryNote[]
    now: string
}): MemoryNote[] {
    const notes: MemoryNote[] = []

    for (const place of input.places) {
        const content = input.bodyByPlace.get(place.id)?.trim() ?? ''
        if (content.length === 0) {
            continue
        }

        const segment = synthesizeSegment(content, input.frontmatter, place)
        const relatedNotes = findCandidateLinkedNotes(segment.retrievalSeed, input.existingNotes)
        const retrievalText = [
            segment.title,
            input.frontmatter.title,
            segment.sourceSummary,
            segment.canonicalStatement,
            segment.sourceQuote,
            ...(input.frontmatter.tags ?? []),
            ...(input.frontmatter.rmem.aliases ?? []),
            ...input.frontmatter.rmem.memoryPath
        ].join('\n')

        const note: MemoryNote = {
            id: `note_${sha256(`${input.frontmatter.rmem.documentId}:${place.id}`).slice(0, 16)}`,
            type: noteTypeForKind(input.frontmatter.rmem.kind),
            status: 'active',
            title: segment.title,
            sourceSummary: segment.sourceSummary,
            canonicalStatement: segment.canonicalStatement,
            retrievalText,
            tags: dedupe(input.frontmatter.tags ?? []),
            aliases: dedupe(input.frontmatter.rmem.aliases ?? []),
            entities: extractEntities(segment.sourceQuote),
            source: {
                documentId: input.frontmatter.rmem.documentId,
                documentPath: input.documentPath,
                structuralPlaceId: place.id,
                headingPath: place.headingPath,
                sourceQuote: segment.sourceQuote,
                sourceHash: place.sourceHash
            },
            links: relatedNotes.map((note) => ({
                targetNoteId: note.id,
                type: 'related_to',
                direction: 'outgoing',
                reason: 'Deterministic lexical candidate linking found shared retrieval terms.',
                confidence: 0.7
            })),
            generated: {
                generator: 'deterministic-semantic-compiler:v1',
                generatedAt: input.now,
                sourceDocumentRevision: input.frontmatter.rmem.revision
            }
        }

        if (relatedNotes.length > 0) {
            note.contextualizedSummary = `Related active notes: ${relatedNotes.map((relatedNote) => relatedNote.title).join(', ')}`
        }

        notes.push(note)
    }

    return notes
}

export function generateMockNotes(input: Omit<Parameters<typeof generateDerivedNotes>[0], 'existingNotes'>): MemoryNote[] {
    return generateDerivedNotes({
        ...input,
        existingNotes: []
    })
}

export function validateGeneratedNote(note: MemoryNote): boolean {
    return note.title.length > 0
        && note.sourceSummary.length > 0
        && note.canonicalStatement.length > 0
        && note.source.sourceQuote.length > 0
        && note.source.sourceHash.length > 0
        && note.source.sourceQuote.includes(note.canonicalStatement.replace(/…$/, '').slice(0, 40))
}

export function markNotesStale(notes: MemoryNote[], documentId: string): MemoryNote[] {
    return notes.map((note) => {
        if (note.source.documentId !== documentId || note.status === 'archived') {
            return note
        }

        return {
            ...note,
            status: 'stale'
        }
    })
}

function synthesizeSegment(
    content: string,
    frontmatter: RmemDocumentFrontmatter,
    place: StructuralPlace
): {
    title: string
    sourceQuote: string
    sourceSummary: string
    canonicalStatement: string
    retrievalSeed: string
} {
    const sourceQuote = compact(content, 700)
    const title = place.headingPath.length > 0 ? place.headingPath.join(' / ') : frontmatter.title
    const sourceSummary = frontmatter.summary ?? compact(sourceQuote, 220)
    const canonicalStatement = compact(firstMeaningfulSentence(sourceQuote), 300)

    return {
        title,
        sourceQuote,
        sourceSummary,
        canonicalStatement,
        retrievalSeed: [title, sourceSummary, canonicalStatement, sourceQuote].join('\n')
    }
}

function findCandidateLinkedNotes(text: string, notes: MemoryNote[]): MemoryNote[] {
    const terms = new Set(tokenize(text).filter((term) => term.length > 3))
    return notes
        .filter((note) => note.status === 'active')
        .map((note) => {
            const noteTerms = new Set(tokenize(note.retrievalText).filter((term) => term.length > 3))
            let overlap = 0
            for (const term of terms) {
                if (noteTerms.has(term)) {
                    overlap += 1
                }
            }

            return { note, overlap }
        })
        .filter((candidate) => candidate.overlap >= 2)
        .sort((left, right) => right.overlap - left.overlap)
        .slice(0, 5)
        .map((candidate) => candidate.note)
}

function noteTypeForKind(kind: RmemDocumentFrontmatter['rmem']['kind']): MemoryNote['type'] {
    if (kind === 'decision') {
        return 'decision'
    }

    if (kind === 'rules') {
        return 'rule'
    }

    if (kind === 'guide') {
        return 'procedure'
    }

    return 'concept'
}

function compact(value: string, maxChars: number): string {
    const normalized = value.replace(/\s+/g, ' ').trim()
    if (normalized.length <= maxChars) {
        return normalized
    }

    return `${normalized.slice(0, maxChars - 1).trimEnd()}…`
}

function firstMeaningfulSentence(value: string): string {
    const sentence = value.split(/(?<=[.!?。！？])\s+/u).find((item) => item.trim().length > 0)
    return sentence ?? value
}

function extractEntities(value: string): string[] {
    const matches = value.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) ?? []
    return dedupe(matches).slice(0, 20)
}

function tokenize(value: string): string[] {
    return value.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((term) => term.length > 0)
}

function dedupe(values: string[]): string[] {
    return [...new Set(values)]
}

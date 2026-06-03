import type { MemoryNote, RmemDocumentFrontmatter, StructuralPlace } from './types.js'
import { sha256 } from './hash.js'

export function generateMockNotes(input: {
    documentPath: string
    frontmatter: RmemDocumentFrontmatter
    places: StructuralPlace[]
    bodyByPlace: Map<string, string>
    now: string
}): MemoryNote[] {
    const notes: MemoryNote[] = []

    for (const place of input.places) {
        const content = input.bodyByPlace.get(place.id)?.trim() ?? ''
        if (content.length === 0) {
            continue
        }

        const sourceQuote = compact(content, 700)
        const title = place.headingPath.length > 0 ? place.headingPath.join(' / ') : input.frontmatter.title
        const summary = input.frontmatter.summary ?? compact(sourceQuote, 220)
        const retrievalText = [
            title,
            input.frontmatter.title,
            summary,
            sourceQuote,
            ...(input.frontmatter.tags ?? []),
            ...(input.frontmatter.rmem.aliases ?? []),
            ...input.frontmatter.rmem.memoryPath
        ].join('\n')

        notes.push({
            id: `note_${sha256(`${input.frontmatter.rmem.documentId}:${place.id}`).slice(0, 16)}`,
            type: noteTypeForKind(input.frontmatter.rmem.kind),
            status: 'active',
            title,
            sourceSummary: summary,
            canonicalStatement: compact(sourceQuote, 300),
            retrievalText,
            tags: input.frontmatter.tags ?? [],
            aliases: input.frontmatter.rmem.aliases ?? [],
            entities: [],
            source: {
                documentId: input.frontmatter.rmem.documentId,
                documentPath: input.documentPath,
                structuralPlaceId: place.id,
                headingPath: place.headingPath,
                sourceQuote,
                sourceHash: place.sourceHash
            },
            links: [],
            generated: {
                generator: 'mock-local-llm:v1',
                generatedAt: input.now,
                sourceDocumentRevision: input.frontmatter.rmem.revision
            }
        })
    }

    return notes
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

import type { LocalLlmProvider, MemoryNote, NoteType, RmemDocumentFrontmatter, StructuralPlace } from '../types.js'
import { sha256 } from '../hash.js'

type NoteSegment = {
    title: string
    sourceQuote: string
    sourceSummary: string
    canonicalStatement: string
    retrievalSeed: string
    usedFallback?: boolean
    type?: NoteType
    tags?: string[]
    aliases?: string[]
    entities?: string[]
}

type LlmNoteCompilerInput = {
    document: {
        title: string
        summary?: string
        kind: RmemDocumentFrontmatter['rmem']['kind']
        tags: string[]
        aliases: string[]
    }
    place: {
        title: string
        headingPath: string[]
        content: string
    }
}

type LlmNoteCompilerOutput = {
    title?: unknown
    sourceQuote?: unknown
    sourceSummary?: unknown
    canonicalStatement?: unknown
    type?: unknown
    tags?: unknown
    aliases?: unknown
    entities?: unknown
}

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

        notes.push(createNoteFromSegment({
            documentPath: input.documentPath,
            frontmatter: input.frontmatter,
            place,
            segment: synthesizeSegment(content, input.frontmatter, place),
            existingNotes: input.existingNotes,
            now: input.now,
            generator: 'deterministic-semantic-compiler:v1'
        }))
    }

    return notes
}

export async function generateLlmDerivedNotes(input: {
    documentPath: string
    frontmatter: RmemDocumentFrontmatter
    places: StructuralPlace[]
    bodyByPlace: Map<string, string>
    existingNotes: MemoryNote[]
    now: string
    llm: LocalLlmProvider
    generator: string
}): Promise<MemoryNote[]> {
    const notes: MemoryNote[] = []

    for (const place of input.places) {
        const content = input.bodyByPlace.get(place.id)?.trim() ?? ''
        if (content.length === 0) {
            continue
        }

        const segment = await compileLlmSegment(input.llm, input.frontmatter, place, content)
        notes.push(createNoteFromSegment({
            documentPath: input.documentPath,
            frontmatter: input.frontmatter,
            place,
            segment,
            existingNotes: input.existingNotes,
            now: input.now,
            generator: segment.usedFallback === true
                ? 'deterministic-semantic-compiler:v1'
                : input.generator
        }))
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

async function compileLlmSegment(
    llm: LocalLlmProvider,
    frontmatter: RmemDocumentFrontmatter,
    place: StructuralPlace,
    content: string
): Promise<NoteSegment> {
    const documentInput: LlmNoteCompilerInput['document'] = {
        title: frontmatter.title,
        kind: frontmatter.rmem.kind,
        tags: frontmatter.tags ?? [],
        aliases: frontmatter.rmem.aliases ?? []
    }
    if (frontmatter.summary !== undefined) {
        documentInput.summary = frontmatter.summary
    }

    const output = await llm.generateJson<LlmNoteCompilerInput, LlmNoteCompilerOutput>({
        name: 'rmem-note-compiler',
        description: [
            'You are a semantic compiler for document-oriented project memory.',
            'Create one grounded memory note from the provided Markdown section.',
            'Use only facts present in the source content.',
            'sourceQuote must be an exact contiguous substring copied from content.',
            'canonicalStatement must be an exact sentence or phrase copied from sourceQuote.',
            'Return JSON object with title, sourceQuote, sourceSummary, canonicalStatement, type, tags, aliases, entities.'
        ].join('\n')
    }, {
        document: documentInput,
        place: {
            title: place.title,
            headingPath: place.headingPath,
            content
        }
    })

    return normalizeLlmSegment(output, content, frontmatter, place)
}

function normalizeLlmSegment(
    output: LlmNoteCompilerOutput,
    content: string,
    frontmatter: RmemDocumentFrontmatter,
    place: StructuralPlace
): NoteSegment {
    const fallback = synthesizeSegment(content, frontmatter, place)
    const sourceQuote = groundedQuoteValue(stringValue(output.sourceQuote), content)
    if (sourceQuote === undefined) {
        return { ...fallback, usedFallback: true }
    }

    const canonicalStatement = stringValue(output.canonicalStatement)
    const groundedCanonicalStatement = canonicalStatement !== undefined && containsGroundedText(sourceQuote, canonicalStatement.replace(/…$/, '').slice(0, 40))
        ? canonicalStatement
        : synthesizeSegment(sourceQuote, frontmatter, place).canonicalStatement

    const segment: NoteSegment = {
        title: stringValue(output.title) ?? fallback.title,
        sourceQuote,
        sourceSummary: stringValue(output.sourceSummary) ?? fallback.sourceSummary,
        canonicalStatement: groundedCanonicalStatement,
        retrievalSeed: [
            stringValue(output.title) ?? fallback.title,
            stringValue(output.sourceSummary) ?? fallback.sourceSummary,
            groundedCanonicalStatement,
            sourceQuote
        ].join('\n')
    }

    const type = noteTypeValue(output.type)
    const tags = stringArray(output.tags)
    const aliases = stringArray(output.aliases)
    const entities = stringArray(output.entities)

    if (type !== undefined) {
        segment.type = type
    }
    if (tags !== undefined) {
        segment.tags = tags
    }
    if (aliases !== undefined) {
        segment.aliases = aliases
    }
    if (entities !== undefined) {
        segment.entities = entities
    }

    return segment
}

function createNoteFromSegment(input: {
    documentPath: string
    frontmatter: RmemDocumentFrontmatter
    place: StructuralPlace
    segment: NoteSegment
    existingNotes: MemoryNote[]
    now: string
    generator: string
}): MemoryNote {
    const relatedNotes = findCandidateLinkedNotes(input.segment.retrievalSeed, input.existingNotes)
    const retrievalText = [
        input.segment.title,
        input.frontmatter.title,
        input.segment.sourceSummary,
        input.segment.canonicalStatement,
        input.segment.sourceQuote,
        ...(input.segment.tags ?? []),
        ...(input.frontmatter.tags ?? []),
        ...(input.segment.aliases ?? []),
        ...(input.frontmatter.rmem.aliases ?? []),
        ...input.frontmatter.rmem.memoryPath
    ].join('\n')

    const note: MemoryNote = {
        id: `note_${sha256(`${input.frontmatter.rmem.documentId}:${input.place.id}`).slice(0, 16)}`,
        type: input.segment.type ?? noteTypeForKind(input.frontmatter.rmem.kind),
        status: 'active',
        title: input.segment.title,
        sourceSummary: input.segment.sourceSummary,
        canonicalStatement: input.segment.canonicalStatement,
        retrievalText,
        tags: dedupe([...(input.frontmatter.tags ?? []), ...(input.segment.tags ?? [])]),
        aliases: dedupe([...(input.frontmatter.rmem.aliases ?? []), ...(input.segment.aliases ?? [])]),
        entities: dedupe([...(input.segment.entities ?? []), ...extractEntities(input.segment.sourceQuote)]),
        source: {
            documentId: input.frontmatter.rmem.documentId,
            documentPath: input.documentPath,
            structuralPlaceId: input.place.id,
            headingPath: input.place.headingPath,
            sourceQuote: input.segment.sourceQuote,
            sourceHash: input.place.sourceHash
        },
        links: relatedNotes.map((note) => ({
            targetNoteId: note.id,
            type: 'related_to',
            direction: 'outgoing',
            reason: 'Deterministic lexical candidate linking found shared retrieval terms.',
            confidence: 0.7
        })),
        generated: {
            generator: input.generator,
            generatedAt: input.now,
            sourceDocumentRevision: input.frontmatter.rmem.revision
        }
    }

    if (relatedNotes.length > 0) {
        note.contextualizedSummary = `Related active notes: ${relatedNotes.map((relatedNote) => relatedNote.title).join(', ')}`
    }

    return note
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

function noteTypeValue(value: unknown): NoteType | undefined {
    if (
        value === 'concept'
        || value === 'fact'
        || value === 'rule'
        || value === 'decision'
        || value === 'warning'
        || value === 'example'
        || value === 'task'
        || value === 'question'
        || value === 'procedure'
    ) {
        return value
    }

    return undefined
}

function stringValue(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim()
    }

    return undefined
}

function stringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined
    }

    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
}

function groundedQuoteValue(value: string | undefined, content: string): string | undefined {
    if (value === undefined) {
        return undefined
    }

    if (content.includes(value)) {
        return value
    }

    return findWhitespaceNormalizedSubstring(content, value)
}

function containsGroundedText(source: string, value: string): boolean {
    if (source.includes(value)) {
        return true
    }

    return findWhitespaceNormalizedSubstring(source, value) !== undefined
}

function findWhitespaceNormalizedSubstring(source: string, candidate: string): string | undefined {
    const normalizedCandidate = candidate.replace(/\s+/g, ' ').trim()
    if (normalizedCandidate.length === 0) {
        return undefined
    }

    const match = normalizedCandidate.match(/\S+/gu)
    if (match === null) {
        return undefined
    }

    const pattern = match.map(escapeRegExp).join('\\s+')
    const result = new RegExp(pattern, 'u').exec(source)
    if (result === null || result.index === undefined) {
        return undefined
    }

    return source.slice(result.index, result.index + result[0].length).trim()
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

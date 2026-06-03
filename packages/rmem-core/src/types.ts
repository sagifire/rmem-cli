export type DocumentKind =
    | 'overview'
    | 'architecture'
    | 'decision'
    | 'rules'
    | 'spec'
    | 'guide'
    | 'reference'
    | 'journal'
    | 'research'
    | 'task-plan'

export type DocumentStatus =
    | 'draft'
    | 'active'
    | 'deprecated'
    | 'archived'
    | 'needs-review'

export type DocumentLanguage = 'uk' | 'en' | 'mixed'

export type NoteType =
    | 'concept'
    | 'fact'
    | 'rule'
    | 'decision'
    | 'warning'
    | 'example'
    | 'task'
    | 'question'
    | 'procedure'

export type NoteStatus =
    | 'active'
    | 'stale'
    | 'orphaned'
    | 'superseded'
    | 'needs-review'
    | 'archived'

export type NoteLinkType =
    | 'source_of'
    | 'related_to'
    | 'depends_on'
    | 'refines'
    | 'example_of'
    | 'contradicts'
    | 'supersedes'

export type RmemErrorCode =
    | 'CONFIG_NOT_FOUND'
    | 'INVALID_CONFIG'
    | 'DOCUMENT_NOT_FOUND'
    | 'DOCUMENT_ALREADY_EXISTS'
    | 'DOCUMENT_HASH_MISMATCH'
    | 'INVALID_FRONTMATTER'
    | 'INVALID_DOCUMENT_KIND'
    | 'INVALID_DOCUMENT_STATUS'
    | 'INVALID_MEMORY_PATH'
    | 'INVALID_MARKDOWN'
    | 'ENCODING_ERROR'
    | 'OLD_TEXT_NOT_FOUND'
    | 'OLD_TEXT_AMBIGUOUS'
    | 'MANAGED_HEADER_MISMATCH'
    | 'DUPLICATE_DOCUMENT_ID'
    | 'BROKEN_LINK'
    | 'STALE_INDEX'
    | 'EMBEDDING_PROVIDER_FAILED'
    | 'LLM_PROVIDER_FAILED'
    | 'WRITE_FAILED'
    | 'INVALID_EDIT_REQUEST'

export type RmemWarning = {
    code: string
    message: string
    details?: unknown
}

export type RmemCommandError = {
    ok: false
    code: RmemErrorCode
    message: string
    details?: unknown
    suggestion?: string
}

export type CommandResult<T> = T | RmemCommandError

export type RmemDocumentFrontmatter = {
    title: string
    summary?: string
    tags?: string[]
    rmem: {
        schemaVersion: number
        documentId: string
        kind: DocumentKind
        status: DocumentStatus
        createdAt: string
        updatedAt: string
        revision: number
        memoryPath: string[]
        language: DocumentLanguage
        aliases?: string[]
        review?: {
            required: boolean
            reason?: string
        }
    }
}

export type DocumentReport = {
    path: string
    documentId: string
    title: string
    kind: DocumentKind
    status: DocumentStatus
    summary?: string
    revision: number
    memoryPath: string[]
    language: DocumentLanguage
}

export type StructuralPlace = {
    id: string
    documentId: string
    documentPath: string
    headingPath: string[]
    title: string
    level: number
    orderIndex: number
    startOffset?: number
    endOffset?: number
    sourceHash: string
    summary?: string
}

export type NoteLink = {
    targetNoteId: string
    type: NoteLinkType
    direction: 'outgoing'
    reason?: string
    confidence?: number
}

export type MemoryNote = {
    id: string
    type: NoteType
    status: NoteStatus
    title: string
    sourceSummary: string
    canonicalStatement: string
    contextualizedSummary?: string
    retrievalText: string
    tags: string[]
    aliases: string[]
    entities: string[]
    source: {
        documentId: string
        documentPath: string
        structuralPlaceId: string
        headingPath: string[]
        sourceQuote: string
        sourceHash: string
    }
    links: NoteLink[]
    generated: {
        generator: string
        generatedAt: string
        sourceDocumentRevision: number
    }
}

export type EmbeddingVector = number[]

export interface EmbeddingProvider {
    embedTexts(texts: string[]): Promise<EmbeddingVector[]>
}

export type LlmTask<TInput, TOutput> = {
    name: string
    description: string
    inputSchema?: unknown
    outputSchema?: unknown
}

export interface LocalLlmProvider {
    generateJson<TInput, TOutput>(
        task: LlmTask<TInput, TOutput>,
        input: TInput
    ): Promise<TOutput>
}

export type MemoryAreaConfig = {
    title: string
    description?: string
    parent?: string
}

export type RmemConfig = {
    schemaVersion: number
    memoryRoot: string
    areas: Record<string, MemoryAreaConfig>
    indexing: {
        noteRebuildMode: 'sync' | 'manual'
    }
}

export type RegistryState = {
    schemaVersion: number
    documents: DocumentRegistryRecord[]
    places: StructuralPlace[]
    notes: MemoryNote[]
}

export type DocumentRegistryRecord = {
    path: string
    document: DocumentReport
    documentHash: string
    contentHash: string
    archived: boolean
    updatedAt: string
}

export type MemoryPathUnitReport = {
    key: string
    title: string
    description?: string
}

export type LinkedKnowledgeReport = {
    noteId: string
    title: string
    type: NoteLinkType
    reason?: string
}

export type SearchResult = {
    rank: number
    score: number
    note?: {
        id: string
        title: string
        type: NoteType
        status: NoteStatus
        sourceSummary: string
        contextualizedSummary?: string
    }
    document: {
        path: string
        documentId: string
        title: string
        kind: DocumentKind
        status: DocumentStatus
        summary?: string
    }
    memoryPath: MemoryPathUnitReport[]
    targetPlace?: {
        placeId: string
        headingPath: string[]
        excerptBefore?: string
        excerpt: string
        excerptAfter?: string
    }
    linkedKnowledge: LinkedKnowledgeReport[]
    recommendedCommands: string[]
}

export type SearchResponse = {
    ok: true
    query: string
    summary: string
    results: SearchResult[]
    recommendedReads: { path: string, reason: string }[]
    warnings: RmemWarning[]
}

export type ListResponse = {
    ok: true
    path: string[]
    area?: MemoryPathUnitReport
    items: {
        type: 'area' | 'document'
        key: string
        title: string
        description?: string
        document?: DocumentReport
    }[]
}

export type ReadDocumentResponse = {
    ok: true
    document: DocumentReport
    content: string
    documentHash: string
    warnings: RmemWarning[]
}

export type WriteDocumentResponse = {
    ok: true
    document: DocumentReport
    created: boolean
    changed: boolean
    documentHash: string
    affected: {
        staleNotes: number
        rebuiltNotes: number
        structuralPlaces: number
    }
    warnings: RmemWarning[]
}

export type EditDocumentRequest = {
    documentHash?: string
    edits: {
        oldText: string
        newText: string
    }[]
}

export type CheckResponse = {
    ok: true
    valid: boolean
    issues: RmemWarning[]
}

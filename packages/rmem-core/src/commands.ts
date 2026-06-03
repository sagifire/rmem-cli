import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import type {
    CheckResponse,
    CommandResult,
    DocumentReport,
    EditDocumentRequest,
    ListResponse,
    ReadDocumentResponse,
    RegistryState,
    RmemConfig,
    RmemWarning,
    WriteDocumentResponse
} from './types.js'
import { commandError, isCommandError } from './errors.js'
import { ensureConfig, loadConfig } from './config.js'
import { createDefaultFrontmatter, parseDocumentMarkdown, serializeDocument } from './frontmatter.js'
import { documentIdFromPath } from './ids.js'
import { normalizeLineEndings, sha256 } from './hash.js'
import { extractStructuralPlaces } from './markdown.js'
import { hasManagedHeaderMismatch, replaceManagedHeader, stripManagedHeader } from './managed-header.js'
import { atomicWriteUtf8, loadRegistry, readUtf8File, resolveMemoryPath, saveRegistry, toRegistryDocumentPath } from './storage.js'
import { generateMockNotes, markNotesStale } from './notes.js'
import { memoryPathReport, searchRegistry } from './search.js'

export async function listCommand(root: string, pathInput?: string): Promise<CommandResult<ListResponse>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const registry = await loadRegistry(root)
    const path = pathInput === undefined || pathInput.length === 0 ? [] : pathInput.split('/').filter(Boolean)
    const areaKey = path[path.length - 1]
    const items: ListResponse['items'] = []

    for (const [key, area] of Object.entries(config.areas)) {
        if (area.parent === areaKey || (areaKey === undefined && area.parent === undefined)) {
            const item: ListResponse['items'][number] = {
                type: 'area',
                key,
                title: area.title
            }
            if (area.description !== undefined) {
                item.description = area.description
            }
            items.push(item)
        }
    }

    for (const record of registry.documents.filter((record) => !record.archived)) {
        if (path.length === 0 || record.document.memoryPath.join('/') === path.join('/')) {
            items.push({
                type: 'document',
                key: record.path,
                title: record.document.title,
                document: record.document
            })
        }
    }

    const result: ListResponse = {
        ok: true,
        path,
        items
    }

    if (areaKey !== undefined) {
        const area = config.areas[areaKey]
        if (area !== undefined) {
            const areaReport = {
                key: areaKey,
                title: area.title
            }
            if (area.description !== undefined) {
                result.area = {
                    ...areaReport,
                    description: area.description
                }
            } else {
                result.area = areaReport
            }
        }
    }

    return result
}

export async function readCommand(root: string, documentPath: string): Promise<CommandResult<ReadDocumentResponse>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    try {
        const fullPath = resolveMemoryPath(root, config.memoryRoot, documentPath)
        const content = normalizeLineEndings(await readUtf8File(fullPath))
        const parsed = parseDocumentMarkdown(content)
        if (isCommandError(parsed)) {
            return parsed
        }

        return {
            ok: true,
            document: reportFromFrontmatter(toRegistryDocumentPath(documentPath), parsed.frontmatter),
            content,
            documentHash: hashDocument(parsed.frontmatter, parsed.body),
            warnings: hasManagedHeaderMismatch(parsed.body, parsed.frontmatter)
                ? [{ code: 'MANAGED_HEADER_MISMATCH', message: 'Managed header does not match frontmatter.' }]
                : []
        }
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return commandError({
                code: 'DOCUMENT_NOT_FOUND',
                message: `Document was not found: ${documentPath}`,
                suggestion: 'Use rmem list to find available documents.'
            })
        }

        return commandError({
            code: 'ENCODING_ERROR',
            message: 'Document could not be decoded as valid UTF-8.',
            details: String(error),
            suggestion: 'Fix file encoding without lossy transcoding.'
        })
    }
}

export async function writeCommand(root: string, documentPath: string, contentInput: string): Promise<CommandResult<WriteDocumentResponse>> {
    const config = await ensureConfig(root)
    const fullPath = resolveMemoryPath(root, config.memoryRoot, documentPath)
    const registryPath = toRegistryDocumentPath(documentPath)
    const now = new Date().toISOString()
    const normalizedInput = normalizeLineEndings(contentInput)
    const existing = await tryReadExisting(fullPath)
    const created = existing === undefined

    let content = normalizedInput
    if (!content.startsWith('---\n')) {
        const title = titleFromDocumentContent(content, documentPath)
        const defaultInput: Parameters<typeof createDefaultFrontmatter>[0] = {
            documentPath,
            title,
            documentId: documentIdFromPath(registryPath),
            now
        }
        const summary = firstParagraph(content)
        if (summary !== undefined) {
            defaultInput.summary = summary
        }
        const frontmatter = createDefaultFrontmatter(defaultInput)
        content = serializeDocument(frontmatter, content)
    }

    const parsed = parseDocumentMarkdown(content)
    if (isCommandError(parsed)) {
        return parsed
    }

    if (!created && existing !== undefined) {
        const existingParsed = parseDocumentMarkdown(existing)
        if (!isCommandError(existingParsed)) {
            parsed.frontmatter.rmem.createdAt = existingParsed.frontmatter.rmem.createdAt
            parsed.frontmatter.rmem.documentId = existingParsed.frontmatter.rmem.documentId
            parsed.frontmatter.rmem.revision = existingParsed.frontmatter.rmem.revision + 1
        }
    }

    parsed.frontmatter.rmem.updatedAt = now
    const body = replaceManagedHeader(parsed.body, parsed.frontmatter)
    const finalContent = serializeDocument(parsed.frontmatter, body)
    const finalParsed = parseDocumentMarkdown(finalContent)
    if (isCommandError(finalParsed)) {
        return finalParsed
    }

    try {
        await atomicWriteUtf8(fullPath, finalContent)
        return await updateRegistryAfterWrite(root, config, registryPath, finalParsed.frontmatter, finalParsed.body, {
            created,
            changed: existing !== finalContent,
            staleOnly: false
        })
    } catch (error) {
        return commandError({
            code: 'WRITE_FAILED',
            message: 'Failed to atomically write document.',
            details: String(error),
            suggestion: 'Check file permissions and available disk space.'
        })
    }
}

export async function editCommand(root: string, documentPath: string, request: EditDocumentRequest): Promise<CommandResult<WriteDocumentResponse>> {
    if (!Array.isArray(request.edits) || request.edits.length === 0) {
        return commandError({
            code: 'INVALID_EDIT_REQUEST',
            message: 'Edit request must contain at least one edit.',
            suggestion: 'Pass JSON with edits containing oldText and newText.'
        })
    }

    const read = await readCommand(root, documentPath)
    if (isCommandError(read)) {
        return read
    }

    if (request.documentHash !== undefined && request.documentHash !== read.documentHash) {
        return commandError({
            code: 'DOCUMENT_HASH_MISMATCH',
            message: 'Provided documentHash does not match current document content.',
            suggestion: 'Run rmem read again and retry with the latest documentHash.'
        })
    }

    let content = read.content
    for (const edit of request.edits) {
        const matches = countOccurrences(content, edit.oldText)
        if (matches === 0) {
            return commandError({
                code: 'OLD_TEXT_NOT_FOUND',
                message: 'oldText was not found in the current document.',
                details: { oldText: edit.oldText },
                suggestion: 'Use exact text from rmem read output.'
            })
        }

        if (matches > 1) {
            return commandError({
                code: 'OLD_TEXT_AMBIGUOUS',
                message: 'oldText matched more than once.',
                details: { oldText: edit.oldText, matches },
                suggestion: 'Use a larger exact text span.'
            })
        }

        content = content.replace(edit.oldText, edit.newText)
    }

    return writeCommand(root, documentPath, content)
}

export async function removeCommand(root: string, documentPath: string): Promise<CommandResult<WriteDocumentResponse>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const read = await readCommand(root, documentPath)
    if (isCommandError(read)) {
        return read
    }

    const registry = await loadRegistry(root)
    const registryPath = toRegistryDocumentPath(documentPath)
    const record = registry.documents.find((candidate) => candidate.path === registryPath)
    const fullPath = resolveMemoryPath(root, config.memoryRoot, documentPath)
    const archivePath = join(root, '.rmem', 'archive', registryPath)

    try {
        await mkdir(dirname(archivePath), { recursive: true })
        await atomicWriteUtf8(archivePath, read.content)
        await rm(fullPath)

        if (record !== undefined) {
            record.archived = true
            record.document.status = 'archived'
        }

        registry.notes = registry.notes.map((note) => {
            if (note.source.documentPath === registryPath) {
                return { ...note, status: 'archived' }
            }

            return note
        })

        await saveRegistry(root, registry)

        return {
            ok: true,
            document: {
                ...read.document,
                status: 'archived'
            },
            created: false,
            changed: true,
            documentHash: read.documentHash,
            affected: {
                staleNotes: 0,
                rebuiltNotes: 0,
                structuralPlaces: 0
            },
            warnings: []
        }
    } catch (error) {
        return commandError({
            code: 'WRITE_FAILED',
            message: 'Failed to archive document.',
            details: String(error),
            suggestion: 'Check file permissions and archive directory.'
        })
    }
}

export async function checkCommand(root: string): Promise<CommandResult<CheckResponse>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const registry = await loadRegistry(root)
    const issues: RmemWarning[] = []
    const documentIds = new Set<string>()

    for await (const documentPath of listMarkdownFiles(join(root, config.memoryRoot))) {
        const registryPath = toRegistryDocumentPath(documentPath.replace(`${join(root, config.memoryRoot)}\\`, ''))
        try {
            const content = normalizeLineEndings(await readUtf8File(documentPath))
            const parsed = parseDocumentMarkdown(content)
            if (isCommandError(parsed)) {
                issues.push({ code: parsed.code, message: parsed.message, details: { path: registryPath } })
                continue
            }

            if (documentIds.has(parsed.frontmatter.rmem.documentId)) {
                issues.push({
                    code: 'DUPLICATE_DOCUMENT_ID',
                    message: 'Duplicate documentId found.',
                    details: { path: registryPath, documentId: parsed.frontmatter.rmem.documentId }
                })
            }
            documentIds.add(parsed.frontmatter.rmem.documentId)

            if (hasManagedHeaderMismatch(parsed.body, parsed.frontmatter)) {
                issues.push({
                    code: 'MANAGED_HEADER_MISMATCH',
                    message: 'Managed header does not match frontmatter.',
                    details: { path: registryPath }
                })
            }

            for (const unit of parsed.frontmatter.rmem.memoryPath) {
                if (config.areas[unit] === undefined) {
                    issues.push({
                        code: 'INVALID_MEMORY_PATH',
                        message: 'Document references unknown memory path area.',
                        details: { path: registryPath, unit }
                    })
                }
            }
        } catch (error) {
            issues.push({
                code: 'ENCODING_ERROR',
                message: 'File is not valid UTF-8.',
                details: { path: registryPath, error: String(error) }
            })
        }
    }

    for (const note of registry.notes) {
        const document = registry.documents.find((record) => record.document.documentId === note.source.documentId && !record.archived)
        if (document === undefined && note.status !== 'archived') {
            issues.push({
                code: 'BROKEN_LINK',
                message: 'Note references a missing or archived document.',
                details: { noteId: note.id, documentId: note.source.documentId }
            })
        }

        if (note.status === 'stale') {
            issues.push({
                code: 'STALE_INDEX',
                message: 'Stale note found.',
                details: { noteId: note.id }
            })
        }
    }

    return {
        ok: true,
        valid: issues.length === 0,
        issues
    }
}

export async function searchCommand(root: string, query: string): Promise<CommandResult<ReturnType<typeof searchRegistry>>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const registry = await loadRegistry(root)
    return searchRegistry({ query, registry, config })
}

export async function devRebuildCommand(root: string): Promise<CommandResult<{ ok: true, rebuiltNotes: number }>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const registry = await loadRegistry(root)
    let rebuiltNotes = 0

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
        const notes = generateMockNotes({
            documentPath: record.path,
            frontmatter: parsed.frontmatter,
            places,
            bodyByPlace,
            now: new Date().toISOString()
        })
        rebuiltNotes += notes.length
        registry.notes = registry.notes.filter((note) => note.source.documentId !== parsed.frontmatter.rmem.documentId)
        registry.notes.push(...notes)
        registry.places = registry.places.filter((place) => place.documentId !== parsed.frontmatter.rmem.documentId)
        registry.places.push(...places)
    }

    await saveRegistry(root, registry)

    return {
        ok: true,
        rebuiltNotes
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

export async function devEmbeddingsStatusCommand(root: string): Promise<CommandResult<{ ok: true, provider: string, indexedNotes: number, dimensions: number | null }>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const registry = await loadRegistry(root)
    return {
        ok: true,
        provider: 'mock-deterministic-embedding',
        indexedNotes: registry.notes.filter((note) => note.status === 'active').length,
        dimensions: null
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

export async function devSearchTraceCommand(root: string, query: string): Promise<CommandResult<{ ok: true, query: string, trace: unknown, report: ReturnType<typeof searchRegistry> }>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const registry = await loadRegistry(root)
    const report = searchRegistry({ query, registry, config })

    return {
        ok: true,
        query,
        trace: {
            documents: registry.documents.length,
            notes: registry.notes.length,
            activeNotes: registry.notes.filter((note) => note.status === 'active').length,
            strategy: 'lexical-note-retrieval-with-document-context'
        },
        report
    }
}

async function updateRegistryAfterWrite(
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
    if (!options.staleOnly && config.indexing.noteRebuildMode === 'sync') {
        const bodyByPlace = bodyByPlaceId(body, places)
        const notes = generateMockNotes({
            documentPath,
            frontmatter,
            places,
            bodyByPlace,
            now: new Date().toISOString()
        })
        registry.notes = registry.notes.filter((note) => note.source.documentId !== frontmatter.rmem.documentId)
        registry.notes.push(...notes)
        rebuiltNotes = notes.length
    }

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
        warnings: []
    }
}

function reportFromFrontmatter(path: string, frontmatter: Parameters<typeof hashDocument>[0]): DocumentReport {
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

function hashDocument(frontmatter: Parameters<typeof serializeDocument>[0], body: string): string {
    const stableFrontmatter = {
        ...frontmatter,
        rmem: {
            ...frontmatter.rmem,
            updatedAt: ''
        }
    }

    return sha256(serializeDocument(stableFrontmatter, stripManagedHeader(body)))
}

function titleFromDocumentContent(content: string, documentPath: string): string {
    const heading = content.match(/^#\s+(.+)$/m)?.[1]
    if (heading !== undefined && heading.trim().length > 0) {
        return heading.trim()
    }

    return documentPath.replace(/\.[^.]+$/, '').split(/[\\/]/).at(-1) ?? 'Document'
}

function firstParagraph(content: string): string | undefined {
    const paragraph = stripManagedHeader(content)
        .split(/\n\s*\n/)
        .map((part) => part.replace(/^#+\s+/gm, '').trim())
        .find((part) => part.length > 0)

    return paragraph?.slice(0, 300)
}

function countOccurrences(content: string, oldText: string): number {
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

async function tryReadExisting(path: string): Promise<string | undefined> {
    try {
        return normalizeLineEndings(await readUtf8File(path))
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            return undefined
        }

        throw error
    }
}

async function* listMarkdownFiles(root: string): AsyncGenerator<string> {
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

function bodyByPlaceId(body: string, places: { id: string, startOffset?: number, endOffset?: number }[]): Map<string, string> {
    const source = stripManagedHeader(body)
    const result = new Map<string, string>()
    for (const place of places) {
        result.set(place.id, source.slice(place.startOffset ?? 0, place.endOffset ?? source.length))
    }

    return result
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error
}

export { memoryPathReport }

import { mkdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type {
    CheckResponse,
    CommandResult,
    EditDocumentRequest,
    ListResponse,
    ReadDocumentResponse,
    RmemWarning,
    WriteDocumentResponse
} from '../types.js'
import { commandError, isCommandError } from '../errors.js'
import { ensureConfig, loadConfig } from '../config.js'
import { createDefaultFrontmatter, parseDocumentMarkdown, serializeDocument } from '../frontmatter.js'
import { documentIdFromPath } from '../ids.js'
import { normalizeLineEndings } from '../hash.js'
import { validateMarkdown } from '../markdown.js'
import { hasManagedHeaderMismatch, replaceManagedHeader } from '../managed-header.js'
import { atomicWriteUtf8, loadRegistry, readUtf8File, resolveMemoryPath, saveRegistry, toRegistryDocumentPath } from '../storage.js'
import { isVectorIndexCompatible, isVectorIndexFresh } from '../embeddings.js'
import { searchRegistry } from '../search.js'
import {
    countOccurrences,
    firstParagraph,
    hashDocument,
    isNodeError,
    listMarkdownFiles,
    queryVectorBestEffort,
    reportFromFrontmatter,
    titleFromDocumentContent,
    tryReadExisting,
    updateRegistryAfterWrite
} from './internal.js'

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

    const markdownError = validateMarkdown(parsed.body)
    if (markdownError !== undefined) {
        return markdownError
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

    const finalMarkdownError = validateMarkdown(finalParsed.body)
    if (finalMarkdownError !== undefined) {
        return finalMarkdownError
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
    const archivePath = join(root, '.rmem', 'archive', registryPath)

    try {
        await mkdir(dirname(archivePath), { recursive: true })
        const parsed = parseDocumentMarkdown(read.content)
        if (isCommandError(parsed)) {
            return parsed
        }

        parsed.frontmatter.rmem.status = 'archived'
        parsed.frontmatter.rmem.updatedAt = new Date().toISOString()
        parsed.frontmatter.rmem.revision += 1
        const archivedBody = replaceManagedHeader(parsed.body, parsed.frontmatter)
        const archivedContent = serializeDocument(parsed.frontmatter, archivedBody)
        await atomicWriteUtf8(archivePath, archivedContent)
        await atomicWriteUtf8(resolveMemoryPath(root, config.memoryRoot, documentPath), archivedContent)

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
                status: 'archived',
                revision: parsed.frontmatter.rmem.revision
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

    const memoryRootPath = join(root, config.memoryRoot)
    for await (const documentPath of listMarkdownFiles(memoryRootPath)) {
        const registryPath = toRegistryDocumentPath(relative(memoryRootPath, documentPath))
        try {
            const content = normalizeLineEndings(await readUtf8File(documentPath))
            const parsed = parseDocumentMarkdown(content)
            if (isCommandError(parsed)) {
                issues.push({ code: parsed.code, message: parsed.message, details: { path: registryPath } })
                continue
            }

            const markdownError = validateMarkdown(parsed.body)
            if (markdownError !== undefined) {
                issues.push({ code: markdownError.code, message: markdownError.message, details: { path: registryPath } })
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

            const registryRecord = registry.documents.find((record) => record.path === registryPath)
            if (registryRecord === undefined) {
                issues.push({
                    code: 'STALE_INDEX',
                    message: 'Document is missing from registry.',
                    details: { path: registryPath }
                })
            } else {
                const currentHash = hashDocument(parsed.frontmatter, parsed.body)
                if (registryRecord.documentHash !== currentHash) {
                    issues.push({
                        code: 'STALE_INDEX',
                        message: 'Registry document hash does not match file content.',
                        details: { path: registryPath }
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

        const place = registry.places.find((candidate) => candidate.id === note.source.structuralPlaceId)
        if (place === undefined && note.status !== 'archived') {
            issues.push({
                code: 'BROKEN_LINK',
                message: 'Note references a missing structural place.',
                details: { noteId: note.id, structuralPlaceId: note.source.structuralPlaceId }
            })
        }

        if (place !== undefined && place.sourceHash !== note.source.sourceHash && note.status === 'active') {
            issues.push({
                code: 'STALE_INDEX',
                message: 'Active note source hash no longer matches structural place.',
                details: { noteId: note.id, structuralPlaceId: note.source.structuralPlaceId }
            })
        }
    }

    for (const place of registry.places) {
        const document = registry.documents.find((record) => record.document.documentId === place.documentId)
        if (document === undefined) {
            issues.push({
                code: 'BROKEN_LINK',
                message: 'Structural place references a missing document.',
                details: { placeId: place.id, documentId: place.documentId }
            })
        }
    }

    const activeNotes = registry.notes.filter((note) => note.status === 'active')
    if (activeNotes.length > 0 && !isVectorIndexFresh(registry.embeddings, registry.notes)) {
        issues.push({
            code: 'STALE_INDEX',
            message: 'Vector index is missing or stale.',
            details: { indexedNotes: registry.embeddings?.vectors.length ?? 0 }
        })
    } else if (activeNotes.length > 0 && registry.embeddings !== undefined && config.providers?.embeddings !== undefined && !isVectorIndexCompatible(registry.embeddings, config.providers.embeddings.type, config.providers.embeddings.model)) {
        issues.push({
            code: 'STALE_INDEX',
            message: 'Vector index provider or model does not match current config.',
            details: {
                indexProvider: registry.embeddings.provider,
                indexModel: registry.embeddings.model,
                configProvider: config.providers.embeddings.type,
                configModel: config.providers.embeddings.model
            }
        })
    }

    return {
        ok: true,
        valid: issues.length === 0,
        issues
    }
}

export async function searchCommand(root: string, query: string): Promise<CommandResult<Awaited<ReturnType<typeof searchRegistry>>>> {
    const config = await loadConfig(root)
    if (isCommandError(config)) {
        return config
    }

    const registry = await loadRegistry(root)
    const queryEmbedding = await queryVectorBestEffort(config, query)
    return searchRegistry({
        query,
        registry,
        config,
        queryVector: queryEmbedding.vector,
        queryVectorProvider: queryEmbedding.provider,
        queryVectorModel: queryEmbedding.model,
        warnings: queryEmbedding.warnings
    })
}


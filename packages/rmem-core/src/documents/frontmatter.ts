import type {
    DocumentKind,
    DocumentLanguage,
    DocumentStatus,
    RmemDocumentFrontmatter
} from '../types.js'
import { commandError } from '../errors.js'
import type { RmemCommandError } from '../types.js'

const documentKinds: readonly DocumentKind[] = [
    'overview',
    'architecture',
    'decision',
    'rules',
    'spec',
    'guide',
    'reference',
    'journal',
    'research',
    'task-plan'
]

const documentStatuses: readonly DocumentStatus[] = [
    'draft',
    'active',
    'deprecated',
    'archived',
    'needs-review'
]

const documentLanguages: readonly DocumentLanguage[] = ['uk', 'en', 'mixed']

export type ParsedMarkdownDocument = {
    frontmatter: RmemDocumentFrontmatter
    body: string
    rawFrontmatter: string
}

export function parseDocumentMarkdown(content: string): ParsedMarkdownDocument | RmemCommandError {
    if (!content.startsWith('---\n')) {
        return commandError({
            code: 'INVALID_FRONTMATTER',
            message: 'Document must start with YAML frontmatter.',
            suggestion: 'Add a frontmatter block delimited by --- markers.'
        })
    }

    const end = content.indexOf('\n---\n', 4)
    if (end === -1) {
        return commandError({
            code: 'INVALID_FRONTMATTER',
            message: 'Document frontmatter closing marker was not found.',
            suggestion: 'Close frontmatter with a standalone --- marker.'
        })
    }

    const rawFrontmatter = content.slice(4, end)
    const body = content.slice(end + 5)
    let parsed: unknown
    try {
        parsed = parseYamlObject(rawFrontmatter)
    } catch (error) {
        return invalidFrontmatter(`Unsupported YAML syntax: ${String(error)}`)
    }

    if (!isRecord(parsed)) {
        return invalidFrontmatter('Frontmatter must be an object.')
    }

    const validation = validateFrontmatter(parsed)
    if (isCommandErrorLike(validation)) {
        return validation
    }

    return {
        frontmatter: validation,
        body,
        rawFrontmatter
    }
}

export function serializeDocument(frontmatter: RmemDocumentFrontmatter, body: string): string {
    return `---\n${serializeFrontmatter(frontmatter)}---\n\n${body.replace(/^\n+/, '')}`
}

export function serializeFrontmatter(frontmatter: RmemDocumentFrontmatter): string {
    const lines: string[] = []
    lines.push(`title: ${scalar(frontmatter.title)}`)

    if (frontmatter.summary !== undefined && frontmatter.summary.length > 0) {
        lines.push(`summary: ${scalar(frontmatter.summary)}`)
    }

    if (frontmatter.tags !== undefined && frontmatter.tags.length > 0) {
        lines.push('tags:')
        for (const tag of frontmatter.tags) {
            lines.push(`  - ${scalar(tag)}`)
        }
    }

    lines.push('')
    lines.push('rmem:')
    lines.push(`  schemaVersion: ${frontmatter.rmem.schemaVersion}`)
    lines.push(`  documentId: ${scalar(frontmatter.rmem.documentId)}`)
    lines.push(`  kind: ${frontmatter.rmem.kind}`)
    lines.push(`  status: ${frontmatter.rmem.status}`)
    lines.push(`  createdAt: ${frontmatter.rmem.createdAt}`)
    lines.push(`  updatedAt: ${frontmatter.rmem.updatedAt}`)
    lines.push(`  revision: ${frontmatter.rmem.revision}`)
    lines.push('  memoryPath:')
    for (const pathUnit of frontmatter.rmem.memoryPath) {
        lines.push(`    - ${scalar(pathUnit)}`)
    }
    lines.push(`  language: ${frontmatter.rmem.language}`)

    if (frontmatter.rmem.aliases !== undefined && frontmatter.rmem.aliases.length > 0) {
        lines.push('  aliases:')
        for (const alias of frontmatter.rmem.aliases) {
            lines.push(`    - ${scalar(alias)}`)
        }
    }

    if (frontmatter.rmem.review !== undefined) {
        lines.push('  review:')
        lines.push(`    required: ${frontmatter.rmem.review.required ? 'true' : 'false'}`)
        if (frontmatter.rmem.review.reason !== undefined) {
            lines.push(`    reason: ${scalar(frontmatter.rmem.review.reason)}`)
        }
    }

    return `${lines.join('\n')}\n`
}

export function createDefaultFrontmatter(input: {
    documentPath: string
    title: string
    summary?: string
    documentId: string
    now: string
    kind?: DocumentKind
    status?: DocumentStatus
    memoryPath?: string[]
    language?: DocumentLanguage
}): RmemDocumentFrontmatter {
    const result: RmemDocumentFrontmatter = {
        title: input.title,
        rmem: {
            schemaVersion: 1,
            documentId: input.documentId,
            kind: input.kind ?? 'overview',
            status: input.status ?? 'draft',
            createdAt: input.now,
            updatedAt: input.now,
            revision: 1,
            memoryPath: input.memoryPath ?? ['project'],
            language: input.language ?? 'mixed'
        }
    }

    if (input.summary !== undefined) {
        result.summary = input.summary
    }

    return result
}

function validateFrontmatter(input: Record<string, unknown>): RmemDocumentFrontmatter | RmemCommandError {
    const title = input.title
    const rmem = input.rmem

    if (typeof title !== 'string' || title.trim().length === 0) {
        return invalidFrontmatter('Frontmatter title must be a non-empty string.')
    }

    if (!isRecord(rmem)) {
        return invalidFrontmatter('Frontmatter rmem block is required.')
    }

    const kind = rmem.kind
    const status = rmem.status
    const language = rmem.language

    if (typeof kind !== 'string' || !documentKinds.includes(kind as DocumentKind)) {
        return commandError({
            code: 'INVALID_DOCUMENT_KIND',
            message: `Invalid document kind: ${String(kind)}`,
            suggestion: 'Use one of the supported document kinds.'
        })
    }

    if (typeof status !== 'string' || !documentStatuses.includes(status as DocumentStatus)) {
        return commandError({
            code: 'INVALID_DOCUMENT_STATUS',
            message: `Invalid document status: ${String(status)}`,
            suggestion: 'Use one of the supported document statuses.'
        })
    }

    if (typeof language !== 'string' || !documentLanguages.includes(language as DocumentLanguage)) {
        return invalidFrontmatter('rmem.language must be uk, en or mixed.')
    }

    const memoryPath = rmem.memoryPath
    if (!Array.isArray(memoryPath) || !memoryPath.every((item) => typeof item === 'string' && item.length > 0)) {
        return commandError({
            code: 'INVALID_MEMORY_PATH',
            message: 'rmem.memoryPath must be a non-empty string array.',
            suggestion: 'Provide a memoryPath such as ["project"].'
        })
    }

    const schemaVersion = numberField(rmem.schemaVersion, 'rmem.schemaVersion')
    const revision = numberField(rmem.revision, 'rmem.revision')
    const documentId = stringField(rmem.documentId, 'rmem.documentId')
    const createdAt = stringField(rmem.createdAt, 'rmem.createdAt')
    const updatedAt = stringField(rmem.updatedAt, 'rmem.updatedAt')

    if (schemaVersion.error !== undefined) {
        return invalidFrontmatter(schemaVersion.error)
    }

    if (revision.error !== undefined) {
        return invalidFrontmatter(revision.error)
    }

    if (documentId.error !== undefined) {
        return invalidFrontmatter(documentId.error)
    }

    if (createdAt.error !== undefined) {
        return invalidFrontmatter(createdAt.error)
    }

    if (updatedAt.error !== undefined) {
        return invalidFrontmatter(updatedAt.error)
    }

    const result: RmemDocumentFrontmatter = {
        title,
        rmem: {
            schemaVersion: schemaVersion.value,
            documentId: documentId.value,
            kind: kind as DocumentKind,
            status: status as DocumentStatus,
            createdAt: createdAt.value,
            updatedAt: updatedAt.value,
            revision: revision.value,
            memoryPath: memoryPath as string[],
            language: language as DocumentLanguage
        }
    }

    if (typeof input.summary === 'string') {
        result.summary = input.summary
    }

    if (Array.isArray(input.tags) && input.tags.every((item) => typeof item === 'string')) {
        result.tags = input.tags as string[]
    }

    if (Array.isArray(rmem.aliases) && rmem.aliases.every((item) => typeof item === 'string')) {
        result.rmem.aliases = rmem.aliases as string[]
    }

    if (isRecord(rmem.review)) {
        const required = rmem.review.required
        if (typeof required !== 'boolean') {
            return invalidFrontmatter('rmem.review.required must be a boolean.')
        }

        result.rmem.review = { required }
        if (typeof rmem.review.reason === 'string') {
            result.rmem.review.reason = rmem.review.reason
        }
    }

    return result
}

export function parseYamlObject(input: string): unknown {
    const root: Record<string, unknown> = {}
    const stack: { indent: number, value: Record<string, unknown> | unknown[] }[] = [
        { indent: -1, value: root }
    ]
    const lines = input.split('\n')

    for (let index = 0; index < lines.length; index += 1) {
        const rawLine = lines[index]
        if (rawLine === undefined || rawLine.trim().length === 0 || rawLine.trim().startsWith('#')) {
            continue
        }

        if (rawLine.startsWith('\t')) {
            throw new Error(`Tabs are not supported for indentation at line ${index + 1}.`)
        }

        const indent = rawLine.match(/^ */)?.[0]?.length ?? 0
        const line = rawLine.trim()

        while (stack.length > 1) {
            const top = stack[stack.length - 1]
            if (top !== undefined && top.indent >= indent) {
                stack.pop()
            } else {
                break
            }
        }

        const parent = stack[stack.length - 1]?.value
        if (line.startsWith('- ')) {
            if (!Array.isArray(parent)) {
                throw new Error(`Sequence item is not inside a sequence at line ${index + 1}.`)
            }
            parent.push(parseScalar(line.slice(2)))
            continue
        }

        const separator = line.indexOf(':')
        if (separator === -1) {
            throw new Error(`Missing key/value separator at line ${index + 1}.`)
        }

        if (!isRecord(parent)) {
            throw new Error(`Mapping entry is not inside a mapping at line ${index + 1}.`)
        }

        const key = line.slice(0, separator).trim()
        if (key.length === 0) {
            throw new Error(`Empty mapping key at line ${index + 1}.`)
        }

        if (Object.hasOwn(parent, key)) {
            throw new Error(`Duplicate mapping key "${key}" at line ${index + 1}.`)
        }

        const rawValue = line.slice(separator + 1).trim()
        if (rawValue === '>' || rawValue === '|') {
            const blockLines: string[] = []
            let blockIndex = index + 1
            while (blockIndex < lines.length) {
                const blockLine = lines[blockIndex]
                if (blockLine === undefined) {
                    break
                }

                const blockIndent = blockLine.match(/^ */)?.[0]?.length ?? 0
                if (blockLine.trim().length > 0 && blockIndent <= indent) {
                    break
                }

                blockLines.push(blockLine.slice(Math.min(blockIndent, indent + 2)))
                blockIndex += 1
            }

            parent[key] = rawValue === '>'
                ? blockLines.map((item) => item.trim()).filter((item) => item.length > 0).join(' ')
                : blockLines.join('\n').trimEnd()
            index = blockIndex - 1
            continue
        }

        if (rawValue.length > 0) {
            parent[key] = parseScalar(rawValue)
            continue
        }

        const nextLine = lines[index + 1]
        const nextTrimmed = nextLine?.trim()
        const child: Record<string, unknown> | unknown[] = nextTrimmed?.startsWith('- ') ? [] : {}
        parent[key] = child
        stack.push({ indent, value: child })
    }

    return root
}

function parseScalar(value: string): unknown {
    if (value === 'true') {
        return true
    }

    if (value === 'false') {
        return false
    }

    if (/^-?\d+$/.test(value)) {
        return Number(value)
    }

    if (value.startsWith('"') && value.endsWith('"')) {
        try {
            return JSON.parse(value) as string
        } catch {
            return value.slice(1, -1)
        }
    }

    if (value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1).replace(/''/g, "'")
    }

    return value
}

function scalar(value: string): string {
    if (/^[A-Za-z0-9_\-.:/+]+$/.test(value)) {
        return value
    }

    return JSON.stringify(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberField(value: unknown, field: string): { value: number, error?: undefined } | { value?: undefined, error: string } {
    if (typeof value === 'number' && Number.isInteger(value)) {
        return { value }
    }

    return { error: `${field} must be an integer.` }
}

function stringField(value: unknown, field: string): { value: string, error?: undefined } | { value?: undefined, error: string } {
    if (typeof value === 'string' && value.length > 0) {
        return { value }
    }

    return { error: `${field} must be a non-empty string.` }
}

function invalidFrontmatter(message: string): RmemCommandError {
    return commandError({
        code: 'INVALID_FRONTMATTER',
        message,
        suggestion: 'Provide frontmatter that matches the rmem document contract.'
    })
}

function isCommandErrorLike(value: unknown): value is RmemCommandError {
    return isRecord(value) && value.ok === false
}

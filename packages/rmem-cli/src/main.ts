#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { TextDecoder } from 'node:util'
import {
    checkCommand,
    createFolderCommand,
    devDocsParseCommand,
    devEmbeddingsStatusCommand,
    devLinksValidateCommand,
    devNotesListCommand,
    devProvidersCheckCommand,
    devRebuildCommand,
    devSearchTraceCommand,
    editCommand,
    initCommand,
    moveFolderCommand,
    isCommandError,
    listCommand,
    readCommand,
    removeCommand,
    removeFolderCommand,
    searchCommand,
    treeGenerateCommand,
    treeRepairCommand,
    updateFolderCommand,
    writeCommand
} from '@rmem/core'

async function main(): Promise<void> {
    const rawArgs = process.argv.slice(2)
    const jsonOutput = rawArgs.includes('--json')
    const args = rawArgs.filter((arg) => arg !== '--json')
    const command = args[0]
    const root = process.cwd()
    const version = await readCliVersion()
    const outputFormat: OutputFormat = jsonOutput ? 'json' : 'yaml'

    if (command === '--version' || command === '-v') {
        printOutput({
            ok: true,
            version
        }, outputFormat)
        return
    }

    if (command === undefined || command === '--help' || command === '-h') {
        printOutput({
            ok: true,
            version,
            commands: [
                'init',
                'search <query>',
                'list [memory-path]',
                'read <document-path>',
                'write <document-path> [--from <file>]',
                'edit <document-path>',
                'remove <document-path>',
                'folder create <memory-path> --description <text> [--title <text>]',
                'folder update <memory-path> --description <text> [--title <text>]',
                'folder move <from-memory-path> <to-memory-path> [--description <text>] [--title <text>]',
                'folder remove <memory-path> [--delete-files]',
                'tree generate',
                'tree repair',
                'check',
                'dev notes list',
                'dev notes rebuild',
                'dev docs parse <document-path>',
                'dev index rebuild',
                'dev embeddings status',
                'dev links validate',
                'dev providers check',
                'dev search trace <query>'
            ]
        }, outputFormat)
        return
    }

    if (command === 'init') {
        await output(await initCommand(root), outputFormat)
        return
    }

    if (command === 'search') {
        await output(await searchCommand(root, args.slice(1).join(' ')), outputFormat)
        return
    }

    if (command === 'list') {
        await output(await listCommand(root, args[1]), outputFormat)
        return
    }

    if (command === 'read') {
        await output(await readCommand(root, requiredArg(args[1], 'document-path')), outputFormat, { readMarkdown: true })
        return
    }

    if (command === 'write') {
        const documentPath = requiredArg(args[1], 'document-path')
        const fromIndex = args.indexOf('--from')
        const content = fromIndex === -1
            ? await readStdin()
            : decodeUtf8(await readFile(requiredArg(args[fromIndex + 1], 'file')))
        await output(await writeCommand(root, documentPath, content), outputFormat)
        return
    }

    if (command === 'edit') {
        const documentPath = requiredArg(args[1], 'document-path')
        const request = parseEditRequest(await readStdin())
        if (isEditRequestError(request)) {
            await output(request, outputFormat)
            return
        }
        await output(await editCommand(root, documentPath, request), outputFormat)
        return
    }

    if (command === 'remove') {
        await output(await removeCommand(root, requiredArg(args[1], 'document-path')), outputFormat)
        return
    }

    if (command === 'folder' && args[1] === 'create') {
        await output(await createFolderCommand(root, requiredArg(args[2], 'memory-path'), folderWriteRequest(args)), outputFormat)
        return
    }

    if (command === 'folder' && args[1] === 'update') {
        await output(await updateFolderCommand(root, requiredArg(args[2], 'memory-path'), folderWriteRequest(args)), outputFormat)
        return
    }

    if (command === 'folder' && args[1] === 'move') {
        await output(await moveFolderCommand(root, requiredArg(args[2], 'from-memory-path'), requiredArg(args[3], 'to-memory-path'), folderMoveRequest(args)), outputFormat)
        return
    }

    if (command === 'folder' && args[1] === 'remove') {
        await output(await removeFolderCommand(root, requiredArg(args[2], 'memory-path'), {
            deleteFiles: args.includes('--delete-files')
        }), outputFormat)
        return
    }

    if (command === 'tree' && args[1] === 'generate') {
        await output(await treeGenerateCommand(root), outputFormat)
        return
    }

    if (command === 'tree' && args[1] === 'repair') {
        await output(await treeRepairCommand(root), outputFormat)
        return
    }

    if (command === 'check') {
        await output(await checkCommand(root), outputFormat)
        return
    }

    if (command === 'dev' && args[1] === 'notes' && args[2] === 'list') {
        await output(await devNotesListCommand(root))
        return
    }

    if (command === 'dev' && args[1] === 'notes' && args[2] === 'rebuild') {
        await output(await devRebuildCommand(root))
        return
    }

    if (command === 'dev' && args[1] === 'docs' && args[2] === 'parse') {
        await output(await devDocsParseCommand(root, requiredArg(args[3], 'document-path')))
        return
    }

    if (command === 'dev' && args[1] === 'index' && args[2] === 'rebuild') {
        await output(await devRebuildCommand(root))
        return
    }

    if (command === 'dev' && args[1] === 'embeddings' && args[2] === 'status') {
        await output(await devEmbeddingsStatusCommand(root))
        return
    }

    if (command === 'dev' && args[1] === 'links' && args[2] === 'validate') {
        await output(await devLinksValidateCommand(root))
        return
    }

    if (command === 'dev' && args[1] === 'providers' && args[2] === 'check') {
        await output(await devProvidersCheckCommand(root))
        return
    }

    if (command === 'dev' && args[1] === 'search' && args[2] === 'trace') {
        await output(await devSearchTraceCommand(root, args.slice(3).join(' ')))
        return
    }

    printOutput({
        ok: false,
        code: 'INVALID_CONFIG',
        message: `Unknown command: ${command}`,
        suggestion: 'Use one of the public rmem commands or rmem dev commands.'
    }, outputFormat)
    process.exitCode = 2
}

type OutputFormat = 'json' | 'yaml'

async function output(value: unknown, format: OutputFormat = 'json', options: { readMarkdown?: boolean } = {}): Promise<void> {
    if (options.readMarkdown === true && format === 'yaml' && isReadDocumentOutput(value)) {
        printReadMarkdown(value)
    } else {
        printOutput(value, format)
    }

    if (isCommandError(value)) {
        process.exitCode = 1
    }
}

function printOutput(value: unknown, format: OutputFormat): void {
    if (format === 'json') {
        printJson(value)
        return
    }

    process.stdout.write(`${toYaml(value)}\n`)
}

function printJson(value: unknown): void {
    process.stdout.write(`${JSON.stringify(value, null, 4)}\n`)
}

function printReadMarkdown(value: {
    ok: true
    document: unknown
    content: string
    documentHash: string
    warnings: unknown[]
}): void {
    const metadata = {
        ok: value.ok,
        document: value.document,
        documentHash: value.documentHash,
        warnings: value.warnings
    }
    process.stdout.write(`${toYaml(metadata)}\n\n--- markdown ---\n${value.content}\n`)
}

function isReadDocumentOutput(value: unknown): value is {
    ok: true
    document: unknown
    content: string
    documentHash: string
    warnings: unknown[]
} {
    return typeof value === 'object'
        && value !== null
        && (value as { ok?: unknown }).ok === true
        && typeof (value as { content?: unknown }).content === 'string'
        && 'document' in value
        && 'documentHash' in value
        && Array.isArray((value as { warnings?: unknown }).warnings)
}

function toYaml(value: unknown, indent = 0): string {
    const prefix = ' '.repeat(indent)

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return '[]'
        }

        return value.map((item) => {
            if (isPlainObject(item) || Array.isArray(item)) {
                return `${prefix}- ${toYaml(item, indent + 2).trimStart()}`
            }

            return `${prefix}- ${yamlScalar(item, indent + 2)}`
        }).join('\n')
    }

    if (isPlainObject(value)) {
        const entries = Object.entries(value)
        if (entries.length === 0) {
            return '{}'
        }

        return entries.map(([key, item]) => {
            if (isPlainObject(item) || Array.isArray(item)) {
                const serialized = toYaml(item, indent + 2)
                if (serialized === '[]' || serialized === '{}') {
                    return `${prefix}${key}: ${serialized}`
                }

                return `${prefix}${key}:\n${serialized}`
            }

            return `${prefix}${key}: ${yamlScalar(item, indent + 2)}`
        }).join('\n')
    }

    return `${prefix}${yamlScalar(value, indent)}`
}

function yamlScalar(value: unknown, indent: number): string {
    if (value === null) {
        return 'null'
    }

    if (typeof value === 'boolean' || typeof value === 'number') {
        return String(value)
    }

    if (typeof value !== 'string') {
        return yamlScalar(JSON.stringify(value), indent)
    }

    if (value.length === 0) {
        return '""'
    }

    if (value.includes('\n')) {
        const blockIndent = ' '.repeat(indent)
        return `|-\n${value.split('\n').map((line) => `${blockIndent}${line}`).join('\n')}`
    }

    if (/^[A-Za-z0-9_./@:-]+$/u.test(value) && !/^(true|false|null)$/u.test(value)) {
        return value
    }

    return JSON.stringify(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object'
        && value !== null
        && !Array.isArray(value)
}

function requiredArg(value: string | undefined, name: string): string {
    if (value === undefined || value.length === 0) {
        throw new Error(`Missing required argument: ${name}`)
    }

    return value
}

function requiredOption(args: string[], name: string): string {
    const value = optionalOption(args, name)
    if (value === undefined) {
        throw new Error(`Missing required ${name}.`)
    }

    return value
}

function optionalOption(args: string[], name: string): string | undefined {
    const index = args.indexOf(name)
    if (index === -1) {
        return undefined
    }

    return requiredArg(args[index + 1], name)
}

function folderWriteRequest(args: string[]): { title?: string, description: string } {
    const request: { title?: string, description: string } = {
        description: requiredOption(args, '--description')
    }
    const title = optionalOption(args, '--title')
    if (title !== undefined) {
        request.title = title
    }

    return request
}

function folderMoveRequest(args: string[]): { title?: string, description?: string } {
    const request: { title?: string, description?: string } = {}
    const title = optionalOption(args, '--title')
    if (title !== undefined) {
        request.title = title
    }
    const description = optionalOption(args, '--description')
    if (description !== undefined) {
        request.description = description
    }

    return request
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = []

    for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    }

    return decodeUtf8(Buffer.concat(chunks))
}

function decodeUtf8(bytes: Uint8Array): string {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    return decoder.decode(bytes)
}

function parseEditRequest(input: string): Parameters<typeof editCommand>[2] | {
    ok: false
    code: 'INVALID_EDIT_REQUEST'
    message: string
    details?: unknown
    suggestion: string
} {
    try {
        return JSON.parse(input) as Parameters<typeof editCommand>[2]
    } catch (error) {
        return {
            ok: false,
            code: 'INVALID_EDIT_REQUEST',
            message: 'Edit request stdin must be valid JSON.',
            details: String(error),
            suggestion: 'Pass JSON with optional documentHash and edits array.'
        }
    }
}

function isEditRequestError(value: unknown): value is {
    ok: false
    code: 'INVALID_EDIT_REQUEST'
    message: string
    details?: unknown
    suggestion: string
} {
    return typeof value === 'object'
        && value !== null
        && 'ok' in value
        && (value as { ok: unknown }).ok === false
}

async function readCliVersion(): Promise<string> {
    const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    try {
        const parsed = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version?: unknown }
        if (typeof parsed.version === 'string' && parsed.version.length > 0) {
            return parsed.version
        }
    } catch {
        return 'unknown'
    }

    return 'unknown'
}

main().catch((error: unknown) => {
    if (error instanceof TypeError) {
        printJson({
            ok: false,
            code: 'ENCODING_ERROR',
            message: 'Input could not be decoded as valid UTF-8.',
            details: String(error),
            suggestion: 'Provide stdin or --from file content encoded as valid UTF-8.'
        })
        process.exitCode = 1
        return
    }

    printJson({
        ok: false,
        code: 'INVALID_CONFIG',
        message: 'CLI command failed.',
        details: String(error),
        suggestion: 'Check command arguments.'
    })
    process.exitCode = 1
})

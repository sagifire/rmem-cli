#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { TextDecoder } from 'node:util'
import {
    checkCommand,
    devDocsParseCommand,
    devEmbeddingsStatusCommand,
    devLinksValidateCommand,
    devNotesListCommand,
    devProvidersCheckCommand,
    devRebuildCommand,
    devSearchTraceCommand,
    editCommand,
    isCommandError,
    listCommand,
    readCommand,
    removeCommand,
    searchCommand,
    writeCommand
} from '@rmem/core'

async function main(): Promise<void> {
    const args = process.argv.slice(2)
    const command = args[0]
    const root = process.cwd()
    const version = await readCliVersion()

    if (command === '--version' || command === '-v') {
        printJson({
            ok: true,
            version
        })
        return
    }

    if (command === undefined || command === '--help' || command === '-h') {
        printJson({
            ok: true,
            version,
            commands: [
                'search <query>',
                'list [memory-path]',
                'read <document-path>',
                'write <document-path> [--from <file>]',
                'edit <document-path>',
                'remove <document-path>',
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
        })
        return
    }

    if (command === 'search') {
        await output(await searchCommand(root, args.slice(1).join(' ')))
        return
    }

    if (command === 'list') {
        await output(await listCommand(root, args[1]))
        return
    }

    if (command === 'read') {
        await output(await readCommand(root, requiredArg(args[1], 'document-path')))
        return
    }

    if (command === 'write') {
        const documentPath = requiredArg(args[1], 'document-path')
        const fromIndex = args.indexOf('--from')
        const content = fromIndex === -1
            ? await readStdin()
            : decodeUtf8(await readFile(requiredArg(args[fromIndex + 1], 'file')))
        await output(await writeCommand(root, documentPath, content))
        return
    }

    if (command === 'edit') {
        const documentPath = requiredArg(args[1], 'document-path')
        const request = parseEditRequest(await readStdin())
        if (isEditRequestError(request)) {
            await output(request)
            return
        }
        await output(await editCommand(root, documentPath, request))
        return
    }

    if (command === 'remove') {
        await output(await removeCommand(root, requiredArg(args[1], 'document-path')))
        return
    }

    if (command === 'check') {
        await output(await checkCommand(root))
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

    printJson({
        ok: false,
        code: 'INVALID_CONFIG',
        message: `Unknown command: ${command}`,
        suggestion: 'Use one of the public rmem commands or rmem dev commands.'
    })
    process.exitCode = 2
}

async function output(value: unknown): Promise<void> {
    printJson(value)
    if (isCommandError(value)) {
        process.exitCode = 1
    }
}

function printJson(value: unknown): void {
    process.stdout.write(`${JSON.stringify(value, null, 4)}\n`)
}

function requiredArg(value: string | undefined, name: string): string {
    if (value === undefined || value.length === 0) {
        throw new Error(`Missing required argument: ${name}`)
    }

    return value
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

import type { RmemCommandError, RmemErrorCode } from './types.js'

export function commandError(input: {
    code: RmemErrorCode
    message: string
    details?: unknown
    suggestion?: string
}): RmemCommandError {
    const result: RmemCommandError = {
        ok: false,
        code: input.code,
        message: input.message
    }

    if (input.details !== undefined) {
        result.details = input.details
    }

    if (input.suggestion !== undefined) {
        result.suggestion = input.suggestion
    }

    return result
}

export function isCommandError(value: unknown): value is RmemCommandError {
    return typeof value === 'object'
        && value !== null
        && 'ok' in value
        && (value as { ok: unknown }).ok === false
}

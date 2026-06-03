import { TextDecoder } from 'node:util'

export function decodeUtf8(bytes: Uint8Array): string {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    return decoder.decode(bytes)
}

export function assertValidUtf8Text(text: string): boolean {
    const encoded = Buffer.from(text, 'utf8')
    const decoded = decodeUtf8(encoded)
    return decoded === text
}

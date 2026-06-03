import type { StructuralPlace } from './types.js'
import { placeId } from './ids.js'
import { sha256 } from './hash.js'
import { stripManagedHeader } from './managed-header.js'

export function extractStructuralPlaces(input: {
    documentId: string
    documentPath: string
    body: string
}): StructuralPlace[] {
    const source = stripManagedHeader(input.body)
    const headings: {
        level: number
        title: string
        offset: number
        lineEnd: number
    }[] = []
    const pattern = /^(#{1,6})\s+(.+)$/gm
    let match = pattern.exec(source)

    while (match !== null) {
        const hashes = match[1]
        const title = match[2]
        if (hashes !== undefined && title !== undefined) {
            headings.push({
                level: hashes.length,
                title: title.trim(),
                offset: match.index,
                lineEnd: pattern.lastIndex
            })
        }
        match = pattern.exec(source)
    }

    const places: StructuralPlace[] = []
    const headingPath: { level: number, title: string }[] = []

    if (headings.length === 0 || (headings[0]?.offset ?? 0) > 0) {
        const endOffset = headings[0]?.offset ?? source.length
        places.push(makePlace({
            documentId: input.documentId,
            documentPath: input.documentPath,
            title: 'Root',
            level: 0,
            orderIndex: 0,
            headingPath: [],
            content: source.slice(0, endOffset),
            startOffset: 0,
            endOffset
        }))
    }

    for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index]
        if (heading === undefined) {
            continue
        }

        while (headingPath.length > 0) {
            const last = headingPath[headingPath.length - 1]
            if (last !== undefined && last.level >= heading.level) {
                headingPath.pop()
            } else {
                break
            }
        }
        headingPath.push({ level: heading.level, title: heading.title })

        const nextHeading = headings[index + 1]
        const endOffset = nextHeading?.offset ?? source.length
        const path = headingPath.map((item) => item.title)
        places.push(makePlace({
            documentId: input.documentId,
            documentPath: input.documentPath,
            title: heading.title,
            level: heading.level,
            orderIndex: places.length,
            headingPath: path,
            content: source.slice(heading.offset, endOffset),
            startOffset: heading.offset,
            endOffset
        }))
    }

    return places
}

export function excerptForPlace(body: string, maxChars: number): string {
    const source = stripManagedHeader(body).trim()
    if (source.length <= maxChars) {
        return source
    }

    return `${source.slice(0, maxChars - 1).trimEnd()}…`
}

function makePlace(input: {
    documentId: string
    documentPath: string
    title: string
    level: number
    orderIndex: number
    headingPath: string[]
    content: string
    startOffset: number
    endOffset: number
}): StructuralPlace {
    return {
        id: placeId(input.documentId, input.orderIndex, input.title),
        documentId: input.documentId,
        documentPath: input.documentPath,
        headingPath: input.headingPath,
        title: input.title,
        level: input.level,
        orderIndex: input.orderIndex,
        startOffset: input.startOffset,
        endOffset: input.endOffset,
        sourceHash: sha256(input.content)
    }
}

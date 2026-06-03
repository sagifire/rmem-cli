export function slugify(input: string): string {
    const normalized = input
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()

    return normalized.length > 0 ? normalized : 'document'
}

export function documentIdFromPath(path: string): string {
    return `doc_${slugify(path).replace(/-/g, '_')}`
}

export function placeId(documentId: string, orderIndex: number, title: string): string {
    return `${documentId}__p${orderIndex}_${slugify(title)}`
}

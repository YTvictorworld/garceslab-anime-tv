/** The queries something reads back from the cache: whole keys, and endpoints whose `[endpoint, id]` queries are. */
export type PersistedQueries = {
    keys: ReadonlySet<string>
    perIdEndpoints: ReadonlySet<string>
}

/**
 * Only what is read back is written. Each write stringifies the response and
 * stores it synchronously, which for every query (most never read again)
 * cost the TV a pause on every refetch and filled webOS' small localStorage.
 */
export function shouldPersistQuery(
    options: { gcTime?: number },
    queryKey: readonly unknown[],
    persisted: PersistedQueries,
): boolean {
    if (options.gcTime === 0) return false
    if (queryKey.length === 2 && typeof queryKey[0] === "string" && persisted.perIdEndpoints.has(queryKey[0])) return true
    return persisted.keys.has(JSON.stringify(queryKey))
}

/**
 * Garceslab Anime: on a server with local profiles each profile's cached
 * responses are stored under its own scope, so one profile never starts from
 * another's lists. Without profiles the scope is empty and the keys are the
 * ones stock servers always used.
 */
export function profileCacheScope(profileId: number | null | undefined): string {
    return profileId ? `p${profileId}` : ""
}

/** The storage key (after the cache prefix) of a serialized query key in a scope. */
export function scopedCacheKey(scope: string, serializedQueryKey: string): string {
    return scope ? `${scope}|${serializedQueryKey}` : serializedQueryKey
}

/** Splits a storage key (after the cache prefix) into its scope and serialized query key. */
export function parseScopedCacheKey(key: string): { scope: string; serializedQueryKey: string } {
    // Serialized query keys are JSON arrays; anything before "|[" is the scope.
    if (key.startsWith("[")) return { scope: "", serializedQueryKey: key }
    const bar = key.indexOf("|")
    if (bar <= 0) return { scope: "", serializedQueryKey: key }
    return { scope: key.slice(0, bar), serializedQueryKey: key.slice(bar + 1) }
}

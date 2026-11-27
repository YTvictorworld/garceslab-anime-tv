/**
 * Garceslab Anime: which audio or subtitle track the player picks at start,
 * from the profile's preferred languages ("spa, es, spanish"). Free of React
 * Native so it can be unit tested; player-preferences.ts re-exports it and
 * use-mpv-player.ts applies it. Any subtitle track the player lists (the
 * file's, a server's, an added file) goes through these rules.
 *
 * Languages are compared by their canonical code, never by substring: "es",
 * "spa", "es-419" and "Español" are the same language, and "es" is not found
 * inside "Portuguese" or "Japanese". The same table is used by the server's
 * subtitle-aware auto-select (internal/torrents/trackprobe/language.go).
 */

export type MatchableTrack = {
    id: number
    /** Language code or IETF tag ("spa", "es-419"); may be missing or "und". */
    language?: string
    /** The track's name ("Spanish (Latin America)", "Signs & Songs"). */
    title?: string
    /** Matroska's forced flag: only signs or foreign-language lines. */
    forced?: boolean
}

/** Canonical key (ISO 639-1) -> the codes and names that mean it. */
const LANGUAGE_TABLE: Record<string, string[]> = {
    es: ["es", "spa", "esp", "spanish", "español", "espanol", "castellano", "castilian", "latino", "latin american", "latinoamericano", "latinoamérica", "latinoamerica", "latam"],
    en: ["en", "eng", "english", "inglés", "ingles"],
    pt: ["pt", "por", "portuguese", "português", "portugues", "brazilian", "brasileiro"],
    fr: ["fr", "fre", "fra", "french", "français", "francais"],
    de: ["de", "ger", "deu", "german", "deutsch"],
    it: ["it", "ita", "italian", "italiano"],
    ja: ["ja", "jpn", "jp", "japanese", "日本語"],
    ru: ["ru", "rus", "russian", "русский"],
    ar: ["ar", "ara", "arabic", "العربية"],
    zh: ["zh", "chi", "zho", "chinese", "中文", "mandarin", "cantonese"],
    ko: ["ko", "kor", "korean", "한국어"],
    pl: ["pl", "pol", "polish", "polski"],
    tr: ["tr", "tur", "turkish", "türkçe"],
    id: ["id", "ind", "indonesian", "bahasa indonesia"],
    th: ["th", "tha", "thai"],
    vi: ["vi", "vie", "vietnamese", "tiếng việt"],
    hi: ["hi", "hin", "hindi"],
    nl: ["nl", "dut", "nld", "dutch", "nederlands"],
    ms: ["ms", "may", "msa", "malay"],
    uk: ["uk", "ukr", "ukrainian"],
    cs: ["cs", "ces", "cze", "czech", "čeština"],
}

const ALIAS_TO_KEY = new Map<string, string>()
for (const [key, aliases] of Object.entries(LANGUAGE_TABLE)) {
    for (const alias of aliases) ALIAS_TO_KEY.set(alias.normalize("NFC"), key)
}

/**
 * Aliases looked for as words in a track name. Two- and three-letter codes
 * are left out: they would match ordinary words ("it", "de", "esp").
 */
const NAME_WORDS = new Map(Array.from(ALIAS_TO_KEY).filter(([alias]) => Array.from(alias).length > 3))

/** Words of a name that tell a Spanish track's region ("Spanish (Latin America)"). */
const REGION_WORDS: Record<string, string> = {
    "latin america": "419",
    "latin american": "419",
    "latinoamérica": "419",
    "latinoamerica": "419",
    "latinoamericano": "419",
    "latino": "419",
    "latam": "419",
    "españa": "es",
    "espana": "es",
    "spain": "es",
    "castellano": "es",
    "castilian": "es",
    "european": "es",
}

/** Names that mark a forced track when the flag wasn't set ("Spanish (Forced)", "Forzados"). */
const FORCED_WORDS = new Set(["forced", "forzado", "forzados", "forzadas", "forcés", "erzwungen"])

const NO_LANGUAGE = new Set(["", "und", "unk", "zxx", "mul", "mis"])

function clean(value: string | undefined | null) {
    return (value ?? "").normalize("NFC").trim().toLowerCase()
}

function words(text: string): string[] {
    return clean(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/** Each word and each pair of neighbouring words ("latin america"). */
function phrases(text: string): string[] {
    const list = words(text)
    const out = list.slice()
    for (let i = 0; i + 1 < list.length; i++) out.push(`${list[i]} ${list[i + 1]}`)
    return out
}

/**
 * The canonical key of a language code, IETF tag or name ("spa", "es-419",
 * "Español" -> "es"). Unknown values come back lowercased; none gives "".
 */
export function normalizeLanguage(value: string | undefined | null): string {
    const v = clean(value)
    if (NO_LANGUAGE.has(v)) return ""
    const known = ALIAS_TO_KEY.get(v)
    if (known) return known
    const sep = v.search(/[-_]/)
    if (sep > 0) {
        const primary = ALIAS_TO_KEY.get(v.slice(0, sep))
        if (primary) return primary
    }
    return v
}

/** The region subtag of an IETF tag ("es-419" -> "419", "es_ES" -> "es"). */
function tagRegion(value: string | undefined): string | undefined {
    const parts = clean(value).split(/[-_]/)
    // Skip a script subtag (zh-Hant-TW).
    const region = parts.slice(1).find(part => /^([a-z]{2}|\d{3})$/.test(part))
    return region
}

function nameRegion(title: string | undefined): string | undefined {
    for (const phrase of phrases(title ?? "")) {
        const region = REGION_WORDS[phrase]
        if (region) return region
    }
    return undefined
}

/**
 * The languages of a track: its tag first, then any named in its title.
 * Matroska tags a track "eng" when the muxer wrote no language, so a name
 * like "Spanish" counts even when the tag says otherwise.
 */
export function trackLanguages(track: Pick<MatchableTrack, "language" | "title">): string[] {
    const out: string[] = []
    const add = (key: string) => {
        if (key && !out.includes(key)) out.push(key)
    }
    add(normalizeLanguage(track.language))
    for (const phrase of phrases(track.title ?? "")) {
        const key = NAME_WORDS.get(phrase)
        if (key) add(key)
    }
    return out
}

type PreferredLanguage = { key: string; region?: string }

/**
 * "es-419, es-es, english" -> es (Latin America), es (Spain), es, en.
 * A tag with a region asks for that region first; the language without a
 * region follows it, so a release with only the other region's track still
 * gets Spanish.
 */
export function parseLanguagePreference(pref: string): PreferredLanguage[] {
    const out: PreferredLanguage[] = []
    const seen = new Set<string>()
    const add = (entry: PreferredLanguage) => {
        const id = `${entry.key}-${entry.region ?? ""}`
        if (seen.has(id)) return
        seen.add(id)
        out.push(entry)
    }
    for (const part of pref.split(",")) {
        const key = normalizeLanguage(part)
        if (!key) continue
        const region = tagRegion(part)
        if (region && ALIAS_TO_KEY.has(clean(part).split(/[-_]/)[0])) add({ key, region })
        else add({ key })
    }
    // A language asked for only with regions ("es-419, eng") also takes its other
    // regions, right after the last regional entry (before English here).
    for (const key of new Set(out.filter(e => e.region).map(e => e.key))) {
        if (out.some(e => e.key === key && !e.region)) continue
        let last = -1
        out.forEach((e, i) => { if (e.key === key) last = i })
        out.splice(last + 1, 0, { key })
    }
    return out
}

function parseLabels(ignored: string | undefined): string[] {
    return (ignored ?? "").split(",").map(clean).filter(Boolean)
}

/** A track for signs & songs (by its name) or flagged/named forced: not a full subtitle track. */
export function isPartialTrack(track: MatchableTrack, ignoredLabels: string[]): boolean {
    if (track.forced) return true
    const title = clean(track.title)
    if (!title) return false
    if (words(title).some(word => FORCED_WORDS.has(word))) return true
    return ignoredLabels.some(label => matchesLabel(title, label))
}

/** A label matches whole words of the name: "signs & songs" and "signs" match "Signs & Songs [Spanish]". */
function matchesLabel(title: string, label: string) {
    const titleWords = words(title)
    const labelWords = words(label)
    if (labelWords.length === 0) return title.includes(label)
    for (let i = 0; i + labelWords.length <= titleWords.length; i++) {
        if (labelWords.every((word, j) => titleWords[i + j] === word)) return true
    }
    return false
}

function trackRegion(track: MatchableTrack): string | undefined {
    return tagRegion(track.language) ?? nameRegion(track.title)
}

/**
 * The first full track in the most preferred language the file has (the
 * preference order wins over the file's order and its default flag).
 * Forced and signs & songs tracks never count. Null when none matches.
 */
export function findPreferredTrack(
    tracks: MatchableTrack[],
    preferenceString: string,
    ignoredString?: string,
): number | null {
    if (!tracks.length || !preferenceString.trim()) return null
    const preferred = parseLanguagePreference(preferenceString)
    const ignored = parseLabels(ignoredString)
    const candidates = tracks
        .filter(track => !isPartialTrack(track, ignored))
        .map(track => ({ track, languages: trackLanguages(track) }))

    for (const want of preferred) {
        const match = candidates.find(({ track, languages }) =>
            languages.includes(want.key) && (!want.region || trackRegion(track) === want.region))
        if (match) return match.track.id
    }
    return null
}

/**
 * The first full track (not forced, not signs & songs), for when no track is
 * in a preferred language.
 */
export function findFallbackTrack(
    tracks: MatchableTrack[],
    ignoredString?: string,
): number | null {
    const ignored = parseLabels(ignoredString)
    return tracks.find(track => !isPartialTrack(track, ignored))?.id ?? null
}

export type SubtitleSelectionPrefs = {
    showSubtitles: boolean
    preferredSubtitleLanguages: string
    ignoredSubtitleLabels: string
}

/**
 * The subtitle track to switch to, or null to leave things as they are.
 * The web player starts with none selected (whatever the file's default
 * flag); mpv starts on the file's default. Either way the preferred track
 * replaces it, and with no preferred track the web player shows the first
 * full one.
 */
export function chooseSubtitleTrack(
    tracks: Array<MatchableTrack & { selected?: boolean }>,
    prefs: SubtitleSelectionPrefs,
): number | null {
    if (!prefs.showSubtitles || tracks.length === 0) return null
    const current = tracks.find(track => track.selected)
    const choice = findPreferredTrack(tracks, prefs.preferredSubtitleLanguages, prefs.ignoredSubtitleLabels)
        ?? (current ? null : findFallbackTrack(tracks, prefs.ignoredSubtitleLabels))
    if (choice === null || choice === current?.id) return null
    return choice
}

/**
 * When the subtitle choice is made during one playback: once tracks are
 * known, again when more tracks appear (the file's header after the server's
 * list, an added subtitle file) and again when the profile's preferences
 * arrive or change (the profile sync may finish after the episode started).
 * Never after the viewer picked a track or turned subtitles off.
 */
export function createSubtitleAutoSelect() {
    let checkedCount = 0
    let checkedPrefs: string | null = null
    let userChose = false

    return {
        /** A new source or URL: the player lists its tracks again with none selected. */
        reset() {
            checkedCount = 0
            checkedPrefs = null
            userChose = false
        },
        /** The viewer picked a track (or none) in the player. */
        userChose() {
            userChose = true
        },
        hasUserChosen: () => userChose,
        /** The track to switch to now, or null. */
        decide(tracks: Array<MatchableTrack & { selected?: boolean }>, prefs: SubtitleSelectionPrefs): number | null {
            if (userChose || !prefs.showSubtitles || tracks.length === 0) return null
            const prefsKey = `${prefs.preferredSubtitleLanguages}\n${prefs.ignoredSubtitleLabels}`
            if (tracks.length <= checkedCount && prefsKey === checkedPrefs) return null
            checkedCount = Math.max(checkedCount, tracks.length)
            checkedPrefs = prefsKey
            return chooseSubtitleTrack(tracks, prefs)
        },
    }
}

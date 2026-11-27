// Garceslab Anime: TV app updates installed only after the user confirms (docs/tv-updates.md).
// The self-hoster's updater downloads and checks new builds; the Garceslab server proxies its
// status at /api/v1/tv-updates/* and the TV asks the user before installing. This module reads
// the server's answers and decides what the update card shows. Pure (no react-native imports)
// so tests/tv-updates.test.ts can import it.

export type TVUpdateChangeType = "feat" | "fix" | "other"

export type TVUpdateChange = {
    type: TVUpdateChangeType
    /** The pull request title without its Conventional Commit prefix. */
    title: string
    pr: number | null
}

export type TVUpdateBuild = {
    version: string
    /** Full commit SHA, or null (a build without build.json, or a stable release). */
    commit: string | null
    shortCommit: string | null
    channel: string | null
    builtAt: string | null
}

export type TVUpdatePending = TVUpdateBuild & {
    /** Oldest first, without internal changes. */
    changes: TVUpdateChange[]
    /** False when the updater couldn't follow the chain back to the installed build. */
    changesComplete: boolean | null
}

export type TVUpdateResult = {
    at: string | null
    ok: boolean
    version: string | null
    shortCommit: string | null
    error: string | null
}

export type TVUpdaterStatus = {
    channel: string | null
    installed: TVUpdateBuild | null
    pending: TVUpdatePending | null
    tvOnline: boolean
    installing: boolean
    /** "waiting-tv" while the updater waits for the TV to answer, "installing" while it installs. */
    installPhase: "waiting-tv" | "installing" | null
    lastResult: TVUpdateResult | null
}

/** What the server says about TV updates. */
export type TVUpdatesState =
    /** No updater configured on the server (or a server without the endpoint): no update UI anywhere. */
    | { kind: "not-configured" }
    /** Configured, but the server can't reach the updater: only Settings says so. */
    | { kind: "unreachable"; error: string }
    | { kind: "ready"; status: TVUpdaterStatus }

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

function shortSha(commit: string | null, short: string | null): string | null {
    return short ?? (commit ? commit.slice(0, 7) : null)
}

function parseBuild(raw: unknown): TVUpdateBuild | null {
    if (!isRecord(raw)) return null
    const commit = str(raw.commit)
    const version = str(raw.version)
    if (!version && !commit) return null
    return {
        version: version ?? "?",
        commit,
        shortCommit: shortSha(commit, str(raw.shortCommit)),
        channel: str(raw.channel),
        builtAt: str(raw.builtAt),
    }
}

function parseChange(raw: unknown): TVUpdateChange | null {
    if (!isRecord(raw)) return null
    const title = str(raw.title)
    if (!title || raw.type === "internal") return null
    const type: TVUpdateChangeType = raw.type === "feat" || raw.type === "fix" ? raw.type : "other"
    return { type, title, pr: typeof raw.pr === "number" ? raw.pr : null }
}

function parsePending(raw: unknown): TVUpdatePending | null {
    const build = parseBuild(raw)
    if (!build || !isRecord(raw)) return null
    const changes = Array.isArray(raw.changes)
        ? raw.changes.map(parseChange).filter((c): c is TVUpdateChange => c !== null)
        : []
    return {
        ...build,
        changes,
        changesComplete: typeof raw.changesComplete === "boolean" ? raw.changesComplete : null,
    }
}

function parseResult(raw: unknown): TVUpdateResult | null {
    if (!isRecord(raw)) return null
    const commit = str(raw.commit)
    return {
        at: str(raw.at),
        ok: raw.ok === true,
        version: str(raw.version),
        shortCommit: shortSha(commit, str(raw.shortCommit)),
        error: str(raw.error),
    }
}

/** The updater's GET /status, as the server passes it through. */
export function parseUpdaterStatus(raw: unknown): TVUpdaterStatus {
    const s = isRecord(raw) ? raw : {}
    const phase = s.installPhase === "waiting-tv" || s.installPhase === "installing" ? s.installPhase : null
    return {
        channel: str(s.channel),
        installed: parseBuild(s.installed),
        pending: parsePending(s.pending),
        tvOnline: s.tvOnline === true,
        installing: s.installing === true,
        installPhase: s.installing === true ? phase : null,
        lastResult: parseResult(s.lastResult),
    }
}

/**
 * The unwrapped `data` of GET /api/v1/tv-updates/status:
 * `{configured:false}`, `{configured:true, reachable:false, error}` or
 * `{configured:true, reachable:true, status}`. Anything else counts as not configured,
 * so a server that answers something unexpected never shows update UI.
 */
export function parseTVUpdatesResponse(raw: unknown): TVUpdatesState {
    if (!isRecord(raw) || raw.configured !== true) return { kind: "not-configured" }
    if (raw.reachable !== true) {
        return { kind: "unreachable", error: str(raw.error) ?? "The server can't reach the TV updater" }
    }
    return { kind: "ready", status: parseUpdaterStatus(raw.status) }
}

/** The key that identifies a pending build, for "show the card once per build". */
export function pendingBuildKey(pending: TVUpdateBuild | null | undefined): string | null {
    if (!pending) return null
    return pending.commit ?? `${pending.version}@${pending.builtAt ?? ""}`
}

export type GroupedChanges = {
    features: TVUpdateChange[]
    fixes: TVUpdateChange[]
    other: TVUpdateChange[]
}

/** Changes grouped for "See changes": New, Fixes, Other; each newest first. */
export function groupChanges(changes: readonly TVUpdateChange[]): GroupedChanges {
    const newestFirst = [...changes].reverse()
    return {
        features: newestFirst.filter(c => c.type === "feat"),
        fixes: newestFirst.filter(c => c.type === "fix"),
        other: newestFirst.filter(c => c.type === "other"),
    }
}

/** "3 new · 8 fixes", "1 fix", "2 changes"; "New build" when the updater listed none. */
export function changeCountsLabel(changes: readonly TVUpdateChange[]): string {
    const { features, fixes, other } = groupChanges(changes)
    const parts: string[] = []
    if (features.length) parts.push(`${features.length} new`)
    if (fixes.length) parts.push(`${fixes.length} ${fixes.length === 1 ? "fix" : "fixes"}`)
    if (other.length) {
        parts.push(parts.length
            ? `${other.length} other`
            : `${other.length} ${other.length === 1 ? "change" : "changes"}`)
    }
    return parts.length ? parts.join(" · ") : "New build"
}

export const CARD_HIGHLIGHT_LINES = 3

/**
 * The card's highlighted lines: features first, then fixes, then the rest, newest first
 * within each. At most CARD_HIGHLIGHT_LINES lines; when there are more changes the last
 * line is "… and N more changes".
 */
export function cardHighlights(changes: readonly TVUpdateChange[], maxLines = CARD_HIGHLIGHT_LINES): string[] {
    const { features, fixes, other } = groupChanges(changes)
    const ordered = [...features, ...fixes, ...other].map(c => c.title)
    if (ordered.length <= maxLines) return ordered
    const shown = ordered.slice(0, Math.max(0, maxLines - 1))
    const more = ordered.length - shown.length
    return [...shown, `… and ${more} more ${more === 1 ? "change" : "changes"}`]
}

/** "v1.0.0 · nightly (abc1234)", "v1.2.0" (stable). */
export function buildLabel(build: TVUpdateBuild | null | undefined, channel?: string | null): string {
    if (!build) return "Unknown"
    const ch = build.channel ?? channel ?? null
    const version = build.version === "?" ? "" : `v${build.version}`
    if (ch === "stable" || !ch) return [version, build.shortCommit ? `(${build.shortCommit})` : ""].filter(Boolean).join(" ") || "Unknown"
    return [version, `· ${ch}`, build.shortCommit ? `(${build.shortCommit})` : ""].filter(Boolean).join(" ")
}

/** The card's first line: "New version · nightly abc1234", "New version · v1.2.0". */
export function cardTitle(pending: TVUpdatePending, channel?: string | null): string {
    const ch = pending.channel ?? channel ?? null
    if (ch === "nightly") return `New version · nightly ${pending.shortCommit ?? `v${pending.version}`}`
    return `New version · v${pending.version}`
}

function ago(at: string | null, now: number): string | null {
    if (!at) return null
    const t = Date.parse(at)
    if (!Number.isFinite(t)) return null
    const minutes = Math.max(0, Math.round((now - t) / 60000))
    if (minutes < 1) return "just now"
    if (minutes < 60) return `${minutes} min ago`
    const hours = Math.round(minutes / 60)
    if (hours < 48) return `${hours} h ago`
    return `${Math.round(hours / 24)} days ago`
}

/** Settings → Updates, "Last install": "Installed v1.0.0 (abc1234) · 2 h ago" or "Failed: …". */
export function lastResultLabel(result: TVUpdateResult | null, now: number): string {
    if (!result) return "No install yet"
    const when = ago(result.at, now)
    const what = result.ok
        ? `Installed ${[result.version ? `v${result.version}` : "", result.shortCommit ? `(${result.shortCommit})` : ""].filter(Boolean).join(" ") || "the update"}`
        : `Failed: ${result.error ?? "unknown error"}`
    return when ? `${what} · ${when}` : what
}

export type CardInput = {
    state: TVUpdatesState | null | undefined
    /** The build whose card was already shown on this TV (stored locally). */
    seenKey: string | null
    /** A video is playing, or the player is open. */
    playing: boolean
    /** This TV asked to install and is waiting for the app to restart. */
    installRequested: boolean
}

export type CardDecision =
    | { show: true; key: string; pending: TVUpdatePending }
    | { show: false; reason: "not-configured" | "unreachable" | "no-pending" | "installing" | "seen" | "playing" }

/** Whether the update card may come up (once per pending build, never during playback). */
export function updateCardDecision({ state, seenKey, playing, installRequested }: CardInput): CardDecision {
    if (!state || state.kind === "not-configured") return { show: false, reason: "not-configured" }
    if (state.kind === "unreachable") return { show: false, reason: "unreachable" }
    const { pending, installing } = state.status
    const key = pendingBuildKey(pending)
    if (!pending || !key) return { show: false, reason: "no-pending" }
    if (installing || installRequested) return { show: false, reason: "installing" }
    if (seenKey === key) return { show: false, reason: "seen" }
    if (playing) return { show: false, reason: "playing" }
    return { show: true, key, pending }
}

export const STATUS_POLL_MS = 30 * 60 * 1000
export const INSTALLING_POLL_MS = 5000

/** How often to ask the server: every 30 minutes, every 5 seconds while an install runs. */
export function statusPollInterval(state: TVUpdatesState | null | undefined, installRequested: boolean): number {
    if (installRequested) return INSTALLING_POLL_MS
    if (state?.kind === "ready" && state.status.installing) return INSTALLING_POLL_MS
    return STATUS_POLL_MS
}

/** The unwrapped answer of POST /install and POST /later: `{ok, result}`. */
export function parseActionResponse(raw: unknown): { ok: boolean; error: string | null } {
    if (!isRecord(raw)) return { ok: false, error: "Unexpected answer from the server" }
    const result = isRecord(raw.result) ? raw.result : {}
    return {
        ok: raw.ok === true,
        error: raw.ok === true ? null : str(result.error) ?? str(raw.error) ?? "The updater refused",
    }
}

/** The code of a server error message: "PLAYBACK_ACTIVE: …" → "PLAYBACK_ACTIVE". */
function errorCodeOf(message: string | null | undefined): string {
    const match = /^([A-Z][A-Z0-9_]+)(?::|$)/.exec((message ?? "").trim())
    return match ? match[1] : ""
}

/** What the TV says when the server refuses to install. */
export function installErrorMessage(error: { error?: string; status?: number } | null | undefined): string {
    const message = error?.error ?? ""
    if (errorCodeOf(message) === "PLAYBACK_ACTIVE") {
        return "Something is playing on this TV. Stop it, then install the update."
    }
    if (error?.status === 404) return "This server doesn't support TV updates"
    return message || "Couldn't start the update"
}

export type InstallWatch =
    | { phase: "installing" }
    | { phase: "failed"; error: string }
    /** Installed, but this app is still the old one (the updater couldn't relaunch it). */
    | { phase: "installed" }

/**
 * After this TV asked to install: what the latest status means. Errors reaching the server
 * are expected (the updater closes the app and the network may drop), so they keep the
 * "Installing…" state.
 */
export function watchInstall(state: TVUpdatesState | null | undefined, requestedAt: number): InstallWatch {
    if (!state || state.kind !== "ready") return { phase: "installing" }
    const { installing, lastResult } = state.status
    if (installing) return { phase: "installing" }
    const at = lastResult?.at ? Date.parse(lastResult.at) : NaN
    // A result from before this request (with a little clock skew allowed) isn't ours.
    if (!lastResult || !Number.isFinite(at) || at < requestedAt - 60_000) return { phase: "installing" }
    if (!lastResult.ok) return { phase: "failed", error: lastResult.error ?? "The install failed" }
    return { phase: "installed" }
}

/** Card timing: wait for the remote to be idle before showing, and hide when untouched. */
export const CARD_FIRST_DELAY_MS = 6000
export const CARD_IDLE_MS = 2500
export const CARD_AUTO_HIDE_MS = 12000

/** The card comes up only after the app settled and the user stopped pressing keys for a moment. */
export function cardMayAppear(now: number, eligibleSince: number, lastKeyAt: number): boolean {
    return now - eligibleSince >= CARD_FIRST_DELAY_MS && now - lastKeyAt >= CARD_IDLE_MS
}

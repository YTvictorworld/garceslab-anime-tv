import { buildSeaQuery, type SeaError } from "@/api/client/requests"
import { useServerUrl } from "@/atoms/server.atoms"
import {
    type InstallRequest,
    installErrorMessage,
    parseActionResponse,
    parseTVUpdatesResponse,
    statusPollInterval,
    type TVUpdatesState,
    watchInstall,
} from "@/lib/tv-updates/tv-updates"
import { isTizenDevice } from "@/lib/webos/tizen-platform"
import { toast } from "@/lib/utils/toast"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import * as React from "react"
import { Platform } from "react-native"

// Garceslab Anime: the server's proxy for the self-hoster's TV updater (docs/tv-updates.md).
// These routes aren't in the generated Seanime endpoints.
const TV_UPDATES_ENDPOINTS = {
    status: "/api/v1/tv-updates/status",
    install: "/api/v1/tv-updates/install",
    later: "/api/v1/tv-updates/later",
} as const

const TIMEOUT_MS = 10000
const STALE_MS = 5 * 60 * 1000

/** The updater installs over webOS Developer Mode: only the LG build shows update UI. */
export const TV_UPDATES_SUPPORTED = Platform.OS === "web" && !isTizenDevice()

export type { InstallRequest }

/** Shared by the banner, "See what's new" and Settings → Updates. */
export const tvUpdateInstallAtom = atom<InstallRequest>({ phase: "idle" })

const installRequested = (request: InstallRequest) => request.phase === "sending" || request.phase === "installing"

/**
 * The TV update status, or undefined while unknown. Polled every 30 minutes and when the app
 * comes back to the foreground (visibilitychange), every 5 seconds while an install runs. A
 * server without the endpoint (404) or with no updater configured means "not-configured".
 */
export function useTVUpdates() {
    const serverUrl = useServerUrl()
    const request = useAtomValue(tvUpdateInstallAtom)
    const asked = installRequested(request)
    const query = useQuery<TVUpdatesState>({
        queryKey: ["tv-updates-status", serverUrl],
        enabled: TV_UPDATES_SUPPORTED && !!serverUrl,
        staleTime: STALE_MS,
        retry: false,
        refetchOnWindowFocus: true,
        refetchInterval: q => statusPollInterval(q.state.data, asked),
        // Not while the app is in the background: nothing would show the answer.
        refetchIntervalInBackground: false,
        queryFn: async ({ signal }) => {
            try {
                const data = await buildSeaQuery<unknown>({
                    serverUrl,
                    endpoint: TV_UPDATES_ENDPOINTS.status,
                    method: "GET",
                    muteError: true,
                    timeoutMs: TIMEOUT_MS,
                    signal,
                })
                return parseTVUpdatesResponse(data)
            }
            catch (error) {
                // An older server without the routes: no update UI, no error.
                if ((error as SeaError)?.status === 404) return { kind: "not-configured" }
                throw error
            }
        },
    })
    return query
}

/** Mounted once (the update host): ends "Installing…" when the updater reports a result. */
export function useTVUpdateInstallWatcher(state: TVUpdatesState | undefined) {
    const [request, setRequest] = useAtom(tvUpdateInstallAtom)
    React.useEffect(() => {
        if (request.phase !== "installing") return
        const next = watchInstall(state, request.requestedAt)
        if (next.phase === "failed") setRequest({ phase: "failed", error: next.error })
        else if (next.phase === "installed") setRequest({ phase: "installed" })
    }, [request, setRequest, state])
}

/** Install and "skip this build", plus the watcher that ends the "Installing…" state. */
export function useTVUpdateActions() {
    const serverUrl = useServerUrl()
    const queryClient = useQueryClient()
    const setRequest = useSetAtom(tvUpdateInstallAtom)
    const [skipping, setSkipping] = React.useState(false)

    const refresh = React.useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: ["tv-updates-status"] })
    }, [queryClient])

    const askToInstall = React.useCallback(() => setRequest({ phase: "confirm" }), [setRequest])
    const cancel = React.useCallback(() => setRequest({ phase: "idle" }), [setRequest])

    const install = React.useCallback(() => {
        setRequest({ phase: "sending" })
        const requestedAt = Date.now()
        void buildSeaQuery<unknown>({
            serverUrl,
            endpoint: TV_UPDATES_ENDPOINTS.install,
            method: "POST",
            muteError: true,
            timeoutMs: TIMEOUT_MS,
        })
            .then(data => {
                const result = parseActionResponse(data)
                if (!result.ok) {
                    setRequest({ phase: "failed", error: result.error ?? "Couldn't start the update" })
                    return
                }
                setRequest({ phase: "installing", requestedAt })
                refresh()
            })
            .catch((error: SeaError) => {
                setRequest({ phase: "failed", error: installErrorMessage(error) })
            })
    }, [refresh, serverUrl, setRequest])

    const skipBuild = React.useCallback(() => {
        if (skipping) return
        setSkipping(true)
        void buildSeaQuery<unknown>({
            serverUrl,
            endpoint: TV_UPDATES_ENDPOINTS.later,
            method: "POST",
            muteError: true,
            timeoutMs: TIMEOUT_MS,
        })
            .then(data => {
                const result = parseActionResponse(data)
                if (result.ok) toast.info("This build won't be offered again")
                else toast.error(result.error ?? "Couldn't skip this build")
            })
            .catch((error: SeaError) => toast.error(error?.error || "Couldn't skip this build"))
            .finally(() => {
                setSkipping(false)
                refresh()
            })
    }, [refresh, serverUrl, skipping])

    return { askToInstall, cancel, install, skipBuild, skipping, refresh }
}

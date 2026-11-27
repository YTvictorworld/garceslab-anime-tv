import {
    type InstallRequest,
    TV_UPDATES_SUPPORTED,
    tvUpdateInstallAtom,
    useTVUpdateActions,
    useTVUpdateInstallWatcher,
    useTVUpdates,
} from "@/api/hooks/tv-updates.hooks"
import { getStoredString, setStoredString } from "@/atoms/storage"
import { TVConfirmDrawer } from "@/components/tv/tv-confirm-drawer"
import { TVButton } from "@/components/tv/tv-focus"
import { requestTVFocus } from "@/components/tv/tv-native"
import { tvSize } from "@/components/tv/tv-scale"
import {
    CARD_AUTO_HIDE_MS,
    cardHighlights,
    cardMayAppear,
    cardTitle,
    changeCountsLabel,
    type TVUpdatePending,
    type TVUpdatesState,
    updateCardDecision,
} from "@/lib/tv-updates/tv-updates"
import { focusElement, focusInitial } from "@/lib/webos/spatial-navigation"
import Ionicons from "@expo/vector-icons/Ionicons"
import { router, useSegments } from "expo-router"
import { useAtomValue } from "jotai"
import * as React from "react"
import { ActivityIndicator, BackHandler, Platform, Pressable, Text, TVFocusGuideView, useTVEventHandler, View } from "react-native"

const SEEN_BUILD_KEY = "garceslab-tv-update-card-seen-build"
const CARD_WIDTH = 600
const CARD_MIN_HEIGHT = 300

type ButtonRef = React.ElementRef<typeof Pressable>

/** The element that had focus before the card took it, to give it back afterwards. */
function rememberFocus(): HTMLElement | null {
    if (Platform.OS !== "web") return null
    const active = document.activeElement
    return active instanceof HTMLElement && active !== document.body ? active : null
}

function restoreFocus(previous: HTMLElement | null, card: HTMLElement | null) {
    if (Platform.OS !== "web") return
    // Only when focus is still in the card (or lost with it): the user may have moved on.
    const active = document.activeElement
    if (active && active !== document.body && card && !card.contains(active)) return
    requestAnimationFrame(() => {
        if (previous?.isConnected && focusElement(previous, { reveal: false })) return
        focusInitial()
    })
}

function anotherLayerOpen(): boolean {
    if (Platform.OS !== "web") return false
    if (document.querySelector("[aria-modal=\"true\"]")) return true
    const active = document.activeElement
    return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
}

function useFocusOnMount(ref: React.RefObject<ButtonRef | null>) {
    React.useEffect(() => {
        let inner = 0
        const outer = requestAnimationFrame(() => {
            inner = requestAnimationFrame(() => requestTVFocus(ref.current))
        })
        return () => {
            cancelAnimationFrame(outer)
            if (inner) cancelAnimationFrame(inner)
        }
    }, [ref])
}

function CardFrame({ children, label }: { children: React.ReactNode; label: string }) {
    return (
        <View
            pointerEvents="box-none"
            accessibilityLabel={label}
            style={{
                position: "absolute",
                right: tvSize(64),
                bottom: tvSize(64),
                zIndex: 250,
                width: tvSize(CARD_WIDTH),
                minHeight: tvSize(CARD_MIN_HEIGHT),
                borderRadius: tvSize(20),
                borderWidth: tvSize(2),
                borderColor: "rgba(255,255,255,0.12)",
                backgroundColor: "rgba(14,14,16,0.95)",
                padding: tvSize(24),
            }}
        >
            {children}
        </View>
    )
}

function Kicker({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
    return (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Ionicons name={icon} size={tvSize(22)} color="#c084fc" />
            <Text className="font-bold text-white" style={{ fontSize: tvSize(23), marginLeft: tvSize(10), flexShrink: 1 }} numberOfLines={1}>
                {text}
            </Text>
        </View>
    )
}

/** The buttons: one row, D-pad trapped inside (Back closes the card). Margins: no flex gap on Chromium 79. */
function ButtonRow({ children }: { children: React.ReactNode }) {
    return (
        <TVFocusGuideView
            trapFocusLeft
            trapFocusRight
            trapFocusUp
            trapFocusDown
            style={{ flexDirection: "row", alignItems: "center", marginTop: tvSize(22) }}
        >
            {children}
        </TVFocusGuideView>
    )
}

type OfferProps = {
    pending: TVUpdatePending
    channel: string | null
    onInstall: () => void
    onSeeChanges: () => void
    onLater: () => void
}

/**
 * Garceslab Anime: "New version" card, bottom-right like the player's "Up next" card, fixed
 * width, at most three change lines. Cheap for Chromium 79: no blur, no animation.
 */
export function TVUpdateOfferCard({ pending, channel, onInstall, onSeeChanges, onLater }: OfferProps) {
    const installRef = React.useRef<ButtonRef>(null)
    useFocusOnMount(installRef)
    const title = cardTitle(pending, channel)
    const counts = changeCountsLabel(pending.changes)
    const lines = cardHighlights(pending.changes)

    return (
        <CardFrame label={`${title}. ${counts}`}>
            <Kicker icon="arrow-up-circle" text={title} />
            <Text className="font-semibold text-white/60" style={{ fontSize: tvSize(18), marginTop: tvSize(6) }} numberOfLines={1}>
                {counts}
            </Text>
            <View style={{ marginTop: tvSize(12), minHeight: tvSize(3 * 27) }}>
                {lines.map(line => (
                    <Text key={line} className="text-white/80" style={{ fontSize: tvSize(19), lineHeight: tvSize(27) }} numberOfLines={1}>
                        {`• ${line}`}
                    </Text>
                ))}
            </View>
            <ButtonRow>
                <TVButton ref={installRef} label="Install" variant="primary" size="compact" onPress={onInstall} />
                <View style={{ marginLeft: tvSize(12) }}>
                    <TVButton label="See changes" size="compact" onPress={onSeeChanges} />
                </View>
                <View style={{ marginLeft: tvSize(12) }}>
                    <TVButton label="Later" variant="ghost" size="compact" onPress={onLater} />
                </View>
            </ButtonRow>
        </CardFrame>
    )
}

type ProgressProps = {
    request: InstallRequest
    target: string | null
    waitingForTV: boolean
    onRetry: () => void
    onHide: () => void
}

/** After Install: "Installing… the app will restart", or what went wrong. */
export function TVUpdateProgressCard({ request, target, waitingForTV, onRetry, onHide }: ProgressProps) {
    const buttonRef = React.useRef<ButtonRef>(null)
    useFocusOnMount(buttonRef)
    const failed = request.phase === "failed"
    const installed = request.phase === "installed"
    const title = failed ? "Update not installed" : installed ? "Update installed" : "Installing update…"
    const text = failed
        ? request.error
        : installed
            ? "Close Garceslab Anime and open it again to use the new version."
            : waitingForTV
                ? "Waiting for the updater to reach this TV. Garceslab Anime will close and restart by itself."
                : "Garceslab Anime will close and restart by itself in about a minute. You don't need to do anything."

    return (
        <CardFrame label={`${title}. ${text}`}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
                {failed || installed ? null : <ActivityIndicator size="small" color="#c084fc" style={{ marginRight: tvSize(12) }} />}
                <View style={{ flex: 1 }}>
                    <Kicker icon={failed ? "alert-circle" : "arrow-up-circle"} text={title} />
                </View>
            </View>
            {target ? (
                <Text className="font-semibold text-white/60" style={{ fontSize: tvSize(18), marginTop: tvSize(6) }} numberOfLines={1}>
                    {target}
                </Text>
            ) : null}
            <Text className="text-white/80" style={{ fontSize: tvSize(19), lineHeight: tvSize(27), marginTop: tvSize(12), minHeight: tvSize(3 * 27) }} numberOfLines={3}>
                {text}
            </Text>
            <ButtonRow>
                {failed ? (
                    <>
                        <TVButton ref={buttonRef} label="Try again" variant="primary" size="compact" onPress={onRetry} />
                        <View style={{ marginLeft: tvSize(12) }}>
                            <TVButton label="Close" size="compact" onPress={onHide} />
                        </View>
                    </>
                ) : (
                    <TVButton ref={buttonRef} label={installed ? "OK" : "Hide"} size="compact" onPress={onHide} />
                )}
            </ButtonRow>
        </CardFrame>
    )
}

function readyStatus(state: TVUpdatesState | undefined) {
    return state?.kind === "ready" ? state.status : null
}

/**
 * Mounted once in the app layout (webOS only). Polls the server for TV updates, brings up the
 * card once per pending build (never in the player, never over a drawer or the keyboard, only
 * after the remote was idle for a moment), and shows the install progress wherever it was
 * started (card, "See changes" or Settings).
 */
export function TVUpdateHost() {
    const { data: state } = useTVUpdates()
    useTVUpdateInstallWatcher(state)
    const request = useAtomValue(tvUpdateInstallAtom)
    const actions = useTVUpdateActions()
    const playing = (useSegments() as string[]).includes("player")
    const [seenKey, setSeenKey] = React.useState(() => getStoredString(SEEN_BUILD_KEY) ?? null)
    const [offer, setOffer] = React.useState<TVUpdatePending | null>(null)
    const [progressHidden, setProgressHidden] = React.useState(false)
    const lastKeyAt = React.useRef(0)
    const touched = React.useRef(false)
    const previousFocus = React.useRef<HTMLElement | null>(null)
    const cardRef = React.useRef<React.ComponentRef<typeof View>>(null)

    const installRequested = request.phase === "sending" || request.phase === "installing"
    const decision = updateCardDecision({ state, seenKey, playing, installRequested })
    const decisionKey = decision.show ? decision.key : null
    const status = readyStatus(state)

    useTVEventHandler(() => {
        lastKeyAt.current = Date.now()
        if (offer) touched.current = true
    })

    // Wait for the app to settle and the remote to be idle, then show the card once.
    React.useEffect(() => {
        if (!decisionKey || offer) return
        const eligibleSince = Date.now()
        const timer = setInterval(() => {
            if (!decision.show || anotherLayerOpen()) return
            if (!cardMayAppear(Date.now(), eligibleSince, lastKeyAt.current)) return
            clearInterval(timer)
            previousFocus.current = rememberFocus()
            touched.current = false
            // Shown once per build: remembered as soon as it is on screen.
            setStoredString(SEEN_BUILD_KEY, decisionKey)
            setSeenKey(decisionKey)
            setOffer(decision.pending)
        }, 1000)
        return () => clearInterval(timer)
    }, [decisionKey, offer])

    const closeOffer = React.useCallback((giveFocusBack = true) => {
        const card = cardRef.current as unknown as HTMLElement | null
        setOffer(null)
        if (giveFocusBack) restoreFocus(previousFocus.current, card)
    }, [])

    // Untouched for a while: it goes away by itself.
    React.useEffect(() => {
        if (!offer) return
        const timer = setTimeout(() => {
            if (!touched.current) closeOffer()
        }, CARD_AUTO_HIDE_MS)
        return () => clearTimeout(timer)
    }, [closeOffer, offer])

    // A video started (e.g. from a launch link): the card never stays over the player.
    React.useEffect(() => {
        if (playing && offer) closeOffer(false)
    }, [closeOffer, offer, playing])

    React.useEffect(() => {
        if (installRequested) setProgressHidden(false)
    }, [installRequested])

    // Where focus goes back when the confirmation is cancelled: what had it before the card
    // (Install on the card) or the button that opened it ("See changes", Settings).
    const confirmFocus = React.useRef<HTMLElement | null>(null)
    React.useEffect(() => {
        if (request.phase !== "confirm") return
        const active = rememberFocus()
        const card = cardRef.current as unknown as HTMLElement | null
        confirmFocus.current = active && active.isConnected && !card?.contains(active) ? active : previousFocus.current
    }, [request.phase])

    const showProgress = !progressHidden && !playing && request.phase !== "idle" && request.phase !== "confirm"

    React.useEffect(() => {
        if (!offer && !showProgress) return
        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
            if (offer) closeOffer()
            else setProgressHidden(true)
            return true
        })
        return () => sub.remove()
    }, [closeOffer, offer, showProgress])

    const pending = status?.pending ?? null
    const target = pending ? `${pending.version ? `v${pending.version}` : ""}${pending.shortCommit ? ` (${pending.shortCommit})` : ""}`.trim() : null

    return (
        <>
            {offer ? (
                <View ref={cardRef} pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 250 }}>
                    <TVUpdateOfferCard
                        pending={offer}
                        channel={status?.channel ?? null}
                        onInstall={() => {
                            closeOffer(false)
                            actions.askToInstall()
                        }}
                        onSeeChanges={() => {
                            closeOffer(false)
                            router.push("/(app)/tv-update-changes" as never)
                        }}
                        onLater={() => closeOffer()}
                    />
                </View>
            ) : showProgress ? (
                <View pointerEvents="box-none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 250 }}>
                    <TVUpdateProgressCard
                        request={request}
                        target={target}
                        waitingForTV={status?.installPhase === "waiting-tv"}
                        onRetry={actions.askToInstall}
                        onHide={() => {
                            setProgressHidden(true)
                            if (request.phase === "failed" || request.phase === "installed") actions.cancel()
                            requestAnimationFrame(() => focusInitial())
                        }}
                    />
                </View>
            ) : null}
            <TVConfirmDrawer
                open={request.phase === "confirm"}
                onOpenChange={open => {
                    if (open) return
                    actions.cancel()
                    restoreFocus(confirmFocus.current, null)
                }}
                title="Install the update now?"
                text="Garceslab Anime closes while the update installs and opens again by itself, in about a minute."
                confirmLabel="Install"
                onConfirm={actions.install}
            />
        </>
    )
}

/** The host, only where TV updates exist (the LG webOS build). */
export function TVUpdateHostMount() {
    if (!TV_UPDATES_SUPPORTED) return null
    return <TVUpdateHost />
}

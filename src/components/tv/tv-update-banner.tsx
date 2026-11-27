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
import { TV, tvSize } from "@/components/tv/tv-scale"
import { IMAGES } from "@/constants/images"
import {
    BANNER_TITLE,
    bannerMayAppear,
    pendingSummary,
    type TVUpdatePending,
    updateBannerDecision,
} from "@/lib/tv-updates/tv-updates"
import { focusElement, focusInitial, moveFocus } from "@/lib/webos/spatial-navigation"
import { Image } from "expo-image"
import { router, useSegments } from "expo-router"
import { useAtomValue } from "jotai"
import * as React from "react"
import { ActivityIndicator, BackHandler, Platform, Pressable, Text, TVFocusGuideView, useTVEventHandler, View } from "react-native"

// Garceslab Anime: the TV update notice (docs/tv-updates.md). A slim banner under the navigation
// bar, in the app's lilac, that pushes the tab's content down instead of covering it.

const SEEN_BUILD_KEY = "garceslab-tv-update-seen-build"
export const BRAND = "#a443cf"
const BRAND_SOFT = "#e6b0fd"
/** Space between the navigation bar, the banner and the content. */
const GAP = 14

/** The GA mark in a lilac tile, shared with See changes. */
export function TVUpdateMark({ size = 52 }: { size?: number }) {
    return (
        <View
            style={{
                width: tvSize(size),
                height: tvSize(size),
                borderRadius: tvSize(size * 0.26),
                backgroundColor: "rgba(164,67,207,0.22)",
                borderWidth: tvSize(1),
                borderColor: "rgba(230,176,253,0.35)",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
            }}
        >
            <Image source={IMAGES.logo2} style={{ width: tvSize(size * 0.62), height: tvSize(size * 0.62) }} contentFit="contain" accessibilityLabel="Garceslab Anime" />
        </View>
    )
}

type BannerView = {
    title: string
    /** Only when there is something to say; the banner shrinks without it. */
    detail: string | null
    busy?: boolean
    actions: Array<{ label: string; primary?: boolean; onPress: () => void }>
}

function bannerView(
    offer: TVUpdatePending | null,
    request: InstallRequest,
    handlers: { seeChanges: () => void; later: () => void; retry: () => void; hideProgress: () => void },
): BannerView | null {
    switch (request.phase) {
        case "sending":
        case "installing":
            return {
                title: "Installing the update…",
                detail: "Garceslab Anime will close and open again by itself in about a minute.",
                busy: true,
                actions: [{ label: "Hide", onPress: handlers.hideProgress }],
            }
        case "failed":
            return {
                title: "The update wasn't installed",
                detail: request.error,
                actions: [{ label: "Try again", primary: true, onPress: handlers.retry }, { label: "Close", onPress: handlers.hideProgress }],
            }
        case "installed":
            return {
                title: "The update is installed",
                detail: "Close Garceslab Anime and open it again to use the new version.",
                actions: [{ label: "OK", onPress: handlers.hideProgress }],
            }
        default:
            if (!offer) return null
            return {
                title: BANNER_TITLE,
                detail: pendingSummary(offer),
                actions: [{ label: "See what's new", primary: true, onPress: handlers.seeChanges }, { label: "Later", onPress: handlers.later }],
            }
    }
}

function Banner({ view, onLayout, nodeRef }: { view: BannerView; onLayout: (height: number) => void; nodeRef: React.RefObject<React.ComponentRef<typeof View> | null> }) {
    // The whole banner is a focus region leading to its first button: Down from the navigation
    // bar or Up from the screen reaches it wherever the focused control is (spatial-navigation.ts).
    const [firstButton, setFirstButton] = React.useState<React.ElementRef<typeof Pressable> | null>(null)
    return (
        <View
            ref={nodeRef}
            onLayout={event => onLayout(event.nativeEvent.layout.height)}
            accessibilityLabel={view.detail ? `${view.title}. ${view.detail}` : view.title}
            style={{
                position: "absolute",
                top: TV.navTop + TV.navHeight + tvSize(GAP),
                left: TV.gutter,
                right: TV.gutter,
                // Under the navigation bar (200) and its drawers.
                zIndex: 150,
                borderRadius: tvSize(18),
                borderWidth: tvSize(1),
                borderColor: "rgba(164,67,207,0.55)",
                borderLeftWidth: tvSize(6),
                borderLeftColor: BRAND,
                // Opaque: no text of the screen shows through. No blur or shadow (Chromium 79).
                backgroundColor: "#1d1224",
            }}
        >
            <TVFocusGuideView
                destinations={firstButton ? [firstButton] : undefined}
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: tvSize(14),
                    paddingLeft: tvSize(16),
                    paddingRight: tvSize(14),
                }}
            >
                {view.busy ? (
                    <View style={{ width: tvSize(52), height: tvSize(52), alignItems: "center", justifyContent: "center" }}>
                        <ActivityIndicator size="small" color={BRAND_SOFT} />
                    </View>
                ) : (
                    <TVUpdateMark />
                )}
                <View style={{ flex: 1, minWidth: 0, marginLeft: tvSize(18), marginRight: tvSize(18) }}>
                    <Text className="font-bold text-white" style={{ fontSize: tvSize(23), lineHeight: tvSize(30) }} numberOfLines={1}>
                        {view.title}
                    </Text>
                    {view.detail ? (
                        <Text style={{ fontSize: tvSize(18), lineHeight: tvSize(25), color: BRAND_SOFT, marginTop: tvSize(2) }} numberOfLines={2}>
                            {view.detail}
                        </Text>
                    ) : null}
                </View>
                {/* Margins, not gap: webOS 6 (Chromium 79) has no flexbox gap. */}
                <TVFocusGuideView trapFocusLeft trapFocusRight style={{ flexDirection: "row", alignItems: "center", flexShrink: 0 }}>
                    {view.actions.map((action, index) => (
                        <View key={action.label} style={{ marginLeft: index ? tvSize(12) : 0 }}>
                            <TVButton
                                ref={index === 0 ? setFirstButton : undefined}
                                label={action.label}
                                variant={action.primary ? "primary" : "secondary"}
                                size="compact"
                                onPress={action.onPress}
                            />
                        </View>
                    ))}
                </TVFocusGuideView>
            </TVFocusGuideView>
        </View>
    )
}

/**
 * The update banner of the tab screens (rendered by the TV tabs layout). Returns how far the
 * content has to move down (0 when there is no banner) and the banner itself. Rules:
 * - once per pending build (remembered on the TV as soon as it is shown), only on a tab screen,
 *   never in the player, and only after the app settled and the remote was idle for a moment;
 * - it doesn't take focus: Down from the navigation bar or Up from the content reaches it;
 *   Back while it has focus, or Later, hides it on this TV (Settings → Updates keeps the build);
 * - after Install (from See changes or Settings) it shows the progress instead.
 */
export function useTVUpdateBanner(): { offset: number; banner: React.ReactNode } {
    const enabled = TV_UPDATES_SUPPORTED
    const { data: state } = useTVUpdates()
    const request = useAtomValue(tvUpdateInstallAtom)
    const actions = useTVUpdateActions()
    const segments = useSegments() as string[]
    const playing = segments.includes("player")
    const onTab = segments[1] === "(tabs)"
    const [seenKey, setSeenKey] = React.useState(() => (enabled ? getStoredString(SEEN_BUILD_KEY) ?? null : null))
    const [offer, setOffer] = React.useState<TVUpdatePending | null>(null)
    const [progressHidden, setProgressHidden] = React.useState(false)
    const [height, setHeight] = React.useState(0)
    const lastKeyAt = React.useRef(0)
    const nodeRef = React.useRef<React.ComponentRef<typeof View>>(null)

    const installRequested = request.phase === "sending" || request.phase === "installing"
    const decision = updateBannerDecision({ state, seenKey, playing, installRequested })
    const decisionKey = enabled && decision.show ? decision.key : null

    useTVEventHandler(() => {
        lastKeyAt.current = Date.now()
    })

    // The banner pushes the screen down: it waits for a calm moment on a tab screen.
    const onTabRef = React.useRef(onTab)
    onTabRef.current = onTab
    React.useEffect(() => {
        if (!decisionKey || offer || !decision.show) return
        const pending = decision.pending
        const eligibleSince = Date.now()
        const timer = setInterval(() => {
            if (!onTabRef.current) return
            if (!bannerMayAppear(Date.now(), eligibleSince, lastKeyAt.current)) return
            clearInterval(timer)
            setStoredString(SEEN_BUILD_KEY, decisionKey)
            setSeenKey(decisionKey)
            setOffer(pending)
        }, 1000)
        return () => clearInterval(timer)
    }, [decisionKey, offer])

    React.useEffect(() => {
        if (installRequested) {
            setProgressHidden(false)
            setOffer(null)
        }
    }, [installRequested])

    const focusInBanner = React.useCallback(() => {
        if (Platform.OS !== "web") return false
        const node = nodeRef.current as unknown as HTMLElement | null
        return !!node && node.contains(document.activeElement)
    }, [])

    /** Focus leaves with the banner: one step down, to the screen under it. */
    const moveFocusOut = React.useCallback(() => {
        if (!focusInBanner()) return
        if (!moveFocus("down", { reveal: false })) focusInitial()
    }, [focusInBanner])

    const closeOffer = React.useCallback(() => {
        moveFocusOut()
        setOffer(null)
    }, [moveFocusOut])

    const hideProgress = React.useCallback(() => {
        moveFocusOut()
        setProgressHidden(true)
        if (request.phase === "failed" || request.phase === "installed") actions.cancel()
    }, [actions, moveFocusOut, request.phase])

    const showProgress = !progressHidden && request.phase !== "idle" && request.phase !== "confirm"
    const view = !enabled || playing
        ? null
        : bannerView(offer, showProgress ? request : { phase: "idle" }, {
            seeChanges: () => {
                setOffer(null)
                router.push("/(app)/tv-update-changes" as never)
            },
            later: closeOffer,
            retry: actions.askToInstall,
            hideProgress,
        })

    React.useEffect(() => {
        if (!view) return
        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
            if (!focusInBanner()) return false
            if (offer) closeOffer()
            else hideProgress()
            return true
        })
        return () => sub.remove()
    }, [closeOffer, focusInBanner, hideProgress, offer, view])

    React.useEffect(() => {
        if (!view) setHeight(0)
    }, [view])

    return {
        offset: view && height ? height + tvSize(GAP) : 0,
        banner: view ? <Banner view={view} onLayout={setHeight} nodeRef={nodeRef} /> : null,
    }
}

/**
 * Mounted once in the app layout (webOS only): the status query, the watcher that ends
 * "Installing…", and the install confirmation used by See changes and Settings.
 */
function TVUpdateHost() {
    const { data: state } = useTVUpdates()
    useTVUpdateInstallWatcher(state)
    const request = useAtomValue(tvUpdateInstallAtom)
    const actions = useTVUpdateActions()

    // Where focus goes back when the confirmation is cancelled: the button that opened it.
    const confirmFocus = React.useRef<HTMLElement | null>(null)
    React.useEffect(() => {
        if (request.phase !== "confirm" || Platform.OS !== "web") return
        const active = document.activeElement
        confirmFocus.current = active instanceof HTMLElement && active !== document.body ? active : null
    }, [request.phase])

    return (
        <TVConfirmDrawer
            open={request.phase === "confirm"}
            onOpenChange={open => {
                if (open) return
                actions.cancel()
                const previous = confirmFocus.current
                if (Platform.OS === "web") {
                    requestAnimationFrame(() => {
                        if (previous?.isConnected && focusElement(previous, { reveal: false })) return
                        focusInitial()
                    })
                }
            }}
            title="Install the update now?"
            text="Garceslab Anime closes while the update installs and opens again by itself, in about a minute."
            confirmLabel="Install"
            onConfirm={actions.install}
        />
    )
}

/** The host, only where TV updates exist (the LG webOS build). */
export function TVUpdateHostMount() {
    if (!TV_UPDATES_SUPPORTED) return null
    return <TVUpdateHost />
}

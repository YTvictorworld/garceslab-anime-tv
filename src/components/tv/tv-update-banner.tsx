import {
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
    type BannerAction,
    type BannerContent,
    bannerAllowedOn,
    bannerContent,
    bannerMayAppear,
    type TVUpdatePending,
    updateBannerDecision,
} from "@/lib/tv-updates/tv-updates"
import { focusElement, focusInitial, moveFocus } from "@/lib/webos/spatial-navigation"
import { Image } from "expo-image"
import { router, useSegments } from "expo-router"
import { useAtomValue } from "jotai"
import * as React from "react"
import { ActivityIndicator, BackHandler, Platform, Pressable, Text, TVFocusGuideView, useTVEventHandler, View } from "react-native"

// Garceslab Anime: the TV update notice (docs/tv-updates.md). A compact lilac panel at the top
// right, under the navigation bar, over the hero's artwork; it covers no text and moves nothing.

const SEEN_BUILD_KEY = "garceslab-tv-update-seen-build"
export const BRAND = "#a443cf"
const BRAND_SOFT = "#e6b0fd"
/** Space between the navigation bar and the banner. */
const GAP = 14
/** About 27 % of a 1920 px screen: the hero's title and description end well before it. */
const WIDTH = 520

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

const ACTION_LABELS: Record<BannerAction, string> = {
    "install": "Install",
    "see-changes": "See what's new",
    "later": "Later",
    "hide": "Hide",
    "retry": "Try again",
    "close": "Close",
    "ok": "OK",
}

const PRIMARY_ACTIONS = new Set<BannerAction>(["install", "retry"])

type BannerProps = {
    content: BannerContent
    onAction: (action: BannerAction) => void
    nodeRef: React.RefObject<React.ComponentRef<typeof View> | null>
}

/**
 * A compact panel at the top right, under the navigation bar, over the hero's artwork (the
 * hero's text and buttons are on the left, the rows start lower). Fixed width, height from its
 * content; it floats and moves nothing.
 */
function Banner({ content, onAction, nodeRef }: BannerProps) {
    // The whole panel is a focus region leading to its first button (Install): the D-pad enters
    // it from any side (spatial-navigation.ts).
    const [firstButton, setFirstButton] = React.useState<React.ElementRef<typeof Pressable> | null>(null)
    return (
        <View
            ref={nodeRef}
            accessibilityLabel={content.detail ? `${content.title}. ${content.detail}` : content.title}
            style={{
                position: "absolute",
                top: TV.navTop + TV.navHeight + tvSize(GAP),
                right: TV.gutter,
                width: tvSize(WIDTH),
                // Under the navigation bar (200) and its drawers.
                zIndex: 150,
                borderRadius: tvSize(18),
                borderWidth: tvSize(1),
                borderColor: "rgba(164,67,207,0.55)",
                borderTopWidth: tvSize(5),
                borderTopColor: BRAND,
                // Opaque: no artwork shows through the text. No blur or shadow (Chromium 79).
                backgroundColor: "#1d1224",
            }}
        >
            <TVFocusGuideView
                destinations={firstButton ? [firstButton] : undefined}
                style={{ padding: tvSize(18) }}
            >
                <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                    {content.busy ? (
                        <View style={{ width: tvSize(44), height: tvSize(44), alignItems: "center", justifyContent: "center" }}>
                            <ActivityIndicator size="small" color={BRAND_SOFT} />
                        </View>
                    ) : (
                        <TVUpdateMark size={44} />
                    )}
                    <View style={{ flex: 1, minWidth: 0, marginLeft: tvSize(14) }}>
                        <Text className="font-bold text-white" style={{ fontSize: tvSize(21), lineHeight: tvSize(27) }} numberOfLines={2}>
                            {content.title}
                        </Text>
                        {content.detail ? (
                            <Text style={{ fontSize: tvSize(17), lineHeight: tvSize(23), color: BRAND_SOFT, marginTop: tvSize(3) }} numberOfLines={2}>
                                {content.detail}
                            </Text>
                        ) : null}
                    </View>
                </View>
                {/* Margins, not gap: webOS 6 (Chromium 79) has no flexbox gap. */}
                <TVFocusGuideView trapFocusLeft trapFocusRight style={{ flexDirection: "row", alignItems: "center", marginTop: tvSize(14) }}>
                    {content.actions.map((action, index) => (
                        <View key={action} style={{ marginLeft: index ? tvSize(10) : 0 }}>
                            <TVButton
                                ref={index === 0 ? setFirstButton : undefined}
                                label={ACTION_LABELS[action]}
                                variant={PRIMARY_ACTIONS.has(action) ? "primary" : "secondary"}
                                size="compact"
                                onPress={() => onAction(action)}
                            />
                        </View>
                    ))}
                </TVFocusGuideView>
            </TVFocusGuideView>
        </View>
    )
}

/**
 * The update banner of the tab screens (rendered by the TV tabs layout). Rules:
 * - once per pending build (remembered on the TV as soon as it is shown), only on Anime, Discover
 *   and Settings (bannerAllowedOn; elsewhere it waits), never in the player, and only after the
 *   app settled and the remote was idle for a moment;
 * - it doesn't take focus; the D-pad reaches it (Install first). Back while it has focus, or
 *   Later, hides it on this TV (Settings → Updates keeps the build);
 * - Install asks to confirm (Cancel leaves the banner as it was); after Install, from here,
 *   See what's new or Settings, it shows the progress instead.
 */
export function useTVUpdateBanner(): React.ReactNode {
    const enabled = TV_UPDATES_SUPPORTED
    const { data: state } = useTVUpdates()
    const request = useAtomValue(tvUpdateInstallAtom)
    const actions = useTVUpdateActions()
    const segments = useSegments() as string[]
    const playing = segments.includes("player")
    const onTab = bannerAllowedOn(segments)
    const [seenKey, setSeenKey] = React.useState(() => (enabled ? getStoredString(SEEN_BUILD_KEY) ?? null : null))
    const [offer, setOffer] = React.useState<TVUpdatePending | null>(null)
    const [progressHidden, setProgressHidden] = React.useState(false)
    const lastKeyAt = React.useRef(0)
    const nodeRef = React.useRef<React.ComponentRef<typeof View>>(null)

    const installRequested = request.phase === "sending" || request.phase === "installing"
    const decision = updateBannerDecision({ state, seenKey, playing, installRequested })
    const decisionKey = enabled && decision.show ? decision.key : null

    useTVEventHandler(() => {
        lastKeyAt.current = Date.now()
    })

    // It comes in at a calm moment on a screen with room for it, not while the user goes through a row.
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

    const onAction = React.useCallback((action: BannerAction) => {
        switch (action) {
            case "install":
            case "retry":
                actions.askToInstall()
                return
            case "see-changes":
                setOffer(null)
                router.push("/(app)/tv-update-changes" as never)
                return
            case "later":
                closeOffer()
                return
            default:
                hideProgress()
        }
    }, [actions, closeOffer, hideProgress])

    const showProgress = !progressHidden && request.phase !== "idle" && request.phase !== "confirm"
    const content = !enabled || playing || !onTab ? null : bannerContent(offer, showProgress ? request : { phase: "idle" })

    React.useEffect(() => {
        if (!content) return
        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
            if (!focusInBanner()) return false
            if (offer) closeOffer()
            else hideProgress()
            return true
        })
        return () => sub.remove()
    }, [closeOffer, content, focusInBanner, hideProgress, offer])

    return content ? <Banner content={content} onAction={onAction} nodeRef={nodeRef} /> : null
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

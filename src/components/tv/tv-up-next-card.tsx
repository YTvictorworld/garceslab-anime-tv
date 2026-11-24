import { TVEpisodeTagPill } from "@/components/tv/tv-episode-tag-pill"
import { TVButton, TVFocusScaleView, useTVFocus } from "@/components/tv/tv-focus"
import { requestTVFocus } from "@/components/tv/tv-native"
import { tvSize } from "@/components/tv/tv-scale"
import { EPISODE_TAG_SPOKEN, type EpisodeTagKind } from "@/lib/episode-tags/episode-tags"
import { Image } from "expo-image"
import * as React from "react"
import { Platform, Pressable, Text, TVFocusGuideView, View } from "react-native"

type Props = {
    /** Small line on top: "Next episode". */
    kicker: string
    /** "Episode 34 · The title". */
    title: string
    tag?: EpisodeTagKind
    /** A line under the title: what is skipped, or the prompt's question. */
    note?: string
    image?: string
    confirmLabel: string
    cancelLabel: string
    /** The primary button fills up over the countdown; without it, it's a plain button. */
    countdown?: { remaining: number; total: number }
    onConfirm: () => void
    onCancel: () => void
}

const CARD_WIDTH = 580
const THUMB_WIDTH = 176
const BRAND = "#a443cf"

/**
 * Garceslab Anime: the player's "Up next" card, Netflix-style: compact, in
 * the bottom-right corner, with the video still playing and visible behind it
 * (no dimming). The primary button fills up over the countdown. Kept cheap
 * for Chromium 79: no blur or large shadows, and the fill is one transform
 * animation on the compositor.
 */
export function TVUpNextCard({
    kicker,
    title,
    tag,
    note,
    image,
    confirmLabel,
    cancelLabel,
    countdown,
    onConfirm,
    onCancel,
}: Props) {
    const confirmRef = React.useRef<React.ElementRef<typeof Pressable>>(null)

    React.useEffect(() => {
        let innerFrame = 0
        const outerFrame = requestAnimationFrame(() => {
            innerFrame = requestAnimationFrame(() => {
                requestTVFocus(confirmRef.current)
            })
        })
        return () => {
            cancelAnimationFrame(outerFrame)
            if (innerFrame) cancelAnimationFrame(innerFrame)
        }
    }, [])

    return (
        <View
            pointerEvents="box-none"
            style={{
                position: "absolute",
                right: tvSize(64),
                bottom: tvSize(64),
                zIndex: 200,
                width: tvSize(CARD_WIDTH),
                borderRadius: tvSize(20),
                borderWidth: tvSize(2),
                borderColor: "rgba(255,255,255,0.12)",
                backgroundColor: "rgba(14,14,16,0.92)",
                padding: tvSize(20),
            }}
        >
            <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                <View
                    style={{
                        width: tvSize(THUMB_WIDTH),
                        height: tvSize(THUMB_WIDTH * 9 / 16),
                        borderRadius: tvSize(10),
                        overflow: "hidden",
                        backgroundColor: "rgba(255,255,255,0.08)",
                        marginRight: tvSize(18),
                        flexShrink: 0,
                    }}
                >
                    {image ? (
                        <Image source={{ uri: image }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={150} />
                    ) : null}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text className="font-bold text-white/55" style={{ fontSize: tvSize(16), letterSpacing: tvSize(0.6) }} numberOfLines={1}>
                        {kicker}
                    </Text>
                    <Text
                        className="font-bold text-white"
                        style={{ fontSize: tvSize(23), lineHeight: tvSize(30), marginTop: tvSize(4) }}
                        numberOfLines={2}
                        accessibilityLabel={tag ? `${title}, ${EPISODE_TAG_SPOKEN[tag]}` : undefined}
                    >
                        {title}
                    </Text>
                    {tag ? <TVEpisodeTagPill kind={tag} size={15} style={{ marginTop: tvSize(8) }} /> : null}
                </View>
            </View>
            {note ? (
                <Text className="text-white/65" style={{ fontSize: tvSize(18), lineHeight: tvSize(25), marginTop: tvSize(14) }} numberOfLines={3}>
                    {note}
                </Text>
            ) : null}

            {/* Margins, not gap: webOS 6 (Chromium 79) has no flexbox gap. */}
            <TVFocusGuideView
                trapFocusLeft
                trapFocusRight
                trapFocusUp
                trapFocusDown
                style={{ flexDirection: "row", alignItems: "center", marginTop: tvSize(18) }}
            >
                <CountdownButton ref={confirmRef} label={confirmLabel} countdown={countdown} onPress={onConfirm} />
                <View style={{ marginLeft: tvSize(14) }}>
                    <TVButton label={cancelLabel} size="compact" onPress={onCancel} />
                </View>
            </TVFocusGuideView>
        </View>
    )
}

type CountdownButtonProps = {
    label: string
    countdown?: { remaining: number; total: number }
    onPress: () => void
}

/** The primary button; with a countdown its background fills from the left until it plays. */
const CountdownButton = React.forwardRef<React.ElementRef<typeof Pressable>, CountdownButtonProps>(
    ({ label, countdown, onPress }, ref) => {
        const focus = useTVFocus(1.04, label)
        const fillRef = React.useRef<React.ComponentRef<typeof View>>(null)
        const total = countdown?.total ?? 0
        // Where the fill starts; read once per countdown so the animation isn't restarted every second.
        const startRemaining = React.useRef(countdown?.remaining ?? 0)
        if (!countdown) startRemaining.current = 0

        React.useEffect(() => {
            if (!total || Platform.OS !== "web") return
            const node = fillRef.current as unknown as HTMLElement | null
            if (typeof node?.animate !== "function") return
            const done = 1 - startRemaining.current / total
            // One compositor animation for the whole countdown (+1 s: the last tick plays at zero).
            const animation = node.animate(
                [{ transform: `scaleX(${done})` }, { transform: "scaleX(1)" }],
                { duration: (startRemaining.current + 1) * 1000, easing: "linear", fill: "forwards" },
            )
            return () => animation.cancel()
        }, [total])

        // Other platforms step the fill once a second.
        const stepped = countdown && countdown.total > 0 ? 1 - countdown.remaining / countdown.total : 0

        return (
            <Pressable
                ref={ref}
                onPress={onPress}
                onFocus={focus.focus}
                onBlur={focus.blur}
                accessibilityRole="button"
                accessibilityLabel={countdown ? `${label}, playing in ${countdown.remaining} seconds` : label}
                style={{ flexShrink: 0 }}
            >
                <TVFocusScaleView
                    style={[
                        focus.style,
                        {
                            minHeight: tvSize(56),
                            minWidth: tvSize(200),
                            paddingHorizontal: tvSize(24),
                            borderRadius: tvSize(99),
                            borderWidth: tvSize(2),
                            borderColor: focus.focused ? "#ffffff" : "transparent",
                            backgroundColor: countdown ? "rgba(164,67,207,0.38)" : BRAND,
                            overflow: "hidden",
                            alignItems: "center",
                            justifyContent: "center",
                        },
                    ]}
                >
                    {countdown ? (
                        <View
                            ref={fillRef}
                            pointerEvents="none"
                            style={{
                                position: "absolute",
                                top: 0,
                                bottom: 0,
                                left: 0,
                                right: 0,
                                backgroundColor: BRAND,
                                transformOrigin: "left center",
                                transform: [{ scaleX: Platform.OS === "web" ? 1 - startRemaining.current / (total || 1) : stepped }],
                            }}
                        />
                    ) : null}
                    <Text className="font-bold text-white" style={{ fontSize: tvSize(20) }} numberOfLines={1}>
                        {label}
                    </Text>
                </TVFocusScaleView>
            </Pressable>
        )
    },
)

CountdownButton.displayName = "CountdownButton"

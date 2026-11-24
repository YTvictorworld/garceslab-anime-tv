import type { Anime_Episode } from "@/api/generated/types"
import { TVFocusScaleView, usePreferredFocus, useTVFocus } from "@/components/tv/tv-focus"
import { TVLazyImage } from "@/components/tv/tv-lazy-image"
import { TV, tvSize } from "@/components/tv/tv-scale"
import { EPISODE_TAG_LABELS, EPISODE_TAG_SPOKEN, EPISODE_TAG_STYLE, type EpisodeTagKind } from "@/lib/episode-tags/episode-tags"
import { LinearGradient } from "expo-linear-gradient"
import { Ionicons } from "@/lib/icons/Ionicons"
import { TV_VISUAL } from "@/lib/tv/visual-flags"
import * as React from "react"
import { ActivityIndicator, Platform, Pressable, type PressableProps, Text, View } from "react-native"

/**
 * webOS: expo-image's `blurRadius` becomes a CSS `filter: blur()`, which the
 * TV redraws whenever the card scales or scrolls. A blurred card shows
 * `blurredImage` (art that gives nothing away) dimmed instead, or nothing.
 */
const CSS_BLUR = Platform.OS === "web"

/** cardGradients: the web's episode gradient, plus a short top shade behind the corner chips. */
const BOTTOM_COLORS = TV_VISUAL.cardGradients
    ? ["transparent", "rgba(12,12,12,0.5)", "rgba(12,12,12,0.94)"] as const
    : ["transparent", "rgba(0,0,0,0.78)"] as const
const BOTTOM_LOCATIONS = TV_VISUAL.cardGradients ? [0.3, 0.66, 1] as const : [0.42, 1] as const
const TOP_COLORS = ["rgba(12,12,12,0.42)", "transparent"] as const

export interface TVEpisodeCardProps extends Omit<PressableProps, "onPress"> {
    image?: string
    duration?: number
    badge?: string
    title: string
    subtitle?: string
    onPress?: () => void
    /**
     * Called with `episode`. Lists pass one handler for every card instead of
     * a new closure per card, so React.memo skips cards that didn't change.
     */
    onPressEpisode?: (episode: Anime_Episode) => void
    episode?: Anime_Episode
    preferred?: boolean
    recyclingKey?: string
    progressPercent?: number
    completed?: boolean
    filler?: boolean
    blurred?: boolean
    /** webOS: shown dimmed in place of a blurred `image` (see CSS_BLUR). */
    blurredImage?: string
    /** A chip in the corner ("Upcoming"); the art is dimmed while `dimmed`. */
    tag?: { label: string; icon: React.ComponentProps<typeof Ionicons>["name"]; dimmed?: boolean }
    /** Covers the art: a stream starting for this card (with a spinner) or why it failed. */
    status?: TVEpisodeCardStatus
    /**
     * Garceslab Anime: a CANON / FILLER / RECAP / MIX pill in the top-right
     * corner (see useEpisodeTags). Replaces the `filler` chip when set.
     */
    episodeTag?: EpisodeTagKind
}

export type TVEpisodeCardStatus = {
    message: string
    /** What the remote does now ("Back to cancel"). */
    hint?: string
    error?: boolean
}

export const TVEpisodeCard = React.memo(
    React.forwardRef<React.ElementRef<typeof Pressable>, TVEpisodeCardProps>(
        function TVEpisodeCard({
            image,
            duration,
            badge,
            title,
            subtitle,
            onPress,
            onPressEpisode,
            episode,
            preferred,
            recyclingKey,
            progressPercent,
            completed,
            filler,
            blurred,
            blurredImage,
            tag,
            status,
            episodeTag,
            ...props
        }, ref) {
            const focus = useTVFocus(1.05, title)
            const isPreferred = usePreferredFocus(preferred)
            const width = tvSize(410)
            const imageHeight = tvSize(225)
            const handlePress = onPress ?? (() => {
                if (episode) onPressEpisode?.(episode)
            })
            const cssBlur = CSS_BLUR && !!blurred
            const shownImage = cssBlur ? blurredImage : image

            return (
                <Pressable
                    ref={ref}
                    onPress={handlePress}
                    onFocus={focus.focus}
                    onBlur={focus.blur}
                    hasTVPreferredFocus={isPreferred}
                    scrollSnapAlign="start"
                    accessibilityRole="button"
                    accessibilityLabel={`${title}${subtitle ? `, ${subtitle}` : ""}${episodeTag ? `, ${EPISODE_TAG_SPOKEN[episodeTag]}` : ""}${status ? `, ${status.message}${status.hint ? `. ${status.hint}` : ""}` : ""}`}
                    style={{ width }}
                    {...props}
                >
                    <TVFocusScaleView style={focus.style}>
                        <View
                            style={{
                                width,
                                height: imageHeight,
                                overflow: "hidden",
                                borderRadius: TV.radius,
                                borderWidth: TV.focusBorder,
                                borderColor: focus.focused ? "#fff" : "transparent",
                                backgroundColor: cssBlur ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.0)",
                            }}
                        >
                            <TVLazyImage
                                source={shownImage ? { uri: shownImage } : undefined}
                                style={{ width: "100%", height: "100%" }}
                                contentFit="cover"
                                cachePolicy="memory-disk"
                                recyclingKey={recyclingKey}
                                transition={100}
                                blurRadius={blurred && !cssBlur ? tvSize(18) : 0}
                            />
                            {cssBlur && shownImage ? (
                                <View
                                    pointerEvents="none"
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        backgroundColor: "rgba(10,10,10,0.78)",
                                    }}
                                />
                            ) : null}
                            {completed || tag?.dimmed ? (
                                <View
                                    pointerEvents="none"
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        backgroundColor: "rgba(0,0,0,0.6)",
                                    }}
                                />
                            ) : null}
                            <LinearGradient
                                colors={BOTTOM_COLORS}
                                locations={BOTTOM_LOCATIONS}
                                style={{ position: "absolute", inset: 0 }}
                                pointerEvents="none"
                            />
                            {TV_VISUAL.cardGradients ? (
                                <LinearGradient
                                    colors={TOP_COLORS}
                                    style={{ position: "absolute", left: 0, right: 0, top: 0, height: "32%" }}
                                    pointerEvents="none"
                                />
                            ) : null}
                            {completed ? (
                                <View
                                    style={{
                                        position: "absolute",
                                        top: tvSize(12),
                                        left: tvSize(12),
                                        minHeight: tvSize(30),
                                        borderRadius: tvSize(16),
                                        paddingHorizontal: tvSize(10),
                                        backgroundColor: "rgba(20,20,20,0.78)",
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: tvSize(5),
                                    }}
                                >
                                    <Ionicons name="checkmark" size={tvSize(15)} color="#ffffff" />
                                    <Text className="font-semibold text-white" style={{ fontSize: tvSize(15) }}>
                                        Completed
                                    </Text>
                                </View>
                            ) : tag ? (
                                <View
                                    style={{
                                        position: "absolute",
                                        top: tvSize(12),
                                        left: tvSize(12),
                                        minHeight: tvSize(30),
                                        borderRadius: tvSize(16),
                                        paddingHorizontal: tvSize(10),
                                        backgroundColor: "rgba(164,67,207,0.9)",
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: tvSize(5),
                                    }}
                                >
                                    <Ionicons name={tag.icon} size={tvSize(15)} color="#ffffff" />
                                    <Text className="font-semibold text-white" style={{ fontSize: tvSize(15) }}>
                                        {tag.label}
                                    </Text>
                                </View>
                            ) : filler && !episodeTag ? (
                                <View
                                    style={{
                                        position: "absolute",
                                        top: tvSize(12),
                                        left: tvSize(12),
                                        borderRadius: tvSize(7),
                                        paddingHorizontal: tvSize(9),
                                        paddingVertical: tvSize(5),
                                        backgroundColor: "rgba(234,179,8,0.9)",
                                    }}
                                >
                                    <Text className="font-bold text-black" style={{ fontSize: tvSize(14) }}>
                                        FILLER
                                    </Text>
                                </View>
                            ) : null}
                            {episodeTag ? <TVEpisodeTagPill kind={episodeTag} /> : null}
                            <View
                                style={{
                                    position: "absolute",
                                    left: tvSize(14),
                                    right: tvSize(14),
                                    bottom: tvSize(12),
                                    flexDirection: "row",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                }}
                            >
                                <Text className="font-semibold text-white" style={{ fontSize: tvSize(20) }}>
                                    {badge}
                                </Text>
                                {duration ? (
                                    <Text className="text-white/80" style={{ fontSize: tvSize(17) }}>
                                        {duration}m
                                    </Text>
                                ) : null}
                            </View>
                            {status ? (
                                <View
                                    accessibilityLiveRegion="polite"
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: tvSize(10),
                                        paddingHorizontal: tvSize(20),
                                        backgroundColor: status.error ? "rgba(40,8,8,0.86)" : "rgba(8,8,16,0.82)",
                                    }}
                                >
                                    {status.error
                                        ? <Ionicons name="alert-circle-outline" size={tvSize(34)} color="#f87171" />
                                        : <ActivityIndicator size={tvSize(40)} color="#e6b0fd" />}
                                    <Text
                                        className="font-semibold text-white"
                                        numberOfLines={2}
                                        style={{ fontSize: tvSize(19), textAlign: "center" }}
                                    >
                                        {status.message}
                                    </Text>
                                    {status.hint ? (
                                        <Text className="text-white/60" numberOfLines={1} style={{ fontSize: tvSize(15) }}>
                                            {status.hint}
                                        </Text>
                                    ) : null}
                                </View>
                            ) : null}
                            {progressPercent !== undefined && progressPercent > 0 && !completed && !status ? (
                                <View
                                    style={{
                                        position: "absolute",
                                        left: 0,
                                        right: 0,
                                        bottom: 0,
                                        height: tvSize(5),
                                        backgroundColor: "rgba(255,255,255,0.12)",
                                    }}
                                >
                                    <View
                                        style={{
                                            width: `${Math.min(progressPercent, 100)}%`,
                                            height: "100%",
                                            backgroundColor: "#d384f5",
                                        }}
                                    />
                                </View>
                            ) : null}
                        </View>
                        <Text
                            className="font-semibold text-white"
                            numberOfLines={1}
                            style={TV_VISUAL.typography ? {
                                marginTop: tvSize(12),
                                fontSize: tvSize(21),
                                lineHeight: tvSize(27),
                                letterSpacing: tvSize(0.1),
                                opacity: focus.focused ? 1 : 0.86,
                            } : {
                                marginTop: tvSize(10),
                                fontSize: tvSize(22),
                                opacity: focus.focused ? 1 : 0.82,
                            }}
                        >
                            {title}
                        </Text>
                        {subtitle ? (
                            <Text
                                className={TV_VISUAL.typography ? "font-medium text-white/45" : "text-white/45"}
                                numberOfLines={1}
                                style={TV_VISUAL.typography
                                    ? { marginTop: tvSize(3), fontSize: tvSize(17), lineHeight: tvSize(22) }
                                    : { marginTop: tvSize(2), fontSize: tvSize(18) }}
                            >
                                {subtitle}
                            </Text>
                        ) : null}
                    </TVFocusScaleView>
                </Pressable>
            )
        })
)

/**
 * Garceslab Anime: the episode tag pill, small and bold enough to read from the
 * couch. It sits under the status overlay, so loading and error states cover it.
 */
function TVEpisodeTagPill({ kind }: { kind: EpisodeTagKind }) {
    const style = EPISODE_TAG_STYLE[kind]
    const borderWidth = style.border ? Math.max(1, tvSize(1.5)) : 0
    return (
        <View
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
            style={{
                position: "absolute",
                top: tvSize(12),
                right: tvSize(12),
                overflow: "hidden",
                borderRadius: tvSize(7),
                borderWidth,
                borderColor: style.border ?? "transparent",
                paddingHorizontal: tvSize(10) - borderWidth,
                paddingVertical: tvSize(4) - borderWidth,
                backgroundColor: style.background,
            }}
        >
            {kind === "mixed" ? (
                <LinearGradient
                    colors={["#a443cf", "#f59e4b"]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={{ position: "absolute", inset: 0 }}
                />
            ) : null}
            <Text
                style={{
                    color: style.color,
                    fontSize: tvSize(15),
                    lineHeight: tvSize(20),
                    fontWeight: "800",
                    letterSpacing: tvSize(0.8),
                }}
            >
                {EPISODE_TAG_LABELS[kind]}
            </Text>
        </View>
    )
}

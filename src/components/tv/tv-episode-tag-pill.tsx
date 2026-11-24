import { useEpisodeTag } from "@/api/hooks/episode-tags.hooks"
import { tvSize } from "@/components/tv/tv-scale"
import { EPISODE_TAG_LABELS, EPISODE_TAG_STYLE, type EpisodeTagKind } from "@/lib/episode-tags/episode-tags"
import { LinearGradient } from "expo-linear-gradient"
import * as React from "react"
import { type StyleProp, Text, View, type ViewStyle } from "react-native"

/**
 * Garceslab Anime: the canon/filler/recap pill, small and bold enough to read
 * from the couch. Episode cards pin it to a corner; the player, its dialogs
 * and the home hero show it inline, a little larger (`size`). Screen readers
 * skip it: the caller puts the spoken kind in its own label.
 */
export function TVEpisodeTagPill({ kind, size = 15, style: extraStyle }: {
    kind: EpisodeTagKind
    /** Font size before tvSize(); the padding follows it. */
    size?: number
    style?: StyleProp<ViewStyle>
}) {
    const style = EPISODE_TAG_STYLE[kind]
    const k = size / 15
    const borderWidth = style.border ? Math.max(1, tvSize(1.5 * k)) : 0
    return (
        <View
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
            style={[
                {
                    overflow: "hidden",
                    borderRadius: tvSize(7 * k),
                    borderWidth,
                    borderColor: style.border ?? "transparent",
                    paddingHorizontal: tvSize(10 * k) - borderWidth,
                    paddingVertical: tvSize(4 * k) - borderWidth,
                    backgroundColor: style.background,
                    flexShrink: 0,
                    alignSelf: "flex-start",
                },
                extraStyle,
            ]}
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
                    fontSize: tvSize(size),
                    lineHeight: tvSize(20 * k),
                    fontWeight: "800",
                    letterSpacing: tvSize(0.8 * k),
                }}
            >
                {EPISODE_TAG_LABELS[kind]}
            </Text>
        </View>
    )
}

/**
 * The pill for one episode, fetching the anime's tags itself (shared cache,
 * see useEpisodeTag). Renders nothing while there is no tag to show, so a
 * slide only asks for the anime it is showing.
 */
export function TVEpisodeTagFor({ mediaId, episodeNumber, size, style }: {
    mediaId: number
    episodeNumber: number
    size?: number
    style?: StyleProp<ViewStyle>
}) {
    const kind = useEpisodeTag(mediaId, episodeNumber)
    return kind ? <TVEpisodeTagPill kind={kind} size={size} style={style} /> : null
}

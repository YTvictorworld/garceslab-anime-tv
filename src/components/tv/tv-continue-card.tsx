import type { AL_BaseAnime } from "@/api/generated/types"
import { serverStatusAtom } from "@/atoms/server.atoms"
import type { ContinueWatchingItem } from "@/hooks/use-anime-library-collection"
import { getContinueWatchingSpoilerActive, getEpisodeSpoilerState, getSpoilerSafeAnimeImage } from "@/lib/anime-spoilers"
import { atom, useAtomValue } from "jotai"
import * as React from "react"
import { TVEpisodeCard, type TVEpisodeCardStatus } from "./tv-episode-card"
import { formatAiringTime, formatTimeUntil, hasAired, nextLabelUpdateDelay, type UpcomingEpisode } from "./tv-upcoming-episodes"
import { Pressable } from "react-native"

/**
 * Continue watching hides spoilers for every card alike (the episode number
 * doesn't matter), so the cards read just these two flags and don't re-render
 * on every server status refetch.
 */
const continueSpoilerAtom = atom(get => {
    const status = get(serverStatusAtom)
    return getEpisodeSpoilerState(status, { spoilerActive: getContinueWatchingSpoilerActive(status) })
})
const hideThumbnailAtom = atom(get => get(continueSpoilerAtom).hideThumbnail)
const hideTitleAtom = atom(get => get(continueSpoilerAtom).hideTitle)

/**
 * Upcoming episodes show their airing time in the TV's time zone. A build can
 * set another (an IANA name) for a TV whose own zone is set wrong, since the
 * app can't read or change the TV's setting.
 */
const AIRING_TIME_ZONE = process.env.EXPO_PUBLIC_TV_TIME_ZONE || undefined

type Props = {
    item: ContinueWatchingItem
    onPress?: () => void
    /** Called with `item`; one handler for the whole row keeps React.memo working. */
    onPressItem?: (item: ContinueWatchingItem) => void
    preferred?: boolean
    progressPercent?: number
    status?: TVEpisodeCardStatus
}

export const TVContinueCard = React.memo(
    React.forwardRef<React.ElementRef<typeof Pressable>, Props>(
        function TVContinueCard({
            item,
            onPress,
            onPressItem,
            preferred,
            progressPercent,
            status,
            ...props
        }, ref) {
            const hideThumbnail = useAtomValue(hideThumbnailAtom)
            const hideTitle = useAtomValue(hideTitleAtom)
            const episode = item.episode
            const media = episode.baseAnime
            const handlePress = onPress ?? (() => onPressItem?.(item))
            const title = media?.title?.userPreferred
                ?? media?.title?.english
                ?? media?.title?.romaji
                ?? "Untitled"
            const image = episode.episodeMetadata?.image
                ?? media?.bannerImage
                ?? media?.coverImage?.extraLarge
                ?? media?.coverImage?.large

            return (
                <TVEpisodeCard
                    ref={ref}
                    image={image}
                    duration={episode.episodeMetadata?.length}
                    badge={episode.displayTitle}
                    title={title}
                    subtitle={hideTitle
                        ? `Episode ${episode.episodeNumber}`
                        : episode.episodeTitle || `Episode ${episode.episodeNumber}`}
                    onPress={handlePress}
                    preferred={preferred}
                    progressPercent={progressPercent}
                    filler={episode.episodeMetadata?.isFiller}
                    blurred={hideThumbnail}
                    blurredImage={getSpoilerSafeAnimeImage(media)}
                    recyclingKey={`${media?.id ?? "episode"}-${episode.episodeNumber}`}
                    status={status}
                    {...props}
                />
            )
        }
    )
)

type UpcomingProps = {
    item: UpcomingEpisode<AL_BaseAnime>
    /** Called with `item` and whether the episode has aired by now. */
    onPressItem: (item: UpcomingEpisode<AL_BaseAnime>, aired: boolean) => void
    /** Called once when the airing time passes while the card is on screen. */
    onAired?: () => void
    preferred?: boolean
    status?: TVEpisodeCardStatus
}

/**
 * webOS: the next episode of a show the user is caught up with, with when it
 * airs and a countdown. Once that time passes it reads like a card to continue.
 */
export const TVUpcomingCard = React.memo(function TVUpcomingCard({ item, onPressItem, onAired, preferred, status }: UpcomingProps) {
    const [now, setNow] = React.useState(() => Date.now())
    const aired = hasAired(item.airingAt, now)
    const onAiredRef = React.useRef(onAired)
    onAiredRef.current = onAired

    React.useEffect(() => {
        const delay = nextLabelUpdateDelay(item.airingAt, now)
        if (delay === null) return
        const timer = setTimeout(() => {
            const next = Date.now()
            setNow(next)
            if (hasAired(item.airingAt, next)) onAiredRef.current?.()
        }, delay)
        return () => clearTimeout(timer)
    }, [item.airingAt, now])

    const media = item.media
    const title = media.title?.userPreferred
        ?? media.title?.english
        ?? media.title?.romaji
        ?? "Untitled"
    const when = formatAiringTime(item.airingAt, AIRING_TIME_ZONE)

    return (
        <TVEpisodeCard
            image={media.bannerImage ?? media.coverImage?.extraLarge ?? media.coverImage?.large}
            badge={aired ? `Episode ${item.episodeNumber}` : `Next: Episode ${item.episodeNumber}`}
            title={title}
            subtitle={aired ? `Aired ${when}` : `${when} (${formatTimeUntil(item.airingAt, now)})`}
            tag={aired
                ? { label: "New episode", icon: "sparkles" }
                : { label: "Upcoming", icon: "time-outline", dimmed: true }}
            onPress={() => onPressItem(item, hasAired(item.airingAt, Date.now()))}
            preferred={preferred}
            recyclingKey={`upcoming-${media.id}-${item.episodeNumber}`}
            status={status}
            accessibilityLabel={aired
                ? `${title}, episode ${item.episodeNumber}, new, aired ${when}`
                : `${title}, next episode ${item.episodeNumber}, airs ${when}, ${formatTimeUntil(item.airingAt, now)}`}
        />
    )
})

import type { AL_BaseAnime } from "@/api/generated/types"
import { useSearchSuggestions } from "@/api/hooks/search-suggestions.hooks"
import { useInfiniteAnimeSearch } from "@/api/hooks/search.hooks"
import {
    TVButton,
    TVInput,
    TVMediaGrid,
    TVSearchFilterDrawer,
    TVToolbar,
    TV,
    tvSize,
    useTVFocus,
} from "@/components/tv"
import { TVOnScreenKeyboard } from "@/components/tv/tv-on-screen-keyboard"
import {
    getActiveFiltersCount,
    isSearchActive,
    searchParamsAtom,
    type SearchParams,
} from "@/lib/search/search.atoms"
import { SEARCH_DEBOUNCE_MS, searchQueryFor } from "@/lib/tv-keyboard"
import Ionicons from "@expo/vector-icons/Ionicons"
import { router } from "expo-router"
import { useAtom } from "jotai"
import * as React from "react"
import {
    ActivityIndicator,
    Animated,
    Pressable,
    Text,
    TVFocusGuideView,
    View,
} from "react-native"

/**
 * Search as you type: the on-screen keyboard changes the text with every
 * key, and the search runs 250 ms after the last one (from two letters on;
 * a newer query cancels the one still running). The TV's own keyboard only
 * hands its text over when it closes, so it stays as a fallback in the bar.
 */
export function TVSearchScreen() {
    const [params, setParams] = useAtom(searchParamsAtom)
    const [input, setInput] = React.useState(params.title ?? "")
    const [filterOpen, setFilterOpen] = React.useState(false)

    React.useEffect(() => {
        const title = searchQueryFor(input)
        const timer = setTimeout(() => {
            setParams(current => current.title === title && current.type === "anime"
                ? current
                : { ...current, type: "anime", title })
        }, SEARCH_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [input, setParams])

    const shouldQuery = isSearchActive(params)
    const search = useInfiniteAnimeSearch(params, shouldQuery, { keepPrevious: true })
    const media = React.useMemo(() => (
        shouldQuery
            ? search.data?.pages
                .flatMap(page => page?.Page?.media ?? [])
                .filter(Boolean) as AL_BaseAnime[] ?? []
            : []
    ), [search.data?.pages, shouldQuery])
    const activeFilters = getActiveFiltersCount(params)
    const typed = input.trim()
    const waitingForLetters = typed.length > 0 && !searchQueryFor(input)
    // Suggestions come from one hook, so their source can change (a server title index) without this screen.
    const { suggestions, isFetching: searching } = useSearchSuggestions(params.title, params)

    const loadMore = React.useCallback(() => {
        if (search.hasNextPage && !search.isFetchingNextPage) {
            void search.fetchNextPage()
        }
    }, [search])

    const applyFilters = React.useCallback((next: SearchParams) => {
        setParams({ ...next, type: "anime", title: searchQueryFor(input) })
    }, [input, setParams])

    const openMedia = React.useCallback((item: AL_BaseAnime) => {
        router.push(`/(app)/entry/anime/${item.id}`)
    }, [])

    return (
        <View className="flex-1 bg-background">
            <TVMediaGrid
                media={search.isLoading ? [] : media}
                query={params.title ?? undefined}
                showAudienceScore
                loadingMore={search.isFetchingNextPage}
                onEndReached={loadMore}
                header={(
                    <View>
                        <TVToolbar>
                            <TVButton
                                label="Back"
                                variant="ghost"
                                size="compact"
                                icon={<Ionicons name="arrow-back" size={tvSize(20)} color="white" />}
                                onPress={() => router.back()}
                            />
                            <View style={{ flex: 1, maxWidth: tvSize(760) }}>
                                {/* Shows what is typed; OK on it opens the TV's own keyboard (fallback). */}
                                <TVInput
                                    value={input}
                                    onChangeText={setInput}
                                    placeholder="Search anime"
                                    accessibilityLabel="Search text. Press OK to type with the TV keyboard"
                                    placeholderTextColor="rgba(255,255,255,0.35)"
                                    autoCorrect={false}
                                    autoCapitalize="none"
                                    returnKeyType="search"
                                    icon={(
                                        <Ionicons
                                            name="search"
                                            size={tvSize(22)}
                                            color="rgba(255,255,255,0.58)"
                                        />
                                    )}
                                />
                            </View>
                            <TVButton
                                label={activeFilters ? `Filters (${activeFilters})` : "Filters"}
                                variant="secondary"
                                size="compact"
                                icon={<Ionicons name="options-outline" size={tvSize(20)} color="white" />}
                                onPress={() => setFilterOpen(true)}
                            />
                        </TVToolbar>

                        <View
                            style={{
                                flexDirection: "row",
                                gap: tvSize(56),
                                paddingHorizontal: TV.gutter,
                                paddingTop: tvSize(26),
                                paddingBottom: tvSize(10),
                                maxWidth: tvSize(1320) + TV.gutter * 2,
                                width: "100%",
                                alignSelf: "center",
                            }}
                        >
                            <TVFocusGuideView autoFocus trapFocusLeft>
                                <TVOnScreenKeyboard value={input} onChange={setInput} maxLength={60} preferred />
                            </TVFocusGuideView>

                            <TVFocusGuideView autoFocus trapFocusRight style={{ flex: 1, gap: tvSize(8) }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: tvSize(12), marginBottom: tvSize(6) }}>
                                    <Text className="font-semibold text-white/60" style={{ fontSize: tvSize(18), letterSpacing: tvSize(1), textTransform: "uppercase" }}>
                                        Suggestions
                                    </Text>
                                    {searching ? <ActivityIndicator size="small" color="#a89fff" /> : null}
                                </View>
                                {suggestions.length > 0 ? suggestions.map(item => (
                                    <TVSuggestion key={item.id} media={item} query={typed} onPress={openMedia} />
                                )) : (
                                    <Text className="text-white/40" style={{ fontSize: tvSize(20) }}>
                                        {waitingForLetters
                                            ? "Keep typing: suggestions start at 2 letters."
                                            : shouldQuery && !searching
                                                // AniList matches whole words (a lone "blea" finds nothing, "bleach" does).
                                                ? (params.title ? `No results for “${params.title}” yet. Keep typing the whole word.` : "No titles match these filters")
                                                : !typed ? "Type with the keyboard: results appear as you go." : ""}
                                    </Text>
                                )}
                            </TVFocusGuideView>
                        </View>
                    </View>
                )}
                emptyComponent={search.isLoading ? (
                    <View
                        style={{
                            minHeight: tvSize(200),
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <ActivityIndicator size="large" color="#a89fff" />
                    </View>
                ) : undefined}
                emptyTitle={shouldQuery
                    ? (params.title ? `No results for “${params.title}”` : "No titles match these filters")
                    : "Search the AniList catalog"}
                emptyText={shouldQuery
                    ? "Try another title or change the filters."
                    : "Use the keyboard or the filters above."}
            />

            <TVSearchFilterDrawer
                open={filterOpen}
                onOpenChange={setFilterOpen}
                params={params}
                onApply={applyFilters}
            />
        </View>
    )
}

const TVSuggestion = React.memo(function TVSuggestion({ media, query, onPress }: { media: AL_BaseAnime; query: string; onPress: (media: AL_BaseAnime) => void }) {
    const focusState = useTVFocus(1.02, `suggestion-${media.id}`)
    const title = media.title?.userPreferred || media.title?.english || media.title?.romaji || "Untitled"
    const detail = [media.format, media.seasonYear ?? media.startDate?.year].filter(Boolean).join(" · ")
    const color = focusState.focused ? "#000000" : "#ffffff"
    return (
        <Pressable
            onPress={() => onPress(media)}
            onFocus={focusState.focus}
            onBlur={focusState.blur}
            accessibilityRole="button"
            accessibilityLabel={detail ? `${title}, ${detail}` : title}
        >
            <Animated.View
                style={[
                    focusState.style,
                    {
                        flexDirection: "row",
                        alignItems: "center",
                        gap: tvSize(14),
                        minHeight: tvSize(56),
                        paddingHorizontal: tvSize(18),
                        borderRadius: tvSize(12),
                        borderWidth: tvSize(2),
                        backgroundColor: focusState.focused ? "#ffffff" : "rgba(255,255,255,0.04)",
                        borderColor: focusState.focused ? "#ffffff" : "transparent",
                    },
                ]}
            >
                <Ionicons name="search" size={tvSize(18)} color={focusState.focused ? "#000000" : "rgba(255,255,255,0.45)"} />
                <Text numberOfLines={1} style={{ flex: 1, color, fontSize: tvSize(21) }}>
                    <HighlightedTitle title={title} query={query} focused={focusState.focused} />
                </Text>
                {detail ? (
                    <Text style={{ color: focusState.focused ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.4)", fontSize: tvSize(16) }}>{detail}</Text>
                ) : null}
            </Animated.View>
        </Pressable>
    )
})

/** The typed letters in bold where the title contains them. */
function HighlightedTitle({ title, query, focused }: { title: string; query: string; focused: boolean }) {
    const index = query ? title.toLowerCase().indexOf(query.toLowerCase()) : -1
    if (index < 0) return <>{title}</>
    return (
        <>
            {title.slice(0, index)}
            <Text style={{ fontWeight: "700", color: focused ? "#000000" : "#c9c3ff" }}>{title.slice(index, index + query.length)}</Text>
            {title.slice(index + query.length)}
        </>
    )
}

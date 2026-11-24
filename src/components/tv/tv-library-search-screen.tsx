import type { AL_BaseAnime } from "@/api/generated/types"
import { TV, TVButton, TVInput, TVMediaGrid, TVToolbar, tvSize } from "@/components/tv"
import { TVOnScreenKeyboard } from "@/components/tv/tv-on-screen-keyboard"
import { useAnimeLibraryCollection } from "@/hooks/use-anime-library-collection"
import { filterEntriesByTitle } from "@/lib/utils/filtering"
import Ionicons from "@expo/vector-icons/Ionicons"
import { router } from "expo-router"
import * as React from "react"
import { Text, TVFocusGuideView, View } from "react-native"

/**
 * Garceslab Anime: search the anime library (the profile's AniList lists),
 * opened from the search button left of the nav bar on the Anime tab. It has
 * the layout of Discover's search: Back and the text field, the on-screen
 * keyboard, then the matches. Matching is local, so they update with every key.
 */
export function TVLibrarySearchScreen() {
    const [input, setInput] = React.useState("")
    const query = React.useDeferredValue(input).trim()
    const { libraryCollectionList } = useAnimeLibraryCollection()

    const entries = React.useMemo(() => libraryCollectionList.flatMap(list => list?.entries ?? []), [libraryCollectionList])
    const media = React.useMemo(() => {
        if (!query) return []
        return filterEntriesByTitle(entries, query)
            .map(item => item.media)
            .filter((item): item is AL_BaseAnime => !!item)
    }, [entries, query])

    const status = !query
        ? "Type with the keyboard: titles from your lists appear as you go."
        : media.length === 0
            ? `Nothing in your lists matches “${query}”.`
            : media.length === 1 ? "1 title in your lists" : `${media.length} titles in your lists`

    return (
        <View className="flex-1 bg-background">
            <TVMediaGrid
                media={media}
                query={query}
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
                                    placeholder="Search your anime library"
                                    accessibilityLabel="Search text. Press OK to type with the TV keyboard"
                                    placeholderTextColor="rgba(255,255,255,0.35)"
                                    autoCorrect={false}
                                    autoCapitalize="none"
                                    returnKeyType="search"
                                    icon={<Ionicons name="search" size={tvSize(22)} color="rgba(255,255,255,0.58)" />}
                                />
                            </View>
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
                            <View style={{ flex: 1, gap: tvSize(8), paddingTop: tvSize(6) }}>
                                <Text className="font-semibold text-white/60" style={{ fontSize: tvSize(18), letterSpacing: tvSize(1), textTransform: "uppercase" }}>
                                    Your library
                                </Text>
                                <Text accessibilityLiveRegion="polite" className="text-white/45" style={{ fontSize: tvSize(20) }}>
                                    {status}
                                </Text>
                            </View>
                        </View>
                    </View>
                )}
                emptyTitle={query ? `No results for “${query}”` : "Search your anime library"}
                emptyText={query ? "Try another title from your AniList lists." : "Discover searches all of AniList."}
            />
        </View>
    )
}

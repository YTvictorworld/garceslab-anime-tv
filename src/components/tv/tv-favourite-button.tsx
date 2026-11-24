import { useMyAnimeFavourites, useToggleAnimeFavourite } from "@/api/hooks/profiles_library.hooks"
import { useServerStatus } from "@/atoms/server.atoms"
import { TVPillButton } from "@/components/tv/tv-focus"
import { tvSize } from "@/components/tv/tv-scale"
import Ionicons from "@expo/vector-icons/Ionicons"
import * as React from "react"

/**
 * Garceslab Anime: "Favourite" pill on the anime page. Only with a profile
 * (servers without profiles have no favourites endpoint). One press toggles it.
 */
export function TVFavouriteButton({ mediaId }: { mediaId: number | undefined }) {
    const status = useServerStatus()
    const enabled = !!status?.profiles?.enabled && !!status?.currentProfile && !!mediaId
    const { data } = useMyAnimeFavourites(enabled)
    const { mutate, isPending } = useToggleAnimeFavourite()
    const isFavourite = !!mediaId && !!data?.some(f => f.refId === mediaId)

    if (!enabled) return null

    return (
        <TVPillButton
            label={isFavourite ? "Favourite" : "Add to favourites"}
            active={isFavourite}
            disabled={isPending}
            accessibilityLabel={isFavourite ? "Remove from favourites" : "Add to favourites"}
            accessibilityState={{ selected: isFavourite }}
            icon={focused => (
                <Ionicons
                    name={isFavourite ? "heart" : "heart-outline"}
                    size={tvSize(22)}
                    color={focused ? "#000000" : isFavourite ? "#f472b6" : "#fff"}
                />
            )}
            onPress={() => mediaId && mutate({ mediaId, favourite: !isFavourite })}
        />
    )
}

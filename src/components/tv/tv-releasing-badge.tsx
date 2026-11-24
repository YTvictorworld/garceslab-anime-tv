import { tvSize } from "@/components/tv/tv-scale"
import RadioTower from "lucide-react-native/icons/radio-tower"
import * as React from "react"
import { Text, View } from "react-native"

/** AniList statuses the web marks with its "Releasing" badge. */
export function isAiringStatus(status: string | null | undefined): status is "RELEASING" | "NOT_YET_RELEASED" {
    return status === "RELEASING" || status === "NOT_YET_RELEASED"
}

const LILAC = "rgba(164,67,207,0.94)"
const ZINC = "rgba(63,63,70,0.94)"

/**
 * Garceslab Anime: the web's "Releasing" badge (a signal tower) for anime
 * that are airing (lilac) or not yet released (grey). `compact` is the icon
 * alone, for poster cards; otherwise the status is written beside it.
 */
export const TVReleasingBadge = React.memo(function TVReleasingBadge({
    status,
    compact,
}: {
    status: "RELEASING" | "NOT_YET_RELEASED"
    compact?: boolean
}) {
    const releasing = status === "RELEASING"
    const label = releasing ? "Releasing" : "Not yet released"
    if (compact) {
        return (
            <View
                accessibilityLabel={label}
                style={{
                    width: tvSize(34),
                    height: tvSize(34),
                    borderRadius: tvSize(9),
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: releasing ? LILAC : ZINC,
                }}
            >
                <RadioTower size={tvSize(20)} color="#ffffff" strokeWidth={2.4} />
            </View>
        )
    }
    return (
        <View
            accessibilityLabel={label}
            style={{
                flexDirection: "row",
                alignItems: "center",
                gap: tvSize(7),
            }}
        >
            <RadioTower size={tvSize(22)} color={releasing ? "#e6b0fd" : "rgba(255,255,255,0.6)"} strokeWidth={2.4} />
            <Text
                className="font-semibold"
                style={{ fontSize: tvSize(20), color: releasing ? "#e6b0fd" : "rgba(255,255,255,0.6)" }}
            >
                {label}
            </Text>
        </View>
    )
})

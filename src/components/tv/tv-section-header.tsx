import { TV, tvSize } from "@/components/tv/tv-scale"
import { TV_VISUAL } from "@/lib/tv/visual-flags"
import * as React from "react"
import { Text, View } from "react-native"

type TVSectionHeaderProps = {
    title: string
    count?: number
    after?: React.ReactNode
    action?: React.ReactNode
    padded?: boolean
}

export const TVSectionHeader = React.memo(function TVSectionHeader({
    title,
    count,
    after,
    action,
    padded = true,
}: TVSectionHeaderProps) {
    return (
        <View
            style={{
                minHeight: tvSize(44),
                paddingHorizontal: padded ? TV.gutter : 0,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: tvSize(24),
            }}
        >
            <View style={{ flexDirection: "row", alignItems: "center", gap: tvSize(30), flexShrink: 0 }}>
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: TV_VISUAL.typography ? "center" : "baseline",
                        gap: tvSize(12),
                    }}
                >
                    <Text
                        className="font-bold text-white"
                        style={TV_VISUAL.typography
                            ? { fontSize: tvSize(31), lineHeight: tvSize(38), letterSpacing: tvSize(-0.3) }
                            : { fontSize: tvSize(30) }}
                    >
                        {title}
                    </Text>
                    {count !== undefined ? (TV_VISUAL.typography ? (
                        // The web's count pill: quieter than the title, still readable from the couch.
                        <View
                            style={{
                                alignSelf: "center",
                                minWidth: tvSize(34),
                                paddingHorizontal: tvSize(10),
                                paddingVertical: tvSize(2),
                                borderRadius: tvSize(99),
                                backgroundColor: "rgba(255,255,255,0.08)",
                                alignItems: "center",
                            }}
                        >
                            <Text className="font-semibold text-white/55" style={{ fontSize: tvSize(17), lineHeight: tvSize(23) }}>
                                {count}
                            </Text>
                        </View>
                    ) : (
                        <Text className="font-medium text-white/35" style={{ fontSize: tvSize(20) }}>
                            {count}
                        </Text>
                    )) : null}
                </View>
                {after}
            </View>
            {action ? (
                <View style={{ flexShrink: 1, alignItems: "flex-end" }}>
                    {action}
                </View>
            ) : null}
        </View>
    )
})

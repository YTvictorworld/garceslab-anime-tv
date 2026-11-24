import { tvSize } from "@/components/tv/tv-scale"
import { directPlayDiagnostics, summarizeDiagnostics } from "@/lib/player/direct-play-diagnostics"
import * as React from "react"
import { Text, View } from "react-native"

/** The direct-play spike's findings, while it plays (Info key, with the player stats). */
export function useDirectPlayDiagnostics() {
    return React.useSyncExternalStore(directPlayDiagnostics.subscribe, directPlayDiagnostics.get, directPlayDiagnostics.get)
}

export function TVDirectPlayDiagnostics({ top, left }: { top: number; left: number }) {
    const diagnostics = useDirectPlayDiagnostics()
    const lines = summarizeDiagnostics(diagnostics)
    const text = lines.join("\n")
    return (
        <View
            pointerEvents="none"
            style={{
                position: "absolute",
                top,
                left,
                maxWidth: tvSize(1100),
                padding: tvSize(16),
                borderRadius: tvSize(12),
                backgroundColor: "rgba(0,0,0,0.78)",
                borderWidth: tvSize(2),
                borderColor: diagnostics.failure ? "rgba(248,113,113,0.8)" : "rgba(255,255,255,0.12)",
            }}
        >
            <Text className="font-bold text-white" style={{ fontSize: tvSize(18), marginBottom: tvSize(8) }}>
                Direct play diagnostics (Info hides)
            </Text>
            <Text
                className="text-white/85"
                style={{ fontSize: tvSize(15), lineHeight: tvSize(22), fontFamily: "monospace" }}
                accessibilityLabel={text}
            >
                {text}
            </Text>
        </View>
    )
}

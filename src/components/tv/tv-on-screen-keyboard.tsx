import { useTVFocus } from "@/components/tv/tv-focus"
import { tvSize } from "@/components/tv/tv-scale"
import { applyKeyboardKey, type KeyboardKey, keyboardRows, typedCharacter } from "@/lib/tv-keyboard"
import Ionicons from "@expo/vector-icons/Ionicons"
import * as React from "react"
import { Animated, Platform, Pressable, Text, View } from "react-native"

type Props = {
    value: string
    onChange: (value: string) => void
    maxLength?: number
    /** "words": a capital at the start of each word (profile names). */
    capitalize?: "none" | "words"
    /** Focus the first key when it mounts. */
    preferred?: boolean
    /** Also type with a keyboard plugged into the TV (or a desktop's), while this is on screen. */
    captureTyping?: boolean
    accessibilityLabel?: string
}

const KEY_SIZE = 62
const KEY_GAP = 8

/**
 * Garceslab Anime: a letter grid driven by the remote. The LG system
 * keyboard hands text to the page only when it closes, so typing with it
 * can't search as you type; this one changes `value` with every key.
 */
export function TVOnScreenKeyboard({
    value,
    onChange,
    maxLength,
    capitalize = "none",
    preferred,
    captureTyping = true,
    accessibilityLabel,
}: Props) {
    const valueRef = React.useRef(value)
    valueRef.current = value
    const onChangeRef = React.useRef(onChange)
    onChangeRef.current = onChange

    const press = React.useCallback((key: KeyboardKey) => {
        const next = applyKeyboardKey(valueRef.current, key, { maxLength, capitalize })
        if (next !== valueRef.current) onChangeRef.current(next)
    }, [capitalize, maxLength])

    // A USB/Bluetooth keyboard on the TV (and a desktop's while testing) types too.
    React.useEffect(() => {
        if (Platform.OS !== "web" || !captureTyping || typeof document === "undefined") return
        const onKeyDown = (event: KeyboardEvent) => {
            const active = document.activeElement
            if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
            if (event.ctrlKey || event.metaKey || event.altKey) return
            const character = typedCharacter(event.key)
            if (!character) return
            // LG remote number keys arrive as digits too; they type here.
            event.preventDefault()
            press(character === " " ? { kind: "space" } : { kind: "char", value: character })
        }
        document.addEventListener("keydown", onKeyDown, true)
        return () => document.removeEventListener("keydown", onKeyDown, true)
    }, [captureTyping, press])

    const rows = keyboardRows()

    return (
        <View
            accessibilityLabel={accessibilityLabel ?? "On-screen keyboard"}
            style={{ gap: tvSize(KEY_GAP) }}
        >
            {rows.map((row, rowIndex) => (
                <View key={rowIndex} style={{ flexDirection: "row", gap: tvSize(KEY_GAP) }}>
                    {row.map((key, keyIndex) => (
                        <TVKeyboardKey
                            key={keyLabel(key)}
                            keyDef={key}
                            preferred={preferred && rowIndex === 0 && keyIndex === 0}
                            onPressKey={press}
                        />
                    ))}
                </View>
            ))}
        </View>
    )
}

function keyLabel(key: KeyboardKey) {
    switch (key.kind) {
        case "char":
            return key.value.toUpperCase()
        case "space":
            return "Space"
        case "backspace":
            return "Delete"
        case "clear":
            return "Clear"
    }
}

const TVKeyboardKey = React.memo(function TVKeyboardKey({
    keyDef,
    preferred,
    onPressKey,
}: {
    keyDef: KeyboardKey
    preferred?: boolean
    onPressKey: (key: KeyboardKey) => void
}) {
    const label = keyLabel(keyDef)
    const focusState = useTVFocus(1.08, `key-${label}`)
    const wide = keyDef.kind !== "char"
    // The bottom row's three keys span the six-key width.
    const width = wide ? KEY_SIZE * 2 + KEY_GAP : KEY_SIZE
    const icon = keyDef.kind === "backspace" ? "backspace-outline" : keyDef.kind === "space" ? "remove-outline" : keyDef.kind === "clear" ? "close-circle-outline" : null
    const color = focusState.focused ? "#000000" : "#ffffff"

    return (
        <Pressable
            hasTVPreferredFocus={preferred}
            onPress={() => onPressKey(keyDef)}
            onFocus={focusState.focus}
            onBlur={focusState.blur}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={{ flexShrink: 0 }}
        >
            <Animated.View
                style={[
                    focusState.style,
                    {
                        width: tvSize(width),
                        height: tvSize(KEY_SIZE),
                        borderRadius: tvSize(12),
                        borderWidth: tvSize(2),
                        alignItems: "center",
                        justifyContent: "center",
                        flexDirection: "row",
                        gap: tvSize(6),
                        backgroundColor: focusState.focused ? "#ffffff" : "rgba(255,255,255,0.06)",
                        borderColor: focusState.focused ? "#ffffff" : "rgba(255,255,255,0.1)",
                    },
                ]}
            >
                {icon ? <Ionicons name={icon} size={tvSize(22)} color={color} /> : null}
                <Text
                    style={{
                        color,
                        fontSize: tvSize(wide ? 18 : 24),
                        fontWeight: "600",
                    }}
                >
                    {label}
                </Text>
            </Animated.View>
        </Pressable>
    )
})

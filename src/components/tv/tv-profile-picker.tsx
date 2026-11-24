import type { Avatar, Profile } from "@/api/generated/types"
import { avatarImageUrl } from "@/api/hooks/profiles.hooks"
import { TVButton, useTVFocus } from "@/components/tv/tv-focus"
import { tvKeyAction } from "@/components/tv/tv-native"
import { TVOnScreenKeyboard } from "@/components/tv/tv-on-screen-keyboard"
import { TV, tvSize } from "@/components/tv/tv-scale"
import { IMAGES } from "@/constants/images"
import { appendPinDigit, PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "@/lib/profile/profile-errors"
import Ionicons from "@expo/vector-icons/Ionicons"
import { Image } from "expo-image"
import * as React from "react"
import { ActivityIndicator, Animated, BackHandler, Pressable, ScrollView, Text, TVFocusGuideView, useTVEventHandler, View } from "react-native"

/**
 * Garceslab Anime: "Who's watching?", the PIN pad and "Create your profile",
 * all driven by the remote. The route (app/(out)/select-profile.tsx) talks to
 * the server; these only show and collect.
 */

const CARD = 220

function useBack(handler: (() => boolean) | null) {
    const ref = React.useRef(handler)
    ref.current = handler
    const enabled = handler !== null
    React.useEffect(() => {
        if (!enabled) return
        const sub = BackHandler.addEventListener("hardwareBackPress", () => ref.current?.() ?? false)
        return () => sub.remove()
    }, [enabled])
}

function Screen({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string | null }) {
    return (
        <View style={{ flex: 1, backgroundColor: "#0a0a0a" }}>
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ minHeight: "100%", alignItems: "center", justifyContent: "center", paddingVertical: tvSize(60), paddingHorizontal: TV.gutter }}
                showsVerticalScrollIndicator={false}
            >
                <Image source={IMAGES.logo2} style={{ width: tvSize(72), height: tvSize(72), marginBottom: tvSize(18) }} contentFit="contain" />
                <Text accessibilityRole="header" className="font-bold text-white" style={{ fontSize: tvSize(46), textAlign: "center" }}>
                    {title}
                </Text>
                {subtitle ? (
                    <Text className="text-white/55" style={{ fontSize: tvSize(20), marginTop: tvSize(10), textAlign: "center", maxWidth: tvSize(900) }}>
                        {subtitle}
                    </Text>
                ) : null}
                <View style={{ marginTop: tvSize(44), alignItems: "center", width: "100%" }}>
                    {children}
                </View>
            </ScrollView>
        </View>
    )
}

function Message({ text, error }: { text: string | null | undefined; error?: boolean }) {
    if (!text) return null
    return (
        <Text
            accessibilityLiveRegion="polite"
            style={{ color: error ? "#fca5a5" : "rgba(255,255,255,0.6)", fontSize: tvSize(20), marginTop: tvSize(26), textAlign: "center", maxWidth: tvSize(900) }}
        >
            {text}
        </Text>
    )
}

function AvatarImage({ uri, size }: { uri: string | null; size: number }) {
    return uri ? (
        <Image source={{ uri }} style={{ width: size, height: size, borderRadius: tvSize(18) }} contentFit="cover" transition={120} />
    ) : (
        <View style={{ width: size, height: size, borderRadius: tvSize(18), backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="person" size={size * 0.45} color="rgba(255,255,255,0.5)" />
        </View>
    )
}

/** A large card: the avatar, the name, a lock when it has a PIN. */
const ProfileTile = React.memo(function ProfileTile({
    label,
    imageUri,
    icon,
    locked,
    preferred,
    disabled,
    busy,
    onPress,
}: {
    label: string
    imageUri?: string | null
    icon?: React.ComponentProps<typeof Ionicons>["name"]
    locked?: boolean
    preferred?: boolean
    disabled?: boolean
    busy?: boolean
    onPress: () => void
}) {
    const focusState = useTVFocus(1.08, `profile-${label}`)
    const size = tvSize(CARD)
    return (
        <Pressable
            hasTVPreferredFocus={preferred}
            disabled={disabled}
            onPress={onPress}
            onFocus={focusState.focus}
            onBlur={focusState.blur}
            accessibilityRole="button"
            accessibilityLabel={locked ? `${label}, has a PIN` : label}
            style={{ flexShrink: 0, alignItems: "center", gap: tvSize(16) }}
        >
            <Animated.View
                style={[
                    focusState.style,
                    {
                        borderRadius: tvSize(24),
                        borderWidth: TV.focusBorder,
                        borderColor: focusState.focused ? "#ffffff" : "transparent",
                        padding: tvSize(4),
                    },
                ]}
            >
                {icon ? (
                    <View style={{ width: size, height: size, borderRadius: tvSize(18), backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name={icon} size={size * 0.38} color="rgba(255,255,255,0.7)" />
                    </View>
                ) : (
                    <AvatarImage uri={imageUri ?? null} size={size} />
                )}
                {busy ? (
                    <View style={{ position: "absolute", top: tvSize(4), left: tvSize(4), right: tvSize(4), bottom: tvSize(4), borderRadius: tvSize(18), backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}>
                        <ActivityIndicator size="large" color="#ffffff" />
                    </View>
                ) : null}
            </Animated.View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: tvSize(8), maxWidth: size }}>
                <Text
                    numberOfLines={1}
                    style={{ color: focusState.focused ? "#ffffff" : "rgba(255,255,255,0.7)", fontSize: tvSize(26), fontWeight: "600" }}
                >
                    {label}
                </Text>
                {locked ? <Ionicons name="lock-closed" size={tvSize(20)} color="rgba(255,255,255,0.6)" /> : null}
            </View>
        </Pressable>
    )
})

type PickerProps = {
    serverUrl: string | null
    profiles: Profile[]
    loading: boolean
    busyProfileId: number | null
    message?: string | null
    error?: string | null
    onSelect: (profile: Profile) => void
    onAdd: () => void
    onRetry: () => void
}

/** "Who's watching?": one row of large cards, plus "Add profile". */
export function TVProfilePicker({ serverUrl, profiles, loading, busyProfileId, message, error, onSelect, onAdd, onRetry }: PickerProps) {
    return (
        <Screen title="Who's watching?" subtitle={message}>
            {loading ? (
                <ActivityIndicator size="large" color="#a89fff" />
            ) : (
                <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight style={{ maxWidth: "100%" }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: tvSize(40), paddingHorizontal: tvSize(20), paddingVertical: tvSize(20) }}>
                        {profiles.map((profile, index) => (
                            <ProfileTile
                                key={profile.id}
                                label={profile.name}
                                imageUri={avatarImageUrl(serverUrl, profile.avatarUrl)}
                                locked={profile.hasPin}
                                preferred={index === 0}
                                busy={busyProfileId === profile.id}
                                onPress={() => busyProfileId === null && onSelect(profile)}
                            />
                        ))}
                        <ProfileTile
                            label="Add profile"
                            icon="add"
                            preferred={profiles.length === 0}
                            onPress={() => busyProfileId === null && onAdd()}
                        />
                    </ScrollView>
                </TVFocusGuideView>
            )}
            <Message text={error} error />
            {error && !loading && profiles.length === 0 ? (
                <View style={{ marginTop: tvSize(24) }}>
                    <TVButton label="Try again" variant="secondary" onPress={onRetry} />
                </View>
            ) : null}
        </Screen>
    )
}

//----------------------------------------------------------------------------------------------------------------------

const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "delete", "0", "ok"] as const

type PinPadProps = {
    title: string
    subtitle?: string | null
    /** Shown under the dots; a new error clears the digits. */
    error?: string | null
    busy?: boolean
    submitLabel?: string
    onSubmit: (pin: string) => void
    onCancel: () => void
}

/** A numeric keypad for a profile's PIN; the LG remote's number keys type too. */
export function TVPinPad({ title, subtitle, error, busy, submitLabel = "OK", onSubmit, onCancel }: PinPadProps) {
    const [pin, setPin] = React.useState("")
    const pinRef = React.useRef(pin)
    pinRef.current = pin

    React.useEffect(() => {
        if (error) setPin("")
    }, [error])

    const submit = React.useCallback((value: string) => {
        if (busy || value.length < PIN_MIN_LENGTH) return
        onSubmit(value)
    }, [busy, onSubmit])

    const typeDigit = React.useCallback((digit: string) => {
        if (busy) return
        const next = appendPinDigit(pinRef.current, digit)
        setPin(next)
        // The longest PIN can't take another digit: try it.
        if (next.length === PIN_MAX_LENGTH && next !== pinRef.current) submit(next)
    }, [busy, submit])

    useTVEventHandler((event) => {
        if (!event || tvKeyAction(event) === 0) return
        if (/^[0-9]$/.test(event.eventType)) typeDigit(event.eventType)
    })

    useBack(() => {
        onCancel()
        return true
    })

    return (
        <Screen title={title} subtitle={subtitle ?? `Enter a ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digit PIN with the keypad or the remote's number keys.`}>
            <View accessibilityLabel={`${pin.length} digits entered`} style={{ flexDirection: "row", gap: tvSize(18), marginBottom: tvSize(34) }}>
                {Array.from({ length: PIN_MAX_LENGTH }, (_, i) => (
                    <View
                        key={i}
                        style={{
                            width: tvSize(26),
                            height: tvSize(26),
                            borderRadius: tvSize(13),
                            borderWidth: tvSize(2),
                            borderColor: i < PIN_MIN_LENGTH ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.25)",
                            backgroundColor: i < pin.length ? "#ffffff" : "transparent",
                        }}
                    />
                ))}
            </View>
            <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight trapFocusUp trapFocusDown style={{ gap: tvSize(14) }}>
                {[0, 1, 2, 3].map(row => (
                    <View key={row} style={{ flexDirection: "row", gap: tvSize(14) }}>
                        {PIN_KEYS.slice(row * 3, row * 3 + 3).map(key => (
                            <PinKey
                                key={key}
                                value={key}
                                preferred={key === "1"}
                                // Keys stay enabled (busy is checked on press): a disabled key would drop the remote's focus.
                                label={key === "ok" ? submitLabel : undefined}
                                onPress={() => {
                                    if (busy) return
                                    if (key === "delete") setPin(current => current.slice(0, -1))
                                    else if (key === "ok") submit(pinRef.current)
                                    else typeDigit(key)
                                }}
                            />
                        ))}
                    </View>
                ))}
            </TVFocusGuideView>
            {busy ? <ActivityIndicator style={{ marginTop: tvSize(24) }} size="small" color="#ffffff" /> : null}
            <Message text={error} error />
            <Text className="text-white/35" style={{ fontSize: tvSize(17), marginTop: tvSize(22) }}>Back to cancel</Text>
        </Screen>
    )
}

function PinKey({ value, label, preferred, disabled, onPress }: { value: string; label?: string; preferred?: boolean; disabled?: boolean; onPress: () => void }) {
    const focusState = useTVFocus(1.08, `pin-${value}`)
    const text = label ?? (value === "delete" ? "Delete" : value)
    const color = focusState.focused ? "#000000" : "#ffffff"
    return (
        <Pressable
            hasTVPreferredFocus={preferred}
            disabled={disabled}
            onPress={onPress}
            onFocus={focusState.focus}
            onBlur={focusState.blur}
            accessibilityRole="button"
            accessibilityLabel={text}
            accessibilityState={{ disabled: !!disabled }}
            style={{ opacity: disabled ? 0.4 : 1 }}
        >
            <Animated.View
                style={[
                    focusState.style,
                    {
                        width: tvSize(110),
                        height: tvSize(78),
                        borderRadius: tvSize(16),
                        borderWidth: tvSize(2),
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: focusState.focused ? "#ffffff" : "rgba(255,255,255,0.06)",
                        borderColor: focusState.focused ? "#ffffff" : "rgba(255,255,255,0.1)",
                    },
                ]}
            >
                {value === "delete" ? (
                    <Ionicons name="backspace-outline" size={tvSize(30)} color={color} />
                ) : (
                    <Text style={{ color, fontSize: tvSize(value === "ok" ? 22 : 32), fontWeight: "600" }}>{text}</Text>
                )}
            </Animated.View>
        </Pressable>
    )
}

//----------------------------------------------------------------------------------------------------------------------

export type CreateProfileInput = {
    name: string
    avatarId: string
    pin: string | null
    anilistUsername: string | null
    importServerAccount: boolean
}

type CreateProps = {
    serverUrl: string | null
    avatars: Avatar[]
    avatarsLoading: boolean
    /** No profiles yet: the server's AniList account list can be imported, and Back doesn't go anywhere. */
    firstRun: boolean
    busy: boolean
    progress?: string | null
    error?: string | null
    onCreate: (input: CreateProfileInput) => void
    onCancel?: () => void
}

type Step = "name" | "avatar" | "options" | "pin" | "username"

/** "Create your profile" with the remote: name, avatar, then the optional PIN and imports. */
export function TVCreateProfile({ serverUrl, avatars, avatarsLoading, firstRun, busy, progress, error, onCreate, onCancel }: CreateProps) {
    const [step, setStep] = React.useState<Step>("name")
    const [name, setName] = React.useState("")
    const [avatarId, setAvatarId] = React.useState<string | null>(null)
    const [pin, setPin] = React.useState<string | null>(null)
    const [username, setUsername] = React.useState("")
    const [importServerAccount, setImportServerAccount] = React.useState(firstRun)
    const avatar = avatars.find(item => item.id === avatarId) ?? null

    useBack(busy ? () => true : () => {
        if (step === "name") {
            if (!onCancel) return false
            onCancel()
            return true
        }
        setStep(step === "avatar" ? "name" : step === "options" ? "avatar" : "options")
        return true
    })

    if (step === "pin") {
        return (
            <TVPinPad
                title="Add a PIN"
                subtitle={"The PIN keeps others from entering your profile by mistake. It doesn't protect your data: anyone can still manage profiles."}
                submitLabel="Save"
                onSubmit={value => {
                    setPin(value)
                    setStep("options")
                }}
                onCancel={() => setStep("options")}
            />
        )
    }

    if (step === "name" || step === "username") {
        const editingName = step === "name"
        const value = editingName ? name : username
        const trimmed = value.trim()
        return (
            <Screen
                title={editingName ? (firstRun ? "Create your profile" : "Add a profile") : "Import an AniList list"}
                subtitle={editingName ? "Type a name with the keyboard below." : "Type the AniList user name whose public list you want to import."}
            >
                <View
                    style={{
                        minWidth: tvSize(600),
                        height: tvSize(70),
                        borderRadius: tvSize(14),
                        borderWidth: tvSize(2),
                        borderColor: "rgba(255,255,255,0.2)",
                        backgroundColor: "rgba(255,255,255,0.05)",
                        justifyContent: "center",
                        paddingHorizontal: tvSize(22),
                        marginBottom: tvSize(28),
                    }}
                >
                    <Text accessibilityLabel={value || (editingName ? "Name, empty" : "User name, empty")} style={{ color: value ? "#ffffff" : "rgba(255,255,255,0.35)", fontSize: tvSize(30) }}>
                        {value || (editingName ? "Name" : "AniList user name")}
                        <Text style={{ color: "#a89fff" }}>|</Text>
                    </Text>
                </View>
                {/* Keyboard first, then the actions centred under it: Down from the last keyboard row reaches them. */}
                <View style={{ alignItems: "center", gap: tvSize(30) }}>
                    <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight trapFocusUp>
                        <TVOnScreenKeyboard
                            value={value}
                            onChange={editingName ? setName : setUsername}
                            maxLength={editingName ? 32 : 40}
                            capitalize={editingName ? "words" : "none"}
                            preferred
                        />
                    </TVFocusGuideView>
                    <TVFocusGuideView trapFocusLeft trapFocusRight trapFocusDown style={{ flexDirection: "row", justifyContent: "center", gap: tvSize(20) }}>
                        <TVButton
                            label={editingName ? "Next" : "Done"}
                            variant="primary"
                            disabled={editingName ? !trimmed : false}
                            icon={<Ionicons name="arrow-forward" size={tvSize(22)} color="white" />}
                            onPress={() => {
                                if (editingName) {
                                    if (!trimmed) return
                                    setName(trimmed)
                                    setStep("avatar")
                                } else {
                                    setUsername(trimmed)
                                    setStep("options")
                                }
                            }}
                        />
                        {editingName && onCancel ? (
                            <TVButton label="Cancel" variant="ghost" onPress={onCancel} />
                        ) : null}
                        {!editingName ? (
                            <TVButton label="Don't import" variant="ghost" onPress={() => {
                                setUsername("")
                                setStep("options")
                            }} />
                        ) : null}
                    </TVFocusGuideView>
                </View>
            </Screen>
        )
    }

    if (step === "avatar") {
        return (
            <Screen title="Choose an avatar" subtitle={`For ${name}. Press OK on the one you like.`}>
                {avatarsLoading ? (
                    <ActivityIndicator size="large" color="#a89fff" />
                ) : avatars.length === 0 ? (
                    <Message text="The server has no avatars to choose from." error />
                ) : (
                    <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: tvSize(22), maxWidth: tvSize(1500) }}>
                        {avatars.map((item, index) => (
                            <AvatarChoice
                                key={item.id}
                                avatar={item}
                                uri={avatarImageUrl(serverUrl, item.url)}
                                selected={item.id === avatarId}
                                preferred={avatarId ? item.id === avatarId : index === 0}
                                onPress={() => {
                                    setAvatarId(item.id)
                                    setStep("options")
                                }}
                            />
                        ))}
                    </TVFocusGuideView>
                )}
            </Screen>
        )
    }

    const optionsSubtitle = progress ?? "These are optional. You can create the profile now."
    return (
        <Screen title={firstRun ? "Create your profile" : "Add a profile"} subtitle={optionsSubtitle}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: tvSize(30), marginBottom: tvSize(34) }}>
                <AvatarImage uri={avatar ? avatarImageUrl(serverUrl, avatar.url) : null} size={tvSize(140)} />
                <Text className="font-bold text-white" style={{ fontSize: tvSize(38) }}>{name}</Text>
            </View>
            <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight style={{ gap: tvSize(14), width: tvSize(760) }}>
                <TVButton
                    label={pin ? "PIN: set" : "Add a PIN"}
                    detail={pin ? "Press OK to remove it" : "Optional: asked before entering this profile"}
                    icon={<Ionicons name={pin ? "lock-closed" : "lock-open-outline"} size={tvSize(22)} color="white" />}
                    onPress={() => !busy && (pin ? setPin(null) : setStep("pin"))}
                />
                <TVButton
                    label={username ? `Import AniList list: ${username}` : "Import an AniList list"}
                    detail={username ? "Press OK to change it" : "Optional: a public list, by user name"}
                    icon={<Ionicons name="cloud-download-outline" size={tvSize(22)} color="white" />}
                    onPress={() => !busy && setStep("username")}
                />
                {firstRun ? (
                    <TVButton
                        label={importServerAccount ? "Import this server's AniList list: yes" : "Import this server's AniList list: no"}
                        detail="If the server was signed in to AniList before profiles"
                        icon={<Ionicons name={importServerAccount ? "checkbox" : "square-outline"} size={tvSize(22)} color="white" />}
                        onPress={() => !busy && setImportServerAccount(current => !current)}
                    />
                ) : null}
                <TVButton
                    label={busy ? "Creating…" : "Create profile"}
                    variant="primary"
                    preferred
                    icon={busy ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="checkmark" size={tvSize(22)} color="white" />}
                    onPress={() => {
                        if (busy || !avatarId) return
                        onCreate({
                            name: name.trim(),
                            avatarId,
                            pin,
                            anilistUsername: username.trim() || null,
                            importServerAccount: firstRun && importServerAccount,
                        })
                    }}
                />
            </TVFocusGuideView>
            <Message text={error} error />
        </Screen>
    )
}

function AvatarChoice({ avatar, uri, selected, preferred, onPress }: { avatar: Avatar; uri: string | null; selected: boolean; preferred?: boolean; onPress: () => void }) {
    const focusState = useTVFocus(1.1, `avatar-${avatar.id}`)
    const size = tvSize(132)
    return (
        <Pressable
            hasTVPreferredFocus={preferred}
            onPress={onPress}
            onFocus={focusState.focus}
            onBlur={focusState.blur}
            accessibilityRole="button"
            accessibilityLabel={avatar.label}
            accessibilityState={{ selected }}
        >
            <Animated.View
                style={[
                    focusState.style,
                    {
                        borderRadius: tvSize(22),
                        borderWidth: TV.focusBorder,
                        borderColor: focusState.focused ? "#ffffff" : selected ? "#9b90ff" : "transparent",
                        padding: tvSize(3),
                    },
                ]}
            >
                <AvatarImage uri={uri} size={size} />
            </Animated.View>
        </Pressable>
    )
}

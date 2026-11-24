import type { SeaError } from "@/api/client/requests"
import type { Profile } from "@/api/generated/types"
import { avatarImageUrl, selectProfile, useGetProfiles } from "@/api/hooks/profiles.hooks"
import { useServerUrl } from "@/atoms/server.atoms"
import { TVDrawer } from "@/components/tv/tv-drawer"
import { useTVFocus } from "@/components/tv/tv-focus"
import { AvatarImage, TVPinPad } from "@/components/tv/tv-profile-picker"
import { tvSize } from "@/components/tv/tv-scale"
import { profileErrorMessage } from "@/lib/profile/profile-errors"
import { useProfileSwitch } from "@/lib/profile/use-profile-switch"
import Ionicons from "@expo/vector-icons/Ionicons"
import * as React from "react"
import { ActivityIndicator, Animated, Pressable, ScrollView, Text, TVFocusGuideView, View } from "react-native"

/**
 * Garceslab Anime: the nav bar's profile switcher, like the web's profile
 * menu: the other profiles (OK enters one, after its PIN if it has one) and
 * "Manage profiles", which leaves for "Who's watching?", where each profile
 * has an Edit button. Back closes it (or leaves the PIN pad first).
 */

function errorText(error: unknown, fallback: string): string {
    const seaError = error as Partial<SeaError> | null
    const code = typeof seaError?.error === "string" ? seaError.error : null
    return profileErrorMessage(code, seaError?.retryAfter) ?? fallback
}

function errorCode(error: unknown): string | null {
    const code = (error as Partial<SeaError> | null)?.error
    return typeof code === "string" ? code : null
}

type Props = {
    open: boolean
    onOpenChange: (open: boolean) => void
    currentProfileId: number | null
}

export function TVProfileSwitcher({ open, onOpenChange, currentProfileId }: Props) {
    if (!open) return null
    return <SwitcherDrawer onOpenChange={onOpenChange} currentProfileId={currentProfileId} />
}

/** Mounted only while open: the profiles are asked for again each time. */
function SwitcherDrawer({ onOpenChange, currentProfileId }: Omit<Props, "open">) {
    const serverUrl = useServerUrl()
    const { changeProfile, switchProfile } = useProfileSwitch()
    const profilesQuery = useGetProfiles(!!serverUrl)
    const profiles = profilesQuery.data ?? []
    const [pinFor, setPinFor] = React.useState<Profile | null>(null)
    const [busyId, setBusyId] = React.useState<number | null>(null)
    const [error, setError] = React.useState<string | null>(null)
    const [pinError, setPinError] = React.useState<string | null>(null)

    const enter = React.useCallback(async (profile: Profile, pin?: string) => {
        setBusyId(profile.id)
        setError(null)
        setPinError(null)
        try {
            const session = await selectProfile(serverUrl, profile.id, pin)
            if (!session?.profileToken) throw new Error("The server didn't open the profile")
            onOpenChange(false)
            changeProfile(session, profile)
        }
        catch (err) {
            if (errorCode(err) === "PROFILE_PIN_REQUIRED") setPinFor(profile)
            else if (pin !== undefined) setPinError(errorText(err, "Couldn't open the profile"))
            else setError(errorText(err, "Couldn't open the profile"))
        }
        finally {
            setBusyId(null)
        }
    }, [changeProfile, onOpenChange, serverUrl])

    const choose = React.useCallback((profile: Profile) => {
        if (busyId !== null) return
        if (profile.id === currentProfileId) {
            onOpenChange(false)
            return
        }
        if (profile.hasPin) {
            setPinError(null)
            setPinFor(profile)
            return
        }
        void enter(profile)
    }, [busyId, currentProfileId, enter, onOpenChange])

    // The profile in use first, then the others in the server's order.
    const ordered = React.useMemo(() => [
        ...profiles.filter(profile => profile.id === currentProfileId),
        ...profiles.filter(profile => profile.id !== currentProfileId),
    ], [currentProfileId, profiles])

    return (
        <TVDrawer
            open
            onOpenChange={onOpenChange}
            // Back on the PIN pad returns to the list (the drawer's Modal gets Back first).
            onRequestClose={pinFor ? () => setPinFor(null) : undefined}
            title="Switch profile"
            subtitle="Profiles"
            width={tvSize(560)}
            focusKey={pinFor ? `pin-${pinFor.id}` : "list"}
        >
            {pinFor ? (
                <View style={{ paddingTop: tvSize(10) }}>
                    <TVPinPad
                        inline
                        title={`Enter ${pinFor.name}'s PIN`}
                        subtitle="With the keypad or the remote's number keys."
                        error={pinError}
                        busy={busyId !== null}
                        onSubmit={pin => void enter(pinFor, pin)}
                        onCancel={() => setPinFor(null)}
                    />
                </View>
            ) : (
                <ScrollView contentContainerStyle={{ paddingHorizontal: tvSize(30), paddingBottom: tvSize(30), gap: tvSize(10) }}>
                    {profilesQuery.isLoading ? (
                        <ActivityIndicator style={{ marginTop: tvSize(30) }} size="large" color="#a89fff" />
                    ) : (
                        <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight style={{ gap: tvSize(10) }}>
                            {ordered.map(profile => (
                                <ProfileRow
                                    key={profile.id}
                                    name={profile.name}
                                    imageUri={avatarImageUrl(serverUrl, profile.avatarUrl)}
                                    locked={profile.hasPin}
                                    current={profile.id === currentProfileId}
                                    busy={busyId === profile.id}
                                    // The first other profile: the one people usually switch to.
                                    preferred={profile.id === ordered.find(item => item.id !== currentProfileId)?.id}
                                    onPress={() => choose(profile)}
                                />
                            ))}
                            <View style={{ height: tvSize(1), backgroundColor: "rgba(255,255,255,0.08)", marginVertical: tvSize(8) }} />
                            <ProfileRow
                                name="Manage profiles"
                                detail="Who's watching? · add, edit or delete"
                                icon="people-outline"
                                preferred={ordered.length <= 1}
                                onPress={() => {
                                    if (busyId !== null) return
                                    onOpenChange(false)
                                    switchProfile()
                                }}
                            />
                        </TVFocusGuideView>
                    )}
                    {error || profilesQuery.error ? (
                        <Text accessibilityLiveRegion="polite" style={{ color: "#fca5a5", fontSize: tvSize(18), marginTop: tvSize(12) }}>
                            {error ?? errorText(profilesQuery.error, "Couldn't load the profiles")}
                        </Text>
                    ) : null}
                </ScrollView>
            )}
        </TVDrawer>
    )
}

function ProfileRow({ name, detail, imageUri, icon, locked, current, busy, preferred, onPress }: {
    name: string
    detail?: string
    imageUri?: string | null
    icon?: React.ComponentProps<typeof Ionicons>["name"]
    locked?: boolean
    current?: boolean
    busy?: boolean
    preferred?: boolean
    onPress: () => void
}) {
    const focusState = useTVFocus(1.03, `switch-${name}`)
    const focused = focusState.focused
    const label = [name, current ? "in use" : null, locked ? "has a PIN" : null].filter(Boolean).join(", ")
    return (
        <Pressable
            hasTVPreferredFocus={preferred}
            onPress={onPress}
            onFocus={focusState.focus}
            onBlur={focusState.blur}
            accessibilityRole="button"
            accessibilityLabel={label}
        >
            <Animated.View
                style={[
                    focusState.style,
                    {
                        flexDirection: "row",
                        alignItems: "center",
                        gap: tvSize(16),
                        padding: tvSize(10),
                        borderRadius: tvSize(18),
                        borderWidth: tvSize(2),
                        borderColor: focused ? "#ffffff" : "transparent",
                        backgroundColor: focused ? "#ffffff" : (current ? "rgba(155,144,255,0.14)" : "rgba(255,255,255,0.04)"),
                    },
                ]}
            >
                {icon ? (
                    <View style={{ width: tvSize(64), height: tvSize(64), borderRadius: tvSize(14), backgroundColor: focused ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name={icon} size={tvSize(30)} color={focused ? "#0a0a0a" : "rgba(255,255,255,0.8)"} />
                    </View>
                ) : (
                    <AvatarImage uri={imageUri ?? null} size={tvSize(64)} />
                )}
                <View style={{ flex: 1, gap: tvSize(2) }}>
                    <Text numberOfLines={1} style={{ color: focused ? "#0a0a0a" : "#ffffff", fontSize: tvSize(22), fontWeight: "600" }}>
                        {name}
                    </Text>
                    {detail || current ? (
                        <Text numberOfLines={1} style={{ color: focused ? "rgba(0,0,0,0.6)" : (current ? "#c4bcff" : "rgba(255,255,255,0.5)"), fontSize: tvSize(16) }}>
                            {detail ?? "In use"}
                        </Text>
                    ) : null}
                </View>
                {busy ? (
                    <ActivityIndicator size="small" color={focused ? "#0a0a0a" : "#ffffff"} />
                ) : locked ? (
                    <Ionicons name="lock-closed" size={tvSize(20)} color={focused ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.55)"} />
                ) : current ? (
                    <Ionicons name="checkmark-circle" size={tvSize(22)} color={focused ? "#0a0a0a" : "#a89fff"} />
                ) : null}
            </Animated.View>
        </Pressable>
    )
}

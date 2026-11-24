import type { Avatar, Profile } from "@/api/generated/types"
import { avatarImageUrl } from "@/api/hooks/profiles.hooks"
import { TVConfirmDrawer } from "@/components/tv/tv-confirm-drawer"
import { TVButton } from "@/components/tv/tv-focus"
import { AvatarImage, Message, Screen, TVAvatarGrid, TVPinPad, TVTextEntry, useBack } from "@/components/tv/tv-profile-picker"
import { tvSize } from "@/components/tv/tv-scale"
import { checkProfileName, deleteProfileQuestion, PROFILE_NAME_MAX_LENGTH, pinActions } from "@/lib/profile/profile-edit"
import Ionicons from "@expo/vector-icons/Ionicons"
import * as React from "react"
import { ActivityIndicator, Text, TVFocusGuideView, View } from "react-native"

/**
 * Garceslab Anime: "Edit profile" on the TV, opened with the Edit button
 * under a profile in "Who's watching?": the name (on-screen keyboard), the
 * avatar, the PIN and "Delete profile". The route
 * (app/(out)/select-profile.tsx) talks to the server; each handler resolves
 * to true once the change is saved.
 */

type Props = {
    serverUrl: string | null
    profile: Profile
    /** The other profiles' names: names are unique. */
    otherNames: readonly string[]
    avatars: Avatar[]
    avatarsLoading: boolean
    busy: boolean
    error?: string | null
    onRename: (name: string) => Promise<boolean>
    onAvatar: (avatarId: string) => Promise<boolean>
    onPin: (pin: string | null) => Promise<boolean>
    onDelete: () => void
    onDone: () => void
}

type Step = "menu" | "name" | "avatar" | "pin"

export function TVEditProfile({ serverUrl, profile, otherNames, avatars, avatarsLoading, busy, error, onRename, onAvatar, onPin, onDelete, onDone }: Props) {
    const [step, setStep] = React.useState<Step>("menu")
    const [name, setName] = React.useState(profile.name)
    const [nameError, setNameError] = React.useState<string | null>(null)
    const [confirmDelete, setConfirmDelete] = React.useState(false)
    // The menu button to focus when coming back from a step.
    const [lastAction, setLastAction] = React.useState<string>("name")

    const back = (action: string) => {
        setLastAction(action)
        setStep("menu")
    }

    useBack(busy ? () => true : () => {
        if (step === "menu") onDone()
        else back(step)
        return true
    })

    if (step === "pin") {
        return (
            <TVPinPad
                title={profile.hasPin ? `New PIN for ${profile.name}` : `Add a PIN to ${profile.name}`}
                subtitle="Asked before entering or editing this profile on the TV. Type 4 to 6 digits."
                submitLabel="Save"
                busy={busy}
                error={error}
                onSubmit={pin => {
                    void onPin(pin).then(ok => ok && back("pin"))
                }}
                onCancel={() => back("pin")}
            />
        )
    }

    if (step === "name") {
        return (
            <TVTextEntry
                title="Rename the profile"
                subtitle="Type the new name with the keyboard below."
                value={name}
                placeholder="Name"
                onChange={value => {
                    setName(value)
                    setNameError(null)
                }}
                maxLength={PROFILE_NAME_MAX_LENGTH}
                capitalize="words"
                error={nameError ?? error}
            >
                <TVButton
                    label={busy ? "Saving…" : "Save"}
                    variant="primary"
                    disabled={!name.trim()}
                    icon={busy ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="checkmark" size={tvSize(22)} color="white" />}
                    onPress={() => {
                        if (busy) return
                        const check = checkProfileName(name, otherNames)
                        if (!check.ok) {
                            setNameError(check.message)
                            return
                        }
                        if (check.name === profile.name) {
                            back("name")
                            return
                        }
                        void onRename(check.name).then(ok => ok && back("name"))
                    }}
                />
                <TVButton label="Cancel" variant="ghost" onPress={() => {
                    setName(profile.name)
                    setNameError(null)
                    back("name")
                }} />
            </TVTextEntry>
        )
    }

    if (step === "avatar") {
        return (
            <Screen title="Choose an avatar" subtitle={busy ? "Saving…" : `For ${profile.name}. Press OK on the one you like.`}>
                <TVAvatarGrid
                    serverUrl={serverUrl}
                    avatars={avatars}
                    loading={avatarsLoading}
                    selectedId={profile.avatarId}
                    onPick={item => {
                        if (busy) return
                        if (item.id === profile.avatarId) {
                            back("avatar")
                            return
                        }
                        void onAvatar(item.id).then(ok => ok && back("avatar"))
                    }}
                />
                <Message text={error} error />
            </Screen>
        )
    }

    const question = deleteProfileQuestion(profile.name)
    const icon = (name: React.ComponentProps<typeof Ionicons>["name"]) => <Ionicons name={name} size={tvSize(22)} color="white" />
    return (
        <Screen title="Edit profile" subtitle={busy ? "Saving…" : null}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: tvSize(30), marginBottom: tvSize(34) }}>
                <AvatarImage uri={avatarImageUrl(serverUrl, profile.avatarUrl)} size={tvSize(140)} />
                <View style={{ gap: tvSize(6) }}>
                    <Text className="font-bold text-white" style={{ fontSize: tvSize(38) }}>{profile.name}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: tvSize(8) }}>
                        <Ionicons name={profile.hasPin ? "lock-closed" : "lock-open-outline"} size={tvSize(18)} color="rgba(255,255,255,0.55)" />
                        <Text className="text-white/55" style={{ fontSize: tvSize(19) }}>{profile.hasPin ? "Has a PIN" : "No PIN"}</Text>
                    </View>
                </View>
            </View>
            <TVFocusGuideView autoFocus trapFocusLeft trapFocusRight style={{ gap: tvSize(14), width: tvSize(760) }}>
                <TVButton
                    label="Rename"
                    detail={profile.name}
                    hasTVPreferredFocus={lastAction === "name"}
                    icon={icon("create-outline")}
                    onPress={() => {
                        if (busy) return
                        setName(profile.name)
                        setNameError(null)
                        setStep("name")
                    }}
                />
                <TVButton
                    label="Change avatar"
                    detail="Pick another picture"
                    hasTVPreferredFocus={lastAction === "avatar"}
                    icon={icon("happy-outline")}
                    onPress={() => !busy && setStep("avatar")}
                />
                {pinActions(profile.hasPin).map((action, index) => (
                    <TVButton
                        key={action.kind}
                        label={action.label}
                        detail={action.detail}
                        hasTVPreferredFocus={lastAction === "pin" && index === 0}
                        icon={icon(action.kind === "remove" ? "lock-open-outline" : "keypad-outline")}
                        onPress={() => {
                            if (busy) return
                            if (action.kind === "remove") {
                                setLastAction("pin")
                                void onPin(null)
                            } else {
                                setStep("pin")
                            }
                        }}
                    />
                ))}
                <TVButton
                    label="Delete profile"
                    detail={`Moves ${profile.name} to the trash`}
                    variant="danger"
                    icon={icon("trash-outline")}
                    onPress={() => !busy && setConfirmDelete(true)}
                />
                <View style={{ height: tvSize(6) }} />
                <TVButton
                    label="Done"
                    variant="primary"
                    icon={icon("checkmark")}
                    onPress={() => !busy && onDone()}
                />
            </TVFocusGuideView>
            <Message text={error} error />
            <TVConfirmDrawer
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title={question.title}
                text={question.text}
                confirmLabel="Delete"
                danger
                onConfirm={onDelete}
            />
        </Screen>
    )
}

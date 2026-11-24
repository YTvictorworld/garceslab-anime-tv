import type { SeaError } from "@/api/client/requests"
import type { Profile } from "@/api/generated/types"
import {
    createProfile,
    deleteProfile,
    importAnilistList,
    importServerAccountList,
    logoutProfile,
    selectProfile,
    setProfilePin,
    updateProfile,
    useGetAvatarCatalog,
    useGetProfiles,
} from "@/api/hooks/profiles.hooks"
import { useGetStatus } from "@/api/hooks/status.hooks"
import { useServerUrl } from "@/atoms/server.atoms"
import { TVEditProfile } from "@/components/tv/tv-profile-editor"
import { type CreateProfileInput, TVCreateProfile, TVPinPad, TVProfilePicker } from "@/components/tv/tv-profile-picker"
import { profileErrorMessage, serverHasProfiles } from "@/lib/profile/profile-errors"
import { getProfileSessionEnd, setProfileSession } from "@/lib/profile/profile-session"
import { useProfileSwitch } from "@/lib/profile/use-profile-switch"
import { logger } from "@/lib/utils/logger"
import { toast } from "@/lib/utils/toast"
import { router } from "expo-router"
import * as React from "react"
import { View } from "react-native"

const log = logger("select-profile")

function errorText(error: unknown, fallback: string): string {
    const seaError = error as Partial<SeaError> | null
    const code = typeof seaError?.error === "string" ? seaError.error : null
    return profileErrorMessage(code, seaError?.retryAfter) ?? (code ? `${fallback} (${code})` : fallback)
}

function errorCode(error: unknown): string | null {
    const code = (error as Partial<SeaError> | null)?.error
    return typeof code === "string" ? code : null
}

type Mode =
    | { kind: "pick" }
    | { kind: "pin"; profile: Profile }
    | { kind: "create" }
    /** Its PIN, before editing a profile that has one. */
    | { kind: "manage-pin"; profile: Profile }
    /** "Edit profile", with a session of the edited profile (see openEditor). */
    | { kind: "edit"; profile: Profile; token: string }

/** The edit session is gone (PIN changed elsewhere, profile deleted): start over from the picker. */
function isSessionError(code: string | null) {
    return code === "PROFILE_REQUIRED" || code === "PROFILE_INVALID_TOKEN" || code === "PROFILE_NOT_FOUND" || code === "PROFILE_DELETED"
}

/**
 * Garceslab Anime: "Who's watching?", on every cold launch of the TV app
 * (the profile session is kept in memory only), and "Create your profile"
 * on a server without profiles yet. A server that doesn't advertise
 * profiles skips straight to the app.
 */
export default function SelectProfileScreen() {
    const serverUrl = useServerUrl()
    const { enterProfile } = useProfileSwitch()
    const status = useGetStatus({ enabled: !!serverUrl })
    const statusKnown = status.isFetchedAfterMount && !!status.data
    const hasProfiles = serverHasProfiles(status.data)
    const needsSetup = !!status.data?.profiles?.needsSetup

    const profilesQuery = useGetProfiles(!!serverUrl && hasProfiles && !needsSetup)
    const profiles = React.useMemo(() => profilesQuery.data ?? [], [profilesQuery.data])
    const [mode, setMode] = React.useState<Mode>({ kind: "pick" })
    const creating = mode.kind === "create" || (statusKnown && needsSetup)
    const avatars = useGetAvatarCatalog(!!serverUrl && hasProfiles && (creating || mode.kind === "edit"))

    const [busyProfileId, setBusyProfileId] = React.useState<number | null>(null)
    const [pinError, setPinError] = React.useState<string | null>(null)
    const [pickError, setPickError] = React.useState<string | null>(null)
    const [createError, setCreateError] = React.useState<string | null>(null)
    const [createBusy, setCreateBusy] = React.useState(false)
    const [createProgress, setCreateProgress] = React.useState<string | null>(null)
    const [ended] = React.useState(getProfileSessionEnd)
    const [editBusy, setEditBusy] = React.useState(false)
    const [editError, setEditError] = React.useState<string | null>(null)
    // The profile to focus in the picker after editing it.
    const [lastEditedId, setLastEditedId] = React.useState<number | null>(null)

    React.useEffect(() => {
        if (!serverUrl) {
            router.replace("/(out)/set-server-url")
            return
        }
        // A stock Seanime server (or one with profiles off): nothing to pick.
        if (statusKnown && !hasProfiles) router.replace("/(app)/(tabs)/(library)")
    }, [hasProfiles, serverUrl, statusKnown])

    React.useEffect(() => {
        if (errorCode(profilesQuery.error) === "UNAUTHENTICATED" || errorCode(status.error) === "UNAUTHENTICATED") {
            router.replace("/(out)/set-server-url")
        }
    }, [profilesQuery.error, status.error])

    const enter = React.useCallback(async (profile: Profile, pin?: string) => {
        setBusyProfileId(profile.id)
        setPinError(null)
        setPickError(null)
        try {
            const session = await selectProfile(serverUrl, profile.id, pin)
            if (!session?.profileToken) throw new Error("The server didn't open the profile")
            enterProfile(session, profile)
        }
        catch (error) {
            log.warning("Selecting the profile failed", errorCode(error))
            const code = errorCode(error)
            if (code === "PROFILE_PIN_REQUIRED") {
                setMode({ kind: "pin", profile })
            } else if (pin !== undefined) {
                // 403 wrong PIN, 429 locked: stay on the keypad with the reason.
                setPinError(errorText(error, "Couldn't open the profile"))
            } else {
                setPickError(errorText(error, "Couldn't open the profile"))
            }
            if (code === "PROFILE_NOT_FOUND" || code === "PROFILE_DELETED") {
                setMode({ kind: "pick" })
                void profilesQuery.refetch()
            }
        }
        finally {
            setBusyProfileId(null)
        }
    }, [enterProfile, profilesQuery, serverUrl])

    const onSelect = React.useCallback((profile: Profile) => {
        if (profile.hasPin) {
            setPinError(null)
            setMode({ kind: "pin", profile })
            return
        }
        void enter(profile)
    }, [enter])

    /**
     * Editing needs a session of the edited profile: the server's profile
     * routes take one, and "Who's watching?" has none. Opening it asks for the
     * profile's PIN, if it has one, as entering it does: the PIN keeps others
     * from changing the profile on the TV by mistake too.
     */
    const openEditor = React.useCallback(async (profile: Profile, pin?: string) => {
        setBusyProfileId(profile.id)
        setPinError(null)
        setPickError(null)
        setEditError(null)
        try {
            const session = await selectProfile(serverUrl, profile.id, pin)
            if (!session?.profileToken) throw new Error("The server didn't open the profile")
            setLastEditedId(profile.id)
            setMode({ kind: "edit", profile: session.profile ?? profile, token: session.profileToken })
        }
        catch (error) {
            log.warning("Opening the profile to edit it failed", errorCode(error))
            const code = errorCode(error)
            if (code === "PROFILE_PIN_REQUIRED") {
                setMode({ kind: "manage-pin", profile })
            } else if (pin !== undefined) {
                setPinError(errorText(error, "Couldn't open the profile"))
            } else {
                setPickError(errorText(error, "Couldn't open the profile"))
            }
            if (code === "PROFILE_NOT_FOUND" || code === "PROFILE_DELETED") {
                setMode({ kind: "pick" })
                void profilesQuery.refetch()
            }
        }
        finally {
            setBusyProfileId(null)
        }
    }, [profilesQuery, serverUrl])

    const onManage = React.useCallback((profile: Profile) => {
        if (profile.hasPin) {
            setPinError(null)
            setMode({ kind: "manage-pin", profile })
            return
        }
        void openEditor(profile)
    }, [openEditor])

    /** Back to the picker; the edit session ends (the device no longer shows as in that profile). */
    const closeEditor = React.useCallback((token: string | null) => {
        if (token) void logoutProfile(serverUrl, token).catch(() => undefined)
        setEditError(null)
        setMode({ kind: "pick" })
        void profilesQuery.refetch()
    }, [profilesQuery, serverUrl])

    /** Runs one change with the edit session; false (and a message) when it failed. */
    const runEdit = React.useCallback(async (action: (token: string, profile: Profile) => Promise<Profile | null>) => {
        if (mode.kind !== "edit") return false
        setEditBusy(true)
        setEditError(null)
        try {
            const updated = await action(mode.token, mode.profile)
            if (updated) setMode(current => current.kind === "edit" ? { ...current, profile: updated } : current)
            return true
        }
        catch (error) {
            const code = errorCode(error)
            log.warning("Editing the profile failed", code)
            if (isSessionError(code)) {
                setPickError("The profile changed meanwhile. Open it again to edit it.")
                closeEditor(null)
            } else {
                setEditError(errorText(error, "Couldn't save the change"))
            }
            return false
        }
        finally {
            setEditBusy(false)
        }
    }, [closeEditor, mode])

    const onRename = React.useCallback((name: string) => runEdit(async (token, profile) => {
        return (await updateProfile(serverUrl, profile.id, { name }, token)) ?? null
    }), [runEdit, serverUrl])

    const onAvatar = React.useCallback((avatarId: string) => runEdit(async (token, profile) => {
        return (await updateProfile(serverUrl, profile.id, { avatarId }, token)) ?? null
    }), [runEdit, serverUrl])

    const onPin = React.useCallback((pin: string | null) => runEdit(async (token, profile) => {
        await setProfilePin(serverUrl, profile.id, pin, token)
        // A new PIN closes the profile's sessions, this one too: open a new one with it.
        const session = await selectProfile(serverUrl, profile.id, pin ?? undefined)
        if (!session?.profileToken) throw new Error("The server didn't open the profile")
        const next = session.profile ?? { ...profile, hasPin: !!pin }
        setMode(current => current.kind === "edit" ? { ...current, token: session.profileToken } : current)
        toast.success(pin ? `${profile.name}'s PIN was saved` : `${profile.name}'s PIN was removed`)
        return next
    }), [runEdit, serverUrl])

    const onDelete = React.useCallback(() => {
        if (mode.kind !== "edit") return
        const { profile, token } = mode
        setEditBusy(true)
        setEditError(null)
        void deleteProfile(serverUrl, profile.id, token)
            .then(() => {
                toast.success(`${profile.name} was moved to the trash`)
                setLastEditedId(null)
                closeEditor(token)
            })
            .catch((error) => {
                log.warning("Deleting the profile failed", errorCode(error))
                setEditError(errorText(error, "Couldn't delete the profile"))
            })
            .finally(() => setEditBusy(false))
    }, [closeEditor, mode, serverUrl])

    const onCreate = React.useCallback(async (input: CreateProfileInput) => {
        setCreateBusy(true)
        setCreateError(null)
        setCreateProgress("Creating the profile…")
        try {
            const profile = await createProfile(serverUrl, {
                name: input.name,
                avatarId: input.avatarId,
                ...(input.pin ? { pin: input.pin } : {}),
            })
            if (!profile) throw new Error("The server didn't create the profile")
            setCreateProgress("Opening the profile…")
            const session = await selectProfile(serverUrl, profile.id, input.pin ?? undefined)
            if (!session?.profileToken) throw new Error("The server didn't open the profile")
            // Imports need the new profile's session (they write its list); they are optional,
            // so a failure is reported and the profile opens anyway.
            setProfileSession({ profileToken: session.profileToken, expiresAt: session.expiresAt, profile: session.profile ?? profile })
            if (input.importServerAccount) {
                setCreateProgress("Importing this server's AniList list…")
                try {
                    const result = await importServerAccountList(serverUrl, profile.id)
                    if (result) toast.success(`Imported ${result.imported + result.updated} entries from this server's AniList list`)
                }
                catch (error) {
                    // A server that never had an AniList account has nothing to import: not worth a word.
                    if (errorCode(error) !== "PROFILE_IMPORT_NOTHING_TO_IMPORT") {
                        toast.info(`This server's AniList list wasn't imported: ${errorText(error, "it isn't available")}`)
                    }
                }
            }
            if (input.anilistUsername) {
                setCreateProgress(`Importing ${input.anilistUsername}'s AniList list…`)
                try {
                    const result = await importAnilistList(serverUrl, profile.id, input.anilistUsername)
                    if (result) toast.success(`Imported ${result.imported + result.updated} entries from AniList`)
                }
                catch (error) {
                    toast.error(`The AniList list wasn't imported: ${errorText(error, "AniList didn't answer")}`)
                }
            }
            enterProfile(session, profile)
        }
        catch (error) {
            log.warning("Creating the profile failed", errorCode(error))
            setCreateError(errorText(error, "Couldn't create the profile"))
            setCreateProgress(null)
        }
        finally {
            setCreateBusy(false)
        }
    }, [enterProfile, serverUrl])

    if (!statusKnown && !status.data) {
        return <View className="bg-background flex-1" />
    }

    if (creating) {
        return (
            <TVCreateProfile
                serverUrl={serverUrl}
                avatars={avatars.data ?? []}
                avatarsLoading={avatars.isLoading}
                firstRun={needsSetup}
                busy={createBusy}
                progress={createProgress}
                error={createError}
                onCreate={input => void onCreate(input)}
                onCancel={needsSetup ? undefined : () => setMode({ kind: "pick" })}
            />
        )
    }

    if (mode.kind === "edit") {
        return (
            <TVEditProfile
                key={mode.profile.id}
                serverUrl={serverUrl}
                profile={mode.profile}
                otherNames={profiles.filter(profile => profile.id !== mode.profile.id).map(profile => profile.name)}
                avatars={avatars.data ?? []}
                avatarsLoading={avatars.isLoading}
                busy={editBusy}
                error={editError}
                onRename={onRename}
                onAvatar={onAvatar}
                onPin={onPin}
                onDelete={onDelete}
                onDone={() => closeEditor(mode.token)}
            />
        )
    }

    if (mode.kind === "manage-pin") {
        return (
            <TVPinPad
                title={`Enter ${mode.profile.name}'s PIN`}
                subtitle="To edit this profile. Type its 4 to 6 digit PIN with the keypad or the remote's number keys."
                error={pinError}
                busy={busyProfileId !== null}
                onSubmit={pin => void openEditor(mode.profile, pin)}
                onCancel={() => {
                    setPinError(null)
                    setMode({ kind: "pick" })
                }}
            />
        )
    }

    if (mode.kind === "pin") {
        return (
            <TVPinPad
                title={`Enter ${mode.profile.name}'s PIN`}
                error={pinError}
                busy={busyProfileId !== null}
                onSubmit={pin => void enter(mode.profile, pin)}
                onCancel={() => {
                    setPinError(null)
                    setMode({ kind: "pick" })
                }}
            />
        )
    }

    return (
        <TVProfilePicker
            serverUrl={serverUrl}
            profiles={profiles}
            loading={profilesQuery.isLoading}
            busyProfileId={busyProfileId}
            message={ended === "expired" || ended === "rejected" ? "Your session ended. Choose a profile to continue." : null}
            error={pickError ?? (profilesQuery.error ? errorText(profilesQuery.error, "Couldn't load the profiles") : null)}
            onSelect={onSelect}
            onManage={onManage}
            initialProfileId={lastEditedId}
            onAdd={() => {
                setCreateError(null)
                setMode({ kind: "create" })
            }}
            onRetry={() => void profilesQuery.refetch()}
        />
    )
}

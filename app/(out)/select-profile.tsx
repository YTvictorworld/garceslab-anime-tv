import type { SeaError } from "@/api/client/requests"
import type { Profile } from "@/api/generated/types"
import {
    createProfile,
    importAnilistList,
    importServerAccountList,
    selectProfile,
    useGetAvatarCatalog,
    useGetProfiles,
} from "@/api/hooks/profiles.hooks"
import { useGetStatus } from "@/api/hooks/status.hooks"
import { useServerUrl } from "@/atoms/server.atoms"
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

type Mode = { kind: "pick" } | { kind: "pin"; profile: Profile } | { kind: "create" }

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
    const avatars = useGetAvatarCatalog(!!serverUrl && hasProfiles && creating)

    const [busyProfileId, setBusyProfileId] = React.useState<number | null>(null)
    const [pinError, setPinError] = React.useState<string | null>(null)
    const [pickError, setPickError] = React.useState<string | null>(null)
    const [createError, setCreateError] = React.useState<string | null>(null)
    const [createBusy, setCreateBusy] = React.useState(false)
    const [createProgress, setCreateProgress] = React.useState<string | null>(null)
    const [ended] = React.useState(getProfileSessionEnd)

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
            onAdd={() => {
                setCreateError(null)
                setMode({ kind: "create" })
            }}
            onRetry={() => void profilesQuery.refetch()}
        />
    )
}

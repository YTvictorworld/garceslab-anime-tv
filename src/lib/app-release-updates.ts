import { getStoredString, setStoredString } from "@/atoms/storage"
import { APP_RELEASE_API_URL, APP_RELEASE_URL, compareSemverLike } from "@/lib/app-release"
import { appUpdateNoticeAllowed, embeddedBuildIdentity } from "@/lib/build-identity"
import { isManualOfflineModeEnabled } from "@/lib/connection-state"
import { toast } from "@/lib/utils/toast"
import Constants from "expo-constants"
import * as React from "react"
import { Alert, Linking, Platform } from "react-native"

type AppRelease = {
    tagName: string
    htmlUrl: string
    name?: string
}

const APP_RELEASE_CHECK_DELAY_MS = 10000
const DISMISSED_APP_RELEASE_VERSION_KEY = "sea-app-release-dismissed-version"

// Garceslab Anime: on the TV builds only the stable channel checks GitHub's latest release;
// nightly and dev builds never show the notice (docs/releasing.md, "Release channels").
function updateNoticeAllowed(): boolean {
    const identity = embeddedBuildIdentity(Constants.expoConfig?.version ?? "0.0.0")
    return appUpdateNoticeAllowed(identity, Platform.OS === "web")
}

export function AppReleaseUpdatePrompt() {
    const promptShownRef = React.useRef(false)

    React.useEffect(() => {
        if (__DEV__ || isManualOfflineModeEnabled() || !updateNoticeAllowed()) {
            return
        }

        let cancelled = false

        const checkTimeout = setTimeout(() => {
            void findAvailableAppRelease()
                .then(release => {
                    if (cancelled || promptShownRef.current || !release) {
                        return
                    }

                    const dismissedVersion = getStoredString(DISMISSED_APP_RELEASE_VERSION_KEY)
                    if (dismissedVersion === release.tagName) {
                        return
                    }

                    promptShownRef.current = true
                    promptAppReleaseUpdate(release)
                })
                .catch(() => {
                    // expected
                })
        }, APP_RELEASE_CHECK_DELAY_MS)

        return () => {
            cancelled = true
            clearTimeout(checkTimeout)
        }
    }, [])

    return null
}

export async function checkForAppReleaseUpdateManually(): Promise<void> {
    if (!updateNoticeAllowed()) {
        toast.info("Update checks are for stable builds")
        return
    }

    if (isManualOfflineModeEnabled()) {
        toast.info("Disable offline mode to check app updates")
        return
    }

    try {
        const release = await findAvailableAppRelease()
        if (!release) {
            toast.info("No app update found")
            return
        }

        promptAppReleaseUpdate(release)
    }
    catch {
        toast.error("Failed to check app update")
    }
}

async function findAvailableAppRelease(): Promise<AppRelease | null> {
    const latestRelease = await fetchLatestAppRelease()
    if (!latestRelease) {
        return null
    }

    const currentVersion = Constants.expoConfig?.version ?? "0.0.0"
    return compareSemverLike(latestRelease.tagName, currentVersion) > 0 ? latestRelease : null
}

async function fetchLatestAppRelease(): Promise<AppRelease | null> {
    const response = await fetch(APP_RELEASE_API_URL, {
        headers: {
            Accept: "application/vnd.github+json",
        },
    })

    if (response.status === 404) {
        return null
    }

    if (!response.ok) {
        throw new Error(`github release check failed with ${response.status}`)
    }

    const payload: unknown = await response.json()
    if (!isRecord(payload) || payload.draft === true) {
        return null
    }

    const tagName = readString(payload.tag_name)
    if (!tagName) {
        return null
    }

    return {
        tagName,
        htmlUrl: readString(payload.html_url) ?? APP_RELEASE_URL,
        name: readString(payload.name),
    }
}

function promptAppReleaseUpdate(release: AppRelease) {
    const releaseName = release.name ?? release.tagName

    Alert.alert(
        "App update available",
        `${releaseName} is ready to download.`,
        [
            {
                text: "Later",
                style: "cancel",
                onPress: () => {
                    setStoredString(DISMISSED_APP_RELEASE_VERSION_KEY, release.tagName)
                },
            },
            {
                text: "Open",
                onPress: () => {
                    void Linking.openURL(release.htmlUrl)
                },
            },
        ],
    )
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

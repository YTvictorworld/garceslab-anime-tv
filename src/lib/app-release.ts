// Pure helpers of the in-app "App update available" check (app-release-updates.ts), kept
// free of react-native imports so tests/app-version.test.ts can import them.

// Garceslab Anime TV's own releases (docs/releasing.md). Seanime Tenji's releases
// (5rahim/seanime-tenji) are a different app with its own version numbers.
export const APP_RELEASE_REPOSITORY = "YTvictorworld/garceslab-anime-tv"
export const APP_RELEASE_URL = `https://github.com/${APP_RELEASE_REPOSITORY}/releases/latest`
export const APP_RELEASE_API_URL = `https://api.github.com/repos/${APP_RELEASE_REPOSITORY}/releases/latest`

export function compareSemverLike(nextVersion: string, currentVersion: string): number {
    const nextParts = parseSemverLike(nextVersion)
    const currentParts = parseSemverLike(currentVersion)

    for (let index = 0; index < 3; index += 1) {
        const nextPart = nextParts[index] ?? 0
        const currentPart = currentParts[index] ?? 0
        if (nextPart > currentPart) return 1
        if (nextPart < currentPart) return -1
    }

    return 0
}

function parseSemverLike(value: string): number[] {
    const cleanValue = value.trim().replace(/^v/i, "").split("-")[0]
    return cleanValue.split(".").slice(0, 3).map(part => {
        const parsed = Number.parseInt(part, 10)
        return Number.isFinite(parsed) ? parsed : 0
    })
}

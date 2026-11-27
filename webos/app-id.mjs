/**
 * Which app id a webOS build is packaged under, and the id the app itself is told.
 *
 * Without WEBOS_APP_ID it is the main app (appinfo.json's `app.seanime.tenji`, the nightly and
 * stable builds). WEBOS_APP_ID (and optionally WEBOS_APP_TITLE) makes a side-by-side test
 * build, e.g. GA Test (`app.garceslab.anime.test`, .github/workflows/ga-test.yml). The app
 * gets the custom id as EXPO_PUBLIC_WEBOS_APP_ID, inlined by the Expo export: the relay
 * service name (luna-websocket.ts) and GA Test's TEST ENVIRONMENT tag
 * (src/lib/test-environment.ts) are decided from it at build time. A main-app build never has
 * it, even when the shell still exports one.
 *
 * @param {{ appinfo: { id: string, title: string }, env?: Record<string, string | undefined> }} options
 * @returns {{ id: string, title: string, custom: boolean, embeddedAppId: string | undefined }}
 */
export function resolveAppId({ appinfo, env = {} }) {
    const customId = env.WEBOS_APP_ID?.trim()
    if (!customId) return { id: appinfo.id, title: appinfo.title, custom: false, embeddedAppId: undefined }
    // webOS ids: lowercase letters, digits, dots and dashes, starting with a letter.
    if (!/^[a-z][a-z0-9.-]*$/.test(customId)) {
        throw new Error(`WEBOS_APP_ID "${customId}" is not a valid webOS app id (lowercase letters, digits, "." and "-")`)
    }
    return {
        id: customId,
        title: env.WEBOS_APP_TITLE?.trim() || `${appinfo.title} (${customId})`,
        custom: true,
        embeddedAppId: customId,
    }
}

/** Sets or removes EXPO_PUBLIC_WEBOS_APP_ID in `env` (process.env) before the export. */
export function applyEmbeddedAppId(env, embeddedAppId) {
    if (embeddedAppId) env.EXPO_PUBLIC_WEBOS_APP_ID = embeddedAppId
    else delete env.EXPO_PUBLIC_WEBOS_APP_ID
}

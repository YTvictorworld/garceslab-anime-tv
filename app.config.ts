import type { ConfigContext, ExpoConfig } from "expo/config"

// Garceslab Anime: OTA updates are off. The manifest URLs below are Seanime Tenji's own
// update service, which would replace this app's code with Seanime Tenji's.
// (The webOS build doesn't use expo-updates either way.)
const OTA_UPDATES_ENABLED = false

export default ({ config }: ConfigContext): ExpoConfig => {
    const isTV = process.env.EXPO_TV === "1"
    const isTVDev = isTV && process.env.SEANIME_TV_DEV === "1"
    const version = "0.4.0"
    const otaChannel = isTV ? "stable-tv" : "stable"
    const otaUrl = isTV
        ? "https://seanime.app/api/ota/tv/manifest"
        : "https://seanime.app/api/ota/manifest"

    return {
        ...config,
        name: "Garceslab Anime",
        slug: "seanime-app",
        version,
        orientation: isTV ? "default" : "portrait",
        icon: "./src/assets/images/icon.png",
        scheme: "seanime",
        userInterfaceStyle: "automatic",
        runtimeVersion: isTV ? `${version}-tv` : { policy: "appVersion" },
        updates: !OTA_UPDATES_ENABLED || isTVDev ? {
            enabled: false,
        } : {
            enabled: true,
            url: otaUrl,
            checkAutomatically: "NEVER",
            fallbackToCacheTimeout: 0,
            requestHeaders: {
                "expo-channel-name": otaChannel,
            },
        },
        ios: {
            buildNumber: "24",
            appleTeamId: process.env.EXPO_APPLE_TEAM_ID || "",
            supportsTablet: true,
            bundleIdentifier: process.env.EXPO_IOS_BUNDLE_ID || "app.seanime.tenji",
            infoPlist: {
                NSLocalNetworkUsageDescription: "Seanime needs local network access to connect to your server on your home network.",
                UIBackgroundModes: [
                    "audio",
                ],
                LSApplicationQueriesSchemes: [
                    "vlc",
                    "outplayer",
                    "infuse",
                    "nplayer-http",
                    "oplayer",
                    "mangoplayer",
                ],
                UISupportedInterfaceOrientations: [
                    "UIInterfaceOrientationPortrait",
                    "UIInterfaceOrientationPortraitUpsideDown",
                    "UIInterfaceOrientationLandscapeLeft",
                    "UIInterfaceOrientationLandscapeRight",
                ],
                "UISupportedInterfaceOrientations~ipad": [
                    "UIInterfaceOrientationPortrait",
                    "UIInterfaceOrientationPortraitUpsideDown",
                    "UIInterfaceOrientationLandscapeLeft",
                    "UIInterfaceOrientationLandscapeRight",
                ],
            },
        },
        android: {
            jsEngine: "hermes",
            versionCode: 24,
            usesCleartextTraffic: true,
            adaptiveIcon: {
                foregroundImage: "./src/assets/images/adaptive-icon.png",
                backgroundColor: "#2b0e38",
            },
            permissions: [
                "WRITE_SETTINGS",
            ],
            package: "app.seanime.tenji",
        } as any,
        plugins: [
            [
                "@react-native-tvos/config-tv",
                {
                    androidTVRequired: false,
                    androidTVBanner: "./src/assets/images/tv/android-tv-banner.png",
                    androidTVIcon: "./src/assets/images/icon.png",
                    appleTVImages: {
                        icon: "./src/assets/images/tv/tvos-icon.png",
                        iconSmall: "./src/assets/images/tv/tvos-icon-small.png",
                        iconSmall2x: "./src/assets/images/tv/tvos-icon-small-2x.png",
                        topShelf: "./src/assets/images/tv/tvos-top-shelf.png",
                        topShelf2x: "./src/assets/images/tv/tvos-top-shelf-2x.png",
                        topShelfWide: "./src/assets/images/tv/tvos-top-shelf-wide.png",
                        topShelfWide2x: "./src/assets/images/tv/tvos-top-shelf-wide-2x.png",
                    },
                },
            ],
            "expo-router",
            [
                "expo-splash-screen",
                {
                    image: "./src/assets/images/splash-logo.png",
                    resizeMode: "contain",
                    backgroundColor: "#0d0b0f",
                    android: {
                        imageWidth: 200,
                        resizeMode: "contain",
                    },
                    ios: {
                        imageWidth: 100,
                        resizeMode: "contain",
                    },
                },
            ],
            "expo-font",
            "expo-status-bar",
            ["expo-navigation-bar", { enforceContrast: false }],
            "@react-native-community/datetimepicker",
            "./plugins/withAndroidExternalPlayerQueries",
            "./plugins/withAndroidLanCleartext",
            "./plugins/withAndroidGradleProperties",
            "./plugins/withLibcppPickFirst",
            "./plugins/withPiPSupport",
            "./plugins/withMPVKitiOS",
            "./plugins/withPodDeploymentTarget",
            "./plugins/withExpoDownloadManageriOS",
            "./plugins/withExpoOfflineLoggeriOS",
            "expo-updates",
            ["expo-image", { disableLibdav1d: isTV }],
        ],
        web: {
            // The webOS build is a single-page app loaded from file://.
            output: "single",
        },
        experiments: {
            typedRoutes: true,
            reactCompiler: true,
        },
        extra: {
            ...config.extra,
            tv: {
                enabled: isTV,
                isDev: isTVDev,
            },
        },
    }
}

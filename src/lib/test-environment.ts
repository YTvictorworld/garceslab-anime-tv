// Garceslab Anime: the "TEST ENVIRONMENT" tag of the GA Test app (docs/testing-on-tv.md, "The
// GA Test app"). GA Test is the side-by-side build CI makes for PRs labelled needs-tv-test
// (.github/scripts/ga-test-check.sh). It looks just like the main app on the TV, so it shows
// this tag in the top right corner on every screen.
//
// Whether a build is GA Test is decided at build time from its app id: webos/build.mjs passes
// WEBOS_APP_ID to the app as EXPO_PUBLIC_WEBOS_APP_ID (and removes it from every other build),
// and the Expo export inlines it. Nothing read at runtime can turn the tag on or off.
//
// The tag is a plain DOM element appended to <body>, outside the React tree, so it stays up on
// every route, over error screens and over the player, drawers and modals (highest z-index),
// and never re-renders. It isn't focusable and lets the pointer and the wheel through.
// Pure (no react-native imports) so tests/test-environment.test.ts can import it.

/** The GA Test app id; keep it in sync with APP_ID in .github/scripts/ga-test-check.sh. */
export const GA_TEST_APP_ID = "app.garceslab.anime.test"

export const TEST_ENVIRONMENT_LABEL = "TEST ENVIRONMENT"

/** id of the badge container; other GA Test-only badges (#30's "DEBUG") go in it too. */
export const ENVIRONMENT_BADGES_ID = "ga-environment-badges"

/** Above everything the app draws (drawers use 9999, react-native-web's Modal 9999). */
const TOP_Z_INDEX = 2147483647

/** True only for the GA Test app id; the main app (no id, or app.seanime.tenji) is false. */
export function isGaTestBuild(appId: string | null | undefined): boolean {
    return appId?.trim() === GA_TEST_APP_ID
}

export type BadgeColors = { background: string; text: string }

/** Amber with near-black text: reads as a warning and isn't the app's lilac. */
export const TEST_ENVIRONMENT_COLORS: BadgeColors = { background: "#fbbf24", text: "#1a1300" }

// The few DOM members used, so tests can pass a small fake document. Children are typed
// loosely: a real Node isn't a BadgeElement and vice versa.
type AnyChild = any

type BadgeElement = {
    id: string
    textContent: string | null
    style: { cssText: string }
    setAttribute(name: string, value: string): void
    appendChild(child: AnyChild): unknown
    remove(): void
}

type BadgeDocument = {
    body: { appendChild(child: AnyChild): unknown } | null
    getElementById(id: string): unknown
    createElement(tag: "div"): BadgeElement
}

/** Sizes are for a 1920x1080 screen, multiplied by `scale` like tvSize() (tv-scale.ts). */
function px(value: number, scale: number) {
    return `${Math.max(1, Math.round(value * scale))}px`
}

// Static styles only: no transition, animation or timer (the TV has little memory and CPU).
function containerStyle(scale: number) {
    return [
        "position:fixed",
        // Top right, right of the nav bar and above the update banner, the player's title and
        // the drawers' content (which starts 40 px down): the tag ends at 36 px.
        `top:${px(4, scale)}`,
        `right:${px(24, scale)}`,
        `z-index:${TOP_Z_INDEX}`,
        "display:flex",
        // The first badge (TEST ENVIRONMENT) stays in the corner; later ones line up to its left.
        "flex-direction:row-reverse",
        "align-items:center",
        "margin:0",
        "padding:0",
        "pointer-events:none",
        "user-select:none",
        "-webkit-user-select:none",
    ].join(";")
}

function badgeStyle(colors: BadgeColors, scale: number) {
    return [
        "display:block",
        // Margins, not gap: webOS 6 (Chromium 79) has no flexbox gap.
        `margin-left:${px(10, scale)}`,
        `padding:${px(3, scale)} ${px(14, scale)}`,
        `border:${px(2, scale)} solid ${colors.text}`,
        `border-radius:${px(999, scale)}`,
        `background-color:${colors.background}`,
        `color:${colors.text}`,
        "font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif",
        "font-weight:800",
        `font-size:${px(18, scale)}`,
        `line-height:${px(22, scale)}`,
        `letter-spacing:${px(1.5, scale)}`,
        "white-space:nowrap",
        "pointer-events:none",
    ].join(";")
}

/** The badge container, created once (idempotent). Null when the document has no body yet. */
export function environmentBadgeContainer(doc: BadgeDocument, scale = 1): BadgeElement | null {
    const existing = doc.getElementById(ENVIRONMENT_BADGES_ID) as BadgeElement | null
    if (existing) return existing
    if (!doc.body) return null
    const container = doc.createElement("div")
    container.id = ENVIRONMENT_BADGES_ID
    // Decoration for the tester: no focus, no Audio Guidance, no input.
    container.setAttribute("aria-hidden", "true")
    container.setAttribute("data-environment-badges", "")
    container.style.cssText = containerStyle(scale)
    doc.body.appendChild(container)
    return container
}

/**
 * Adds a badge to the container and returns a function that removes it. For GA Test-only
 * badges such as #30's "DEBUG" (shown while a simulated state is active), next to the tag.
 */
export function addEnvironmentBadge(doc: BadgeDocument, label: string, colors: BadgeColors, scale = 1): (() => void) | null {
    const container = environmentBadgeContainer(doc, scale)
    if (!container) return null
    const badge = doc.createElement("div")
    badge.setAttribute("data-environment-badge", label)
    badge.textContent = label
    badge.style.cssText = badgeStyle(colors, scale)
    container.appendChild(badge)
    return () => badge.remove()
}

/**
 * Shows the TEST ENVIRONMENT tag when `appId` is the GA Test id; does nothing (and returns
 * false) for any other build. Called once at startup by src/lib/webos/install.ts.
 */
export function mountTestEnvironmentTag(doc: BadgeDocument, { appId, scale = 1 }: { appId: string | null | undefined; scale?: number }): boolean {
    if (!isGaTestBuild(appId)) return false
    if (doc.getElementById(ENVIRONMENT_BADGES_ID)) return true
    return addEnvironmentBadge(doc, TEST_ENVIRONMENT_LABEL, TEST_ENVIRONMENT_COLORS, scale) !== null
}

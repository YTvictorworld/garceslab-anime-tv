/**
 * Garceslab Anime: one switch per effect of the TV visual refresh, so any
 * effect can be turned off on its own if the TV (Chromium 79 on a weak CPU and
 * GPU) stutters with it. Every effect is on by default.
 *
 * Turn effects off for a build with a comma-separated list of flag names:
 *
 *   EXPO_PUBLIC_TV_VISUAL_OFF=ambientBackdrop,cardGradients npm run build:webos
 *
 * (`all` turns every effect off: the look from before the refresh.) Or change
 * a default below. Each flag says what it draws and what it costs on the TV.
 * Kept free of React Native so it can be unit tested.
 */

export const TV_VISUAL_FLAG_INFO = {
    animeBackdrop: {
        effect: "Anime page: a tall full-width banner behind the header, faded into the page by "
            + "static gradients like the web's entry page, with the cover beside the title.",
        cost: "Low. One banner image (AniList's banner, else the `large` cover) and three static "
            + "gradient layers that scroll with the page; nothing animates.",
    },
    ambientBackdrop: {
        effect: "Anime page: the cover tints the whole page, very dim, behind everything (the "
            + "web's blurred page background). The softness comes from upscaling AniList's "
            + "`medium` cover (about 100 px wide); no CSS blur is used.",
        cost: "Low. One small image in a fixed layer behind the scrolling page, painted once. "
            + "No filter or backdrop-filter.",
    },
    cardGradients: {
        effect: "Poster and episode cards: a dark bottom gradient (the web's card gradient) "
            + "and a short shade under the top corner chips.",
        cost: "Low to medium. One static gradient layer per mounted card; no shadows, no blur, "
            + "and the focus scale stays the only animation.",
    },
    releasingBadge: {
        effect: "A signal-tower badge for anime that are airing (lilac) or not yet released "
            + "(grey) on poster cards, and the same status beside the date on the anime page.",
        cost: "Low. A small SVG icon per airing card.",
    },
    typography: {
        effect: "Section titles, card titles and meta lines: web-like sizes, weights, letter "
            + "spacing and gaps, kept large enough to read from the couch.",
        cost: "None (text styles only).",
    },
    scheduleTab: {
        effect: "A Schedule entry in the TV nav bar: the web's calendar as a week grid (Monday "
            + "to Sunday) of the profile's list anime, with previous/next week buttons.",
        cost: "None while closed. The screen loads one server request; thumbnails are "
            + "AniList's ~100 px `medium` covers.",
    },
    scheduleDayArt: {
        effect: "Schedule: each day column shows its first episode's cover, dim, behind its "
            + "header (the web calendar's day background); brighter for today.",
        cost: "Low. Up to seven `large` covers at low opacity with a static gradient each; "
            + "nothing animates (the web's rotating background is left out).",
    },
} as const satisfies Record<string, { effect: string; cost: string }>

export type TVVisualFlag = keyof typeof TV_VISUAL_FLAG_INFO
export type TVVisualFlags = Record<TVVisualFlag, boolean>

export const TV_VISUAL_FLAG_NAMES = Object.keys(TV_VISUAL_FLAG_INFO) as TVVisualFlag[]

/** Every effect on: the refreshed look. */
export const DEFAULT_TV_VISUAL_FLAGS: Readonly<TVVisualFlags> = {
    animeBackdrop: true,
    ambientBackdrop: true,
    cardGradients: true,
    releasingBadge: true,
    typography: true,
    scheduleTab: true,
    scheduleDayArt: true,
}

/**
 * The flags with the ones named in `off` (comma or space separated, any case;
 * `all` for every one) turned off. Unknown names are ignored.
 */
export function resolveTVVisualFlags(
    off: string | null | undefined,
    defaults: Readonly<TVVisualFlags> = DEFAULT_TV_VISUAL_FLAGS,
): TVVisualFlags {
    const flags = { ...defaults }
    const names = (off ?? "").split(/[\s,]+/).map(name => name.trim().toLowerCase()).filter(Boolean)
    for (const name of names) {
        if (name === "all") {
            for (const flag of TV_VISUAL_FLAG_NAMES) flags[flag] = false
            continue
        }
        const flag = TV_VISUAL_FLAG_NAMES.find(candidate => candidate.toLowerCase() === name)
        if (flag) flags[flag] = false
    }
    return flags
}

/** The flags this build uses. */
export const TV_VISUAL: Readonly<TVVisualFlags> = Object.freeze(
    resolveTVVisualFlags(process.env.EXPO_PUBLIC_TV_VISUAL_OFF),
)

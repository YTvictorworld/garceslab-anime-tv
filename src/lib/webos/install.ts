import { mountTestEnvironmentTag } from "../test-environment"
import { installRemote } from "./remote"
import { focusElement } from "./spatial-navigation"

declare global {
    interface HTMLElement {
        requestTVFocus?: () => void
    }
}

// The TV components draw their own focus state.
const TV_CSS = `
*:focus { outline: none; }
* { -webkit-tap-highlight-color: transparent; }
html, body { background-color: #0d0b0f; overflow: hidden; }
::-webkit-scrollbar { display: none; }
`

/**
 * Packaged webOS apps run from file://, where Chromium only lets
 * pushState/replaceState change the query and hash. The router keeps its own
 * history, so entries are still recorded but the document URL stays put.
 */
function keepDocumentUrl() {
    for (const method of ["pushState", "replaceState"] as const) {
        const original = history[method].bind(history)
        history[method] = (data: unknown, unused: string) => original(data, unused)
    }
}

if (typeof window !== "undefined") {
    installRemote()
    if (window.location.protocol === "file:") keepDocumentUrl()

    const style = document.createElement("style")
    style.setAttribute("data-webos", "tv")
    style.textContent = TV_CSS
    document.head.appendChild(style)

    // Garceslab Anime: the GA Test app shows a TEST ENVIRONMENT tag on every screen
    // (test-environment.ts). The app id is inlined at build time; other builds skip this.
    const showTestTag = () => mountTestEnvironmentTag(document, {
        appId: process.env.EXPO_PUBLIC_WEBOS_APP_ID,
        scale: Math.min(window.innerWidth / 1920, window.innerHeight / 1080) || 1,
    })
    if (document.body) showTestTag()
    else document.addEventListener("DOMContentLoaded", showTestTag, { once: true })

    // react-native-tvos refs expose requestTVFocus(); react-native-web refs are DOM nodes.
    if (!HTMLElement.prototype.requestTVFocus) {
        HTMLElement.prototype.requestTVFocus = function requestTVFocus(this: HTMLElement) {
            focusElement(this)
        }
    }
}

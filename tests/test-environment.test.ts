import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import {
    addEnvironmentBadge,
    ENVIRONMENT_BADGES_ID,
    GA_TEST_APP_ID,
    isGaTestBuild,
    mountTestEnvironmentTag,
    TEST_ENVIRONMENT_LABEL,
} from "../src/lib/test-environment.ts"
import { applyEmbeddedAppId, resolveAppId } from "../webos/app-id.mjs"

// GA Test's TEST ENVIRONMENT tag (docs/testing-on-tv.md, "The GA Test app"): shown on every
// screen of the GA Test app, never in the main app. Decided at build time from the app id.

const APPINFO = JSON.parse(fs.readFileSync(new URL("../webos/appinfo.json", import.meta.url), "utf8")) as { id: string, title: string }
const MAIN_APP_ID = "app.seanime.tenji"

type FakeElement = {
    tag: string
    id: string
    textContent: string | null
    style: { cssText: string }
    attributes: Record<string, string>
    children: FakeElement[]
    parent: FakeElement | null
    setAttribute(name: string, value: string): void
    appendChild(child: FakeElement): FakeElement
    remove(): void
}

function fakeDocument({ withBody = true } = {}) {
    const all: FakeElement[] = []
    const createElement = (tag: string): FakeElement => {
        const element: FakeElement = {
            tag,
            id: "",
            textContent: null,
            style: { cssText: "" },
            attributes: {},
            children: [],
            parent: null,
            setAttribute(name, value) {
                this.attributes[name] = value
            },
            appendChild(child) {
                child.parent = this
                this.children.push(child)
                return child
            },
            remove() {
                if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this)
                this.parent = null
            },
        }
        all.push(element)
        return element
    }
    const body = withBody ? createElement("body") : null
    const attached = (element: FakeElement | null): boolean => {
        for (let node = element; node; node = node.parent) if (node === body) return true
        return false
    }
    return {
        body,
        createElement,
        getElementById: (id: string) => all.find(element => element.id === id && attached(element)) ?? null,
    }
}

/** The app id the app is told by `npm run build:webos` with this environment (webos/build.mjs). */
function embeddedAppIdFor(env: Record<string, string | undefined>) {
    const processEnv = { ...env }
    applyEmbeddedAppId(processEnv, resolveAppId({ appinfo: APPINFO, env: processEnv }).embeddedAppId)
    return processEnv.EXPO_PUBLIC_WEBOS_APP_ID
}

function tagShown(doc: ReturnType<typeof fakeDocument>) {
    const container = doc.getElementById(ENVIRONMENT_BADGES_ID) as FakeElement | null
    return container?.children.some(badge => badge.textContent === TEST_ENVIRONMENT_LABEL) ?? false
}

test("only the GA Test app id is GA Test", () => {
    assert.equal(isGaTestBuild(GA_TEST_APP_ID), true)
    assert.equal(isGaTestBuild(` ${GA_TEST_APP_ID} `), true)
    for (const id of [undefined, null, "", MAIN_APP_ID, "app.garceslab.anime.visualtest", "app.garceslab.anime.directtest", "app.garceslab.anime.test2", "APP.GARCESLAB.ANIME.TEST"]) {
        assert.equal(isGaTestBuild(id), false, String(id))
    }
})

test("the GA Test id is the one CI builds GA Test with", () => {
    const script = fs.readFileSync(new URL("../.github/scripts/ga-test-check.sh", import.meta.url), "utf8")
    assert.match(script, new RegExp(`^APP_ID=${GA_TEST_APP_ID.replaceAll(".", "\\.")}$`, "m"))
})

test("main app builds (nightly, stable, local) never show the tag", () => {
    assert.equal(APPINFO.id, MAIN_APP_ID)
    for (const env of [
        {},
        { GARCESLAB_BUILD_CHANNEL: "nightly" },
        { GARCESLAB_BUILD_CHANNEL: "stable" },
        // A stray value left in the shell is removed by the build.
        { EXPO_PUBLIC_WEBOS_APP_ID: GA_TEST_APP_ID },
        { WEBOS_APP_ID: "  ", EXPO_PUBLIC_WEBOS_APP_ID: GA_TEST_APP_ID },
    ]) {
        const appId = embeddedAppIdFor(env)
        assert.equal(appId, undefined, JSON.stringify(env))
        const doc = fakeDocument()
        assert.equal(mountTestEnvironmentTag(doc, { appId }), false)
        assert.equal(doc.getElementById(ENVIRONMENT_BADGES_ID), null)
        assert.equal(doc.body?.children.length, 0)
    }
})

test("other side-by-side test builds don't show it either", () => {
    const appId = embeddedAppIdFor({ WEBOS_APP_ID: "app.garceslab.anime.visualtest", WEBOS_APP_TITLE: "GA Visual Test" })
    assert.equal(appId, "app.garceslab.anime.visualtest")
    const doc = fakeDocument()
    assert.equal(mountTestEnvironmentTag(doc, { appId }), false)
    assert.equal(tagShown(doc), false)
})

test("the GA Test build always shows TEST ENVIRONMENT, once", () => {
    const resolved = resolveAppId({ appinfo: APPINFO, env: { WEBOS_APP_ID: GA_TEST_APP_ID, WEBOS_APP_TITLE: "GA Test" } })
    assert.deepEqual(resolved, { id: GA_TEST_APP_ID, title: "GA Test", custom: true, embeddedAppId: GA_TEST_APP_ID })
    const appId = embeddedAppIdFor({ WEBOS_APP_ID: GA_TEST_APP_ID, WEBOS_APP_TITLE: "GA Test" })
    const doc = fakeDocument()
    assert.equal(mountTestEnvironmentTag(doc, { appId }), true)
    assert.equal(tagShown(doc), true)
    // Mounting again (hot reload) doesn't add a second tag.
    assert.equal(mountTestEnvironmentTag(doc, { appId }), true)
    const container = doc.getElementById(ENVIRONMENT_BADGES_ID) as FakeElement
    assert.equal(container.children.length, 1)
    assert.equal(container.children[0].textContent, "TEST ENVIRONMENT")
    assert.equal(doc.body?.children.length, 1)
})

test("the tag is fixed, on top of everything, and takes no focus or input", () => {
    const doc = fakeDocument()
    mountTestEnvironmentTag(doc, { appId: GA_TEST_APP_ID })
    const container = doc.getElementById(ENVIRONMENT_BADGES_ID) as FakeElement
    const badge = container.children[0]
    const css = container.style.cssText
    assert.match(css, /position:fixed/)
    assert.match(css, /top:4px/)
    assert.match(css, /right:24px/)
    // 36 px tall at most from the top edge: clear of the drawers' content (40 px down).
    assert.match(badge.style.cssText, /font-size:18px;line-height:22px/)
    assert.match(badge.style.cssText, /padding:3px 14px/)
    assert.match(css, /z-index:2147483647/)
    assert.match(css, /pointer-events:none/)
    assert.match(badge.style.cssText, /pointer-events:none/)
    // Not focusable (no tabindex) and hidden from spatial navigation and Audio Guidance.
    assert.equal(container.attributes["aria-hidden"], "true")
    assert.equal("tabindex" in container.attributes || "tabindex" in badge.attributes, false)
    // Static: nothing animates. Amber with dark text, not the app's lilac.
    for (const style of [css, badge.style.cssText]) assert.doesNotMatch(style, /animation|transition/)
    assert.match(badge.style.cssText, /background-color:#fbbf24/)
    assert.match(badge.style.cssText, /color:#1a1300/)
    // No flexbox gap (webOS 6) and no CSS min()/max()/clamp().
    assert.doesNotMatch(css + badge.style.cssText, /\bgap:|min\(|max\(|clamp\(/)
})

test("sizes follow the screen scale, like tvSize()", () => {
    const doc = fakeDocument()
    mountTestEnvironmentTag(doc, { appId: GA_TEST_APP_ID, scale: 0.5 })
    const container = doc.getElementById(ENVIRONMENT_BADGES_ID) as FakeElement
    assert.match(container.style.cssText, /top:2px/)
    assert.match(container.style.cssText, /right:12px/)
    assert.match(container.children[0].style.cssText, /font-size:9px/)
})

test("more badges (#30's DEBUG) go next to the tag and can be removed", () => {
    const doc = fakeDocument()
    mountTestEnvironmentTag(doc, { appId: GA_TEST_APP_ID })
    const remove = addEnvironmentBadge(doc, "DEBUG", { background: "#ef4444", text: "#ffffff" })
    const container = doc.getElementById(ENVIRONMENT_BADGES_ID) as FakeElement
    assert.deepEqual(container.children.map(badge => badge.textContent), ["TEST ENVIRONMENT", "DEBUG"])
    // The first badge keeps the corner; later ones line up to its left.
    assert.match(container.style.cssText, /flex-direction:row-reverse/)
    remove?.()
    assert.deepEqual(container.children.map(badge => badge.textContent), ["TEST ENVIRONMENT"])
})

test("no body yet: nothing is mounted (install.ts waits for DOMContentLoaded)", () => {
    const doc = fakeDocument({ withBody: false })
    assert.equal(mountTestEnvironmentTag(doc, { appId: GA_TEST_APP_ID }), false)
    const install = fs.readFileSync(new URL("../src/lib/webos/install.ts", import.meta.url), "utf8")
    assert.match(install, /mountTestEnvironmentTag\(document, \{\s*appId: process\.env\.EXPO_PUBLIC_WEBOS_APP_ID,/)
    assert.match(install, /addEventListener\("DOMContentLoaded", showTestTag/)
})

test("invalid WEBOS_APP_ID still fails the build", () => {
    assert.throws(() => resolveAppId({ appinfo: APPINFO, env: { WEBOS_APP_ID: "App.Test" } }), /not a valid webOS app id/)
    assert.deepEqual(resolveAppId({ appinfo: APPINFO, env: { WEBOS_APP_ID: "app.x" } }).title, `${APPINFO.title} (app.x)`)
})

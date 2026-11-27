import assert from "node:assert/strict"
import test from "node:test"
import { createStreamStartRegistry } from "../src/lib/player/stream-start.ts"

/**
 * The webOS card start bug: a card start presses the episode from an effect
 * (TVStreamStartWatch). The TV's release check (startPlayableAutoSelectedStream)
 * set "preparing", then asked whether the start was cancelled meanwhile by
 * reading a copy of the atom taken at render. With no torrent providers
 * loaded yet the check answers at once, before React re-renders with the new
 * value: the copy still said false, the start was dropped without a request,
 * and the card showed "Selecting best torrent..." until the 2-minute stall
 * rule. This renders the same pattern with react-dom's real scheduler.
 */

// The little of the DOM react-dom touches for a tree that renders nothing.
const g = globalThis as Record<string, unknown>
g.window ??= globalThis
g.document ??= { activeElement: null }
g.HTMLIFrameElement ??= class {}
g.dispatchEvent ??= () => true
const container = {
    nodeType: 1, nodeName: "DIV", tagName: "DIV", textContent: "",
    ownerDocument: { nodeType: 9, defaultView: globalThis, addEventListener() {}, removeEventListener() {} },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {}, insertBefore() {},
}

const React = (await import("react")).default
// @ts-expect-error: react-dom has no type declarations in this project
const { createRoot } = await import("react-dom/client")
const { atom, createStore, Provider, useAtomValue, useSetAtom } = await import("jotai")

type Check = "at-once" | "after-a-request"

// stallMs: the event loop is busy that long right after the check is sent, as on a loaded CI
// runner that takes the CPU away from node for a few milliseconds.
function runStart(check: Check, cancelledBy: "render-copy" | "start-id", stallMs = 0): Promise<{ outcome: string; preparing: boolean }> {
    const preparingAtom = atom(false)
    const store = createStore()
    const starts = createStreamStartRegistry()
    return new Promise((resolve) => {
        function Controller() {
            const preparing = useAtomValue(preparingAtom)
            const setPreparing = useSetAtom(preparingAtom)
            const preparingRef = React.useRef(preparing)
            preparingRef.current = preparing
            React.useEffect(() => {
                const startId = starts.begin()
                setPreparing(true)
                const answer = check === "at-once"
                    ? Promise.resolve(null)
                    : new Promise(done => setTimeout(done, 5))
                const until = performance.now() + stallMs
                while (performance.now() < until) { /* busy */ }
                void answer.then(() => {
                    const cancelled = cancelledBy === "render-copy" ? !preparingRef.current : !starts.isCurrent(startId)
                    resolve({ outcome: cancelled ? "dropped" : "request sent", preparing: store.get(preparingAtom) })
                })
            }, [setPreparing])
            return null
        }
        const root = createRoot(container as never)
        root.render(React.createElement(Provider, { store }, React.createElement(Controller)))
    })
}

test("reproduction: a render-time copy of 'preparing' drops a start whose check answers at once", async () => {
    assert.deepEqual(await runStart("at-once", "render-copy"), { outcome: "dropped", preparing: true })
    // It only worked when the check had to wait for a request (providers loaded).
    assert.deepEqual(await runStart("after-a-request", "render-copy"), { outcome: "request sent", preparing: true })
})

test("the start id goes on in both cases", async () => {
    assert.equal((await runStart("at-once", "start-id")).outcome, "request sent")
    assert.equal((await runStart("after-a-request", "start-id")).outcome, "request sent")
})

// The CI failure of run 46060054829: a few milliseconds without the CPU must not change what
// the reproduction shows.
test("the reproduction holds when the event loop stalls after the check is sent", async () => {
    assert.deepEqual(await runStart("at-once", "render-copy", 20), { outcome: "dropped", preparing: true })
    assert.deepEqual(await runStart("after-a-request", "render-copy", 20), { outcome: "request sent", preparing: true })
    assert.equal((await runStart("at-once", "start-id", 20)).outcome, "request sent")
    assert.equal((await runStart("after-a-request", "start-id", 20)).outcome, "request sent")
})

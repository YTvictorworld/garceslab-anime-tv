/**
 * Where a scroller should move to show a focused element: kept free of the
 * DOM so it can be unit tested (spatial-navigation.ts measures and calls it).
 */

/**
 * The scroll offset that keeps the span [from, to] at least `margin` inside
 * [start, start + size].
 *
 * With `snapToStart` (vertical scrollers), a span that fits on the first
 * screen together with its margin scrolls the page all the way back to 0.
 * Otherwise moving up from a lower row into a tall header (the home screen's
 * hero) only scrolled far enough to show the focused button, and the top of
 * the page (the hero's image, the search button) stayed cut off.
 */
export function revealSpan(start: number, size: number, from: number, to: number, margin: number, snapToStart = false) {
    if (snapToStart && start > 0 && to + margin <= size) return 0
    if (from - margin < start) return Math.max(0, from - margin)
    if (to + margin > start + size) return to + margin - size
    return start
}

/**
 * Garceslab Anime: at most `max` tasks at once, the rest wait in order. The
 * home screen asks for the episode tags of every show to continue; this keeps
 * that to a few requests at a time (react-query already merges requests for
 * the same anime). A task whose signal aborts while it waits never starts.
 */
export function createRequestLimiter(max: number) {
    let running = 0
    const waiting: (() => void)[] = []

    function release() {
        running--
        waiting.shift()?.()
    }

    return {
        run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
            return new Promise<T>((resolve, reject) => {
                const start = () => {
                    if (signal?.aborted) {
                        // Pass the turn on without running.
                        waiting.shift()?.()
                        reject(signal.reason ?? new Error("Aborted"))
                        return
                    }
                    running++
                    task().then(resolve, reject).finally(release)
                }
                if (running < max) start()
                else waiting.push(start)
            })
        },
        /** For tests. */
        get active() {
            return running
        },
        get queued() {
            return waiting.length
        },
    }
}

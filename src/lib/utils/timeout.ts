// src/lib/utils/timeout.ts

/**
 * `work`'s outcome, or a rejection with `onTimeout()` once `ms` has passed
 * first. `work` itself is not cancelled — a `dns.lookup` keeps its threadpool
 * thread until the resolver gives up — so this bounds the caller's wait, not
 * the work. The timer is unref'd, so it never holds the process open.
 */
export async function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(onTimeout()), ms);
                timer.unref?.();
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

import { AsyncLocalStorage } from "node:async_hooks";

// The SDK's HTTP exchange can finish before its tool handler or fetch settles.
// Keep that work in the admission scope, including work outliving a deadline.
const requests = new AsyncLocalStorage<Set<Promise<void>>>();

export function trackWork<T>(work: Promise<T>): Promise<T> {
  const pending = requests.getStore();
  if (pending) {
    const remove = () => {
      pending.delete(settled);
    };
    // Observe both outcomes without creating an unhandled rejected cleanup promise.
    const settled = work.then(remove, remove);
    pending.add(settled);
  }
  return work;
}

export function withRequestWork<T>(operation: () => Promise<T>): Promise<T> {
  const pending = new Set<Promise<void>>();
  return requests.run(pending, async () => {
    try {
      return await operation();
    } finally {
      // Settling work may register further cleanup (e.g. a late response body).
      while (pending.size) await Promise.all(pending);
    }
  });
}

import { resolvePersistentStorageRoot } from "@/lib/persistent-storage-root";

/**
 * Resolves the persistent storage root for the current environment. Delegates
 * to the shared persistent-storage-root resolver so every storage layer —
 * legacy or system — agrees on one root.
 */
const storageRoot = {
  resolve: resolvePersistentStorageRoot,
} as const;

export default storageRoot;

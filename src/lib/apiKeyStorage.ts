import { validateByokApiKey } from "./api";

export const API_KEY_STORAGE_KEY = "jingyu-deepseek-api-key-v1";

export type ApiKeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface ApiKeyStorageUpdateResult {
  readonly status: "stored" | "cleared" | "write_failed" | "clear_failed" | "invalid";
  /** The exact value expected to remain in storage after this operation. */
  readonly persistedApiKey: string | null;
  /** True when an old value may still be present because the browser rejected cleanup. */
  readonly staleValueMayRemain: boolean;
}

function browserStorage(): ApiKeyStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadStoredApiKey(
  storage: ApiKeyStorage | null = browserStorage(),
): string | null {
  if (!storage) return null;
  try {
    const key = storage.getItem(API_KEY_STORAGE_KEY);
    if (key === null) return null;
    if (validateByokApiKey(key)) {
      try {
        storage.removeItem(API_KEY_STORAGE_KEY);
      } catch {
        // A corrupt value is never returned, even when storage cleanup is blocked.
      }
      return null;
    }
    return key;
  } catch {
    return null;
  }
}

export function storeApiKey(
  apiKey: string,
  storage: ApiKeyStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const key = apiKey.trim();
  if (validateByokApiKey(key)) return false;
  try {
    storage.setItem(API_KEY_STORAGE_KEY, key);
    return true;
  } catch {
    return false;
  }
}

export function clearStoredApiKey(
  storage: ApiKeyStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(API_KEY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Applies the user's remember/forget choice without losing track of an older
 * persisted value when Web Storage starts throwing. If replacing an existing
 * key fails, it tries to remove the stale copy before reporting the outcome.
 */
export function updateStoredApiKey(
  apiKey: string,
  shouldRemember: boolean,
  previouslyStoredApiKey: string | null,
  storage: ApiKeyStorage | null = browserStorage(),
): ApiKeyStorageUpdateResult {
  if (!shouldRemember) {
    if (previouslyStoredApiKey === null) {
      return { status: "cleared", persistedApiKey: null, staleValueMayRemain: false };
    }
    if (clearStoredApiKey(storage)) {
      return { status: "cleared", persistedApiKey: null, staleValueMayRemain: false };
    }
    return {
      status: "clear_failed",
      persistedApiKey: previouslyStoredApiKey,
      staleValueMayRemain: true,
    };
  }

  const key = apiKey.trim();
  if (validateByokApiKey(key)) {
    return {
      status: "invalid",
      persistedApiKey: previouslyStoredApiKey,
      staleValueMayRemain: false,
    };
  }
  if (storeApiKey(key, storage)) {
    return { status: "stored", persistedApiKey: key, staleValueMayRemain: false };
  }

  if (previouslyStoredApiKey !== null && clearStoredApiKey(storage)) {
    return { status: "write_failed", persistedApiKey: null, staleValueMayRemain: false };
  }
  return {
    status: "write_failed",
    persistedApiKey: previouslyStoredApiKey,
    staleValueMayRemain: previouslyStoredApiKey !== null,
  };
}

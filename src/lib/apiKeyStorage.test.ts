import { describe, expect, it, vi } from "vitest";
import {
  API_KEY_STORAGE_KEY,
  clearStoredApiKey,
  loadStoredApiKey,
  storeApiKey,
  updateStoredApiKey,
  type ApiKeyStorage,
} from "./apiKeyStorage";

function createStorage(initialValue?: string): ApiKeyStorage {
  const values = new Map<string, string>();
  if (initialValue !== undefined) values.set(API_KEY_STORAGE_KEY, initialValue);
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => { values.set(key, value); }),
    removeItem: vi.fn((key) => { values.delete(key); }),
  };
}

describe("BYOK API Key storage", () => {
  it("stores a trimmed valid key and loads it", () => {
    const storage = createStorage();

    expect(storeApiKey("  sk-local-test  ", storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(API_KEY_STORAGE_KEY, "sk-local-test");
    expect(loadStoredApiKey(storage)).toBe("sk-local-test");
  });

  it.each(["", "not-a-key", "sk-key 中文", "“sk-key”", "Bearer sk-key"])(
    "refuses to store an invalid key: %s",
    (key) => {
      const storage = createStorage();

      expect(storeApiKey(key, storage)).toBe(false);
      expect(storage.setItem).not.toHaveBeenCalled();
    },
  );

  it("discards and removes corrupt stored values", () => {
    const storage = createStorage("{corrupt-storage}");

    expect(loadStoredApiKey(storage)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(API_KEY_STORAGE_KEY);
  });

  it("forgets a stored key", () => {
    const storage = createStorage("sk-local-test");

    expect(clearStoredApiKey(storage)).toBe(true);
    expect(loadStoredApiKey(storage)).toBeNull();
  });

  it("degrades safely when storage is unavailable or throws", () => {
    const unavailable: ApiKeyStorage = {
      getItem: vi.fn(() => { throw new Error("blocked"); }),
      setItem: vi.fn(() => { throw new Error("blocked"); }),
      removeItem: vi.fn(() => { throw new Error("blocked"); }),
    };

    expect(loadStoredApiKey(null)).toBeNull();
    expect(storeApiKey("sk-local-test", null)).toBe(false);
    expect(clearStoredApiKey(null)).toBe(false);
    expect(loadStoredApiKey(unavailable)).toBeNull();
    expect(storeApiKey("sk-local-test", unavailable)).toBe(false);
    expect(clearStoredApiKey(unavailable)).toBe(false);
  });

  it("reports the exact key persisted by normal remember and forget updates", () => {
    const storage = createStorage();

    expect(updateStoredApiKey("  sk-current-local-test  ", true, null, storage)).toEqual({
      status: "stored",
      persistedApiKey: "sk-current-local-test",
      staleValueMayRemain: false,
    });
    expect(loadStoredApiKey(storage)).toBe("sk-current-local-test");
    expect(updateStoredApiKey("sk-current-local-test", false, "sk-current-local-test", storage)).toEqual({
      status: "cleared",
      persistedApiKey: null,
      staleValueMayRemain: false,
    });
    expect(loadStoredApiKey(storage)).toBeNull();
  });

  it("removes the old key when replacing it fails but cleanup still works", () => {
    const storage = createStorage("sk-old-local-test");
    vi.mocked(storage.setItem).mockImplementation(() => { throw new Error("write blocked"); });

    expect(updateStoredApiKey("sk-new-local-test", true, "sk-old-local-test", storage)).toEqual({
      status: "write_failed",
      persistedApiKey: null,
      staleValueMayRemain: false,
    });
    expect(loadStoredApiKey(storage)).toBeNull();
  });

  it("returns the old persisted key when it cannot be replaced or removed", () => {
    const storage = createStorage("sk-old-local-test");
    vi.mocked(storage.setItem).mockImplementation(() => { throw new Error("write blocked"); });
    vi.mocked(storage.removeItem).mockImplementation(() => { throw new Error("cleanup blocked"); });

    expect(updateStoredApiKey("sk-new-local-test", true, "sk-old-local-test", storage)).toEqual({
      status: "write_failed",
      persistedApiKey: "sk-old-local-test",
      staleValueMayRemain: true,
    });
    expect(loadStoredApiKey(storage)).toBe("sk-old-local-test");
  });

  it("does not claim an old key was forgotten when removal fails", () => {
    const storage = createStorage("sk-old-local-test");
    vi.mocked(storage.removeItem).mockImplementation(() => { throw new Error("cleanup blocked"); });

    expect(updateStoredApiKey("", false, "sk-old-local-test", storage)).toEqual({
      status: "clear_failed",
      persistedApiKey: "sk-old-local-test",
      staleValueMayRemain: true,
    });
    expect(loadStoredApiKey(storage)).toBe("sk-old-local-test");
  });
});

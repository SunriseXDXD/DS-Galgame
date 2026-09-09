import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import type { AssistantScene, ChatTurn } from "../types";
import {
  AUTO_SAVE_SLOT_ID,
  LOCAL_SAVE_DATABASE_NAME,
  MANUAL_SAVE_SLOT_IDS,
  MAX_MEMORY_SLOTS,
  createLocalSaveRepository,
} from "./localSaveRepository";
import {
  captureSaveSnapshot,
  createSaveRevision,
  createSaveSlotId,
} from "./saveSlots";
import type { SaveSlotId, SaveSnapshot } from "./saveSlots";

const scene: AssistantScene = {
  mood: "happy",
  segments: [{ kind: "dialogue", text: "这段故事只留在本地。", mood: "proud" }],
  suggestions: ["继续"],
  rawText: "这段故事只留在本地。",
};

const history: ChatTurn[] = [
  { id: "user-1", role: "user", content: "记住这一页", createdAt: 10 },
  { id: "assistant-1", role: "assistant", content: "已经记好了。", createdAt: 20 },
];

function snapshot(
  slotId: SaveSlotId,
  capturedAt: number,
  options: { readonly createdAt?: number; readonly title?: string } = {},
): SaveSnapshot {
  return captureSaveSnapshot({
    slotId,
    title: options.title ?? String(slotId),
    capturedAt,
    createdAt: options.createdAt ?? capturedAt,
    scene,
    pageIndex: 0,
    history,
    model: "deepseek-v4-flash",
  });
}

function openRawDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(LOCAL_SAVE_DATABASE_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function putRaw(
  factory: IDBFactory,
  storeName: "saves" | "memories",
  key: string,
  value: unknown,
): Promise<void> {
  const database = await openRawDatabase(factory);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
      transaction.objectStore(storeName).put(value, key);
    });
  } finally {
    database.close();
  }
}

async function getRaw(
  factory: IDBFactory,
  storeName: "saves" | "memories",
  key: string,
): Promise<unknown> {
  const database = await openRawDatabase(factory);
  try {
    return await new Promise<unknown>((resolve, reject) => {
      let value: unknown;
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(key);
      request.onsuccess = () => {
        value = request.result;
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

describe("local IndexedDB save repository", () => {
  it("publishes the fixed local slots and creates both stores in one database", async () => {
    expect(LOCAL_SAVE_DATABASE_NAME).toBe("jingyu-local-memory-v1");
    expect(MANUAL_SAVE_SLOT_IDS).toEqual([
      "slot-1",
      "slot-2",
      "slot-3",
      "slot-4",
      "slot-5",
      "slot-6",
    ]);
    expect(Object.isFrozen(MANUAL_SAVE_SLOT_IDS)).toBe(true);
    expect(AUTO_SAVE_SLOT_ID).toBe("autosave");
    expect(MAX_MEMORY_SLOTS).toBe(60);

    const factory = new IDBFactory();
    const repository = createLocalSaveRepository({ idbFactory: factory });
    expect(await repository.list()).toEqual({ ok: true, value: [] });

    const database = await openRawDatabase(factory);
    expect(Array.from(database.objectStoreNames)).toEqual(["memories", "saves"]);
    database.close();
  });

  it("persists canonical snapshots across repository instances and sorts newest first", async () => {
    const factory = new IDBFactory();
    const firstInstance = createLocalSaveRepository({ idbFactory: factory });
    const callerRevision = createSaveRevision("caller-revision");
    const firstInput = {
      ...snapshot(MANUAL_SAVE_SLOT_IDS[0], 200, { createdAt: 100, title: "较早" }),
      metadata: {
        ...snapshot(MANUAL_SAVE_SLOT_IDS[0], 200, { createdAt: 100 }).metadata,
        title: "较早",
        revision: callerRevision,
      },
    };
    const firstWrite = await firstInstance.write(firstInput, { expectedRevision: null });
    const secondWrite = await firstInstance.write(
      snapshot(MANUAL_SAVE_SLOT_IDS[1], 300, { createdAt: 250, title: "较新" }),
      { expectedRevision: null },
    );

    expect(firstWrite.ok).toBe(true);
    expect(secondWrite.ok).toBe(true);
    if (!firstWrite.ok || !secondWrite.ok) throw new Error("expected writes to succeed");
    expect(firstWrite.value.revision).toBeDefined();
    expect(firstWrite.value.revision).not.toBe(callerRevision);

    const secondInstance = createLocalSaveRepository({ idbFactory: factory });
    const read = await secondInstance.read(MANUAL_SAVE_SLOT_IDS[0]);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error("expected a persisted snapshot");
    expect(read.value.metadata).toEqual(firstWrite.value);
    expect(read.value.state.history).toEqual(history);
    expect(JSON.stringify(read.value)).not.toContain("caller-revision");

    const listed = await secondInstance.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error("expected a valid list");
    expect(listed.value.map((item) => item.slotId)).toEqual([
      MANUAL_SAVE_SLOT_IDS[1],
      MANUAL_SAVE_SLOT_IDS[0],
    ]);
  });

  it("atomically compares revisions, generates a new revision, and preserves createdAt", async () => {
    const factory = new IDBFactory();
    const repositoryA = createLocalSaveRepository({ idbFactory: factory });
    const repositoryB = createLocalSaveRepository({ idbFactory: factory });
    const slotId = MANUAL_SAVE_SLOT_IDS[0];
    const created = await repositoryA.write(
      snapshot(slotId, 200, { createdAt: 100 }),
      { expectedRevision: null },
    );
    expect(created.ok).toBe(true);
    if (!created.ok || !created.value.revision) throw new Error("expected a generated revision");

    const revision = created.value.revision;
    const [left, right] = await Promise.all([
      repositoryA.write(snapshot(slotId, 400, { createdAt: 350, title: "左" }), {
        expectedRevision: revision,
      }),
      repositoryB.write(snapshot(slotId, 500, { createdAt: 450, title: "右" }), {
        expectedRevision: revision,
      }),
    ]);
    const results = [left, right];
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });

    const winner = results.find((result) => result.ok);
    if (!winner?.ok) throw new Error("expected one CAS winner");
    expect(winner.value.createdAt).toBe(100);
    expect(winner.value.revision).toBeDefined();
    expect(winner.value.revision).not.toBe(revision);

    const read = await repositoryA.read(slotId);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error("expected the winning snapshot");
    expect(read.value.metadata.createdAt).toBe(100);
    expect(read.value.metadata.revision).toBe(winner.value.revision);
    expect(["左", "右"]).toContain(read.value.metadata.title);
  });

  it("deletes only the expected valid revision and reports missing slots", async () => {
    const factory = new IDBFactory();
    const repository = createLocalSaveRepository({ idbFactory: factory });
    const slotId = MANUAL_SAVE_SLOT_IDS[2];
    const written = await repository.write(snapshot(slotId, 100), { expectedRevision: null });
    expect(written.ok).toBe(true);
    if (!written.ok || !written.value.revision) throw new Error("expected a revision");

    expect(await repository.delete(slotId, {
      expectedRevision: createSaveRevision("stale-revision"),
    })).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect((await repository.read(slotId)).ok).toBe(true);

    expect(await repository.delete(slotId, { expectedRevision: written.value.revision })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await repository.read(slotId)).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  it("restricts saves to seven fixed IDs and memories to memory-prefixed IDs", async () => {
    const factory = new IDBFactory();
    const saves = createLocalSaveRepository({ storeName: "saves", idbFactory: factory });
    const memories = createLocalSaveRepository({ storeName: "memories", idbFactory: factory });
    const memoryId = createSaveSlotId("memory-random_12345678");

    expect(await saves.write(snapshot(createSaveSlotId("slot-7"), 100))).toMatchObject({
      ok: false,
      error: { code: "invalid_snapshot" },
    });
    expect(await saves.write(snapshot(memoryId, 100))).toMatchObject({
      ok: false,
      error: { code: "invalid_snapshot" },
    });
    expect(await memories.write(snapshot(MANUAL_SAVE_SLOT_IDS[0], 100))).toMatchObject({
      ok: false,
      error: { code: "invalid_snapshot" },
    });
    expect(await memories.write(snapshot(memoryId, 100), { expectedRevision: null })).toMatchObject({
      ok: true,
      value: { slotId: memoryId },
    });

    expect(await saves.list()).toEqual({ ok: true, value: [] });
    expect(await memories.list()).toMatchObject({ ok: true, value: [{ slotId: memoryId }] });
  });

  it("enforces the memory limit without blocking an update to an existing memory", async () => {
    const factory = new IDBFactory();
    const repository = createLocalSaveRepository({ storeName: "memories", idbFactory: factory });
    let firstRevision: string | undefined;
    for (let index = 0; index < MAX_MEMORY_SLOTS; index += 1) {
      const slotId = createSaveSlotId(`memory-random-${String(index).padStart(3, "0")}`);
      const result = await repository.write(snapshot(slotId, index + 1), { expectedRevision: null });
      expect(result.ok).toBe(true);
      if (index === 0 && result.ok) firstRevision = result.value.revision;
    }

    const overflow = await repository.write(
      snapshot(createSaveSlotId("memory-random-overflow"), 1_000),
      { expectedRevision: null },
    );
    expect(overflow).toMatchObject({
      ok: false,
      error: { code: "storage_error" },
    });
    if (!overflow.ok) expect(overflow.error.message).toContain(String(MAX_MEMORY_SLOTS));

    if (!firstRevision) throw new Error("expected first memory revision");
    const updated = await repository.write(
      snapshot(createSaveSlotId("memory-random-000"), 2_000, { createdAt: 1, title: "更新" }),
      { expectedRevision: createSaveRevision(firstRevision) },
    );
    expect(updated).toMatchObject({ ok: true, value: { createdAt: 1, title: "更新" } });
    const listed = await repository.list();
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.value).toHaveLength(MAX_MEMORY_SLOTS);
  });

  it("returns invalid_snapshot for corrupt records and never overwrites or deletes them", async () => {
    const factory = new IDBFactory();
    const repository = createLocalSaveRepository({ idbFactory: factory });
    expect(await repository.list()).toEqual({ ok: true, value: [] });

    const valid = snapshot(AUTO_SAVE_SLOT_ID, 100);
    const corrupt = {
      ...valid,
      state: { ...valid.state, apiKey: "sk-must-never-be-read-or-replaced" },
    };
    await putRaw(factory, "saves", AUTO_SAVE_SLOT_ID, corrupt);
    const undefinedValueSlot = MANUAL_SAVE_SLOT_IDS[0];
    await putRaw(factory, "saves", undefinedValueSlot, undefined);

    expect(await repository.read(AUTO_SAVE_SLOT_ID)).toMatchObject({
      ok: false,
      error: { code: "invalid_snapshot" },
    });
    expect(await repository.list()).toMatchObject({
      ok: false,
      error: { code: "invalid_snapshot" },
    });
    expect(await repository.write(valid, { expectedRevision: null })).toMatchObject({
      ok: false,
      error: { code: "invalid_snapshot" },
    });
    expect(await repository.read(undefinedValueSlot)).toMatchObject({
      ok: false,
      error: { code: "invalid_snapshot" },
    });
    expect(await repository.write(snapshot(undefinedValueSlot, 100), {
      expectedRevision: null,
    })).toMatchObject({
      ok: false,
      error: { code: "invalid_snapshot" },
    });
    expect(await repository.delete(AUTO_SAVE_SLOT_ID)).toMatchObject({
      ok: false,
      error: { code: "invalid_snapshot" },
    });
    expect(await getRaw(factory, "saves", AUTO_SAVE_SLOT_ID)).toEqual(corrupt);
  });

  it("rejects credentials before persistence and returns no credential-bearing data", async () => {
    const factory = new IDBFactory();
    const repository = createLocalSaveRepository({ idbFactory: factory });
    const clean = snapshot(MANUAL_SAVE_SLOT_IDS[0], 100);
    const tainted = {
      ...clean,
      state: { ...clean.state, authorization: "Bearer sk-do-not-store" },
    } as unknown as SaveSnapshot;

    expect(await repository.write(tainted, { expectedRevision: null })).toMatchObject({
      ok: false,
      error: { code: "invalid_snapshot" },
    });
    expect(await repository.list()).toEqual({ ok: true, value: [] });

    const cleanWrite = await repository.write(clean, { expectedRevision: null });
    expect(cleanWrite.ok).toBe(true);
    const raw = await getRaw(factory, "saves", MANUAL_SAVE_SLOT_IDS[0]);
    expect(JSON.stringify(raw)).not.toContain("authorization");
    expect(JSON.stringify(raw)).not.toContain("sk-do-not-store");
  });

  it("turns quota failures into a friendly storage_error and does not claim a commit", async () => {
    const factory = new IDBFactory();
    const repository = createLocalSaveRepository({ idbFactory: factory });
    expect(await repository.list()).toEqual({ ok: true, value: [] });
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    try {
      const result = await repository.write(snapshot(AUTO_SAVE_SLOT_ID, 100), {
        expectedRevision: null,
      });
      expect(result).toMatchObject({ ok: false, error: { code: "storage_error" } });
      if (!result.ok) expect(result.error.message).toContain("空间不足");
    } finally {
      put.mockRestore();
    }
    expect(await repository.read(AUTO_SAVE_SLOT_ID)).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  it("does not report success when put succeeds but the transaction later aborts", async () => {
    const factory = new IDBFactory();
    const repository = createLocalSaveRepository({ idbFactory: factory });
    expect(await repository.list()).toEqual({ ok: true, value: [] });
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request = key === undefined
        ? originalPut.call(this, value)
        : originalPut.call(this, value, key);
      request.addEventListener("success", () => this.transaction.abort(), { once: true });
      return request;
    });

    try {
      expect(await repository.write(snapshot(AUTO_SAVE_SLOT_ID, 100), {
        expectedRevision: null,
      })).toMatchObject({
        ok: false,
        error: { code: "storage_error" },
      });
    } finally {
      put.mockRestore();
    }
    expect(await repository.read(AUTO_SAVE_SLOT_ID)).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  it("returns promptly with storage_error when opening IndexedDB is blocked", async () => {
    let blockedHandler: ((this: IDBOpenDBRequest, event: Event) => unknown) | null = null;
    const request = {
      transaction: null,
      get onblocked() {
        return blockedHandler;
      },
      set onblocked(handler) {
        blockedHandler = handler;
        queueMicrotask(() => handler?.call(request as unknown as IDBOpenDBRequest, new Event("blocked")));
      },
    } as unknown as IDBOpenDBRequest;
    const blockedFactory = {
      open: () => request,
    } as unknown as IDBFactory;
    const repository = createLocalSaveRepository({ idbFactory: blockedFactory });

    const result = await Promise.race([
      repository.list(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);
    expect(result).not.toBe("timeout");
    expect(result).toMatchObject({ ok: false, error: { code: "storage_error" } });
  });

  it("reports unavailable IndexedDB and supports cancellation without claiming success", async () => {
    const unavailable = createLocalSaveRepository({ idbFactory: null });
    expect(await unavailable.list()).toMatchObject({
      ok: false,
      error: { code: "feature_unavailable" },
    });
    expect(await unavailable.read(AUTO_SAVE_SLOT_ID)).toMatchObject({
      ok: false,
      error: { code: "feature_unavailable" },
    });
    expect(await unavailable.write(snapshot(AUTO_SAVE_SLOT_ID, 100))).toMatchObject({
      ok: false,
      error: { code: "feature_unavailable" },
    });

    const factory = new IDBFactory();
    const repository = createLocalSaveRepository({ idbFactory: factory });
    const controller = new AbortController();
    const pending = repository.write(snapshot(AUTO_SAVE_SLOT_ID, 100), {
      expectedRevision: null,
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, error: { code: "aborted" } });
    expect(await repository.read(AUTO_SAVE_SLOT_ID)).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    expect(await repository.list({ signal: alreadyAborted.signal })).toMatchObject({
      ok: false,
      error: { code: "aborted" },
    });
  });
});

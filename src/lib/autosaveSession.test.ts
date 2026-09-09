import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutosaveSession } from "./autosaveSession";
import {
  captureSaveSnapshot,
  createSaveRevision,
  createSaveSlotId,
} from "./saveSlots";
import type {
  SaveGameStateV1,
  SaveRepositoryError,
  SaveRepositoryResult,
  SaveSlotMetadata,
  SaveSlotRepository,
  SaveSnapshot,
} from "./saveSlots";

const autosaveSlotId = createSaveSlotId("autosave");

function ok<T>(value: T): SaveRepositoryResult<T> {
  return { ok: true, value };
}

function failed<T>(code: SaveRepositoryError["code"], message: string = code): SaveRepositoryResult<T> {
  return { ok: false, error: { code, message } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function gameState(label = "当前场景", pageIndex = 1): SaveGameStateV1 {
  return {
    scene: {
      mood: "neutral",
      segments: [{ kind: "dialogue", text: label, mood: "neutral" }],
      suggestions: ["继续"],
      rawText: label,
    },
    pageIndex,
    history: [{
      id: `turn-${pageIndex}`,
      role: "user",
      content: label,
      createdAt: 100 + pageIndex,
    }],
    model: "deepseek-v4-flash",
  };
}

function savedSnapshot(revision = createSaveRevision("revision-1")): SaveSnapshot {
  return captureSaveSnapshot({
    slotId: autosaveSlotId,
    title: "自动存档",
    capturedAt: 200,
    createdAt: 100,
    revision,
    ...gameState("已保存场景", 0),
  });
}

function mockRepository(
  readImpl: SaveSlotRepository["read"] = async () => failed("not_found"),
  writeImpl: SaveSlotRepository["write"] = async () => failed("storage_error"),
) {
  const read = vi.fn(readImpl);
  const write = vi.fn(writeImpl);
  const repository: SaveSlotRepository = {
    list: vi.fn(async () => ok([])),
    read,
    write,
    delete: vi.fn(async () => ok(undefined)),
  };
  return { repository, read, write };
}

function metadataFor(snapshot: SaveSnapshot, revision: string): SaveSlotMetadata {
  return {
    ...snapshot.metadata,
    revision: createSaveRevision(revision),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAutosaveSession", () => {
  it("maps a missing autosave to null and only initializes once", async () => {
    const { repository, read } = mockRepository();
    const session = createAutosaveSession(repository);

    await expect(session.ready()).resolves.toEqual(ok(null));
    await expect(session.ready()).resolves.toEqual(ok(null));
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0]).toBe(autosaveSlotId);
  });

  it("returns initialization errors explicitly", async () => {
    const { repository } = mockRepository(async () => failed("storage_error", "无法读取自动存档"));
    const session = createAutosaveSession(repository);

    await expect(session.ready()).resolves.toEqual(failed("storage_error", "无法读取自动存档"));
    await expect(session.save(gameState())).resolves.toEqual(failed("storage_error", "无法读取自动存档"));
  });

  it("serializes saves and advances revision and createdAt only after success", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(1_100);
    const firstWrite = deferred<SaveRepositoryResult<SaveSlotMetadata>>();
    const secondWrite = deferred<SaveRepositoryResult<SaveSlotMetadata>>();
    const { repository, write } = mockRepository(
      async () => failed("not_found"),
      vi.fn()
        .mockImplementationOnce(async () => firstWrite.promise)
        .mockImplementationOnce(async () => secondWrite.promise),
    );
    const session = createAutosaveSession(repository);

    const firstResult = session.save(gameState("第一幕", 1));
    const secondResult = session.save(gameState("第二幕", 2));
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0][1]).toMatchObject({ expectedRevision: null });
    expect(write.mock.calls[0][0].state).toEqual(gameState("第一幕", 1));

    firstWrite.resolve(ok(metadataFor(write.mock.calls[0][0], "revision-1")));
    await expect(firstResult).resolves.toMatchObject({ ok: true });
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1][1]).toMatchObject({
      expectedRevision: createSaveRevision("revision-1"),
    });
    expect(write.mock.calls[1][0].metadata.createdAt).toBe(1_000);
    expect(write.mock.calls[1][0].state).toEqual(gameState("第二幕", 2));

    secondWrite.resolve(ok(metadataFor(write.mock.calls[1][0], "revision-2")));
    await expect(secondResult).resolves.toMatchObject({
      ok: true,
      value: { revision: createSaveRevision("revision-2") },
    });
  });

  it("uses a loaded revision for CAS and pauses after an external conflict", async () => {
    const snapshot = savedSnapshot(createSaveRevision("loaded-revision"));
    const conflict = failed<SaveSlotMetadata>("conflict", "自动存档已在别处更新");
    const { repository, write } = mockRepository(
      async () => ok(snapshot),
      async () => conflict,
    );
    const session = createAutosaveSession(repository);

    await expect(session.ready()).resolves.toEqual(ok(snapshot));
    await expect(session.save(gameState())).resolves.toEqual(conflict);
    await expect(session.save(gameState("不会覆盖"))).resolves.toEqual(conflict);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][1]).toMatchObject({
      expectedRevision: createSaveRevision("loaded-revision"),
    });
  });

  it("does not advance CAS after storage errors and never reports them as success", async () => {
    const storageFailure = failed<SaveSlotMetadata>("storage_error", "磁盘暂时不可写");
    const { repository, write } = mockRepository(
      async () => failed("not_found"),
      async () => storageFailure,
    );
    const session = createAutosaveSession(repository);

    await expect(session.save(gameState())).resolves.toEqual(storageFailure);
    await expect(session.save(gameState("重试"))).resolves.toEqual(storageFailure);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls.map((call) => call[1]?.expectedRevision)).toEqual([null, null]);
  });

  it("turns capture failures into a friendly invalid-snapshot result", async () => {
    const { repository, write } = mockRepository();
    const session = createAutosaveSession(repository);

    const result = await session.save(gameState("坏页码", -1));
    expect(result).toEqual(failed("invalid_snapshot", "当前游戏状态无法安全保存"));
    expect(write).not.toHaveBeenCalled();
  });

  it("captures only story state and omits credential-shaped extra fields", async () => {
    const { repository, write } = mockRepository(
      async () => failed("not_found"),
      async (snapshot) => ok(metadataFor(snapshot, "revision-safe")),
    );
    const session = createAutosaveSession(repository);
    const unsafeTurn = Object.assign({}, gameState().history[0], {
      authorization: "sentinel-credential",
    });
    const unsafeInput = {
      ...gameState(),
      apiKey: "sentinel-credential",
      history: [unsafeTurn],
    } as SaveGameStateV1;

    await expect(session.save(unsafeInput)).resolves.toMatchObject({ ok: true });
    expect(JSON.stringify(write.mock.calls[0][0])).not.toContain("sentinel-credential");
  });

  it("aborts a delayed read and prevents its queued save from starting", async () => {
    const delayedRead = deferred<SaveRepositoryResult<SaveSnapshot>>();
    const { repository, read, write } = mockRepository(async () => delayedRead.promise);
    const session = createAutosaveSession(repository);
    const readyResult = session.ready();
    const saveResult = session.save(gameState());

    session.dispose();
    expect(read.mock.calls[0][1]?.signal?.aborted).toBe(true);
    delayedRead.resolve(ok(savedSnapshot()));

    await expect(readyResult).resolves.toEqual(failed("aborted", "自动存档会话已结束"));
    await expect(saveResult).resolves.toEqual(failed("aborted", "自动存档会话已结束"));
    expect(write).not.toHaveBeenCalled();
  });

  it("ignores a late write result and cancels all queued follow-up work", async () => {
    const delayedWrite = deferred<SaveRepositoryResult<SaveSlotMetadata>>();
    const { repository, write } = mockRepository(
      async () => failed("not_found"),
      async () => delayedWrite.promise,
    );
    const session = createAutosaveSession(repository);
    const firstResult = session.save(gameState("第一幕"));
    const secondResult = session.save(gameState("第二幕"));
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));

    session.dispose();
    expect(write.mock.calls[0][1]?.signal?.aborted).toBe(true);
    delayedWrite.resolve(ok(metadataFor(write.mock.calls[0][0], "late-revision")));

    await expect(firstResult).resolves.toEqual(failed("aborted", "自动存档会话已结束"));
    await expect(secondResult).resolves.toEqual(failed("aborted", "自动存档会话已结束"));
    await expect(session.save(gameState("更晚"))).resolves.toEqual(
      failed("aborted", "自动存档会话已结束"),
    );
    expect(write).toHaveBeenCalledTimes(1);
  });
});

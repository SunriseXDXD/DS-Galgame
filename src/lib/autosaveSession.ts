import { AUTO_SAVE_SLOT_ID } from "./localSaveRepository";
import { captureSaveSnapshot } from "./saveSlots";
import type {
  SaveGameStateV1,
  SaveRepositoryError,
  SaveRepositoryResult,
  SaveRevision,
  SaveSlotMetadata,
  SaveSlotRepository,
  SaveSnapshot,
} from "./saveSlots";

export interface AutosaveSession {
  ready(): Promise<SaveRepositoryResult<SaveSnapshot | null>>;
  save(state: SaveGameStateV1): Promise<SaveRepositoryResult<SaveSlotMetadata>>;
  dispose(): void;
}

const ABORTED_ERROR: SaveRepositoryError = Object.freeze({
  code: "aborted",
  message: "自动存档会话已结束",
});

const STORAGE_ERROR: SaveRepositoryError = Object.freeze({
  code: "storage_error",
  message: "自动存档存储操作失败",
});

const INVALID_STATE_ERROR: SaveRepositoryError = Object.freeze({
  code: "invalid_snapshot",
  message: "当前游戏状态无法安全保存",
});

function failure<T>(error: SaveRepositoryError): SaveRepositoryResult<T> {
  return { ok: false, error };
}

export function createAutosaveSession(repository: SaveSlotRepository): AutosaveSession {
  const controller = new AbortController();
  let disposed = false;
  let readyPromise: Promise<SaveRepositoryResult<SaveSnapshot | null>> | undefined;
  let queue: Promise<void> = Promise.resolve();
  let revision: SaveRevision | null = null;
  let createdAt: number | undefined;
  let conflict: SaveRepositoryError | undefined;

  const ready = (): Promise<SaveRepositoryResult<SaveSnapshot | null>> => {
    if (disposed) return Promise.resolve(failure(ABORTED_ERROR));
    if (readyPromise) return readyPromise;

    readyPromise = (async () => {
      let result: Awaited<ReturnType<SaveSlotRepository["read"]>>;
      try {
        result = await repository.read(AUTO_SAVE_SLOT_ID, { signal: controller.signal });
      } catch {
        return disposed ? failure(ABORTED_ERROR) : failure(STORAGE_ERROR);
      }
      if (disposed) return failure(ABORTED_ERROR);
      if (!result.ok) {
        return result.error.code === "not_found"
          ? { ok: true, value: null }
          : failure(result.error);
      }

      revision = result.value.metadata.revision ?? null;
      createdAt = result.value.metadata.createdAt;
      return { ok: true, value: result.value };
    })();
    return readyPromise;
  };

  const save = (state: SaveGameStateV1): Promise<SaveRepositoryResult<SaveSlotMetadata>> => {
    if (disposed) return Promise.resolve(failure(ABORTED_ERROR));

    const task = queue.then(async (): Promise<SaveRepositoryResult<SaveSlotMetadata>> => {
      if (disposed) return failure(ABORTED_ERROR);

      const readyResult = await ready();
      if (disposed) return failure(ABORTED_ERROR);
      if (!readyResult.ok) return failure(readyResult.error);
      if (conflict) return failure(conflict);

      const capturedAt = Date.now();
      let snapshot: SaveSnapshot;
      try {
        snapshot = captureSaveSnapshot({
          slotId: AUTO_SAVE_SLOT_ID,
          title: "自动存档",
          capturedAt,
          ...(createdAt === undefined ? {} : { createdAt }),
          ...(revision === null ? {} : { revision }),
          scene: state.scene,
          pageIndex: state.pageIndex,
          history: state.history,
          model: state.model,
        });
      } catch {
        return failure(INVALID_STATE_ERROR);
      }
      if (disposed) return failure(ABORTED_ERROR);

      let result: Awaited<ReturnType<SaveSlotRepository["write"]>>;
      try {
        result = await repository.write(snapshot, {
          expectedRevision: revision,
          signal: controller.signal,
        });
      } catch {
        return disposed ? failure(ABORTED_ERROR) : failure(STORAGE_ERROR);
      }
      if (disposed) return failure(ABORTED_ERROR);
      if (!result.ok) {
        if (result.error.code === "conflict") conflict = result.error;
        return failure(result.error);
      }

      revision = result.value.revision ?? null;
      createdAt = result.value.createdAt;
      return result;
    });

    queue = task.then(() => undefined, () => undefined);
    return task;
  };

  return {
    ready,
    save,
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
    },
  };
}

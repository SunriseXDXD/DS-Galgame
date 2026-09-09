import {
  createSaveRevision,
  createSaveSlotId,
  decodeSaveSnapshot,
  isSaveRevision,
  isSaveSlotId,
} from "./saveSlots";
import type {
  SaveRepositoryError,
  SaveRepositoryMutationOptions,
  SaveRepositoryOperationOptions,
  SaveRepositoryResult,
  SaveRevision,
  SaveSlotId,
  SaveSlotMetadata,
  SaveSlotRepository,
  SaveSnapshot,
} from "./saveSlots";

export const LOCAL_SAVE_DATABASE_NAME = "jingyu-local-memory-v1" as const;
export const MANUAL_SAVE_SLOT_IDS: readonly SaveSlotId[] = Object.freeze(
  Array.from({ length: 6 }, (_, index) => createSaveSlotId(`slot-${index + 1}`)),
);
export const AUTO_SAVE_SLOT_ID = createSaveSlotId("autosave");
export const MAX_MEMORY_SLOTS = 60;

export type LocalSaveStoreName = "saves" | "memories";

export interface LocalSaveRepositoryOptions {
  readonly storeName?: LocalSaveStoreName;
  /** `null` deliberately disables IndexedDB; omission uses the browser global lazily. */
  readonly idbFactory?: IDBFactory | null;
}

const DATABASE_VERSION = 1;
const STORE_NAMES = ["saves", "memories"] as const satisfies readonly LocalSaveStoreName[];
const SAVE_SLOT_IDS = new Set<string>([AUTO_SAVE_SLOT_ID, ...MANUAL_SAVE_SLOT_IDS]);
const MEMORY_SLOT_ID_PATTERN = /^memory-[a-z0-9][a-z0-9_-]{0,55}$/i;

const ABORTED_ERROR: SaveRepositoryError = Object.freeze({
  code: "aborted",
  message: "本地存储操作已取消",
});
const UNAVAILABLE_ERROR: SaveRepositoryError = Object.freeze({
  code: "feature_unavailable",
  message: "当前环境不支持 IndexedDB，本地存档不可用",
});

let revisionSequence = 0;

function failure<T>(error: SaveRepositoryError): SaveRepositoryResult<T> {
  return { ok: false, error };
}

function storageFailure(context: string, error?: DOMException | null): SaveRepositoryError {
  if (error?.name === "QuotaExceededError") {
    return {
      code: "storage_error",
      message: "本地存储空间不足，未能保存内容",
    };
  }
  if (error?.name === "VersionError") {
    return {
      code: "storage_error",
      message: "本地存档数据库版本不兼容，请刷新页面后重试",
    };
  }
  return {
    code: "storage_error",
    message: `${context}失败，本地数据未被确认修改`,
  };
}

function invalidSnapshot(message = "本地存档内容无效，已拒绝操作"): SaveRepositoryError {
  return { code: "invalid_snapshot", message };
}

function conflict(message = "存档已在其他会话中更新，请刷新后重试"): SaveRepositoryError {
  return { code: "conflict", message };
}

function notFound(): SaveRepositoryError {
  return { code: "not_found", message: "没有找到对应的本地存档" };
}

function isAllowedSlotId(storeName: LocalSaveStoreName, slotId: string): slotId is SaveSlotId {
  if (!isSaveSlotId(slotId)) return false;
  return storeName === "saves" ? SAVE_SLOT_IDS.has(slotId) : MEMORY_SLOT_ID_PATTERN.test(slotId);
}

function validateExpectedRevision(
  expectedRevision: SaveRepositoryMutationOptions["expectedRevision"],
): SaveRepositoryError | undefined {
  return expectedRevision !== undefined && expectedRevision !== null &&
    (typeof expectedRevision !== "string" || !isSaveRevision(expectedRevision))
    ? invalidSnapshot("存档版本标记无效，已拒绝操作")
    : undefined;
}

function preconditionFailure(
  existing: SaveSnapshot | undefined,
  expectedRevision: SaveRepositoryMutationOptions["expectedRevision"],
): SaveRepositoryError | undefined {
  if (expectedRevision === undefined) return undefined;
  if (expectedRevision === null) {
    return existing === undefined ? undefined : conflict("该存档槽位已经存在，请刷新后重试");
  }
  return existing?.metadata.revision === expectedRevision ? undefined : conflict();
}

function cloneMetadata(snapshot: SaveSnapshot): SaveSlotMetadata {
  const metadata = snapshot.metadata;
  return {
    metadataVersion: metadata.metadataVersion,
    snapshotVersion: metadata.snapshotVersion,
    slotId: metadata.slotId,
    title: metadata.title,
    preview: metadata.preview,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    ...(metadata.revision === undefined ? {} : { revision: metadata.revision }),
  };
}

function decodeStoredSnapshot(
  source: unknown,
  primaryKey: IDBValidKey,
  storeName: LocalSaveStoreName,
): SaveRepositoryResult<SaveSnapshot> {
  const decoded = decodeSaveSnapshot(source);
  if (!decoded.ok) return failure(invalidSnapshot());
  if (
    typeof primaryKey !== "string" ||
    decoded.snapshot.metadata.slotId !== primaryKey ||
    !isAllowedSlotId(storeName, decoded.snapshot.metadata.slotId)
  ) {
    return failure(invalidSnapshot("本地存档槽位信息损坏，已拒绝操作"));
  }
  return { ok: true, value: decoded.snapshot };
}

function nextRevision(): SaveRevision {
  revisionSequence = (revisionSequence + 1) % Number.MAX_SAFE_INTEGER;
  let randomPart: string;
  try {
    randomPart = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    randomPart = Math.random().toString(36).slice(2);
  }
  return createSaveRevision(
    `r-${Date.now().toString(36)}-${revisionSequence.toString(36)}-${randomPart}`,
  );
}

function snapshotForStorage(candidate: SaveSnapshot, existing?: SaveSnapshot): SaveSnapshot {
  const createdAt = existing?.metadata.createdAt ?? candidate.metadata.createdAt;
  const updatedAt = Math.max(
    createdAt,
    candidate.metadata.updatedAt,
    existing?.metadata.updatedAt ?? 0,
  );
  const withRepositoryMetadata: SaveSnapshot = {
    ...candidate,
    metadata: {
      ...candidate.metadata,
      createdAt,
      updatedAt,
      revision: nextRevision(),
    },
  };
  const decoded = decodeSaveSnapshot(withRepositoryMetadata);
  if (!decoded.ok) throw new TypeError("repository metadata produced an invalid snapshot");
  return decoded.snapshot;
}

function resolveGlobalIndexedDb(): IDBFactory | undefined {
  try {
    return globalThis.indexedDB;
  } catch {
    return undefined;
  }
}

function openDatabase(
  factory: IDBFactory | undefined,
  signal?: AbortSignal,
): Promise<SaveRepositoryResult<IDBDatabase>> {
  if (!factory) return Promise.resolve(failure(UNAVAILABLE_ERROR));
  if (signal?.aborted) return Promise.resolve(failure(ABORTED_ERROR));

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    let settled = false;

    const finish = (result: SaveRepositoryResult<IDBDatabase>) => {
      if (settled) {
        if (result.ok) result.value.close();
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      resolve(result);
    };
    const handleAbort = () => {
      try {
        request?.transaction?.abort();
      } catch {
        // An open request cannot always be cancelled; a later success is closed below.
      }
      finish(failure(ABORTED_ERROR));
    };

    try {
      request = factory.open(LOCAL_SAVE_DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      finish(failure(storageFailure("打开本地存档数据库", error instanceof DOMException ? error : null)));
      return;
    }

    request.onupgradeneeded = () => {
      try {
        const database = request.result;
        for (const storeName of STORE_NAMES) {
          if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName);
        }
      } catch {
        try {
          request.transaction?.abort();
        } catch {
          // The request error/abort event below owns the final result.
        }
      }
    };
    request.onblocked = () => {
      finish(failure({
        code: "storage_error",
        message: "本地存档数据库正被其他页面占用，请关闭旧页面后重试",
      }));
    };
    request.onerror = () => {
      finish(failure(storageFailure("打开本地存档数据库", request.error)));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled || signal?.aborted) {
        database.close();
        if (!settled) finish(failure(ABORTED_ERROR));
        return;
      }
      if (STORE_NAMES.some((storeName) => !database.objectStoreNames.contains(storeName))) {
        database.close();
        finish(failure(storageFailure("校验本地存档数据库")));
        return;
      }
      database.onversionchange = () => database.close();
      finish({ ok: true, value: database });
    };

    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) handleAbort();
  });
}

interface TransactionControls<T> {
  readonly completeWith: (result: SaveRepositoryResult<T>) => void;
  readonly requestFailed: (error?: DOMException | null) => void;
  readonly guarded: (callback: () => void) => () => void;
}

function runStoreTransaction<T>(
  database: IDBDatabase,
  storeName: LocalSaveStoreName,
  mode: IDBTransactionMode,
  signal: AbortSignal | undefined,
  context: string,
  start: (store: IDBObjectStore, controls: TransactionControls<T>) => void,
): Promise<SaveRepositoryResult<T>> {
  if (signal?.aborted) return Promise.resolve(failure(ABORTED_ERROR));

  return new Promise((resolve) => {
    let transaction: IDBTransaction;
    let outcome: SaveRepositoryResult<T> | undefined;
    let requestError: DOMException | null | undefined;
    let cancelled = false;
    let settled = false;

    const finish = (result: SaveRepositoryResult<T>) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      resolve(result);
    };
    const handleAbort = () => {
      if (settled) return;
      try {
        transaction.abort();
        cancelled = true;
      } catch {
        // If the transaction already committed, its completion result wins.
      }
    };

    try {
      transaction = database.transaction(storeName, mode);
    } catch (error) {
      finish(failure(storageFailure(context, error instanceof DOMException ? error : null)));
      return;
    }

    transaction.oncomplete = () => {
      finish(outcome ?? failure(storageFailure(context)));
    };
    transaction.onabort = () => {
      finish(cancelled
        ? failure(ABORTED_ERROR)
        : failure(storageFailure(context, requestError ?? transaction.error)));
    };
    transaction.onerror = () => {
      requestError ??= transaction.error;
    };
    signal?.addEventListener("abort", handleAbort, { once: true });

    const controls: TransactionControls<T> = {
      completeWith(result) {
        outcome = result;
      },
      requestFailed(error) {
        requestError ??= error;
      },
      guarded(callback) {
        return () => {
          try {
            callback();
          } catch (error) {
            requestError ??= error instanceof DOMException ? error : null;
            try {
              transaction.abort();
            } catch {
              outcome ??= failure(storageFailure(context, requestError));
            }
          }
        };
      },
    };

    try {
      start(transaction.objectStore(storeName), controls);
    } catch (error) {
      requestError = error instanceof DOMException ? error : null;
      try {
        transaction.abort();
      } catch {
        finish(failure(storageFailure(context, requestError)));
      }
    }
    if (signal?.aborted) handleAbort();
  });
}

async function withDatabase<T>(
  factory: IDBFactory | undefined,
  signal: AbortSignal | undefined,
  operation: (database: IDBDatabase) => Promise<SaveRepositoryResult<T>>,
): Promise<SaveRepositoryResult<T>> {
  const opened = await openDatabase(factory, signal);
  if (!opened.ok) return opened;
  if (signal?.aborted) {
    opened.value.close();
    return failure(ABORTED_ERROR);
  }
  try {
    return await operation(opened.value);
  } catch {
    return failure(storageFailure("访问本地存档"));
  } finally {
    opened.value.close();
  }
}

export function createLocalSaveRepository(
  options: LocalSaveRepositoryOptions = {},
): SaveSlotRepository {
  const storeName = options.storeName ?? "saves";
  const injectedFactory = options.idbFactory;
  const factory = () => injectedFactory === undefined ? resolveGlobalIndexedDb() : injectedFactory ?? undefined;

  const rejectInvalidSlot = <T>(slotId: SaveSlotId): SaveRepositoryResult<T> | undefined =>
    typeof slotId !== "string" || !isAllowedSlotId(storeName, slotId)
      ? failure(invalidSnapshot("该槽位不属于当前本地存档仓库"))
      : undefined;

  const list: SaveSlotRepository["list"] = async (operationOptions: SaveRepositoryOperationOptions = {}) =>
    withDatabase(factory(), operationOptions.signal, (database) =>
      runStoreTransaction(
        database,
        storeName,
        "readonly",
        operationOptions.signal,
        "读取本地存档列表",
        (store, controls) => {
          const metadata: SaveSlotMetadata[] = [];
          const request = store.openCursor();
          request.onerror = () => controls.requestFailed(request.error);
          request.onsuccess = controls.guarded(() => {
            const cursor = request.result;
            if (!cursor) {
              metadata.sort((left, right) =>
                right.updatedAt - left.updatedAt || String(left.slotId).localeCompare(String(right.slotId)),
              );
              controls.completeWith({ ok: true, value: metadata });
              return;
            }
            const decoded = decodeStoredSnapshot(cursor.value, cursor.primaryKey, storeName);
            if (!decoded.ok) {
              controls.completeWith(failure(decoded.error));
              return;
            }
            metadata.push(cloneMetadata(decoded.value));
            cursor.continue();
          });
        },
      ));

  const read: SaveSlotRepository["read"] = async (
    slotId,
    operationOptions: SaveRepositoryOperationOptions = {},
  ) => {
    const slotError = rejectInvalidSlot<SaveSnapshot>(slotId);
    if (slotError) return slotError;
    return withDatabase(factory(), operationOptions.signal, (database) =>
      runStoreTransaction(
        database,
        storeName,
        "readonly",
        operationOptions.signal,
        "读取本地存档",
        (store, controls) => {
          const request = store.openCursor(slotId);
          request.onerror = () => controls.requestFailed(request.error);
          request.onsuccess = controls.guarded(() => {
            const cursor = request.result;
            if (!cursor) {
              controls.completeWith(failure(notFound()));
              return;
            }
            controls.completeWith(decodeStoredSnapshot(cursor.value, cursor.primaryKey, storeName));
          });
        },
      ));
  };

  const write: SaveSlotRepository["write"] = async (
    snapshot,
    mutationOptions: SaveRepositoryMutationOptions = {},
  ) => {
    const decodedInput = decodeSaveSnapshot(snapshot);
    if (!decodedInput.ok) return failure(invalidSnapshot());
    const slotId = decodedInput.snapshot.metadata.slotId;
    const slotError = rejectInvalidSlot<SaveSlotMetadata>(slotId);
    if (slotError) return slotError;
    const revisionError = validateExpectedRevision(mutationOptions.expectedRevision);
    if (revisionError) return failure(revisionError);

    return withDatabase(factory(), mutationOptions.signal, (database) =>
      runStoreTransaction(
        database,
        storeName,
        "readwrite",
        mutationOptions.signal,
        "写入本地存档",
        (store, controls) => {
          const targetRequest = store.openCursor(slotId);
          targetRequest.onerror = () => controls.requestFailed(targetRequest.error);
          targetRequest.onsuccess = controls.guarded(() => {
            const cursor = targetRequest.result;
            let existing: SaveSnapshot | undefined;
            if (cursor) {
              const decodedExisting = decodeStoredSnapshot(cursor.value, cursor.primaryKey, storeName);
              if (!decodedExisting.ok) {
                controls.completeWith(failure(decodedExisting.error));
                return;
              }
              existing = decodedExisting.value;
            }

            const preconditionError = preconditionFailure(existing, mutationOptions.expectedRevision);
            if (preconditionError) {
              controls.completeWith(failure(preconditionError));
              return;
            }

            const persist = () => {
              const storedSnapshot = snapshotForStorage(decodedInput.snapshot, existing);
              const putRequest = store.put(storedSnapshot, slotId);
              putRequest.onerror = () => controls.requestFailed(putRequest.error);
              putRequest.onsuccess = controls.guarded(() => {
                controls.completeWith({ ok: true, value: cloneMetadata(storedSnapshot) });
              });
            };

            if (storeName !== "memories" || existing !== undefined) {
              persist();
              return;
            }
            const countRequest = store.count();
            countRequest.onerror = () => controls.requestFailed(countRequest.error);
            countRequest.onsuccess = controls.guarded(() => {
              if (countRequest.result >= MAX_MEMORY_SLOTS) {
                controls.completeWith(failure({
                  code: "storage_error",
                  message: `本地记忆已达到 ${MAX_MEMORY_SLOTS} 条上限，请先删除旧记忆`,
                }));
                return;
              }
              persist();
            });
          });
        },
      ));
  };

  const deleteSlot: SaveSlotRepository["delete"] = async (
    slotId,
    mutationOptions: SaveRepositoryMutationOptions = {},
  ) => {
    const slotError = rejectInvalidSlot<void>(slotId);
    if (slotError) return slotError;
    const revisionError = validateExpectedRevision(mutationOptions.expectedRevision);
    if (revisionError) return failure(revisionError);

    return withDatabase(factory(), mutationOptions.signal, (database) =>
      runStoreTransaction(
        database,
        storeName,
        "readwrite",
        mutationOptions.signal,
        "删除本地存档",
        (store, controls) => {
          const targetRequest = store.openCursor(slotId);
          targetRequest.onerror = () => controls.requestFailed(targetRequest.error);
          targetRequest.onsuccess = controls.guarded(() => {
            const cursor = targetRequest.result;
            if (!cursor) {
              if (mutationOptions.expectedRevision === null) {
                controls.completeWith({ ok: true, value: undefined });
              } else {
                controls.completeWith(failure(
                  mutationOptions.expectedRevision === undefined ? notFound() : conflict(),
                ));
              }
              return;
            }

            const decodedExisting = decodeStoredSnapshot(cursor.value, cursor.primaryKey, storeName);
            if (!decodedExisting.ok) {
              controls.completeWith(failure(decodedExisting.error));
              return;
            }
            const preconditionError = preconditionFailure(
              decodedExisting.value,
              mutationOptions.expectedRevision,
            );
            if (preconditionError) {
              controls.completeWith(failure(preconditionError));
              return;
            }

            const deleteRequest = cursor.delete();
            deleteRequest.onerror = () => controls.requestFailed(deleteRequest.error);
            deleteRequest.onsuccess = controls.guarded(() => {
              controls.completeWith({ ok: true, value: undefined });
            });
          });
        },
      ));
  };

  return { list, read, write, delete: deleteSlot };
}

export const saveSlotRepository = createLocalSaveRepository({ storeName: "saves" });
export const memoryRepository = createLocalSaveRepository({ storeName: "memories" });

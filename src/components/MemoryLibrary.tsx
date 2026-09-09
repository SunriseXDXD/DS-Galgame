import {
  Archive,
  BookmarkPlus,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  HardDrive,
  Pencil,
  Play,
  RefreshCcw,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AUTO_SAVE_SLOT_ID,
  MANUAL_SAVE_SLOT_IDS,
  MAX_MEMORY_SLOTS,
  memoryRepository,
  saveSlotRepository,
} from "../lib/localSaveRepository";
import { assetUrl } from "../lib/emotions";
import { useFocusTrap } from "../lib/focusTrap";
import {
  captureSaveSnapshot,
  createSaveSlotId,
  decodeSaveSnapshot,
} from "../lib/saveSlots";
import type {
  SaveGameStateV1,
  SaveRepositoryErrorCode,
  SaveRevision,
  SaveSlotId,
  SaveSlotMetadata,
  SaveSlotRepository,
  SaveSnapshot,
} from "../lib/saveSlots";
import { sceneToPages } from "../lib/dialogue";
import { getBlackboardState } from "../lib/blackboard";
import { Blackboard } from "./Blackboard";
import "./MemoryLibrary.css";

export type MemoryLibraryTab = "save" | "load" | "gallery";

export interface MemoryLibraryProps {
  initialTab: MemoryLibraryTab;
  state: SaveGameStateV1;
  canCapture: boolean;
  onClose: () => void;
  onRestore: (snapshot: SaveSnapshot) => void;
  onNotice: (text: string) => void;
}

type RepositoryKind = "save" | "memory";

type Confirmation =
  | { kind: "overwrite"; metadata: SaveSlotMetadata; title: string }
  | { kind: "restore"; metadata: SaveSlotMetadata }
  | { kind: "delete"; metadata: SaveSlotMetadata; repositoryKind: RepositoryKind };

interface ReplayState {
  snapshot: SaveSnapshot;
  pageIndex: number;
}

const STRUCTURED_PREVIEW = /^\s*[\[{][\s\S]*[\]}]\s*$/;
const PROVIDER_FIELDS = /["'](?:choices|usage|message|delta|reasoning_content)["']\s*:/i;

function truncateCodePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}

function cleanTitle(value: string, fallback: string): string {
  return truncateCodePoints(value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim(), 80) || fallback;
}

function safePreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "没有可显示的文本预览";
  if (STRUCTURED_PREVIEW.test(normalized) || PROVIDER_FIELDS.test(normalized)) {
    return "结构化内容已安全收录，协议字段不会直接显示。";
  }
  return truncateCodePoints(normalized, 120);
}

function safeReplayText(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) return "这段回忆没有可显示的台词。";
  if (STRUCTURED_PREVIEW.test(normalized) || PROVIDER_FIELDS.test(normalized)) {
    return "这段旧回忆只留下了结构化记录，协议内容已隐藏。";
  }
  return normalized;
}

function formatDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(timestamp));
  } catch {
    return "时间未知";
  }
}

function repositoryMessage(code: SaveRepositoryErrorCode): string {
  if (code === "feature_unavailable") return "当前浏览器无法使用本地存档";
  if (code === "not_found") return "这条记录已经不存在，列表将重新读取";
  if (code === "conflict") return "记录已在另一标签页改变，请重新确认";
  if (code === "invalid_snapshot") return "记录内容未通过安全校验";
  if (code === "storage_error") return "本地存储暂时不可用，请检查浏览器空间或权限";
  return "操作已取消";
}

function upsertMetadata(items: readonly SaveSlotMetadata[], next: SaveSlotMetadata): SaveSlotMetadata[] {
  return [...items.filter((item) => item.slotId !== next.slotId), next];
}

function metadataMap(items: readonly SaveSlotMetadata[]): Map<string, SaveSlotMetadata> {
  return new Map(items.map((item) => [item.slotId, item]));
}

function memorySlotId(): SaveSlotId {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return createSaveSlotId(`memory-${random}`);
}

function sameVisibleRevision(expected: SaveSlotMetadata, actual: SaveSlotMetadata): boolean {
  if (expected.revision || actual.revision) return expected.revision === actual.revision;
  return expected.updatedAt === actual.updatedAt;
}

function speakerName(kind: string | undefined): string {
  if (kind === "narration") return "旁白";
  if (kind === "thought") return "大肥鱼 · 心声";
  return "大肥鱼";
}

export function MemoryLibrary({
  initialTab,
  state,
  canCapture,
  onClose,
  onRestore,
  onNotice,
}: MemoryLibraryProps) {
  const [tab, setTab] = useState<MemoryLibraryTab>(initialTab);
  const [saveMetadata, setSaveMetadata] = useState<readonly SaveSlotMetadata[]>([]);
  const [memoryMetadata, setMemoryMetadata] = useState<readonly SaveSlotMetadata[]>([]);
  const [saveTitles, setSaveTitles] = useState<Record<string, string>>({});
  const [memoryTitles, setMemoryTitles] = useState<Record<string, string>>({});
  const [newMemoryTitle, setNewMemoryTitle] = useState("此刻的回忆");
  const [loading, setLoading] = useState(true);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const confirmationRef = useRef<HTMLElement>(null);
  const controllersRef = useRef(new Set<AbortController>());
  const mutationControllerRef = useRef<AbortController | null>(null);
  const mutationRequiresStableRef = useRef(false);
  const mutationIdRef = useRef(0);
  const inputEpochRef = useRef(0);
  const inputIdentityRef = useRef({
    initialTab,
    scene: state.scene,
    pageIndex: state.pageIndex,
    history: state.history,
    model: state.model,
  });
  const latestRef = useRef({ state, canCapture, onClose, onRestore, onNotice });

  const previousIdentity = inputIdentityRef.current;
  if (
    previousIdentity.initialTab !== initialTab
    || previousIdentity.scene !== state.scene
    || previousIdentity.pageIndex !== state.pageIndex
    || previousIdentity.history !== state.history
    || previousIdentity.model !== state.model
  ) {
    inputIdentityRef.current = {
      initialTab,
      scene: state.scene,
      pageIndex: state.pageIndex,
      history: state.history,
      model: state.model,
    };
    inputEpochRef.current += 1;
  }
  latestRef.current = { state, canCapture, onClose, onRestore, onNotice };

  const abortAll = useCallback(() => {
    for (const controller of controllersRef.current) controller.abort("memory-library-closed");
    controllersRef.current.clear();
    mutationControllerRef.current = null;
    mutationRequiresStableRef.current = false;
  }, []);

  const closeLibrary = useCallback(() => {
    abortAll();
    latestRef.current.onClose();
  }, [abortAll]);

  const cancelConfirmation = useCallback(() => {
    if (busyLabel) closeLibrary();
    else setConfirmation(null);
  }, [busyLabel, closeLibrary]);

  useFocusTrap(dialogRef, closeLibrary, confirmation === null);
  useFocusTrap(confirmationRef, cancelConfirmation, confirmation !== null);

  useEffect(() => abortAll, [abortAll]);

  useEffect(() => {
    if (mutationRequiresStableRef.current) mutationControllerRef.current?.abort("state-changed");
    setConfirmation(null);
  }, [state.history, state.model, state.pageIndex, state.scene]);

  useEffect(() => {
    mutationControllerRef.current?.abort("tab-changed");
    setConfirmation(null);
    setReplay(null);
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!canCapture && mutationRequiresStableRef.current) {
      mutationControllerRef.current?.abort("unstable-scene");
    }
  }, [canCapture]);

  useEffect(() => {
    const controller = new AbortController();
    controllersRef.current.add(controller);
    const repository = tab === "gallery" ? memoryRepository : saveSlotRepository;
    let current = true;
    setLoading(true);
    setError("");

    void repository.list({ signal: controller.signal }).then((result) => {
      if (!current || controller.signal.aborted) return;
      if (!result.ok) {
        setError(repositoryMessage(result.error.code));
        return;
      }
      if (tab === "gallery") {
        const sorted = [...result.value].sort((left, right) => right.updatedAt - left.updatedAt);
        setMemoryMetadata(sorted);
        setMemoryTitles(Object.fromEntries(sorted.map((item) => [item.slotId, item.title])));
      } else {
        setSaveMetadata(result.value);
        const byId = metadataMap(result.value);
        setSaveTitles(Object.fromEntries(MANUAL_SAVE_SLOT_IDS.map((slotId, index) => [
          slotId,
          byId.get(slotId)?.title || `存档 ${index + 1}`,
        ])));
      }
    }).catch(() => {
      if (current && !controller.signal.aborted) setError("本地存储暂时无法读取");
    }).finally(() => {
      controllersRef.current.delete(controller);
      if (current) setLoading(false);
    });

    return () => {
      current = false;
      controller.abort("tab-changed");
      controllersRef.current.delete(controller);
    };
  }, [reloadToken, tab]);

  const saveById = useMemo(() => metadataMap(saveMetadata), [saveMetadata]);
  const sortedMemories = useMemo(
    () => [...memoryMetadata].sort((left, right) => right.updatedAt - left.updatedAt),
    [memoryMetadata],
  );
  const storageControlsDisabled = loading || Boolean(busyLabel) || Boolean(error);
  const controlsDisabled = storageControlsDisabled || !canCapture;

  const beginMutation = (label: string, requiresStableState = true) => {
    if (storageControlsDisabled || (requiresStableState && !latestRef.current.canCapture)) return undefined;
    const controller = new AbortController();
    mutationControllerRef.current?.abort("new-operation");
    mutationControllerRef.current = controller;
    mutationRequiresStableRef.current = requiresStableState;
    controllersRef.current.add(controller);
    const operation = {
      controller,
      id: ++mutationIdRef.current,
      inputEpoch: inputEpochRef.current,
      requiresStableState,
    };
    setBusyLabel(label);
    return operation;
  };

  const isCurrent = (operation: {
    controller: AbortController;
    id: number;
    inputEpoch: number;
    requiresStableState: boolean;
  }) =>
    !operation.controller.signal.aborted
    && operation.id === mutationIdRef.current
    && (!operation.requiresStableState || operation.inputEpoch === inputEpochRef.current);

  const finishMutation = (operation: { controller: AbortController; id: number }) => {
    controllersRef.current.delete(operation.controller);
    if (mutationControllerRef.current === operation.controller) {
      mutationControllerRef.current = null;
      mutationRequiresStableRef.current = false;
    }
    if (operation.id === mutationIdRef.current) setBusyLabel("");
  };

  const refreshAfterConflict = async (
    repository: SaveSlotRepository,
    repositoryKind: RepositoryKind,
    operation: { controller: AbortController; id: number; inputEpoch: number; requiresStableState: boolean },
  ) => {
    const latest = await repository.list({ signal: operation.controller.signal });
    if (!isCurrent(operation)) return;
    if (!latest.ok) {
      setError(repositoryMessage(latest.error.code));
      return;
    }
    if (repositoryKind === "memory") {
      const sorted = [...latest.value].sort((left, right) => right.updatedAt - left.updatedAt);
      setMemoryMetadata(sorted);
      setMemoryTitles(Object.fromEntries(sorted.map((item) => [item.slotId, item.title])));
    } else {
      setSaveMetadata(latest.value);
      const byId = metadataMap(latest.value);
      setSaveTitles(Object.fromEntries(MANUAL_SAVE_SLOT_IDS.map((slotId, index) => [
        slotId,
        byId.get(slotId)?.title || `存档 ${index + 1}`,
      ])));
    }
    setConfirmation(null);
    latestRef.current.onNotice("记录已在另一标签页改变，列表已刷新；请检查后再次确认");
  };

  const handleRepositoryFailure = async (
    code: SaveRepositoryErrorCode,
    repository: SaveSlotRepository,
    repositoryKind: RepositoryKind,
    operation: { controller: AbortController; id: number; inputEpoch: number; requiresStableState: boolean },
  ) => {
    if (code === "conflict" || code === "not_found") {
      await refreshAfterConflict(repository, repositoryKind, operation);
      return;
    }
    if (code === "aborted" || !isCurrent(operation)) return;
    const message = repositoryMessage(code);
    setError(message);
    latestRef.current.onNotice(message);
  };

  const performManualSave = async (
    slotId: SaveSlotId,
    metadata: SaveSlotMetadata | undefined,
    rawTitle: string,
  ) => {
    const operation = beginMutation(metadata ? "正在覆盖存档…" : "正在写入存档…");
    if (!operation) return;
    try {
      if (metadata && !metadata.revision) {
        await refreshAfterConflict(saveSlotRepository, "save", operation);
        return;
      }
      const current = latestRef.current.state;
      const title = cleanTitle(rawTitle, "未命名存档");
      const capturedAt = Date.now();
      const snapshot = captureSaveSnapshot({
        slotId,
        title,
        capturedAt,
        createdAt: metadata?.createdAt,
        revision: metadata?.revision,
        scene: current.scene,
        pageIndex: current.pageIndex,
        history: current.history,
        model: current.model,
      });
      const result = await saveSlotRepository.write(snapshot, {
        signal: operation.controller.signal,
        expectedRevision: metadata ? metadata.revision as SaveRevision : null,
      });
      if (!isCurrent(operation)) return;
      if (!result.ok) {
        await handleRepositoryFailure(result.error.code, saveSlotRepository, "save", operation);
        return;
      }
      setSaveMetadata((items) => upsertMetadata(items, result.value));
      setSaveTitles((titles) => ({ ...titles, [result.value.slotId]: result.value.title }));
      setConfirmation(null);
      latestRef.current.onNotice(metadata ? "存档已安全覆盖" : "存档已写入这台设备");
    } catch {
      if (isCurrent(operation)) {
        setError("当前场景无法安全写入存档");
        latestRef.current.onNotice("存档失败：当前场景未通过安全校验");
      }
    } finally {
      finishMutation(operation);
    }
  };

  const requestManualSave = (slotId: SaveSlotId, index: number) => {
    const metadata = saveById.get(slotId);
    const title = cleanTitle(saveTitles[slotId] || "", `存档 ${index + 1}`);
    if (metadata) setConfirmation({ kind: "overwrite", metadata, title });
    else void performManualSave(slotId, undefined, title);
  };

  const performDelete = async (metadata: SaveSlotMetadata, repositoryKind: RepositoryKind) => {
    const operation = beginMutation("正在删除本地记录…");
    if (!operation) return;
    const repository = repositoryKind === "memory" ? memoryRepository : saveSlotRepository;
    try {
      if (!metadata.revision) {
        await refreshAfterConflict(repository, repositoryKind, operation);
        return;
      }
      const result = await repository.delete(metadata.slotId, {
        signal: operation.controller.signal,
        expectedRevision: metadata.revision,
      });
      if (!isCurrent(operation)) return;
      if (!result.ok) {
        await handleRepositoryFailure(result.error.code, repository, repositoryKind, operation);
        return;
      }
      if (repositoryKind === "memory") {
        setMemoryMetadata((items) => items.filter((item) => item.slotId !== metadata.slotId));
        setMemoryTitles((titles) => {
          const next = { ...titles };
          delete next[metadata.slotId];
          return next;
        });
      } else {
        setSaveMetadata((items) => items.filter((item) => item.slotId !== metadata.slotId));
      }
      setConfirmation(null);
      latestRef.current.onNotice(repositoryKind === "memory" ? "这段回忆已从本地删除" : "本地存档已删除");
    } catch {
      if (isCurrent(operation)) setError("删除失败，本地存储暂时不可用");
    } finally {
      finishMutation(operation);
    }
  };

  const readSnapshot = async (
    metadata: SaveSlotMetadata,
    repository: SaveSlotRepository,
    repositoryKind: RepositoryKind,
    purpose: "restore" | "replay" | "rename",
  ) => {
    const operation = beginMutation(
      purpose === "restore" ? "正在读取存档…" : purpose === "replay" ? "正在准备回放…" : "正在更新标题…",
      purpose !== "replay",
    );
    if (!operation) return undefined;
    let handedOff = false;
    try {
      const result = await repository.read(metadata.slotId, { signal: operation.controller.signal });
      if (!isCurrent(operation)) return undefined;
      if (!result.ok) {
        await handleRepositoryFailure(result.error.code, repository, repositoryKind, operation);
        return undefined;
      }
      const decoded = decodeSaveSnapshot(result.value);
      if (!decoded.ok) {
        setError("记录内容未通过安全校验");
        latestRef.current.onNotice("这条记录已损坏，未读取任何内容");
        return undefined;
      }
      if (!sameVisibleRevision(metadata, decoded.snapshot.metadata)) {
        await refreshAfterConflict(repository, repositoryKind, operation);
        return undefined;
      }
      handedOff = true;
      return { snapshot: decoded.snapshot, operation };
    } catch {
      if (isCurrent(operation)) setError("读取失败，本地存储暂时不可用");
      return undefined;
    } finally {
      if (!handedOff) finishMutation(operation);
    }
  };

  const restoreSnapshot = async (metadata: SaveSlotMetadata) => {
    const loaded = await readSnapshot(metadata, saveSlotRepository, "save", "restore");
    if (!loaded) return;
    const { snapshot, operation } = loaded;
    try {
      if (!isCurrent(operation) || !latestRef.current.canCapture) return;
      try {
        latestRef.current.onRestore(snapshot);
        closeLibrary();
      } catch {
        if (isCurrent(operation)) {
          setError("这份存档暂时无法恢复，当前进度未改变");
          latestRef.current.onNotice("读档失败：这份存档无法安全恢复");
        }
      }
    } finally {
      finishMutation(operation);
    }
  };

  const replaySnapshot = async (metadata: SaveSlotMetadata) => {
    const loaded = await readSnapshot(metadata, memoryRepository, "memory", "replay");
    if (!loaded) return;
    const { snapshot, operation } = loaded;
    try {
      if (!isCurrent(operation)) return;
      const pages = sceneToPages(snapshot.state.scene);
      setReplay({
        snapshot,
        pageIndex: Math.min(snapshot.state.pageIndex, Math.max(0, pages.length - 1)),
      });
    } finally {
      finishMutation(operation);
    }
  };

  const collectCurrentMemory = async () => {
    if (memoryMetadata.length >= MAX_MEMORY_SLOTS) {
      latestRef.current.onNotice(`回忆馆最多收藏 ${MAX_MEMORY_SLOTS} 段，请先删除旧收藏`);
      return;
    }
    const operation = beginMutation("正在收藏当前片段…");
    if (!operation) return;
    try {
      const current = latestRef.current.state;
      const snapshot = captureSaveSnapshot({
        slotId: memorySlotId(),
        title: cleanTitle(newMemoryTitle, "此刻的回忆"),
        capturedAt: Date.now(),
        scene: current.scene,
        pageIndex: current.pageIndex,
        history: current.history,
        model: current.model,
      });
      const result = await memoryRepository.write(snapshot, {
        signal: operation.controller.signal,
        expectedRevision: null,
      });
      if (!isCurrent(operation)) return;
      if (!result.ok) {
        await handleRepositoryFailure(result.error.code, memoryRepository, "memory", operation);
        return;
      }
      setMemoryMetadata((items) => [result.value, ...items]);
      setMemoryTitles((titles) => ({ ...titles, [result.value.slotId]: result.value.title }));
      setNewMemoryTitle("此刻的回忆");
      latestRef.current.onNotice("当前片段已收藏到本地回忆馆");
    } catch {
      if (isCurrent(operation)) setError("当前片段无法安全收藏");
    } finally {
      finishMutation(operation);
    }
  };

  const renameMemory = async (metadata: SaveSlotMetadata) => {
    const title = cleanTitle(memoryTitles[metadata.slotId] || "", metadata.title);
    if (title === metadata.title) return;
    const loaded = await readSnapshot(metadata, memoryRepository, "memory", "rename");
    if (!loaded) return;
    const { snapshot, operation } = loaded;
    try {
      if (!snapshot.metadata.revision) {
        await refreshAfterConflict(memoryRepository, "memory", operation);
        return;
      }
      const updatedAt = Math.max(Date.now(), snapshot.metadata.createdAt);
      const renamed = captureSaveSnapshot({
        slotId: snapshot.metadata.slotId,
        title,
        capturedAt: updatedAt,
        createdAt: snapshot.metadata.createdAt,
        revision: snapshot.metadata.revision,
        scene: snapshot.state.scene,
        pageIndex: snapshot.state.pageIndex,
        history: snapshot.state.history,
        model: snapshot.state.model,
      });
      const result = await memoryRepository.write(renamed, {
        signal: operation.controller.signal,
        expectedRevision: snapshot.metadata.revision,
      });
      if (!isCurrent(operation)) return;
      if (!result.ok) {
        await handleRepositoryFailure(result.error.code, memoryRepository, "memory", operation);
        return;
      }
      setMemoryMetadata((items) => upsertMetadata(items, result.value));
      setMemoryTitles((titles) => ({ ...titles, [result.value.slotId]: result.value.title }));
      latestRef.current.onNotice("回忆标题已更新");
    } catch {
      if (isCurrent(operation)) setError("回忆标题更新失败");
    } finally {
      finishMutation(operation);
    }
  };

  const confirmAction = () => {
    if (!confirmation) return;
    if (confirmation.kind === "overwrite") {
      void performManualSave(confirmation.metadata.slotId, confirmation.metadata, confirmation.title);
    } else if (confirmation.kind === "restore") {
      void restoreSnapshot(confirmation.metadata);
    } else {
      void performDelete(confirmation.metadata, confirmation.repositoryKind);
    }
  };

  const replayPages = useMemo(
    () => replay ? sceneToPages(replay.snapshot.state.scene) : [],
    [replay?.snapshot],
  );
  const replayPage = replayPages[Math.min(replay?.pageIndex ?? 0, Math.max(0, replayPages.length - 1))];
  const replayBoardState = useMemo(
    () => getBlackboardState(replayPages, replay?.pageIndex ?? 0),
    [replay?.pageIndex, replayPages],
  );
  const replayBlackboard = replayBoardState.content;
  const navigateReplayBoard = (targetPageIndex: number | undefined) => {
    if (targetPageIndex === undefined) return;
    setReplay((current) => current ? { ...current, pageIndex: targetPageIndex } : current);
  };
  const previousQuestion = useMemo(() => {
    if (!replay) return "";
    const question = [...replay.snapshot.state.history].reverse().find((turn) => turn.role === "user")?.content || "";
    return safePreview(question);
  }, [replay]);

  const tabTitle = tab === "save" ? "记录此刻" : tab === "load" ? "读取进度" : "回忆收藏";

  return (
    <div className="memory-library-layer" role="presentation">
      <button type="button" className="memory-library-scrim" onClick={closeLibrary} aria-label="关闭存档与回忆馆" />
      <section
        ref={dialogRef}
        className="memory-library"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-library-title"
        aria-busy={Boolean(busyLabel)}
        tabIndex={-1}
      >
        <div className="memory-library__chrome" inert={confirmation ? true : undefined} aria-hidden={confirmation ? true : undefined}>
          <header className="memory-library__header">
            <div>
              <span>DEEP SEA / MEMORY ARCHIVE</span>
              <h2 id="memory-library-title">鲸语存档与回忆馆</h2>
            </div>
            <button type="button" className="memory-icon-button" onClick={closeLibrary} aria-label="关闭">
              <X size={20} />
            </button>
          </header>

          {replay ? (
            <section className="memory-replay" aria-label="回忆回放">
              <header className="memory-replay__header">
                <button type="button" className="memory-button memory-button--ghost" onClick={() => setReplay(null)}>
                  <ChevronLeft size={16} /> 返回书架
                </button>
                <div>
                  <span>MEMORY PLAYBACK</span>
                  <h3>{replay.snapshot.metadata.title}</h3>
                </div>
                <span className="memory-replay__counter">
                  {Math.min(replay.pageIndex + 1, Math.max(1, replayPages.length))} / {Math.max(1, replayPages.length)}
                </span>
              </header>
              <div className={`memory-replay__stage${replayBlackboard ? " has-board" : ""}`}>
                <div className="memory-replay__art">
                  <div className="memory-replay__halo" aria-hidden="true" />
                  <img src={assetUrl(replayPage?.mood ?? replay.snapshot.state.scene.mood)} alt="大肥鱼回忆立绘" />
                </div>
                {replayBlackboard && <div className="memory-replay__board">
                  <Blackboard
                    content={replayBlackboard}
                    step={replayBoardState.step}
                    onPreviousStep={replayBoardState.previousPageIndex === undefined ? undefined : () => navigateReplayBoard(replayBoardState.previousPageIndex)}
                    onNextStep={replayBoardState.nextPageIndex === undefined ? undefined : () => navigateReplayBoard(replayBoardState.nextPageIndex)}
                  />
                </div>}
                <article className="memory-replay__dialogue">
                  <span>{speakerName(replayPage?.kind)}</span>
                  <p key={replay.pageIndex} tabIndex={0} aria-label="回忆台词，可滚动查看">{safeReplayText(replayPage?.text)}</p>
                </article>
              </div>
              {previousQuestion && (
                <p className="memory-replay__question"><strong>你当时问：</strong>{previousQuestion}</p>
              )}
              <footer className="memory-replay__controls">
                <button
                  type="button"
                  className="memory-button memory-button--ghost"
                  disabled={replay.pageIndex <= 0}
                  onClick={() => setReplay((current) => current ? { ...current, pageIndex: Math.max(0, current.pageIndex - 1) } : current)}
                >
                  <ChevronLeft size={17} /> 上一页
                </button>
                <button
                  type="button"
                  className="memory-button"
                  disabled={replay.pageIndex >= replayPages.length - 1}
                  onClick={() => setReplay((current) => current ? {
                    ...current,
                    pageIndex: Math.min(replayPages.length - 1, current.pageIndex + 1),
                  } : current)}
                >
                  下一页 <ChevronRight size={17} />
                </button>
              </footer>
            </section>
          ) : (
            <>
              <nav className="memory-library__tabs" role="tablist" aria-label="存档与回忆分类">
                {([
                  ["save", Save, "存档"],
                  ["load", HardDrive, "读档"],
                  ["gallery", BookOpen, "回忆馆"],
                ] as const).map(([value, Icon, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    className={tab === value ? "is-active" : ""}
                    disabled={Boolean(busyLabel)}
                    onClick={() => setTab(value)}
                  >
                    <Icon size={17} /> {label}
                  </button>
                ))}
              </nav>

              <div className="memory-library__body" role="tabpanel" aria-label={tabTitle}>
                <div className="memory-library__intro">
                  <div>
                    <span>{tab === "gallery" ? "MEMORY SHELF" : "SAVE TERMINAL"}</span>
                    <h3>{tabTitle}</h3>
                  </div>
                  <p>{tab === "save"
                    ? "为当前稳定分镜留下六份手动记录。"
                    : tab === "load"
                      ? "读档会替换主界面的当前剧情进度。"
                      : `收藏独立片段并在馆内回放，最多 ${MAX_MEMORY_SLOTS} 段。`}</p>
                </div>

                {!canCapture && (
                  <div className="memory-library__warning" role="status">
                    主剧情读档、写入与收藏已暂停；仍可浏览和回放已有回忆。
                  </div>
                )}
                {error && (
                  <div className="memory-library__error" role="alert">
                    <span>{error}</span>
                    <button type="button" onClick={() => { setError(""); setReloadToken((value) => value + 1); }}>
                      <RefreshCcw size={14} /> 重试读取
                    </button>
                  </div>
                )}
                {busyLabel && <div className="memory-library__busy" role="status"><i />{busyLabel}</div>}

                {loading ? (
                  <div className="memory-library__loading"><i /><span>正在读取本地档案…</span></div>
                ) : tab === "save" ? (
                  <div className="memory-slot-grid">
                    {MANUAL_SAVE_SLOT_IDS.map((slotId, index) => {
                      const metadata = saveById.get(slotId);
                      return (
                        <article key={slotId} className={`memory-slot${metadata ? " is-filled" : " is-empty"}`}>
                          <header><span>SLOT {String(index + 1).padStart(2, "0")}</span>{metadata && <Clock3 size={13} />}</header>
                          <label>
                            <span className="sr-only">存档标题</span>
                            <input
                              value={saveTitles[slotId] ?? `存档 ${index + 1}`}
                              maxLength={80}
                              disabled={controlsDisabled}
                              onChange={(event) => setSaveTitles((titles) => ({ ...titles, [slotId]: event.target.value }))}
                            />
                          </label>
                          <p>{metadata ? safePreview(metadata.preview) : "空槽位 · 等待记录当前剧情"}</p>
                          <footer>
                            <time>{metadata ? formatDate(metadata.updatedAt) : "尚未保存"}</time>
                            <div>
                              {metadata && (
                                <button
                                  type="button"
                                  className="memory-card-icon is-danger"
                                  disabled={controlsDisabled}
                                  onClick={() => setConfirmation({ kind: "delete", metadata, repositoryKind: "save" })}
                                  aria-label={`删除${metadata.title}`}
                                ><Trash2 size={14} /></button>
                              )}
                              <button
                                type="button"
                                className="memory-card-action"
                                disabled={controlsDisabled}
                                onClick={() => requestManualSave(slotId, index)}
                              ><Save size={14} />{metadata ? "覆盖" : "保存"}</button>
                            </div>
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                ) : tab === "load" ? (
                  <div className="memory-load-list">
                    {[AUTO_SAVE_SLOT_ID, ...MANUAL_SAVE_SLOT_IDS].map((slotId, index) => {
                      const metadata = saveById.get(slotId);
                      const automatic = slotId === AUTO_SAVE_SLOT_ID;
                      return (
                        <article key={slotId} className={`memory-load-card${metadata ? " is-filled" : " is-empty"}`}>
                          <div className="memory-load-card__index">{automatic ? "AUTO" : String(index).padStart(2, "0")}</div>
                          <div className="memory-load-card__copy">
                            <span>{automatic ? "自动存档" : metadata?.title || `存档 ${index}`}</span>
                            <p>{metadata ? safePreview(metadata.preview) : "这个槽位还没有记录。"}</p>
                            <time>{metadata ? formatDate(metadata.updatedAt) : "EMPTY"}</time>
                          </div>
                          <div className="memory-load-card__actions">
                            {metadata && (
                              <>
                                <button
                                  type="button"
                                  className="memory-button memory-button--ghost is-danger"
                                  disabled={controlsDisabled}
                                  onClick={() => setConfirmation({ kind: "delete", metadata, repositoryKind: "save" })}
                                ><Trash2 size={14} /> 删除</button>
                                <button
                                  type="button"
                                  className="memory-button"
                                  disabled={controlsDisabled}
                                  onClick={() => setConfirmation({ kind: "restore", metadata })}
                                ><Play size={14} /> 读取</button>
                              </>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="memory-gallery">
                    <section className="memory-capture-card">
                      <div className="memory-capture-card__icon"><BookmarkPlus size={23} /></div>
                      <label>
                        <span>收藏当前片段</span>
                        <input
                          value={newMemoryTitle}
                          maxLength={80}
                          disabled={controlsDisabled || memoryMetadata.length >= MAX_MEMORY_SLOTS}
                          onChange={(event) => setNewMemoryTitle(event.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        className="memory-button"
                        disabled={controlsDisabled || memoryMetadata.length >= MAX_MEMORY_SLOTS}
                        onClick={() => void collectCurrentMemory()}
                      ><Archive size={15} /> 收藏 {memoryMetadata.length}/{MAX_MEMORY_SLOTS}</button>
                    </section>

                    {!sortedMemories.length ? (
                      <div className="memory-gallery__empty">
                        <BookOpen size={35} />
                        <strong>书架还是空的</strong>
                        <span>遇到想留下的片段时，收藏到这里吧。</span>
                      </div>
                    ) : (
                      <div className="memory-shelf">
                        {sortedMemories.map((metadata, index) => (
                          <article key={metadata.slotId} className="memory-book">
                            <div className="memory-book__number">MEM {String(index + 1).padStart(2, "0")}</div>
                            <label>
                              <span className="sr-only">回忆标题</span>
                              <input
                                value={memoryTitles[metadata.slotId] ?? metadata.title}
                                maxLength={80}
                                disabled={controlsDisabled}
                                onChange={(event) => setMemoryTitles((titles) => ({
                                  ...titles,
                                  [metadata.slotId]: event.target.value,
                                }))}
                              />
                            </label>
                            <p>{safePreview(metadata.preview)}</p>
                            <time>{formatDate(metadata.updatedAt)}</time>
                            <footer>
                              <button
                                type="button"
                                className="memory-card-icon"
                                disabled={controlsDisabled || cleanTitle(memoryTitles[metadata.slotId] || "", metadata.title) === metadata.title}
                                onClick={() => void renameMemory(metadata)}
                                aria-label={`保存${metadata.title}的新标题`}
                              ><Pencil size={14} /></button>
                              <button
                                type="button"
                                className="memory-card-icon is-danger"
                                disabled={controlsDisabled}
                                onClick={() => setConfirmation({ kind: "delete", metadata, repositoryKind: "memory" })}
                                aria-label={`删除回忆${metadata.title}`}
                              ><Trash2 size={14} /></button>
                              <button
                                type="button"
                                className="memory-card-action"
                                disabled={storageControlsDisabled}
                                onClick={() => void replaySnapshot(metadata)}
                              ><Play size={14} /> 回放</button>
                            </footer>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <footer className="memory-library__privacy">
                <Database size={15} />
                <p><strong>仅保存在这台设备的浏览器中，内容为本地明文。</strong>清理站点数据会一并删除；API Key 属于独立设置，不会写入存档或回忆。</p>
                <ShieldCheck size={16} />
              </footer>
            </>
          )}
        </div>

        {confirmation && (
          <section
            ref={confirmationRef}
            className="memory-confirmation"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="memory-confirmation-title"
            aria-describedby="memory-confirmation-copy"
            tabIndex={-1}
          >
            <div className="memory-confirmation__mark">!</div>
            <span>LOCAL ARCHIVE / CONFIRM</span>
            <h3 id="memory-confirmation-title">
              {confirmation.kind === "overwrite" ? "覆盖这个存档？" : confirmation.kind === "restore" ? "读取并替换当前进度？" : "永久删除本地记录？"}
            </h3>
            <p id="memory-confirmation-copy">
              {confirmation.kind === "overwrite"
                ? `「${confirmation.metadata.title}」的旧内容会被当前分镜替换。`
                : confirmation.kind === "restore"
                  ? `主界面将回到「${confirmation.metadata.title}」保存时的场景与对话进度。`
                  : `「${confirmation.metadata.title}」只存在于本地，删除后无法恢复。`}
            </p>
            <div className="memory-confirmation__actions">
              <button type="button" className="memory-button memory-button--ghost" disabled={Boolean(busyLabel)} onClick={() => setConfirmation(null)}>取消</button>
              <button
                type="button"
                className={`memory-button${confirmation.kind === "delete" ? " is-danger" : ""}`}
                disabled={Boolean(busyLabel) || !canCapture}
                onClick={confirmAction}
                autoFocus
              >
                {busyLabel || (confirmation.kind === "overwrite" ? "确认覆盖" : confirmation.kind === "restore" ? "确认读取" : "确认删除")}
              </button>
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

import { CHARACTER_ACTIONS, EMOTIONS } from "../types";
import type { AssistantScene, CharacterAction, ChatTurn, ModelId, SceneSegment } from "../types";

export const SAVE_SNAPSHOT_SCHEMA = "ds-galgame/save" as const;
export const CURRENT_SAVE_SNAPSHOT_VERSION = 1 as const;
export const CURRENT_SAVE_METADATA_VERSION = 1 as const;
export const SAVE_LIMITS = Object.freeze({
  jsonBytes: 4 * 1024 * 1024,
  structureDepth: 12,
  structureNodes: 4_096,
  objectKeys: 32,
  scanArrayItems: 256,
  titleCodePoints: 80,
  previewCodePoints: 96,
  revisionCodePoints: 256,
  sceneSegments: 16,
  segmentTextCodePoints: 16_000,
  sceneRawTextCodePoints: 32_000,
  suggestions: 8,
  suggestionCodePoints: 128,
  historyTurns: 60,
  historyContentCodePoints: 8_000,
  turnIdCodePoints: 128,
});

export type SaveSnapshotVersion = typeof CURRENT_SAVE_SNAPSHOT_VERSION;
export type SaveMetadataVersion = typeof CURRENT_SAVE_METADATA_VERSION;

declare const SAVE_SLOT_ID_BRAND: unique symbol;
export type SaveSlotId = string & { readonly [SAVE_SLOT_ID_BRAND]: true };

declare const SAVE_REVISION_BRAND: unique symbol;
export type SaveRevision = string & { readonly [SAVE_REVISION_BRAND]: true };

export interface SaveSlotMetadataV1 {
  readonly metadataVersion: SaveMetadataVersion;
  readonly snapshotVersion: SaveSnapshotVersion;
  readonly slotId: SaveSlotId;
  readonly title: string;
  readonly preview: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Repository-owned opaque concurrency token. */
  readonly revision?: SaveRevision;
}

export type SaveSlotMetadata = SaveSlotMetadataV1;

export interface SaveGameStateV1 {
  readonly scene: AssistantScene;
  readonly pageIndex: number;
  readonly history: readonly ChatTurn[];
  readonly model: ModelId;
}

export interface SaveSnapshotV1 {
  readonly schema: typeof SAVE_SNAPSHOT_SCHEMA;
  readonly version: SaveSnapshotVersion;
  readonly metadata: SaveSlotMetadataV1;
  readonly state: SaveGameStateV1;
}

export type SaveSnapshot = SaveSnapshotV1;

/**
 * Deliberately contains story state only. Credential fields are impossible to
 * provide through the typed capture boundary and are never copied at runtime.
 */
export interface SaveCaptureInput {
  readonly slotId: SaveSlotId;
  readonly title?: string;
  readonly capturedAt: number;
  readonly createdAt?: number;
  readonly scene: AssistantScene;
  readonly pageIndex: number;
  readonly history: readonly ChatTurn[];
  readonly model: ModelId;
  readonly revision?: SaveRevision;
  readonly apiKey?: never;
  readonly authorization?: never;
  readonly accessToken?: never;
}

export type SaveRepositoryErrorCode =
  | "feature_unavailable"
  | "not_found"
  | "conflict"
  | "aborted"
  | "invalid_snapshot"
  | "storage_error";

export interface SaveRepositoryError {
  readonly code: SaveRepositoryErrorCode;
  readonly message: string;
}

export type SaveRepositoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SaveRepositoryError };

export interface SaveRepositoryOperationOptions {
  readonly signal?: AbortSignal;
}

export interface SaveRepositoryMutationOptions extends SaveRepositoryOperationOptions {
  /** Undefined means no precondition; null means the slot must not exist. */
  readonly expectedRevision?: SaveRevision | null;
}

export interface SaveSlotRepository {
  list(options?: SaveRepositoryOperationOptions): Promise<SaveRepositoryResult<readonly SaveSlotMetadata[]>>;
  read(slotId: SaveSlotId, options?: SaveRepositoryOperationOptions): Promise<SaveRepositoryResult<SaveSnapshot>>;
  write(
    snapshot: SaveSnapshot,
    options?: SaveRepositoryMutationOptions,
  ): Promise<SaveRepositoryResult<SaveSlotMetadata>>;
  delete(
    slotId: SaveSlotId,
    options?: SaveRepositoryMutationOptions,
  ): Promise<SaveRepositoryResult<void>>;
}

export interface SaveSnapshotValidator {
  readonly version: number;
  validate(value: unknown): boolean;
}

export interface SaveSnapshotMigration {
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(value: unknown): unknown;
}

export interface SaveSchemaExtensions {
  readonly validators: readonly SaveSnapshotValidator[];
  readonly migrations: readonly SaveSnapshotMigration[];
}

export type SaveDecodeErrorCode =
  | "invalid_json"
  | "invalid_snapshot"
  | "limit_exceeded"
  | "unsupported_version"
  | "migration_failed";

export type SaveDecodeResult =
  | { readonly ok: true; readonly snapshot: SaveSnapshot }
  | {
    readonly ok: false;
    readonly error: { readonly code: SaveDecodeErrorCode; readonly message: string };
  };

const SLOT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MODEL_IDS = new Set<ModelId>(["deepseek-v4-flash", "deepseek-v4-pro"]);
const EMOTION_IDS = new Set<string>(EMOTIONS);
const CHARACTER_ACTION_IDS = new Set<string>(CHARACTER_ACTIONS);
const SEGMENT_KINDS = new Set(["narration", "dialogue", "thought"]);
const FORBIDDEN_CREDENTIAL_FIELDS = new Set([
  "apikey",
  "deepseekapikey",
  "authorization",
  "token",
  "accesstoken",
  "refreshtoken",
  "bearertoken",
]);
const SNAPSHOT_KEYS = new Set(["schema", "version", "metadata", "state"]);
const METADATA_KEYS = new Set([
  "metadataVersion",
  "snapshotVersion",
  "slotId",
  "title",
  "preview",
  "createdAt",
  "updatedAt",
  "revision",
]);
const STATE_KEYS = new Set(["scene", "pageIndex", "history", "model"]);
const SCENE_KEYS = new Set(["mood", "segments", "suggestions", "rawText"]);
const SEGMENT_KEYS = new Set(["kind", "text", "mood", "action"]);
const TURN_KEYS = new Set(["id", "role", "content", "mood", "createdAt"]);

type StructureInspectionResult = "safe" | "credential" | "limit" | "invalid";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCodePointLengthAtMost(value: string, maximum: number): boolean {
  let length = 0;
  for (const _character of value) {
    length += 1;
    if (length > maximum) return false;
  }
  return true;
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && isCodePointLengthAtMost(value, maximum);
}

function truncateCodePoints(value: string, maximum: number): string {
  let result = "";
  let length = 0;
  for (const character of value) {
    if (length >= maximum) break;
    result += character;
    length += 1;
  }
  return result;
}

function isUtf8ByteLengthAtMost(value: string, maximum: number): boolean {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes > maximum) return false;
  }
  return true;
}

function hasStrictKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.every((key) => typeof key === "string" && allowed.has(key)) &&
    required.every((key) => Object.hasOwn(value, key));
}

function isStrictArray(value: unknown, maximumItems: number): value is unknown[] {
  if (!Array.isArray(value)) return false;
  const length = value.length;
  if (!Number.isInteger(length) || length < 0 || length > maximumItems) return false;
  if (Reflect.ownKeys(value).length !== length + 1) return false;
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function isStrictArrayOf<T>(
  value: unknown,
  maximumItems: number,
  predicate: (item: unknown) => item is T,
  minimumItems = 0,
): value is T[] {
  if (!isStrictArray(value, maximumItems)) return false;
  const length = value.length;
  if (!Number.isInteger(length) || length < minimumItems || length > maximumItems) return false;
  for (let index = 0; index < length; index += 1) {
    if (!predicate(value[index])) return false;
  }
  return true;
}

function inspectUnknownStructure(value: unknown): StructureInspectionResult {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;

  try {
    while (pending.length) {
      const current = pending.pop();
      if (!current || typeof current.value !== "object" || current.value === null) continue;
      if (seen.has(current.value)) continue;
      seen.add(current.value);
      nodes += 1;
      if (nodes > SAVE_LIMITS.structureNodes || current.depth > SAVE_LIMITS.structureDepth) {
        return "limit";
      }

      if (Array.isArray(current.value)) {
        if (current.value.length > SAVE_LIMITS.scanArrayItems) return "limit";
        const keys = Reflect.ownKeys(current.value);
        if (keys.length > SAVE_LIMITS.scanArrayItems + 1) return "limit";
        for (const key of keys) {
          if (key === "length") continue;
          if (typeof key !== "string") return "invalid";
          const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
          if (FORBIDDEN_CREDENTIAL_FIELDS.has(normalizedKey)) return "credential";
          pending.push({
            value: (current.value as unknown[] & Record<string, unknown>)[key],
            depth: current.depth + 1,
          });
        }
        continue;
      }

      const keys = Reflect.ownKeys(current.value);
      if (keys.length > SAVE_LIMITS.objectKeys) return "limit";
      for (const key of keys) {
        if (typeof key !== "string") return "invalid";
        const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
        if (FORBIDDEN_CREDENTIAL_FIELDS.has(normalizedKey)) return "credential";
        pending.push({
          value: (current.value as Record<string, unknown>)[key],
          depth: current.depth + 1,
        });
      }
    }
  } catch {
    return "invalid";
  }

  return "safe";
}

function isEmotion(value: unknown): boolean {
  return typeof value === "string" && EMOTION_IDS.has(value);
}

function isCharacterAction(value: unknown): value is CharacterAction {
  return typeof value === "string" && CHARACTER_ACTION_IDS.has(value);
}

function isSceneSegment(value: unknown): value is SceneSegment {
  if (!isRecord(value)) return false;
  return hasStrictKeys(value, SEGMENT_KEYS, ["kind", "text"]) &&
    isBoundedString(value.text, SAVE_LIMITS.segmentTextCodePoints) &&
    typeof value.kind === "string" && SEGMENT_KINDS.has(value.kind) &&
    (value.mood === undefined || isEmotion(value.mood)) &&
    (value.action === undefined || isCharacterAction(value.action));
}

function isAssistantScene(value: unknown): value is AssistantScene {
  if (!isRecord(value)) return false;
  return hasStrictKeys(value, SCENE_KEYS, ["mood", "segments", "suggestions", "rawText"]) &&
    isEmotion(value.mood) &&
    isStrictArrayOf(value.segments, SAVE_LIMITS.sceneSegments, isSceneSegment, 1) &&
    isStrictArrayOf(
      value.suggestions,
      SAVE_LIMITS.suggestions,
      (item): item is string => isBoundedString(item, SAVE_LIMITS.suggestionCodePoints),
    ) &&
    isBoundedString(value.rawText, SAVE_LIMITS.sceneRawTextCodePoints);
}

function isChatTurn(value: unknown): value is ChatTurn {
  if (!isRecord(value)) return false;
  return hasStrictKeys(value, TURN_KEYS, ["id", "role", "content", "createdAt"]) &&
    isBoundedString(value.id, SAVE_LIMITS.turnIdCodePoints) && value.id.length > 0 &&
    (value.role === "user" || value.role === "assistant") &&
    isBoundedString(value.content, SAVE_LIMITS.historyContentCodePoints) &&
    isFiniteTimestamp(value.createdAt) &&
    (value.mood === undefined || isEmotion(value.mood));
}

function isSaveSlotMetadataV1(value: unknown): value is SaveSlotMetadataV1 {
  if (!isRecord(value)) return false;
  return hasStrictKeys(value, METADATA_KEYS, [
    "metadataVersion",
    "snapshotVersion",
    "slotId",
    "title",
    "preview",
    "createdAt",
    "updatedAt",
  ]) &&
    value.metadataVersion === CURRENT_SAVE_METADATA_VERSION &&
    value.snapshotVersion === CURRENT_SAVE_SNAPSHOT_VERSION &&
    typeof value.slotId === "string" && isSaveSlotId(value.slotId) &&
    isBoundedString(value.title, SAVE_LIMITS.titleCodePoints) && value.title.trim().length > 0 &&
    isBoundedString(value.preview, SAVE_LIMITS.previewCodePoints) &&
    isFiniteTimestamp(value.createdAt) &&
    isFiniteTimestamp(value.updatedAt) &&
    value.updatedAt >= value.createdAt &&
    (value.revision === undefined || (typeof value.revision === "string" && isSaveRevision(value.revision)));
}

export function isSaveSlotId(value: string): value is SaveSlotId {
  return SLOT_ID_PATTERN.test(value);
}

export function createSaveSlotId(value: string): SaveSlotId {
  if (!isSaveSlotId(value)) {
    throw new TypeError("存档槽位 ID 格式无效");
  }
  return value;
}

export function isSaveRevision(value: string): value is SaveRevision {
  return isCodePointLengthAtMost(value, SAVE_LIMITS.revisionCodePoints) && /^[!-~]+$/.test(value);
}

export function createSaveRevision(value: string): SaveRevision {
  if (!isSaveRevision(value)) throw new TypeError("存档版本标记格式无效");
  return value;
}

export function isSaveSnapshotV1(value: unknown): value is SaveSnapshotV1 {
  try {
    if (!isRecord(value) || inspectUnknownStructure(value) !== "safe") return false;
    if (
      !hasStrictKeys(value, SNAPSHOT_KEYS, ["schema", "version", "metadata", "state"]) ||
      value.schema !== SAVE_SNAPSHOT_SCHEMA ||
      value.version !== CURRENT_SAVE_SNAPSHOT_VERSION ||
      !isSaveSlotMetadataV1(value.metadata) ||
      !isRecord(value.state) ||
      !hasStrictKeys(value.state, STATE_KEYS, ["scene", "pageIndex", "history", "model"])
    ) return false;

    const state = value.state;
    return isAssistantScene(state.scene) &&
      Number.isInteger(state.pageIndex) && Number(state.pageIndex) >= 0 &&
      isStrictArrayOf(state.history, SAVE_LIMITS.historyTurns, isChatTurn) &&
      typeof state.model === "string" && MODEL_IDS.has(state.model as ModelId);
  } catch {
    return false;
  }
}

export const DEFAULT_SAVE_SCHEMA_EXTENSIONS: SaveSchemaExtensions = {
  validators: [{ version: CURRENT_SAVE_SNAPSHOT_VERSION, validate: isSaveSnapshotV1 }],
  migrations: [],
};

function cloneScene(scene: AssistantScene): AssistantScene {
  const sourceSegments = scene.segments;
  if (!Array.isArray(sourceSegments)) {
    throw new TypeError("存档内容不符合 V1 大小或结构限制");
  }
  const segmentCount = sourceSegments.length;
  if (!Number.isInteger(segmentCount) || segmentCount < 0 || segmentCount > SAVE_LIMITS.sceneSegments) {
    throw new TypeError("存档内容不符合 V1 大小或结构限制");
  }
  const segments: SceneSegment[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const segment = sourceSegments[index];
    segments.push({
      kind: segment.kind,
      text: segment.text,
      ...(segment.mood ? { mood: segment.mood } : {}),
      ...(segment.action !== undefined ? { action: segment.action } : {}),
    });
  }

  const sourceSuggestions = scene.suggestions;
  if (!Array.isArray(sourceSuggestions)) {
    throw new TypeError("存档内容不符合 V1 大小或结构限制");
  }
  const suggestionCount = sourceSuggestions.length;
  if (!Number.isInteger(suggestionCount) || suggestionCount < 0 || suggestionCount > SAVE_LIMITS.suggestions) {
    throw new TypeError("存档内容不符合 V1 大小或结构限制");
  }
  const suggestions: string[] = [];
  for (let index = 0; index < suggestionCount; index += 1) {
    suggestions.push(sourceSuggestions[index]);
  }

  return {
    mood: scene.mood,
    segments,
    suggestions,
    rawText: scene.rawText,
  };
}

function cloneTurn(turn: ChatTurn): ChatTurn {
  return {
    id: turn.id,
    role: turn.role,
    content: turn.content,
    createdAt: turn.createdAt,
    ...(turn.mood ? { mood: turn.mood } : {}),
  };
}

function cloneHistory(history: readonly ChatTurn[]): ChatTurn[] {
  if (!Array.isArray(history)) {
    throw new TypeError("存档内容不符合 V1 大小或结构限制");
  }
  const turnCount = history.length;
  if (!Number.isInteger(turnCount) || turnCount < 0 || turnCount > SAVE_LIMITS.historyTurns) {
    throw new TypeError("存档内容不符合 V1 大小或结构限制");
  }
  const result: ChatTurn[] = [];
  for (let index = 0; index < turnCount; index += 1) {
    result.push(cloneTurn(history[index]));
  }
  return result;
}

function previewText(input: SaveCaptureInput): string {
  const latestText = input.history.at(-1)?.content || input.scene.rawText;
  return truncateCodePoints(
    latestText.replace(/\s+/g, " ").trim(),
    SAVE_LIMITS.previewCodePoints,
  );
}

export function captureSaveSnapshot(input: SaveCaptureInput): SaveSnapshotV1 {
  if (!isSaveSlotId(input.slotId)) throw new TypeError("存档槽位 ID 格式无效");
  if (!Number.isInteger(input.pageIndex) || input.pageIndex < 0) {
    throw new TypeError("存档页码必须是非负整数");
  }
  if (!isFiniteTimestamp(input.capturedAt)) throw new TypeError("存档时间无效");
  const createdAt = input.createdAt ?? input.capturedAt;
  if (!isFiniteTimestamp(createdAt) || createdAt > input.capturedAt) {
    throw new TypeError("存档创建时间无效");
  }

  const snapshot: SaveSnapshotV1 = {
    schema: SAVE_SNAPSHOT_SCHEMA,
    version: CURRENT_SAVE_SNAPSHOT_VERSION,
    metadata: {
      metadataVersion: CURRENT_SAVE_METADATA_VERSION,
      snapshotVersion: CURRENT_SAVE_SNAPSHOT_VERSION,
      slotId: input.slotId,
      title: input.title?.trim() || "未命名存档",
      preview: previewText(input),
      createdAt,
      updatedAt: input.capturedAt,
      ...(input.revision !== undefined ? { revision: input.revision } : {}),
    },
    state: {
      scene: cloneScene(input.scene),
      pageIndex: input.pageIndex,
      history: cloneHistory(input.history),
      model: input.model,
    },
  };
  if (!isSaveSnapshotV1(snapshot)) throw new TypeError("存档内容不符合 V1 大小或结构限制");
  return snapshot;
}

function canonicalizeSaveSnapshot(snapshot: SaveSnapshotV1): SaveSnapshotV1 {
  const metadata = snapshot.metadata;
  const state = snapshot.state;
  return {
    schema: SAVE_SNAPSHOT_SCHEMA,
    version: CURRENT_SAVE_SNAPSHOT_VERSION,
    metadata: {
      metadataVersion: CURRENT_SAVE_METADATA_VERSION,
      snapshotVersion: CURRENT_SAVE_SNAPSHOT_VERSION,
      slotId: metadata.slotId,
      title: metadata.title,
      preview: metadata.preview,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      ...(metadata.revision ? { revision: metadata.revision } : {}),
    },
    state: {
      scene: cloneScene(state.scene),
      pageIndex: state.pageIndex,
      history: cloneHistory(state.history),
      model: state.model,
    },
  };
}

function snapshotVersion(value: unknown): number | undefined {
  try {
    if (!isRecord(value) || !Number.isInteger(value.version)) return undefined;
    return Number(value.version);
  } catch {
    return undefined;
  }
}

export function decodeSaveSnapshot(
  source: unknown,
  extensions: SaveSchemaExtensions = DEFAULT_SAVE_SCHEMA_EXTENSIONS,
): SaveDecodeResult {
  let candidate: unknown = source;
  if (typeof source === "string") {
    if (!isUtf8ByteLengthAtMost(source, SAVE_LIMITS.jsonBytes)) {
      return { ok: false, error: { code: "limit_exceeded", message: "存档文件超过大小限制" } };
    }
    try {
      candidate = JSON.parse(source);
    } catch {
      return { ok: false, error: { code: "invalid_json", message: "存档不是合法 JSON" } };
    }
  }

  let inspection = inspectUnknownStructure(candidate);
  if (inspection === "credential") {
    return { ok: false, error: { code: "invalid_snapshot", message: "存档包含不允许的凭据字段" } };
  }
  if (inspection === "limit") {
    return { ok: false, error: { code: "limit_exceeded", message: "存档结构超过安全限制" } };
  }
  if (inspection === "invalid") {
    return { ok: false, error: { code: "invalid_snapshot", message: "存档结构无法安全读取" } };
  }

  let version = snapshotVersion(candidate);
  if (version === undefined) {
    return { ok: false, error: { code: "invalid_snapshot", message: "存档缺少有效版本号" } };
  }

  const visited = new Set<number>();
  while (version !== CURRENT_SAVE_SNAPSHOT_VERSION) {
    if (visited.has(version)) {
      return { ok: false, error: { code: "migration_failed", message: "存档迁移出现循环" } };
    }
    visited.add(version);
    const migration = extensions.migrations.find((item) => item.fromVersion === version);
    if (!migration) {
      return { ok: false, error: { code: "unsupported_version", message: `不支持存档版本 ${version}` } };
    }
    try {
      candidate = migration.migrate(candidate);
    } catch {
      return { ok: false, error: { code: "migration_failed", message: "存档迁移失败" } };
    }
    inspection = inspectUnknownStructure(candidate);
    if (inspection === "credential") {
      return { ok: false, error: { code: "invalid_snapshot", message: "迁移后的存档包含不允许的凭据字段" } };
    }
    if (inspection === "limit") {
      return { ok: false, error: { code: "limit_exceeded", message: "迁移后的存档超过安全限制" } };
    }
    if (inspection !== "safe" || snapshotVersion(candidate) !== migration.toVersion) {
      return { ok: false, error: { code: "migration_failed", message: "存档迁移结果无效" } };
    }
    version = migration.toVersion;
  }

  const validator = extensions.validators.find((item) => item.version === version);
  let extensionValid: boolean;
  try {
    extensionValid = Boolean(validator?.validate(candidate));
  } catch {
    return { ok: false, error: { code: "invalid_snapshot", message: "存档结构无效" } };
  }
  if (!extensionValid) {
    return { ok: false, error: { code: "invalid_snapshot", message: "存档结构无效" } };
  }
  try {
    if (!isSaveSnapshotV1(candidate)) {
      return { ok: false, error: { code: "invalid_snapshot", message: "存档结构无效" } };
    }
    const snapshot = canonicalizeSaveSnapshot(candidate);
    if (!isSaveSnapshotV1(snapshot)) {
      return { ok: false, error: { code: "invalid_snapshot", message: "存档结构无效" } };
    }
    return { ok: true, snapshot };
  } catch {
    return { ok: false, error: { code: "invalid_snapshot", message: "存档结构无法安全复制" } };
  }
}

const FEATURE_UNAVAILABLE_ERROR: SaveRepositoryError = Object.freeze({
  code: "feature_unavailable",
  message: "存档功能尚未启用",
});

export function createDisabledSaveSlotRepository(): SaveSlotRepository {
  const unavailable = async <T>(): Promise<SaveRepositoryResult<T>> => ({
    ok: false,
    error: FEATURE_UNAVAILABLE_ERROR,
  });
  return {
    list: () => unavailable(),
    read: () => unavailable(),
    write: () => unavailable(),
    delete: () => unavailable(),
  };
}

export const disabledSaveSlotRepository = createDisabledSaveSlotRepository();

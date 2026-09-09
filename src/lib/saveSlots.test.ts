import { describe, expect, expectTypeOf, it } from "vitest";
import type { AssistantScene, ChatTurn } from "../types";
import {
  CURRENT_SAVE_METADATA_VERSION,
  CURRENT_SAVE_SNAPSHOT_VERSION,
  SAVE_LIMITS,
  SAVE_SNAPSHOT_SCHEMA,
  captureSaveSnapshot,
  createDisabledSaveSlotRepository,
  createSaveRevision,
  createSaveSlotId,
  decodeSaveSnapshot,
  isSaveSnapshotV1,
} from "./saveSlots";
import type { SaveCaptureInput, SaveRepositoryResult } from "./saveSlots";

const scene: AssistantScene = {
  mood: "happy",
  segments: [
    { kind: "narration", text: "信号灯亮了。", mood: "relieved" },
    { kind: "dialogue", text: "这一页以后可以被存下来。", mood: "proud" },
  ],
  suggestions: ["继续"],
  rawText: "信号灯亮了。\n这一页以后可以被存下来。",
};

const history: ChatTurn[] = [
  { id: "user-1", role: "user", content: "测试未来存档", createdAt: 100 },
  { id: "assistant-1", role: "assistant", content: "可以，但现在先不落盘。", mood: "proud", createdAt: 110 },
];

function captureInput(): SaveCaptureInput {
  return {
    slotId: createSaveSlotId("slot-01"),
    title: "第一章",
    capturedAt: 200,
    createdAt: 150,
    scene: {
      ...scene,
      segments: scene.segments.map((segment) => ({ ...segment })),
      suggestions: [...scene.suggestions],
    },
    pageIndex: 1,
    history: history.map((turn) => ({ ...turn })),
    model: "deepseek-v4-flash",
  };
}

describe("save snapshot schema", () => {
  it("captures a versioned, independently copied V1 snapshot", () => {
    const input = captureInput();
    const snapshot = captureSaveSnapshot(input);

    expect(snapshot).toMatchObject({
      schema: SAVE_SNAPSHOT_SCHEMA,
      version: CURRENT_SAVE_SNAPSHOT_VERSION,
      metadata: {
        metadataVersion: CURRENT_SAVE_METADATA_VERSION,
        snapshotVersion: CURRENT_SAVE_SNAPSHOT_VERSION,
        slotId: "slot-01",
        title: "第一章",
        createdAt: 150,
        updatedAt: 200,
      },
      state: {
        pageIndex: 1,
        model: "deepseek-v4-flash",
      },
    });
    expect(snapshot.metadata.preview).toBe("可以，但现在先不落盘。");
    expect(snapshot.state.scene).not.toBe(input.scene);
    expect(snapshot.state.history).not.toBe(input.history);
    expect(isSaveSnapshotV1(snapshot)).toBe(true);

    input.scene.segments[0].text = "外部修改";
    input.history[0].content = "外部修改";
    expect(snapshot.state.scene.segments[0].text).toBe("信号灯亮了。");
    expect(snapshot.state.history[0].content).toBe("测试未来存档");
  });

  it("preserves allowlisted actions while accepting legacy segments without them", () => {
    const withAction = captureInput();
    withAction.scene.segments[0].action = "point";
    const snapshot = captureSaveSnapshot(withAction);

    expect(snapshot.state.scene.segments[0].action).toBe("point");
    expect(decodeSaveSnapshot(JSON.stringify(snapshot))).toEqual({ ok: true, snapshot });

    const legacySnapshot = captureSaveSnapshot(captureInput());
    expect(legacySnapshot.state.scene.segments.every((segment) => segment.action === undefined)).toBe(true);
    expect(decodeSaveSnapshot(JSON.stringify(legacySnapshot))).toEqual({
      ok: true,
      snapshot: legacySnapshot,
    });

    const invalidAction = {
      ...snapshot,
      state: {
        ...snapshot.state,
        scene: {
          ...snapshot.state.scene,
          segments: [{ ...snapshot.state.scene.segments[0], action: "dance" }],
        },
      },
    };
    expect(decodeSaveSnapshot(invalidAction)).toMatchObject({
      ok: false,
      error: { code: "invalid_snapshot" },
    });
  });

  it("rejects malformed metadata, state, and unsupported versions", () => {
    const snapshot = captureSaveSnapshot(captureInput());

    expect(isSaveSnapshotV1({ ...snapshot, version: 2 })).toBe(false);
    expect(isSaveSnapshotV1({
      ...snapshot,
      metadata: { ...snapshot.metadata, updatedAt: 149 },
    })).toBe(false);
    expect(isSaveSnapshotV1({
      ...snapshot,
      state: { ...snapshot.state, pageIndex: -1 },
    })).toBe(false);

    expect(decodeSaveSnapshot(JSON.stringify(snapshot))).toEqual({ ok: true, snapshot });
    expect(decodeSaveSnapshot({ ...snapshot, version: 99 })).toMatchObject({
      ok: false,
      error: { code: "unsupported_version" },
    });
  });

  it("round-trips independent formula/code boards and explicit clearing without changing legacy V1", () => {
    const input = captureInput();
    input.scene.segments = [
      { kind: "dialogue", text: "先整理方程。", blackboard: { kind: "math", content: String.raw`x^2 - 5x + 6 = 0`, title: "原式" } },
      { kind: "dialogue", text: "继续看这块黑板。" },
      { kind: "dialogue", text: "再看看代码。", blackboard: { kind: "code", content: "const x = 2;", language: "ts" } },
      { kind: "dialogue", text: "讲解结束。", blackboard: null },
    ];
    const snapshot = captureSaveSnapshot(input);
    expect(decodeSaveSnapshot(JSON.stringify(snapshot))).toEqual({ ok: true, snapshot });
    expect(snapshot.version).toBe(1);
    expect(snapshot.state.scene.segments[0].blackboard).not.toBe(input.scene.segments[0].blackboard);
    input.scene.segments[0].blackboard!.content = "changed";
    expect(snapshot.state.scene.segments[0].blackboard?.content).toBe("x^2 - 5x + 6 = 0");
    expect(snapshot.state.scene.segments[1]).not.toHaveProperty("blackboard");
    expect(snapshot.state.scene.segments[3].blackboard).toBeNull();
    expect(decodeSaveSnapshot(captureSaveSnapshot(captureInput())).ok).toBe(true);
  });

  it("rejects invalid, credential-bearing and oversized persisted blackboard fields", () => {
    const snapshot = captureSaveSnapshot(captureInput());
    for (const blackboard of [
      { kind: "html", content: "<b>unsafe</b>" },
      { kind: "math", content: "" },
      { kind: "math", content: "x", apiKey: "fake-never-store" },
      { kind: "code", content: "x", debug: true },
      { kind: "code", content: "x", language: "javascript onclick" },
      { kind: "math", content: "x", title: "鲸".repeat(81) },
      { kind: "math", content: "x".repeat(SAVE_LIMITS.blackboardContentCodePoints + 1) },
    ]) {
      const candidate = {
        ...snapshot,
        state: { ...snapshot.state, scene: { ...snapshot.state.scene, segments: [
          { kind: "dialogue", text: "看看这里。", blackboard },
        ] } },
      };
      expect(decodeSaveSnapshot(candidate)).toMatchObject({ ok: false, error: { code: "invalid_snapshot" } });
    }
  });

  it("rejects unknown fields at every V1 layer and returns a canonical copy", () => {
    const snapshot = captureSaveSnapshot(captureInput());
    const source = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
    const decoded = decodeSaveSnapshot(source);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error("expected a valid snapshot");
    expect(decoded.snapshot).toEqual(snapshot);
    expect(decoded.snapshot).not.toBe(source);
    expect(decoded.snapshot.state).not.toBe(source.state);

    const state = snapshot.state;
    const sparseSegments = new Array(1);
    const historyWithExtraProperty = Object.assign([...state.history], { debug: true });
    const extraCases: unknown[] = [
      { ...snapshot, debug: true },
      { ...snapshot, metadata: { ...snapshot.metadata, storageHint: "local" } },
      { ...snapshot, state: { ...state, connectionMode: "byok" } },
      { ...snapshot, state: { ...state, scene: { ...state.scene, debug: true } } },
      {
        ...snapshot,
        state: {
          ...state,
          scene: {
            ...state.scene,
            segments: [{ ...state.scene.segments[0], debug: true }],
          },
        },
      },
      { ...snapshot, state: { ...state, history: [{ ...state.history[0], debug: true }] } },
      { ...snapshot, state: { ...state, scene: { ...state.scene, segments: sparseSegments } } },
      { ...snapshot, state: { ...state, history: historyWithExtraProperty } },
    ];
    for (const candidate of extraCases) {
      expect(decodeSaveSnapshot(candidate)).toMatchObject({
        ok: false,
        error: { code: "invalid_snapshot" },
      });
    }
  });

  it("enforces bounded JSON, collection, field, and structure limits", () => {
    expect(decodeSaveSnapshot(" ".repeat(SAVE_LIMITS.jsonBytes + 1))).toMatchObject({
      ok: false,
      error: { code: "limit_exceeded" },
    });

    const tooMuchHistory: SaveCaptureInput = {
      ...captureInput(),
      history: Array.from(
        { length: SAVE_LIMITS.historyTurns + 1 },
        (_, index): ChatTurn => ({ id: `turn-${index}`, role: "user", content: "测试", createdAt: index }),
      ),
    };
    expect(() => captureSaveSnapshot(tooMuchHistory)).toThrow("大小或结构限制");

    const oversizedContent = captureInput();
    oversizedContent.history[0].content = "鲸".repeat(SAVE_LIMITS.historyContentCodePoints + 1);
    expect(() => captureSaveSnapshot(oversizedContent)).toThrow("大小或结构限制");

    expect(() => captureSaveSnapshot({
      ...captureInput(),
      title: "章".repeat(SAVE_LIMITS.titleCodePoints + 1),
    })).toThrow("大小或结构限制");
    expect(() => captureSaveSnapshot({
      ...captureInput(),
      revision: "r".repeat(SAVE_LIMITS.revisionCodePoints + 1),
    } as unknown as SaveCaptureInput)).toThrow("大小或结构限制");

    let deeplyNested: unknown = "end";
    for (let depth = 0; depth <= SAVE_LIMITS.structureDepth + 1; depth += 1) {
      deeplyNested = { nested: deeplyNested };
    }
    const snapshot = captureSaveSnapshot(captureInput());
    expect(() => decodeSaveSnapshot({ ...snapshot, extension: deeplyNested })).not.toThrow();
    expect(decodeSaveSnapshot({ ...snapshot, extension: deeplyNested })).toMatchObject({
      ok: false,
      error: { code: "limit_exceeded" },
    });
  });

  it("never throws when a hostile Proxy changes after validation", () => {
    const snapshot = captureSaveSnapshot(captureInput());
    let armed = false;
    let metadataReads = 0;
    const changingSnapshot = new Proxy(snapshot, {
      get(target, property, receiver) {
        if (property === "metadata" && armed) {
          metadataReads += 1;
          if (metadataReads === 3) {
            return {
              ...target.metadata,
              title: "章".repeat(SAVE_LIMITS.titleCodePoints + 1),
            };
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const throwingSnapshot = new Proxy(snapshot, {
      ownKeys() {
        throw new Error("hostile ownKeys trap");
      },
    });
    const extensions = {
      migrations: [],
      validators: [{
        version: CURRENT_SAVE_SNAPSHOT_VERSION,
        validate: () => {
          armed = true;
          return true;
        },
      }],
    };

    let changingResult: ReturnType<typeof decodeSaveSnapshot> | undefined;
    expect(() => {
      changingResult = decodeSaveSnapshot(changingSnapshot, extensions);
    }).not.toThrow();
    expect(changingResult).toMatchObject({
      ok: false,
      error: { code: "invalid_snapshot" },
    });
    let throwingResult: ReturnType<typeof decodeSaveSnapshot> | undefined;
    expect(() => {
      throwingResult = decodeSaveSnapshot(throwingSnapshot);
    }).not.toThrow();
    expect(throwingResult).toMatchObject({
      ok: false,
      error: { code: "invalid_snapshot" },
    });
  });

  it("truncates metadata previews without splitting Unicode surrogate pairs", () => {
    const input = captureInput();
    input.history[input.history.length - 1].content = "🐳".repeat(SAVE_LIMITS.previewCodePoints + 3);
    const snapshot = captureSaveSnapshot(input);

    expect(snapshot.metadata.preview).toBe("🐳".repeat(SAVE_LIMITS.previewCodePoints));
    expect(Array.from(snapshot.metadata.preview)).toHaveLength(SAVE_LIMITS.previewCodePoints);
    expect(snapshot.metadata.preview).not.toContain("�");
  });

  it("exposes validator and migration extension points", () => {
    const snapshot = captureSaveSnapshot(captureInput());
    const legacy = { legacy: true, version: 0 };
    const decoded = decodeSaveSnapshot(legacy, {
      migrations: [{
        fromVersion: 0,
        toVersion: 1,
        migrate: () => snapshot,
      }],
      validators: [{
        version: 1,
        validate: isSaveSnapshotV1,
      }],
    });

    expect(decoded).toEqual({ ok: true, snapshot });
  });
});

describe("credential-free capture boundary", () => {
  it("makes credential fields impossible in the capture input type", () => {
    expectTypeOf<Exclude<SaveCaptureInput["apiKey"], undefined>>().toEqualTypeOf<never>();
    expectTypeOf<Exclude<SaveCaptureInput["authorization"], undefined>>().toEqualTypeOf<never>();
  });

  it("copies only allowlisted story fields even from a tainted runtime object", () => {
    const tainted = {
      ...captureInput(),
      apiKey: "sk-must-never-be-saved",
      authorization: "Bearer sk-must-never-be-saved",
      unrelatedRuntimeState: { token: "also-not-saved" },
    } as unknown as SaveCaptureInput;

    const serialized = JSON.stringify(captureSaveSnapshot(tainted));
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("sk-must-never-be-saved");
  });

  it("refuses imported snapshots carrying credential fields", () => {
    const snapshot = captureSaveSnapshot(captureInput());
    const decoded = decodeSaveSnapshot({
      ...snapshot,
      state: { ...snapshot.state, apiKey: "sk-should-not-load" },
    });

    expect(decoded).toMatchObject({
      ok: false,
      error: { code: "invalid_snapshot" },
    });
  });
});

describe("disabled save repository", () => {
  it("reports feature_unavailable for every operation and never claims success", async () => {
    const repository = createDisabledSaveSlotRepository();
    const revision = createSaveRevision("opaque-revision-1");
    const snapshot = captureSaveSnapshot({ ...captureInput(), revision });
    const controller = new AbortController();
    const results: SaveRepositoryResult<unknown>[] = await Promise.all([
      repository.list({ signal: controller.signal }),
      repository.read(snapshot.metadata.slotId, { signal: controller.signal }),
      repository.write(snapshot, { signal: controller.signal, expectedRevision: revision }),
      repository.delete(snapshot.metadata.slotId, { signal: controller.signal, expectedRevision: null }),
    ]);

    expect(snapshot.metadata.revision).toBe(revision);

    for (const result of results) {
      expect(result).toEqual({
        ok: false,
        error: { code: "feature_unavailable", message: "存档功能尚未启用" },
      });
    }
  });
});

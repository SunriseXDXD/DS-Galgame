import { describe, expect, it } from "vitest";
import {
  CHARACTER_POSE_SWITCH_MAX_MS,
  CHARACTER_POSE_SWITCH_MIN_MS,
  characterPoseSwitchDelay,
  resolveCharacterPerformance,
  shouldAutoSwitchCharacterPose,
} from "./characterPerformance";

describe("resolveCharacterPerformance", () => {
  it("gives an explicit model action priority over text, blackboard, and mood", () => {
    expect(resolveCharacterPerformance({
      mood: "excited",
      action: "bashful",
      text: "好耶，看这里，我来解释。",
      blackboard: { kind: "code", content: "const whale = true" },
    })).toMatchObject({
      initialPose: { kind: "action", action: "bashful" },
      actionSource: "explicit",
    });
  });

  it("uses conservative page-text actions before blackboard inference", () => {
    expect(resolveCharacterPerformance({
      mood: "neutral",
      text: "别着急，我们先一步一步理解原因。",
      blackboard: { kind: "code", content: "const answer = 42" },
    })).toMatchObject({
      initialPose: { kind: "action", action: "explain" },
      actionSource: "text",
    });
  });

  it("uses point for code and explain for patient markdown presentation", () => {
    expect(resolveCharacterPerformance({
      mood: "neutral",
      text: "代码放好了。",
      blackboard: { kind: "code", content: "return 42" },
    }).initialPose).toEqual({ kind: "action", action: "point" });
    expect(resolveCharacterPerformance({
      mood: "neutral",
      text: "整理成笔记了。",
      blackboard: { kind: "markdown", content: "- 第一步" },
    }).initialPose).toEqual({ kind: "action", action: "explain" });
  });

  it("pairs shy, excited, and thinking moods with related action art", () => {
    expect(resolveCharacterPerformance({ mood: "shy" })).toMatchObject({
      initialPose: { kind: "emotion", emotion: "shy" },
      alternatePose: { kind: "action", action: "bashful" },
    });
    expect(resolveCharacterPerformance({ mood: "excited" }).alternatePose)
      .toEqual({ kind: "action", action: "cheer" });
    expect(resolveCharacterPerformance({ mood: "thinking" }).alternatePose)
      .toEqual({ kind: "action", action: "explain" });
  });

  it("does not mistake pride alone for patient explanation or pointing", () => {
    expect(resolveCharacterPerformance({ mood: "proud", text: "本鲸鱼果然很厉害。" }))
      .toEqual({ initialPose: { kind: "emotion", emotion: "proud" }, actionSource: "none" });
  });

  it("does not promote routine success, meal, or apology wording into an action", () => {
    expect(resolveCharacterPerformance({
      mood: "hungry",
      text: "请求成功后我们先吃饭，刚才还未成功时也不用不好意思。",
    })).toEqual({ initialPose: { kind: "emotion", emotion: "hungry" }, actionSource: "none" });
  });
});

describe("automatic pose timing", () => {
  const ready = {
    hasAlternate: true,
    alreadySwitched: false,
    speaking: true,
    interactionEnabled: true,
    documentVisible: true,
    reducedMotion: false,
    busy: false,
  };

  it("switches only while an unobstructed visible page is speaking", () => {
    expect(shouldAutoSwitchCharacterPose(ready)).toBe(true);
    for (const blocked of [
      { alreadySwitched: true },
      { speaking: false },
      { interactionEnabled: false },
      { documentVisible: false },
      { reducedMotion: true },
      { busy: true },
      { hasAlternate: false },
    ]) {
      expect(shouldAutoSwitchCharacterPose({ ...ready, ...blocked })).toBe(false);
    }
  });

  it("keeps the one-time switch near the middle of a spoken line with safe bounds", () => {
    expect(characterPoseSwitchDelay("短句", 20)).toBe(CHARACTER_POSE_SWITCH_MIN_MS);
    expect(characterPoseSwitchDelay("鲸".repeat(80), 20)).toBe(832);
    expect(characterPoseSwitchDelay("鲸".repeat(500), 100)).toBe(CHARACTER_POSE_SWITCH_MAX_MS);
  });
});

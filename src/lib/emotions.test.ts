import { describe, expect, it } from "vitest";
import { EMOTIONS } from "../types";
import {
  assetUrl,
  EMOTION_ART,
  EMOTION_ASSETS,
  EMOTION_LABELS,
  FALLBACK_ART,
} from "./emotions";

const EXPECTED_EMOTIONS = [
  "neutral",
  "thinking",
  "happy",
  "shy",
  "angry",
  "hungry",
  "sleepy",
  "surprised",
  "sad",
  "proud",
  "confused",
  "worried",
  "relieved",
  "excited",
  "sulky",
  "determined",
] as const;

describe("static character art", () => {
  it("keeps the 16-mood contract in its stable order", () => {
    expect(EMOTIONS).toEqual(EXPECTED_EMOTIONS);
    expect(Object.keys(EMOTION_LABELS)).toEqual([...EMOTIONS]);
  });

  it("maps every emotion to one distinct bundled v2 WebP", () => {
    const sources = EMOTIONS.map((emotion) => assetUrl(emotion));

    expect(Object.keys(EMOTION_ART)).toEqual([...EMOTIONS]);
    expect(Object.keys(EMOTION_ASSETS)).toEqual([...EMOTIONS]);
    expect(new Set(sources).size).toBe(EMOTIONS.length);
    EMOTIONS.forEach((emotion) => {
      expect(EMOTION_ASSETS[emotion]).toBe(emotion);
      expect(assetUrl(emotion)).toMatch(new RegExp(`dafeiyu-v2-${emotion}\\.webp$`));
    });
  });

  it("uses the local neutral sprite as the final fallback", () => {
    expect(FALLBACK_ART).toBe(EMOTION_ART.neutral);
    expect(assetUrl("thinking")).toBe(EMOTION_ART.thinking);
  });
});

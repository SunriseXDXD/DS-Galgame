export const EMOTIONS = [
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

export const CHARACTER_ACTIONS = [
  "bashful",
  "cheer",
  "explain",
  "point",
] as const;

export type Emotion = (typeof EMOTIONS)[number];
export type CharacterAction = (typeof CHARACTER_ACTIONS)[number];
export type SegmentKind = "narration" | "dialogue" | "thought";
export type ModelId = "deepseek-v4-flash" | "deepseek-v4-pro";
export type ConnectionMode = "demo" | "byok" | "server";

export interface SceneSegment {
  kind: SegmentKind;
  text: string;
  mood?: Emotion;
  action?: CharacterAction;
}

export interface AssistantScene {
  mood: Emotion;
  segments: SceneSegment[];
  suggestions: string[];
  rawText: string;
}

export interface BlackboardContent {
  kind: "code" | "markdown";
  content: string;
  language?: string;
  title?: string;
}

export interface DialoguePage extends SceneSegment {
  id: string;
  blackboard?: BlackboardContent;
}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  mood?: Emotion;
  createdAt: number;
}

export interface PublicServerConfig {
  byokAllowed: boolean;
  serverKeyConfigured: boolean;
  models: ModelId[];
}

import type {
  BlackboardContent,
  CharacterAction,
  Emotion,
} from "../types";

export type CharacterPose =
  | { kind: "emotion"; emotion: Emotion }
  | { kind: "action"; action: CharacterAction };

export type CharacterActionSource = "explicit" | "text" | "blackboard" | "mood" | "none";

export interface CharacterPerformance {
  initialPose: CharacterPose;
  alternatePose?: CharacterPose;
  actionSource: CharacterActionSource;
}

interface CharacterPerformanceInput {
  mood: Emotion;
  action?: CharacterAction;
  text?: string;
  blackboard?: BlackboardContent;
}

interface AutoSwitchState {
  hasAlternate: boolean;
  alreadySwitched: boolean;
  speaking: boolean;
  interactionEnabled: boolean;
  documentVisible: boolean;
  reducedMotion: boolean;
  busy: boolean;
}

const BASHFUL_CUES = /害羞|脸红|红着脸|别这样夸|扭过脸|被你夸|喜欢本鲸鱼/;
const CHEER_CUES = /好耶|太棒(?:了)?|万岁|庆祝|欢呼|击掌|成功了|做到了|耶[！!]/;
const POINT_CUES = /看这里|注意(?:看)?|这一(?:行|段|点)|这个位置|重点是|如图|如下|黑板|箭头|指(?:给你|着|向)/;
const EXPLAIN_CUES = /我来解释|解释一下|简单来说|换句话说|一步一步|慢慢(?:说|讲|看)|先理解|可以理解为|原理是|原因是|别着急|别急/;

const ACTION_FROM_MOOD: Partial<Record<Emotion, CharacterAction>> = {
  shy: "bashful",
  excited: "cheer",
  thinking: "explain",
};

export const CHARACTER_POSE_SWITCH_MIN_MS = 700;
export const CHARACTER_POSE_SWITCH_MAX_MS = 1_400;

function emotionPose(emotion: Emotion): CharacterPose {
  return { kind: "emotion", emotion };
}

function actionPose(action: CharacterAction): CharacterPose {
  return { kind: "action", action };
}

function inferTextAction(text: string): CharacterAction | undefined {
  if (BASHFUL_CUES.test(text)) return "bashful";
  if (CHEER_CUES.test(text)) return "cheer";
  if (POINT_CUES.test(text)) return "point";
  if (EXPLAIN_CUES.test(text)) return "explain";
  return undefined;
}

function inferBlackboardAction(blackboard?: BlackboardContent): CharacterAction | undefined {
  if (!blackboard) return undefined;
  return blackboard.kind === "code" ? "point" : "explain";
}

function relatedAlternatePose(
  action: CharacterAction,
  mood: Emotion,
  text: string,
  blackboard?: BlackboardContent,
): CharacterPose {
  if (action === "point" && EXPLAIN_CUES.test(text)) return actionPose("explain");
  if (action === "explain" && blackboard?.kind === "code" && POINT_CUES.test(text)) {
    return actionPose("point");
  }
  return emotionPose(mood);
}

/** Chooses a deterministic, semantically related static-pose sequence for one page. */
export function resolveCharacterPerformance({
  mood,
  action,
  text = "",
  blackboard,
}: CharacterPerformanceInput): CharacterPerformance {
  if (action) {
    return {
      initialPose: actionPose(action),
      alternatePose: relatedAlternatePose(action, mood, text, blackboard),
      actionSource: "explicit",
    };
  }

  const textAction = inferTextAction(text);
  if (textAction) {
    return {
      initialPose: actionPose(textAction),
      alternatePose: relatedAlternatePose(textAction, mood, text, blackboard),
      actionSource: "text",
    };
  }

  const blackboardAction = inferBlackboardAction(blackboard);
  if (blackboardAction) {
    return {
      initialPose: actionPose(blackboardAction),
      alternatePose: relatedAlternatePose(blackboardAction, mood, text, blackboard),
      actionSource: "blackboard",
    };
  }

  const moodAction = ACTION_FROM_MOOD[mood];
  if (moodAction) {
    return {
      initialPose: emotionPose(mood),
      alternatePose: actionPose(moodAction),
      actionSource: "mood",
    };
  }

  return { initialPose: emotionPose(mood), actionSource: "none" };
}

/** Keeps automatic posing to one deliberate switch while the current line is being spoken. */
export function shouldAutoSwitchCharacterPose({
  hasAlternate,
  alreadySwitched,
  speaking,
  interactionEnabled,
  documentVisible,
  reducedMotion,
  busy,
}: AutoSwitchState): boolean {
  return hasAlternate
    && !alreadySwitched
    && speaking
    && interactionEnabled
    && documentVisible
    && !reducedMotion
    && !busy;
}

export function characterPoseSwitchDelay(text: string, typeSpeed: number): number {
  const characters = Array.from(text).length;
  const safeSpeed = Number.isFinite(typeSpeed) ? Math.max(0, typeSpeed) : 0;
  const midpoint = Math.round(characters * safeSpeed * 0.52);
  return Math.min(
    CHARACTER_POSE_SWITCH_MAX_MS,
    Math.max(CHARACTER_POSE_SWITCH_MIN_MS, midpoint),
  );
}

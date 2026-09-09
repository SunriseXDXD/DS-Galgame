import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import type { BlackboardContent, CharacterAction, DialoguePage, Emotion } from "../types";
import {
  assetUrl,
  EMOTION_ART,
  EMOTION_ASSETS,
  EMOTION_LABELS,
  FALLBACK_ART,
} from "../lib/emotions";
import {
  characterPoseSwitchDelay,
  resolveCharacterPerformance,
  shouldAutoSwitchCharacterPose,
} from "../lib/characterPerformance";
import type { CharacterPose } from "../lib/characterPerformance";

interface CharacterStageProps {
  mood: Emotion;
  busy: boolean;
  page?: DialoguePage;
  speaking: boolean;
  interactionEnabled: boolean;
  typeSpeed: number;
  blackboard?: BlackboardContent;
}

const ACTION_FALLBACK_EMOTION: Record<CharacterAction, Emotion> = {
  bashful: "shy",
  cheer: "excited",
  explain: "thinking",
  point: "determined",
};

const ACTION_ART: Record<CharacterAction, string> = {
  bashful: assetUrl(ACTION_FALLBACK_EMOTION.bashful),
  cheer: assetUrl(ACTION_FALLBACK_EMOTION.cheer),
  explain: assetUrl(ACTION_FALLBACK_EMOTION.explain),
  point: assetUrl(ACTION_FALLBACK_EMOTION.point),
};

const decodedSources = new Set<string>();
const pendingSources = new Map<string, Promise<void>>();

function preloadImage(source: string): Promise<void> {
  if (decodedSources.has(source)) return Promise.resolve();

  const pending = pendingSources.get(source);
  if (pending) return pending;

  const request = new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      image.onload = null;
      image.onerror = null;
      const decoding = typeof image.decode === "function"
        ? image.decode().catch(() => undefined)
        : Promise.resolve();

      void decoding.then(() => {
        decodedSources.add(source);
        resolve();
      });
    };
    image.onerror = () => {
      image.onload = null;
      image.onerror = null;
      reject(new Error(`Unable to load character art: ${source}`));
    };
    image.src = source;
  }).finally(() => {
    pendingSources.delete(source);
  });

  pendingSources.set(source, request);
  return request;
}

function sourceForPose(pose: CharacterPose): string {
  return pose.kind === "action" ? ACTION_ART[pose.action] : assetUrl(pose.emotion);
}

function labelForPose(pose: CharacterPose): string {
  return pose.kind === "action" ? `ACT_${pose.action}` : EMOTION_ASSETS[pose.emotion];
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function CharacterStage({
  mood,
  busy,
  page,
  speaking,
  interactionEnabled,
  typeSpeed,
  blackboard,
}: CharacterStageProps) {
  const performance = useMemo(() => resolveCharacterPerformance({
    mood,
    action: page?.action,
    text: page?.text,
    blackboard,
  }), [blackboard, mood, page]);
  const performanceCue = useMemo(() => ({ page, mood, blackboard }), [blackboard, mood, page]);
  const [switchedPerformanceCue, setSwitchedPerformanceCue] = useState<typeof performanceCue | null>(null);
  const alreadySwitched = switchedPerformanceCue === performanceCue;
  const documentVisible = useDocumentVisible();
  const reducedMotion = useReducedMotion();
  const activePose = busy
    ? ({ kind: "emotion", emotion: "thinking" } satisfies CharacterPose)
    : alreadySwitched && performance.alternatePose
      ? performance.alternatePose
      : performance.initialPose;
  const requestedSource = sourceForPose(activePose);
  const moodFallbackSource = assetUrl(busy ? "thinking" : mood);
  const [displayedSource, setDisplayedSource] = useState<string | null>(() => requestedSource);
  const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(() => new Set());
  const [firstImageReady, setFirstImageReady] = useState(false);
  const switchStateRef = useRef({
    alreadySwitched,
    speaking,
    interactionEnabled,
    documentVisible,
    reducedMotion,
    busy,
  });
  const performanceCueRef = useRef(performanceCue);
  switchStateRef.current = {
    alreadySwitched,
    speaking,
    interactionEnabled,
    documentVisible,
    reducedMotion,
    busy,
  };
  performanceCueRef.current = performanceCue;

  useEffect(() => {
    const alternatePose = performance.alternatePose;
    if (!alternatePose) return;
    const alternateSource = sourceForPose(alternatePose);
    const canSwitch = shouldAutoSwitchCharacterPose({
      hasAlternate: Boolean(performance.alternatePose),
      alreadySwitched,
      speaking,
      interactionEnabled,
      documentVisible,
      reducedMotion,
      busy,
    });
    if (!canSwitch || alternateSource === requestedSource || failedSources.has(alternateSource)) return;

    let current = true;
    let delayElapsed = false;
    let imageReady = false;
    const commitIfCurrent = () => {
      if (!current || !delayElapsed || !imageReady) return;
      const latest = switchStateRef.current;
      const visibleNow = typeof document === "undefined" || !document.hidden;
      const reducedNow = typeof window !== "undefined"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (
        performanceCueRef.current === performanceCue
        && shouldAutoSwitchCharacterPose({
          hasAlternate: true,
          alreadySwitched: latest.alreadySwitched,
          speaking: latest.speaking,
          interactionEnabled: latest.interactionEnabled,
          documentVisible: latest.documentVisible && visibleNow,
          reducedMotion: latest.reducedMotion || reducedNow,
          busy: latest.busy,
        })
      ) {
        setSwitchedPerformanceCue(performanceCue);
      }
    };
    const timer = window.setTimeout(() => {
      delayElapsed = true;
      commitIfCurrent();
    }, characterPoseSwitchDelay(page?.text ?? "", typeSpeed));
    void preloadImage(alternateSource).then(
      () => {
        imageReady = true;
        commitIfCurrent();
      },
      () => {
        if (!current) return;
        setFailedSources((failed) => {
          if (failed.has(alternateSource)) return failed;
          const next = new Set(failed);
          next.add(alternateSource);
          return next;
        });
      },
    );
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [
    alreadySwitched,
    busy,
    documentVisible,
    failedSources,
    interactionEnabled,
    page,
    page?.text,
    performance.alternatePose,
    performanceCue,
    reducedMotion,
    requestedSource,
    speaking,
    typeSpeed,
  ]);

  useEffect(() => {
    const candidate = [requestedSource, moodFallbackSource, FALLBACK_ART]
      .find((source, index, sources) => sources.indexOf(source) === index && !failedSources.has(source)) ?? null;

    if (candidate === displayedSource) return;
    if (candidate === null) {
      setDisplayedSource(null);
      return;
    }

    let current = true;
    void preloadImage(candidate).then(
      () => {
        if (current) setDisplayedSource(candidate);
      },
      () => {
        if (!current) return;
        setFailedSources((failed) => {
          if (failed.has(candidate)) return failed;
          const next = new Set(failed);
          next.add(candidate);
          return next;
        });
      },
    );

    return () => {
      current = false;
    };
  }, [displayedSource, failedSources, moodFallbackSource, requestedSource]);

  useEffect(() => {
    if (!firstImageReady) return;

    const warmRemainingImages = () => {
      const sources = new Set([...Object.values(EMOTION_ART), ...Object.values(ACTION_ART)]);
      if (displayedSource) sources.delete(displayedSource);
      for (const source of sources) {
        if (!failedSources.has(source)) void preloadImage(source).catch(() => undefined);
      }
    };

    if (typeof window.requestIdleCallback === "function") {
      const request = window.requestIdleCallback(warmRemainingImages, { timeout: 2_000 });
      return () => window.cancelIdleCallback(request);
    }

    const timeout = window.setTimeout(warmRemainingImages, 500);
    return () => window.clearTimeout(timeout);
  }, [firstImageReady]);

  const markSourceFailed = (source: string) => {
    setFailedSources((failed) => {
      if (failed.has(source)) return failed;
      const next = new Set(failed);
      next.add(source);
      return next;
    });
  };

  return (
    <section
      className={`character-stage${busy ? " character-stage--busy" : ""}`}
      data-pose={activePose.kind === "action" ? activePose.action : activePose.emotion}
      aria-label="大肥鱼角色立绘"
    >
      <div className="character-stage__halo" aria-hidden="true" />
      <div className="character-stage__rings" aria-hidden="true" />
      <div className="character-stage__figure">
        {displayedSource ? (
          <img
            className="character-art"
            src={displayedSource}
            alt=""
            aria-hidden="true"
            decoding="async"
            draggable="false"
            loading="eager"
            onLoad={() => {
              decodedSources.add(displayedSource);
              setFirstImageReady(true);
            }}
            onError={() => markSourceFailed(displayedSource)}
          />
        ) : (
          <div className="character-placeholder" role="img" aria-label="大肥鱼立绘暂时无法显示">
            <span aria-hidden="true">🐳</span>
            <strong>立绘暂时无法显示</strong>
          </div>
        )}
      </div>
      <div className="character-stage__shadow" aria-hidden="true" />
      <div className="mood-chip" role="status" aria-live="polite" aria-atomic="true">
        <Sparkles size={13} strokeWidth={1.8} aria-hidden="true" />
        <span aria-hidden="true">MOOD</span>
        <strong>{busy ? "组织语言" : EMOTION_LABELS[mood]}</strong>
      </div>
      <span className="asset-id" aria-hidden="true">SPR / {labelForPose(activePose)}</span>
    </section>
  );
}

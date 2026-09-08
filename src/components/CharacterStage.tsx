import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { Emotion } from "../types";
import {
  assetUrl,
  EMOTION_ART,
  EMOTION_ASSETS,
  EMOTION_LABELS,
  FALLBACK_ART,
} from "../lib/emotions";

interface CharacterStageProps {
  mood: Emotion;
  busy: boolean;
}

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

export function CharacterStage({ mood, busy }: CharacterStageProps) {
  const requestedSource = assetUrl(busy ? "thinking" : mood);
  const [displayedSource, setDisplayedSource] = useState<string | null>(() => requestedSource);
  const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(() => new Set());
  const [firstImageReady, setFirstImageReady] = useState(false);

  useEffect(() => {
    const candidate = failedSources.has(requestedSource)
      ? failedSources.has(FALLBACK_ART) ? null : FALLBACK_ART
      : requestedSource;

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
  }, [displayedSource, failedSources, requestedSource]);

  useEffect(() => {
    if (!firstImageReady) return;

    const warmRemainingImages = () => {
      const sources = new Set(Object.values(EMOTION_ART));
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
    <section className={`character-stage${busy ? " character-stage--busy" : ""}`} aria-label="大肥鱼角色立绘">
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
      <span className="asset-id" aria-hidden="true">SPR / {busy ? "thinking" : EMOTION_ASSETS[mood]}</span>
    </section>
  );
}

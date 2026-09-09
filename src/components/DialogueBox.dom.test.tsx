// @vitest-environment jsdom

import { act, StrictMode, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DialoguePage } from "../types";
import { parseScenePayload, sceneToPages, splitGraphemes } from "../lib/dialogue";
import { DialogueBox } from "./DialogueBox";

type Props = ComponentProps<typeof DialogueBox>;
const makePage = (text: string, id = "page-0"): DialoguePage => ({ id, text, kind: "dialogue" });

let host: HTMLDivElement;
let root: Root;
let props: Props;
let reducedMotion: boolean;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reducedMotion = false;
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: reducedMotion,
    media: query,
    onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => true,
  })));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  props = {
    page: makePage("先把这一句话讲完。"), pageIndex: 0, pageTotal: 1,
    suggestions: ["继续讨论"], waiting: false, streamLength: 0, typeSpeed: 20,
    autoPlay: false, interactionEnabled: true,
    onSpeakingChange: vi.fn(), onAutoPlayChange: vi.fn(), onAdvance: vi.fn(),
    onSubmit: vi.fn(), onChoice: vi.fn(), onStop: vi.fn(), onSound: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(patch: Partial<Props> = {}) {
  props = { ...props, ...patch };
  await act(async () => { root.render(<StrictMode><DialogueBox {...props} /></StrictMode>); });
}

async function elapse(milliseconds: number) {
  await act(async () => { vi.advanceTimersByTime(milliseconds); });
}

async function typeGlyphs(count: number, speed = 20) {
  // Flush each React update before advancing to the timer scheduled by its effect.
  for (let index = 0; index < count; index += 1) await elapse(speed);
}

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => { (element as HTMLElement).click(); });
}

const visibleText = () => host.querySelector(".dialogue-content > p")?.textContent;
const choices = () => [...host.querySelectorAll<HTMLButtonElement>(".choice-list button")];
const composer = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="输入消息"]');

describe("mounted dialogue typing and reply controls", () => {
  it("reveals fallback choices only after an empty-suggestions final page completes, and submits once", async () => {
    const last = makePage("请先听完🐳。");
    await render({ page: last, suggestions: [] });
    await typeGlyphs(splitGraphemes(last.text).length - 1);
    expect(choices()).toHaveLength(0);
    expect(composer()).toBeNull();
    await elapse(20);
    expect(visibleText()).toBe(last.text);
    expect(composer()).not.toBeNull();
    expect(choices()).toHaveLength(2);
    expect(choices().map((button) => button.textContent)).toEqual(["01举个例子", "02换个话题"]);
    await click(choices()[0]);
    expect(props.onChoice).toHaveBeenCalledExactlyOnceWith("举个例子");
    expect(props.onAdvance).not.toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("runs StrictMode effects and waits for the last grapheme before showing the model's choices", async () => {
    const last = makePage("读完最后一个字👩‍💻。");
    await render({ page: last, suggestions: ["你讲得很清楚", "再讲一步"] });
    const glyphs = splitGraphemes(last.text);
    await typeGlyphs(glyphs.length - 1);
    expect(visibleText()).toBe(glyphs.slice(0, -1).join(""));
    expect(host.querySelector(".type-caret")).not.toBeNull();
    expect(choices()).toHaveLength(0);
    expect(composer()).toBeNull();
    await elapse(20);
    expect(visibleText()).toBe(last.text);
    expect(host.querySelector(".type-caret")).toBeNull();
    expect(choices().map((button) => button.textContent)).toEqual(["01你讲得很清楚", "02再讲一步"]);
    expect(props.onSpeakingChange).toHaveBeenLastCalledWith(false);
    await click(choices()[1]);
    expect(props.onChoice).toHaveBeenCalledExactlyOnceWith("再讲一步");
  });

  it("does not reuse a completed long page's progress on the short final page", async () => {
    await render({ page: makePage("这是上一页比较长的说明。".repeat(8)), pageTotal: 2 });
    await click(host.querySelector(".dialogue-box"));
    expect(host.querySelector(".continue-hint")).not.toBeNull();
    expect(choices()).toHaveLength(0);
    await click(host.querySelector(".continue-hint"));
    expect(props.onAdvance).toHaveBeenCalledTimes(1);
    const last = makePage("短句。", "page-1");
    await render({ page: last, pageIndex: 1 });
    expect(visibleText()).toBe("");
    expect(choices()).toHaveLength(0);
    await typeGlyphs(splitGraphemes(last.text).length - 1);
    expect(composer()).toBeNull();
    await elapse(20);
    expect(choices()).toHaveLength(1);
  });

  it("resumes typing when a generated new scene leaves waiting, including a second identical reply", async () => {
    await render({ typeSpeed: 0 });
    expect(choices()).toHaveLength(1);
    for (let round = 0; round < 2; round += 1) {
      await render({ waiting: true, typeSpeed: 20 });
      expect(composer()).toBeNull();
      const reply = makePage("同样的回答也应重新打字。");
      await render({ page: reply });
      await elapse(1_000);
      expect(choices()).toHaveLength(0);
      expect(host.querySelector(".thinking-line")).not.toBeNull();
      await render({ waiting: false });
      expect(visibleText()).toBe("");
      await typeGlyphs(splitGraphemes(reply.text).length);
      expect(visibleText()).toBe(reply.text);
      expect(choices()).toHaveLength(1);
    }
  });

  it("restarts consecutive pages with identical text and reused page IDs", async () => {
    const text = "相同的一句话。";
    await render({ page: makePage(text), pageTotal: 2 });
    await typeGlyphs(splitGraphemes(text).length);
    await render({ page: makePage(text), pageIndex: 1 });
    expect(visibleText()).toBe("");
    expect(composer()).toBeNull();
    await typeGlyphs(splitGraphemes(text).length);
    expect(visibleText()).toBe(text);
    expect(composer()).not.toBeNull();
  });

  it.each(["zero speed", "reduced motion"])("completes a new final page in %s mode", async (mode) => {
    reducedMotion = mode === "reduced motion";
    await render({ typeSpeed: mode === "zero speed" ? 0 : 20, pageTotal: 2 });
    expect(visibleText()).toBe(props.page?.text);
    expect(choices()).toHaveLength(0);
    const last = makePage("最后一句。", "page-1");
    await render({ page: last, pageIndex: 1 });
    expect(visibleText()).toBe(last.text);
    expect(choices()).toHaveLength(1);
    expect(composer()).not.toBeNull();
  });

  it("pauses for an overlay then resumes the same page from its preserved progress", async () => {
    const last = makePage("先读两字，然后继续。");
    await render({ page: last });
    await typeGlyphs(2);
    const prefix = visibleText();
    await render({ interactionEnabled: false });
    await elapse(4_000);
    expect(visibleText()).toBe(prefix);
    expect(choices()).toHaveLength(0);
    await render({ interactionEnabled: true });
    await typeGlyphs(splitGraphemes(last.text).length - 2);
    expect(visibleText()).toBe(last.text);
    expect(choices()).toHaveLength(1);
  });

  it("does not activate a completed page's choices behind an overlay", async () => {
    await render({ typeSpeed: 0, suggestions: [] });
    await render({ interactionEnabled: false });
    await click(choices()[0]);
    expect(props.onChoice).not.toHaveBeenCalled();
    await render({ interactionEnabled: true });
    await click(choices()[0]);
    expect(props.onChoice).toHaveBeenCalledExactlyOnceWith("举个例子");
  });
});

describe("parsed model responses reaching mounted choice controls", () => {
  const segments = [{ kind: "dialogue", text: "这次回答已经讲完。" }];

  it.each([
    ["explicit empty suggestions", JSON.stringify({ segments, suggestions: [] })],
    ["missing suggestions", JSON.stringify({ segments })],
    ["all invalid suggestions", JSON.stringify({ segments, suggestions: [null, 12, {}, "", "  ", '{"text":"raw"}'] })],
    ["plain text", "普通文本回答也已经讲完。"],
  ])("offers local fallback choices after the last character for %s", async (_label, source) => {
    const scene = parseScenePayload(source);
    expect(scene.suggestions).toEqual([]);
    const pages = sceneToPages(scene);
    const last = pages[pages.length - 1];
    await render({ page: last, pageIndex: pages.length - 1, pageTotal: pages.length, suggestions: scene.suggestions });
    await typeGlyphs(splitGraphemes(last.text).length - 1);
    expect(choices()).toHaveLength(0);
    await elapse(20);
    expect(visibleText()).toBe(last.text);
    expect(choices().map((button) => button.textContent)).toEqual(["01举个例子", "02换个话题"]);
    expect(composer()).not.toBeNull();
  });

  it("preserves valid parsed model options without mixing in local defaults", async () => {
    const scene = parseScenePayload(JSON.stringify({ segments, suggestions: ["  再说具体一点  ", "让我想想", "谢谢大肥鱼"] }));
    const pages = sceneToPages(scene);
    await render({ page: pages[0], pageTotal: pages.length, suggestions: scene.suggestions, typeSpeed: 0 });
    expect(choices().map((button) => button.textContent)).toEqual(["01再说具体一点", "02让我想想", "03谢谢大肥鱼"]);
    await click(choices()[2]);
    expect(props.onChoice).toHaveBeenCalledExactlyOnceWith("谢谢大肥鱼");
  });
});

describe("mounted AUTO progression", () => {
  async function renderAutoScene(typeSpeed = 0) {
    const pages = [makePage("一。"), makePage("二。", "page-1"), makePage("三。", "page-2")];
    const onAdvance = vi.fn();
    function AutoScene() {
      const [index, setIndex] = useState(0);
      const [speaking, setSpeaking] = useState(false);
      return <div data-speaking={speaking}><DialogueBox {...props}
        page={pages[index]} pageIndex={index} pageTotal={pages.length} autoPlay typeSpeed={typeSpeed}
        onSpeakingChange={setSpeaking} onAdvance={() => {
          onAdvance();
          setIndex((current) => Math.min(current + 1, pages.length - 1));
        }}
      /></div>;
    }
    await act(async () => { root.render(<StrictMode><AutoScene /></StrictMode>); });
    return onAdvance;
  }

  it("plays three short instant-text pages, then stops with visible reply controls", async () => {
    const onAdvance = await renderAutoScene();
    expect(visibleText()).toBe("一。");
    await elapse(1_649);
    expect(onAdvance).not.toHaveBeenCalled();
    await elapse(1);
    expect(visibleText()).toBe("二。");
    expect(choices()).toHaveLength(0);
    await elapse(1_650);
    expect(visibleText()).toBe("三。");
    expect(choices()).toHaveLength(1);
    await elapse(5_000);
    expect(onAdvance).toHaveBeenCalledTimes(2);
    expect(props.onChoice).not.toHaveBeenCalled();
  });

  it("waits for each page's typing to finish before starting its AUTO delay", async () => {
    const onAdvance = await renderAutoScene(20);
    for (let index = 0; index < 3; index += 1) {
      expect(composer()).toBeNull();
      await typeGlyphs(2);
      if (index < 2) {
        await elapse(1_649);
        expect(onAdvance).toHaveBeenCalledTimes(index);
        await elapse(1);
        expect(onAdvance).toHaveBeenCalledTimes(index + 1);
        expect(visibleText()).toBe("");
      }
    }
    expect(visibleText()).toBe("三。");
    expect(choices()).toHaveLength(1);
  });

  it("does not skip a page when an AUTO timer and manual click fire in the same React batch", async () => {
    const onAdvance = await renderAutoScene();
    const next = host.querySelector<HTMLButtonElement>(".continue-hint");
    expect(next).not.toBeNull();
    await act(async () => {
      next!.click();
      vi.advanceTimersByTime(1_650);
    });
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(visibleText()).toBe("二。");
    expect(choices()).toHaveLength(0);
    await elapse(1_650);
    expect(onAdvance).toHaveBeenCalledTimes(2);
    expect(choices()).toHaveLength(1);
  });
});

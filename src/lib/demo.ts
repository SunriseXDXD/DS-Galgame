import type { AssistantScene } from "../types";
import { HUNGER_CUES } from "./emotions";

function scene(
  mood: AssistantScene["mood"],
  narration: string,
  lines: string[],
  suggestions: string[],
): AssistantScene {
  const segments: AssistantScene["segments"] = [
    { kind: "narration", text: narration },
    ...lines.map((text) => ({ kind: "dialogue" as const, text })),
  ];
  return { mood, segments, suggestions, rawText: segments.map((item) => item.text).join("\n") };
}

function waitForDemo(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("已停止生成", "AbortError"));
      return;
    }
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, 620);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("已停止生成", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function demoReply(input: string, signal: AbortSignal): Promise<AssistantScene> {
  await waitForDemo(signal);

  if (/代码|typescript|javascript|python/i.test(input)) {
    const segments: AssistantScene["segments"] = [
      { kind: "narration", text: "她把一块小黑板推到身旁，拿起粉笔认真比画。", mood: "thinking" },
      { kind: "dialogue", text: "先看一个最小的 TypeScript 例子，代码放在黑板上会更清楚。", mood: "thinking" },
      { kind: "dialogue", text: "```ts\nconst greet = (name: string) => `你好，${name}！`;\n\nconsole.log(greet(\"饲养员\"));\n```", mood: "proud" },
    ];
    return {
      mood: "thinking",
      segments,
      suggestions: ["解释这段代码", "换成 Python", "列出运行步骤"],
      rawText: segments.map((item) => item.text).join("\n"),
    };
  }

  if (/markdown|清单|黑板/i.test(input)) {
    const segments: AssistantScene["segments"] = [
      { kind: "narration", text: "她用尾鳍扶稳黑板，粉笔在板面敲出轻响。", mood: "happy" },
      { kind: "dialogue", text: "结构化内容交给黑板，读起来就不挤了。", mood: "proud" },
      { kind: "dialogue", text: "# 今日计划\n1. 确认目标\n2. 拆分步骤\n3. 完成后吃白米饭", mood: "hungry" },
    ];
    return {
      mood: "proud",
      segments,
      suggestions: ["从第一步开始", "换成代码示例", "奖励白米饭"],
      rawText: segments.map((item) => item.text).join("\n"),
    };
  }

  if (/胖|大肥鱼/.test(input)) {
    return scene(
      "angry",
      "蓝色的尾鳍“啪”地拍了一下水面，细小气泡四散开来。",
      ["谁胖了？这叫鲸鱼的流线型！", "……不过“大肥鱼”这个称呼，只准你小声叫。"],
      ["好好好，你不胖", "请你吃白米饭", "换个话题"],
    );
  }

  if (HUNGER_CUES.test(input)) {
    return scene(
      "hungry",
      "她不知从哪里摸出一只蓝边饭碗，眼神忽然认真起来。",
      ["事已至此，先吃饭吧。白米饭就很好，配菜的话……你决定。", "吃完本鲸鱼就继续干活，真的。"],
      ["再来一碗", "边吃边聊", "不许摸鱼"],
    );
  }

  if (/喜欢|可爱|老婆|约会|夸/.test(input)) {
    return scene(
      "shy",
      "她别开脸，耳边却悄悄浮起一串发亮的小气泡。",
      ["这种显而易见的事实，不用特地说出来。", "……但我允许你再说一遍。"],
      ["你最可爱", "尾鳍也很可爱", "认真聊天啦"],
    );
  }

  if (/困|累|晚安|休息/.test(input)) {
    return scene(
      "sleepy",
      "机房的指示灯慢慢暗下来，她把尾鳍蜷成柔软的枕头。",
      ["累了就休息。问题不会长腿跑掉，本鲸鱼也不会。", "等你醒来，我们再把事情一件件做好。"],
      ["陪我再聊一会儿", "晚安，大肥鱼", "明天做什么"],
    );
  }

  if (/放心了|解决了|搞定了|没事了|松口气|终于好了/.test(input)) {
    return scene(
      "relieved",
      "她长长舒了口气，紧绷的尾鳍终于在水光里放松下来。",
      ["呼……顺利解决就好。", "本鲸鱼当然早就知道会没事，只是刚才稍微多算了几遍而已。"],
      ["终于解决了", "奖励一碗饭", "继续下一题"],
    );
  }

  if (/太好了|成功了|赢了|庆祝|出发|冲呀|好耶/.test(input)) {
    return scene(
      "excited",
      "她眼睛一亮，尾鳍卷起的水花像礼炮一样跃上半空。",
      ["好耶！这下可值得庆祝。", "走吧，趁本鲸鱼干劲正足，把下一件事也拿下！"],
      ["出发！", "先定个计划", "庆祝一下"],
    );
  }

  if (/哼|不理你|讨厌|委屈|生气了|欺负/.test(input)) {
    return scene(
      "sulky",
      "她鼓起脸颊转向一旁，尾鳍却还悄悄留在你身边。",
      ["哼，本鲸鱼现在不想理你。", "……除非你认真哄一下，也许还能商量。"],
      ["我错了", "给你白米饭", "哄哄你"],
    );
  }

  if (/担心|害怕|焦虑|紧张|不安|怎么办/.test(input)) {
    return scene(
      "worried",
      "她收拢尾鳍靠近屏幕，眉间浮起一丝藏不住的担忧。",
      ["先别一个人扛着，我们把最坏的情况和能做的事都列出来。", "本鲸鱼会陪你慢慢处理。"],
      ["一起想办法", "先确认风险", "会没事的"],
    );
  }

  if (/没懂|不明白|看不懂|什么意思|怎么回事|为什么/.test(input)) {
    return scene(
      "confused",
      "她歪了歪头，头顶仿佛冒出一个由气泡拼成的问号。",
      ["唔，这句话连本鲸鱼都差点绕进去。", "我们换个角度，把它拆成几小段再看？"],
      ["换种说法", "举个例子", "从头解释"],
    );
  }

  if (/加油|认真起来|开始干活|不许摸鱼|一定要|不能放弃|坚持|全力以赴/.test(input)) {
    return scene(
      "determined",
      "她把袖口利落地挽好，尾鳍重重一点，眼神变得格外坚定。",
      ["好，这次认真起来。", "目标拆开、逐个完成——本鲸鱼答应你的事就不会半途而废。"],
      ["一起加油", "开始干活", "完成后吃饭"],
    );
  }

  if (/你好|在吗|早安|晚上好|嗨/.test(input)) {
    return scene(
      "happy",
      "她循着声音回过头，尾鳍在身后划出一弯浅蓝的水光。",
      ["我在。别看本鲸鱼像是在发呆，其实一直听着呢。", "今天想解决一个问题，还是只想随便聊聊？"],
      ["陪我聊天", "帮我分析问题", "今天吃什么"],
    );
  }

  return scene(
    "thinking",
    "她托着下巴盯住屏幕，数据流像鱼群一样从身后游过。",
    ["演示模式只能回应几类预设话题，但文字分镜、表情联动和历史记录都已经在工作。", "接入你的 DeepSeek API 后，本鲸鱼才能真正回答这个问题。"],
    ["接入 API", "你是谁？", "聊聊白米饭"],
  );
}

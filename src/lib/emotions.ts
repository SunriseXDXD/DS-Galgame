import type { Emotion } from "../types";
import angryArt from "../assets/character/dafeiyu/dafeiyu-v2-angry.webp";
import confusedArt from "../assets/character/dafeiyu/dafeiyu-v2-confused.webp";
import determinedArt from "../assets/character/dafeiyu/dafeiyu-v2-determined.webp";
import excitedArt from "../assets/character/dafeiyu/dafeiyu-v2-excited.webp";
import happyArt from "../assets/character/dafeiyu/dafeiyu-v2-happy.webp";
import hungryArt from "../assets/character/dafeiyu/dafeiyu-v2-hungry.webp";
import neutralArt from "../assets/character/dafeiyu/dafeiyu-v2-neutral.webp";
import proudArt from "../assets/character/dafeiyu/dafeiyu-v2-proud.webp";
import relievedArt from "../assets/character/dafeiyu/dafeiyu-v2-relieved.webp";
import sadArt from "../assets/character/dafeiyu/dafeiyu-v2-sad.webp";
import shyArt from "../assets/character/dafeiyu/dafeiyu-v2-shy.webp";
import sleepyArt from "../assets/character/dafeiyu/dafeiyu-v2-sleepy.webp";
import sulkyArt from "../assets/character/dafeiyu/dafeiyu-v2-sulky.webp";
import surprisedArt from "../assets/character/dafeiyu/dafeiyu-v2-surprised.webp";
import thinkingArt from "../assets/character/dafeiyu/dafeiyu-v2-thinking.webp";
import worriedArt from "../assets/character/dafeiyu/dafeiyu-v2-worried.webp";

export const HUNGER_CUES = /吃(?:饭|什么|啥|点|些)|想吃|米饭|白米|大米|饭菜|饿|夜宵|午餐|早餐|晚餐/;

export const EMOTION_LABELS: Record<Emotion, string> = {
  neutral: "平静",
  thinking: "思考中",
  happy: "开心",
  shy: "害羞",
  angry: "生气",
  hungry: "想吃饭",
  sleepy: "困倦",
  surprised: "惊讶",
  sad: "低落",
  proud: "得意",
  confused: "困惑",
  worried: "担心",
  relieved: "安心",
  excited: "兴奋",
  sulky: "闹别扭",
  determined: "认真起来",
};

export const EMOTION_ASSETS: Record<Emotion, string> = {
  neutral: "neutral",
  thinking: "thinking",
  happy: "happy",
  shy: "shy",
  angry: "angry",
  hungry: "hungry",
  sleepy: "sleepy",
  surprised: "surprised",
  sad: "sad",
  proud: "proud",
  confused: "confused",
  worried: "worried",
  relieved: "relieved",
  excited: "excited",
  sulky: "sulky",
  determined: "determined",
};

export const EMOTION_ART: Record<Emotion, string> = {
  neutral: neutralArt,
  thinking: thinkingArt,
  happy: happyArt,
  shy: shyArt,
  angry: angryArt,
  hungry: hungryArt,
  sleepy: sleepyArt,
  surprised: surprisedArt,
  sad: sadArt,
  proud: proudArt,
  confused: confusedArt,
  worried: worriedArt,
  relieved: relievedArt,
  excited: excitedArt,
  sulky: sulkyArt,
  determined: determinedArt,
};

export const FALLBACK_ART = neutralArt;

export function assetUrl(emotion: Emotion): string {
  return EMOTION_ART[emotion];
}

export function inferEmotion(text: string): Emotion {
  const rules: Array<[Emotion, RegExp]> = [
    ["hungry", HUNGER_CUES],
    ["angry", /胖|生气|讨厌|笨蛋|挨骂|可恶|不许这样/],
    ["excited", /好耶|太棒(?:了)?|迫不及待|激动|冲呀|万岁/],
    ["worried", /担心|不安|害怕|紧张|危险|出事|糟糕(?:了)?|怎么办才好/],
    ["surprised", /居然|竟然|没想到|怎么会|吓一跳|惊讶|震惊/],
    ["sad", /难过|伤心|失败了|抱歉|对不起|失落|沮丧/],
    ["sulky", /哼[！!。…~～]|哼哼|才不要|不理你|闹别扭|赌气|气鼓鼓/],
    ["shy", /喜欢你|好可爱|害羞|脸红|恋爱|约会/],
    ["sleepy", /困了|好困|想睡|睡觉|累了|休息一下|晚安|打盹/],
    ["determined", /一定会做到|一定能完成|必须把.+做好|下定决心|坚持到底|绝不放弃|交给本鲸鱼/],
    ["proud", /真厉害|很聪明|夸夸|优秀|最强|成功了|做到了/],
    ["relieved", /松了口气|放心了|没事就好|幸好|总算解决|终于解决|可以安心了/],
    ["confused", /看不懂|不明白|没弄懂|困惑|迷惑|一头雾水|什么意思|怎么回事/],
    ["happy", /开心|哈哈|太好了|谢谢|顺利完成|当然可以|没问题/],
    ["thinking", /分析|代码|原因|方案|思考|推理|排查|首先|其次/],
  ];

  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? "neutral";
}

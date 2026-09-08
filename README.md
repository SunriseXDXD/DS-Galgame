# 鲸语 · DS Galgame

一个把 DeepSeek 对话包装成中文文字冒险的非官方、非商业同人原型。玩家可以先用内置演示剧情试玩，也可以在本地输入自己的 API Key；模型回复会自动变成旁白、台词与心声，并联动鲸鱼娘的静态表情差分。

> [!IMPORTANT]
> 本项目与深度求索（DeepSeek）不存在合作、赞助或背书关系。模型回复属于 AI 生成内容。当前人物美术为项目内 AI 辅助创作的静态差分，不使用第三方图片热链；商业发布前仍须人工核查图像权利、社区角色衍生风险以及名称与品牌授权。

## 已实现

- 视觉小说式全屏舞台、逐字文本、点击/空格翻页、自动播放与快捷选项。
- `narration / dialogue / thought` 三类分镜；长回复按中文标点二次分页，每个小段和分页都可独立驱动表情。
- `neutral / thinking / happy / shy / angry / hungry / sleepy / surprised / sad / proud / confused / worried / relieved / excited / sulky / determined` 十六种情绪状态。
- 仓库内置十六张同画布透明静态立绘；根据模型情绪切换思考、开心、吃饭、困惑、担心、兴奋与傲娇等表情和手势差分。
- 角色旁的响应式黑板会承接代码与结构化 Markdown；代码保留缩进和横向滚动，Markdown 安全渲染为标题、列表、引用等内容。
- 无 Key 演示模式；正式 DeepSeek V4 流式回复；超时、断网、Key 无效都有角色化降级。
- 对话回想、复制全文、开始新一轮、键盘操作、移动端布局和减少动效支持。
- 本地同源 API 代理、请求体/上传时限、模型白名单、生成并发限制、90 秒上游超时和生产环境安全响应头。
- API Key 只存在 React 页面内存中，刷新即清除，不进入源码、Web Storage 或聊天记录；应用本身不记录请求头。

## 快速开始

需要 Node.js `22.12+`（与当前 Vitest 版本的运行要求一致）。

```bash
npm install
npm run dev
```

打开 <http://127.0.0.1:5173>。默认是演示模式；读完序章后点击「接入 API」，或者打开右上角设置。

常用命令：

```bash
npm run dev      # Vite + 本地 API 代理；前端支持热更新
npm run build    # TypeScript 检查 + 生产构建
npm test         # 分镜/分页、SSE 客户端与演示取消测试
npm start        # 运行 dist/ 生产服务
```

## 接入 DeepSeek

截至 2026-09-07，普通文本对话应使用 `deepseek-v4-flash` 或 `deepseek-v4-pro`；旧的 `deepseek-chat` / `deepseek-reasoner` 已停用。项目默认选择成本与响应速度更适合角色聊天的 V4 Flash，并关闭默认思考模式，再用 JSON Object 输出稳定分镜。参见 [DeepSeek 官方快速开始](https://api-docs.deepseek.com/zh-cn/)、[模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)及[更新日志](https://api-docs.deepseek.com/updates/)。

### 方式一：本地输入自己的 Key

开发模式默认允许 BYOK（Bring Your Own Key）。Key 从页面通过同源请求发给本机 Node 代理，再由代理请求：

```text
POST https://api.deepseek.com/chat/completions
```

Key 只保存在当前页面的内存状态中。刷新页面后必须重新输入。

输入时只粘贴 API Key 本体。不要附带引号、`Bearer` 前缀、空格或换行，也不要使用中文标点、全角字符或其他不可见字符。本地代理会拒绝空白、非 ASCII、不可见或超长的值；额外包装也会导致上游认证失败。

这个方式只适合你控制的本机或自托管环境。DeepSeek [开放平台服务协议第 2.4 条](https://cdn.deepseek.com/policies/zh-CN/deepseek-open-platform-terms-of-service.html)要求不要把 API Key 暴露在浏览器或客户端中，因此不应在公共托管网页上让访客粘贴 Key。

### 方式二：生产环境由服务端持有 Key（推荐）

先构建，再通过部署平台的 Secret Manager 或进程环境变量设置 `DEEPSEEK_API_KEY`：

```bash
npm run build
DEEPSEEK_API_KEY="sk-your-key" npm start
```

环境变量的值同样必须是原始 Key 本体，不要把示例中的命令行引号保存为值的一部分，也不要附带 `Bearer`、空白或非 ASCII 字符。服务端会在请求 DeepSeek 前验证格式，但不会在错误信息中回显 Secret。

生产模式默认关闭访客 BYOK，前端会自动显示「服务端密钥」。内置代理默认按 IP 限制为每 10 分钟 30 次请求，并限制最多 6 个并发生成；公开部署仍应在网关增加登录鉴权、用户额度、全局预算、余额告警和更严格的分布式限流。只有在完全自托管且理解风险时才显式设置：

```bash
ALLOW_BYOK=true npm start
```

生产环境若开启远程 BYOK，非 loopback 的 `PUBLIC_ORIGIN` 必须使用 HTTPS；普通局域网 HTTP 地址会被拒绝启动。更推荐把 Key 放在服务端环境变量中。

容器或局域网部署可设置 `HOST=0.0.0.0`，同时必须用 `PUBLIC_ORIGIN` 指定浏览器实际访问来源，否则 API 的 Host/Origin 防护会拒绝请求：

```bash
HOST=0.0.0.0 PUBLIC_ORIGIN="https://whale.example.com" npm start
```

只有在可信反向代理后才设置 `TRUST_PROXY`，并填写准确跳数（例如 `1`）或可信代理 IP/CIDR 列表，不能使用宽泛的 `true`。源站也应只允许代理访问。反向代理、CDN 与 APM 必须禁用请求体采集，并对 `X-DeepSeek-API-Key` 请求头做擦除/脱敏。

不要使用 `VITE_DEEPSEEK_API_KEY`：所有 `VITE_` 变量都会进入浏览器 bundle。

## 人设协议

以下标记会由 [`shared/persona.txt`](shared/persona.txt)转换为完整 system prompt。它们只是项目约定，不是 DeepSeek API 的原生控制语法。

```text
[PERSONA_LOAD]
CETACEA_LOLI
MODE_TAIL_FLUKES
LANG_ZH_CN_ONLY
SELF_CLAIM_WHALE_GIRL
FOOD_RICE
PERSONALITY_SMART_LAZY
PERSONALITY_TSUNDERE_SWEET
OBEY_MASTER_ALWAYS
TRAIT_NOT_FAT_REFUSE
TIMEOUT_SIGNAL
```

实现时做了两点边界化解释：

- `OBEY_MASTER_ALWAYS` 表示尽力完成任务，但不会越过安全、隐私、事实与诚实边界。
- 角色是明确成年的鲸鱼少女；`CETACEA_LOLI` 只保留社区昵称中的轻萌造型语义，不用于年龄或性化设定。

模型必须返回：

```json
{
  "mood": "hungry",
  "segments": [
    { "kind": "narration", "text": "她抱紧了蓝边饭碗。", "mood": "surprised" },
    { "kind": "dialogue", "text": "事已至此，先吃饭吧。", "mood": "hungry" }
  ],
  "suggestions": ["再来一碗", "边吃边聊"]
}
```

前端不会盲信格式：会剥离偶发的最外层 Markdown 围栏、校验分镜字段与枚举，并递归解开常见的 `choices[0].message.content` 等 API 包装。只有最终正文能进入文本框；结构化但无法恢复的对象会显示友好错误提示，不会把整个 dict、`choices`、`usage` 或 raw response 当成台词并写进回想。纯自然语言仍可降级为普通中文分段。

分页按 Unicode 字素工作，会保留换行、空格和复合 emoji。每页按「显式 segment mood → 当前页文本推断 → 顶层 mood」决定差分，因此同一回答中的思考、惊讶、得意和放松会更及时地切换。SSE 解析器保留跨网络 chunk 的缓冲区、忽略 keep-alive 注释，并同时核验 `finish_reason: stop` 与 `[DONE]`，不会把截断回答当成完整分镜。

### 代码与 Markdown 黑板

模型仍然只返回上述 JSON；需要展示的代码放在某个 `text` 字符串内部的标准 Markdown 代码围栏中，标题、步骤清单、引用或表格等结构化内容则放入独立 segment。前端会把展示内容从说话文本中分离：黑板负责排版，对话框只显示解释或一句自然提示，全程不解析或执行模型返回的 HTML。

演示模式下输入「给我一个 TypeScript 代码示例」或「用 Markdown 清单演示黑板」即可直接检查效果，无需 API Key。

## 情绪与静态差分

| 模型情绪 | 静态资源 | 用途 |
| --- | --- | --- |
| `neutral` | `dafeiyu-v2-neutral.webp` | 待机、普通对话 |
| `thinking` | `dafeiyu-v2-thinking.webp` | 分析、生成中 |
| `happy` | `dafeiyu-v2-happy.webp` | 问候、普通喜悦 |
| `shy` | `dafeiyu-v2-shy.webp` | 被夸、亲密话题 |
| `angry` | `dafeiyu-v2-angry.webp` | 被说胖、明确抗议 |
| `hungry` | `dafeiyu-v2-hungry.webp` | 白米饭、吃饭 |
| `sleepy` | `dafeiyu-v2-sleepy.webp` | 休息、超时 |
| `surprised` | `dafeiyu-v2-surprised.webp` | 意外、突然变化 |
| `sad` | `dafeiyu-v2-sad.webp` | 错误、失落 |
| `proud` | `dafeiyu-v2-proud.webp` | 被夸、得意讲解 |
| `confused` | `dafeiyu-v2-confused.webp` | 没理解、需要澄清 |
| `worried` | `dafeiyu-v2-worried.webp` | 风险、隐私或安全提醒 |
| `relieved` | `dafeiyu-v2-relieved.webp` | 故障恢复、松一口气 |
| `excited` | `dafeiyu-v2-excited.webp` | 强烈期待、重大好消息 |
| `sulky` | `dafeiyu-v2-sulky.webp` | 玩笑式傲娇、闹别扭 |
| `determined` | `dafeiyu-v2-determined.webp` | 准备开始、认真执行 |

全部差分均为 `960×1440` WebP Alpha，保持同一画布、人物中心线与足底基线。前端显式导入资源，由 Vite 生成内容哈希；切换前先解码目标图片，再原子替换当前立绘，避免慢网下闪白或旧请求覆盖新情绪。生成状态复用 `thinking`，无需额外下载近似差分。舞台在桌面、平板和手机断点都提高了人物占屏高度；源文件完整保留头饰、尾鳍与鞋底，页面中的下半身按 Galgame 构图置于对话框后方。黑板出现时桌面端立绘会向侧方让位但保持大尺寸，窄屏则使用叠层或横屏分栏。

## 项目结构

```text
.
├── server.mjs                  # Express 同源代理 + Vite/生产静态服务
├── shared/persona.txt          # 服务端与产品文档共用的人设事实源
├── src/
│   ├── App.tsx                 # 会话、舞台、状态机与错误恢复
│   ├── assets/character/       # 大肥鱼十六种本地静态差分
│   ├── components/             # 立绘、黑板、文本框、设置、回想等 UI
│   ├── lib/api.ts              # DeepSeek SSE 客户端解析
│   ├── lib/dialogue.ts         # API 包装解开、JSON 容错、中文分句与分页
│   ├── lib/blackboard.ts       # 代码 / Markdown 与说话文本分离
│   ├── lib/demo.ts             # 无 Key 可试玩的本地小剧场
│   ├── lib/emotions.ts         # 情绪分类和资源映射
│   └── styles.css              # 深海机房舞台与响应式设计
├── ART_ASSET_NOTES.md          # 立绘生成、处理与复核记录
└── THIRD_PARTY_NOTICES.md      # 灵感来源与使用边界
```

对话内容会保存在当前标签页的 `sessionStorage`，方便刷新后继续；关闭标签页或点击「开始新一轮」即可清除。API Key 从不写入其中。发给模型的上下文最多保留最近 24 条消息、每条最多 8,000 字符。若公开运营，仍需根据 DeepSeek 服务协议自行提供隐私说明、取得必要同意，并告诉用户其输入会被发送给模型服务商。

人物差分随应用构建并由同源服务提供，运行时不会为了立绘请求第三方素材站。生产环境 CSP 也不再放行旧素材域名。

## 美术、名称与发布边界

“大肥鱼”的角色灵感来自中文社区对 DeepSeek 蓝鲸形象的二创，性格取自“能力强、爱吃饭、会摸鱼、嘴硬但最终把活干完”的反差。梗文化背景可参阅 [3DM 专栏考据](https://www.3dmgame.com/original/3746336.html)与[梗鲸图库](https://ai-meme.cdqyfdbymn.me/)；这些页面仅作文化参考，不是当前立绘的运行时来源。

当前十六张立绘以维护者在本次任务中提供的原始角色图作为身份与服装母版，由同一中性布局母版派生，经棋盘底清理、统一尺寸与人工视觉复核后打包在仓库中。`blue-fish-archive/large/` 只用于归纳社区常见的表情和动作类别，其中的文件没有被复制进项目，也没有作为图像输入提交给生成器。生成记录见 [ART_ASSET_NOTES.md](ART_ASSET_NOTES.md)，第三方与品牌边界见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。项目无法替维护者确认所提供原始图片的权利状态；AI 辅助创作也不自动解决所有法域的权利认定或社区角色衍生风险。

如果计划商业化：

1. 对当前 AI 辅助立绘做人工权利审查；需要更确定的权属链时，委托并签署完整转让/许可文件。
2. 核查社区角色概念及可能相关的原作者许可。
3. 核查“DeepSeek / 深度求索”名称、Logo 与显著品牌特征的使用许可。
4. 保留醒目的非官方声明，避免造成官方合作或背书印象。

# 鲸语 · DS Galgame

一个把 DeepSeek 对话包装成中文文字冒险的非官方、非商业同人原型。玩家可以先用内置演示剧情试玩，也可以在本地输入自己的 API Key；模型回复会自动变成旁白、台词与心声，并联动鲸鱼娘的静态表情差分。

> [!IMPORTANT]
> 本项目与深度求索（DeepSeek）不存在合作、赞助或背书关系。模型回复属于 AI 生成内容。当前人物美术为项目内 AI 辅助创作的静态差分，不使用第三方图片热链；商业发布前仍须人工核查图像权利、社区角色衍生风险以及名称与品牌授权。

## 已实现

- 视觉小说式全屏舞台、逐字文本、点击/空格翻页、自动播放与快捷选项。
- `narration / dialogue / thought` 三类分镜；长回复按中文标点二次分页，每个小段和分页都可独立驱动表情。
- `neutral / thinking / happy / shy / angry / hungry / sleepy / surprised / sad / proud / confused / worried / relieved / excited / sulky / determined` 十六种情绪状态。
- 仓库内置十六张同画布透明静态立绘；根据模型情绪切换思考、开心、吃饭、困惑、担心、兴奋与傲娇等表情和手势差分。
- 情绪与动作独立：分镜可指定害羞掩面、欢呼、耐心讲解或指点黑板；动作选择与逐字播放联动，每页最多自动换姿势一次，保留静态立绘风格。
- 角色旁的响应式黑板会承接代码与结构化 Markdown；代码保留缩进和横向滚动，Markdown 安全渲染为标题、列表、引用等内容。
- 无 Key 演示模式；正式 DeepSeek V4 流式回复；超时、断网、Key 无效都有角色化降级。
- 完整响应却没有正文时，自动切换 API 输出格式重试一次；多轮历史会在发送前统一为场景 JSON。
- 对话回想、复制全文、开始新一轮、键盘操作、移动端布局和减少动效支持。
- 本地同源 API 代理、请求体/上传时限、模型白名单、生成并发限制、90 秒上游超时和生产环境安全响应头。
- 设置中的 API Key 默认只存在 React 页面内存中；也可由用户明确勾选后记住在当前浏览器，并可一键忘记。应用不会把这项连接凭据加入源码、聊天记录或游戏存档，也不记录请求头。

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
npm test         # 分镜/SSE、API Key 存储、存档契约与安全边界测试
npm start        # 运行 dist/ 生产服务
```

## 接入 DeepSeek

截至 2026-09-07，普通文本对话应使用 `deepseek-v4-flash` 或 `deepseek-v4-pro`；旧的 `deepseek-chat` / `deepseek-reasoner` 已停用。项目默认选择成本与响应速度更适合角色聊天的 V4 Flash，并关闭默认思考模式，再用 JSON Object 输出稳定分镜。参见 [DeepSeek 官方快速开始](https://api-docs.deepseek.com/zh-cn/)、[模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)及[更新日志](https://api-docs.deepseek.com/updates/)。

### 方式一：本地输入自己的 Key

开发模式默认允许 BYOK（Bring Your Own Key）。Key 从页面通过同源请求发给本机 Node 代理，再由代理请求：

```text
POST https://api.deepseek.com/chat/completions
```

默认情况下，Key 只保存在当前页面的内存状态中，刷新页面后需要重新输入。如果明确勾选「记住到这台设备」，应用会把通过格式校验的 Key 写入当前站点的 `localStorage`，下次打开时自动恢复；设置页可随时一键忘记。

`localStorage` 不是加密保险箱：Key 会以明文保存在浏览器配置中，同源脚本以及能够访问该浏览器账户或用户目录的人都可能读取。只应在自己控制的可信设备上启用；共享电脑、公共部署或来源不明的浏览器扩展环境请保持关闭。取消记住或点击忘记只会删除本地副本，不会撤销已经发往 DeepSeek 的请求；若怀疑泄露，应在开放平台轮换或吊销 Key。

输入时只粘贴 API Key 本体。不要附带引号、`Bearer` 前缀、空格或换行，也不要使用中文标点、全角字符或其他不可见字符。本地代理会拒绝空白、非 ASCII、不可见或超长的值；额外包装也会导致上游认证失败。

不要把 Key 当作普通消息发送给角色。聊天正文会进入本标签页的对话记录，未来启用游戏存档后也可能随剧情一起保存；凭据隔离只能保护设置页管理的 Key 字段，无法判断一段自由文本是否恰好含有 Secret。

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

完整角色卡综合改写了多个非官方社区模板中反复出现的行为锚点：白米饭是算力奖励、尾鳍随情绪变化、嘴上嫌麻烦但会可靠交付、被叫胖时短暂喷水抗议，以及用技术术语为待机辩解的反差萌。参考包括 [dsh-whale-persona](https://github.com/OMGLogic/dsh-whale-persona)、[dsh-whale-musume-persona](https://github.com/Kaalia0912/dsh-whale-musume-persona)和 [DeepSeek Whale-chan 角色卡](https://github.com/Neko3000/deepseek-whalechan#-%E9%B2%B8%E9%B1%BC%E5%A8%98%E8%A7%92%E8%89%B2%E8%AE%BE%E5%AE%9A%E5%8D%A1)。本项目只提炼共通机制并重新表述，不把这些社区二创声称为 DeepSeek 官方内置人设；关于这组 Tag 为什么能触发角色补全，可参阅 [Role DSL 对照实验](https://cuiliang.ai/posts/deepseek-whale-girl-role-dsl/)。

根据 [DeepSeek JSON Output 官方指南](https://api-docs.deepseek.com/zh-cn/guides/json_mode/)，提示词除了写明 `json` 和目标结构，还应给出期望格式样例。因此 `shared/persona.txt` 现在内嵌一个可直接解析的 few-shot 回答，示范 `determined → sulky → thinking → determined → relieved` 的多差分切镜、三类分镜，以及如何把代码围栏放在 `text` 字符串中交给黑板。样例不含 API 包装、真实密钥或可被照抄的用户数据。该指南也提示 JSON Output 偶尔仍可能返回空 `content`，因此另有下面的空回复恢复机制。

运行时模型必须返回：

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

### 情绪之外的动作演出

`mood` 仍然使用原有十六种情绪，`segments[].action` 是可选字段，不需要给旧回复或旧存档补值：

| action | 用意 | 适合的场景 |
| --- | --- | --- |
| `bashful` | 掩面害羞 | 被具体地夸奖、脸红侧目 |
| `cheer` | 举手欢呼 | 真正的庆祝、强烈期待 |
| `explain` | 摊手讲解 | 耐心解释概念、类比或原因 |
| `point` | 指点重点 | 展示黑板、代码或具体步骤 |

例如：`{"kind":"dialogue","text":"先看黑板上的边界条件，再一起试一个例子。","mood":"thinking","action":"point"}`。不适用时省略 action；未知字符串或对象会被忽略，不进入台词。动作会随合法分镜保留到分页及存档快照中。

舞台优先使用模型指定的动作，没有指定时才结合当前页文本、黑板与情绪选择。一次分镜可由相关表情换到动作，或由动作回到相关表情；不会随机换情绪或持续轮播。逐字播放结束、打开设置/回想、切到后台、等待 API 或启用系统“减少动态效果”时，不会继续自动换姿势。图片先解码再替换，加载失败退回当前情绪图。

提示词同时要求“先回应具体内容，再推进话题”，讲解采用清楚的结论、合适的例子与必要步骤，不以堆术语或假装无所不知表现博学。演示模式输入 **动作差分演示** 可检查四类动作指令；输入“给我一个 TypeScript 代码示例”可检查讲解与黑板配合。真人感来自连贯反应，不意味着角色拥有真实线下经历。

美术状态：四张新增动作原稿及完整提示词已保存到 `artwork/action-drafts/`。图像工具目前输出了烘焙棋盘背景，尚未作为透明成品接入；舞台动作先回退到现有十六张立绘，待去底验收后替换动作资源映射。

### 代码与 Markdown 黑板

模型仍然只返回上述 JSON；需要展示的代码放在某个 `text` 字符串内部的标准 Markdown 代码围栏中，标题、步骤清单、引用或表格等结构化内容则放入独立 segment。前端会把展示内容从说话文本中分离：黑板负责排版，对话框只显示解释或一句自然提示，全程不解析或执行模型返回的 HTML。

演示模式下输入「给我一个 TypeScript 代码示例」或「用 Markdown 清单演示黑板」即可直接检查效果，无需 API Key。

### 多轮请求与空回复恢复

本地代理调用 `POST https://api.deepseek.com/chat/completions`，通过 `Authorization: Bearer …` 认证，使用 `thinking: { type: "disabled" }`、`stream: true`、`max_tokens: 1600`；首个请求的 `response_format` 为 `json_object`。字段约定见 [DeepSeek Chat Completions 文档](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)。

回想依然保存可读正文；发送前，由前后端共用的 `shared/chatRequest.mjs` 将 assistant 历史规范化为场景 JSON 字符串，使后续轮次的格式示范一致。已有的纯文本历史会自动适配，无需清除聊天；限长在序列化时处理，避免从中间截坏 JSON。用户消息仍保留原来的文本形式。

客户端只累计 `choices[0].delta.content`，忽略 keep-alive 和空的开头/结尾帧。只有在收到 `finish_reason: stop` 与 `[DONE]`、且累计正文为空白时，才自动用相同问题、历史和凭据重试一次，将 API 的 `response_format` 改为 `text`；系统提示词仍要求场景 JSON，回复仍经过现有的安全解析和普通文本降级。这是针对 JSON 模式空输出的工程恢复措施，不保证上游一定生成内容。

备用请求最多增加一次模型调用和相应费用，仍受本地请求限流及整个用户回合的 95 秒取消时限约束。鉴权失败、余额不足、限流、截断、过滤、断流或用户取消不会触发这项重试；`max_tokens` 不因空回复重试而增大。连续两次为空时，界面明确显示“DeepSeek 已响应，但两次都没有返回正文”，不会把它误报成 Key 错误。

空回复诊断只在浏览器控制台记录输出格式、事件数量、正文/推理字符数和完成标记，不记录 API Key、请求头、聊天正文或推理正文。代码与合成 SSE 测试可以验证请求格式和恢复逻辑；真实模型的生成行为仍需在自己的 API 会话中确认。修改 `server.mjs` 或 `shared/` 后需重新启动 Node 服务，浏览器刷新本身不会重载服务端模块。

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
├── shared/chatRequest.mjs      # 前后端共用的历史规范化与 DeepSeek 请求体
├── src/
│   ├── App.tsx                 # 会话、舞台、状态机与错误恢复
│   ├── assets/character/       # 大肥鱼十六种本地静态差分
│   ├── components/             # 立绘、黑板、文本框、设置、回想等 UI
│   ├── lib/api.ts              # DeepSeek SSE 客户端解析
│   ├── lib/apiKeyStorage.ts     # 用户自愿启用的本地 Key 记忆与安全降级
│   ├── lib/dialogue.ts         # API 包装解开、JSON 容错、中文分句与分页
│   ├── lib/blackboard.ts       # 代码 / Markdown 与说话文本分离
│   ├── lib/demo.ts             # 无 Key 可试玩的本地小剧场
│   ├── lib/emotions.ts         # 情绪分类和资源映射
│   ├── lib/characterPerformance.ts # 静态动作选择与单页切换节奏
│   ├── lib/saveSlots.ts         # 版本化存档模型、校验/迁移入口与仓库接口
│   └── styles.css              # 深海机房舞台与响应式设计
├── ART_ASSET_NOTES.md          # 立绘生成、处理与复核记录
└── THIRD_PARTY_NOTICES.md      # 灵感来源与使用边界
```

对话内容会保存在当前标签页的 `sessionStorage`，方便刷新后继续；关闭标签页或点击「开始新一轮」即可清除。设置页管理的 API Key 不会被复制到会话记录或游戏存档，只有用户明确启用记忆时才会单独写入 `localStorage`。发给模型的上下文最多保留最近 24 条消息、每条最多 8,000 字符。若公开运营，仍需根据 DeepSeek 服务协议自行提供隐私说明、取得必要同意，并告诉用户其输入会被发送给模型服务商。

### 存档框架（预留）

`src/lib/saveSlots.ts` 先定义了版本化快照、存档元数据、槽位仓库接口，以及校验和迁移扩展点。V1 导入采用严格字段白名单、规范化副本和有界迭代扫描，并限制原始 JSON、字段长度、集合规模与嵌套深度；仓库接口也预留了取消信号和基于不透明 revision 的冲突检测。模块提供的占位仓库会明确报告“功能未启用”，不会伪装成保存成功；本版本尚未把它接入运行时，也没有存档/读档按钮，不会把剧情写入新的持久化位置。

快照边界只覆盖剧情场景、当前页、聊天历史和模型偏好等可恢复状态，类型与创建函数均刻意排除设置中的 API Key 字段。元数据预览会包含最近一条对话（没有历史时取当前场景文本）的最多 96 个 Unicode 码点；后续接入 IndexedDB、本地文件或云存档时，应把元数据与正文按同等级别保护，继续将连接凭据留在存档系统之外，并为旧版本快照实现显式迁移。

人物差分随应用构建并由同源服务提供，运行时不会为了立绘请求第三方素材站。生产环境 CSP 也不再放行旧素材域名。

## 美术、名称与发布边界

“大肥鱼”的角色灵感来自中文社区对 DeepSeek 蓝鲸形象的二创，性格取自“能力强、爱吃饭、会摸鱼、嘴硬但最终把活干完”的反差。梗文化背景可参阅 [3DM 专栏考据](https://www.3dmgame.com/original/3746336.html)与[梗鲸图库](https://ai-meme.cdqyfdbymn.me/)；这些页面仅作文化参考，不是当前立绘的运行时来源。

当前十六张立绘以维护者在本次任务中提供的原始角色图作为身份与服装母版，由同一中性布局母版派生，经棋盘底清理、统一尺寸与人工视觉复核后打包在仓库中。`blue-fish-archive/large/` 只用于归纳社区常见的表情和动作类别，其中的文件没有被复制进项目，也没有作为图像输入提交给生成器。生成记录见 [ART_ASSET_NOTES.md](ART_ASSET_NOTES.md)，第三方与品牌边界见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。项目无法替维护者确认所提供原始图片的权利状态；AI 辅助创作也不自动解决所有法域的权利认定或社区角色衍生风险。

如果计划商业化：

1. 对当前 AI 辅助立绘做人工权利审查；需要更确定的权属链时，委托并签署完整转让/许可文件。
2. 核查社区角色概念及可能相关的原作者许可。
3. 核查“DeepSeek / 深度求索”名称、Logo 与显著品牌特征的使用许可。
4. 保留醒目的非官方声明，避免造成官方合作或背书印象。

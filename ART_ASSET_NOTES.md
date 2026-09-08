# 大肥鱼静态差分生成记录

## 资产范围

`src/assets/character/dafeiyu/` 中当前启用的是十六张 `dafeiyu-v2-*.webp`。它们均为 `960×1440`、带真实 Alpha 通道的 WebP 静态立绘，使用相同画布、人物中心线和足底基线；生成等待状态复用 `thinking`。旧 `v1` 文件仅保留供人工比对或回滚，不再被前端导入。

| 情绪 | SHA-256 |
| --- | --- |
| `neutral` | `46a161b75fff31cbcfbdb071298262dfa55e33400a8281552f621ba05f3de0ab` |
| `thinking` | `9b57cdffe87fe8a9879d72c3e3dca6796bb3662687ce15680db5e6bc9d74b993` |
| `happy` | `49c17845b80034821f4125346a7be9a026ce8f0799c6cfb68808febb47be1a66` |
| `shy` | `78eea507c2a8ac68563a50bb8238fc0b0e8bec52750b24a83e491e5850b7d09a` |
| `angry` | `3980fe4992f830d90ae71ee398313a1b74ff12ca3e4aae4fafda6671cf46cd46` |
| `hungry` | `9243a412decbc362fb48823cbcc3f42f054e072796c8c47a5360ed25fc5bed54` |
| `sleepy` | `fd4e54d3712ba51efd5587238c54dbcfaf683a09fb42f854a053832c0b7d6cf9` |
| `surprised` | `86c2f619db8caf757f5780e39606721ae8c9be18f04847ed8aa4b567fa1814df` |
| `sad` | `a89d42a5f5882169a2cdb88c5be5be2b2bbd3b609ffbcd31fc96d6d80ebdab1c` |
| `proud` | `15e99183cf6ca42cb3ce05ab70cb3718cf2757b7648ccdbd0ffb31b4a6e5990f` |
| `confused` | `d359e1dd310ce5b031c668690aacdd246798906092bb030ccc1781bb5a88a6ef` |
| `worried` | `262e1d5018725ffd77310091c7731007c89a835fcb99a2206f9cf36b45e03057` |
| `relieved` | `31a990500165c93f3bac7c54fea7999f8453b537aa848dbf82ff8a870b86244c` |
| `excited` | `361c206261cce6d68548579d1ced58132b5b674e783dca7d6460c18333d06f7f` |
| `sulky` | `5777699293d5f49253ea4bd45c951a8e3ab6396c51d84643f479ff78d9e8ff30` |
| `determined` | `2a895ea1c1fc2d0a463d630ede085d44dfa1aa6606936354d99e11d114713347` |

## 生成方式

- 日期：2026-09-08
- 工具：OpenAI 内置图像生成工具
- 模式：`identity-preserve` 静态游戏立绘编辑
- 身份输入：维护者在本次任务中提供的一张 `1052×1870` RGB 原始角色图
- 动作参考：只人工浏览 `blue-fish-archive/large/` 归纳表情和姿势语义；其中图片没有复制进项目，也没有作为生成器图像输入
- 流程：先从原始图生成 `neutral` 布局母版；其余十五张均同时引用原始图和该布局母版，以锁定身份、服装、镜头和画布位置

中性母版的核心提示词要求保留原图的成年鲸鱼娘、圆润脸和蓝色渐变眼睛；深海军蓝到浅青蓝的超长无辫波浪发、单根高弧呆毛、白色女仆发箍、鲸鳍耳与右侧青蓝蝴蝶结；白色荷叶边上衣、蓝宝石领结、双排金扣腰封、带鲸鱼图案的白围裙、蓝色细竖纹中裙片、金色海洋藤纹及踝长裙；白袜、深蓝玛丽珍鞋，以及画面右侧完整双尾鳍。输出限定为正面全身、固定中心线与足底基线、单角色透明立绘，不得出现背景、文字、额外肢体、短裙、黑丝袜、长靴、辫发或服装重设计。

十五张差分共用以下约束集：

```text
Create one static visual-novel expression variant of the exact same whale-maid shown in both supplied references. The first image is the canonical identity/costume source; the second is the neutral layout master. Preserve the adult face, blue gradient eyes, long loose navy-to-cyan hair without braids, ahoge, maid headband, whale-fin ears and cyan bow; preserve the ankle-length Victorian navy/royal-blue maid dress, whale apron, gold embroidery, white stockings, Mary Jane shoes, and one complete twin-fluke whale tail on viewer-right. Match the neutral master's line art, cel shading, camera, scale, centerline and feet baseline. Change only the requested expression, forearms/hands and minimal tail tension. Isolated single full-body character, real transparent background; no scenery, text, watermark, extra limbs, crop, costume redesign, chibi, photorealism or 3D.
```

各差分的变化指令：

- `thinking`：轻蹙眉、视线略向左上，一指抵下巴，另一手托住手肘。
- `happy`：闭眼开朗笑，一手小幅挥手，另一手轻提裙边。
- `shy`：明显但克制的腮红、侧目微笑，双手在领结下交握。
- `angry`：下压眉、直视、开口抗议，一手叉腰、一手制止；可爱而不具攻击性。
- `hungry`：期待亮眼，双手捧唯一道具——一碗白米饭。
- `sleepy`：半闭眼、小哈欠，一手揉眼，站姿与基线不变。
- `surprised`：圆睁眼、O 形嘴，双手在肩旁抬起。
- `sad`：含泪眼、内眉上扬、下撇嘴，双手在围裙前低垂交握。
- `proud`：半眯眼得意微笑，一手叉腰、一手举指讲解。
- `confused`：轻歪头、不对称眉，一指抵脸颊；不添加问号图形。
- `worried`：警觉担忧的眉眼，双手在胸前交握；区别于已经失落的 `sad`。
- `relieved`：闭眼轻笑、肩部放松，一手抚胸；区别于强烈喜悦。
- `excited`：睁亮双眼、开口笑，双拳在肩旁轻握，尾鳍略抬。
- `sulky`：鼓腮侧目、抱臂，表现玩笑式傲娇而非真正生气。
- `determined`：稳定直视、挺直肩背，一拳轻抵胸口、一手叉腰。

## 后处理与复核

生成器输出把预览棋盘格烘焙在不透明 PNG 中，因此没有直接入库。后处理先从画布边缘估计棋盘颜色，只清除与边缘连通或高度可信的封闭棋盘区域，避免误删白色上衣、围裙和裙边；随后用亚像素羽化恢复边缘抗锯齿，将原始纵向画布等比放入 `960×1440` 统一画布，并以 WebP quality 88 输出。

十六张成品均确认尺寸为 `960×1440`、Alpha 范围为 `0–255`；总大小约 `2.6 MB`。已在深海蓝底逐张检查发丝、耳鳍、白色荷叶边、裙摆、鞋和尾鳍，且用实际页面断点继续检查遮挡、裁切和切换稳定性。

## 使用边界

原始角色图由维护者提供，项目无法代为确认其作者、许可范围或权利链。当前图片作为非商业原型的一部分提供，不单独授予提取、转售、再分发或商业使用许可。AI 辅助生成不等于自动获得所有法域的排他著作权；计划商业化时，应由维护者进行独立权利审查，必要时更换为权属链明确的委托美术。

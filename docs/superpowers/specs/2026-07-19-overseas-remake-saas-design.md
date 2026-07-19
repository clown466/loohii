# 海外热门视频拆解复刻 SaaS — 设计文档

> 日期：2026-07-19  
> 状态：待用户审阅  
> 底座：鹿绘 AI（Loohii）技术栈复用；产品可独立品牌/入口

## 1. 产品定义与 MVP 范围

### 1.1 一句话

输入 TikTok（后期 Facebook）热门视频链接 → 自动解析结构 → 生成可发布的本地化**剧情短视频**成片（按分镜重生成画面）。

### 1.2 定位决策

| 决策项 | 选择 |
|--------|------|
| 与 Loohii 关系 | 方案 1：共用底座（鉴权、队列、R2、AI adapter、Socket）；独立产品入口/品牌 |
| 复刻深度 | C：全链路成片（链接进 → MP4 出） |
| 成片形态 | C：剧情短视频仿拍（Seedance/即梦类按镜重生成） |
| 再创作原则 | 结构级再创作（钩子/节奏/镜头语法），非像素级搬运；不复用原曲原片商用 |

### 1.3 MVP（P0）必做

| 能力 | 说明 |
|------|------|
| 链接解析 | 粘贴 TK 链接 → 拉取视频/封面/时长/基础元数据；失败可上传兜底 |
| 结构拆解 | ASR、镜头切分、逐镜画面描述、钩子/节奏标注；结果可编辑 |
| 本地化改编 | 中文剧本 + 人物/场景锁定 + 分镜提示词 |
| 批量仿拍 | 按镜调用图生视频/文生视频，支持失败镜局部重跑 |
| 合成成片 | 接片、字幕、BGM 占位、导出竖屏 MP4 |
| 人工卡点 | 拆解后（A）、改编后（B）、成片前（C）；默认开启 |

### 1.4 MVP 明确不做

- Facebook 采集（P1）
- 热门榜自动爬取与选题推荐（P1；先手动贴链接）
- 多平台一键发布（P1）
- 矩阵号批量账号管理（P1）
- 像素级画面复制 / 原声原曲商用

### 1.5 成功标准（MVP）

- 单条：链接（或上传）→ 可下载成片
- 中位耗时可控（约 15–40 分钟，视时长与模型）
- 人工干预默认 ≤ 3 次卡点（可配置关闭）
- 结构像、人物跨镜可辨、能发

---

## 2. 端到端流水线与模块拆分

### 2.1 阶段状态机

一条链接 = 一个 `RemakeJob`，阶段可重试、可从失败点续跑。

```text
[链接提交 / 上传]
    ↓
① Ingest     拉取视频 + 元数据入库
    ↓
② Analyze    ASR / 分镜 / 画面理解 / 结构报告
    ↓  Gate A（可关）
③ Adapt      本地化剧本 + 人物/场景锁定 + 分镜提示词
    ↓  Gate B（可关）
④ Generate   按镜并行出图/出视频（队列限流）
    ↓
⑤ Assemble   接片 + 字幕 + BGM 位 + 导出 MP4
    ↓  Gate C（默认开）
⑥ Deliver    成片入库 + 下载 / 可选回写画布
```

### 2.2 模块边界

| 模块 | 职责 | 输入 → 输出 |
|------|------|-------------|
| Link Ingest | 解析 TK 链接、下载、规范化 | URL → `SourceAsset` |
| Media Analyzer | 转写、切镜、镜级描述、钩子标注 | `SourceAsset` → `Breakdown` |
| Localizer | 中文改编、一致性约束、逐镜 prompt | `Breakdown` → `RemakeScript` |
| Shot Generator | 调视频模型按镜生成 | `RemakeScript` → `ShotClip[]` |
| Composer | FFmpeg 合成、字幕、音轨 | `ShotClip[]` → `FinalVideo` |
| Review Gate | 阶段审批、驳回重跑指定阶段 | 人工决策 → 继续/回退 |
| Job Orchestrator | BullMQ 编排、限流、进度推送 | 复用 Loohii 队列/实时层 |

### 2.3 逻辑数据模型

- **RemakeJob**：状态机、进度、耗时、费用、失败原因、租户/操作者
- **SourceAsset**：原片文件、时长、封面、平台、外链 ID、ingest 状态
- **Breakdown**：镜列表、全文 ASR、人物/场景草案、confidence
- **RemakeScript**：改编台词、styleLock、角色/场景锁、逐镜 prompt
- **ShotClip**：镜序号、结果 URL、模型/参数/seed、重试次数
- **FinalVideo**：成片 URL、分辨率、字幕轨、版本号

### 2.4 并发与成本（MVP 即具备）

- 租户并发上限（例如同时 2 个 Job）
- 镜级生成全局限流
- 单 Job 预算熔断（超预估停在 Gate B）
- 镜级重试 2 次 → 标记失败 → 允许只重跑失败镜

### 2.5 与 Loohii 集成

- **复用**：用户体系、BullMQ、R2、Socket.io、AI adapter、积分/账单钩子
- **新增**：`remake` 域路由/队列/Prisma model（避免污染画布核心）
- **兜底**：卡点驳回 → 一键打开画布，带入脚本与已生成镜头，可续跑

---

## 3. 链接解析与拆解

### 3.1 Ingest 策略（可插拔）

| 策略 | 用途 | MVP |
|------|------|-----|
| 第三方解析 API（可切换供应商） | TK 链接 → 视频 + 封面 + 时长 + 作者等 | 默认主路径 |
| 自建拉取 Worker（yt-dlp 类） | 供应商故障兜底 | 开关备用 |
| 用户本地上传 | 链接失败仍可跑全流程 | 必做 |
| 官方/企业 API | 长期稳定与合规 | P2 |

**SourceAsset 标准字段**：`platform`、`sourceUrl`、`externalId`、`videoKey`、`coverKey`、`durationMs`、`width`、`height`、`rawMeta`、`ingestStatus`、`ingestError`。

**稳定性**：超时/403/地区限制 → 切备选 → 仍失败引导上传；同 `externalId` 去重复用；时长/大小异常直接失败。

### 3.2 Analyze 深度

目标：产出可驱动仿拍的镜级结构，而非文学评论。

```text
音视频
  ├─ ASR（带时间戳） → 台词轴
  ├─ 镜头切分 → Shot[]
  ├─ 逐镜抽帧 → 多模态画面描述
  └─ 结构标注 → hook / build / payoff / cta
       ↓
     Breakdown
```

**Shot 最小字段**：`index`、`startMs`、`endMs`、`transcript`、`visualSummary`、`shotType`、`subjects[]`、`hookRole`、`keyframeUrls[]`。

**质量闸门**：ASR 空/过短、切镜数异常 → 降级重跑或强制 Gate A；拆解结果必须可编辑（改时间码、合并/拆分镜、改描述）。

**契约**：Analyze 不写 Seedance 提示词；提示词仅由 Localizer 产出，便于独立重跑。

---

## 4. 本地化改编 + 分镜仿拍 + 合成

### 4.1 Localizer

1. 生成 `CharacterLock[]` / `SceneLock[]`（可先定妆图/场景板）
2. 结构保留改编：镜数与钩子位对齐；中文台词非机翻腔
3. 逐镜 prompt：画面约束 + 动作 + 景别 + 时长 + 角色/场景引用
4. 合规改写：敏感、侵权品牌、可识别真人 → 原创人设

**RemakeScript**：`styleLock`、`characters[]`、`scenes[]`、`shots[]`（含 `prompt`/`durationMs`/`dialogue`/`camera`/`refShotId`）、`subtitleTrack` 草案、`bgmMood`（不定原曲）。

Gate B 确认后进入 Generate。

### 4.2 Shot Generator

| 策略 | 说明 | 默认 |
|------|------|------|
| 图生视频优先 | 有定妆/场景参考时 | ✅ |
| 先关键帧再 I2V | 难镜自动降级 | ✅ |
| 镜级并行 + 限流 | 租户与全局双限 | ✅ |
| 失败重试 2 次 | 其后标红，支持只重跑失败镜 | ✅ |

一致性：角色/场景参考进镜；`seed` 与模型参数写入 `ShotClip`。  
成本：Generate 前报价；时长/镜数上限（建议 ≤ 30–45 秒或可配置 N 镜）。

### 4.3 Composer

按 index 接片 → 简单转场 → 字幕 → BGM 占位（授权曲库或静音）→ 导出竖屏（优先 1080×1920）→ `FinalVideo`。

Gate C：预览通过可下载；驳回可「重跑某镜 / 回改编 / 仅重合成」。

### 4.4 生成侧成功判据

- 人物跨镜可辨认为同一人设
- 前 3 秒钩子结构不丢
- 成片可播、有字幕、可下载
- 失败可局部重跑

---

## 5. SaaS 层、风险与分期

### 5.1 SaaS（MVP）

| 能力 | 做法 |
|------|------|
| 账号 | 复用 Loohii 登录；独立产品入口 |
| 工作区 | Workspace → 多个 RemakeJob |
| 权限 | Owner / Member |
| 计费 | 积分制：解析/拆解/生成/合成分项；生成前确认报价 |
| 套餐 | Free（严限）+ Pro（并发与月积分） |
| 审计 | 源链接、模型、版本、操作者、卡点可追溯 |

**MVP 页面**：新建任务、Job 详情（进度+卡点）、任务列表与成片库、积分/套餐。

### 5.2 风险与对策

| 风险 | 对策 |
|------|------|
| TK 拉取不稳定 | 多供应商 + 自建备选 + 上传兜底 |
| 人物崩、不像 | 定妆锁 + I2V + Gate B/C + 局部重跑 |
| 成本失控 | 时长/镜数上限 + 报价 + 预算熔断 |
| 版权合规 | 结构级再创作、不复用原曲原片、用户授权声明 |
| 上游模型变更 | AI adapter 抽象；参数落库 |
| 全自动预期过高 | 默认开卡点；全自动为高级开关 |

### 5.3 分期

| 阶段 | 内容 |
|------|------|
| Phase 0（2–3 周） | TK/上传 → 可编辑拆解 → 改编 → 单风格仿拍 → 竖屏成片 → Gate A/B/C；积分先记账 |
| Phase 1 | FB、热门选题池、BGM 授权库、团队、支付套餐 |
| Phase 2 | 多模型路由、质量评分、矩阵分发、开放 API/Webhook |
| Phase 3 | 数据验证后可选独立中台拆分 |

### 5.4 实现落点（约定）

- 编排：BullMQ + Socket 进度
- 存储：Cloudflare R2
- 合成：FFmpeg Worker
- 代码域：`server/src/routes/remake*`、`queues/remake*`、对应 Prisma models
- 前端：独立 Remake 工作台页面；画布仅兜底

---

## 6. 范围边界声明

本文档只定义产品与技术设计，不包含实现任务拆解。用户审阅通过后，另写 `docs/superpowers/plans/2026-07-19-overseas-remake-saas.md` 实现计划。

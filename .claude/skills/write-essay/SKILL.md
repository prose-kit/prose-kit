---
name: write-essay
description: "以你的写作声音生成散文。/write-essay [主题] 通过并行 subagent、RAG 声音校准和种子驱动提示，生成 9 篇变体（3 轮 x 每轮 3 篇）。"
user_invocable: true
---

# 散文生成 Skill

## Step 0: 主 agent 准备

### 0a: 加载参考文件

主 agent 读取风格指南和世界观，**仅供自己理解声音和叙述者设定**，不塞进 subagent prompt：

```bash
cat .claude/skills/write-essay/references/style-guide.md
cat .claude/skills/write-essay/references/worldview.md
```

### 0b: 提取禁用词清单

从风格指南中提取禁用词，这是唯一会进入 subagent prompt 的硬规则：

```
绝不用：然而、因此、诚然、不过、总之、此外、另外、综上所述、事实上、值得注意的是
绝不用：笔者认为、在某种程度上、不可否认
绝不用：岁月如歌、时光荏苒、不经意间、蓦然回首、恍如隔世、如梦似幻
绝不用：作为一个...
绝不用：在这个XXX的时代
绝不用：感叹号（！）
绝不用：markdown 格式（# 标题、**加粗**、列表、编号）
绝不用：emoji
绝不用：em dash（—）
绝不用"仿佛"超过一次
用 `---` 分隔段落组
用中文冒号 `：` 引语，不用引号
```

## Step 1: 解析输入 → 生成种子

用户给一个主题、种子想法或前提。

主 agent 的核心工作是**把主题转化成 9 个不同的种子**。种子不是主题，是一个具体的起点。

### 种子类型

| 类型 | 说明 | 示例 |
|------|------|------|
| 私人记忆 | 从世界观设定中找一个跟主题有关的锚点 | "你爸开了十七年饭馆，攒的钱被骗过一次" |
| 现象 | 一个具体的、跨领域的事实或画面 | "雀尾螳螂虾出拳时海水来不及让开，裂了一个真空泡" |
| 问题 | 一个叙述者真正想搞清楚的问题 | "钱到底做了什么？它把每件事都变干净了" |
| 场景 | 一个具体的时间地点人物 | "2010年5月6日下午2点32分，道琼斯指数在五分钟内跌了600点" |
| 第一句话 | 直接给一个开头 | "我反应慢。" |

每轮 3 个 subagent 的种子必须是**不同类型**。9 个种子覆盖尽可能多的类型。

### 种子生成规则

1. 主 agent 用 WebSearch 搜索 2-3 个跨领域关键词，收集有意思的事实/现象作为现象种子的候选
2. 主 agent 从世界观中识别与主题相关的私人锚点
3. 种子要**具体**。"从个人经历切入"不是种子。"你姑父用三年零花钱买了四万块理财产品"是种子
4. 种子不包含结论。它是一个起点，不是一个论点

## Step 2: RAG 检索

### 2-pre: Ollama 健康检查
```bash
curl -sf http://localhost:11434/api/tags > /dev/null || (ollama serve &>/dev/null & sleep 3)
```

### 2a: 推断标签
```bash
python3 pipeline/scripts/rag_essays.py list-tags
```
根据主题推断 2-4 个相关标签。

### 2b: 检索参考散文

检索 **3 组不同的参考文**，每组 3-5 篇：
```bash
python3 pipeline/scripts/rag_essays.py retrieve --topic "用户主题" --tags "tag_group_1" --limit 5
python3 pipeline/scripts/rag_essays.py retrieve --topic "用户主题" --tags "tag_group_2" --limit 5
python3 pipeline/scripts/rag_essays.py retrieve --topic "用户主题" --tags "tag_group_3" --limit 5
```
分配为 RAG-A、RAG-B、RAG-C，尽量减少重叠。

**不写临时文件。** subagent prompt 中给 ID 列表，subagent 自己用 `sqlite3 content.db "SELECT content_zh FROM stories WHERE id='xxx';"` 读取。

### 2c: 拉取隐喻黑名单
```bash
sqlite3 content.db "SELECT title_zh, description_zh FROM stories ORDER BY date DESC;"
```

## Step 3: 三轮写作（3 轮 × 3 篇 = 9 篇）

固定 **3 轮**，每轮 3 个 subagent 并行，全部保留。

### 文件命名

| 轮次 | 文件命名 | frontmatter round |
|------|----------|-------------------|
| Round 1 | `{id}-v1.md`, `{id}-v2.md`, `{id}-v3.md` | 1 |
| Round 2 | `{id}-r2-v1.md`, `{id}-r2-v2.md`, `{id}-r2-v3.md` | 2 |
| Round 3 | `{id}-r3-v1.md`, `{id}-r3-v2.md`, `{id}-r3-v3.md` | 3 |

### 写作 Prompt

每个 subagent 收到的 prompt：

```
先读这几篇散文，用 sqlite3 content.db "SELECT content_zh FROM stories WHERE id='xxx';" 逐篇读取：
{RAG 参考的 ID 列表，3-4 个}

读完就忘掉内容。不要用里面的任何隐喻、人物、结构、开头方式。
你要吸收的只有一样东西：这些文字读起来是什么感觉。
那个感觉是你的调音叉。校完音，把叉子放下。

动笔之前，用 WebSearch 搜索 1-2 个与种子相关但跨领域的关键词。挑一个有意思的事实记下来。用的时候像自己本来就知道的。

不要用这些词和格式：
{禁用词清单}

不要重复这些已有的隐喻/主题领域：
{隐喻黑名单，每行一篇："标题 — 描述"}

从这里开始写：
{种子}

用 `---` 分段。用中文冒号 `：` 引语，不用引号。
写完用 Write 工具输出到 studio/drafts/{id}-{variant}.md，加 frontmatter：

---
id: {英文slug}
variant: {v1/v2/v3}
round: {轮次}
seed_type: {种子类型：memory/phenomenon/question/scene/opening}
title_zh: {2-4字中文标题}
title_en: {English Title}
description_zh: {一句话中文描述}
description_en: {One sentence English description}
tags: {3-5个英文标签，逗号分隔}
date: {今天日期 YYYY-MM-DD}
---

{中文正文}
```

**就这些。没有风格指南全文，没有世界观全文，没有结构要求，没有人物要求，没有字数限制。**

### 轮次间的避坑传递

Round 2/3 的 subagent prompt 末尾追加：

```
以下隐喻/主题已经被前几轮用过，不要再用：{隐喻名称列表}
避开这些问题：{2-3 个关键词，如"科普腔""对话体访谈""人物传声筒"}
```

只给关键词。**不喂前轮 draft。**

### 轮次流程

```
Round 1: 写 3 篇 → 提取避坑关键词
Round 2: 写 3 篇（带避坑）→ 追加避坑
Round 3: 写 3 篇（带累积避坑）→ 进入 Step 4
```

## Step 4: 审核与交付

### 4a: 禁用词扫描
用 Grep 检查全部 9 篇 draft：
- 然而|因此|诚然|不过|总之|此外|另外|综上所述
- 事实上|值得注意的是|笔者认为|在某种程度上|不可否认
- 岁月如歌|时光荏苒|不经意间|蓦然回首|恍如隔世
- 作为一个
- ！（感叹号）
- ^#|^\*\*|^-\s|^\d+\.\s（markdown 格式）

违规则修复。

### 4a-2: "不是X是Y"句式扫描
用 Grep 检查全部 9 篇 draft 中的"不是...是..."对比句式。每篇允许 **0 处**。全部消灭，改用其他表达方式。

### 4b: 隐喻查重
确认每篇不与数据库已有散文的核心主题/隐喻重复。

### 4c: 交付
展示全部 9 篇：标题 + 种子类型 + 轮次 + 文件路径 + 字数。

**到这里停。不问用户，不主动入库。** 用户准备好了会说"入库"。

---

## Step 5: 入库（用户主动触发）

### 5a: 确认 draft 文件
用户指定文件名，或列出 `studio/drafts/*.md` 让用户选。

### 5b: 禁用词扫描
用户可能改过内容，重新扫一遍。

### 5c: 插入数据库
```bash
python3 pipeline/scripts/rag_essays.py insert --md-file studio/drafts/{filename}.md
```

### 5d: 验证
```bash
sqlite3 content.db "SELECT id, title_zh, length(content_zh) FROM stories WHERE id='{id}';"
```

## 注意事项
- 日期默认今天
- 标签用逗号分隔英文词，3-5 个
- draft 保留在 studio/drafts/，不自动删除
- `/write-essay` 到交付为止，入库是用户主动触发的独立动作

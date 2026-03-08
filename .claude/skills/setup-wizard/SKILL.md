---
name: setup-wizard
description: "交互式引导配置写作声音、世界观和偏好。安装后运行 /setup。"
user_invocable: true
---

# 安装向导

交互式引导用户配置写作声音、世界观和偏好。

## 流程

### Step 1: 检查环境

```bash
# 检查 Ollama
curl -sf http://localhost:11434/api/tags > /dev/null || echo "Ollama not running"

# 检查数据库
python3 init_db.py

# 检查 Playwright
python3 -c "from playwright.async_api import async_playwright; print('OK')" 2>/dev/null || echo "Playwright not installed"
```

报告环境状态。缺什么告诉用户怎么装。

### Step 2: 配置世界观

读取 `.claude/skills/write-essay/references/worldview-template.md`，逐项询问用户：

1. **你的叙述者是什么人？**（年龄、地域、经历）
2. **他熟悉哪些领域？**（3-5 个，写作中会自然引用的知识）
3. **他的人格特质是什么？**（2-3 个核心特质）
4. **有没有已经想好的角色？**（可以跳过）
5. **有什么禁区？**（叙述者不碰的话题）

根据回答填充 worldview-template.md，保存为 `worldview.md`（同目录）。

### Step 3: 风格偏好

问用户：

1. **你更喜欢哪种节奏？**
   - A：短句为主，拳头感（像机关枪）
   - B：长短交替，散文感（像酵头）
   - C：演讲体，直接对读者说话（像站着）

2. **你希望文章有幽默吗？**
   - A：必须有，冷的干的
   - B：偶尔有
   - C：不需要

3. **叙述者的默认视角？**
   - A：第一人称为主
   - B：第三人称为主
   - C：混用

根据回答微调 `style-guide.md` 中的相关段落。

### Step 4: 导入种子文章（可选）

问用户是否有已写好的文章想导入作为声音参考：

```bash
python3 pipeline/scripts/rag_essays.py insert --md-file <path>
```

如果有，导入后建索引：

```bash
python3 pipeline/scripts/rag_essays.py build-index
```

### Step 5: 验证

1. 列出配置摘要
2. 尝试一次 RAG 检索验证系统正常
3. 输出"Setup 完成"和下一步指引

```
Setup 完成。

你的叙述者：{一句话描述}
知识领域：{列表}
风格偏好：{节奏/幽默/视角}
种子文章：{数量}

下一步：
  /write-essay {任意主题}    — 生成 9 篇散文
  /write-anger {任意主题}    — 生成 9 篇怒体散文
  node studio/reader/server.cjs — 启动草稿阅读器
```

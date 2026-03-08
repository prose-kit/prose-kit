# Prose Kit

基于 Claude Code Skill 的散文生成系统。

## Skills

| Skill | 命令 | 说明 |
|-------|------|------|
| setup-wizard | `/setup` | 交互式声音配置 |
| write-essay | `/write-essay [主题]` | 生成 9 篇散文（3 轮 × 3） |

## 常用命令

```bash
# 安装
bash setup.sh

# 生成
# /write-essay 关于速度的代价

# 草稿阅读器
node studio/reader/server.cjs

# RAG 操作
python3 pipeline/scripts/rag_essays.py list-tags
python3 pipeline/scripts/rag_essays.py retrieve --topic "主题" --tags "tag1,tag2"
python3 pipeline/scripts/rag_essays.py insert --md-file studio/drafts/example.md
python3 pipeline/scripts/rag_essays.py build-index
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CONTENT_DB` | `content.db` | SQLite 数据库路径 |
| `OLLAMA_URL` | `http://localhost:11434/api/embeddings` | Ollama 端点 |
| `EMBED_MODEL` | `nomic-embed-text` | 嵌入模型 |
| `READER_PORT` | `3749` | 草稿阅读器端口 |

#!/usr/bin/env python3
"""RAG retrieval and insertion for essay writing workflow.

Uses nomic-embed-text via Ollama for semantic embedding retrieval,
combined with tag-based scoring. Embeddings are stored in the
stories.embedding column in content.db.

Subcommands:
    retrieve    - Find similar essays by topic + tags (embedding + tag hybrid)
    insert      - Insert essay from markdown or JSON into content.db
    list-tags   - Show all unique tags in the corpus
    build-index - Build/rebuild embedding index for all essays
    record-score - Record evaluation scores for a draft
    template-stats - Show performance stats for all style templates
"""
import argparse
import json
import math
import os
import sqlite3
import sys
import urllib.request
from datetime import datetime

DB_PATH = os.environ.get("CONTENT_DB",
    os.path.join(os.path.dirname(__file__), '..', '..', 'content.db'))
OLLAMA_URL = os.environ.get("OLLAMA_URL", 'http://localhost:11434/api/embeddings')
MODEL = os.environ.get("EMBED_MODEL", 'nomic-embed-text')


def parse_tags(tag_str: str) -> set:
    """Handle both 'a,b,c' and '["a","b","c"]' formats."""
    if not tag_str:
        return set()
    tag_str = tag_str.strip()
    if tag_str.startswith('['):
        try:
            return {t.lower().strip() for t in json.loads(tag_str) if isinstance(t, str)}
        except (json.JSONDecodeError, TypeError):
            pass
    return {t.lower().strip() for t in tag_str.split(',') if t.strip()}


def get_embedding(text: str) -> list:
    """Get embedding from Ollama."""
    payload = json.dumps({'model': MODEL, 'prompt': text}).encode()
    req = urllib.request.Request(OLLAMA_URL, data=payload,
                                headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())['embedding']


def cosine_sim(a: list, b: list) -> float:
    """Cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def make_embed_text(row: dict) -> str:
    """Construct text to embed for an essay."""
    parts = []
    if row.get('title_zh'):
        parts.append(row['title_zh'])
    if row.get('description_zh'):
        parts.append(row['description_zh'])
    if row.get('content_zh'):
        parts.append(row['content_zh'][:1500])
    return '\n'.join(parts)


def cmd_build_index(args):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM stories").fetchall()

    count = 0
    for row in rows:
        row = dict(row)
        if row.get('embedding') and not args.force:
            continue
        text = make_embed_text(row)
        if not text:
            continue
        emb = get_embedding(text)
        conn.execute("UPDATE stories SET embedding = ? WHERE id = ?",
                      (json.dumps(emb), row['id']))
        count += 1
        print(f"  embedded: {row['id']} ({row.get('title_zh', '')})", file=sys.stderr)

    conn.commit()
    conn.close()
    print(json.dumps({'status': 'ok', 'new': count, 'total': len(rows)}, ensure_ascii=False))


def cmd_retrieve(args):
    input_tags = parse_tags(args.tags) if args.tags else set()
    query_emb = get_embedding(args.topic)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM stories").fetchall()

    scored = []
    for row in rows:
        row = dict(row)
        essay_id = row['id']

        if row.get('embedding'):
            embed_score = cosine_sim(query_emb, json.loads(row['embedding']))
        else:
            text = make_embed_text(row)
            if text:
                emb = get_embedding(text)
                conn.execute("UPDATE stories SET embedding = ? WHERE id = ?",
                              (json.dumps(emb), essay_id))
                embed_score = cosine_sim(query_emb, emb)
            else:
                embed_score = 0.0

        essay_tags = parse_tags(row['tags'])
        if input_tags and essay_tags:
            tag_score = len(input_tags & essay_tags) / len(input_tags | essay_tags)
        else:
            tag_score = 0.0

        final = 0.6 * embed_score + 0.4 * tag_score
        scored.append((final, embed_score, tag_score, row))

    conn.commit()
    conn.close()

    scored.sort(key=lambda x: x[0], reverse=True)

    results = []
    for final, embed_s, tag_s, row in scored[:args.limit]:
        results.append({
            'id': row['id'],
            'title_zh': row['title_zh'],
            'title_en': row['title_en'],
            'tags': row['tags'],
            'score': round(final, 3),
            'embed_score': round(embed_s, 3),
            'tag_score': round(tag_s, 3),
            'description_zh': row['description_zh'],
            'description_en': row['description_en'],
        })

    output = {
        'query': {'topic': args.topic, 'tags': list(input_tags)},
        'results': results,
        'total_essays': len(rows),
        'retrieved': len(results),
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


def parse_md_frontmatter(path: str) -> dict:
    """Parse a markdown file with YAML-style frontmatter into a data dict."""
    with open(path, 'r', encoding='utf-8') as f:
        text = f.read()
    if not text.startswith('---'):
        print(json.dumps({'error': 'no frontmatter found'}, ensure_ascii=False))
        sys.exit(1)
    end = text.index('---', 3)
    fm_block = text[3:end].strip()
    body = text[end + 3:].strip()
    data = {}
    for line in fm_block.split('\n'):
        if ':' not in line:
            continue
        key, val = line.split(':', 1)
        data[key.strip()] = val.strip()
    data['content_zh'] = body
    return data


def cmd_insert(args):
    if args.md_file:
        data = parse_md_frontmatter(args.md_file)
    elif args.json_file:
        with open(args.json_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    elif args.json:
        data = json.loads(args.json)
    else:
        print(json.dumps({'error': 'provide --md-file, --json-file, or --json'}, ensure_ascii=False))
        sys.exit(1)

    if data.get('round') and data.get('variant'):
        data['id'] = f"{data['id']}-r{data['round']}{data['variant']}"

    required = ['id', 'date', 'tags', 'title_zh', 'description_zh', 'content_zh']
    missing = [k for k in required if not data.get(k)]
    if missing:
        print(json.dumps({'error': f'missing fields: {missing}'}, ensure_ascii=False))
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    now = datetime.now().isoformat()
    conn.execute("""
        INSERT OR REPLACE INTO stories
        (id, date, tags, title_en, description_en, content_en,
         title_zh, description_zh, content_zh, style_template, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data['id'],
        data['date'],
        data['tags'],
        data.get('title_en', ''),
        data.get('description_en', ''),
        data.get('content_en', ''),
        data['title_zh'],
        data['description_zh'],
        data['content_zh'],
        data.get('style_template'),
        now,
        now,
    ))
    conn.commit()
    conn.close()

    # Auto-update embedding
    text = f"{data['title_zh']}\n{data['description_zh']}\n{data['content_zh'][:1500]}"
    try:
        emb = get_embedding(text)
        conn2 = sqlite3.connect(DB_PATH)
        conn2.execute("UPDATE stories SET embedding = ? WHERE id = ?",
                       (json.dumps(emb), data['id']))
        conn2.commit()
        conn2.close()
    except Exception:
        pass  # Ollama might not be running

    print(json.dumps({'status': 'ok', 'id': data['id']}, ensure_ascii=False))


def cmd_list_tags(args):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT tags FROM stories").fetchall()
    conn.close()
    all_tags = set()
    for (tag_str,) in rows:
        all_tags |= parse_tags(tag_str)
    print(json.dumps(sorted(all_tags), ensure_ascii=False))


def cmd_record_score(args):
    """Record a style score for an essay draft."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        INSERT INTO style_scores
        (essay_id, style_template, variant, round, score_total,
         score_metaphor, score_character, score_rhythm, score_depth,
         score_resonance, failure_reason, score_max)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        args.essay_id,
        args.style_template,
        args.variant,
        args.round,
        args.score_total,
        args.score_surprise,    # DB col: score_metaphor, dim: surprise
        args.score_presence,    # DB col: score_character, dim: presence
        args.score_rhythm,
        args.score_depth,
        args.score_resonance,
        args.failure_reason,
        args.score_max,
    ))
    conn.commit()
    conn.close()
    print(json.dumps({
        'status': 'ok',
        'essay_id': args.essay_id,
        'style_template': args.style_template,
        'score_total': args.score_total,
    }, ensure_ascii=False))


def cmd_template_stats(args):
    """Show performance stats for all style templates."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    rows = conn.execute("""
        SELECT
            ss.style_template,
            COUNT(*) as uses,
            ROUND(AVG(ss.score_total), 1) as avg_score,
            MIN(ss.score_total) as min_score,
            MAX(ss.score_total) as max_score,
            ROUND(AVG(ss.score_metaphor), 1) as avg_surprise,
            ROUND(AVG(ss.score_character), 1) as avg_presence,
            ROUND(AVG(ss.score_rhythm), 1) as avg_rhythm,
            ROUND(AVG(ss.score_depth), 1) as avg_depth,
            ROUND(AVG(ss.score_resonance), 1) as avg_resonance
        FROM style_scores ss
        GROUP BY ss.style_template
        ORDER BY avg_score DESC
    """).fetchall()

    results = [dict(r) for r in rows]
    conn.close()
    print(json.dumps(results, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description='RAG for essay writing workflow')
    sub = parser.add_subparsers(dest='command', required=True)

    p_retrieve = sub.add_parser('retrieve', help='Find similar essays')
    p_retrieve.add_argument('--topic', required=True, help='Topic or theme')
    p_retrieve.add_argument('--tags', default='', help='Comma-separated tags')
    p_retrieve.add_argument('--limit', type=int, default=5, help='Max results')

    p_insert = sub.add_parser('insert', help='Insert essay into DB')
    p_insert.add_argument('--md-file', help='Path to markdown file with frontmatter')
    p_insert.add_argument('--json', help='JSON string')
    p_insert.add_argument('--json-file', help='Path to JSON file')

    p_build = sub.add_parser('build-index', help='Build embedding index')
    p_build.add_argument('--force', action='store_true', help='Re-embed all')

    sub.add_parser('list-tags', help='List all unique tags')

    p_score = sub.add_parser('record-score', help='Record style score for a draft')
    p_score.add_argument('--essay-id', required=True, help='Essay ID (slug)')
    p_score.add_argument('--style-template', required=True, help='Style template name')
    p_score.add_argument('--variant', required=True, help='Variant (v1/v2/v3)')
    p_score.add_argument('--round', type=int, default=1, help='Generation round')
    p_score.add_argument('--score-total', type=int, required=True, help='Total score (0-25)')
    p_score.add_argument('--score-max', type=int, default=25, help='Max possible score')
    p_score.add_argument('--score-presence', type=int, default=0)
    p_score.add_argument('--score-surprise', type=int, default=0)
    p_score.add_argument('--score-rhythm', type=int, default=0)
    p_score.add_argument('--score-depth', type=int, default=0)
    p_score.add_argument('--score-resonance', type=int, default=0)
    p_score.add_argument('--failure-reason', default=None)

    sub.add_parser('template-stats', help='Show style template performance stats')

    args = parser.parse_args()
    cmds = {
        'retrieve': cmd_retrieve,
        'insert': cmd_insert,
        'build-index': cmd_build_index,
        'list-tags': cmd_list_tags,
        'record-score': cmd_record_score,
        'template-stats': cmd_template_stats,
    }
    cmds[args.command](args)


if __name__ == '__main__':
    main()

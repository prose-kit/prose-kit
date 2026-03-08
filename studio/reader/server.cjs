const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(process.env.PROJECT_ROOT || path.join(__dirname, "..", ".."));
const draftsPath = path.join(ROOT, "studio", "drafts");
const dbPath = process.env.CONTENT_DB || path.join(ROOT, "content.db");
const PORT = parseInt(process.env.READER_PORT || "3749", 10);

// Ensure drafts directory exists
if (!fs.existsSync(draftsPath)) fs.mkdirSync(draftsPath, { recursive: true });

// Ensure score_max column exists
try { execSync(`sqlite3 "${dbPath}" "ALTER TABLE style_scores ADD COLUMN score_max INTEGER DEFAULT 25;"`, { encoding: "utf-8" }); } catch {}

function getScores() {
  try {
    const out = execSync(
      `sqlite3 -json "${dbPath}" "SELECT essay_id, style_template, variant, round, score_total, score_metaphor, score_character, score_rhythm, score_depth, score_resonance, score_max, failure_reason FROM style_scores ORDER BY essay_id, round, variant"`,
      { encoding: "utf-8" }
    );
    return JSON.parse(out);
  } catch { return []; }
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  match[1].split("\n").forEach((line) => {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      meta[key] = val;
    }
  });
  return { meta, body: match[2] };
}

function baseIdFromFilename(f) {
  const base = f.replace(/\.fav\.md$/, "").replace(/\.md$/, "");
  const rMatch = base.match(/-r(\d+)-v(\d+)/);
  if (rMatch) {
    const prefix = base.slice(0, base.indexOf("-r" + rMatch[1]));
    return { id: prefix, round: rMatch[1], variant: "v" + rMatch[2] };
  }
  const vMatch = base.match(/-v(\d+)/);
  if (vMatch) {
    const prefix = base.slice(0, base.indexOf("-v" + vMatch[1]));
    return { id: prefix, round: "1", variant: "v" + vMatch[1] };
  }
  return null;
}

function getDrafts() {
  if (!fs.existsSync(draftsPath)) return [];
  const files = fs.readdirSync(draftsPath).filter((f) => f.endsWith(".md"));
  const allScores = getScores();
  return files.map((f) => {
    const content = fs.readFileSync(path.join(draftsPath, f), "utf-8");
    const { meta, body } = parseFrontmatter(content);
    const stats = fs.statSync(path.join(draftsPath, f));
    const fav = f.endsWith(".fav.md");
    let scores = allScores.filter(
      (s) => s.essay_id === meta.id && s.variant === meta.variant && String(s.round) === String(meta.round)
    );
    if (!scores.length) {
      const fb = baseIdFromFilename(f);
      if (fb) {
        scores = allScores.filter(
          (s) => s.essay_id === fb.id && s.variant === fb.variant && String(s.round) === String(fb.round)
        );
      }
    }
    return {
      filename: f,
      meta,
      body,
      fav,
      wordCount: body.replace(/\s/g, "").length,
      modifiedAt: stats.mtime.toISOString(),
      scores,
    };
  });
}

function promoteDraft(filename) {
  const fp = path.join(draftsPath, filename);
  if (!fs.existsSync(fp)) throw new Error("File not found: " + filename);
  const content = fs.readFileSync(fp, "utf-8");
  const { meta, body } = parseFrontmatter(content);
  const required = ["id", "date", "tags", "title_zh", "description_zh"];
  const missing = required.filter((k) => !meta[k]);
  if (missing.length) throw new Error("Missing frontmatter: " + missing.join(", "));

  const tagsArr = meta.tags.split(",").map((t) => t.trim()).filter(Boolean);
  const tagsJson = JSON.stringify(tagsArr);

  const esc = (s) => (s || "").replace(/'/g, "''");
  const now = new Date().toISOString();
  const sql = `INSERT OR REPLACE INTO stories (id, date, tags, title_zh, title_en, description_zh, description_en, content_zh, style_template, created_at, updated_at) VALUES ('${esc(meta.id)}', '${esc(meta.date)}', '${esc(tagsJson)}', '${esc(meta.title_zh)}', '${esc(meta.title_en || "")}', '${esc(meta.description_zh)}', '${esc(meta.description_en || "")}', '${esc(body)}', '${esc(meta.style_template || "")}', COALESCE((SELECT created_at FROM stories WHERE id='${esc(meta.id)}'), '${now}'), '${now}');\n`;
  const tmpSql = path.join(require("os").tmpdir(), "promote-" + Date.now() + ".sql");
  fs.writeFileSync(tmpSql, sql, "utf-8");
  try {
    execSync(`sqlite3 "${dbPath}" < "${tmpSql}"`, { encoding: "utf-8" });
  } finally {
    try { fs.unlinkSync(tmpSql); } catch {}
  }
  return meta.id;
}

const HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Draft Reader</title>
<style>
  :root {
    --bg: #fafaf8;
    --card: #fff;
    --text: #1a1a1a;
    --text2: #666;
    --text3: #999;
    --border: #e8e8e4;
    --accent: #c0392b;
    --accent-hover: #a93226;
    --tag-bg: #f0eeeb;
    --tag-text: #555;
    --sidebar-w: 320px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "Noto Serif SC", "Source Han Serif CN", "Songti SC", Georgia, serif;
    background: var(--bg);
    color: var(--text);
    height: 100vh;
    overflow: hidden;
  }
  .layout { display: flex; height: 100vh; }
  .sidebar {
    width: var(--sidebar-w);
    min-width: var(--sidebar-w);
    border-right: 1px solid var(--border);
    background: var(--card);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .sidebar-header {
    padding: 24px 20px 16px;
    border-bottom: 1px solid var(--border);
  }
  .sidebar-header h1 { font-size: 16px; font-weight: 600; letter-spacing: 0.5px; }
  .sidebar-header .header-row { display: flex; align-items: center; justify-content: space-between; }
  .sidebar-header .count { font-size: 12px; color: var(--text3); margin-top: 4px; font-family: -apple-system, sans-serif; }
  .filter-fav { font-size: 18px; cursor: pointer; opacity: 0.3; transition: opacity 0.15s; user-select: none; }
  .filter-fav:hover { opacity: 0.6; }
  .filter-fav.on { opacity: 1; color: #e67e22; }
  .fav-star { cursor: pointer; font-size: 14px; opacity: 0.25; transition: opacity 0.15s; user-select: none; margin-right: 4px; }
  .fav-star:hover { opacity: 0.7; }
  .fav-star.on { opacity: 1; color: #e67e22; }
  .btn-fav {
    font-family: -apple-system, sans-serif; font-size: 18px; padding: 4px 8px;
    background: none; border: 1px solid var(--border); border-radius: 4px;
    cursor: pointer; transition: all 0.15s; line-height: 1; opacity: 0.4;
  }
  .btn-fav:hover { opacity: 0.7; }
  .btn-fav.on { opacity: 1; color: #e67e22; border-color: #e67e22; }
  .draft-list { flex: 1; overflow-y: auto; padding: 8px 0; }
  .draft-item { padding: 14px 20px; cursor: pointer; border-bottom: 1px solid #f0f0ec; transition: background 0.15s; }
  .draft-item:hover { background: #f7f7f4; }
  .draft-item.active { background: #f0eeeb; }
  .draft-item .title { font-size: 15px; font-weight: 500; line-height: 1.4; margin-bottom: 4px; }
  .draft-item .subtitle { font-size: 12px; color: var(--text3); font-family: -apple-system, sans-serif; }
  .reader { flex: 1; overflow-y: auto; }
  .reader-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text3); font-size: 15px; }
  .reader-content { max-width: 680px; margin: 0 auto; padding: 48px 40px 120px; }
  .reader-content .meta-bar { margin-bottom: 40px; padding-bottom: 24px; border-bottom: 1px solid var(--border); }
  .reader-content .essay-title { font-size: 28px; font-weight: 700; line-height: 1.35; margin-bottom: 8px; }
  .reader-content .essay-title-en { font-size: 14px; color: var(--text3); font-family: -apple-system, sans-serif; margin-bottom: 16px; font-style: italic; }
  .reader-content .desc { font-size: 15px; color: var(--text2); line-height: 1.6; margin-bottom: 16px; }
  .meta-row { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 12px; font-family: -apple-system, "SF Mono", monospace; color: var(--text3); margin-bottom: 10px; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag { font-size: 11px; font-family: -apple-system, sans-serif; padding: 2px 8px; background: var(--tag-bg); color: var(--tag-text); border-radius: 3px; }
  .essay-body { font-size: 17px; line-height: 1.9; letter-spacing: 0.02em; outline: none; }
  .essay-body:focus { background: #fdfdfb; }
  .essay-body p { margin-bottom: 1em; }
  .save-status { font-size: 11px; font-family: -apple-system, sans-serif; color: var(--text3); transition: opacity 0.3s; }
  .save-status.saving { color: #e67e22; }
  .save-status.saved { color: #27ae60; }
  .essay-body hr { border: none; text-align: center; margin: 2em 0; color: var(--text3); }
  .essay-body hr::after { content: "* * *"; font-size: 14px; letter-spacing: 6px; }
  .actions {
    position: fixed; bottom: 32px; right: 40px; display: flex; gap: 12px; align-items: center;
    background: var(--card); padding: 10px 16px; border-radius: 8px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08); border: 1px solid var(--border); z-index: 50;
  }
  .btn-promote {
    font-family: -apple-system, sans-serif; font-size: 13px; padding: 8px 16px;
    background: none; color: #27ae60; border: 1px solid #27ae60; border-radius: 4px;
    cursor: pointer; transition: all 0.15s;
  }
  .btn-promote:hover { background: #27ae60; color: #fff; }
  .btn-delete {
    font-family: -apple-system, sans-serif; font-size: 13px; padding: 8px 20px;
    background: none; color: var(--accent); border: 1px solid var(--accent); border-radius: 4px;
    cursor: pointer; transition: all 0.15s;
  }
  .btn-delete:hover { background: var(--accent); color: #fff; }
  .actions-sep { width: 1px; height: 20px; background: var(--border); }
  .filename-label { font-size: 12px; font-family: "SF Mono", "Menlo", monospace; color: var(--text3); }
  .confirm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .confirm-box { background: var(--card); border-radius: 8px; padding: 28px 32px; max-width: 360px; box-shadow: 0 8px 30px rgba(0,0,0,0.12); }
  .confirm-box p { font-size: 15px; margin-bottom: 6px; line-height: 1.5; }
  .confirm-box .fname { font-family: "SF Mono", monospace; font-size: 13px; color: var(--accent); margin-bottom: 20px; }
  .confirm-actions { display: flex; gap: 10px; justify-content: flex-end; }
  .confirm-actions button { font-family: -apple-system, sans-serif; font-size: 13px; padding: 7px 18px; border-radius: 4px; cursor: pointer; border: 1px solid var(--border); background: var(--card); color: var(--text); }
  .confirm-actions .confirm-delete { background: var(--accent); color: #fff; border-color: var(--accent); }
  .toggle-sidebar { position: fixed; top: 16px; left: 16px; z-index: 60; width: 36px; height: 36px; border-radius: 8px; border: 1px solid var(--border); background: var(--card); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px; color: var(--text2); box-shadow: 0 1px 4px rgba(0,0,0,0.06); font-family: -apple-system, sans-serif; }
  .toggle-sidebar:hover { background: #f0eeeb; }
  .sidebar.hidden { display: none; }
  @media (max-width: 768px) {
    .sidebar { position: fixed; left: 0; top: 0; bottom: 0; z-index: 70; box-shadow: 4px 0 20px rgba(0,0,0,0.1); width: 85vw; min-width: 85vw; transform: translateX(0); transition: transform 0.25s; }
    .sidebar.hidden { display: flex; transform: translateX(-100%); }
    .reader-content { padding: 48px 20px 100px; }
    .essay-body { font-size: 16px; }
    .reader-content .essay-title { font-size: 22px; }
    .actions { right: 16px; bottom: 20px; }
  }
  .toast { position: fixed; bottom: 32px; left: 50%; transform: translateX(-50%); font-family: -apple-system, sans-serif; font-size: 13px; padding: 10px 24px; background: var(--text); color: #fff; border-radius: 6px; opacity: 0; transition: opacity 0.3s; z-index: 200; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
<button class="toggle-sidebar" onclick="toggleSidebar()">&#9776;</button>
<div class="layout">
  <div class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <div class="header-row">
        <h1>Draft Reader</h1>
        <span class="filter-fav" id="filter-fav" onclick="toggleFilter()" title="Show favorites only">&#9733;</span>
      </div>
      <div class="count" id="count"></div>
    </div>
    <div class="draft-list" id="list"></div>
  </div>
  <div class="reader" id="reader">
    <div class="reader-empty">Select a draft to read</div>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
let drafts = [];
let activeIdx = -1;
let filterFav = false;

async function load() {
  const res = await fetch("/api/drafts");
  drafts = await res.json();
  renderList();
  if (drafts.length > 0 && activeIdx === -1) select(0);
}

function renderList() {
  const el = document.getElementById("list");
  const favCount = drafts.filter(d => d.fav).length;
  const shown = filterFav ? drafts.filter(d => d.fav) : drafts;
  document.getElementById("count").textContent = filterFav
    ? favCount + " favorites"
    : drafts.length + " drafts" + (favCount ? " / " + favCount + " fav" : "");
  document.getElementById("filter-fav").className = "filter-fav" + (filterFav ? " on" : "");
  el.innerHTML = shown.map((d) => {
    const i = drafts.indexOf(d);
    const title = d.meta.title_zh || d.meta.id || d.filename;
    const round = d.meta.round ? "r" + d.meta.round : "";
    const variant = d.meta.variant || "";
    const sub = [round, variant].filter(Boolean).join(" / ");
    const sc = d.scores && d.scores.length ? d.scores[0].score_total : null;
    const scMax = d.scores && d.scores.length ? (d.scores[0].score_max || 25) : 25;
    const scHtml = sc !== null ? ' <span style="color:' + (sc >= scMax * 0.84 ? '#27ae60' : sc >= scMax * 0.76 ? '#e67e22' : '#c0392b') + ';font-weight:600">' + sc + '/' + scMax + '</span>' : '';
    const star = '<span class="fav-star' + (d.fav ? ' on' : '') + '" onclick="event.stopPropagation();toggleFav(' + i + ')">&#9733;</span>';
    return '<div class="draft-item' + (i === activeIdx ? " active" : "") + '" onclick="select(' + i + ')">' +
      '<div class="title">' + star + esc(title) + scHtml + '</div>' +
      '<div class="subtitle">' + esc(sub) + '</div></div>';
  }).join("");
}

function toggleFilter() { filterFav = !filterFav; renderList(); }

async function toggleFav(i) {
  const d = drafts[i];
  if (!d) return;
  const res = await fetch("/api/fav", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ filename: d.filename }) });
  if (res.ok) {
    const result = await res.json();
    d.filename = result.filename;
    d.fav = result.fav;
    renderList();
    if (i === activeIdx) {
      const favBtn = document.querySelector('.actions .btn-fav');
      if (favBtn) { favBtn.className = 'btn-fav' + (d.fav ? ' on' : ''); }
      const fnLabel = document.querySelector('.filename-label');
      if (fnLabel) fnLabel.textContent = d.filename;
    }
    toast(result.fav ? "Favorited" : "Unfavorited");
  }
}

function select(i) {
  activeIdx = i;
  renderList();
  renderReader(drafts[i]);
  if (window.innerWidth <= 768) document.getElementById("sidebar").classList.add("hidden");
}

async function promoteToDb() {
  const d = drafts[activeIdx];
  if (!d) return;
  try {
    const res = await fetch("/api/promote", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ filename: d.filename }) });
    if (res.ok) { const r = await res.json(); toast("Promoted: " + r.id); }
    else { const t = await res.text(); toast("Error: " + t); }
  } catch (e) { toast("Error: " + e.message); }
}

function renderReader(d) {
  const el = document.getElementById("reader");
  const title = d.meta.title_zh || d.meta.id || d.filename;
  const titleEn = d.meta.title_en || "";
  const desc = d.meta.description_zh || "";
  const tags = (d.meta.tags || "").split(",").map(t => t.trim()).filter(Boolean);
  const date = d.meta.date || "";
  const round = d.meta.round || "";
  const variant = d.meta.variant || "";

  const bodyHtml = d.body
    .split("\\n---\\n")
    .map(section => section.split("\\n\\n")
      .map(p => p.trim()).filter(Boolean)
      .map(p => "<p>" + esc(p).replace(/\\n/g, "<br>") + "</p>")
      .join("")
    ).join("<hr>");

  el.innerHTML = '<div class="reader-content">' +
    '<div class="meta-bar">' +
    '<div class="essay-title">' + esc(title) + '</div>' +
    (titleEn ? '<div class="essay-title-en">' + esc(titleEn) + '</div>' : '') +
    (desc ? '<div class="desc">' + esc(desc) + '</div>' : '') +
    '<div class="meta-row">' +
    (date ? '<span>' + esc(date) + '</span>' : '') +
    (round ? '<span>round: ' + esc(round) + '</span>' : '') +
    (variant ? '<span>variant: ' + esc(variant) + '</span>' : '') +
    '<span>' + d.wordCount + ' chars</span></div>' +
    (tags.length ? '<div class="tags">' + tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : '') +
    renderScores(d.scores) +
    '</div>' +
    '<div class="essay-body" contenteditable="true" id="editable-body">' + bodyHtml + '</div>' +
    '<div class="actions">' +
    '<span class="save-status" id="save-status"></span>' +
    '<button class="btn-promote" onclick="promoteToDb()">Promote to DB</button>' +
    '<div class="actions-sep"></div>' +
    '<button class="btn-fav' + (d.fav ? ' on' : '') + '" onclick="toggleFav(' + activeIdx + ')">&#9733;</button>' +
    '<button class="btn-delete" onclick="confirmDelete(\'' + esc(d.filename) + '\')">Delete</button>' +
    '<span class="filename-label">' + esc(d.filename) + '</span>' +
    '</div></div>';
  el.scrollTop = 0;
}

function confirmDelete(filename) {
  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  overlay.id = "confirm";
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = '<div class="confirm-box"><p>Delete this draft?</p>' +
    '<div class="fname">' + esc(filename) + '</div>' +
    '<div class="confirm-actions">' +
    '<button onclick="document.getElementById(\'confirm\').remove()">Cancel</button>' +
    '<button class="confirm-delete" onclick="doDelete(\'' + esc(filename) + '\')">Delete</button>' +
    '</div></div>';
  document.body.appendChild(overlay);
}

async function doDelete(filename) {
  const el = document.getElementById("confirm");
  if (el) el.remove();
  const res = await fetch("/api/delete", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({filename}) });
  if (res.ok) {
    toast("Deleted");
    const wasIdx = activeIdx;
    activeIdx = -1;
    await load();
    if (drafts.length > 0) select(Math.min(wasIdx, drafts.length - 1));
    else document.getElementById("reader").innerHTML = '<div class="reader-empty">No drafts</div>';
  } else { toast("Delete failed"); }
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2000);
}

function renderScores(scores) {
  if (!scores || !scores.length) return '';
  const dims = [
    { key: 'score_metaphor', label: 'presence' },
    { key: 'score_character', label: 'surprise' },
    { key: 'score_rhythm', label: 'rhythm' },
    { key: 'score_depth', label: 'depth' },
    { key: 'score_resonance', label: 'resonance' },
  ];
  return scores.map(s => {
    const maxScore = s.score_max || 25;
    const maxDim = maxScore / 5;
    const bars = dims.map(d => {
      const v = s[d.key];
      const pct = (v / maxDim) * 100;
      const color = v >= maxDim * 0.9 ? '#27ae60' : v >= maxDim * 0.7 ? '#e67e22' : '#c0392b';
      return '<div style="display:flex;align-items:center;gap:6px;font-size:12px;font-family:-apple-system,sans-serif">' +
        '<span style="width:60px;color:#999;text-align:right">' + d.label + '</span>' +
        '<div style="flex:1;height:6px;background:#eee;border-radius:3px;overflow:hidden">' +
        '<div style="width:' + pct + '%;height:100%;background:' + color + ';border-radius:3px"></div></div>' +
        '<span style="width:16px;color:#666;font-size:11px">' + v + '</span></div>';
    }).join('');
    const totalColor = s.score_total >= maxScore * 0.84 ? '#27ae60' : s.score_total >= maxScore * 0.76 ? '#e67e22' : '#c0392b';
    return '<div style="margin-top:16px;padding:12px 0">' +
      '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">' +
      '<span style="font-size:24px;font-weight:700;color:' + totalColor + ';font-family:-apple-system,sans-serif">' + s.score_total + '</span>' +
      '<span style="font-size:12px;color:#999;font-family:-apple-system,sans-serif">/' + maxScore + ' r' + s.round + '</span></div>' +
      '<div style="display:flex;flex-direction:column;gap:4px">' + bars + '</div>' +
      (s.failure_reason ? '<div style="margin-top:8px;font-size:12px;color:#999">' + esc(s.failure_reason) + '</div>' : '') +
      '</div>';
  }).join('');
}

let saveTimer = null;
function onBodyEdit() {
  const status = document.getElementById("save-status");
  if (status) { status.textContent = "editing..."; status.className = "save-status"; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveBody(), 800);
}

async function saveBody() {
  const d = drafts[activeIdx];
  if (!d) return;
  const status = document.getElementById("save-status");
  const el = document.getElementById("editable-body");
  if (!el) return;
  const body = htmlToMd(el);
  if (status) { status.textContent = "saving..."; status.className = "save-status saving"; }
  const res = await fetch("/api/save", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ filename: d.filename, content: body }) });
  if (res.ok) {
    d.body = body;
    d.wordCount = body.replace(/\\s/g, "").length;
    if (status) { status.textContent = "saved"; status.className = "save-status saved"; }
    setTimeout(() => { if (status) status.textContent = ""; }, 2000);
  } else {
    if (status) { status.textContent = "save failed"; status.className = "save-status"; }
  }
}

function htmlToMd(el) {
  const sections = [];
  let current = [];
  for (const node of el.childNodes) {
    if (node.nodeName === "HR") { sections.push(current.join("\\n\\n")); current = []; }
    else if (node.nodeName === "P") { const t = node.innerText.trim(); if (t) current.push(t); }
    else if (node.nodeType === 3) { const t = node.textContent.trim(); if (t) current.push(t); }
  }
  if (current.length) sections.push(current.join("\\n\\n"));
  return sections.join("\\n\\n---\\n\\n");
}

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function toggleSidebar() { document.getElementById("sidebar").classList.toggle("hidden"); }

load();
if (window.innerWidth <= 768) document.getElementById("sidebar").classList.add("hidden");
document.addEventListener("input", (e) => { if (e.target.closest("#editable-body")) onBodyEdit(); });
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/drafts") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getDrafts()));
  } else if (req.method === "POST" && req.url === "/api/save") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { filename, content } = JSON.parse(body);
        if (!filename || filename.includes("/") || filename.includes("..")) {
          res.writeHead(400); return res.end("bad filename");
        }
        const fp = path.join(draftsPath, filename);
        if (!fs.existsSync(fp)) { res.writeHead(404); return res.end("not found"); }
        const original = fs.readFileSync(fp, "utf-8");
        const fmMatch = original.match(/^(---\n[\s\S]*?\n---\n)/);
        const frontmatter = fmMatch ? fmMatch[1] : "";
        fs.writeFileSync(fp, frontmatter + content, "utf-8");
        res.writeHead(200); res.end("ok");
      } catch (e) { res.writeHead(500); res.end(e.message); }
    });
  } else if (req.method === "POST" && req.url === "/api/fav") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { filename } = JSON.parse(body);
        if (!filename || filename.includes("/") || filename.includes("..")) {
          res.writeHead(400); return res.end("bad filename");
        }
        const fp = path.join(draftsPath, filename);
        if (!fs.existsSync(fp)) { res.writeHead(404); return res.end("not found"); }
        const isFav = filename.endsWith(".fav.md");
        const newName = isFav ? filename.replace(/\.fav\.md$/, ".md") : filename.replace(/\.md$/, ".fav.md");
        fs.renameSync(fp, path.join(draftsPath, newName));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ filename: newName, fav: !isFav }));
      } catch (e) { res.writeHead(500); res.end(e.message); }
    });
  } else if (req.method === "POST" && req.url === "/api/promote") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { filename } = JSON.parse(body);
        if (!filename || filename.includes("/") || filename.includes("..")) {
          res.writeHead(400); return res.end("bad filename");
        }
        const id = promoteDraft(filename);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", id }));
      } catch (e) { res.writeHead(400); res.end(e.message); }
    });
  } else if (req.method === "POST" && req.url === "/api/delete") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { filename } = JSON.parse(body);
        if (!filename || filename.includes("/") || filename.includes("..")) {
          res.writeHead(400); return res.end("bad filename");
        }
        const fp = path.join(draftsPath, filename);
        if (!fs.existsSync(fp)) { res.writeHead(404); return res.end("not found"); }
        fs.unlinkSync(fp);
        res.writeHead(200); res.end("ok");
      } catch (e) { res.writeHead(500); res.end(e.message); }
    });
  } else {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);
  }
});

server.listen(PORT, () => {
  console.log(`Draft Reader running at http://localhost:${PORT}`);
});

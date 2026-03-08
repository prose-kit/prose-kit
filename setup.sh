#!/bin/bash
set -e

echo "=== Prose Kit - Setup ==="
echo ""

# 1. Check prerequisites
echo "[1/5] Checking prerequisites..."

if ! command -v python3 &>/dev/null; then
    echo "ERROR: python3 not found. Install Python 3.10+ first."
    exit 1
fi

if ! command -v node &>/dev/null; then
    echo "ERROR: node not found. Install Node.js 18+ first."
    exit 1
fi

echo "  python3: $(python3 --version)"
echo "  node: $(node --version)"

# 2. Install Ollama + embedding model
echo ""
echo "[2/5] Setting up Ollama for RAG embeddings..."

if ! command -v ollama &>/dev/null; then
    echo "  Ollama not found. Installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "  Download from https://ollama.com/download and install."
        echo "  Then re-run this script."
        exit 1
    else
        curl -fsSL https://ollama.com/install.sh | sh
    fi
fi

# Start Ollama if not running
if ! curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "  Starting Ollama..."
    ollama serve &>/dev/null &
    sleep 3
fi

echo "  Pulling nomic-embed-text model (~274MB)..."
ollama pull nomic-embed-text

# 3. Initialize database
echo ""
echo "[3/5] Initializing database..."
python3 init_db.py

# 4. Load example data (if no existing essays)
echo ""
echo "[4/5] Checking for seed essays..."
COUNT=$(sqlite3 content.db "SELECT COUNT(*) FROM stories;" 2>/dev/null || echo "0")
if [ "$COUNT" = "0" ] && [ -f content.db.example ]; then
    echo "  No essays found. Loading example data..."
    cp content.db.example content.db
    echo "  Loaded example essays."
else
    echo "  Found $COUNT essays in database."
fi

# 5. Create directories
echo ""
echo "[5/5] Creating directories..."
mkdir -p studio/drafts

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Run '/setup' in Claude Code to configure your writing voice"
echo "  2. Import your own essays: python3 pipeline/scripts/rag_essays.py insert --md-file <path>"
echo "  3. Write your first essay: /write-essay [topic]"
echo ""
echo "Start the draft reader:"
echo "  node studio/reader/server.cjs"
echo "  Open http://localhost:3749"
echo ""

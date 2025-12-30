#!/bin/bash
# Development script for MCP Gateway
# Runs the server in development mode with hot reloading

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Check if config exists, if not create from example
if [ ! -f "config.yaml" ]; then
  echo "Creating default config.yaml..."
  cat > config.yaml << 'EOF'
# MCP Gateway Development Configuration
server:
  transport: stdio

policy:
  default_deny: true
  allow_tools:
    - fs.readFile
    - fs.listDir
  per_tool:
    fs.readFile:
      allow: true
      max_bytes: 1048576  # 1MB
      timeout_ms: 5000
    fs.listDir:
      allow: true
      timeout_ms: 5000

audit:
  enabled: true

connectors:
  filesystem:
    enabled: true
    allowed_paths:
      - ./
    max_file_size: 5242880  # 5MB

  http_fetch:
    enabled: false

  postgres:
    enabled: false

actor: dev-user
log_level: debug
EOF
fi

# Run in development mode
echo "Starting MCP Gateway in development mode..."
echo "Config: $PROJECT_DIR/config.yaml"
echo ""

npm run dev

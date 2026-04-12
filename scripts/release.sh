#!/bin/bash

# SignalZero Desktop Release Script
# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 1.1.5

VERSION=$1

if [ -z "$VERSION" ]; then
    echo "❌ Error: No version specified."
    echo "Usage: ./scripts/release.sh <version>"
    exit 1
fi

# 0. Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo "❌ Error: You have uncommitted changes. Please commit or stash them first."
    exit 1
fi

echo "🚀 Starting release process for v$VERSION..."

# 1. Update version in package.json
echo "📝 Updating package.json..."
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json

# 2. Update version in projectService.ts
echo "📝 Updating projectService.ts..."
sed -i '' "s/version: '[^']*'/version: '$VERSION'/g" src/main/services/projectService.ts

# 3. Build the macOS DMG
echo "🏗️  Building macOS DMG (this may take a few minutes)..."
npm run build:mac

DMG_FILE="dist/Signal Zero-$VERSION-arm64.dmg"

if [ ! -f "$DMG_FILE" ]; then
    echo "❌ Error: DMG file not found at $DMG_FILE"
    exit 1
fi

# 4. Calculate SHA256
echo "🔍 Calculating SHA256..."
SHA256=$(shasum -a 256 "$DMG_FILE" | awk '{print $1}')
echo "Hash: $SHA256"

# 5. Update Homebrew Cask
echo "🍺 Updating Homebrew Cask..."
sed -i '' "s/version \".*\"/version \"$VERSION\"/" Casks/signalzero-desktop.rb
sed -i '' "s/sha256 \".*\"/sha256 \"$SHA256\"/" Casks/signalzero-desktop.rb

# 6. Git Commit & Push
echo "💾 Committing and pushing changes..."
git add package.json src/main/services/projectService.ts Casks/signalzero-desktop.rb
git commit -m "chore: release v$VERSION"
git push origin main

# 7. Create GitHub Release
echo "📦 Creating GitHub release and uploading DMG..."

RELEASE_NOTES="### 💠 Signal Zero v$VERSION - The Efficiency Update

This release focuses on optimizing the kernel's autonomous reasoning engine and structural integrity.

#### 🤖 Autonomous Agent Evolution
- **Winner-Takes-All (WTA) Routing**: Incoming world deltas are now intelligently routed to the SINGLE most appropriate agent based on subscription relevance, eliminating redundant GPU cycles.
- **Batched Execution Heartbeat**: Agents now operate on a 5-minute 'Batch Round' cycle. Multiple routed events are synthesized into a single, comprehensive reasoning turn rather than triggering individual inferences.

#### ♻️ Graph Hygiene Enhancements
- **Symbol Domain Refactor**: New background task that automatically normalizes symbol IDs (uppercasing/sanitization) and uses AI to relocate symbols into their most semantically appropriate domains.
- **Relational Integrity**: Improved `renameSymbol` and `relocateSymbol` logic ensuring all links and vector embeddings are preserved during graph self-organization.

#### 🏗️ System & UI
- **Signal Zero Rebranding**: Unified all UI labels, window titles, and binary naming under the clean 'Signal Zero' brand.
- **Agent Audit Restoration**: Fixed data mapping for timestamps, trace counts, and response previews in the Agent Orchestrator history.
- **Boot Diagnostics**: Added a comprehensive startup diagnostic sequence to verify native dependency integrity (LanceDB, SQLite, Arrow) in production bundles.
- **Startup Resilience**: Implemented a 5-second 'warm-up' delay for monitoring services to prevent OS-level network jitters during boot."

gh release create "v$VERSION" "$DMG_FILE" --title "v$VERSION" --notes "$RELEASE_NOTES"

echo "✅ Release v$VERSION successfully deployed and live on Homebrew!"

#!/bin/bash

# SignalZero Sample Project Builder
# This script bundles the sample_project directory into the .szproject zip archive
# for distribution and development.

set -e

PROJECT_ROOT=$(pwd)
SOURCE_DIR="sample_project"
TARGET_FILE="signalzero_sample.szproject"

echo "🏗️  Building Sample Project: $TARGET_FILE..."

if [ ! -d "$SOURCE_DIR" ]; then
    echo "❌ Error: Source directory $SOURCE_DIR not found."
    exit 1
fi

# Remove old project if it exists
rm -f "$TARGET_FILE"

# Zip the contents of the directory
# -j: junk (don't record) directory names, but we want the structure inside sample_project
# So we cd into it
(cd "$SOURCE_DIR" && zip -r "../$TARGET_FILE" . -x "*.DS_Store*")

echo "✅ Sample Project built successfully."

#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$DIR/../.." && pwd )"

MODEL_SRC="/Users/klietus/.lmstudio/models/lmstudio-community/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q8_0.gguf"
MODEL_DEST="$PROJECT_ROOT/models/Qwen3.5-0.8B-Q8_0.gguf"

MMPROJ_SRC="/Users/klietus/.lmstudio/models/lmstudio-community/Qwen3.5-0.8B-GGUF/mmproj-Qwen3.5-0.8B-BF16.gguf"
MMPROJ_DEST="$PROJECT_ROOT/models/mmproj-Qwen3.5-0.8B-BF16.gguf"

mkdir -p "$PROJECT_ROOT/models"

# Clean up old links
rm -f "$PROJECT_ROOT/models/Qwen3.5-2B-Q4_K_M.gguf"
rm -f "$PROJECT_ROOT/models/mmproj-Qwen3.5-2B-BF16.gguf"

if [ -f "$MODEL_SRC" ]; then
    echo "Linking model from $MODEL_SRC to $MODEL_DEST"
    ln -sf "$MODEL_SRC" "$MODEL_DEST"
else
    echo "Error: Model not found at $MODEL_SRC"
    exit 1
fi

if [ -f "$MMPROJ_SRC" ]; then
    echo "Linking mmproj from $MMPROJ_SRC to $MMPROJ_DEST"
    ln -sf "$MMPROJ_SRC" "$MMPROJ_DEST"
else
    echo "Error: MMPROJ not found at $MMPROJ_SRC"
    exit 1
fi

echo "Setup complete."

#!/bin/bash
# setup.sh - Installs dependencies for the vision sidecar

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Assuming we want to use the same portable python if it exists in sidecars/voice
VOICE_PYTHON="../../sidecars/voice/python-portable/bin/python3"

if [ -f "$VOICE_PYTHON" ]; then
    PYTHON_EXE="$VOICE_PYTHON"
    echo "Using shared portable Python from voice sidecar."
else
    PYTHON_EXE="python3"
    echo "Portable Python not found. Using system python3."
fi

echo "Installing Vision dependencies..."
"$PYTHON_EXE" -m pip install -r "$DIR/requirements.txt"

echo "Vision dependencies installed."

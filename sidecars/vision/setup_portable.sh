#!/bin/bash
# setup_portable.sh - Bundles a portable Python environment for the vision sidecar

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TARGET_DIR="${DIR}/python-portable"
DEPS_DIR="${DIR}/deps"

# Check if we should share the voice sidecar's python to save space
VOICE_PORTABLE_DIR="${DIR}/../voice/python-portable"

if [ -d "$VOICE_PORTABLE_DIR" ]; then
    echo "Found voice sidecar portable Python. Linking..."
    ln -sfn "$VOICE_PORTABLE_DIR" "$TARGET_DIR"
    PYTHON_EXE="${TARGET_DIR}/bin/python3"
else
    # Download portable Python if not present
    if [ ! -d "$TARGET_DIR" ]; then
        PLATFORM="apple-darwin"
        ARCH="aarch64"
        PYTHON_VERSION="3.10.14"
        PB_RELEASE="20240415"
        URL="https://github.com/indygreg/python-build-standalone/releases/download/${PB_RELEASE}/cpython-${PYTHON_VERSION}+${PB_RELEASE}-${ARCH}-${PLATFORM}-install_only.tar.gz"
        echo "Downloading portable Python..."
        curl -L "$URL" | tar -xz
        mv python "$TARGET_DIR"
    fi
    PYTHON_EXE="${TARGET_DIR}/bin/python3"
fi

echo "Installing Vision dependencies..."
"$PYTHON_EXE" -m pip install --upgrade pip
"$PYTHON_EXE" -m pip install -r "$DIR/requirements.txt"

echo "Vision dependencies installed."

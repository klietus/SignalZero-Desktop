#!/bin/bash
# setup_portable.sh - Bundles a portable Python environment for the voice sidecar

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TARGET_DIR="${DIR}/python-portable"
DEPS_DIR="${DIR}/deps"

mkdir -p "$DEPS_DIR"

# 1. Use Homebrew to get a correct macOS portaudio if possible
if ! brew list portaudio &>/dev/null; then
    echo "Installing portaudio via brew for headers/libs..."
    brew install portaudio
fi

BREW_PREFIX=$(brew --prefix portaudio)
echo "Using portaudio from $BREW_PREFIX"

# Copy brew's portaudio to our deps so we can bundle it
mkdir -p "$DEPS_DIR/lib" "$DEPS_DIR/include"
cp "$BREW_PREFIX/lib/libportaudio.2.dylib" "$DEPS_DIR/lib/libportaudio.dylib"
cp "$BREW_PREFIX/include/portaudio.h" "$DEPS_DIR/include/"
cp "$BREW_PREFIX/include/pa_mac_core.h" "$DEPS_DIR/include/"

# 2. Download portable Python if not present
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

echo "Installing dependencies..."
"$PYTHON_EXE" -m pip install --upgrade pip

# 3. Install PyAudio linked to our bundled dylib
# We use -Wl,-rpath to tell the binary where to look for the dylib in the bundle
echo "Installing PyAudio..."
CFLAGS="-I$DEPS_DIR/include" \
LDFLAGS="-L$DEPS_DIR/lib -lportaudio -Wl,-rpath,@loader_path/../../../../deps/lib" \
"$PYTHON_EXE" -m pip install --no-cache-dir --no-binary :all: pyaudio

# 3. Install remaining deps
"$PYTHON_EXE" -m pip install numpy faster-whisper kokoro-onnx webrtcvad soundfile requests torch scipy sounddevice

# 5. Final verification
echo "--- Final Device Verification ---"
"$PYTHON_EXE" -c "import pyaudio; p = pyaudio.PyAudio(); count = p.get_device_count(); print(f'Devices Found: {count}'); [print(f' - {p.get_device_info_by_index(i).get(\"name\")}') for i in range(count)]; p.terminate(); exit(0 if count > 0 else 1)"

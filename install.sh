#!/bin/bash
# DiffLearn Binary Installer
# Downloads and installs the correct binary for your OS/Arch from GitHub Releases.

set -e

# Configuration
GITHUB_REPO="shelter/DiffLearn" # Default based on local user, change if different!
BINARY_NAME="difflearn"
INSTALL_DIR="/usr/local/bin"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=== DiffLearn Installer ===${NC}"

# 1. Detect OS & Arch
OS="$(uname -s)"
ARCH="$(uname -m)"
OS_TYPE=""
ARCH_TYPE=""

case "${OS}" in
    Linux*)     OS_TYPE="linux";;
    Darwin*)    OS_TYPE="macos";;
    CYGWIN*|MINGW*|MSYS*) OS_TYPE="windows";;
    *)          echo -e "${RED}Unsupported OS: ${OS}${NC}"; exit 1;;
esac

case "${ARCH}" in
    x86_64)    ARCH_TYPE="x64";;
    arm64|aarch64) ARCH_TYPE="arm64";;
    *)         echo -e "${RED}Unsupported architecture: ${ARCH}${NC}"; exit 1;;
esac

# Construct binary name matching package.json build scripts
# difflearn-macos-arm64, difflearn-linux-x64, etc.
TARGET_ASSET="difflearn-${OS_TYPE}-${ARCH_TYPE}"
if [ "$OS_TYPE" == "windows" ]; then
    TARGET_ASSET="${TARGET_ASSET}.exe"
fi

echo -e "🔍 Detected System: ${GREEN}${OS_TYPE} / ${ARCH_TYPE}${NC}"
echo -e "🎯 Target Asset: ${GREEN}${TARGET_ASSET}${NC}"

# 2. Prepare Download URL
DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/latest/download/${TARGET_ASSET}"

echo -e "⬇️  Downloading from: ${DOWNLOAD_URL}"

# 3. Create Temp File
TMP_FILE="/tmp/${TARGET_ASSET}"
rm -f "$TMP_FILE"

if command -v curl &> /dev/null; then
    HTTP_CODE=$(curl -fsSL -w "%{http_code}" -o "$TMP_FILE" "$DOWNLOAD_URL")
    if [ "$HTTP_CODE" != "200" ]; then
        echo -e "${RED}Error: Download failed (HTTP ${HTTP_CODE}).${NC}"
        echo "Check if the release asset exists: ${DOWNLOAD_URL}"
        rm -f "$TMP_FILE"
        exit 1
    fi
elif command -v wget &> /dev/null; then
    wget -q -O "$TMP_FILE" "$DOWNLOAD_URL"
else
    echo -e "${RED}Error: curl or wget required.${NC}"
    exit 1
fi

chmod +x "$TMP_FILE"

# 4. Install
echo -e "📦 Installing to ${INSTALL_DIR}..."

# Check write permissions
CAN_WRITE=false
if [ -w "$INSTALL_DIR" ]; then 
    CAN_WRITE=true
elif [ -w "$(dirname "$INSTALL_DIR")" ] && [ ! -e "$INSTALL_DIR" ]; then
    CAN_WRITE=true
fi

if [ "$CAN_WRITE" = true ]; then
    mv "$TMP_FILE" "${INSTALL_DIR}/${BINARY_NAME}"
else
    echo -e "${BLUE}Sudo required to write to ${INSTALL_DIR}${NC}"
    sudo mv "$TMP_FILE" "${INSTALL_DIR}/${BINARY_NAME}"
fi

# 5. Verify
if command -v difflearn &> /dev/null; then
    echo -e "${GREEN}=== Installation Complete! ===${NC}"
    echo -e "Run '${GREEN}difflearn web${NC}' to start."
else
    echo -e "${RED}Warning: Installed but not in PATH?${NC}"
    echo "Location: ${INSTALL_DIR}/${BINARY_NAME}"
fi

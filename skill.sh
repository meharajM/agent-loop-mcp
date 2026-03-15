#!/bin/bash
# skill.sh - Helper to install the Agentic Loop Memory skill to local agent folders

SKILL_NAME="SKILL.md"
TARGET_DIR="$HOME/.agents/skills"

if [ ! -f "$SKILL_NAME" ]; then
    # If run from node_modules, try to find it
    SKILL_NAME="$(dirname "$0")/$SKILL_NAME"
fi

if [ ! -f "$SKILL_NAME" ]; then
    echo "Error: $SKILL_NAME not found."
    exit 1
fi

mkdir -p "$TARGET_DIR"
cp "$SKILL_NAME" "$TARGET_DIR/"
echo "Successfully installed $SKILL_NAME to $TARGET_DIR"

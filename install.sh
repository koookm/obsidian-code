#!/bin/bash
# ObsidianCode - Claude Max 구독용 설치 스크립트

echo "=== ObsidianCode 설치 스크립트 (Claude Max 구독용) ==="
echo ""

# Obsidian vault 경로 입력 받기
read -p "Obsidian vault 경로를 입력하세요 (예: ~/Documents/MyVault): " VAULT_PATH
VAULT_PATH="${VAULT_PATH/#\~/$HOME}"

if [ ! -d "$VAULT_PATH" ]; then
  echo "❌ 오류: '$VAULT_PATH' 디렉토리가 존재하지 않습니다."
  exit 1
fi

PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/cc-obsidian"
mkdir -p "$PLUGIN_DIR"

# 플러그인 파일 복사
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/main.js" "$PLUGIN_DIR/"
cp "$SCRIPT_DIR/styles.css" "$PLUGIN_DIR/"
cp "$SCRIPT_DIR/manifest.json" "$PLUGIN_DIR/"

echo "✅ 플러그인 설치 완료: $PLUGIN_DIR"
echo ""
echo "다음 단계:"
echo "1. Obsidian을 열고 설정 → 커뮤니티 플러그인 → 'Obsidian Code' 활성화"
echo "2. Claude Max 구독이 있는 Anthropic 계정으로 CLI 로그인 확인:"
echo "   claude auth status"
echo "3. Obsidian Code 설정에서 인증 상태가 '완료'로 표시되는지 확인"

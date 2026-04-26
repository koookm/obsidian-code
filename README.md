# Obsidian Code

[![GitHub](https://img.shields.io/badge/GitHub-koookm/obsidian--code-blue?style=for-the-badge&logo=github)](https://github.com/koookm/obsidian-code)
[![Based on](https://img.shields.io/badge/Based_on-reallygood83/obsidian--code-gray?style=for-the-badge&logo=github)](https://github.com/reallygood83/obsidian-code)

옵시디언(Obsidian) 사이드바에서 Claude AI와 대화하며 노트를 직접 읽고, 쓰고, 터미널 명령어까지 실행하는 강력한 플러그인입니다.
**Claude Max 구독** 인증 방식에 최적화된 버전입니다.

---


```
인증 흐름:
claude 명령어 → 브라우저 로그인 (Anthropic 계정) → ~/.claude/.credentials.json 저장
                                                              ↓
Obsidian Code 플러그인 → Claude Agent SDK → CLI 자동 인증 → Max 구독 크레딧 사용
```

---



---

## 🚀 시작하기 (Quick Start)

### 1단계: Claude Code CLI 설치 및 인증

```bash
# Claude Code CLI 설치
npm install -g @anthropic-ai/claude-code

# Claude 구독 계정으로 로그인 
claude
```

> **Claude 구독이 있는 Anthropic 계정으로 로그인**하면 API 키 없이 바로 사용 가능합니다.

인증 확인:
```bash
claude auth status
```

### 2단계: 플러그인 설치

#### 방법 A: BRAT 사용 (권장)

1. Obsidian → **설정 → 커뮤니티 플러그인 → 탐색**에서 `BRAT` 설치 및 활성화
2. 명령어 팔레트(`Cmd/Ctrl + P`) → `BRAT: Add a beta plugin for testing`
3. 아래 URL 입력:
   ```
   https://github.com/koookm/obsidian-code
   ```
4. **설정 → 커뮤니티 플러그인**에서 **Obsidian Code** 활성화

#### 방법 B: 수동 설치

```bash
# vault 경로를 본인 것으로 변경
VAULT=~/Documents/MyVault
PLUGIN_DIR="$VAULT/.obsidian/plugins/cc-obsidian"

mkdir -p "$PLUGIN_DIR"
curl -L https://github.com/koookm/obsidian-code/raw/main/main.js -o "$PLUGIN_DIR/main.js"
curl -L https://github.com/koookm/obsidian-code/raw/main/styles.css -o "$PLUGIN_DIR/styles.css"
curl -L https://github.com/koookm/obsidian-code/raw/main/manifest.json -o "$PLUGIN_DIR/manifest.json"
```

#### 방법 C: 직접 빌드

```bash
git clone https://github.com/koookm/obsidian-code.git
cd obsidian-code
npm install
npm run build
# 생성된 main.js, styles.css, manifest.json을 vault의 .obsidian/plugins/cc-obsidian/ 에 복사
```

또는 포함된 스크립트 사용:
```bash
./install.sh
```

### 3단계: 인증 상태 확인

Obsidian Code 설정 화면 상단에 **"✓ Claude  구독 인증 완료"** 표시 확인

---

## 🎮 사용 방법

1. **채팅 시작**: 왼쪽 리본 메뉴의 로봇 아이콘 클릭 또는 명령어 팔레트에서 "Open chat view"
2. **파일 참조 (`@`)**: 채팅창에 `@` 입력 → vault 파일 또는 MCP 서버 선택
3. **노트 핀 (📌)**: 파일 칩의 핀 아이콘 클릭 → 노트 고정
4. **슬래시 명령어 (`/`)**: `/` 입력 → 자주 쓰는 명령 템플릿 실행
5. **인라인 수정**: 노트에서 텍스트 선택 → 단축키 → 해당 부분만 Claude가 수정

---

## ⚙️ 설정 가이드

| 설정 항목 | 설명 |
|-----------|------|
| **Claude  구독 인증** | 인증 상태 표시 및 새로고침 |
| 사용자 이름 | Claude가 부를 이름 |
| 기본 모델 | `sonnet` (Max 구독 기본값) |
| Obsidian Skills | Obsidian 문법 이해 Skills 설치 |
| 권한 모드 | AUTO / Safe / Plan |
| 환경 변수 | Claude Max 구독은 API 키 불필요 |
| Claude Code CLI 경로 | 비워두면 자동 감지 |

### 환경 변수 설정 (선택사항)

Claude Max 구독 사용 시 API 키 없이 아래처럼만 설정하면 됩니다:
```
# 모델 고정이 필요한 경우만
ANTHROPIC_MODEL=claude-sonnet-4-6
```

---

## ❓ 자주 묻는 질문

**Q. "Claude Code CLI not found" 오류**
A. 설정 → Advanced → `Claude Code CLI path`에 직접 경로 입력

```bash
# macOS/Linux: 터미널에서
which claude

# Windows: PowerShell에서
where.exe claude
```

**Q. Claude Max 구독인데 API 키를 입력해야 하나요?**
A. 아니요. `claude` 명령어로 브라우저 로그인만 완료하면 API 키 없이 사용 가능합니다.

**Q. 설정에서 인증 상태가 "인증 필요"로 표시돼요**
A. 터미널에서 `claude` 실행 후 브라우저로 로그인하고, 설정의 "새로고침" 버튼을 클릭하세요.

**Q. 어떤 Claude 모델을 사용하나요?**
A. 기본값은 `sonnet`입니다. 설정에서 `haiku` / `sonnet` / `opus` 중 선택 가능합니다.

---

## 📜 라이선스

[MIT License](LICENSE)

원본 프로젝트: [reallygood83/obsidian-code](https://github.com/reallygood83/obsidian-code)

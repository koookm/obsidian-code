---
title: Palantir Apollo 모델 리서치 및 ObsidianCode 연계 설계
date: 2026-09-05
tags:
  - research/palantir
  - architecture/orchestration
  - project/obsidian-code
status: draft
source: https://github.com/koookm/obsidian-code/pull/7
---

# Palantir Apollo 모델 리서치 및 ObsidianCode 연계 설계

**Date:** 2026-09-05
**Status:** Research / 제안 (미승인)
**Scope:** Apollo 아키텍처 분석 → ObsidianCode 적용 로드맵

> 참고: 리포지토리 전체에서 `vellum`이라는 식별자는 존재하지 않습니다. 요청하신 "vellum 프로젝트"를
> 이 저장소(ObsidianCode `cc-obsidian` v1.6.5)로 해석하고 작성했습니다.

---

## 0. 요약 (TL;DR)

Apollo의 본질은 "배포 도구"가 아니라 **"사람이 로그인할 수 없는 환경을, 선언적 목표 상태 +
제약 조건 솔버 + 텔레메트리 피드백 루프로 자율 운영하는 제어 평면"** 입니다.

ObsidianCode에 이 모델을 이식한다는 것은 다음을 의미합니다:

> 볼트(vault)를 "환경"으로, 에이전트 작업을 "Plan"으로, 승인/보안 훅을 "Constraint"로,
> 볼트 무결성 검사를 "Health Probe"로, 변경 diff를 "롤백 가능한 상태 전이"로 재정의한다.

핵심 통찰 3가지:

1. **이미 절반은 있다.** Plan Mode(`ExitPlanMode` + 승인 패널), `ApprovalManager`,
   `SecurityHooks`, `DiffTrackingHooks`는 각각 Apollo의 Plan / Constraint / Rollback 원시요소의
   맹아(seed)입니다. 다만 전부 **동기적·사람 개입 전제**로 묶여 있습니다.
2. **가장 큰 결손은 "제어 루프"와 "건강도(health)"입니다.** 목표 상태 선언, 드리프트 감지,
   자동 승격/자동 회수(recall)가 통째로 없습니다.
3. **가장 큰 구조적 난점은 비결정성입니다.** Apollo의 Plan은 멱등·결정적 작업 단위지만
   LLM 에이전트의 작업은 그렇지 않습니다. 따라서 제약은 *에이전트의 자기 보고*가 아니라
   **검증 가능한 사후 조건(post-condition)** 위에 걸려야 합니다. 이것이 이 설계의 승패를 가릅니다.

---

## 1. Apollo 아키텍처 정밀 분석

### 1.1 토폴로지: Hub / Spoke

| 구성요소 | 역할 |
|---|---|
| **Hub Environment** | 제어 평면. Spoke의 텔레메트리를 수신하고 Plan을 발행 |
| **Orchestration Engine** | Hub 내부. 모든 가능한 Plan을 지속 평가 → 제약 충족분만 발행 |
| **Spoke Environment** | 관리 대상. 각자 Spoke Control Plane을 실행 |
| **Apollo Agent** | Spoke 내부. Plan 실행 + Reported State/Probe/Telemetry 회신 |

Hub는 Spoke에 **로그인하지 않습니다.** 에어갭·기밀망(JWICS/SIPRNet)·선박·엣지 디바이스까지
포함하는 환경에서, 변경은 오직 서명된 Plan/번들이 단방향으로 흘러가고 상태는 텔레메트리로만
되돌아옵니다. 이 "접근 불가 환경에 대한 원격 자율 운영"이 Apollo의 존재 이유입니다.

### 1.2 핵심 원시요소 (Primitives)

| 개념 | 정의 |
|---|---|
| **Product** | 버전화된 소프트웨어 기능 단위. 자체 승격 파이프라인·유지보수 창·소유 팀 보유 |
| **Product Release** | Product의 특정 버전. `manifest.yml` 필수 (`product-type`, `product-group`, `product-name`, `product-version`) |
| **Entity** | 특정 Environment 안의 Product 인스턴스. Entity Type을 가짐 |
| **Environment** | 동일 인프라에 배포된 Entity들의 묶음 (예: 하나의 K8s 클러스터) |
| **Plan** | Hub→Agent 지시 단위. 설정 변경 또는 릴리스 업그레이드. **제약 전부 충족 시에만 발행** |
| **Constraint** | Plan 실행 전 만족해야 할 선행 조건 |
| **Release Channel** | 안정성/라벨 기준의 릴리스 묶음 (예: `CANARY` → `STABLE` → `RELEASE`). Entity가 채널을 *구독* |
| **Reported State** | Agent가 Hub로 보고하는 관측 상태 |

### 1.3 제약(Constraint) 종류

- **Maintenance Window** — 정의된 시간 창 밖의 변경 차단. Entity 선언 창과 Product 창을
  교집합으로 **해석(resolve)** 하여 최종 창을 계산.
- **Suppression Window** — 특정 기간 변경 억제(장애 중, 감사 기간 등).
- **Product Dependency** — Service A 변경 시 의존 Service B의 Plan도 함께 요청. 버전 호환
  범위와 **비호환(incompatibility)** 선언 존재.
- **Health / Promotion Criteria** — 헬스 체크 통과 여부.

Apollo 문서의 핵심 문장: *"제약 솔버는 GitOps 모델에서 코드 리뷰 시점에 사람이 수행해야 했을
검증을 자동화한다."* 즉 **사람의 릴리스 판단을 코드로 인코딩**한 것입니다.

### 1.4 제어 루프

```
목표 상태 (채널 구독 + 제약)        보고 상태 (텔레메트리/헬스/프로브)
          │                                       ▲
          ▼                                       │
   Orchestration Engine ──> 가능한 Plan 열거 ──> 제약 평가 ──> 충족분만 발행
          │                                                        │
          └──────────── 미충족 → 보류(재평가) ◄─────────── Agent 실행
```

Kubernetes operator의 reconcile 패턴과 유사하되, **분산 시스템의 상호 의존성과 제약을
인식하고 작업 수행 중에도 그것을 검증한다**는 점이 결정적 차이입니다.

### 1.5 승격(Promotion)과 자동 회수(Recall)

- Product/Module 편집자가 승격 파이프라인을 설정 → 유지보수 창 동안 라벨·헬스 요건을 만족하면
  다음 채널로 **자동 추가**.
- 카나리 승격: 선택된 테스트 Environment 집합에서 기준 평가. 기본은 **카나리 패러다임**
  (한 디바이스 롤아웃 → 헬스 검증 → 확대).
- 기준 미달 시 Orchestration Engine이 **릴리스를 자동 회수**하여 모든 Environment를 해당
  버전에서 내림. 즉 **롤백은 수동 복구가 아니라 상태 변경**입니다.
- 헬스 임계값이 의미를 가지려면 배포 산출물(Helm chart 등)이 **health를 실제로 생산**해야 합니다.
  → *헬스를 생산하지 않는 산출물에는 자율 운영이 성립하지 않습니다.*

### 1.6 Apollo vs GitOps(ArgoCD/Flux)

| 축 | ArgoCD/Flux | Apollo |
|---|---|---|
| 대상 | 주로 K8s 매니페스트 | 제품 버전 + 의존성 (컨테이너 아닌 것 포함) |
| 진실의 원천 | Git 리포지토리 | Hub의 카탈로그 + 채널 구독 |
| 연결성 전제 | 클러스터가 Git에 접근 가능 | **에어갭/단방향 허용** (서명 번들) |
| 판단 주체 | 사람의 PR 리뷰 | **제약 솔버** |
| 롤백 | Git revert 후 재동기화 | 오케스트레이터의 자동 회수 |

---

## 2. "Apollo 같은 모델"을 만들 때 필요한 구성요소 체크리스트

Apollo급 시스템을 목표로 할 때 반드시 갖춰야 하는 계층입니다. 각 항목에 **ObsidianCode 현황**을
병기했습니다.

### L0. 식별과 카탈로그

| 필요 요소 | 왜 필요한가 | 현 상태 |
|---|---|---|
| 관리 대상의 안정적 ID | 상태 추적·의존성 해석의 전제 | ⚠️ `Conversation.id`만 존재. 볼트 내 "관리 대상 엔티티" 개념 없음 |
| 버전화된 산출물 + 매니페스트 | 무엇을 배포/적용했는지 재현 가능해야 함 | ❌ 슬래시 커맨드/스킬에 버전·매니페스트 없음 |
| 의존성/비호환 선언 | 부분 업그레이드 시 파손 방지 | ❌ 없음 |
| 카탈로그(레지스트리) | 가능한 목표 상태 열거의 근거 | ⚠️ `ModelCatalog`는 모델 한정. 자동화 카탈로그 부재 |

### L1. 선언적 목표 상태

| 필요 요소 | 현 상태 |
|---|---|
| 목표 상태 문서(선언) | ❌ 전부 명령형 채팅 턴 |
| 목표 vs 실제의 **드리프트 감지** | ❌ 없음 |
| 구독 모델(채널) | ❌ 없음 |

### L2. 계획(Plan) 계층

| 필요 요소 | 현 상태 |
|---|---|
| Plan을 **1급 타입 객체**로 (직렬화·검사·재현 가능) | ⚠️ Plan Mode 존재하나 **마크다운 텍스트**. `~/.claude/plans/`에 저장, `approvedPlan`/`pendingPlanContent`가 세션 메타에 저장됨 |
| Plan 열거(enumeration) | ❌ 없음 (사람이 제안) |
| Plan의 멱등성/재시도 안전성 | ❌ LLM 실행이므로 미보장 — **최대 난점** |

### L3. 제약(Constraint) 엔진

| 필요 요소 | 현 상태 |
|---|---|
| 도구 단위 허용/거부 | ✅ `SecurityHooks`(블록리스트, 볼트 경계, export 경로 write-only), `BashPathValidator`, `BlocklistChecker` |
| 패턴 기반 승인 저장 | ✅ `ApprovalManager` (session/always 스코프, 경로 세그먼트 경계 인식 prefix 매칭) |
| **시간 제약** (유지보수 창/억제 창) | ❌ 없음 |
| **예산 제약** (토큰/비용/컨텍스트) | ⚠️ `UsageInfo` 수집만, 게이팅 없음 |
| **의존성 제약** | ❌ 없음 |
| **헬스 제약** | ❌ 없음 |
| 제약 평가가 **실행 전 사전 계산**되는가 | ❌ 아니오 — 도구 호출 시점의 이진 allow/deny |

### L4. 텔레메트리 / 헬스

| 필요 요소 | 현 상태 |
|---|---|
| 구조화된 보고 상태 | ⚠️ `OMCHUDProvider`가 `.omc/state/` 폴링 (지수 백오프 포함) — 패턴은 존재 |
| 헬스 프로브(무엇이 "건강함"인가의 정의) | ❌ 없음 |
| 사후 조건 검증 | ❌ 없음 (에이전트 자기보고에 의존) |

### L5. 안전한 변경과 회수

| 필요 요소 | 현 상태 |
|---|---|
| 변경 저널 (무엇이 언제 바뀌었나) | ⚠️ `DiffTrackingHooks`가 `tool_use_id`별 pre/post 콘텐츠 캡처 (100KB 캡) — **롤백 저널의 씨앗** |
| 역패치 기반 롤백 | ❌ UI 표시용 diff에 그침 |
| 카나리 → 확대 롤아웃 | ❌ 없음 |
| 자동 회수 | ❌ 없음 |

### L6. 공급망 신뢰

| 필요 요소 | 현 상태 |
|---|---|
| 산출물 서명/출처 검증 | ❌ **실질적 갭**. `OMCSkillsLoader`/`OMCMCPImporter`는 서드파티 SKILL.md와 MCP 서버 설정을 **무서명으로** 취해 볼트 전권으로 실행 |
| 취약점 스캔 훅 | ❌ 없음 |
| 감사 로그 | ⚠️ 세션 JSONL이 사실상 감사 추적 역할 |

### L7. 플릿(Fleet)

| 필요 요소 | 현 상태 |
|---|---|
| 다중 환경 관리 | ❌ 단일 볼트·단일 프로세스 |
| 연결 끊김 내성 | ⚠️ 로컬 CLI 실행이라 부분적으로 성립 |
| 중앙 정책 배포 | ⚠️ `.claude/settings.json`이 공유 가능(shareable)하게 설계됨 — 훅 지점 존재 |

---

## 3. ObsidianCode ↔ Apollo 개념 매핑

| Apollo | ObsidianCode 대응물 | 현재 코드 |
|---|---|---|
| Environment | **볼트(vault)** | `getVaultPath()`, `cwd` |
| Spoke Control Plane | **플러그인 인스턴스** | `main.ts` + `ObsidianCodeService` |
| Apollo Agent | **Claude Agent SDK 실행** | `core/agent/ObsidianCodeService.ts`, `core/omc/CLIBridge.ts` |
| Hub / Orchestration Engine | **없음 → 신규** | *(제안: `core/orchestration/`)* |
| Product | **자동화 패키지** (슬래시 커맨드 + 스킬 + 훅 + MCP 묶음) | `.claude/commands/*.md`, 스킬, `core/omc/OMCSkillsLoader.ts` |
| Product Release / manifest.yml | **없음 → 신규** | *(YAML frontmatter 파서는 이미 있음)* |
| Entity | **관리 대상 노트 집합/폴더** | *(신규)* |
| Plan | **Plan Mode 산출물** | `ExitPlanMode`, `PlanApprovalPanel`, `SessionMetaRecord.approvedPlan` |
| Constraint | **훅 + 승인 + 블록리스트** | `core/hooks/`, `core/security/` |
| Reported State | **HUD/사용량** | `OMCHUDProvider`, `UsageInfo` |
| Health Probe | **없음 → 신규** | *(제안: 볼트 무결성 검사)* |
| Release Channel | **없음 → 신규** | *(제안: dry-run → 부분 → 전체)* |
| Auto-recall | **없음 → 신규** | `DiffTrackingHooks` 확장 |
| 서명 번들 | **없음 → 신규** | `OMCMCPImporter`/`OMCSkillsLoader` 지점 |

---

## 4. 연계 제안 — 단계별 로드맵

각 단계는 **독립적으로 출시 가능한 가치**를 갖도록 잘랐습니다. 프로젝트 원칙(TDD, 모듈형 CSS,
`core/`는 기능 의존 없음)을 따릅니다.

### Phase 0 — Plan의 타입화와 변경 저널 (기반)

**목적:** Apollo의 두 축(Plan, Rollback)을 텍스트에서 데이터로 승격.

- `src/core/types/plan.ts` (신규)
  ```ts
  export interface VaultPlan {
    id: string;
    kind: 'edit' | 'create' | 'refactor' | 'index' | 'custom';
    targets: string[];          // 영향 받는 볼트 경로
    rationale: string;          // 기존 Plan 마크다운 본문
    constraints: ConstraintRef[];
    postconditions: ProbeRef[]; // 실행 후 반드시 통과해야 할 검사
    createdAt: number;
  }
  ```
- `src/core/journal/ChangeJournal.ts` (신규) — `DiffTrackingHooks`가 이미 캡처하는 pre/post
  콘텐츠를 `.claude/journal/{plan-id}.jsonl`로 영속화. 역패치 적용으로 **원클릭 되돌리기**.
- UI: 기존 `PlanApprovalPanel`에 "되돌리기" 액션 추가 (`src/style/components/plan-approval.css`).

**바로 얻는 가치:** Plan Mode 승인 후 결과가 나쁘면 세션 단위로 볼트를 되돌릴 수 있음.
현재는 사용자가 수동 복구해야 함. → **Apollo 없이도 즉시 유용한 기능.**

### Phase 1 — 볼트 헬스 프로브 (가장 중요한 신규 계층)

**목적:** "건강한 볼트"를 코드로 정의. Apollo의 *"헬스를 생산하지 않으면 자율 운영은 불가능"*
원칙을 그대로 적용.

- `src/core/health/probes/` (신규)
  | 프로브 | 검사 내용 |
  |---|---|
  | `LinkIntegrityProbe` | `[[wikilink]]` 깨짐, 고아 노트 |
  | `EmbedProbe` | `![[image]]` 대상 존재 (`mediaFolder` 설정 활용) |
  | `FrontmatterSchemaProbe` | 필수 필드/태그 스키마 (`excludedTags`와 연동) |
  | `StructureProbe` | 폴더 규약, 파일명 규칙 |
  | `CommandProbe` | 사용자 정의 shell 검사 (`HookCommandSpec` 재사용) |
- 결과 타입: `ProbeResult { probeId, status: 'healthy'|'degraded'|'failed', details }`.
- **에이전트 실행 전/후 자동 실행.** 사후 조건 실패 → Phase 0의 저널로 자동 되돌리기.

> 이것이 LLM 비결정성 문제에 대한 답입니다. 에이전트가 "다 했습니다"라고 말하는 것을 믿지 않고,
> **볼트의 관측 가능한 불변식**을 믿습니다.

### Phase 2 — 제약 엔진 일반화

**목적:** 현재 흩어진 allow/deny 로직을 하나의 평가기로 통합하고, 시간·예산·헬스 제약 추가.

- `src/core/constraints/ConstraintEvaluator.ts` (신규)
  ```ts
  export interface Constraint {
    id: string;
    evaluate(ctx: ConstraintContext): ConstraintVerdict; // satisfied | blocked(reason)
  }
  ```
- 기존 로직을 Constraint 구현체로 래핑 (동작 변경 없이 리팩터링):
  - `BlocklistConstraint` ← `BlocklistChecker`
  - `VaultBoundaryConstraint` ← `SecurityHooks.createVaultRestrictionHook`
  - `ApprovalConstraint` ← `ApprovalManager`
- 신규 제약:
  - `MaintenanceWindowConstraint` — "야간에만 대량 리팩터 허용" (Apollo의 창 해석 로직 차용:
    엔티티 창 ∩ 제품 창)
  - `BudgetConstraint` — `UsageInfo` 기반 토큰/비용 상한
  - `HealthConstraint` — Phase 1 프로브가 이미 `failed`면 추가 변경 차단 (장애 확산 방지)
  - `SuppressionConstraint` — "이 폴더는 이번 주 건드리지 마"
- 설정: `ObsidianCodeSettings`에 `constraints` 필드 추가, `.claude/settings.json`에 공유 가능하게 저장.

### Phase 3 — 오케스트레이션 루프 (Apollo 모델의 심장)

**목적:** 명령형 채팅 → 선언적 목표 상태 + 조정(reconcile).

- `.claude/desired-state.yml` (신규 규약)
  ```yaml
  entities:
    - id: daily-notes
      path: "Journal/"
      subscriptions: [ daily-summary@stable ]
      maintenanceWindow: "0 2 * * *"
      probes: [ frontmatter-schema, link-integrity ]
    - id: research-inbox
      path: "Inbox/"
      subscriptions: [ auto-tagger@canary ]
  ```
- `src/core/orchestration/OrchestrationEngine.ts` (신규)
  - 주기적으로: 보고 상태 수집(프로브) → 드리프트 계산 → 후보 Plan 열거 →
    `ConstraintEvaluator`로 필터 → 충족분만 에이전트에 발행.
  - **Obsidian 제약 주의:** 무거운 백그라운드 루프는 금물. `OMCHUDProvider`의 지수 백오프
    폴링 패턴을 그대로 따르고, 기본은 **유휴 시 + 사용자 트리거**로 제한.
- 승인 게이트: 초기에는 `permissionMode: 'normal'`에서만 발행하고 알림(Notice)으로 확인 요청.
  신뢰가 쌓이면 `yolo`에서 무인 실행 허용 — Apollo의 자율성 단계와 동일한 점진 경로.

### Phase 4 — 자동화 패키지와 릴리스 채널

**목적:** 자동화(스킬/커맨드)를 버전화된 Product로 취급하고 안전하게 승격.

- `manifest.yml` 규약 도입 (Apollo 스펙 차용):
  ```yaml
  product-type: vault-automation.v1
  product-name: auto-tagger
  product-version: 1.2.3
  dependencies:
    - product-name: frontmatter-normalizer
      version-range: "^1.0.0"
  incompatibilities:
    - product-name: legacy-tagger
  probes: [ frontmatter-schema ]
  maintenanceWindow: "0 2 * * *"
  ```
- 채널: `canary` (샌드박스 폴더 또는 dry-run) → `stable` (일부 폴더) → `release` (전체 볼트).
- 승격 기준: N회 실행 동안 프로브 100% 통과 + 사용자 롤백 0회.
- **자동 회수:** 승격 후 프로브가 임계치 이상 실패하면 Phase 0 저널로 되돌리고 채널 강등.
- 구현 위치: `src/core/storage/`의 `SlashCommandStorage` 패턴 확장 (`.claude/automations/{name}/`).

### Phase 5 — 플릿 (Hub)

**목적:** 여러 볼트/기기를 한 릴리스 프로세스로.

- Hub = **Git 리포지토리**. `.claude/` 디렉터리(설정·매니페스트·목표 상태)를 git으로 관리하면
  ArgoCD식 GitOps가 성립. 별도 서버 불필요 — 프로젝트의 "no server" 성격 유지.
- Spoke = 각 기기의 플러그인 인스턴스. `git pull` → 목표 상태 갱신 → 로컬 조정.
- 서명: 매니페스트에 서명 필드 추가. `OMCSkillsLoader`/`OMCMCPImporter` 임포트 경로에
  **출처 확인 게이트**를 세움 (현재 무서명 실행은 이 아키텍처에서 가장 큰 신뢰 갭).

---

## 5. 우선순위 판단

| Phase | 노력 | 독립적 가치 | Apollo 모델 기여 | 권장 |
|---|---|---|---|---|
| 0 (Plan 타입화 + 저널) | 중 | **높음** (즉시 유용) | 필수 기반 | 🟢 **먼저 시작** |
| 1 (헬스 프로브) | 중 | **높음** (볼트 린터로 단독 판매 가능) | 필수 기반 | 🟢 **먼저 시작** |
| 2 (제약 엔진) | 중 | 중 (주로 리팩터링) | 높음 | 🟡 Phase 0/1 이후 |
| 3 (오케스트레이션) | 높음 | 높으나 리스크 큼 | **핵심** | 🟡 신중히 |
| 4 (채널/승격) | 높음 | 중 | 높음 | 🔴 후순위 |
| 5 (플릿) | 높음 | 낮음 (개인 사용자 대부분 단일 볼트) | 중 | 🔴 후순위 |

**권장 진입점: Phase 0 + Phase 1.** 두 개만으로도 "에이전트가 볼트를 망가뜨리면 자동으로 감지하고
되돌린다"는, Apollo 철학의 핵심 가치가 사용자에게 즉시 전달됩니다. Phase 3 이후는 Phase 1의
프로브가 실제로 신뢰할 만한지 검증된 뒤에 착수해야 합니다.

---

## 6. 리스크 및 "하지 말아야 할 것"

1. **비결정성 위에 자율성을 쌓지 말 것.** 헬스 프로브(Phase 1) 없이 오케스트레이션(Phase 3)을
   먼저 만들면, 검증되지 않은 LLM 출력을 자동 반복 적용하는 시스템이 됩니다. 순서를 뒤집지 마세요.
2. **Obsidian은 K8s가 아닙니다.** 상시 백그라운드 조정 루프는 UI 프리즈와 배터리 소모를 낳습니다.
   이벤트 기반 + 유휴 트리거 + 지수 백오프를 유지하세요 (`OMCHUDProvider` 선례).
3. **에어갭 요구사항을 흉내내지 말 것.** Apollo의 서명 번들 복잡도는 기밀망 요구에서 나옵니다.
   개인 볼트에는 과잉입니다. **차용할 것은 서명 메커니즘이 아니라 "출처 검증" 원칙**입니다.
4. **`permissionMode: 'yolo'` 기본값과의 긴장.** 현재 기본값은 승인 우회입니다. 자율 오케스트레이션을
   추가하면 "무인 + 무승인"이 결합되어 위험도가 곱해집니다. Phase 3는 반드시 `normal` 모드에서 시작하세요.
5. **`.claude/` 팽창 주의.** 저널·매니페스트·목표 상태가 모두 볼트 안에 쌓입니다. 보존 정책
   (`SessionStorage`의 JSONL 패턴 + TTL)을 처음부터 설계하세요.
6. **모바일 미지원 확대.** `omc/*`, `CLIBridge`는 이미 desktop-only입니다. 신규 모듈도 동일 가드
   (`Platform.isMobile`)를 따라야 합니다.

---

## 7. 즉시 착수 가능한 첫 커밋 후보

TDD 원칙에 맞춰, 테스트부터 작성 가능한 최소 단위:

1. `tests/unit/core/health/LinkIntegrityProbe.test.ts` → `src/core/health/probes/LinkIntegrityProbe.ts`
   - 순수 함수(마크다운 문자열 + 파일 목록 → 깨진 링크 목록). Obsidian API 의존 없음 = 테스트 용이.
2. `tests/unit/core/journal/ChangeJournal.test.ts` → `src/core/journal/ChangeJournal.ts`
   - `VaultFileAdapter` 목(mock)으로 append/revert 검증. `tests/__mocks__` 기존 패턴 재사용.
3. `src/core/constraints/MaintenanceWindowConstraint.ts` + 테스트
   - cron 유사 표현식 파싱 + 창 교집합 해석. 완전 순수 로직.

세 파일 모두 `core/`에 위치하며 기능 모듈에 의존하지 않으므로 아키텍처 원칙을 지킵니다.

---

## 출처

- [How Apollo works • Palantir](https://www.palantir.com/docs/apollo/core/how-apollo-works)
- [Core concepts • Plans and Constraints • Palantir](https://www.palantir.com/docs/apollo/core/plans-and-constraints)
- [Core concepts • Release Channels • Palantir](https://www.palantir.com/docs/apollo/core/release-channels)
- [Core concepts • Entities • Palantir](https://www.palantir.com/docs/apollo/core/entities)
- [Core concepts • Apollo Agents • Palantir](https://www.palantir.com/docs/apollo/core/agents)
- [Core concepts • Spoke Control Plane • Palantir](https://www.palantir.com/docs/apollo/core/spoke-control-plane/index.html)
- [Glossary • Palantir](https://www.palantir.com/docs/apollo/apollo-getting-started/glossary)
- [Apollo Product Specification • The Product Manifest • Palantir](https://www.palantir.com/docs/apollo/apollo-product-specification/manifest)
- [Apollo Product Specification • Product Release Dependencies • Palantir](https://www.palantir.com/docs/apollo/apollo-product-specification/product-dependencies)
- [Managing Release Channels • Configure a Release promotion pipeline • Palantir](https://www.palantir.com/docs/apollo/managing-release-channels/configure-promotion-pipeline)
- [Palantir Apollo Orchestration: Constraint-Based Continuous Deployment For Modern Architectures — Palantir Blog](https://blog.palantir.com/palantir-apollo-orchestration-constraint-based-continuous-deployment-for-modern-architectures-cdf42da19ba4)
- [Palantir Apollo: Powering SaaS where no SaaS has gone before — Palantir Blog](https://blog.palantir.com/palantir-apollo-powering-saas-where-no-saas-has-gone-before-7be3e565c379)
- [AIP, Foundry, and Apollo • Palantir](https://www.palantir.com/docs/foundry/architecture-center/platforms)
- [Palantir Apollo, Explained — BD Emerson](https://www.bdemerson.com/article/palantir-apollo)
- [ArgoCD vs Flux CD: GitOps on Kubernetes Compared (2026)](https://lenshq.io/blog/gitops-argocd-flux/)

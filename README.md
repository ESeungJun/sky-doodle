# 하늘 스케치북 — 그린 그림이 뭉게구름이 되는 하늘

스케치북에 아무거나 그리고 '하늘로 보내기'를 누르면, 그 선 모양 그대로 몽글몽글한 뭉게구름이 되어 파란 하늘로 떠올라요. 원하면 다른 사람 하늘에도 띄울 수 있고, 운영자가 검수한 구름만 닉네임과 함께 두둥실 떠올라요.

- 사이트: https://sky-doodle.pages.dev
- 만든 이야기: [velog](https://velog.io/@haul/sky-doodle-drawing-becomes-cloud)

<p align="center"><a href="docs/media/demo.mp4"><img src="docs/media/demo.gif" width="100%" alt="스케치북에 하트를 그려 보내면 하트 모양 뭉게구름이 되어 하늘로 떠오르고, 다른 사람의 구름이 닉네임을 달고 아래에서 떠오르는 모습"></a><br>
<sub>▶ <a href="docs/media/demo.mp4">고화질 영상 (MP4)</a></sub></p>

## 만든 이유

맑은 날 하늘을 보면 구름이 꼭 뭔가를 닮아 있잖아요. 거꾸로, 내가 그린 걸 구름으로 만들어 하늘에 띄우면 어떨까 싶었어요. 혼자 그려도 누군가 그린 구름이 옆으로 흘러가면 같은 하늘을 보는 기분이 들게 하고 싶었고요.

## 어떻게 동작하나요

1. 스케치북에 선을 그어요. 종이 밖으로 나가면 펜이 떨어져요.
2. 선을 일정 간격으로 다시 뽑아 그 자리마다 구름 덩어리를 놓고, 차례로 부풀려 뭉게구름으로 바꿔요.
3. 다 자란 구름은 캔버스 한 장으로 구워서 하늘로 띄워요. 이후에는 매 프레임 이미지 한 번만 그려요.
4. '다른 사람 하늘에도 띄우기'를 켜고 보내면 확인 대기로 저장되고, 운영자가 승인하면 열어 둔 다른 사람 화면에도 새로고침 없이 떠올라요.

## 기능

- **모양 그대로 뭉게구름** — 연필 선이 희어지며 굵어지고, 그 위로 덩어리가 부풀어 올라 종이에 그림자를 남기며 떠올라요
- **연필 세 자루와 지우개** — 굵기가 그대로 구름 두께가 돼요. 지우개는 문지른 획을 지우고, 한 번씩 되돌릴 수 있어요. '새 종이'로 넘긴 종이는 4초 동안 귀퉁이를 잡아 되돌려요
- **내 하늘 저장** — 보낸 구름은 브라우저에 저장돼서 다시 와도 떠 있어요(최대 18개, 넘치면 가장 오래된 것부터)
- **구름 가져가기** — 하늘의 내 구름을 누르면 그림(PNG)으로 저장하거나 기기 공유 창으로 보내고, 내릴 수 있어요. 구름은 손으로 쓸어 밀 수 있어요
- **같이 보는 하늘** — 승인된 다른 사람 구름 4개가 이름 꼬리표를 달고 흘러가요. 운영자가 내린 구름은 열려 있는 화면에서도 빠져요
- **지금 시각의 하늘** — 새벽·낮·해질녘·밤(달과 별)으로 하늘빛이 바뀌어요
- **검수 어드민** — `/admin`에서 승인·거절·내리기, 여러 개 한꺼번에 처리, 같은 접속 한꺼번에 거절, 이름만 지우고 승인, 단축키(J·K·A·R). Cloudflare Access로 운영자만 들어가요
- **도배 막기** — 같은 접속(IPv6 는 /64 단위)에서 1시간 5개, 하루 20개, 대기 중 10개까지. 원본 IP는 저장하지 않고 소금 친 해시만 두며, 확인이 끝나고 이틀이 지나면 해시도 지워요
- **움직임 줄이기** — 시스템의 '동작 줄이기' 설정을 따라요

## 기술

| 영역 | 사용 |
|---|---|
| 화면 | TypeScript, Canvas 2D, Vite (프레임워크 없음) |
| 서버 | Cloudflare Pages Functions |
| 저장 | Cloudflare D1 (SQLite) |
| 어드민 보호 | Cloudflare Access + Functions에서 JWT 재검증 |

Claude Code와 함께 만들었어요.

## 로컬에서 실행

```bash
npm install
npm run dev                      # 하늘만(공유 구름 없이) http://localhost:5173

# 공유 구름·어드민까지
npm run build
npx wrangler d1 migrations apply sky-doodle --local
echo "DEV_ADMIN_BYPASS=1" > .dev.vars   # 로컬에서만 어드민 통과
npx wrangler pages dev dist      # http://localhost:8788, 어드민은 /admin/
```

## 검사

```bash
npm run typecheck   # 화면(src)과 서버(functions) 타입 검사
npm test            # node --test: 선 → 구름 계산, 입력 검증, 횟수 제한 키, 어드민 토큰 검증
npm run build
```

GitHub Actions(`.github/workflows/ci.yml`)가 푸시·PR 마다 같은 세 가지를 돌려요.

## 글꼴

손글씨는 [Gaegu](https://github.com/google/fonts/tree/main/ofl/gaegu)(SIL OFL 1.1, `public/fonts/OFL.txt`)를 화면에 쓰는 글자만 남겨 직접 실어요. 화면 문구용 23KB 를 먼저 받고, 닉네임처럼 미리 알 수 없는 한글이 나올 때만 나머지 64KB 를 받아요. 화면 문구를 바꿨으면 `python3 scripts/subset_fonts.py <Gaegu-Regular.ttf>` 를 다시 돌려요(fonttools·brotli 필요).

## 배포

```bash
npx wrangler d1 migrations apply sky-doodle --remote
npx wrangler pages secret put IP_SALT --project-name sky-doodle             # 아무 긴 무작위 값
npx wrangler pages secret put ACCESS_TEAM_DOMAIN --project-name sky-doodle  # <팀>.cloudflareaccess.com
npx wrangler pages secret put ACCESS_AUD --project-name sky-doodle          # Access 앱의 AUD 태그
npm run deploy
```

Cloudflare Access에서 `sky-doodle.pages.dev/admin`(미리보기용 `*.sky-doodle.pages.dev/admin`)을 보호하는 자체 호스팅 앱을 만들어야 어드민이 열려요. 설정이 없으면 어드민은 항상 403이에요.

## 폴더

```
index.html, src/main.ts   하늘, 구름 띄우기, 공유 구름
src/geom.ts               선 → 구름 덩어리 계산(화면 없이 돈다)
src/cloud.ts              구름 그리기·굽기, 이름 꼬리표
src/pad.ts                그리기(연필·지우개·되돌리기)
src/desk.ts, note.ts      스케치북 위 도구, 공유 묻기 쪽지
src/backdrop.ts, skytone.ts  시각별 하늘
src/export.ts             구름 PNG 저장·보내기
src/shared.ts             공유 제출·받아 오기
admin/, src/admin.ts      검수 화면
functions/                /api/clouds, /admin/api/*
migrations/               D1 스키마
tests/                    node --test
scripts/subset_fonts.py   손글씨 글꼴 줄이기
docs/                     기획서·설계서·구현도·결정기록
```

## 브랜치

`main`(릴리스) · `develop`(작업) · `feature/*` `bugfix/*` `release/*` `hotfix/*`, 태그는 `vX.Y.Z`.

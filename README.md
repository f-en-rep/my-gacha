# my-gacha

AI가 세계관과 캐릭터를 만들어 주는 개인용 가챠 게임입니다.
나와 친구들이 각자 자기 API 키로, 각자 자기 브라우저에서 노는 용도입니다.

- 서버가 없습니다. 모든 계산과 저장은 브라우저 안에서 이루어집니다.
- API 키는 이 브라우저에만 저장되고, 월드 팩이나 백업 파일에 들어가지 않습니다.
- 가챠는 명일방주 규칙을 따릅니다. 뽑기 결과는 AI가 아니라 코드가 정합니다.
- 만든 월드는 월드 팩(.zip)으로 내보내 친구에게 줄 수 있습니다.

설계는 [docs/PLAN.md](docs/PLAN.md)에 있습니다.

## 지원하는 서비스

- 텍스트: OpenRouter, OpenAI, Claude, Gemini, NanoGPT, OpenAI 호환 주소
- 그림: NovelAI, PixAI

브라우저에서 바로 부를 수 없는 서비스는 같은 사이트의 중계기(`/api/relay`)를 거칩니다.
설정 → 연결 진단에서 어느 서비스가 중계기가 필요한지 확인할 수 있습니다.

## 개발

```bash
npm install
npm run dev        # 개발 서버
npm test           # 테스트
npm run build      # 타입 검사 + 빌드 (dist/)
```

## 배포 (Cloudflare Pages)

- 빌드 명령: `npm run build`
- 출력 폴더: `dist`
- `functions/` 폴더는 Cloudflare Pages Functions로 자동 배포됩니다 (중계기).

## 폴더

| 폴더 | 내용 |
|---|---|
| `src/types/` | 데이터 모양 (월드, 캐릭터, 배너, 진행, 설정) |
| `src/core/` | 게임 규칙. 화면과 저장을 모르는 순수 함수 (가챠, 난수) |
| `src/gen/` | AI 호출: 텍스트, 그림, 작업 큐 |
| `src/net/` | 외부 API 호출과 중계기 경유 |
| `src/db/` | 브라우저 저장소 (IndexedDB) |
| `src/ui/` | 화면 |
| `functions/` | Cloudflare Pages Functions 중계기 |

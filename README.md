# CardBridge

RisuAI 봇카드를 SillyTavern과 Marinara Engine에서 쓸 수 있게 옮기는 변환기입니다.
변환은 브라우저 안에서만 이루어지고, 파일은 어디로도 전송되지 않습니다.

## 쓰는 법

1. https://f-en-rep.github.io/cardbridge.io/ 에 접속하거나, 내려받은 `dist/index.html`을 브라우저로 엽니다. 인터넷 없이도 동작합니다.
2. 리스 카드(`.png`, `.charx`, `.json`)를 끌어다 놓습니다. 이미지 팩 같은 모듈(`.risum`)도 함께 넣을 수 있습니다.
3. 어디로 옮길지 고르고 변환합니다. 결과 파일과 변환 보고서가 나옵니다.

### SillyTavern으로 옮길 때

- 결과물은 `.charx`입니다. ST의 캐릭터 가져오기로 넣으면 이미지가 자동으로 풀립니다.
- 카드 안에 **CardBridge 리스 실행기**가 JS-Slash-Runner(Tavern Helper) 캐릭터 스크립트로 들어갑니다.
  이 실행기가 리스와 같은 방식으로 다음을 처리합니다.
  - CBS 문법: 리스 원본 해석기를 그대로 사용합니다.
  - 정규식: 리스와 같은 순서와 규칙으로 적용합니다.
  - Lua 트리거: 리스와 같은 wasmoon 엔진과 같은 함수 목록으로 실행합니다.
  - 토글: 채팅창 아래 "리스 설정" 버튼에서 고릅니다.
  - 배경 HTML, 이미지 이름(`{{raw::}}`, `{{asset::}}` 등)
- 필요한 것: SillyTavern 1.19 이상, JS-Slash-Runner 확장. 카드를 처음 열 때 "스크립트 허용"을 눌러야 합니다.

### Marinara Engine으로 옮길 때

- Marinara는 카드 안의 스크립트를 실행하지 않으므로 조건문을 Marinara 문법(`{{#if var:이름 == "값"}}`)으로 옮깁니다.
- 토글은 변환할 때 고른 값으로 고정됩니다. Marinara 문법으로 옮길 수 없는 부분은 고른 값으로 미리 계산합니다.
- Lua 트리거와 배경 HTML은 옮길 수 없습니다. 보고서에 "수동 필요"로 표시됩니다.

## 개발

```bash
npm install
node build.mjs
```

- `src/risu/`: 리스 CBS 해석기와 표시 처리. RisuAI 코드를 옮겨 왔습니다.
- `src/convert/`: 리스 → ST, Marinara 변환
- `src/bridge/`: ST 안에서 돌아가는 리스 실행기
- `src/ui/`: 변환기 화면
- `vendor/risu/`: RisuAI 원본 파일. 출처와 바꾼 부분은 `vendor/risu/SOURCE.txt`에 있습니다.

## 라이선스

GPL-3.0. RisuAI(© Kwaroran, GPL-3.0)의 코드를 포함합니다.
json.lua(rxi, MIT)와 RPack 표(Kwaroran, MIT)도 포함합니다.

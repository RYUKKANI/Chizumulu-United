# Chizumulu United Club Manager

관리 주소: https://ryukkani.github.io/Chizumulu-United/

GitHub Pages에서 화면을 제공하고, 선수 정보·사진·경기·계약·구단 운영 기록을 **별도 비공개 GitHub 저장소**에 저장합니다. GPT 사이트, 외부 저장 서버, 팝업 연결을 사용하지 않습니다.

## 연결

1. GitHub의 [Fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)을 만듭니다.
2. Resource owner는 `RYUKKANI`, Repository access는 **Only select repositories**로 설정합니다.
3. `Chizumulu-United-Data`만 선택하고 **Contents: Read and write** 권한을 부여합니다. 계정 전체나 화면 저장소에 대한 권한은 필요하지 않습니다.
4. 관리 사이트의 **GitHub 저장용 인증키**에 붙여 넣고 **GitHub 연결**을 누릅니다.

인증키는 열려 있는 창의 메모리에서만 사용합니다. 공개 코드, 백업, localStorage, sessionStorage, IndexedDB에 저장하지 않습니다. 창을 닫거나 새로고침하면 다시 입력해야 하며, 저장된 구단 기록은 GitHub에 남습니다. 인증키를 채팅, 이 저장소, 스크린샷에 게시하지 마세요. 만료되면 새 인증키를 연결 설정에 입력합니다.

`github.io`의 같은 사용자 아래 다른 프로젝트들은 브라우저에서 같은 출처를 공유합니다. 이 사용자 아래에는 신뢰할 수 있는 사이트만 게시하고, 인증키의 접근 범위는 데이터 저장소 하나로 제한하세요.

## 저장 방식

- 데이터 저장소: `RYUKKANI/Chizumulu-United-Data` (**Private**)
- 파일: `main` 브랜치의 `club-state.json`
- 사진을 포함한 전체 기록과 저장 버전, 저장 시각, 마지막 변경 ID를 하나의 파일에 보관합니다.
- 각 수정은 GitHub Contents API로 자동 저장하며, 저장 완료 응답을 받은 후 **GitHub에 저장됨**을 표시합니다.
- 저장 직전에 비공개 설정과 최신 버전을 확인하고 파일 SHA를 사용해 동시 수정으로 인한 덮어쓰기를 방지합니다.
- 응답이 끊겨 재시도할 때 같은 변경 ID가 이미 저장되어 있으면 중복 저장하지 않습니다.
- 저장되지 않은 변경은 해당 브라우저의 복구용 IndexedDB에 보관합니다. 연결이 복구되면 저장 여부와 버전을 확인합니다. 충돌 시 내 변경 내용을 백업한 뒤 최신 기록을 불러옵니다.
- 현재 운영을 위한 파일 크기 상한은 8 MiB입니다. GitHub 변경 이력에 사진을 포함한 과거 기록도 남으므로 데이터 저장소는 계속 비공개로 유지합니다.

중요한 작업 후 **데이터 백업 → JSON 백업 다운로드**로 별도 백업을 보관하세요.

## 배포

이 저장소에는 빈 초기 데이터가 담긴 `index.html`, 구단 로고, 글꼴과 화면 코드만 있습니다. 선수 데이터·사진·인증키는 공개 저장소에 넣지 않습니다.

GitHub Pages는 `main` 브랜치의 루트에서 배포합니다. 데이터 저장소는 Pages에 게시하지 않습니다. 화면을 수정하거나 재배포해도 비공개 저장소에 저장된 선수 기록은 유지됩니다.

# Chizumulu United Club Manager

GitHub Pages entry point for the club's existing private player management application.

## Use

Open https://ryukkani.github.io/Chizumulu-United/ . Sign in with the same ChatGPT account used for the storage server. If needed, choose **저장 서버 로그인 / Sign in to storage**, then return and refresh the embedded manager.

The full existing Korean/English manager is embedded from the private storage service. Player edits, photos, records, and contracts continue to use the same existing server database. No player records, personal data, photo files, authentication tokens, or database credentials are stored in this public repository.

Some browsers block third-party sign-in or embedding. In that case, the sign-in button opens the same manager as a top-level page, where all edits use the same server storage.

## Publish

In repository **Settings → Pages**, select **Deploy from a branch**, branch **main**, folder **/(root)**, then **Save**. The root contains `index.html` and `.nojekyll`; no build or package installation is needed.

## Storage dependency

The management service remains at https://chizumulu-club-manager.ryuguler07.chatgpt.site . This repository hosts the entry point and embedding layout, not an independent copy of the backend. Keep that service active. This preserves the existing data and private account access.

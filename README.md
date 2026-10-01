# Chizumulu United Club Manager

GitHub Pages frontend for the club's player management application, with private server storage.

## Use

Open https://ryukkani.github.io/Chizumulu-United/ and select **저장 서버 연결 / Connect storage**. In the connection window, sign in with the same ChatGPT account used for the storage server, then select **관리 화면 연결 / Connect manager**. Return to the GitHub Pages manager and keep the connection window open while working. If the login flow separates the window, select **Connect storage** again after signing in.

The complete Korean/English manager runs on GitHub Pages. Player edits, photos, records, and contracts continue to use the same existing private server database. No player records, personal data, photo files, authentication tokens, or database credentials are stored in this public repository. The HTML's initial dataset is empty; authenticated records are loaded after connecting.

The connection window performs authenticated same-origin GET/PUT requests on the storage server and exchanges records with this frontend through origin-checked, session-bound postMessage requests. This avoids iframe sign-in and third-party cookie dependency. The server accepts only `https://ryukkani.github.io` and requires a connection confirmation. No login credentials are sent to GitHub Pages. Other projects on that same GitHub Pages origin share the browser origin, so keep all projects under this GitHub account trusted.

## Publish

In repository **Settings → Pages**, select **Deploy from a branch**, branch **main**, folder **/(root)**, then **Save**. The root contains `index.html` and `.nojekyll`; no build or package installation is needed.

## Storage dependency

The management service remains at https://chizumulu-club-manager.ryuguler07.chatgpt.site . Its `/connect` endpoint runs the private storage bridge. Keep that service active; this preserves the existing data and private account access. The original direct manager remains usable and shares the same data. The public repository does not include the private backend's imported dataset.

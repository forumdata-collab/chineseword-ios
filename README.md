# 中文筆順練習簿 — iOS 版

iOS version of 中文筆順練習簿 (Chinese stroke-order practice), ported from the
Android app. Same bundled offline site (EDB 香港字形，粵音朗讀，筆順動畫＋試寫，
默書測驗，生字冊，學習進度），version **2.31 (build 35)** to match Android v2.31.

## Install (AltStore)

1. Install [AltStore](https://altstore.io) on your iPhone (via AltServer on a
   Mac/PC, same Wi-Fi, with your own Apple ID).
2. In AltStore, go to **Browse → Sources → +** and add this URL:
   `https://raw.githubusercontent.com/forumdata-collab/chineseword-ios/main/altstore-source.json`
3. Open the source, tap **中文筆順練習簿**, install. AltStore re-signs the
   unsigned IPA with your Apple ID (free Apple ID: certificate lasts 7 days,
   AltServer renews it automatically).

Direct IPA (unsigned):
`https://github.com/forumdata-collab/chineseword-ios/releases/download/v2.31/chineseword-ios-v2.31.ipa`

## Build

GitHub Actions (`.github/workflows/build-ipa.yml`) builds the app on a macOS
runner with Xcode and produces an **unsigned** IPA. No signing identity or
certificate is used or committed. Push to `main` to build; the workflow also
creates Release v2.31 (if missing) and attaches the IPA + icon.

## Layout

- `chineseword-ios/` — Xcode project (Swift, UIKit). `AppDelegate`,
  `SplashViewController`, `MainViewController`, `AssetServer` (local HTTP
  server for the bundled site), `TTSBridge` (AVSpeechSynthesizer), `AppWebConfig`
  (injected JS: print/TTS/bridge shims), `UpdateChecker`, `Theme`.
- `site/` — the bundled offline site, byte-identical to the Android app's
  bundled site except three loader changes (see `tools/build_report_ios.md`):
  hanzi-writer script + data are loaded locally instead of from the CDN.
  Large/binary assets are NOT in the repo: `scripts/prepare-site.sh` restores
  them at build time (binary bundle `assets-binary.tar.gz.b64` + npm
  hanzi-writer-data@2.0.0).
- `ios-version.json` — the iOS update file (the app checks this, NOT the
  shared Android `version.json`).
- `altstore-source.json` — the AltStore source.
- `tools/build_report_ios.md` — full build report.

## Notes

- Minimum iOS 15, target iOS 17. Bundle ID `me.we1co.chineseword`.
- The Android app and its `version.json` are untouched; the iOS app reads the
  separate `ios-version.json` above.
- Cantonese TTS uses iOS's built-in voices (yue-Hant-HK). If the Cantonese
  voice is missing, the app points to Settings → 輔助使用 → 朗讀內容 → 語音.

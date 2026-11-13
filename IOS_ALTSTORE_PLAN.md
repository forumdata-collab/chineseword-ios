# 中文筆順練習簿 — iOS / AltStore 版計劃（準備稿，2026-11-13）

## 觸發
- 用戶 2026-11-13 15:36 HKT 問「Can we make a version in AltStore」，主代理答要先有 iOS 版（APK 唔可以直接喺 iOS 跑），用戶 15:37 HKT 答「Yes」開始做。
- 呢份係準備稿：對照咗 Android 版實際程式碼，列出 iOS 版要照抄嘅功能、已知要改嘅地方、AltStore 機制、未決定的三件事。未建 Xcode 專案、未出 IPA——嗰啲要喺 macOS runner / Xcode 先做到，呢部機無 Mac，唔可以喺度驗證。

## 基線：用 Android v2.31 嗰套資產，唔好用網站同步 zip
- Android live v2.31（versionCode 35，`~/workspace/chineseword-apk/build/chineseword-v2.31.apk`，33,040,131 bytes，14,378 entries；Drive id `1tDy76t9gfPJI82zX8mZqMhoG0YTeptOD`）。
- iOS 內容來源：`~/workspace/chineseword-apk/app/src/main/assets/`（83 MB 未壓縮）——site 37 MB（glyphs 31 MB，4,723 檔；fonts 4.5 MB LXGW；bgm 624 KB）＋ hanzi-writer-data 47 MB（9,511 字）。
- 已核實（2026-11-13）：`app/src/main/assets/site/data/glyph_sources.json` 係 4,722 字，EDB 4,528／twpen 194，7352 獒＝EDB，6128 愨＝twpen；glyphs/7352、5622、7cf4、6587 四檔齊晒。呢個先係正確基線——網站同步 zip（cw-sync-work-v230c）將 7352 標做 twpen，唔好用佢。
- Android 包名 `me.we1co.chineseword`，minSdk 24／targetSdk 34；iOS 建議沿用同一 bundle id `me.we1co.chineseword`（AltStore 係用 bundle id 認 app）。

## Android 架構（`MainActivity.java` 1,270 行＋`SplashActivity.java` 72 行，親自讀過）
- WebView 載入內置網站；因為 Android `file://` 載唔到 @font-face／fetch() 本地 JSON，所以要起一個 127.0.0.1 本地 HTTP server 派資產，失敗先 fallback `file://`，再 fallback live 站 https://chineseword.we1co.me/。
- 開首畫面：`splash-shun.html`（順筆順動畫＋紅印）喺細 WebView 跑，播完經 bridge 叫返主畫面，10 秒 fallback 一定入主畫面。
- 原生底欄四格：✏️ 輸入／📄 練習紙／✍️ 默書／🖨️ 列印（朱紅主按鈕）；另有 ⋮ 選單（生字冊、默書測驗、深色／簡單模式、學習進度、檢查更新、安裝粵語語音、A4 預覽、粵／普朗讀全文、資料來源、關於）。
- 5 個 JS bridge：`AndroidPrint`（window.print → PrintManager）、`AndroidTTS`（speechSynthesis polyfill → Android TextToSpeech，粵 yue-Hant-HK／普 zh-CN；粵語語音缺失會彈窗引導安裝，語音數據唔可以打包入 APK）、`AndroidQuiz`（默書分數對話框）、`AndroidShare`（生字冊匯出文字分享）、`AndroidWordbank`（生字冊開關狀態，BACK 鍵先關頁）。
- 其餘功能全喺網站 JS：生字冊（localStorage `cw_wordbank`）、默書測驗、深色模式（`cw_dark`）、學習進度（`cw_progress`，連續日數＋最近 7 日）、每日一字、簡單模式、部首、教師附錄（2026-10-26 快照）。
- 更新檢查：啟動 2.5 秒後靜默讀 Google Drive `version.json`（Drive file id `19wX4kBNQsTpfL_NBSl_2df3td1vVgnWF`），新 versionCode 先彈窗去 Drive 下載 APK。
- 分享練習紙：截 WebView 畫面做 PNG，經 FileProvider 分享。

## iOS 對照（Swift + WKWebView，逐項）
| Android | iOS 做法 | 注意 |
|---|---|---|
| 本地 HTTP server 派資產 | WKWebView `loadFileURL(_:allowingReadAccessTo:)`，read access 指去 bundle 資產目錄 | Android 要 server 係因為 `file://` 限制；WKWebView 呢個 API 設計上就係為咗本地檔＋fetch，理論上唔使 server——但要喺模擬器／真機驗證 fetch glyph JSON 同 @font-face 真係得，唔可以假設 |
| `file://` fallback／live 站 fallback | 同樣保留：loadFileURL 失敗 → 載 live 站 | 離線優先不變 |
| 開首畫面 WebView＋bridge | WKWebView＋`WKScriptMessageHandler`（例如 `shunDone`），同樣加超時 fallback | 順動畫＋紅印沿用同一 `splash-shun.html` |
| 底欄＋⋮ 選單 | SwiftUI／UIKit 原生底欄＋menu，呼叫同一網站 JS 函數（`scrollTo` 目標、`toggleQuizMode`、`cwWordbankPageOpen/Close`、`cwDarkSet`、`cwSimpleSet`、`cwQuizStart`、`cwProgressStats`、`readAllText`、`openA4Preview`、`printWorksheet`） | 網站 JS 唔使改（除咗下面 TTS／print 兩點） |
| `AndroidTTS` polyfill | 先測：WKWebView 內置 `speechSynthesis` 有無粵語聲（iOS 系統有 zh-HK 粵語聲，Safari/WKWebView 理論上提供）。有就唔使 polyfill；無就用 `AVSpeechSynthesizer` bridge，locale `zh-HK`（粵）／`zh-CN`（普），rate 對應 | Android 要 polyfill 係因為 Android WebView 無聲；iOS 唔可以照抄呢個假設，要真機驗 |
| `AndroidPrint` | `window.print()` 喺 WKWebView 無效——要 bridge：`WKWebView.createPDF`（iOS 14.5+）出 PDF 再經 `UIPrintInteractionController` 列印，或經分享表 | 列印係要重新設計嘅一點，唔係直抄 |
| 分享練習紙截圖 | `WKWebView.takeSnapshot` → `UIActivityViewController` | 同 Android 一樣出 PNG |
| `AndroidQuiz`／`AndroidShare`／`AndroidWordbank` | `WKScriptMessageHandler` 同名訊息（`quizDone`、`shareText`、`wordbankOpen`） | 網站 JS 呼叫點要由 `AndroidXxx.` 改做 `webkit.messageHandlers.xxx.postMessage`——呢個係網站 JS 要配合改嘅地方；決定：iOS 版用自己一份注入 JS，定係改網站 JS 做雙平台判斷（建議後者，但要小心唔好影響 Android／live 站） |
| localStorage（生字冊／進度／深色） | WKWebView 預設有 localStorage，同一網站代碼唔使改 | 但 Android／iOS 數據唔互通，係兩部機各自獨立，正常 |
| 更新檢查 | **唔可以用同一個 version.json**：而家嗰個指住 APK 下載連結，iOS 讀到會叫用戶去裝 APK。另開一個 iOS 專用 version 檔（例如 Drive 另一檔，或 GitHub Releases 嘅 `ios-version.json`），欄位 `version`／`build`／`ipaUrl`／`notes` | 建議放 GitHub Releases，唔使再經 Drive 病毒掃描警告頁 |
| 圖標 | 沿用 `~/workspace/chineseword-apk/ic_launcher_512.png`（512px）轉做 AppIcon 各尺寸 | 要補齊 iOS 要求嘅尺寸 |

## 點樣出 IPA（呢部機無 Mac）
- GitHub Actions macOS runner＋Xcode：`xcodebuild archive` → unsigned IPA（`CODE_SIGNING_ALLOWED=NO`，或 shim 做法；已有公開例子係手動 zip `Payload/*.app` 做 unsigned IPA，畀 AltStore／Sideloadly 用）。
- AltStore 會用用戶自己嘅 Apple ID 重新簽名先安裝，所以出 unsigned IPA 係足夠嘅，唔需要付費開發者帳號先做到第一版。
- 流程：Xcode 專案放 GitHub repo → Actions 出 unsigned IPA → 上傳 GitHub Releases → 更新 AltStore source JSON（`apps.json`）→ 用戶喺 AltStore 加 source 安裝／更新。

## AltStore 機制（已用公開資料核實，2026-11-13）
- AltStore source 係一個 JSON：頂層 `name`／`identifier`／`subtitle`，`apps[]` 每個有 `bundleIdentifier`、`name`、`versions[]`（最新排最前），每個 version 有 `version`、`versionDate`、`downloadURL`（直鏈 IPA，GitHub Releases 直鏈得）、`size`（bytes）、`minOSVersion`、`localizedDescription`。例子：Winston 嘅 `apps.json` 就係用 GitHub Releases 直鏈做 `downloadURL`。
- 免費 Apple ID 限制（全球 Classic 版，香港適用）：證書 7 日有效，AltServer（Mac／Windows 電腦，同 Wi-Fi）會自動續簽；同時最多 3 個 sideloaded app；付費 Apple Developer（US$99／年）→ 1 年、無 3 個上限。AltStore PAL（EU，唔使 7 日續簽）只限歐盟 Apple ID，香港唔適用。
- 用戶而家配對嘅係 OnePlus 15 Android 機——記錄入面無 iPhone；要搵部 iPhone（＋Apple ID＋裝咗 AltServer 嘅電腦）先可以真機驗證安裝、粵語 TTS、列印、更新流程。

## 建議版本編號
- iOS 第一版叫 **1.0（build 1），內容＝Android v2.31**。唔建議直接叫 2.31——iOS build 號同 Android versionCode 係兩條線，混埋會令更新檢查混亂；喺 AltStore 描述寫明「內容與 Android v2.31 相同」就得。

## 未決定，要用戶覆三件事（唔好代佢揀）
1. **放邊個 repo**：Xcode 專案＋IPA＋`apps.json` 放邊度？現有 GitHub 帳號 `forumdata-collab`；`muse-bridge` repo 係公開＋Hermes 部署橋，唔適合放 IPA/source。建議開新 repo（名例如 `chineseword-ios`），公定私由用戶揀。
2. **最低 iOS 版本**：建議 iOS 15（`createPDF` 要 14.5+；WKWebView＋`loadFileURL` 穩定），用戶有舊機要再低先講。
3. **邊部 iPhone 驗**：邊部機＋邊個 Apple ID 做第一次 AltStore 安裝測試（免費 ID 就得，但要預咗 7 日續簽＋3 app 上限）。

## AltStore source JSON 草稿（佔位符，未有真 URL 唔好發佈）
```json
{
  "name": "中文筆順練習簿",
  "identifier": "me.we1co.chineseword.altstore",
  "subtitle": "香港筆順練習簿 — iOS 版",
  "apps": [
    {
      "name": "中文筆順練習簿",
      "bundleIdentifier": "me.we1co.chineseword",
      "developerName": "we1co",
      "localizedDescription": "完全離線中文筆順練習簿：香港教育局字形、筆順動畫、默書測驗、生字冊。內容與 Android v2.31 相同。",
      "iconURL": "https://example.invalid/icon.png",
      "versions": [
        {
          "version": "1.0",
          "date": "2026-11-13",
          "downloadURL": "https://example.invalid/chineseword-1.0.ipa",
          "size": 0,
          "minOSVersion": "15.0",
          "localizedDescription": "首個 iOS 版，內容與 Android v2.31 相同。"
        }
      ]
    }
  ]
}
```

## 下一步順序
1. 用戶覆上面三件事 → 2. 開 repo＋Xcode 專案骨架（Swift＋WKWebView，複製 v2.31 資產）→ 3. 接 bridge（TTS 先測內置聲、print 用 createPDF、分享／quiz／wordbank 用 message handler）→ 4. GitHub Actions 出 unsigned IPA → 5. 上 GitHub Releases＋寫好 `apps.json` → 6. 用戶喺 iPhone＋AltServer 真機裝、驗粵語朗讀／列印／更新 → 7. 之後 Android／iOS 內容更新要同步改兩邊資產（筆順數據同一套）。

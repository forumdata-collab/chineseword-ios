import UIKit
import WebKit

/// Main screen: the bundled practice site in a WKWebView + a native bottom
/// tab bar. Mirrors Android MainActivity (same tabs, menu, bridges, dialogs,
/// update check, TTS, print, share) so the site's existing JS works unchanged.
final class MainViewController: UIViewController,
    WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {

    private static let homePath = "site/index.html"

    private var webView: WKWebView!
    private var ttsBridge: TTSBridge?
    private var bottomBar: UIView!
    private var tabButtons: [UIButton] = []
    private var shareButton: UIButton!
    private var menuButton: UIButton!
    private var dividerViews: [UIView] = []

    private var currentURL: URL?
    private var pendingTabAction: (() -> Void)?
    private var wordbankPageOpen = false
    private var darkModeOn = false
    private var simpleModeOn = false
    private var triedFileFallback = false

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Theme.paper
        buildWebView()
        buildChrome()
        loadHome()
        // Silent update check shortly after launch (like Android).
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
            guard let self = self else { return }
            UpdateChecker.shared.check(manual: false, presentOn: self)
        }
    }

    deinit {
        for name in ["iOSPrint", "iOSTTS", "iOSQuiz", "iOSShare", "iOSWordbank"] {
            webView?.configuration.userContentController.removeScriptMessageHandler(forName: name)
        }
    }

    // MARK: - WebView + native chrome

    private func buildWebView() {
        let config = AppWebConfig.makeConfiguration(includeAndroidShim: false)
        let controller = config.userContentController
        controller.add(self, name: "iOSPrint")
        controller.add(self, name: "iOSQuiz")
        controller.add(self, name: "iOSShare")
        controller.add(self, name: "iOSWordbank")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        self.webView = webView

        // TTS bridge (needs the web view for callbacks).
        let tts = TTSBridge(webView: webView)
        controller.add(tts, name: "iOSTTS")
        ttsBridge = tts
    }

    private func buildChrome() {
        // WebView fills the area above the tab bar.
        let barHeight: CGFloat = 48
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        // Bottom tab bar: ✏️ 輸入 / 📄 練習紙 / ✍️ 默書 / 🖨️ 列印.
        // Pinned to the safe area so the home indicator never covers it.
        let bar = UIView()
        bar.backgroundColor = Theme.paper
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)
        bottomBar = bar
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            bar.heightAnchor.constraint(equalToConstant: barHeight),
        ])

        // Hairline divider above the tab bar.
        let divider = UIView()
        divider.backgroundColor = Theme.hairline
        divider.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(divider)
        dividerViews.append(divider)
        NSLayoutConstraint.activate([
            divider.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            divider.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            divider.bottomAnchor.constraint(equalTo: bar.topAnchor),
            divider.heightAnchor.constraint(equalToConstant: 1),
        ])

        // WebView bottom meets the divider.
        webView.bottomAnchor.constraint(equalTo: divider.topAnchor).isActive = true

        let stack = UIStackView()
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: bar.topAnchor),
            stack.bottomAnchor.constraint(equalTo: bar.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: bar.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: bar.trailingAnchor),
        ])

        let tabs: [(String, UIColor, () -> Void)] = [
            ("✏️ 輸入", Theme.ink, { [weak self] in self?.runOnWorksheet {
                self?.closeWordbankPage(); self?.setQuizMode(false); self?.scrollTo("inputSection")
            }}),
            ("📄 練習紙", Theme.ink, { [weak self] in self?.runOnWorksheet {
                self?.closeWordbankPage(); self?.setQuizMode(false); self?.scrollTo("worksheet")
            }}),
            ("✍️ 默書", Theme.ink, { [weak self] in self?.runOnWorksheet {
                self?.closeWordbankPage(); self?.setQuizMode(true); self?.scrollTo("worksheet")
            }}),
            ("🖨️ 列印", Theme.vermilion, { [weak self] in self?.runOnWorksheet {
                self?.closeWordbankPage(); self?.evaluateJS("printWorksheet()")
            }}),
        ]
        for (index, tab) in tabs.enumerated() {
            let button = UIButton(type: .system)
            button.setTitle(tab.0, for: .normal)
            button.titleLabel?.font = UIFont.systemFont(ofSize: 14)
            button.setTitleColor(tab.1, for: .normal)
            button.tag = index
            button.addAction(UIAction { _ in tab.2() }, for: .touchUpInside)
            tabButtons.append(button)
            stack.addArrangedSubview(button)
            if index < tabs.count - 1 {
                let sep = UIView()
                sep.backgroundColor = Theme.hairline
                sep.translatesAutoresizingMaskIntoConstraints = false
                NSLayoutConstraint.activate([
                    sep.widthAnchor.constraint(equalToConstant: 1),
                ])
                stack.addArrangedSubview(sep)
                dividerViews.append(sep)
            }
        }

        // Floating share button (bottom-right, above the tab bar).
        let share = UIButton(type: .system)
        share.setTitle("↗", for: .normal)
        share.titleLabel?.font = UIFont.systemFont(ofSize: 24)
        share.setTitleColor(Theme.ink, for: .normal)
        share.backgroundColor = Theme.paper
        share.layer.cornerRadius = 28
        share.layer.shadowColor = UIColor.black.cgColor
        share.layer.shadowOpacity = 0.25
        share.layer.shadowOffset = CGSize(width: 0, height: 2)
        share.layer.shadowRadius = 6
        share.accessibilityLabel = "分享練習紙"
        share.translatesAutoresizingMaskIntoConstraints = false
        share.addAction(UIAction { [weak self] _ in self?.shareWorksheet() }, for: .touchUpInside)
        view.addSubview(share)
        shareButton = share
        NSLayoutConstraint.activate([
            share.widthAnchor.constraint(equalToConstant: 56),
            share.heightAnchor.constraint(equalToConstant: 56),
            share.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            share.bottomAnchor.constraint(equalTo: bar.topAnchor, constant: -20),
        ])

        // Floating menu button (bottom-left, above the tab bar).
        let menu = UIButton(type: .system)
        menu.setTitle("⋮", for: .normal)
        menu.titleLabel?.font = UIFont.systemFont(ofSize: 24)
        menu.setTitleColor(Theme.ink, for: .normal)
        menu.backgroundColor = Theme.paper
        menu.layer.cornerRadius = 24
        menu.layer.shadowColor = UIColor.black.cgColor
        menu.layer.shadowOpacity = 0.25
        menu.layer.shadowOffset = CGSize(width: 0, height: 2)
        menu.layer.shadowRadius = 6
        menu.accessibilityLabel = "選單"
        menu.translatesAutoresizingMaskIntoConstraints = false
        menu.addAction(UIAction { [weak self] _ in self?.showMenu() }, for: .touchUpInside)
        view.addSubview(menu)
        menuButton = menu
        NSLayoutConstraint.activate([
            menu.widthAnchor.constraint(equalToConstant: 48),
            menu.heightAnchor.constraint(equalToConstant: 48),
            menu.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            menu.bottomAnchor.constraint(equalTo: bar.topAnchor, constant: -20),
        ])
    }

    // MARK: - Loading

    private func homeURL(base: URL) -> URL { SiteServer.homeURL(base: base) }

    private func loadHome() {
        SiteServer.shared.start { [weak self] base in
            guard let self = self else { return }
            if let base = base {
                self.webView.load(URLRequest(url: self.homeURL(base: base)))
            } else if let siteRoot = AppWebConfig.siteRoot {
                let fileURL = siteRoot.appendingPathComponent("index.html")
                self.webView.loadFileURL(fileURL, allowingReadAccessTo: siteRoot)
            } else {
                self.webView.load(URLRequest(url: URL(string: AppWebConfig.homeURL)!))
            }
        }
    }

    private func isWorksheetURL(_ url: URL?) -> Bool {
        guard let url = url else { return false }
        let path = url.path
        if path.hasSuffix("index.html") { return true }
        if url.host == AppWebConfig.siteHost && (path.isEmpty || path == "/") { return true }
        return false
    }

    /// Run a bottom-tab action on the practice page (navigate home first if needed).
    private func runOnWorksheet(_ action: @escaping () -> Void) {
        if isWorksheetURL(currentURL) {
            action()
        } else {
            pendingTabAction = action
            if let base = SiteServer.sharedBaseURL {
                webView.load(URLRequest(url: homeURL(base: base)))
            } else {
                loadHome()
            }
        }
    }

    private func closeWordbankPage() {
        evaluateJS("cwWordbankPageClose()")
    }

    private func setQuizMode(_ on: Bool) {
        evaluateJS("try{if(typeof quizMode!=='undefined'&&quizMode!==\(on))toggleQuizMode();}catch(e){}")
    }

    private func scrollTo(_ elementId: String) {
        evaluateJS("var el=document.getElementById('\(elementId)');if(el)el.scrollIntoView({behavior:'smooth',block:'start'});")
    }

    private func evaluateJS(_ script: String, completion: ((Any?, Error?) -> Void)? = nil) {
        webView.evaluateJavaScript(script, completionHandler: completion)
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        currentURL = webView.url
        if let pending = pendingTabAction {
            pendingTabAction = nil
            pending()
        }
        // Sync the native chrome with the stored dark / simple preferences.
        evaluateJS("cwDarkIsOn()") { [weak self] value, _ in
            guard let self = self else { return }
            let on = (value as? Bool) == true
            self.darkModeOn = on
            self.applyAppTheme(dark: on)
        }
        evaluateJS("cwSimpleIsOn()") { [weak self] value, _ in
            self?.simpleModeOn = (value as? Bool) == true
        }
        if !isWorksheetURL(webView.url) { wordbankPageOpen = false }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let scheme = url.scheme ?? ""
        let host = url.host ?? ""
        // Bundled site (app scheme / file), the local server, and the live
        // site stay in the WebView.
        if scheme == "app" || scheme == "file" || host == AppWebConfig.siteHost
            || host == "127.0.0.1" || host == "localhost" {
            decisionHandler(.allow)
            return
        }
        // mailto: and external links open in the matching app / browser.
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard let url = webView.url else { return }
        // Local server failed: fall back to the bundled file:// copy.
        if !triedFileFallback, url.host == "127.0.0.1",
           let siteRoot = AppWebConfig.siteRoot {
            triedFileFallback = true
            let fileURL = siteRoot.appendingPathComponent("index.html")
            webView.loadFileURL(fileURL, allowingReadAccessTo: siteRoot)
            return
        }
        loadErrorPage()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loadErrorPage()
    }

    private func loadErrorPage() {
        let html = """
            <html><body style='font-family:sans-serif;text-align:center;padding:48px;'>
            <h2>未能載入練習簿</h2><p>請檢查網絡連線，然後再試。</p>
            <p><a href='\(AppWebConfig.homeURL)'>重新載入</a></p>
            </body></html>
            """
        webView.loadHTMLString(html, baseURL: URL(string: AppWebConfig.homeURL))
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "iOSPrint":
            printWorksheet()
        case "iOSQuiz":
            if let body = message.body as? [String: Any],
               let score = body["score"] as? Int,
               let total = body["total"] as? Int {
                showQuizScore(score: score, total: total)
            }
        case "iOSShare":
            if let body = message.body as? [String: Any],
               let subject = body["subject"] as? String,
               let text = body["text"] as? String {
                shareText(subject: subject, text: text)
            }
        case "iOSWordbank":
            if let body = message.body as? [String: Any],
               let open = body["open"] as? Bool {
                wordbankPageOpen = open
            }
        default:
            break
        }
    }

    // MARK: - Theme

    private func applyAppTheme(dark: Bool) {
        let barBg = dark ? Theme.darkPaper : Theme.paper
        let inkColor = dark ? Theme.darkInk : Theme.ink
        let vermilion = dark ? Theme.darkVermilion : Theme.vermilion
        let hairline = dark ? Theme.darkHairline : Theme.hairline
        view.backgroundColor = dark ? Theme.darkBG : Theme.paper
        bottomBar?.backgroundColor = barBg
        for (index, button) in tabButtons.enumerated() {
            button.setTitleColor(index == tabButtons.count - 1 ? vermilion : inkColor, for: .normal)
        }
        dividerViews.forEach { $0.backgroundColor = hairline }
        shareButton?.backgroundColor = barBg
        shareButton?.setTitleColor(inkColor, for: .normal)
        menuButton?.backgroundColor = barBg
        menuButton?.setTitleColor(inkColor, for: .normal)
    }

    // MARK: - Print

    private func printWorksheet() {
        let printController = UIPrintInteractionController.shared
        let printInfo = UIPrintInfo(dictionary: nil)
        printInfo.outputType = .general
        printInfo.jobName = "中文筆順練習簿"
        printController.printInfo = printInfo
        printController.printFormatter = webView.viewPrintFormatter()
        // iPad needs a source rect; present from the tab bar.
        if let bar = bottomBar {
            printController.present(from: bar.bounds, in: bar, animated: true, completionHandler: nil)
        } else {
            printController.present(animated: true, completionHandler: nil)
        }
    }

    // MARK: - Share

    private func shareWorksheet() {
        let config = WKSnapshotConfiguration()
        webView.takeSnapshot(with: config) { [weak self] image, _ in
            guard let self = self else { return }
            guard let image = image, let data = image.pngData() else {
                UpdateChecker.toast("未有畫面可分享", on: self)
                return
            }
            let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("worksheet.png")
            do {
                try data.write(to: tempURL)
            } catch {
                UpdateChecker.toast("分享失敗，請再試", on: self)
                return
            }
            let activity = UIActivityViewController(activityItems: [tempURL], applicationActivities: nil)
            activity.popoverPresentationController?.sourceView = self.shareButton
            activity.popoverPresentationController?.sourceRect = self.shareButton.bounds
            self.present(activity, animated: true)
        }
    }

    private func shareText(subject: String, text: String) {
        let activity = UIActivityViewController(activityItems: [text], applicationActivities: nil)
        activity.popoverPresentationController?.sourceView = shareButton
        activity.popoverPresentationController?.sourceRect = shareButton.bounds
        // UIActivityViewController has no subject field; the text carries it.
        present(activity, animated: true)
    }

    // MARK: - Menu

    private func showMenu() {
        let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
        let add = { (title: String, handler: @escaping () -> Void) in
            sheet.addAction(UIAlertAction(title: title, style: .default) { _ in handler() })
        }
        add("生字冊") { [weak self] in self?.evaluateJS("cwWordbankPageOpen()") }
        add("默書測驗") { [weak self] in
            self?.closeWordbankPage()
            self?.evaluateJS("cwQuizStart()")
        }
        add(darkModeOn ? "深色模式：開" : "深色模式：關") { [weak self] in
            guard let self = self else { return }
            self.darkModeOn.toggle()
            self.evaluateJS("cwDarkSet(\(self.darkModeOn))")
            self.applyAppTheme(dark: self.darkModeOn)
            UpdateChecker.toast(self.darkModeOn ? "已切換深色模式" : "已切換淺色模式", on: self)
        }
        add(simpleModeOn ? "簡單模式：開" : "簡單模式：關") { [weak self] in
            guard let self = self else { return }
            self.simpleModeOn.toggle()
            self.evaluateJS("cwSimpleSet(\(self.simpleModeOn))")
            UpdateChecker.toast(self.simpleModeOn ? "已切換簡單模式（只留基本練習）" : "已切換完整模式（顯示全部選項）", on: self)
        }
        add("學習進度") { [weak self] in self?.showProgress() }
        add("檢查更新") { [weak self] in
            guard let self = self else { return }
            UpdateChecker.shared.check(manual: true, presentOn: self)
        }
        add("安裝粵語語音") { [weak self] in self?.showVoiceHelp() }
        add("A4 預覽") { [weak self] in
            self?.closeWordbankPage()
            self?.evaluateJS("openA4Preview()")
        }
        add("粵語朗讀全文") { [weak self] in
            self?.closeWordbankPage()
            self?.evaluateJS("readAllText('canto')")
        }
        add("普通話朗讀全文") { [weak self] in
            self?.closeWordbankPage()
            self?.evaluateJS("readAllText('mand')")
        }
        add("資料來源與聲明") { [weak self] in self?.showSources() }
        add("關於") { [weak self] in self?.showAbout() }
        sheet.addAction(UIAlertAction(title: "取消", style: .cancel))
        sheet.popoverPresentationController?.sourceView = menuButton
        sheet.popoverPresentationController?.sourceRect = menuButton.bounds
        present(sheet, animated: true)
    }

    // MARK: - Dialogs

    private func showProgress() {
        evaluateJS("cwProgressStats()") { [weak self] value, _ in
            guard let self = self else { return }
            let jsonString = value as? String ?? ""
            var text = "讀取學習進度失敗，請再試。"
            if let data = jsonString.data(using: .utf8),
               let s = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let total = s["total"] as? Int ?? 0
                let streak = s["streak"] as? Int ?? 0
                let today = s["today"] as? Int ?? 0
                let quizTotal = s["quizTotal"] as? Int ?? 0
                let quizScore = s["quizScore"] as? Int ?? 0
                var sb = ""
                sb += "總共練咗：\(total) 隻字\n"
                sb += "連續練習：\(streak) 日\n"
                sb += "今日練咗：\(today) 隻字\n\n"
                sb += "最近七日：\n"
                if let last7 = s["last7"] as? [[String: Any]] {
                    for d in last7 {
                        sb += "  \(d["d"] as? String ?? "")：\(d["n"] as? Int ?? 0) 隻\n"
                    }
                }
                sb += "\n默書測驗："
                if quizTotal > 0 {
                    let pct = quizTotal > 0 ? Int(round(Double(quizScore) * 100 / Double(quizTotal))) : 0
                    sb += "共 \(quizTotal) 題，答啱 \(quizScore) 題（\(pct)%）"
                    if let last = s["lastQuiz"] as? [String: Any] {
                        sb += "\n最近一次：\(last["d"] as? String ?? "") \(last["s"] as? Int ?? 0)/\(last["t"] as? Int ?? 0)"
                    }
                } else {
                    sb += "未做過（撳 ⋮ → 默書測驗）"
                }
                text = sb
            }
            let alert = UIAlertController(title: "學習進度", message: text, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "關閉", style: .default))
            self.present(alert, animated: true)
        }
    }

    private func showQuizScore(score: Int, total: Int) {
        var msg = "默書測驗完成！\n\n分數：\(score) / \(total) 分"
        if total > 0 {
            let pct = Int(round(Double(score) * 100 / Double(total)))
            msg += "（\(pct)%）\n"
            if pct == 100 { msg += "\n🎉 滿分！好叻！" }
            else if pct >= 80 { msg += "\n👍 做得好好！" }
            else if pct >= 60 { msg += "\n💪 繼續努力！" }
            else { msg += "\n📖 再練下，熟習啲字先。" }
        }
        let alert = UIAlertController(title: "默書測驗成績", message: msg, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "再測一次", style: .default) { [weak self] _ in
            self?.evaluateJS("cwQuizStart()")
        })
        alert.addAction(UIAlertAction(title: "關閉", style: .cancel))
        present(alert, animated: true)
    }

    private func showSources() {
        evaluateJS("(function(){var f=document.querySelector('.ws-footer');return f?f.innerText:'';})()") { [weak self] value, _ in
            guard let self = self else { return }
            var content = value as? String ?? ""
            if content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                content = "資料來源：香港教育局字形、hanzi-writer 筆順數據。"
            }
            let alert = UIAlertController(title: "資料來源與聲明", message: content, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "關閉", style: .default))
            self.present(alert, animated: true)
        }
    }

    private func showAbout() {
        let info = Bundle.main.infoDictionary
        let name = info?["CFBundleShortVersionString"] as? String ?? "?"
        let code = info?["CFBundleVersion"] as? String ?? "?"
        let version = "v\(name)（\(code)）"
        let alert = UIAlertController(title: "中文筆順練習簿",
                                      message: "版本 \(version)\n完全離線版\n\n粵音朗讀 · 筆順練習 · 描紅",
                                      preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "檢查更新", style: .default) { [weak self] _ in
            guard let self = self else { return }
            UpdateChecker.shared.check(manual: true, presentOn: self)
        })
        alert.addAction(UIAlertAction(title: "關閉", style: .cancel))
        present(alert, animated: true)
    }

    private func showVoiceHelp() {
        let alert = UIAlertController(
            title: "安裝粵語語音",
            message: "請去「設定」→「輔助使用」→「朗讀內容」→「語音」→「中文」，下載廣東話語音（例如「善怡」），裝完返嚟再試朗讀。",
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "開啟設定", style: .default) { _ in
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
        })
        alert.addAction(UIAlertAction(title: "稍後", style: .cancel))
        present(alert, animated: true)
    }
}

// MARK: - SiteServer base URL accessor

extension SiteServer {
    /// The base URL once started (nil until start() completes).
    static var sharedBaseURL: URL? {
        SiteServer.shared.currentBaseURL
    }
}

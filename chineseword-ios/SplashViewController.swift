import UIKit
import WebKit

/// Opening screen: title + 順 stroke-order animation (splash-shun.html).
///
/// Replicates Android SplashActivity + activity_splash.xml: the splash_bg
/// painting, the title block, the red 文 seal, and the 順 animation in a
/// small WebView. When the animation finishes, the page calls back via the
/// `iOSShun` message handler (the injected window.Android shim) and we fade
/// into MainViewController. A 10s fallback guarantees we never get stuck.
final class SplashViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private static let fallbackSeconds: TimeInterval = 10

    private var webView: WKWebView?
    private var wentToMain = false
    private var fallbackWorkItem: DispatchWorkItem?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Theme.paper
        buildLayout()
        startSplash()
    }

    deinit {
        fallbackWorkItem?.cancel()
    }

    // MARK: - Layout (mirrors activity_splash.xml)

    private func buildLayout() {
        // Full-screen painting background.
        let bg = UIImageView()
        bg.translatesAutoresizingMaskIntoConstraints = false
        bg.contentMode = .scaleAspectFill
        bg.clipsToBounds = true
        if let image = UIImage(named: "splash_bg") {
            bg.image = image
        } else {
            bg.backgroundColor = Theme.paper
        }
        view.addSubview(bg)
        NSLayoutConstraint.activate([
            bg.topAnchor.constraint(equalTo: view.topAnchor),
            bg.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            bg.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bg.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.showsVerticalScrollIndicator = false
        view.addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 0
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: scroll.topAnchor, constant: 92),
            stack.bottomAnchor.constraint(equalTo: scroll.bottomAnchor, constant: -16),
            stack.leadingAnchor.constraint(equalTo: scroll.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: scroll.trailingAnchor, constant: -32),
            stack.widthAnchor.constraint(equalTo: scroll.widthAnchor, constant: -64),
        ])

        let title = UILabel()
        title.text = "中文筆順練習簿"
        title.font = UIFont(name: "TimesNewRomanPS-BoldMT", size: 40)
            ?? UIFont.boldSystemFont(ofSize: 40)
        title.textColor = Theme.ink
        title.textAlignment = .center
        // Slight letter spacing (Android letterSpacing 0.08).
        title.attributedText = NSAttributedString(
            string: "中文筆順練習簿",
            attributes: [.kern: 40 * 0.08,
                         .font: title.font as Any,
                         .foregroundColor: Theme.ink])
        stack.addArrangedSubview(title)

        let divider = UIView()
        divider.backgroundColor = Theme.gold
        divider.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            divider.widthAnchor.constraint(equalToConstant: 64),
            divider.heightAnchor.constraint(equalToConstant: 2),
        ])
        stack.addArrangedSubview(divider)
        stack.setCustomSpacing(18, after: divider)

        let subtitle = UILabel()
        subtitle.attributedText = NSAttributedString(
            string: "粵音朗讀 · 筆順練習 · 描紅",
            attributes: [.kern: 15 * 0.12,
                         .font: UIFont(name: "TimesNewRomanPSMT", size: 15) ?? UIFont.systemFont(ofSize: 15),
                         .foregroundColor: Theme.caption])
        subtitle.textAlignment = .center
        stack.addArrangedSubview(subtitle)
        stack.setCustomSpacing(22, after: subtitle)

        // Red seal (文）, like Android's seal_bg drawable.
        let seal = UILabel()
        seal.text = "文"
        seal.font = UIFont(name: "TimesNewRomanPS-BoldMT", size: 24)
            ?? UIFont.boldSystemFont(ofSize: 24)
        seal.textColor = Theme.sealInk
        seal.textAlignment = .center
        seal.backgroundColor = Theme.sealRed
        seal.layer.cornerRadius = 6
        seal.clipsToBounds = true
        seal.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            seal.widthAnchor.constraint(equalToConstant: 44),
            seal.heightAnchor.constraint(equalToConstant: 44),
        ])
        stack.addArrangedSubview(seal)
        stack.setCustomSpacing(20, after: seal)

        // 順 animation WebView (transparent, no scrollbars).
        let config = AppWebConfig.makeConfiguration(includeAndroidShim: true)
        config.userContentController.add(self, name: "iOSShun")
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.backgroundColor = .clear
        webView.isOpaque = false
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.showsVerticalScrollIndicator = false
        webView.scrollView.showsHorizontalScrollIndicator = false
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            webView.widthAnchor.constraint(equalToConstant: 320),
            webView.heightAnchor.constraint(equalToConstant: 340),
        ])
        stack.addArrangedSubview(webView)
        self.webView = webView
    }

    // MARK: - Loading

    private func startSplash() {
        // Fallback: move on even if the animation never reports back.
        let workItem = DispatchWorkItem { [weak self] in self?.goToMain() }
        fallbackWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.fallbackSeconds, execute: workItem)

        guard let webView = webView else { return }
        SiteServer.shared.start { [weak webView] base in
            guard let webView = webView else { return }
            if let base = base {
                webView.load(URLRequest(url: SiteServer.splashURL(base: base)))
            } else if let siteRoot = AppWebConfig.siteRoot {
                // file:// fallback (then the live site, if that also fails).
                let fileURL = siteRoot.appendingPathComponent("splash-shun.html")
                webView.loadFileURL(fileURL, allowingReadAccessTo: siteRoot)
            }
        }
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "iOSShun" {
            goToMain()
        }
    }

    // MARK: - Transition

    private func goToMain() {
        guard !wentToMain else { return }
        wentToMain = true
        fallbackWorkItem?.cancel()
        guard let window = view.window else { return }
        let main = MainViewController()
        UIView.transition(with: window, duration: 0.35, options: .transitionCrossDissolve, animations: {
            window.rootViewController = main
        }, completion: nil)
    }
}

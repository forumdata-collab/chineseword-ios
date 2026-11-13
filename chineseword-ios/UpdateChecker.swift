import UIKit

/// Update check against the iOS version file.
///
/// The Android app reads the shared Google Drive version.json, which points
/// at the APK — the iOS app must NOT use it (it would offer an APK to iPhone
/// users). Instead the iOS app reads its own version file, hosted in the
/// GitHub repo (ios-version.json), which points at the IPA on GitHub
/// Releases. The shared Android version.json is left untouched.
///
/// Checked silently 2.5s after launch and on demand (menu -> 檢查更新）,
/// exactly like the Android app. A newer build prompts to download the IPA.
final class UpdateChecker {
    static let shared = UpdateChecker()
    private init() {}

    /// The iOS version file (raw.githubusercontent, public).
    static let versionURL = URL(string: "https://raw.githubusercontent.com/forumdata-collab/chineseword-ios/main/ios-version.json")!

    private var installedBuild: Int {
        if let v = Bundle.main.infoDictionary?["CFBundleVersion"] as? String,
           let n = Int(v) { return n }
        return 0
    }

    func check(manual: Bool, presentOn viewController: UIViewController) {
        let task = URLSession.shared.dataTask(with: Self.versionURL) { [weak viewController] data, response, _ in
            guard let viewController = viewController else { return }
            var remote: (build: Int, version: String, url: String, notes: String)?
            if let data = data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let build = json["versionCode"] as? Int,
               let version = json["versionName"] as? String,
               let url = json["ipaUrl"] as? String {
                remote = (build, version, url, json["notes"] as? String ?? "")
            }
            DispatchQueue.main.async {
                guard let remote = remote else {
                    if manual { Self.toast("檢查失敗，請檢查網絡", on: viewController) }
                    return
                }
                if remote.build > self.installedBuild {
                    self.showUpdateDialog(remote: remote, on: viewController)
                } else if manual {
                    Self.toast("已經係最新版本", on: viewController)
                }
            }
        }
        task.resume()
    }

    private func showUpdateDialog(remote: (build: Int, version: String, url: String, notes: String), on viewController: UIViewController) {
        var msg = "有新版本 v\(remote.version)，是否下載更新？"
        if !remote.notes.isEmpty { msg += "\n\n\(remote.notes)" }
        msg += "\n\n撳「下載更新」會開啟下載頁面，下載完用 AltStore 安裝。"
        let alert = UIAlertController(title: "發現新版本", message: msg, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "下載更新", style: .default) { _ in
            if let url = URL(string: remote.url) {
                UIApplication.shared.open(url)
            }
            Self.toast("已開啟下載頁面", on: viewController)
        })
        alert.addAction(UIAlertAction(title: "稍後", style: .cancel))
        viewController.present(alert, animated: true)
    }

    static func toast(_ message: String, on viewController: UIViewController) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        viewController.present(alert, animated: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
            alert.dismiss(animated: true)
        }
    }
}

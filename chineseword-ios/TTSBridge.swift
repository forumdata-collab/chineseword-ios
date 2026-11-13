import AVFoundation
import WebKit

/// Native TextToSpeech backed by AVSpeechSynthesizer.
///
/// Mirrors the Android app's TtsBridge + SPEECH_POLYFILL: the site calls the
/// standard window.speechSynthesis API, and the injected JS (see
/// AppWebConfig.ttsPatchScript) routes speak/cancel to this bridge via the
/// `iOSTTS` WKScriptMessageHandler. Language codes are the same as Android
/// (Cantonese yue-Hant-HK, Mandarin zh-CN); iOS has built-in Cantonese
/// voices, so no voice data is bundled.
///
/// The bridge reports start/finish/cancel back to the page through the same
/// window.__ttsOnStart / __ttsOnEnd / __ttsOnError callbacks the Android
/// polyfill uses, so the site's readAloud code works unchanged.
final class TTSBridge: NSObject, WKScriptMessageHandler, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    private weak var webView: WKWebView?
    private var currentId: String?

    init(webView: WKWebView) {
        self.webView = webView
        super.init()
        synthesizer.delegate = self
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "iOSTTS", let body = message.body as? [String: Any] else { return }
        switch body["action"] as? String {
        case "speak":
            let text = body["text"] as? String ?? ""
            let lang = body["lang"] as? String ?? "yue-Hant-HK"
            let rate = body["rate"] as? Double ?? 1.0
            let id = body["id"] as? String ?? ""
            speak(text: text, lang: lang, rate: Float(rate), id: id)
        case "cancel":
            currentId = nil
            synthesizer.stopSpeaking(at: .immediate)
        default:
            break
        }
    }

    // MARK: - Speaking

    private func speak(text: String, lang: String, rate: Float, id: String) {
        guard !text.isEmpty else { return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = voice(for: lang)
        // Android clamps the rate multiplier to 0.5–2.0 and passes it as the
        // TTS speech rate; AVSpeechUtterance.rate is absolute (0.0–1.0,
        // default 0.5), so apply the same multiplier to the default rate.
        let clamped = max(0.5, min(2.0, rate))
        utterance.rate = max(0.0, min(1.0, AVSpeechUtteranceDefaultSpeechRate * clamped))
        currentId = id
        synthesizer.stopSpeaking(at: .immediate) // QUEUE_FLUSH, like Android
        synthesizer.speak(utterance)
    }

    /// Pick an iOS voice for a BCP-47 language tag (mirrors Android localeFor).
    private func voice(for lang: String) -> AVSpeechSynthesisVoice? {
        let l = lang.lowercased()
        if l.contains("yue") || l.contains("hk") || l.contains("cantonese") {
            return AVSpeechSynthesisVoice(language: "yue-Hant-HK")
                ?? AVSpeechSynthesisVoice(language: "zh-HK")
                ?? AVSpeechSynthesisVoice(language: "zh-TW")
        }
        if l.contains("zh-tw") || l.contains("tw") {
            return AVSpeechSynthesisVoice(language: "zh-TW")
        }
        if l.contains("zh") || l.contains("cmn") || l.contains("mandarin") {
            return AVSpeechSynthesisVoice(language: "zh-CN")
        }
        return AVSpeechSynthesisVoice(language: "yue-Hant-HK")
    }

    // MARK: - AVSpeechSynthesizerDelegate

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        guard let id = currentId else { return }
        webView?.evaluateJavaScript("window.__ttsOnStart&&window.__ttsOnStart('\(id)')", completionHandler: nil)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        guard let id = currentId else { return }
        currentId = nil
        webView?.evaluateJavaScript("window.__ttsOnEnd&&window.__ttsOnEnd('\(id)')", completionHandler: nil)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        guard let id = currentId else { return }
        currentId = nil
        webView?.evaluateJavaScript("window.__ttsOnEnd&&window.__ttsOnEnd('\(id)')", completionHandler: nil)
    }
}

import WebKit

/// Shared WKWebView configuration + the JS injected into the bundled site.
///
/// Mirrors the Android app's onPageFinished injections:
///  * window.print override -> native print (AndroidPrint bridge; here the
///    `iOSPrint` message handler).
///  * speechSynthesis polyfill -> native TTS (AndroidTTS bridge; here the
///    `iOSTTS` message handler, see TTSBridge).
///  * Android bridge shims (AndroidQuiz / AndroidShare / AndroidWordbank)
///    so the site's existing calls work unchanged — the site guards each
///    call with `if (window.AndroidXxx)`, and these shims forward them to
///    the matching iOS message handlers.
///  * window.Android shim for the splash page (splash-shun.html calls
///    window.Android.onShunDone(); here it forwards to `iOSShun`).
///
/// TTS note: WKWebView already provides a native window.speechSynthesis,
/// but it is a read-only object, so the polyfill cannot replace it outright.
/// Instead the patch below monkey-patches its speak / cancel / getVoices
/// methods to route through AVSpeechSynthesizer (same voices and callbacks
/// as the Android polyfill). If patching fails for any reason the native
/// speechSynthesis is left untouched and still works.
enum AppWebConfig {

    static let siteHost = "chineseword.we1co.me"
    static let homeURL = "https://chineseword.we1co.me/"

    /// The bundled site directory in the app bundle.
    static var siteRoot: URL? {
        Bundle.main.resourceURL?.appendingPathComponent("site")
    }

    /// A configuration with the injected scripts installed. Message handlers
    /// are added by the owning view controller (they need a delegate).
    /// - Parameter includeAndroidShim: also define window.Android.onShunDone
    ///   (splash page only).
    static func makeConfiguration(includeAndroidShim: Bool) -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        // Audio (bgm) does not need a user gesture — matches Android
        // setMediaPlaybackRequiresUserGesture(false).
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsInlineMediaPlayback = true

        let controller = config.userContentController
        controller.addUserScript(WKUserScript(source: printOverrideScript,
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true))
        controller.addUserScript(WKUserScript(source: ttsPatchScript,
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true))
        controller.addUserScript(WKUserScript(source: androidBridgeShimsScript,
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true))
        if includeAndroidShim {
            controller.addUserScript(WKUserScript(source: androidShimScript,
                                                  injectionTime: .atDocumentStart,
                                                  forMainFrameOnly: true))
        }
        return config
    }

    /// window.print() -> native print (UIPrintInteractionController).
    static let printOverrideScript = """
        window.print = function() {
          try { window.webkit.messageHandlers.iOSPrint.postMessage({}); } catch (e) {}
        };
        """

    /// Route the site's speechSynthesis calls through AVSpeechSynthesizer.
    /// Same voices (Cantonese yue-Hant-HK, Mandarin zh-CN) and the same
    /// __ttsOnStart / __ttsOnEnd / __ttsOnError callbacks as Android.
    static let ttsPatchScript = """
        (function(){
          try {
            var pending={};var seq=0;
            window.__ttsOnStart=function(id){var u=pending[id];if(u&&u.onstart){try{u.onstart();}catch(e){}}};
            window.__ttsOnEnd=function(id){var u=pending[id];if(u){delete pending[id];if(u.onend){try{u.onend();}catch(e){}}}};
            window.__ttsOnError=function(id){var u=pending[id];if(u){delete pending[id];if(u.onerror){try{u.onerror();}catch(e){}}}};
            var voices=[
              {name:'粵語',lang:'yue-Hant-HK',localService:true,default:true},
              {name:'普通話',lang:'zh-CN',localService:true,default:false}];
            var ss=window.speechSynthesis;
            if(!ss) return;
            var origSpeak=ss.speak.bind(ss);
            ss.speak=function(u){
              if(!u) return;
              var id='u'+(++seq);pending[id]=u;
              var lang=(u.voice&&u.voice.lang)||u.lang||'yue-Hant-HK';
              var rate=(typeof u.rate==='number'&&u.rate>0)?u.rate:1;
              try {
                window.webkit.messageHandlers.iOSTTS.postMessage({action:'speak',text:u.text||'',lang:lang,rate:rate,id:id});
              } catch(e) { origSpeak(u); }
            };
            ss.cancel=function(){pending={};try{window.webkit.messageHandlers.iOSTTS.postMessage({action:'cancel'});}catch(e){}};
            ss.getVoices=function(){return voices.slice();};
          } catch(e) { /* leave native speechSynthesis untouched */ }
        })();
        """

    /// Shims so the site's Android bridge calls work unchanged on iOS.
    /// The site guards each call (if (window.AndroidXxx) ...), so defining
    /// these objects is enough — no site JS change needed.
    static let androidBridgeShimsScript = """
        window.AndroidQuiz = { onDone: function(score, total) {
          try { window.webkit.messageHandlers.iOSQuiz.postMessage({score: score, total: total}); } catch (e) {}
        }};
        window.AndroidShare = { shareText: function(subject, text) {
          try { window.webkit.messageHandlers.iOSShare.postMessage({subject: subject, text: text}); } catch (e) {}
        }};
        window.AndroidWordbank = { setOpen: function(open) {
          try { window.webkit.messageHandlers.iOSWordbank.postMessage({open: !!open}); } catch (e) {}
        }};
        """

    /// Splash page shim: splash-shun.html calls window.Android.onShunDone().
    static let androidShimScript = """
        window.Android = { onShunDone: function() {
          try { window.webkit.messageHandlers.iOSShun.postMessage({}); } catch (e) {}
        }};
        """
}

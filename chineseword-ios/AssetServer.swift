import Foundation
import Network

/// Tiny local HTTP server that serves the bundled site over 127.0.0.1.
///
/// This mirrors the Android app's AssetServer exactly: Android WebView cannot
/// reliably load @font-face or fetch() local JSON from file://, so the app
/// serves the site over http://127.0.0.1:<port>/ instead. WKWebView has the
/// same class of file:// quirks (opaque origin, query-string handling,
/// localStorage persistence), so the iOS app uses the same proven approach:
/// a loopback HTTP server, with file:// and then the live site as fallbacks.
///
/// Only loopback (127.0.0.1) is bound — no local-network access, no
/// entitlement, no privacy prompt. Serves files under the bundled `site/`
/// directory only; `..` in a path is rejected with 404.
final class AssetServer {
    private let siteRoot: URL
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "me.we1co.chineseword.assetserver")
    private(set) var port: Int = -1

    init(siteRoot: URL) {
        self.siteRoot = siteRoot
    }

    /// Start listening on an ephemeral loopback port. Returns the port, or -1.
    func start() -> Int {
        do {
            let params = NWParameters.tcp
            // Loopback only.
            let listener = try NWListener(using: params, on: NWEndpoint.Port.any)
            self.listener = listener
            listener.stateUpdateHandler = { [weak self] state in
                if case .ready = state {
                    self?.port = Int(listener.port?.rawValue ?? 0)
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                self?.handle(connection: connection)
            }
            listener.start(queue: queue)
            // Wait briefly for the listener to become ready so we know the port.
            let deadline = DispatchTime.now() + .milliseconds(500)
            while port <= 0 && DispatchTime.now() < deadline {
                Thread.sleep(forTimeInterval: 0.01)
            }
            return port
        } catch {
            return -1
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
        port = -1
    }

    private func handle(connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, error in
            guard let self = self, let data = data, error == nil else {
                connection.cancel()
                return
            }
            let request = String(data: data, encoding: .utf8) ?? ""
            let response = self.response(for: request)
            connection.send(content: response, completion: .contentProcessed { _ in
                connection.cancel()
            })
        }
    }

    private func response(for request: String) -> Data {
        // Parse the request line: "GET /site/index.html?v=22 HTTP/1.1"
        let firstLine = request.components(separatedBy: "\r\n").first ?? ""
        let parts = firstLine.split(separator: " ")
        guard parts.count >= 2 else { return httpResponse(status: 400, mime: "text/plain", body: Data("Bad Request".utf8)) }
        var path = String(parts[1])
        // Strip query string and fragment.
        if let q = path.firstIndex(of: "?") { path = String(path[..<q]) }
        if let f = path.firstIndex(of: "#") { path = String(path[..<f]) }
        if path == "/" { path = "/site/index.html" }
        else if path.hasSuffix("/") { path += "index.html" }
        // URL-decode (handles %E6%96%87.json -> 文.json).
        let decoded = path.removingPercentEncoding ?? path
        // Reject path traversal.
        if decoded.contains("..") {
            return httpResponse(status: 404, mime: "text/plain", body: Data("Not Found".utf8))
        }
        // Map "/site/..." -> siteRoot/... (siteRoot IS the site/ directory).
        var relative = decoded
        if relative.hasPrefix("/") { relative.removeFirst() }
        if relative.hasPrefix("site/") { relative = String(relative.dropFirst("site/".count)) }
        let fileURL = siteRoot.appendingPathComponent(relative)
        guard let data = try? Data(contentsOf: fileURL) else {
            return httpResponse(status: 404, mime: "text/plain", body: Data("Not Found".utf8))
        }
        return httpResponse(status: 200, mime: Self.mimeFor(relative), body: data)
    }

    private func httpResponse(status: Int, mime: String, body: Data) -> Data {
        let statusText = status == 200 ? "OK" : status == 404 ? "Not Found" : "Bad Request"
        var header = "HTTP/1.1 \(status) \(statusText)\r\n"
        header += "Content-Type: \(mime)\r\n"
        header += "Content-Length: \(body.count)\r\n"
        header += "Access-Control-Allow-Origin: *\r\n"
        header += "Connection: close\r\n\r\n"
        var out = Data(header.utf8)
        out.append(body)
        return out
    }

    /// MIME type for a bundled asset path (mirrors Android MainActivity.mimeFor).
    static func mimeFor(_ assetPath: String) -> String {
        let p = assetPath.lowercased()
        if p.hasSuffix(".js") { return "application/javascript" }
        if p.hasSuffix(".json") { return "application/json" }
        if p.hasSuffix(".css") { return "text/css" }
        if p.hasSuffix(".html") { return "text/html" }
        if p.hasSuffix(".jpg") || p.hasSuffix(".jpeg") { return "image/jpeg" }
        if p.hasSuffix(".png") { return "image/png" }
        if p.hasSuffix(".mp3") { return "audio/mpeg" }
        if p.hasSuffix(".woff2") { return "font/woff2" }
        if p.hasSuffix(".woff") { return "font/woff" }
        if p.hasSuffix(".svg") { return "image/svg+xml" }
        return "application/octet-stream"
    }
}

/// Shared local server for the bundled site, used by both the splash screen
/// and the main screen. Started once (on a background queue); the base URL
/// is delivered to each caller. Nil means the server could not start and the
/// caller should fall back to file:// (then the live site).
final class SiteServer {
    static let shared = SiteServer()
    private init() {}

    private let lock = NSLock()
    private var server: AssetServer?
    private var baseURL: URL?
    private var started = false
    private var pending: [(URL?) -> Void] = []

    /// The base URL once start() has completed (nil until then).
    var currentBaseURL: URL? {
        lock.lock()
        defer { lock.unlock() }
        return baseURL
    }

    /// Start the server if needed, then call completion on the main queue
    /// with the base URL (http://127.0.0.1:<port>) or nil on failure.
    func start(completion: @escaping (URL?) -> Void) {
        lock.lock()
        if let base = baseURL { lock.unlock(); completion(base); return }
        pending.append(completion)
        if started { lock.unlock(); return }
        started = true
        lock.unlock()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            guard let siteRoot = AppWebConfig.siteRoot else {
                self.finish(with: nil)
                return
            }
            let server = AssetServer(siteRoot: siteRoot)
            let port = server.start()
            if port > 0 {
                self.server = server
                self.finish(with: URL(string: "http://127.0.0.1:\(port)"))
            } else {
                self.finish(with: nil)
            }
        }
    }

    private func finish(with base: URL?) {
        lock.lock()
        baseURL = base
        let callbacks = pending
        pending.removeAll()
        lock.unlock()
        DispatchQueue.main.async { callbacks.forEach { $0(base) } }
    }

    /// The practice-page URL for a given base URL.
    static func homeURL(base: URL) -> URL {
        base.appendingPathComponent("site/index.html")
    }

    /// The splash-page URL for a given base URL.
    static func splashURL(base: URL) -> URL {
        base.appendingPathComponent("site/splash-shun.html")
    }
}

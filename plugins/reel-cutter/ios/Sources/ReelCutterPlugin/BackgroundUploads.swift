import Foundation

/// Uploads that carry on when Gaffer is in the background, or closed: iOS's own background transfer service does the
/// sending. Each file is copied into its own folder first (a later reel or cut can clear the working folder while it's
/// still going up), and the copy goes once it's sent. What happens is reported to whoever started it while the app is
/// still running; if it isn't, the web app checks later that the file arrived (it can see it at its public address).
final class BackgroundUploads: NSObject, URLSessionTaskDelegate {
    static let shared = BackgroundUploads()
    static let sessionId = "com.randomedp.aipoweredtactics.uploads"

    /// (sent so far, of how much) for each upload, while the app is running
    var progress: ((Int, Double) -> Void)?
    private var done: [Int: (Int, String?) -> Void] = [:]
    private let lock = NSLock()

    lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: BackgroundUploads.sessionId)
        config.isDiscretionary = false // (now, not when iOS thinks it's convenient)
        config.sessionSendsLaunchEvents = false
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private var folder: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("uploads", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    /// Starts sending `file` to `url` (a PUT, as the clip storage's upload links expect). Returns the upload's number.
    func start(file: URL, to url: URL, contentType: String, finished: @escaping (Int, String?) -> Void) throws -> Int {
        let copy = folder.appendingPathComponent(UUID().uuidString + "-" + file.lastPathComponent)
        try FileManager.default.copyItem(at: file, to: copy)
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        let task = session.uploadTask(with: request, fromFile: copy)
        task.taskDescription = copy.path
        lock.lock(); done[task.taskIdentifier] = finished; lock.unlock()
        task.resume()
        return task.taskIdentifier
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard totalBytesExpectedToSend > 0 else { return }
        progress?(task.taskIdentifier, Double(totalBytesSent) / Double(totalBytesExpectedToSend))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let copy = task.taskDescription { try? FileManager.default.removeItem(atPath: copy) }
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        lock.lock(); let finished = done.removeValue(forKey: task.taskIdentifier); lock.unlock()
        finished?(status, error?.localizedDescription)
    }
}

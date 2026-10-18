import Foundation

/// Downloads that carry on when Gaffer is put away: a match video from a GoPro share link (gigabytes, so minutes even on
/// good wifi). iOS's own background transfer service does the fetching. Each download is named by a key the web app
/// chooses (the GoPro video's id and version), and lands at `folder/<key>.mp4`; asking for the same key again while it's
/// going joins it, and once it's there hands back the file straight away. So if Gaffer was closed mid-download, iOS
/// finishes it, and choosing the same link again picks the file up instead of starting over.
final class BackgroundDownloads: NSObject, URLSessionDownloadDelegate {
    static let shared = BackgroundDownloads()
    static let sessionId = "com.randomedp.aipoweredtactics.downloads"

    /// (key, fraction done) while the app is running
    var progress: ((String, Double) -> Void)?
    private var waiting: [String: [(URL?, String?) -> Void]] = [:]
    private let lock = NSLock()

    lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: BackgroundDownloads.sessionId)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = false
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    var folder: URL {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("reelcutter", isDirectory: true).appendingPathComponent("downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    func file(_ key: String) -> URL { folder.appendingPathComponent(key + ".mp4") }

    /// Fetches `url` as `key`; `finished(file, nil)` once it's on the phone, or `finished(nil, why)`.
    func start(_ url: URL, key: String, finished: @escaping (URL?, String?) -> Void) {
        let dest = file(key)
        if FileManager.default.fileExists(atPath: dest.path) { finished(dest, nil); return }
        lock.lock()
        let joining = waiting[key] != nil
        waiting[key, default: []].append(finished)
        lock.unlock()
        if joining { return }
        session.getAllTasks { tasks in
            if tasks.contains(where: { $0.taskDescription == key && $0.state == .running }) { return } // (still going from before)
            let task = self.session.downloadTask(with: url)
            task.taskDescription = key
            task.resume()
        }
    }

    /// Stops a download nobody wants any more (a different video was chosen).
    func cancel(_ key: String) {
        session.getAllTasks { tasks in tasks.filter { $0.taskDescription == key }.forEach { $0.cancel() } }
        finish(key, nil, "Stopped.")
    }

    private func finish(_ key: String, _ file: URL?, _ error: String?) {
        lock.lock(); let all = waiting.removeValue(forKey: key) ?? []; lock.unlock()
        all.forEach { $0(file, error) }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let key = downloadTask.taskDescription, totalBytesExpectedToWrite > 0 else { return }
        progress?(key, Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let key = downloadTask.taskDescription else { return }
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 200
        guard status < 400 else {
            finish(key, nil, status == 403 ? "GoPro's download link ran out. Paste the share link again." : "GoPro wouldn't send the video (\(status)).")
            return
        }
        // (the file iOS hands over is deleted when this returns, so it's moved into place now)
        let dest = file(key)
        do {
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.moveItem(at: location, to: dest)
            finish(key, dest, nil)
        } catch {
            finish(key, nil, "There isn't room on this phone for that video. Free up some space and try again.")
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error = error, let key = task.taskDescription else { return }
        if (error as NSError).code == NSURLErrorCancelled { return }
        finish(key, nil, "The download stopped (\(error.localizedDescription)). Check your signal and try again.")
    }
}

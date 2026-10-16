import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking // (URLRequest, off Apple's systems: tests/clip/main.swift on Linux)
#endif

// Gaffer's App Clip: a friendly's personal link, opened on an iPhone with nothing installed. It shows that one player's
// games and clips from the friendly (the database's friendly_preview, by the link's token, with no account), and offers
// the full app. Everything here is plain Foundation, so tests/clip/main.swift checks it off the phone.

/// Where the App Clip reads from. The same public values as config.js (tests/clip.test.mjs keeps them in step): the
/// database's address and its publishable key (public by design; the database's own rules decide what anyone can see),
/// and where clips play from.
enum ClipConfig {
    static let url = "https://kvefpqigpqprxfelesrb.supabase.co"
    static let key = "sb_publishable_GVY0NOJ3upPsqoGztDN_4g_6g2I67hJ"
    static let clipsUrl = "https://pub-256c81d54c3443eb8e0e013b111d2668.r2.dev"
    /// Shared with the full app, which takes the link from here the first time it opens (ClipHandoffPlugin).
    static let group = "group.com.randomedp.aipoweredtactics"
    static let linkKey = "gaffer.link"
}

/// A friendly's personal link: <site>?team=<follow code>&game=<id>&me=<token>, or the App Clip's own link with the same
/// three on the end.
struct ClipLink: Equatable {
    let token: String
    let team: String?
    let game: String?
    let url: URL

    static func parse(_ url: URL) -> ClipLink? {
        guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        func value(_ name: String) -> String? { items.first(where: { $0.name == name })?.value }
        let me = (value("me") ?? "").lowercased()
        guard me.count == 36, me.allSatisfy({ $0.isHexDigit || $0 == "-" }) else { return nil }
        let team = (value("team") ?? "").uppercased().filter { ($0.isLetter || $0.isNumber) && $0.isASCII }
        let game = String((value("game") ?? "").prefix(64))
        return ClipLink(token: me, team: team.count == 6 ? team : nil, game: game.isEmpty ? nil : game, url: url)
    }

    /// The link as the full app reads it (the same as the website's), whatever address it came in on.
    var handoff: String {
        var c = URLComponents()
        c.scheme = "https"; c.host = "gaffer.invalid"; c.path = "/"
        c.queryItems = [team.map { URLQueryItem(name: "team", value: $0) }, game.map { URLQueryItem(name: "game", value: $0) },
                        URLQueryItem(name: "me", value: token)].compactMap { $0 }
        return c.url?.absoluteString ?? ""
    }

    /// Kept for the full app (the App Clip and Gaffer share an app group).
    func keep(in defaults: UserDefaults?) { defaults?.set(handoff, forKey: ClipConfig.linkKey) }
}

struct Preview: Decodable, Equatable {
    struct Game: Decodable, Equatable, Identifiable {
        let id: String
        let at: Double?
        let mine: Int
        let theirs: Int
        let side: String
        let against: String
        let goals: Int
        let assists: Int
        enum CodingKeys: String, CodingKey { case id, at, mine, theirs, side = "for", against, goals, assists }
    }
    struct Clip: Decodable, Equatable, Identifiable {
        let game: String
        let path: String
        let vpath: String?
        let store: String?
        let label: String
        let at: Double?
        let dur: Double?
        var id: String { path }
    }
    let status: String
    let player: String?
    let team: String?
    let color: String?
    let claimed: Bool?
    let games: [Game]?
    let clips: [Clip]?
}

enum ClipText {
    /// "Shirts 2–3 Bibs", from the player's own side.
    static func score(_ g: Preview.Game) -> String { "\(g.side) \(g.mine)–\(g.theirs) \(g.against)" }

    static func result(_ g: Preview.Game) -> String { g.mine > g.theirs ? "Won" : g.mine < g.theirs ? "Lost" : "Drew" }

    /// "2 goals and an assist", or nil when there's neither.
    static func contribution(goals: Int, assists: Int) -> String? {
        func n(_ k: Int, _ one: String, _ many: String) -> String? { k == 0 ? nil : k == 1 ? one : "\(k) \(many)" }
        let parts = [n(goals, "a goal", "goals"), n(assists, "an assist", "assists")].compactMap { $0 }
        if parts.isEmpty { return nil }
        let s = parts.joined(separator: " and ")
        return s.prefix(1).uppercased() + s.dropFirst()
    }

    /// What the top of the screen says.
    static func heading(_ p: Preview) -> String {
        let first = (p.player ?? "").split(separator: " ").first.map(String.init) ?? ""
        return first.isEmpty ? "Your highlights" : "\(first)’s highlights"
    }

    static func empty(_ p: Preview) -> String {
        (p.games ?? []).isEmpty ? "The game hasn’t been finished yet. Your highlights show here once it has, and the clips once they’re cut."
            : "No clips of you yet. They show here once the gaffer has cut the highlights."
    }

    static let missing = "This link doesn’t work any more. Ask whoever sent it for a new one."
    static let offline = "Couldn’t load your highlights. Check your signal and try again."
    static let noLink = "Open Gaffer from the link you were sent to see your highlights."
    static let pitch = "Get Gaffer to keep this game on your profile with your goals, watch the rest of the highlights and make your own reel."
}

enum ClipNet {
    /// Where a clip plays from (the same as the app's clipUrl): Cloudflare R2, or the old storage.
    static func url(path: String, store: String?) -> URL? {
        let p = path.split(separator: "/", omittingEmptySubsequences: false)
            .map { String($0).addingPercentEncoding(withAllowedCharacters: .urlPathSegmentAllowed) ?? String($0) }.joined(separator: "/")
        let base = store == "r2" ? ClipConfig.clipsUrl : ClipConfig.url + "/storage/v1/object/public/clips"
        return URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/" + p)
    }

    static func url(_ c: Preview.Clip) -> URL? { url(path: c.path, store: c.store) }

    /// The one call the App Clip makes, as someone with no account (the publishable key alone).
    static func request(token: String) -> URLRequest {
        var r = URLRequest(url: URL(string: ClipConfig.url + "/rest/v1/rpc/friendly_preview")!)
        r.httpMethod = "POST"
        r.timeoutInterval = 20
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.setValue(ClipConfig.key, forHTTPHeaderField: "apikey")
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["p_token": token])
        return r
    }

    static func decode(_ data: Data) -> Preview? { try? JSONDecoder().decode(Preview.self, from: data) }
}

extension CharacterSet {
    static let urlPathSegmentAllowed: CharacterSet = {
        var s = CharacterSet.urlPathAllowed
        s.remove(charactersIn: "/")
        return s
    }()
}

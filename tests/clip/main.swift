import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// Gaffer's App Clip, off the phone: the real ios/App/Clip/ClipLogic.swift (how it reads a friendly's personal link, what
// it hands the full app, the one call it makes, and what it says), built here with plain Swift.

var failed = 0, passed = 0
func check(_ ok: Bool, _ what: String) { if ok { passed += 1 } else { failed += 1; print("FAIL  " + what) } }
func eq<T: Equatable>(_ a: T, _ b: T, _ what: String) { check(a == b, what + "  (got \(a), wanted \(b))") }

let tok = "0f8fad5b-d9cb-469f-a165-70867728950e"

// ---------- reading the link
let web = ClipLink.parse(URL(string: "https://example.com/AI/?team=ab12cd&game=11111111-1111-4111-8111-111111111111&me=\(tok.uppercased())")!)
eq(web?.token, tok, "the website's personal link: the token, whatever its capitals")
eq(web?.team, "AB12CD", "and the team's follow code")
eq(web?.game, "11111111-1111-4111-8111-111111111111", "and the game")
let clip = ClipLink.parse(URL(string: "https://appclip.apple.com/id?p=com.randomedp.aipoweredtactics.Clip&team=AB12CD&game=g1&me=\(tok)")!)
eq(clip?.token, tok, "the App Clip's own link, with the same three on the end")
eq(clip?.team, "AB12CD", "its team")
check(ClipLink.parse(URL(string: "https://appclip.apple.com/id?p=com.randomedp.aipoweredtactics.Clip")!) == nil, "no token, no link")
check(ClipLink.parse(URL(string: "https://example.com/?me=not-a-token")!) == nil, "a token that isn't one is turned down")
check(ClipLink.parse(URL(string: "https://example.com/?me=\(tok)&team=ABC")!)?.team == nil, "a team code that isn't six letters is dropped")

// ---------- what the full app is handed
let h = URLComponents(string: clip!.handoff)!.queryItems!
eq(h.map { $0.name }, ["team", "game", "me"], "the full app gets the team, the game and the token, as on the website")
eq(h.first { $0.name == "me" }?.value, tok, "the token as it came")
let mem = UserDefaults(suiteName: "clip-tests-\(ProcessInfo.processInfo.processIdentifier)")!
clip!.keep(in: mem)
eq(mem.string(forKey: "gaffer.link"), clip!.handoff, "it's kept under the key the full app's ClipHandoffPlugin reads")
eq(ClipConfig.linkKey, "gaffer.link", "(the same key)")
eq(ClipConfig.group, "group.Com.randomedp.aipoweredtactics", "in the app group the two share")

// ---------- the one call
let req = ClipNet.request(token: tok)
eq(req.url?.absoluteString, ClipConfig.url + "/rest/v1/rpc/friendly_preview", "it asks the database's friendly_preview")
eq(req.httpMethod, "POST", "as a POST")
eq(req.value(forHTTPHeaderField: "apikey"), ClipConfig.key, "with the publishable key")
check(req.value(forHTTPHeaderField: "Authorization") == nil, "and no account")
let body = try! JSONSerialization.jsonObject(with: req.httpBody!) as! [String: String]
eq(body, ["p_token": tok], "the token is all it sends")
check(ClipConfig.key.hasPrefix("sb_publishable_"), "the key is the publishable one, never a secret")

// ---------- what comes back (the shape friendly_preview returns; friendlydb.test.mjs checks the database side)
let json = """
{"status":"ok","player":"Dave Guest","team":"Ethan's friendlies","color":"#1f6b4a","claimed":false,
 "games":[{"id":"g1","at":1760000000000,"mine":2,"theirs":3,"for":"Shirts","against":"Bibs","goals":1,"assists":0}],
 "clips":[{"game":"g1","path":"t1/g/01.mp4","vpath":null,"store":"r2","label":"GOAL Dave Guest","at":1759999100000,"dur":14},
          {"game":"g1","path":"t1/g/02 b.mp4","vpath":null,"store":null,"label":"Highlight","at":1759999200000,"dur":14}]}
""".data(using: .utf8)!
let p = ClipNet.decode(json)
check(p != nil, "it reads what the database sends")
eq(p?.games?.first.map(ClipText.score), "Shirts 2–3 Bibs", "the score from their own side")
eq(p?.games?.first.map(ClipText.result), "Lost", "and the result")
eq(ClipText.heading(p!), "Dave’s highlights", "the heading uses their first name")
eq(ClipNet.url(p!.clips![0])?.absoluteString, ClipConfig.clipsUrl + "/t1/g/01.mp4", "a clip on Cloudflare R2 plays from there")
eq(ClipNet.url(p!.clips![1])?.absoluteString, ClipConfig.url + "/storage/v1/object/public/clips/t1/g/02%20b.mp4", "an older clip from the old storage, its name made safe")
eq(ClipNet.decode("{\"status\":\"missing\"}".data(using: .utf8)!)?.status, "missing", "a link that doesn't work any more")
check(ClipNet.decode("<html>".data(using: .utf8)!) == nil, "and anything else isn't mistaken for highlights")

// ---------- the words
eq(ClipText.contribution(goals: 1, assists: 0), "A goal", "one goal")
eq(ClipText.contribution(goals: 2, assists: 1), "2 goals and an assist", "goals and an assist")
eq(ClipText.contribution(goals: 0, assists: 3), "3 assists", "assists only")
eq(ClipText.contribution(goals: 0, assists: 0), nil, "nothing to say")
for s in [ClipText.pitch, ClipText.missing, ClipText.offline, ClipText.noLink, ClipText.empty(p!)] {
    check(!s.lowercased().contains("5-a-side"), "never calls Gaffer a 5-a-side app: " + s)
}

print(failed == 0 ? "App Clip: all \(passed) checks passed" : "App Clip: \(failed) of \(passed + failed) checks failed")
exit(failed == 0 ? 0 : 1)

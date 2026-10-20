// Your own commentary over a reel (VoiceSpans.swift, the code that ships), checked off the phone.
//   swiftc plugins/reel-cutter/ios/Sources/ReelCutterPlugin/VoiceSpans.swift tests/voice/main.swift -o voicecheck && ./voicecheck
// The game's own sound dips while you talk and comes back up between lines, and your words land where you said them
// over the picture (the recording starts a moment before the reel does).
import Foundation

var failures = 0, checks = 0
func check(_ ok: Bool, _ what: String) { checks += 1; if !ok { failures += 1; print("FAIL  " + what) } }
func near(_ a: Double, _ b: Double, _ by: Double = 0.06) -> Bool { abs(a - b) <= by }

let step = 0.05
func take(_ seconds: Double, quiet: Float = -55, talk: [(Double, Double)], loud: Float = -18) -> [Float] {
    (0..<Int(seconds / step)).map { i in
        let t = Double(i) * step
        return talk.contains { t >= $0.0 && t < $0.1 } ? loud + Float(i % 3) : quiet - Float(i % 4)
    }
}

// two lines close together share one dip; a line on its own later gets its own
let spans = VoiceSpans.speaking(levels: take(12, talk: [(1, 3), (3.5, 5), (8, 9)]), step: step)
check(spans.count == 2, "lines half a second apart share one dip, the later one has its own (\(spans))")
check(spans.count == 2 && near(spans[0].from, 0.85) && near(spans[0].to, 5.3), "the first runs from just before the first word to just after the last (\(spans))")
check(spans.count == 2 && near(spans[1].from, 7.85) && near(spans[1].to, 9.3), "the second the same (\(spans))")

// a noisy room (a pitch next door) still finds the talking
let noisy = VoiceSpans.speaking(levels: take(10, quiet: -32, talk: [(2, 4)], loud: -12), step: step)
check(noisy.count == 1 && near(noisy[0].from, 1.85) && near(noisy[0].to, 4.3), "talking over a noisy room is still found (\(noisy))")

// nothing said, a click, nothing at all
check(VoiceSpans.speaking(levels: take(10, talk: []), step: step).isEmpty, "nothing said: no spans")
check(VoiceSpans.speaking(levels: take(10, talk: [(5, 5.06)]), step: step).isEmpty, "a click isn't a line")
check(VoiceSpans.speaking(levels: [], step: step).isEmpty, "an empty recording: no spans")
check(VoiceSpans.speaking(levels: [-160, Float.nan, -Float.infinity, 0], step: step).count <= 1, "odd readings don't crash it")

// moved onto the reel: the reel started 0.4 s into the recording
let dips = VoiceSpans.dips(spans, lead: 0.4, voiceLength: 12, reelLength: 9)
check(dips.count == 2 && near(dips[0].from, 0.45) && near(dips[0].to, 4.9), "the dips land where the words do over the picture (\(dips))")
check(dips.count == 2 && near(dips[1].to, 8.9), "and stay inside the reel (\(dips))")
let cut = VoiceSpans.dips(spans, lead: 0.4, voiceLength: 12, reelLength: 6)
check(cut.count == 1 && near(cut[0].to, 4.9), "a line after the reel ends is left out (\(cut))")
let whole = VoiceSpans.dips([], lead: 0.3, voiceLength: 20, reelLength: 15)
check(whole.count == 1 && near(whole[0].from, 0) && near(whole[0].to, 15), "no talking found: the game's sound dips under the whole of it, to be safe (\(whole))")

print(failures == 0 ? "voice over: all \(checks) checks passed" : "voice over: \(failures) of \(checks) checks FAILED")
exit(failures == 0 ? 0 : 1)

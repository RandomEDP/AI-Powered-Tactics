import Foundation

/// When someone recording their own commentary is actually talking, worked out from the microphone's level as it was
/// recorded, so the game's own sound only dips while they speak and comes back up between lines, as on the telly.
/// Plain Foundation, so it's checked off the phone (tests/voice/main.swift).
public enum VoiceSpans {
    public struct Span: Equatable {
        public var from: Double
        public var to: Double
        public init(from: Double, to: Double) { self.from = from; self.to = to }
    }

    /// The stretches with speech in them. `levels` are the microphone's average power in decibels (-160 to 0), one every
    /// `step` seconds from the start of the recording. The threshold sits between the room's own noise and the loudest
    /// talking, so it works in a quiet bedroom and next to a busy pitch. Nothing clearly louder than the room: no spans.
    public static func speaking(levels: [Float], step: Double) -> [Span] {
        let clean = levels.map { $0.isFinite ? max(-160, min(0, $0)) : -160 }
        guard clean.count >= 3, step > 0 else { return [] }
        let sorted = clean.sorted()
        let floor = sorted[Int(Double(sorted.count - 1) * 0.2)]   // the room between words
        let peak = sorted[Int(Double(sorted.count - 1) * 0.95)]   // talking, leaving out the odd bang
        guard peak - floor >= 6 else { return [] }
        let threshold = floor + max(6, (peak - floor) * 0.35)
        var spans: [Span] = []
        var start: Int? = nil
        for (i, level) in clean.enumerated() {
            if level >= threshold { if start == nil { start = i } }
            else if let s = start { spans.append(Span(from: Double(s) * step, to: Double(i) * step)); start = nil }
        }
        if let s = start { spans.append(Span(from: Double(s) * step, to: Double(clean.count) * step)) }
        let length = Double(clean.count) * step
        let padded = spans.filter { $0.to - $0.from >= 0.12 }   // a cough or a click isn't a line
            .map { Span(from: max(0, $0.from - 0.15), to: min(length, $0.to + 0.3)) }
        return merge(padded, gap: 1.0)
    }

    /// Where the game's sound dips in the finished reel: the recording's spans moved by `lead` (how far into the recording
    /// the reel started playing), cut to the reel's length, with lines close together sharing one dip so the crowd noise
    /// doesn't pump up and down between them. No spans found at all: the whole of the voice gets one dip, to be safe.
    public static func dips(_ spans: [Span], lead: Double, voiceLength: Double, reelLength: Double) -> [Span] {
        let lead = max(0, lead)
        let source = spans.isEmpty ? [Span(from: lead, to: voiceLength)] : spans
        let moved = source.map { Span(from: max(0, $0.from - lead), to: min(reelLength, $0.to - lead)) }.filter { $0.to - $0.from > 0.05 }
        return merge(moved, gap: 1.0)
    }

    static func merge(_ spans: [Span], gap: Double) -> [Span] {
        var out: [Span] = []
        for span in spans.sorted(by: { $0.from < $1.from }) {
            if let last = out.last, span.from - last.to < gap { out[out.count - 1].to = max(last.to, span.to) } else { out.append(span) }
        }
        return out
    }
}

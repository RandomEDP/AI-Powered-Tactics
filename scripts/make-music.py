# Makes the beat edits' music (music/*.m4a): three tracks written and synthesised here, so Gaffer owns them outright and
# they can go in any video posted anywhere (Instagram, TikTok, WhatsApp) with no licence to buy and nothing to be muted.
# Every track starts exactly on its first beat, so a beat is at n * 60 / bpm seconds; the bars where the build ends
# and the drop starts are in BEATS in index.html (tests/beat.test.mjs checks the two agree).
#
#   python3 -m pip install numpy scipy      (once)
#   python3 scripts/make-music.py           (needs ffmpeg for the .m4a)
#
# The output is the same every run (the noise is seeded), so the files only change when this script does.
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np
from scipy import signal

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'music')
rng = np.random.default_rng(7)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


class Mix:
    """A stereo buffer with a beat clock: things are placed at (bar, beat) positions."""

    def __init__(self, bpm, bars, tail=0.0):
        self.bpm = bpm
        self.beat = 60.0 / bpm
        self.bars = bars
        self.n = int(round((bars * 4 * self.beat + tail) * SR))
        self.buses = {}

    def bus(self, name):
        if name not in self.buses:
            self.buses[name] = np.zeros((2, self.n))
        return self.buses[name]

    def t(self, bar, beat=0.0):
        return (bar * 4 + beat) * self.beat

    def add(self, name, sig, at, gain=1.0, pan=0.0):
        """Mono or stereo `sig` into a bus at `at` seconds, panned -1 (left) to 1 (right)."""
        start = int(round(at * SR))
        if start >= self.n:
            return
        if sig.ndim == 1:
            left, right = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)
            sig = np.vstack([sig * left * 1.414, sig * right * 1.414])
        end = min(self.n, start + sig.shape[1])
        self.bus(name)[:, start:end] += sig[:, : end - start] * gain


# ---- sounds

def tnum(dur):
    return np.arange(int(dur * SR)) / SR


def kick(punch=1.0, dur=0.45, low=46.0):
    t = tnum(dur)
    f = low + 110 * np.exp(-t / 0.03) * punch
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.16)
    click = rng.standard_normal(len(t)) * np.exp(-t / 0.004) * 0.35
    return np.tanh((body + click) * 1.6) * 0.9


def layer(*sounds):
    """Sounds played together, however long each is."""
    n = max(len(x) for x in sounds)
    return sum(np.pad(x, (0, n - len(x))) for x in sounds)


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def bandpass(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], btype='band', fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def highpass(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype='high', fs=SR, output='sos'), x)


def lowpass(x, f, order=2):
    return signal.sosfilt(signal.butter(order, min(f, SR / 2 - 100), btype='low', fs=SR, output='sos'), x)


def sweep_lowpass(x, f0, f1, block=512):
    """A low-pass whose cutoff moves from f0 to f1 (exponentially) across x."""
    out = np.zeros_like(x)
    zi = None
    nb = max(1, int(np.ceil(len(x) / block)))
    for b in range(nb):
        f = f0 * (f1 / f0) ** (b / max(1, nb - 1))
        sos = signal.butter(2, min(f, SR / 2 - 200), btype='low', fs=SR, output='sos')
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        seg = x[b * block:(b + 1) * block]
        y, zi = signal.sosfilt(sos, seg, zi=zi)
        out[b * block:b * block + len(seg)] = y
    return out


def clap(dur=0.35, bright=1.0):
    t = tnum(dur)
    n = bandpass(noise(dur), 900, 5000 * bright)
    env = np.zeros(len(t))
    for d in (0.0, 0.011, 0.022):  # a clap is a few hands a moment apart
        i = int(d * SR)
        env[i:] += np.exp(-(t[: len(t) - i]) / (0.006 if d < 0.02 else 0.09))
    return n * env * 0.7


def snare(dur=0.3, tone=185.0):
    t = tnum(dur)
    body = np.sin(2 * np.pi * tone * t) * np.exp(-t / 0.05) * 0.6
    rattle = highpass(noise(dur), 1800) * np.exp(-t / 0.09) * 0.55
    return np.tanh((body + rattle) * 1.4) * 0.8


def hat(open_=False):
    dur = 0.32 if open_ else 0.06
    t = tnum(dur)
    n = highpass(noise(dur), 7000, 4)
    return n * np.exp(-t / (0.12 if open_ else 0.018)) * (0.35 if open_ else 0.3)


def crash(dur=2.4):
    t = tnum(dur)
    n = highpass(noise(dur), 4000, 2) + 0.3 * bandpass(noise(dur), 2500, 9000)
    return n * np.exp(-t / 0.7) * 0.32


def impact(dur=1.6):
    t = tnum(dur)
    f = 30 + 70 * np.exp(-t / 0.08)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.5)
    hiss = lowpass(noise(dur), 1500) * np.exp(-t / 0.25) * 0.4
    return np.tanh((boom + hiss) * 1.5) * 0.9


def riser(dur):
    """White noise sweeping up, with a tone rising an octave and a half under it: the build into the drop."""
    t = tnum(dur)
    nz = noise(dur)
    out = np.zeros_like(nz)
    block = 1024
    for b in range(0, len(nz), block):
        k = b / len(nz)
        lo = 300 * (40 ** k)
        out[b:b + block] = bandpass(nz[b:b + block], lo, min(lo * 3, 18000))
    tone = np.sin(2 * np.pi * np.cumsum(220 * 2 ** (1.5 * t / dur)) / SR) * 0.15
    env = (t / dur) ** 2
    return (out * 0.5 + tone) * env


def saw(f, t, detune=0.0):
    ph = (f * (1 + detune)) * t + rng.random()
    return 2 * (ph % 1.0) - 1


def supersaw(midis, dur, voices=5, spread=0.012, attack=0.01, release=0.1):
    t = tnum(dur)
    left = np.zeros(len(t))
    right = np.zeros(len(t))
    for m in midis:
        for v in range(voices):
            d = spread * (v - (voices - 1) / 2) / ((voices - 1) / 2)
            s = saw(hz(m), t, d)
            pan = (v / (voices - 1)) * 2 - 1
            left += s * np.sqrt((1 - pan) / 2)
            right += s * np.sqrt((1 + pan) / 2)
    env = np.minimum(1, t / attack) * np.minimum(1, np.maximum(0, (dur - t) / release))
    k = 1 / (len(midis) * voices) * 1.6
    return np.vstack([left * env * k, right * env * k])


def pluck(midi, dur=0.35, bright=4000):
    t = tnum(dur)
    s = saw(hz(midi), t) * 0.6 + saw(hz(midi), t, 0.006) * 0.6
    s = sweep_lowpass(s, bright, 300)
    return s * np.exp(-t / (dur / 3))


def bell(midi, dur=1.2):
    t = tnum(dur)
    f = hz(midi)
    mod = np.sin(2 * np.pi * f * 3.5 * t) * 2.2 * np.exp(-t / 0.3)
    return np.sin(2 * np.pi * f * t + mod) * np.exp(-t / 0.45) * 0.5


def sub(midi, dur, glide_from=None, drive=1.0):
    t = tnum(dur)
    f = np.full(len(t), hz(midi))
    if glide_from is not None:
        f = hz(midi) + (hz(glide_from) - hz(midi)) * np.exp(-t / 0.06)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR)
    env = np.minimum(1, t / 0.005) * np.minimum(1, np.maximum(0, (dur - t) / 0.04))
    return np.tanh(s * 2.2 * drive) * env * 0.55


def house_bass(midi, dur):
    t = tnum(dur)
    s = saw(hz(midi), t) * 0.5 + np.sin(2 * np.pi * hz(midi) * t)
    s = sweep_lowpass(s, 1800, 250)
    return np.tanh(s * 1.5) * np.exp(-t / 0.18) * 0.5


def chant(midi, dur, vowel='o'):
    """A wordless crowd-like "ooh": several detuned saws through two formant bands, a little vibrato."""
    t = tnum(dur)
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.2 * t)
    s = np.zeros(len(t))
    for d in (-0.008, -0.003, 0.0, 0.004, 0.009):
        ph = np.cumsum(hz(midi) * (1 + d) * vib) / SR + rng.random()
        s += 2 * (ph % 1.0) - 1
    f1, f2 = (450, 800) if vowel == 'o' else (700, 1150)
    v = bandpass(s, f1 * 0.8, f1 * 1.2) * 1.0 + bandpass(s, f2 * 0.85, f2 * 1.15) * 0.6
    env = np.minimum(1, t / 0.12) * np.minimum(1, np.maximum(0, (dur - t) / 0.25))
    return v * env * 0.5


def brass(midi, dur):
    t = tnum(dur)
    s = saw(hz(midi), t) + saw(hz(midi), t, 0.004) + 0.5 * saw(hz(midi + 12), t, -0.003)
    env = np.minimum(1, t / 0.04) * np.minimum(1, np.maximum(0, (dur - t) / 0.08))
    s = sweep_lowpass(s * env, 900, 3200)
    return s * 0.28


def reverb(x, secs=2.2, wet=0.25, seed=3):
    """A plate-ish reverb: the sound convolved with decaying noise, a different tail on each side."""
    r = np.random.default_rng(seed)
    n = int(secs * SR)
    t = np.arange(n) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = r.standard_normal(n) * np.exp(-t / (secs / 5))
        ir = lowpass(ir, 6000)
        ir /= np.sqrt(np.sum(ir ** 2))
        out[ch] = signal.fftconvolve(x[ch], ir)[: x.shape[1]]
    return x * (1 - wet) + out * wet * 1.4


def duck(mix, kicks, depth=0.6, release=0.16):
    """Side-chain: everything on these buses dips under each kick and comes back up (the pumping in dance music)."""
    g = np.ones(mix.n)
    rel = int(release * SR)
    curve = 1 - depth * (1 - np.arange(rel) / rel) ** 2
    for at in kicks:
        i = int(at * SR)
        j = min(mix.n, i + rel)
        g[i:j] = np.minimum(g[i:j], curve[: j - i])
    return g


def master(mix, name, duck_buses=(), kicks=(), fade=None, gains=None):
    gains = gains or {}
    total = np.zeros((2, mix.n))
    g = duck(mix, kicks) if kicks else None
    for bus, x in mix.buses.items():
        y = x * gains.get(bus, 1.0)
        if g is not None and bus in duck_buses:
            y = y * g
        total += y
    total = highpass(total, 28)
    if fade:
        a, b = int(fade[0] * SR), min(mix.n, int(fade[1] * SR))
        total[:, a:b] *= np.linspace(1, 0, b - a) ** 1.5
        total[:, b:] = 0
    total = np.tanh(total * 1.2) / np.tanh(1.2)  # gentle saturation keeps it loud without clipping
    total *= 0.89 / np.max(np.abs(total))
    write(name, total)
    return total


def write(name, x):
    os.makedirs(OUT, exist_ok=True)
    pcm = (np.clip(x.T, -1, 1) * 32767).astype('<i2')
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, name + '.wav')
        with wave.open(wav, 'wb') as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        out = os.path.join(OUT, name + '.m4a')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], check=True)
    print(f'{name}.m4a  {x.shape[1] / SR:.3f} s')


# ---- the tracks

def floodlights():
    """128 bpm house in A minor. Build bars 0-7 (the filter opens, kick and a snare roll come in, a beat of silence),
    the drop bars 8-15, then a held chord to the end card (bars 16-18)."""
    m = Mix(128, 19)
    prog = [[57, 60, 64, 69], [53, 57, 60, 65], [55, 60, 64, 67], [55, 59, 62, 67]]  # Am F C G
    roots = [33, 29, 36, 31]
    bar = 4 * m.beat
    # build: pads opening up
    pads = np.zeros((2, int(8 * bar * SR)))
    for b in range(8):
        s = supersaw(prog[b % 4], bar + 0.05)
        i = int(b * bar * SR)
        pads[:, i:i + s.shape[1]] += s[:, : pads.shape[1] - i]
    for ch in range(2):
        pads[ch] = sweep_lowpass(pads[ch], 350, 4500)
    pads[:, int((8 * bar - m.beat) * SR):] = 0  # the gap before the drop
    m.add('pad', pads, 0, 0.7)
    for b in range(2, 8):
        for q in range(4):
            if b == 7 and q == 3:
                continue
            m.add('hat', hat(), m.t(b, q + 0.5), 0.8, 0.3)
    for b in range(4, 7):
        for q in range(4):
            m.add('kick', kick(0.7), m.t(b, q), 0.75)
    for q in range(0, 8):
        m.add('drum', snare(), m.t(6, q * 0.5), 0.25 + 0.03 * q)
    for q in range(0, 12):
        m.add('drum', snare(), m.t(7, q * 0.25), 0.4 + 0.04 * q)
    m.add('fx', riser(4 * bar - m.beat), m.t(4), 0.55)
    # drop
    kicks = []
    stab = [0, 0.75, 1.5, 2.5, 3.0]  # where the chord stabs land in each bar
    for b in range(8, 16):
        ch = prog[b % 4]
        for q in range(4):
            m.add('kick', kick(), m.t(b, q))
            kicks.append(m.t(b, q))
            m.add('bass', house_bass(roots[b % 4] + 12, m.beat * 0.45), m.t(b, q + 0.5), 0.9)
            m.add('hat', hat(True), m.t(b, q + 0.5), 0.6, -0.2)
            for s16 in (0.25, 0.75):
                m.add('hat', hat(), m.t(b, q + s16), 0.45, 0.4)
        for q in (1, 3):
            m.add('drum', clap(), m.t(b, q), 0.75)
        for s in stab:
            for note in ch:
                m.add('lead', pluck(note + 12, 0.3), m.t(b, s), 0.32, (note % 3 - 1) * 0.3)
        m.add('pad', supersaw(ch, bar + 0.02), m.t(b), 0.35)
        m.add('sub', sub(roots[b % 4], bar), m.t(b), 0.6)
    for b in (8, 12):
        m.add('fx', crash(), m.t(b), 0.8)
    m.add('fx', impact(), m.t(8), 0.9)
    # outro: the chord rings out under the end card
    m.add('kick', kick(), m.t(16))
    m.add('fx', crash(3.5), m.t(16), 0.8)
    m.add('pad', reverb(supersaw(prog[0], 3 * bar - 0.4, release=1.5), 3.0, 0.5), m.t(16), 0.75)
    m.add('sub', sub(roots[0], 1.6), m.t(16), 0.6)
    for i, n in enumerate([81, 76, 72, 69]):
        m.add('lead', reverb(np.vstack([pluck(n, 0.6)] * 2), 2.5, 0.6), m.t(16, i * 0.75), 0.25)
    m.buses['drum'] = reverb(m.buses['drum'], 1.2, 0.18)
    m.buses['lead'] = reverb(m.buses['lead'], 1.6, 0.25)
    master(m, 'floodlights', duck_buses=('pad', 'bass', 'lead', 'sub'), kicks=kicks, fade=(m.t(17, 2), m.t(19)),
           gains={'pad': 0.8, 'sub': 0.9})


def last_minute():
    """140 bpm half-time trap in C minor. Build bars 0-3 (bells and hats, a riser, a beat of silence), the drop bars
    4-11 with sliding 808s, then the bells ring out to the end card (bars 12-14)."""
    m = Mix(140, 15)
    roots = [36, 32, 29, 31]  # C, Ab, F, G (for the 808, an octave up so phones can play it)
    chords = [[60, 63, 67], [56, 60, 63], [53, 56, 60], [55, 59, 62]]
    melody = [[72, 75, 79, 75, 74, 75, 72, 70], [68, 72, 75, 72, 70, 72, 68, 67],
              [65, 68, 72, 68, 67, 68, 65, 63], [67, 71, 74, 71, 74, 75, 74, 71]]
    bar = 4 * m.beat
    for b in range(15):
        if b >= 13:
            break
        for i, n in enumerate(melody[b % 4]):
            if b == 3 and i >= 6:
                continue
            m.add('bell', bell(n), m.t(b, i * 0.5), 0.55 if b >= 4 else 0.45, 0.25 if i % 2 else -0.25)
        pad = supersaw(chords[b % 4], bar + 0.05, voices=3, spread=0.006, attack=0.3, release=0.3)
        for ch in range(2):
            pad[ch] = lowpass(pad[ch], 1100 if b < 4 else 1600)
        if b == 3:
            pad[:, int(3 * m.beat * SR):] = 0
        m.add('pad', pad, m.t(b), 0.5)
    for b in range(2, 4):
        for e in range(8):
            if b == 3 and e >= 6:
                continue
            m.add('hat', hat(), m.t(b, e * 0.5), 0.7, 0.3)
    m.add('fx', riser(bar - m.beat), m.t(3), 0.6)
    m.add('fx', riser(2 * bar - m.beat) * 0.4, m.t(2), 0.4)
    # drop: 808 pattern (beat offsets in the bar, length in beats, slide from)
    kicks = []
    pattern = [(0, 1.4, None), (1.75, 0.6, None), (2.5, 1.4, 12)]
    for b in range(4, 12):
        r = roots[b % 4]
        for at, ln, slide in pattern:
            m.add('kick', kick(1.0, 0.25, 50), m.t(b, at), 0.8)
            kicks.append(m.t(b, at))
            m.add('808', sub(r, ln * m.beat, None if slide is None else r + slide, drive=1.6), m.t(b, at), 0.8)
        m.add('drum', layer(clap(0.4), snare(0.3)), m.t(b, 2), 0.8)
        # hats in sixteenths, with a triplet roll at the end of every other bar
        for s in range(16):
            if b % 2 == 1 and s >= 12:
                continue
            m.add('hat', hat(), m.t(b, s * 0.25), 0.55 if s % 2 == 0 else 0.35, 0.35)
        if b % 2 == 1:
            for k in range(6):
                m.add('hat', hat(), m.t(b, 3 + k / 6), 0.35 + 0.05 * k, 0.35)
    for b in (4, 8):
        m.add('fx', crash(), m.t(b), 0.7)
    m.add('fx', impact(), m.t(4), 0.9)
    # outro
    m.add('808', sub(roots[0], 2.4, drive=1.4), m.t(12), 0.8)
    m.add('kick', kick(), m.t(12))
    m.add('fx', crash(3.0), m.t(12), 0.6)
    m.buses['bell'] = reverb(m.buses['bell'], 2.4, 0.35)
    m.buses['drum'] = reverb(m.buses['drum'], 1.0, 0.15)
    master(m, 'last-minute', duck_buses=('pad', 'bell'), kicks=kicks, fade=(m.t(13, 2), m.t(15)), gains={'808': 1.0})


def terrace():
    """100 bpm stomp-and-clap anthem in D major, with a wordless crowd "ooh". Build bars 0-3 (stomps, claps, the
    chant, a snare roll, a beat of silence), the drop bars 4-9 with big drums and brass, then the chant rings out to
    the end card (bars 10-11)."""
    m = Mix(100, 12)
    prog = [[62, 66, 69], [61, 64, 69], [59, 62, 66], [59, 62, 67]]  # D A Bm G
    roots = [38, 33, 35, 31]
    tune = [[(0, 74, 1.5), (1.5, 76, 0.5), (2, 78, 2)], [(0, 76, 1.5), (1.5, 74, 0.5), (2, 73, 2)],
            [(0, 74, 1), (1, 71, 1), (2, 74, 2)], [(0, 71, 1), (1, 74, 1), (2, 79, 1.5), (3.5, 78, 0.5)]]
    bar = 4 * m.beat
    kicks = []
    for b in range(4):
        for q in (0, 2):
            m.add('kick', kick(0.5, 0.5, 52), m.t(b, q), 0.9)
            kicks.append(m.t(b, q))
        for q in (1, 3):
            if b == 3 and q == 3:
                continue
            m.add('drum', clap(0.45, 0.8), m.t(b, q), 0.7)
        for at, n, ln in tune[b]:
            if b == 3 and at >= 3:
                continue
            m.add('chant', np.vstack([chant(n - 12, ln * m.beat + 0.1)] * 2), m.t(b, at), 0.75)
    for k in range(8):
        m.add('drum', snare(), m.t(3, 2 + k * 0.125), 0.3 + 0.06 * k)
    m.add('fx', riser(2 * bar - m.beat), m.t(2), 0.4)
    for b in range(4, 10):
        r = roots[b % 4]
        for q in range(4):
            m.add('kick', kick(1.0, 0.45, 48), m.t(b, q), 0.9 if q % 2 == 0 else 0.6)
            kicks.append(m.t(b, q))
            m.add('bass', house_bass(r, m.beat * 0.9), m.t(b, q), 0.8)
        for q in (1, 3):
            m.add('drum', layer(snare(0.4), clap(0.35)), m.t(b, q), 0.9)
        for e in range(8):
            m.add('hat', hat(e % 2 == 1), m.t(b, e * 0.5), 0.5, 0.3)
        for at, n, ln in tune[b % 4]:
            m.add('lead', np.vstack([brass(n, ln * m.beat)] * 2), m.t(b, at), 0.8)
            m.add('chant', np.vstack([chant(n - 12, ln * m.beat + 0.1, 'a')] * 2), m.t(b, at), 0.55)
        m.add('pad', supersaw(prog[b % 4], bar, voices=3, spread=0.008, attack=0.05), m.t(b), 0.35)
        if b == 9:
            for k, tom in enumerate([50, 47, 43, 40]):
                m.add('drum', kick(0.3, 0.3, hz(tom)) * 0.6, m.t(b, 3 + k * 0.25), 0.8)
    for b in (4, 8):
        m.add('fx', crash(), m.t(b), 0.8)
    m.add('fx', impact(), m.t(4), 0.9)
    m.add('kick', kick(), m.t(10))
    m.add('fx', crash(3.5), m.t(10), 0.8)
    m.add('chant', reverb(np.vstack([chant(62, 2 * bar - 0.5)] * 2), 3.0, 0.5), m.t(10), 0.8)
    m.add('pad', reverb(supersaw(prog[0], 2 * bar - 0.3, release=1.5), 3.0, 0.5), m.t(10), 0.5)
    m.buses['drum'] = reverb(m.buses['drum'], 1.6, 0.25)
    m.buses['chant'] = reverb(m.buses['chant'], 2.5, 0.35)
    master(m, 'terrace', duck_buses=('pad', 'bass'), kicks=kicks, fade=(m.t(11), m.t(12)))


if __name__ == '__main__':
    which = sys.argv[1:] or ['floodlights', 'last-minute', 'terrace']
    for name in which:
        {'floodlights': floodlights, 'last-minute': last_minute, 'terrace': terrace}[name]()

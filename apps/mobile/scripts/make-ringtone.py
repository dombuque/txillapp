# Uso: python scripts/make-ringtone.py assets/sounds/ring.wav android/app/src/main/res/raw/ring.wav
# Toque do Txillapp: um motivo de marimba (como a timbila moçambicana) com o ritmo "tx-i-lla-pp",
# com um shaker leve nos contratempos. Gerado por código: sem amostras de terceiros.
import math, random, struct, sys, wave

SR = 22050
BEAT = 60 / 132 / 2          # colcheia a 132 bpm
LOOP = BEAT * 12             # um ciclo do motivo (2,7 s)
CYCLES = 6
TOTAL = LOOP * CYCLES + 1.2  # ~17,6 s (o Android toca o som do canal uma vez)

N = {'G4': 392.0, 'D5': 587.33, 'G5': 783.99, 'A5': 880.0, 'B5': 987.77, 'D6': 1174.66, 'E6': 1318.51, 'G6': 1567.98}

# (colcheia, nota, força): "tx - i - lla - pp" e a resposta.
MOTIF = [
    (0, 'G5', 0.8), (1, 'B5', 0.75), (2, 'D6', 1.0), (3, 'E6', 0.9), (3, 'B5', 0.5),
    (6, 'D6', 0.85), (7, 'B5', 0.75), (8, 'G5', 0.9), (8, 'G4', 0.55), (9, 'D5', 0.45),
]

buf = [0.0] * int(TOTAL * SR)

def marimba(t0, f, amp):
    start = int(t0 * SR)
    length = int(1.4 * SR)
    for i in range(length):
        j = start + i
        if j >= len(buf):
            break
        t = i / SR
        att = min(1.0, t / 0.003)
        # Fundamental com decaimento suave; o 4.º harmónico (típico da marimba) cai depressa; um toque de 10x no ataque.
        v = (math.sin(2 * math.pi * f * t) * math.exp(-t / 0.42)
             + 0.35 * math.sin(2 * math.pi * 4 * f * t) * math.exp(-t / 0.07)
             + 0.12 * math.sin(2 * math.pi * 9.8 * f * t) * math.exp(-t / 0.015))
        buf[j] += amp * att * v

random.seed(7)
def shaker(t0, amp):
    start = int(t0 * SR)
    prev = 0.0
    for i in range(int(0.09 * SR)):
        j = start + i
        if j >= len(buf):
            break
        t = i / SR
        n = random.uniform(-1, 1)
        hp = n - prev  # passa-altos simples: só o "chiar"
        prev = n
        buf[j] += amp * hp * math.exp(-t / 0.025) * min(1.0, t / 0.004)

for c in range(CYCLES):
    base = c * LOOP
    for step, note, vel in MOTIF:
        marimba(base + step * BEAT, N[note], 0.32 * vel)
    for k in range(12):
        if k % 2 == 1:
            shaker(base + k * BEAT, 0.05 if k % 4 == 1 else 0.035)

# Normaliza para -1 dBFS e desvanece o último segundo.
peak = max(abs(x) for x in buf) or 1.0
g = 0.89 / peak
fade = int(1.0 * SR)
out = bytearray()
for i, x in enumerate(buf):
    if i > len(buf) - fade:
        x *= (len(buf) - i) / fade
    out += struct.pack('<h', max(-32767, min(32767, int(x * g * 32767))))

for path in sys.argv[1:]:
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(out))
print('ok', round(len(buf) / SR, 1), 's')

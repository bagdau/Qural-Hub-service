"""Генерация тестовых изображений QR для E2E: «камера» (y4m) и ухудшенные фото (плохая погода, свет, блики).
Запуск (внутри образа backend, где есть segno и Pillow):
  docker run --rm -v <repo>:/w alageum/backend:0.1.0 python /w/scripts/make_qr_fixtures.py
"""
import io
import math
import os
import random

import segno
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

OUT = os.environ.get("OUT", "/w/frontend/e2e/fixtures")
URL = "http://web:8080/e/DEMOEQUIP009"
random.seed(7)
os.makedirs(OUT, exist_ok=True)


def qr_image(side: int) -> Image.Image:
    buf = io.BytesIO()
    segno.make(URL, error="q").save(buf, kind="png", scale=8, border=4)
    return Image.open(buf).convert("RGB").resize((side, side), Image.NEAREST)


def on_canvas(w: int, h: int, side: int, angle: float = 0, bg=(235, 235, 232)) -> Image.Image:
    c = Image.new("RGB", (w, h), bg)
    q = qr_image(side)
    if angle:
        q = q.rotate(angle, expand=True, fillcolor=bg, resample=Image.BICUBIC)
    c.paste(q, ((w - q.width) // 2, (h - q.height) // 2))
    return c


def noise(img: Image.Image, amount: int) -> Image.Image:
    n = Image.effect_noise(img.size, amount).convert("RGB")
    return ImageChops.add(img, n, scale=1, offset=-128)


# --- «камера»: 640×480, QR посередине, несколько кадров с микросдвигом ---
def write_y4m(path: str, frames: int = 8, w: int = 640, h: int = 480):
    with open(path, "wb") as f:
        f.write(f"YUV4MPEG2 W{w} H{h} F30:1 Ip A1:1 C420jpeg\n".encode())
        for i in range(frames):
            img = on_canvas(w, h, 330, angle=math.sin(i / 3) * 1.5, bg=(240, 240, 238))
            ycc = img.convert("YCbCr")
            y, cb, cr = ycc.split()
            f.write(b"FRAME\n")
            f.write(y.tobytes())
            f.write(cb.resize((w // 2, h // 2), Image.BILINEAR).tobytes())
            f.write(cr.resize((w // 2, h // 2), Image.BILINEAR).tobytes())


write_y4m(f"{OUT}/qr.y4m")

# --- ухудшенные фото ---
base = on_canvas(900, 700, 420, angle=9)
base.save(f"{OUT}/qr-clean.png")

# дождь/туман: размытие + снижение контраста + струйки
fog = ImageEnhance.Contrast(base.filter(ImageFilter.GaussianBlur(2.2))).enhance(0.45)
d = ImageDraw.Draw(fog, "RGBA")
for _ in range(90):
    x = random.randint(0, 900)
    d.line([(x, 0), (x + 24, 700)], fill=(255, 255, 255, 40), width=1)
fog.save(f"{OUT}/qr-fog-rain.png")

# сумерки: тёмно + шум
dark = noise(ImageEnhance.Brightness(ImageEnhance.Contrast(base).enhance(0.6)).enhance(0.28), 34)
dark.save(f"{OUT}/qr-lowlight.png")

# блик: яркое пятно поверх части кода (не перекрывая его целиком)
glare = base.copy()
g = Image.new("RGBA", glare.size, (0, 0, 0, 0))
gd = ImageDraw.Draw(g)
for r in range(260, 0, -8):
    a = int(210 * (1 - r / 260) ** 0.6)
    gd.ellipse((200 - r, 170 - r, 200 + r, 170 + r), fill=(255, 255, 255, a))
glare = Image.alpha_composite(glare.convert("RGBA"), g).convert("RGB")
glare.save(f"{OUT}/qr-glare.png")

# шум + лёгкая размытость + повернуто
rough = noise(base.filter(ImageFilter.GaussianBlur(1.4)), 40)
rough.save(f"{OUT}/qr-noise.png")

# «не QR»: пустое изображение
Image.new("RGB", (800, 600), (200, 200, 200)).save(f"{OUT}/not-a-qr.png")
# сырые RGBA-копии для модульных тестов декодера (без браузера)
for name in ("qr-clean", "qr-fog-rain", "qr-lowlight", "qr-glare", "qr-noise", "not-a-qr"):
    im = Image.open(f"{OUT}/{name}.png").convert("RGBA")
    with open(f"{OUT}/{name}.rgba", "wb") as f:
        f.write(im.width.to_bytes(4, "little") + im.height.to_bytes(4, "little") + im.tobytes())
print("fixtures:", sorted(os.listdir(OUT)))

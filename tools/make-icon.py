"""Draws the app icon (resources/icon.png and resources/icon.ico). Run once: python tools/make-icon.py"""
from PIL import Image, ImageDraw, ImageFont
import os

SIZE = 512
img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((16, 16, SIZE - 16, SIZE - 16), radius=96, fill=(58, 58, 140, 255))      # haematoxylin violet-blue
d.rounded_rectangle((16, SIZE - 150, SIZE - 16, SIZE - 16), radius=96, fill=(194, 24, 91, 255))  # eosin pink band
d.rectangle((16, SIZE - 150, SIZE - 16, SIZE - 110), fill=(194, 24, 91, 255))

font = None
for name in ('arialbd.ttf', 'segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/segoeuib.ttf'):
    try:
        font = ImageFont.truetype(name, 190)
        break
    except OSError:
        continue
if font is None:
    font = ImageFont.load_default()
text = 'KDS'
box = d.textbbox((0, 0), text, font=font)
w, h = box[2] - box[0], box[3] - box[1]
d.text(((SIZE - w) / 2 - box[0], 70 - box[1]), text, font=font, fill=(255, 255, 255, 255))
# a small test tube / drop mark in the pink band
d.ellipse((SIZE / 2 - 34, SIZE - 128, SIZE / 2 + 34, SIZE - 60), fill=(255, 255, 255, 255))
d.polygon([(SIZE / 2, SIZE - 150), (SIZE / 2 - 28, SIZE - 98), (SIZE / 2 + 28, SIZE - 98)], fill=(255, 255, 255, 255))

here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, '..', 'resources')
os.makedirs(out, exist_ok=True)
img.save(os.path.join(out, 'icon.png'))
img.save(os.path.join(out, 'icon.ico'), sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print('icon written to', os.path.normpath(out))

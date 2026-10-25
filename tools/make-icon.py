"""The logo lives in resources/logo.svg (also embedded in src/shared/reportHtml.ts).
icon.png / icon.ico are rendered from it: open the SVG in Electron/Chrome at 512 px, save as resources/icon.png,
then run this script to write the multi-size icon.ico."""
from PIL import Image
import os
here = os.path.dirname(os.path.abspath(__file__))
res = os.path.join(here, '..', 'resources')
Image.open(os.path.join(res, 'icon.png')).convert('RGBA').save(os.path.join(res, 'icon.ico'), sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print('icon.ico written')

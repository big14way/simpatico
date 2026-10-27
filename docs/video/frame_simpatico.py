"""Frame a UI screenshot for a slide panel on Simpatico's dark canvas with a soft blue light.
python3 frame_simpatico.py in.png out.jpg [crop x,y,w,h]   (panel aspect 710:750, rendered at 2x)"""
import sys
from PIL import Image, ImageDraw, ImageFilter
W, H, M = 1420, 1500, 70
src = Image.open(sys.argv[1]).convert("RGB")
if len(sys.argv) > 3:
    x, y, w, h = map(int, sys.argv[3].split(","))
    src = src.crop((x, y, x + w, y + h))
canvas = Image.new("RGB", (W, H), (11, 11, 12))
glow = Image.new("RGB", (W, H), (11, 11, 12))
ImageDraw.Draw(glow).ellipse((-300, -400, 900, 700), fill=(18, 44, 82))
canvas = Image.blend(canvas, glow.filter(ImageFilter.GaussianBlur(180)), 0.9)
scale = min((W - 2 * M) / src.width, (H - 2 * M) / src.height)
im = src.resize((int(src.width * scale), int(src.height * scale)), Image.LANCZOS)
x0, y0 = (W - im.width) // 2, (H - im.height) // 2
mask = Image.new("L", im.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=26, fill=255)
shadow = Image.new("L", (W, H), 0)
ImageDraw.Draw(shadow).rounded_rectangle((x0 - 10, y0 + 20, x0 + im.width + 10, y0 + im.height + 40), radius=30, fill=160)
canvas.paste((0, 0, 0), (0, 0), shadow.filter(ImageFilter.GaussianBlur(40)))
canvas.paste(im, (x0, y0), mask)
ImageDraw.Draw(canvas).rounded_rectangle((x0, y0, x0 + im.width - 1, y0 + im.height - 1), radius=26, outline=(47, 50, 56), width=2)
canvas.save(sys.argv[2], quality=92)

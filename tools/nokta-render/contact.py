"""A contact sheet of the rendered frames, to look at them all at once: python contact.py <frames dir> <out.png> [frame]"""
import glob
import os
import sys

from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
frame = sys.argv[3] if len(sys.argv) > 3 else 'neutral-open'
folders = sorted(d for d in glob.glob(os.path.join(src, '*')) if os.path.exists(os.path.join(d, frame + '.png')))
cols = 6
size = 256
rows = (len(folders) + cols - 1) // cols
sheet = Image.new('RGB', (cols * size, rows * (size + 22)), (28, 28, 30))
draw = ImageDraw.Draw(sheet)
for i, folder in enumerate(folders):
    im = Image.open(os.path.join(folder, frame + '.png')).convert('RGBA').resize((size, size), Image.LANCZOS)
    x, y = (i % cols) * size, (i // cols) * (size + 22)
    sheet.paste(im, (x, y), im)
    draw.text((x + 8, y + size + 4), os.path.basename(folder), fill=(200, 200, 200))
sheet.save(out)
print(len(folders), 'looks ->', out)

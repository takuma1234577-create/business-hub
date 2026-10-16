# リッチメニュー「①筋トレ情報」の左下パネル（大会スケジュール）を「合トレ仲間を探す」に描き替える
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageStat
im = Image.open('info-current.jpg').convert('RGB')
px0, py0, px1, py1 = 62, 953, 832, 1597
cx = (px0 + px1) // 2
# 文字とアイコンの範囲を、パネル背景の色（文字の無い所の中央値）で塗り、境目だけ少しなじませる
er = (px0 + 6, py0 + 50, px1 - 6, py1 - 20)
orig = im.crop(er)
samp = im.crop((px0 + 10, py0 + 10, px1 - 10, py0 + 45))
col = tuple(int(c) for c in ImageStat.Stat(samp).median)
fill = Image.new('RGB', orig.size, col)
mask = Image.new('L', orig.size, 0)
ImageDraw.Draw(mask).rectangle((12, 12, orig.size[0] - 12, orig.size[1] - 12), fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(8))
im.paste(Image.composite(fill, orig, mask), er[:2])
d = ImageDraw.Draw(im)
serif = ImageFont.truetype('/System/Library/Fonts/Supplemental/Didot.ttc', 66)
bold = ImageFont.truetype('/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc', 70)
def ctext(y, s, f, fill=(255, 255, 255)):
    w = d.textlength(s, font=f)
    d.text((cx - w / 2, y), s, font=f, fill=fill)
# ほかのパネル（tools/alert）と同じ縦位置: 英字 y≈1030、見出し y≈1120、アイコン y≈1290〜1470
ctext(1022, 'partner', serif, (240, 240, 240))
ctext(1118, '合トレ仲間を探す', bold)
lw = 13
def person(x, top, s):
    r = int(36 * s)
    d.ellipse((x - r, top, x + r, top + 2 * r), outline='white', width=lw)
    bw = int(78 * s); st = top + 2 * r + 18; h = int(92 * s)
    d.rounded_rectangle((x - bw, st, x + bw, st + 2 * h), radius=bw, outline='white', width=lw)
    # 下半分を消して肩と胴だけにする
    d.rectangle((x - bw - lw, st + h + 10, x + bw + lw, st + 2 * h + lw), fill=None)
top = 1290
# 後ろの人（少し小さく）を先に、手前の人を後に
def person2(x, top, s, cover=False):
    r = int(36 * s)
    head = (x - r, top, x + r, top + 2 * r)
    bw = int(80 * s); st = top + 2 * r + 16; h = int(95 * s)
    body = (x - bw, st, x + bw, st + 2 * h)
    if cover:
        d.ellipse(head, fill=None)
    d.ellipse(head, outline='white', width=lw)
    d.pieslice(body, 180, 360, outline='white', width=lw)
    d.line((x - bw, st + h, x + bw, st + h), fill='white', width=lw)
person2(cx - 70, top, 1.0)
person2(cx + 70, top, 1.0)
im.save('info-gotore.jpg', quality=90)
im.crop((0, 900, 1300, 1686)).save('preview-bottom.jpg', quality=85)

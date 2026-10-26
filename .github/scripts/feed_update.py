# 블로그 최근 글을 RSS로 읽어 썸네일을 받아 두고 feed/feed.json에 쓴다. GitHub Actions가 매일 돌린다(.github/workflows/feed.yml).
# 원본 = Drive 홈페이지 작업폴더 _피드갱신.py (출력 위치만 다르다)
import json, pathlib, re, html, io, urllib.request, email.utils
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "feed"; OUT.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141 Safari/537.36"}
SOURCES = [  # (채널 이름, RSS 주소, 가져올 글 수)
    ("네이버 블로그", "https://rss.blog.naver.com/tax4320.xml", 6),
    ("티스토리", "https://ctasjpark.com/rss", 3),
    ("티스토리", "https://111.ctasjpark.com/rss", 3),
]

def get(url, ref=None):
    h = dict(UA)
    if ref: h["Referer"] = ref
    return urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30).read()

def tag(it, name):
    m = re.search(rf"<{name}>(.*?)</{name}>", it, re.S)
    if not m: return ""
    v = m.group(1).strip()
    v = re.sub(r"^<!\[CDATA\[(.*)\]\]>$", r"\1", v, flags=re.S)
    return html.unescape(v).strip()

def first_img(it, link):
    d = html.unescape(it)
    for m in re.finditer(r"""\ssrc=["'](https?://[^"']+\.(?:png|jpe?g|webp|gif)[^"']*)""", d, re.I):  # onerror 안의 대체 그림은 건너뛴다
        if "no-image" not in m.group(1): return m.group(1)
    try:  # 본문에 그림이 없으면 글 페이지의 대표 이미지(og:image)
        page = get(link).decode("utf-8", "ignore")
        m = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', page)
        return html.unescape(m.group(1)) if m else ""
    except Exception:
        return ""

items = []
for ch, url, n in SOURCES:
    xml = get(url).decode("utf-8", "ignore")
    for it in re.findall(r"<item>(.*?)</item>", xml, re.S)[:n]:
        link = tag(it, "link").split("?fromRss")[0]
        d = email.utils.parsedate_to_datetime(tag(it, "pubDate"))
        key = re.sub(r"\W", "", link)[-40:]
        thumb = ""
        src = first_img(it, link)
        if src:
            try:
                im = Image.open(io.BytesIO(get(src, ref=link))).convert("RGB")
                w, h = im.size; t = 16 / 9  # 가운데를 16:9로 잘라 640x360
                if w / h > t: im = im.crop(((w - h * t) / 2, 0, (w + h * t) / 2, h))
                else: im = im.crop((0, (h - w / t) / 2, w, (h + w / t) / 2))
                im = im.resize((640, 360), Image.LANCZOS)
                im.save(OUT / f"{key}.webp", "WEBP", quality=78); thumb = f"feed/{key}.webp"
            except Exception as e:
                print("썸네일 실패", link, e)
        items.append({"ch": ch, "title": tag(it, "title"), "link": link, "date": d.strftime("%Y.%m.%d"), "ts": d.timestamp(), "thumb": thumb})

items.sort(key=lambda x: -x["ts"])
# 지난 썸네일 중 지금 목록에 없는 것은 지운다
keep = {pathlib.Path(x["thumb"]).name for x in items if x["thumb"]}
for f in OUT.glob("*.webp"):
    if f.name not in keep: f.unlink()
(OUT / "feed.json").write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(items), "편", sum(1 for x in items if x["thumb"]), "썸네일")

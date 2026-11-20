"""Converte a cifra em PDF (cifra acima da letra) para JSON com posições de acordes por caractere."""
import json, re, sys
import pdfplumber

CHORD = r"[A-G](?:#|b)?(?:\([^)]*\)|maj7|m|sus4|sus2|dim|aug|°|º|\+|\d)*(?:/[A-G](?:#|b)?)?"
TOKEN_RE = re.compile(r"I|\d+/\d+|" + CHORD)


def split_tokens(text):
    """Divide um 'word' do PDF em tokens (barra 'I', compasso '3/8', acordes). Retorna None se não for cifra."""
    out, pos = [], 0
    while pos < len(text):
        m = TOKEN_RE.match(text, pos)
        if not m or m.end() == pos:
            return None
        out.append((m.start(), m.group()))
        pos = m.end()
    return out


def line_groups(page):
    chars = [c for c in page.chars if c["text"].strip() or c["text"] == " "]
    rows = {}
    for c in chars:
        key = round(c["top"])
        k2 = next((k for k in rows if abs(k - key) <= 2), key)
        rows.setdefault(k2, []).append(c)
    return [sorted(rows[k], key=lambda c: c["x0"]) for k in sorted(rows)]


def row_words(row):
    words, cur = [], []
    for c in row:
        if c["text"] == " ":
            if cur: words.append(cur); cur = []
            continue
        if cur and c["x0"] - cur[-1]["x1"] > 1.2:
            words.append(cur); cur = []
        cur.append(c)
    if cur: words.append(cur)
    return words


def chord_tokens(row):
    toks = []
    for w in row_words(row):
        text = "".join(c["text"] for c in w)
        sp = split_tokens(text)
        if sp is None:
            return None
        for i, t in sp:
            toks.append((w[i]["x0"], t))
    return toks


LEFT = 36.5
CW = 5.6  # largura média de caractere em pt


def lyric_string(row):
    """Reconstrói a linha de letra com espaços e guarda x de cada caractere."""
    s, xs, prev = "", [], None
    for c in row:
        if c["text"] == " ":
            continue
        if prev is not None and c["x0"] - prev["x1"] > 1.5:
            s += " "; xs.append(prev["x1"])
        s += c["text"]; xs.append(c["x0"])
        prev = c
    return s, xs, (prev["x1"] if prev else LEFT)


def place(tokens, xs, endx):
    out = []
    for x, t in tokens:
        if xs and x <= endx:
            idx = max(i for i in range(len(xs)) if xs[i] <= x + 1.5) if any(v <= x + 1.5 for v in xs) else 0
        elif xs:
            idx = len(xs) + max(0, round((x - endx) / CW))
        else:
            idx = max(0, round((x - LEFT) / CW))
        out.append([idx, t])
    return out


def parse(path):
    pdf = pdfplumber.open(path)
    versions, cur = [], None
    for page in pdf.pages:
        rows = line_groups(page)
        lines, last_top = [], None
        i = 0
        while i < len(rows):
            row = rows[i]
            top = row[0]["top"]
            size = row[0]["size"]
            text = "".join(c["text"] for c in row).strip()
            if not text:
                i += 1; continue
            if text.startswith("Nível:"):
                m = re.search(r"Nível:\s*([^/]+)/\s*Tonalidade:\s*(\S+)\s*\(\s*([\d/]+)\s*\)\s*t:\s*(\d+)", text.replace("  ", " "))
                cur = {"nivel": m.group(1).strip(), "tom": m.group(2), "compasso": m.group(3), "bpm": int(m.group(4)), "linhas": []}
                versions.append(cur)
                last_top = top; i += 1; continue
            if size > 11 or cur is None:  # título / autor
                i += 1; continue
            if last_top is not None and top - last_top > 20 and cur["linhas"]:
                cur["linhas"].append({"t": "blank"})
            last_top = top
            if text.startswith("Intro:"):
                body = [c for c in row if c["x0"] > row[0]["x0"] + 25]
                toks = chord_tokens(body)
                cur["linhas"].append({"t": "chords", "label": "Intro:", "c": place(toks, [], 0) if toks else []})
                i += 1; continue
            toks = chord_tokens(row)
            if toks:
                nxt = rows[i + 1] if i + 1 < len(rows) else None
                if nxt and nxt[0]["top"] - top < 16 and chord_tokens(nxt) is None and nxt[0]["size"] < 11:
                    s, xs, endx = lyric_string(nxt)
                    if not s.startswith("Nível"):
                        cur["linhas"].append({"t": "pair", "c": place(toks, xs, endx), "l": s})
                        last_top = nxt[0]["top"]; i += 2; continue
                cur["linhas"].append({"t": "chords", "c": place(toks, [], 0)})
                i += 1; continue
            s, _, _ = lyric_string(row)
            cur["linhas"].append({"t": "lyric", "l": s})
            i += 1
    for v in versions:
        clean = []
        for l in v["linhas"]:
            if l["t"] == "blank" and (not clean or clean[-1]["t"] == "blank"):
                continue
            clean.append(l)
        v["linhas"] = clean
        while v["linhas"] and v["linhas"][-1]["t"] == "blank":
            v["linhas"].pop()
    return versions


if __name__ == "__main__":
    vs = parse(sys.argv[1])
    json.dump(vs, open(sys.argv[2], "w"), ensure_ascii=False)
    for v in vs:
        print(v["nivel"], v["tom"], len(v["linhas"]))

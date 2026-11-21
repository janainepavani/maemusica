// Lê a cifra em PDF (modelo da Janaine: acordes acima da letra, barras "I", cabeçalho
// "Nível: ... / Tonalidade: X ( 6/8 ) t: 85bpm") e devolve as versões com a posição
// de cada acorde na letra, para o aplicativo trocar o tom e quebrar as linhas no celular.
// Mesmo algoritmo de tools/parse_cifra.py, escrito para rodar no navegador com o pdf.js.

// acorde: Aadd9, Bm7, D/E, Em(maj7), C7M, F#m7(b5), G°, A4, E9, Bbsus4, Dmaj7, C6/9...
const CHORD = "[A-G](?:#|b)?(?:\\([^)]*\\)|maj|min|dim|aug|sus|add|M|m|°|º|ø|\\+|-|\\d|/(?=\\d))*(?:/[A-G](?:#|b)?)?";
const TOKEN_RE = new RegExp("I|\\d+/\\d+|" + CHORD, "y");
const LEFT = 36.5, CW = 5.6;

// larguras relativas (Helvetica, em milésimos) para estimar a posição de cada letra dentro de um trecho
const W = {" ":278,"!":278,'"':355,"#":556,"$":556,"%":889,"&":667,"'":191,"(":333,")":333,"*":389,"+":584,",":278,"-":333,".":278,"/":278,
  "0":556,"1":556,"2":556,"3":556,"4":556,"5":556,"6":556,"7":556,"8":556,"9":556,":":278,";":278,"?":556,
  A:667,B:667,C:722,D:722,E:667,F:611,G:778,H:722,I:278,J:500,K:667,L:556,M:833,N:722,O:778,P:667,Q:778,R:722,S:667,T:611,U:722,V:667,W:944,X:667,Y:667,Z:611,
  a:556,b:556,c:500,d:556,e:556,f:278,g:556,h:556,i:222,j:222,k:500,l:222,m:833,n:556,o:556,p:556,q:556,r:333,s:500,t:278,u:556,v:500,w:722,x:500,y:500,z:500};
function cw(ch) {
  if (W[ch] != null) return W[ch];
  const base = ch.normalize("NFD")[0];
  return W[base] ?? 556;
}

function splitTokens(text) {
  const out = []; let pos = 0;
  while (pos < text.length) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(text);
    if (!m || m.index !== pos || !m[0].length) return null;
    out.push([pos, m[0]]); pos += m[0].length;
  }
  return out;
}

// transforma os trechos de texto do pdf.js em letras com posição (x0, x1, top, size)
function pageChars(items, pageH) {
  const chars = [];
  for (const it of items) {
    const s = it.str; if (!s) continue;
    const size = Math.hypot(it.transform[2], it.transform[3]) || Math.abs(it.transform[3]) || 10;
    const x = it.transform[4], top = pageH - it.transform[5] - size;
    const total = [...s].reduce((a, c) => a + cw(c), 0) || 1;
    const scale = (it.width || total * size / 1000) / total;
    let cx = x;
    for (const c of s) {
      const w = cw(c) * scale;
      chars.push({ text: c, x0: cx, x1: cx + w, top, size });
      cx += w;
    }
  }
  return chars;
}

function lineGroups(chars) {
  const rows = [];
  for (const c of chars) {
    if (!c.text.trim() && c.text !== " ") continue;
    const key = Math.round(c.top);
    let row = rows.find(r => Math.abs(r.key - key) <= 2);
    if (!row) { row = { key, chars: [] }; rows.push(row); }
    row.chars.push(c);
  }
  rows.sort((a, b) => a.key - b.key);
  return rows.map(r => r.chars.sort((a, b) => a.x0 - b.x0));
}

function rowWords(row) {
  const words = []; let cur = [];
  for (const c of row) {
    if (c.text === " ") { if (cur.length) { words.push(cur); cur = []; } continue; }
    if (cur.length && c.x0 - cur[cur.length - 1].x1 > 1.2) { words.push(cur); cur = []; }
    cur.push(c);
  }
  if (cur.length) words.push(cur);
  return words;
}

function chordTokens(row) {
  const toks = [];
  for (const w of rowWords(row)) {
    const text = w.map(c => c.text).join("");
    const sp = splitTokens(text);
    if (!sp) return null;
    for (const [i, t] of sp) toks.push([w[i].x0, t]);
  }
  return toks.length ? toks : null;
}

function lyricString(row) {
  let s = ""; const xs = []; let prev = null;
  for (const c of row) {
    if (c.text === " ") continue;
    if (prev && c.x0 - prev.x1 > 1.5) { s += " "; xs.push(prev.x1); }
    s += c.text; xs.push(c.x0); prev = c;
  }
  return { s, xs, endx: prev ? prev.x1 : LEFT };
}

function place(tokens, xs, endx) {
  return tokens.map(([x, t]) => {
    let idx;
    if (xs.length && x <= endx) {
      idx = 0;
      for (let i = 0; i < xs.length; i++) if (xs[i] <= x + 1.5) idx = i;
    } else if (xs.length) idx = xs.length + Math.max(0, Math.round((x - endx) / CW));
    else idx = Math.max(0, Math.round((x - LEFT) / CW));
    return [idx, t];
  });
}

const rowText = row => row.map(c => c.text).join("").normalize("NFC").trim();
const plain = t => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// "Nível: intermediário/ Tonalidade: D ( 6/8 ) t: 85bpm", aceitando acentos decompostos, espaços e partes faltando
function readHeader(text) {
  const p = plain(text).replace(/\s+/g, " ");
  if (!/^\s*nivel\s*:/.test(p)) return null;
  const m = p.match(/nivel\s*:\s*([^/]+?)\s*\/\s*tonalidade\s*:\s*([a-g][#b]?m?)\s*(?:\(\s*([\d/]+)\s*\))?\s*(?:t\s*:\s*(\d+))?/);
  if (!m) return null;
  const nivelP = m[1].trim();
  const nivel = nivelP.startsWith("inter") ? "intermediário" : nivelP.startsWith("simpl") ? "simplificado" : nivelP.startsWith("avan") ? "avançado" : nivelP.startsWith("inic") ? "iniciante" : nivelP.startsWith("fac") ? "fácil" : nivelP.startsWith("orig") ? "original" : nivelP.startsWith("bas") ? "básico" : nivelP;
  const tom = m[2].charAt(0).toUpperCase() + m[2].slice(1);
  return { nivel, tom, compasso: m[3] || "", bpm: m[4] ? +m[4] : "" };
}

// pdf: documento aberto com pdfjsLib.getDocument(...).promise
export async function parseCifraPdf(pdf) {
  const versions = []; let cur = null; let titulo = "", autor = ""; const amostra = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const rows = lineGroups(pageChars(tc.items, vp.height));
    let lastTop = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const text = rowText(row);
      if (!text) continue;
      const top = row[0].top, size = row[0].size;
      if (/^\s*nivel/.test(plain(text))) {
        const h = readHeader(text);
        if (!h) { amostra.push("cabeçalho não lido: " + text); continue; }
        cur = { ...h, linhas: [] };
        versions.push(cur); lastTop = top; continue;
      }
      if (amostra.length < 8) amostra.push(text);
      if (size > 11 || !cur) {
        if (!titulo && size > 20) titulo = text.replace(/\s+/g, " ");
        else if (titulo && !autor && size > 11 && size <= 20) autor = text.replace(/\s+/g, " ");
        continue;
      }
      if (lastTop != null && top - lastTop > 20 && cur.linhas.length) cur.linhas.push({ t: "blank" });
      lastTop = top;
      if (text.startsWith("Intro")) {
        const body = row.filter(c => c.x0 > row[0].x0 + 25);
        const toks = chordTokens(body);
        cur.linhas.push({ t: "chords", label: "Intro:", c: toks ? place(toks, [], 0) : [] });
        continue;
      }
      const toks = chordTokens(row);
      if (toks) {
        const nxt = rows[i + 1];
        if (nxt && nxt[0].top - top < 16 && !chordTokens(nxt) && nxt[0].size < 11 && !/^\s*nivel/.test(plain(rowText(nxt)))) {
          const { s, xs, endx } = lyricString(nxt);
          cur.linhas.push({ t: "pair", c: place(toks, xs, endx), l: s });
          lastTop = nxt[0].top; i++; continue;
        }
        cur.linhas.push({ t: "chords", c: place(toks, [], 0) });
        continue;
      }
      cur.linhas.push({ t: "lyric", l: lyricString(row).s });
    }
  }
  for (const v of versions) {
    const clean = [];
    for (const l of v.linhas) { if (l.t === "blank" && (!clean.length || clean[clean.length - 1].t === "blank")) continue; clean.push(l); }
    while (clean.length && clean[clean.length - 1].t === "blank") clean.pop();
    v.linhas = clean;
  }
  if (!versions.length) console.warn("Cifra fora do modelo. Primeiras linhas lidas:", amostra);
  return { titulo, autor, versoes: versions, amostra };
}

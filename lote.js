// Envio de músicas em lote (painel da Janaine).
// Ela escolhe vários arquivos ou uma pasta; o app reconhece a música e o tipo de cada arquivo pelo nome,
// mostra tudo para conferir e depois envia sozinho, uma música de cada vez:
// - cifra (PDF com "cifra" no nome): vira texto com acordes, para trocar o tom;
// - grade / full score, partes / banda e outros PDFs: cada página vira imagem;
// - áudio (mp3, m4a, wav): vai como está, para as músicas que não têm YouTube.
import { parseCifraPdf } from "./cifra.js?v=15";

const AUDIO_EXT = ["mp3", "m4a", "aac", "wav", "ogg"];
const GENERIC = new Set(["partituras", "partitura", "cifras", "cifra", "pdf", "pdfs", "audios", "audio", "musicas", "repertorio", "arquivos", "amo", "maes que oram"]);
const TYPE_LABEL = { cifra: "Cifra", grade: "Grade completa", banda: "Partes da banda", partitura: "Partitura", audio: "Áudio", ignorar: "Não enviar" };

export const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const slug = s => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function typeOf(name) {
  const n = norm(name), ext = n.split(".").pop();
  if (AUDIO_EXT.includes(ext)) return "audio";
  if (ext !== "pdf") return "ignorar";
  if (/cifra/.test(n)) return "cifra";
  if (/parte|banda/.test(n)) return "banda";
  if (/grade|full ?score|score completo|partitura completa/.test(n)) return "grade";
  return "partitura";
}
// "Oração pela família AMO - Full Score-GRADE_V3.pdf" -> "oracao pela familia"
function songKey(name) {
  let n = norm(name).replace(/\.[a-z0-9]+$/, "");
  n = n.replace(/^\s*\d+\s*[._-]\s*/, ""); // "02. Repertório..."
  n = n.replace(/[^a-z0-9]+/g, " ");
  n = n.replace(/\b(cifra|cifras|grade|full|score|partes?|banda|amo|jp|v\d+|final|versao|partitura|completa|audio|guia|mp3|repertorio|novo|nova|atualizado|atualizada|revisado|revisada)\b/g, " ");
  return n.replace(/[^a-z0-9]+/g, " ").trim();
}
function prettyTitle(key) {
  const small = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "as", "os", "pela", "pelo", "em", "no", "na", "com"]);
  return key.split(" ").map((w, i) => (i && small.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
function folderOf(f) {
  // pasta escolhida > pasta da música > arquivo: usa a pasta da música (ignora nomes genéricos como "Partituras")
  const segs = (f.webkitRelativePath || "").split("/").slice(0, -1);
  if (segs.length < 2) return "";
  return segs.slice(1).reverse().find(p => !GENERIC.has(norm(p).trim())) || "";
}

// junta fichas que ficaram com o mesmo nome de música (por exemplo, depois de ler o título da cifra)
export function mergeSame(groups) {
  const out = [];
  for (const g of groups) {
    const t = out.find(x => slug(x.titulo) === slug(g.titulo));
    if (t) { t.files.push(...g.files); t.autor = t.autor || g.autor; t.youtube = t.youtube || g.youtube; t.existe = t.existe || g.existe; if (g.existe) t.id = g.id; }
    else out.push(g);
  }
  return out;
}
export function groupFiles(files, existing) {
  const groups = new Map();
  for (const f of files) {
    if (f.name.startsWith(".")) continue;
    const type = typeOf(f.name);
    if (type === "ignorar") continue;
    const key = songKey(folderOf(f) || f.name) || songKey(f.name);
    const id = slug(key);
    if (!groups.has(id)) {
      const ex = existing.find(s => s.id === id || slug(s.titulo) === id);
      groups.set(id, { id: ex ? ex.id : id, titulo: ex ? ex.titulo : prettyTitle(key), autor: ex?.autor || "", youtube: ex?.youtube || "", curso: ex ? ex.curso !== false : true, existe: !!ex, files: [] });
    }
    groups.get(id).files.push({ file: f, type });
  }
  return mergeSame([...groups.values()]);
}

let pdfjsReady = null;
function loadPdfjs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsReady) pdfjsReady = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "pdf.min.js";
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js"; res(window.pdfjsLib); };
    s.onerror = rej; document.head.appendChild(s);
  });
  return pdfjsReady;
}
async function openPdf(file) {
  const lib = await loadPdfjs();
  return lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
}
async function renderPages(pdf, onPage) {
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 2 });
    const cv = document.createElement("canvas"); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(await new Promise(r => cv.toBlob(r, "image/png")));
    onPage?.(p, pdf.numPages);
  }
  return out;
}
// lê só título e autor da cifra, para a conferência
export async function peekCifra(file) {
  try { const r = await parseCifraPdf(await openPdf(file)); return { titulo: r.titulo, autor: r.autor, versoes: r.versoes.length }; }
  catch (e) { console.warn(e); return null; }
}

const DESC = {
  cifraimg: ["Cifra", "Cifra em PDF, sem troca de tom"],
  grade: ["Grade completa", "Voz, cifra e acompanhamento"],
  banda: ["Partes da banda", "Cifra para a banda"]
};

// envia uma música; api = { upload(path, blob, type), save(id, data), log(text) }
export async function sendSong(g, api) {
  const id = g.existe ? g.id : (slug(g.titulo) || g.id);
  const data = { titulo: g.titulo.trim(), autor: g.autor.trim(), youtube: g.youtube.trim(), curso: !!g.curso };
  const units = Math.max(1, g.files.length) + 0.2; let doneU = 0;
  const prog = f => api.progress?.(Math.min(1, (doneU + f) / units));
  prog(0);
  const cif = g.files.find(x => x.type === "cifra");
  let cifraComoImagem = null;
  if (cif) {
    api.log("lendo a cifra");
    const r = await parseCifraPdf(await openPdf(cif.file));
    doneU += 1; prog(0);
    if (r.versoes.length) {
      data.cifraJson = JSON.stringify(r.versoes);
      data.tons = [...new Set(r.versoes.map(v => v.tom))];
    } else {
      // fora do modelo: vai como imagem, para ler; sem troca de tom
      cifraComoImagem = cif; g.semTom = true;
    }
  }
  const parts = g.files.filter(x => ["grade", "banda", "partitura"].includes(x.type));
  if (cifraComoImagem) parts.unshift({ file: cifraComoImagem.file, type: "cifraimg" });
  if (parts.length) {
    const order = { cifraimg: -1, grade: 0, banda: 1, partitura: 2 };
    parts.sort((a, b) => order[a.type] - order[b.type]);
    data.partituras = [];
    for (const [i, pf] of parts.entries()) {
      const pdf = await openPdf(pf.file);
      const rotulo = (TYPE_LABEL[pf.type] || "cifra").toLowerCase();
      const isCifraImg = pf.type === "cifraimg";
      const blobs = await renderPages(pdf, (p, n) => { api.log(`${rotulo}: preparando página ${p} de ${n}`); if (!isCifraImg) prog(0.4 * p / n); });
      const paginas = [];
      for (const [j, b] of blobs.entries()) {
        const path = `songs/${id}/${pf.type}-${i + 1}-${j + 1}.png`;
        api.log(`${rotulo}: enviando página ${j + 1} de ${blobs.length}`);
        await api.upload(path, b, "image/png"); paginas.push(path);
        if (!isCifraImg) prog(0.4 + 0.6 * (j + 1) / blobs.length);
      }
      if (!isCifraImg) { doneU += 1; prog(0); }
      const [nome, desc] = DESC[pf.type] || [prettyTitle(songKey(pf.file.name)) || "Partitura", "Partitura"];
      data.partituras.push({ nome, desc, paginas });
    }
  }
  const aud = g.files.find(x => x.type === "audio");
  if (aud) {
    const ext = aud.file.name.split(".").pop().toLowerCase();
    api.log("enviando o áudio");
    const path = `songs/${id}/audio.${ext}`;
    await api.upload(path, aud.file, aud.file.type || "audio/mpeg"); data.audio = path;
    doneU += 1; prog(0);
  }
  api.log("salvando");
  await api.save(id, data);
  api.progress?.(1);
  return id;
}

export { TYPE_LABEL };

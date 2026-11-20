// Repertório das Mães que Oram · Janaine Pavani
// Cadastro e login: Firebase Authentication (e-mail e senha). Dados das mães: Firestore, coleção users.
// Músicas, cifras e partituras: arquivos do próprio repositório (data/, cifras/, partituras/, audio/).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, sendEmailVerification, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, getDocs, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, ADMIN_EMAIL } from "./firebase-config.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
auth.languageCode = "pt";
const db = getFirestore(fb);

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function toast(t) {
  const el = document.createElement("div"); el.className = "toast"; el.textContent = t;
  document.body.appendChild(el); setTimeout(() => el.remove(), 3600);
}

const S = { user: null, profile: null, songs: [], cfg: null, isAdmin: false };

/* ---------- listas do formulário ---------- */
const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const INSTR = ["Voz", "Violão", "Teclado / piano", "Outro instrumento", "Ainda não toco"];
$$(".uf-select").forEach(s => s.innerHTML = '<option value="">UF</option>' + UFS.map(u => `<option>${u}</option>`).join(""));
$$(".instr-select").forEach(s => s.innerHTML = '<option value="">Escolha</option>' + INSTR.map(u => `<option>${u}</option>`).join(""));

/* ---------- telas ---------- */
const VIEWS = { loading: "#v-loading", auth: "#v-auth", home: "#v-home", study: "#v-study", prof: "#v-prof", song: "#v-song", admin: "#v-admin" };
const HASH = { home: "", study: "cursos", prof: "perfil", admin: "painel" };
function show(v) {
  Object.entries(VIEWS).forEach(([k, s]) => $(s).classList.toggle("hidden", k !== v));
  const inApp = !["loading", "auth"].includes(v);
  $("#nav").classList.toggle("hidden", !inApp);
  $$(".nav button").forEach(b => b.classList.toggle("on", b.dataset.go === v || (v === "song" && b.dataset.go === "home") || (v === "admin" && b.dataset.go === "prof")));
  $("#float-cta").classList.toggle("hidden", !(v === "song" && cur?.curso));
  stopScroll(); window.scrollTo(0, 0);
}
function go(v, push = true) {
  show(v);
  if (push) {
    const h = HASH[v] ?? "";
    const want = h ? "#" + h : "";
    if (location.hash !== want) history.pushState(null, "", h ? "#" + h : location.pathname);
  }
  if (v === "admin") loadAdmin();
}
$$(".nav button").forEach(b => b.onclick = () => go(b.dataset.go));
function route() {
  if (!S.profile) return;
  const h = location.hash.slice(1);
  if (h.startsWith("musica-")) { const s = S.songs.find(x => x.id === h.slice(7)); if (s) return openSong(s.id, false); }
  if (h === "cursos") return go("study", false);
  if (h === "perfil") return go("prof", false);
  if (h === "painel" && S.isAdmin) return go("admin", false);
  go("home", false);
}
window.addEventListener("popstate", route);

/* ---------- dados ---------- */
async function loadData() {
  const [songs, cfg] = await Promise.all([
    fetch("data/musicas.json").then(r => r.json()),
    fetch("data/config.json").then(r => r.json())
  ]);
  S.songs = songs.sort((a, b) => a.titulo.localeCompare(b.titulo, "pt")); S.cfg = cfg;
  const L = cfg.links;
  $$(".cta-curso").forEach(a => a.href = L.curso);
  $("#lk-missao").href = L.missao; $("#lk-cursos").href = L.cursos; $("#lk-whats").href = L.whatsapp;
  $("#dest-t").textContent = cfg.destaque.titulo; $("#dest-p").textContent = cfg.destaque.texto;
}
const dataReady = loadData().catch(e => { console.error(e); toast("Não consegui carregar as músicas. Verifique a internet."); });

/* ---------- entrada ---------- */
function authTab(t) {
  $("#auth-tabs").classList.toggle("hidden", t === "complete");
  $("#tab-new").classList.toggle("on", t === "new"); $("#tab-login").classList.toggle("on", t === "login");
  $("#f-new").classList.toggle("hidden", t !== "new"); $("#f-login").classList.toggle("hidden", t !== "login");
  $("#f-complete").classList.toggle("hidden", t !== "complete");
}
$("#tab-new").onclick = () => authTab("new");
$("#tab-login").onclick = () => authTab("login");

const ERR = {
  "auth/email-already-in-use": "Este e-mail já tem conta. Toque em Entrar.",
  "auth/invalid-email": "Confira o e-mail digitado.",
  "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
  "auth/invalid-credential": "E-mail ou senha não conferem.",
  "auth/wrong-password": "E-mail ou senha não conferem.",
  "auth/user-not-found": "Não encontrei conta com este e-mail. Toque em Criar conta.",
  "auth/too-many-requests": "Muitas tentativas. Espere alguns minutos e tente de novo.",
  "auth/network-request-failed": "Sem internet no momento. Tente de novo."
};
const errMsg = e => ERR[e?.code] || "Não deu certo agora. Tente de novo em instantes.";

function profileFrom(d, email) {
  return {
    nome: d.nome.trim(), email, whats: d.whats.trim(), cidade: d.cidade.trim(), uf: d.uf,
    grupo: d.grupo.trim(), instr: d.instr, aluna: d.aluna
  };
}
let pendingProfile = null;
$("#f-new").addEventListener("submit", async e => {
  e.preventDefault(); $("#err-new").textContent = "";
  const d = Object.fromEntries(new FormData(e.target));
  const email = d.email.trim().toLowerCase();
  pendingProfile = profileFrom(d, email);
  const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
  try { await createUserWithEmailAndPassword(auth, email, d.senha); }
  catch (err) { pendingProfile = null; $("#err-new").textContent = errMsg(err); }
  btn.disabled = false;
});
$("#f-login").addEventListener("submit", async e => {
  e.preventDefault(); $("#err-login").textContent = "";
  const d = Object.fromEntries(new FormData(e.target));
  try { await signInWithEmailAndPassword(auth, d.email.trim().toLowerCase(), d.senha); }
  catch (err) { $("#err-login").textContent = errMsg(err); }
});
$("#forgot").onclick = async () => {
  const em = $("#l-email").value.trim();
  if (!em) { $("#err-login").textContent = "Digite seu e-mail acima e toque de novo em Esqueci minha senha."; return; }
  try { await sendPasswordResetEmail(auth, em); $("#err-login").textContent = ""; toast("Enviamos um e-mail para você criar uma nova senha."); }
  catch (err) { $("#err-login").textContent = errMsg(err); }
};
$("#f-complete").addEventListener("submit", async e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  try { await saveNewProfile(profileFrom(d, S.user.email.toLowerCase())); enter(); }
  catch (err) { console.error(err); $("#err-complete").textContent = "Não consegui salvar. Tente de novo."; }
});
async function saveNewProfile(p) {
  p.criadoEm = serverTimestamp(); p.ultimoAcesso = serverTimestamp(); p.acessos = 1;
  await setDoc(doc(db, "users", S.user.uid), p);
  S.profile = p;
}

onAuthStateChanged(auth, async user => {
  S.user = user; S.profile = null;
  if (!user) { show("auth"); return; }
  S.isAdmin = (user.email || "").toLowerCase() === ADMIN_EMAIL;
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      S.profile = snap.data();
      updateDoc(ref, { ultimoAcesso: serverTimestamp(), acessos: increment(1) }).catch(() => {});
    } else if (pendingProfile) {
      await saveNewProfile(pendingProfile); pendingProfile = null;
      if (S.isAdmin && !user.emailVerified) sendEmailVerification(user).catch(() => {});
    } else {
      show("auth"); authTab("complete");
      return;
    }
  } catch (err) {
    console.error(err); show("auth"); authTab("login");
    $("#err-login").textContent = "Não consegui abrir seu cadastro. Verifique a internet e tente de novo.";
    return;
  }
  enter();
});

async function enter() {
  await dataReady;
  const p = S.profile;
  $("#hello").textContent = "Olá, " + p.nome.split(" ")[0];
  $("#p-name").textContent = p.nome;
  const f = $("#f-prof");
  ["nome", "whats", "cidade", "uf", "grupo", "instr", "aluna"].forEach(k => f.elements[k].value = p[k] || "");
  $("#go-admin").classList.toggle("hidden", !S.isAdmin);
  renderPromos(); renderList(); route();
}

/* ---------- perfil ---------- */
$("#f-prof").addEventListener("submit", async e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  const upd = { nome: d.nome.trim(), whats: d.whats.trim(), cidade: d.cidade.trim(), uf: d.uf, grupo: d.grupo.trim(), instr: d.instr, aluna: d.aluna };
  try { await updateDoc(doc(db, "users", S.user.uid), upd); Object.assign(S.profile, upd); $("#p-name").textContent = upd.nome; renderPromos(); renderList(); toast("Cadastro atualizado."); }
  catch (err) { console.error(err); toast("Não consegui salvar. Tente de novo."); }
});
$("#logout").onclick = async () => { await signOut(auth); history.replaceState(null, "", location.pathname); authTab("login"); };
$("#go-admin").onclick = () => go("admin");
$("#adm-back").onclick = () => go("prof");

/* ---------- chamadas para os cursos ---------- */
const isAluna = () => S.profile?.aluna === "sim";
function promoHTML() {
  const L = S.cfg.links;
  if (isAluna()) return `<a class="promo aluna" href="${L.nutror}" target="_blank" rel="noopener"><div class="in">
    <div class="k">Área da aluna</div><h3>Continue suas aulas</h3><p>Entre direto nos seus cursos, sem procurar link.</p><span class="cta">Entrar nas minhas aulas ›</span></div></a>`;
  return `<a class="promo" href="${L.curso}" target="_blank" rel="noopener"><div class="in">
    <div class="k">Curso em destaque</div><h3>Aprenda estas músicas <b>de verdade</b></h3>
    <p>Melodia, teclado, violão e harmonia vocal, uma música por vez, em aulas curtas.</p><span class="cta">Conhecer o curso ›</span></div></a>`;
}
function renderPromos() {
  const L = S.cfg.links;
  $("#home-promo").innerHTML = promoHTML();
  $("#study-top").innerHTML = isAluna() ? promoHTML()
    : `<a class="nutror" href="${L.nutror}" target="_blank" rel="noopener" style="margin:0 0 14px"><div><b>Já é aluna?</b><br><span>Entre nas suas aulas na Nutror</span></div><div style="font-size:22px;color:var(--gold)">›</div></a>`;
}

/* ---------- lista ---------- */
const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const cifraCache = {};
function renderList() {
  const q = norm($("#q").value.trim());
  const txt = s => s.titulo + " " + s.autor + " " + (cifraCache[s.id] ? cifraCache[s.id][0].linhas.map(l => l.l || "").join(" ") : "");
  const hits = S.songs.filter(s => !q || norm(txt(s)).includes(q));
  const L = S.cfg.links;
  let h = hits.map((s, i) => `<button class="song" data-id="${esc(s.id)}" type="button">
      <div class="num">${i + 1}</div>
      <div><div class="t">${esc(s.titulo)}</div><div class="a">${esc(s.autor)}</div>
      <div class="chips"><span class="chip">Cifra</span>${s.partituras?.length ? '<span class="chip">Partitura</span>' : ""}${s.youtube || s.audio ? '<span class="chip">Ouvir</span>' : ""}${s.curso ? '<span class="badge-aula">Tem aula no curso</span>' : ""}</div></div></button>`).join("");
  if (!q) {
    if (!isAluna()) h += `<a class="mid-promo" href="${L.curso}" target="_blank" rel="noopener"><div><b>Novas músicas toda semana</b><span>No curso, cada música vem com aula de teclado, violão e vozes</span></div><div class="arr">›</div></a>`;
    h += (S.cfg.emBreve || []).map(t => `<div class="song soon"><div class="num">·</div><div><div class="t">${esc(t)}</div><div class="a">Em breve</div></div></div>`).join("");
  }
  $("#list").innerHTML = h || '<div class="empty">Nenhuma música encontrada.</div>';
  $$("#list .song[data-id]").forEach(b => b.onclick = () => openSong(b.dataset.id));
}
$("#q").addEventListener("input", renderList);
// carrega as cifras em segundo plano para a busca por trecho da letra
dataReady.then(() => S.songs.forEach(s => fetch(s.cifra).then(r => r.json()).then(v => { cifraCache[s.id] = v; }).catch(() => {})));

/* ---------- transposição ---------- */
const SH = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FL = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const KEYNAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const FLATKEYS = new Set(["F", "Bb", "Eb", "Ab", "Db"]);
function pc(n) { let i = SH.indexOf(n); if (i < 0) i = FL.indexOf(n); return i; }
function tNote(n, st, flat) { const i = pc(n); if (i < 0) return n; return (flat ? FL : SH)[(i + st + 120) % 12]; }
function tChord(c, st, flat) {
  if (!st) return c;
  const m = c.match(/^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/); if (!m) return c;
  return tNote(m[1], st, flat) + m[2] + (m[3] ? "/" + tNote(m[3], st, flat) : "");
}
const keyRoot = k => k.replace(/m$/, "");

/* ---------- música ---------- */
let cur = null, versions = null, lvl = "intermediário", key = null, fsz = 15;
async function openSong(id, push = true) {
  cur = S.songs.find(s => s.id === id); if (!cur) return;
  lvl = "intermediário"; key = null; lastV = null;
  $("#s-title").textContent = cur.titulo; $("#s-by").textContent = cur.autor;
  $("#study-h").textContent = "Aprenda " + cur.titulo + " em aulas curtas";
  const L = S.cfg.links;
  if (isAluna()) {
    $("#study-p").textContent = "Você já é aluna: as aulas desta música estão na sua área da Nutror.";
    $("#study-a").textContent = "Ir para as minhas aulas"; $("#study-a").href = L.nutror;
  } else {
    $("#study-p").textContent = "No curso Repertório das Mães que Oram na Prática você aprende esta música passo a passo: a melodia, o teclado e o violão em três níveis e a harmonia vocal, voz por voz.";
    $("#study-a").textContent = "Quero aprender esta música"; $("#study-a").href = L.curso;
  }
  $("#float-cta").href = isAluna() ? L.nutror : L.curso;
  $("#float-cta").innerHTML = isAluna() ? "▶ Ver a aula desta música" : "▶ Aprender esta música <small>· aulas</small>";
  renderListen(); renderSheets(); setPane("cifra");
  show("song");
  if (push) history.pushState(null, "", "#musica-" + id);
  $("#cifra").innerHTML = '<span class="ly" style="color:var(--muted)">Carregando a cifra...</span>';
  try {
    versions = cifraCache[id] || await fetch(cur.cifra).then(r => r.json());
    cifraCache[id] = versions;
    const lv = [...new Set(versions.map(v => v.nivel))];
    if (!lv.includes(lvl)) lvl = lv[0];
    $$(".lvl button").forEach(b => { b.classList.toggle("on", b.dataset.lvl === lvl); b.classList.toggle("hidden", !lv.includes(b.dataset.lvl)); });
    renderCifra();
  } catch (e) { $("#cifra").innerHTML = '<span class="ly">Não consegui abrir a cifra. Verifique a internet.</span>'; }
}
$("#back").onclick = () => go("home");

function renderListen() {
  const box = $("#listen");
  let inner = "";
  if (cur.youtube) {
    const m = cur.youtube.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
    if (m) inner = `<iframe src="https://www.youtube-nocookie.com/embed/${m[1]}?rel=0" title="${esc(cur.titulo)}" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  } else if (cur.audio) {
    inner = `<audio controls preload="none" src="${esc(cur.audio)}"></audio>`;
  }
  box.innerHTML = inner ? `<div class="listen"><button class="hd" type="button" id="listen-t">Ouvir a música <span>mostrar</span></button><div class="body hidden">${inner}</div></div>` : "";
  if (inner) $("#listen-t").onclick = () => {
    const b = box.querySelector(".body"); b.classList.toggle("hidden");
    $("#listen-t span").textContent = b.classList.contains("hidden") ? "mostrar" : "esconder";
  };
}

function baseVersion() { return versions.find(v => v.nivel === lvl) || versions[0]; }
let lastV, lastSt, lastFlat;
function renderCifra() {
  const base = baseVersion();
  if (key === null) key = base.tom;
  const v = versions.find(x => x.nivel === lvl && x.tom === key) || base; // versão escrita pela Janaine naquele tom, se houver
  const st = (pc(keyRoot(key)) - pc(keyRoot(v.tom)) + 12) % 12;
  const flat = FLATKEYS.has(keyRoot(key));
  $("#k-val").textContent = key;
  $("#k-reset").classList.toggle("hidden", key === base.tom);
  $("#s-meta").innerHTML = `Nível <b>${esc(lvl)}</b> · Tom <b>${esc(key)}</b> · Compasso <b>${esc(v.compasso)}</b> · ♪ = <b>${esc(v.bpm)}</b>` + (key !== base.tom ? ` · <span style="color:var(--gold-dark)">tom original ${esc(base.tom)}</span>` : "");
  lastV = v; lastSt = st; lastFlat = flat;
  drawCifra();
}
function chordCells(l, st, flat) {
  const cells = []; let end = 0;
  if (l.label) { cells.push({ col: 0, txt: l.label, cls: "lbl" }); end = l.label.length + 1; }
  const off = l.label ? end : 0;
  for (const [idx0, tok] of l.c) {
    let col = idx0 + off;
    if (cells.length && col < end) col = end;
    let txt, cls;
    if (tok === "I") { txt = "|"; cls = "bar"; }
    else if (/^\d+\/\d+$/.test(tok)) { txt = tok; cls = "ts"; }
    else { txt = tChord(tok, st, flat); cls = "ch"; }
    cells.push({ col, txt, cls }); end = col + txt.length + 1;
  }
  return cells;
}
function cellsHTML(cells) {
  let pos = 0, h = "";
  for (const c of cells) { h += " ".repeat(Math.max(0, c.col - pos)) + `<span class="${c.cls}">${esc(c.txt)}</span>`; pos = Math.max(pos, c.col) + c.txt.length; }
  return h;
}
function charWidth(el) {
  const s = document.createElement("span"); s.textContent = "M".repeat(40); s.style.cssText = "visibility:hidden;position:absolute";
  el.appendChild(s); const w = s.getBoundingClientRect().width / 40; s.remove(); return w || 8;
}
function chunk(cells, lyr, first) {
  const cls = first ? "" : " cont"; let h = "";
  if (cells.length) h += `<span class="cl${cls}">${cellsHTML(cells)}</span>`;
  if (lyr) h += `<span class="ly${cls}">${esc(lyr)}</span>`;
  return h;
}
function drawCifra() {
  if (!lastV) return;
  const v = lastV, st = lastSt, flat = lastFlat;
  const el = $("#cifra"); el.style.fontSize = fsz + "px"; el.innerHTML = "";
  const cs = getComputedStyle(el);
  const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const cols = Math.max(20, Math.floor(inner / charWidth(el)));
  const out = [];
  for (const l of v.linhas) {
    if (l.t === "blank") { out.push('<span class="gap"></span>'); continue; }
    if (l.t === "lyric") { out.push(`<span class="ly">${esc(l.l)}</span>`); continue; }
    let cells = chordCells(l, st, flat);
    let lyr = l.t === "pair" ? l.l : null;
    let first = true;
    for (let guard = 0; guard < 20; guard++) {
      const width = Math.max(lyr ? lyr.length : 0, cells.length ? Math.max(...cells.map(c => c.col + c.txt.length)) : 0);
      const lim = first ? cols : cols - 2;
      if (width <= lim) { out.push(chunk(cells, lyr, first)); break; }
      // quebra num espaço da letra que não corte nenhum acorde
      let br = -1;
      for (let c = lim; c > lim * 0.4; c--) {
        const okLyr = !lyr || c >= lyr.length || lyr[c] === " ";
        const okCh = !cells.some(x => x.col < c && x.col + x.txt.length > c);
        if (okLyr && okCh) { br = c; break; }
      }
      if (br < 0) br = lim;
      const a = cells.filter(x => x.col < br), b = cells.filter(x => x.col >= br);
      out.push(chunk(a, lyr ? lyr.slice(0, br).replace(/\s+$/, "") : null, first));
      const rest = lyr ? lyr.slice(br) : null;
      let trim = rest ? rest.length - rest.replace(/^\s+/, "").length : 0;
      if (!rest && b.length) trim = Math.min(...b.map(x => x.col)) - br;
      cells = b.map(x => ({ ...x, col: Math.max(0, x.col - br - trim) }));
      lyr = rest ? rest.slice(trim) : (lyr === null ? null : "");
      first = false;
      if (!cells.length && !lyr) break;
    }
  }
  el.innerHTML = out.join("");
}
window.addEventListener("resize", () => { if (!$("#v-song").classList.contains("hidden")) drawCifra(); });
$$(".lvl button").forEach(b => b.onclick = () => { lvl = b.dataset.lvl; $$(".lvl button").forEach(x => x.classList.toggle("on", x === b)); renderCifra(); });
function shiftKey(d) {
  const minor = key.endsWith("m"); const r = keyRoot(key);
  const i = KEYNAMES.indexOf(r) >= 0 ? KEYNAMES.indexOf(r) : pc(r);
  key = KEYNAMES[(i + d + 12) % 12] + (minor ? "m" : ""); renderCifra();
}
$("#k-up").onclick = () => shiftKey(1);
$("#k-down").onclick = () => shiftKey(-1);
$("#k-reset").onclick = () => { key = baseVersion().tom; renderCifra(); };
$("#f-up").onclick = () => { fsz = Math.min(24, fsz + 1); drawCifra(); };
$("#f-down").onclick = () => { fsz = Math.max(11, fsz - 1); drawCifra(); };

let scrollT = null;
function stopScroll() { clearInterval(scrollT); scrollT = null; $("#scroll").classList.remove("on"); $("#scroll").textContent = "Rolar"; }
$("#scroll").onclick = () => {
  if (scrollT) { stopScroll(); return; }
  $("#scroll").classList.add("on"); $("#scroll").textContent = "Parar";
  scrollT = setInterval(() => { window.scrollBy(0, 1); if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 2) stopScroll(); }, 70);
};

/* ---------- partituras ---------- */
function setPane(p) {
  $("#seg-cifra").classList.toggle("on", p === "cifra"); $("#seg-part").classList.toggle("on", p === "part");
  $("#pane-cifra").classList.toggle("hidden", p !== "cifra"); $("#pane-part").classList.toggle("hidden", p !== "part");
  stopScroll();
}
$("#seg-cifra").onclick = () => { setPane("cifra"); drawCifra(); };
$("#seg-part").onclick = () => setPane("part");
function renderSheets() {
  const ps = cur.partituras || [];
  $("#seg-part").classList.toggle("hidden", !ps.length);
  $("#sheets").innerHTML = ps.map((p, i) => `<button class="sheet-card" data-i="${i}" type="button"><img src="${esc(p.paginas[0])}" alt="" loading="lazy"><div><div class="t">${esc(p.nome)}</div><div class="a">${esc(p.desc)} · ${p.paginas.length} ${p.paginas.length > 1 ? "páginas" : "página"}</div></div></button>`).join("");
  $$("#sheets .sheet-card").forEach(b => b.onclick = () => openViewer(ps[+b.dataset.i]));
}
let zoom = 1;
function openViewer(p) {
  zoom = 1; $("#v-title").textContent = p.nome;
  $("#v-pages").innerHTML = p.paginas.map(src => `<img src="${esc(src)}" alt="">`).join("");
  applyZoom(); $("#viewer").classList.remove("hidden"); $("#float-cta").classList.add("hidden");
}
function applyZoom() { $$("#v-pages img").forEach(i => i.style.width = (zoom * 100) + "%"); }
$("#z-in").onclick = () => { zoom = Math.min(3, zoom + .25); applyZoom(); };
$("#z-out").onclick = () => { zoom = Math.max(1, zoom - .25); applyZoom(); };
$("#v-close").onclick = () => { $("#viewer").classList.add("hidden"); if (cur?.curso) $("#float-cta").classList.remove("hidden"); };

/* ---------- painel da Janaine ---------- */
let ADM = [];
const tsDate = t => t?.toDate ? t.toDate() : null;
const fmt = d => d ? d.toLocaleDateString("pt-BR") : "";
async function loadAdmin() {
  if (!S.isAdmin) return go("home");
  await auth.currentUser.reload().catch(() => {});
  if (!auth.currentUser.emailVerified) {
    $("#adm-verify").innerHTML = `<div class="verify">Para abrir os cadastros, confirme o seu e-mail. Abra a mensagem que chegou em ${esc(ADMIN_EMAIL)}, toque no link e depois volte aqui.<br><button id="adm-send" type="button">Reenviar e-mail de confirmação</button></div>`;
    $("#adm-send").onclick = async () => { try { await sendEmailVerification(auth.currentUser); toast("E-mail enviado."); } catch (e) { toast(errMsg(e)); } };
    $("#adm-list").innerHTML = ""; return;
  }
  $("#adm-verify").innerHTML = "";
  $("#adm-list").innerHTML = '<div class="empty">Carregando...</div>';
  try {
    await auth.currentUser.getIdToken(true);
    const snap = await getDocs(collection(db, "users"));
    ADM = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (tsDate(b.criadoEm) || 0) - (tsDate(a.criadoEm) || 0));
    renderAdmin();
  } catch (e) { console.error(e); $("#adm-list").innerHTML = '<div class="empty">Não consegui abrir os cadastros. Confira se as regras do Firestore foram publicadas.</div>'; }
}
function admFiltered() {
  const q = norm($("#adm-q").value.trim()), f = $("#adm-f").value;
  return ADM.filter(u => (!f || u.aluna === f) && (!q || norm([u.nome, u.cidade, u.uf, u.grupo, u.email].join(" ")).includes(q)));
}
function renderAdmin() {
  const week = Date.now() - 7 * 864e5;
  $("#st-total").textContent = ADM.length;
  $("#st-alunas").textContent = ADM.filter(u => u.aluna === "sim").length;
  $("#st-semana").textContent = ADM.filter(u => (tsDate(u.criadoEm) || 0) > week).length;
  const byUf = {}; ADM.forEach(u => byUf[u.uf] = (byUf[u.uf] || 0) + 1);
  $("#adm-uf").innerHTML = Object.entries(byUf).sort((a, b) => b[1] - a[1]).map(([u, n]) => `<span>${esc(u)} · ${n}</span>`).join("");
  const rows = admFiltered();
  $("#adm-list").innerHTML = rows.map(u => {
    const w = (u.whats || "").replace(/\D/g, "");
    const wa = w ? `https://wa.me/${w.length <= 11 ? "55" + w : w}` : "";
    return `<div class="adm-row"><b>${esc(u.nome)}</b>${u.aluna === "sim" ? '<span class="tag-aluna">aluna</span>' : ""}<br>
      <span class="m">${esc(u.grupo)} · ${esc(u.cidade)}/${esc(u.uf)} · ${esc(u.instr)}</span><br>
      ${esc(u.email)} · ${wa ? `<a href="${wa}" target="_blank" rel="noopener">${esc(u.whats)}</a>` : esc(u.whats)}<br>
      <span class="m">Cadastro ${fmt(tsDate(u.criadoEm))} · último acesso ${fmt(tsDate(u.ultimoAcesso))} · ${u.acessos || 1} acessos</span></div>`;
  }).join("") || '<div class="empty">Nenhum cadastro encontrado.</div>';
}
$("#adm-q").addEventListener("input", renderAdmin);
$("#adm-f").addEventListener("change", renderAdmin);
$("#adm-csv").onclick = () => {
  const cols = ["nome", "email", "whats", "cidade", "uf", "grupo", "instr", "aluna", "criadoEm", "ultimoAcesso", "acessos"];
  const head = ["Nome", "E-mail", "WhatsApp", "Cidade", "UF", "Grupo", "Instrumento", "Aluna", "Cadastro", "Último acesso", "Acessos"];
  const cell = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const lines = [head.map(cell).join(";")].concat(admFiltered().map(u => cols.map(c => cell(c === "criadoEm" || c === "ultimoAcesso" ? fmt(tsDate(u[c])) : c === "aluna" ? (u.aluna === "sim" ? "sim" : "não") : u[c])).join(";")));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "cadastros-maes-" + new Date().toISOString().slice(0, 10) + ".csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

/* ---------- funciona sem internet ---------- */
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

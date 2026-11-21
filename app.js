// Repertório das Mães que Oram · Janaine Pavani
// Cadastro e login: Firebase Authentication (e-mail e senha). Dados das mães: Firestore, coleção users.
// Músicas, cifras e partituras: arquivos do próprio repositório (data/, cifras/, partituras/, audio/).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, sendEmailVerification, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, getDocs, serverTimestamp, increment,
  writeBatch, getCountFromServer, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getStorage, ref as sref, uploadBytes, getDownloadURL, listAll, deleteObject
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { firebaseConfig, ADMIN_EMAIL } from "./firebase-config.js?v=10";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
auth.languageCode = "pt";
const db = getFirestore(fb);
const storage = getStorage(fb);

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
const VIEWS = { loading: "#v-loading", auth: "#v-auth", pending: "#v-pending", home: "#v-home", study: "#v-study", prof: "#v-prof", song: "#v-song", admin: "#v-admin" };
const HASH = { home: "", study: "cursos", prof: "perfil", admin: "painel" };
function show(v) {
  Object.entries(VIEWS).forEach(([k, s]) => $(s).classList.toggle("hidden", k !== v));
  const inApp = !["loading", "auth", "pending"].includes(v);
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
  const [songs, cfg, cursos] = await Promise.all([
    fetch("data/musicas.json").then(r => r.json()),
    fetch("data/config.json").then(r => r.json()),
    fetch("data/cursos.json").then(r => r.json())
  ]);
  S.cursos = cursos;
  S.static = songs; S.songs = sortSongs(songs.slice()); S.cfg = cfg;
  const L = cfg.links;
  $$(".cta-curso").forEach(a => a.href = L.curso);
  $("#pend-whats").href = L.whatsapp;
  $("#lk-whats").href = L.whatsapp;
}
const sortSongs = l => l.sort((a, b) => a.titulo.localeCompare(b.titulo, "pt"));
// músicas enviadas pelo painel (Firestore) + as que vieram no próprio aplicativo; a do painel vale mais
async function loadSongs() {
  try {
    const snap = await getDocs(collection(db, "songs"));
    const fs = snap.docs.map(d => ({ id: d.id, storage: true, ...d.data() }));
    const ids = new Set(fs.map(x => x.id));
    S.songs = sortSongs(fs.concat(S.static.filter(x => !ids.has(x.id))));
  } catch (e) { console.warn("músicas do painel", e); }
}
const urlCache = new Map();
async function fileUrl(song, path) {
  if (!song.storage || !path) return path;
  if (!urlCache.has(path)) urlCache.set(path, getDownloadURL(sref(storage, path)));
  return urlCache.get(path);
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
    grupo: d.grupo.trim(), instr: d.instr
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
// Acesso: quem está na lista de alunas entra como aluna; com o aplicativo aberto para todas, as outras também entram.
async function accessFor(email) {
  const [al, cfg] = await Promise.all([
    getDoc(doc(db, "alunas", email)).then(x => x.exists()).catch(() => false),
    getDoc(doc(db, "config", "acesso")).then(x => x.exists() ? x.data().modo : "alunas").catch(() => "alunas")
  ]);
  return { aluna: al ? "sim" : "nao", status: (al || cfg === "aberto") ? "ativa" : "pendente" };
}
async function saveNewProfile(p) {
  Object.assign(p, await accessFor(p.email));
  p.criadoEm = serverTimestamp(); p.ultimoAcesso = serverTimestamp(); p.acessos = 1;
  await setDoc(doc(db, "users", S.user.uid), p);
  S.profile = p;
}
async function refreshAccess(ref) {
  const a = await accessFor(S.profile.email);
  if (a.aluna !== S.profile.aluna || a.status !== S.profile.status) {
    await updateDoc(ref, a).catch(e => console.warn(e));
    Object.assign(S.profile, a);
  }
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
      await refreshAccess(ref);
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
  if (p.status !== "ativa" && !S.isAdmin) {
    $("#pend-email").textContent = p.email; show("pending"); return;
  }
  $("#hello").textContent = "Olá, " + p.nome.split(" ")[0];
  $("#p-name").textContent = p.nome;
  const f = $("#f-prof");
  ["nome", "whats", "cidade", "uf", "grupo", "instr"].forEach(k => f.elements[k].value = p[k] || "");
  $("#go-admin").classList.toggle("hidden", !S.isAdmin);
  renderPromos(); renderList();
  await loadSongs(); renderList(); route();
}

/* ---------- perfil ---------- */
$("#f-prof").addEventListener("submit", async e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  const upd = { nome: d.nome.trim(), whats: d.whats.trim(), cidade: d.cidade.trim(), uf: d.uf, grupo: d.grupo.trim(), instr: d.instr };
  try { await updateDoc(doc(db, "users", S.user.uid), upd); Object.assign(S.profile, upd); $("#p-name").textContent = upd.nome; renderPromos(); renderList(); toast("Cadastro atualizado."); }
  catch (err) { console.error(err); toast("Não consegui salvar. Tente de novo."); }
});
$("#pend-out").onclick = () => $("#logout").onclick();
$("#pend-retry").onclick = async () => {
  try { await refreshAccess(doc(db, "users", S.user.uid)); } catch (e) {}
  if (S.profile.status === "ativa") enter(); else toast("Ainda não encontrei seu e-mail na lista. Fale com a Janaine.");
};
$("#logout").onclick = async () => { await signOut(auth); history.replaceState(null, "", location.pathname); authTab("login"); };
$("#go-admin").onclick = () => go("admin");
$("#adm-back").onclick = () => go("prof");

/* ---------- chamadas para os cursos ---------- */
const isAluna = () => S.profile?.aluna === "sim";
// banners: um curso por banner, cada um com um detalhe dele; ao tocar, vai direto para a compra
const pick = a => a[Math.floor(Math.random() * a.length)];
function bannerHTML(c, b) {
  return `<a class="promo" href="${esc(c.link)}" target="_blank" rel="noopener"><div class="in">
    <div class="k">${esc(c.curto)}</div><h3>${esc(b.h)}</h3><p>${esc(b.p)}</p><span class="cta">${esc(c.botao || "Quero me inscrever")} ›</span></div></a>`;
}
let carT = null;
function renderPromos() {
  const L = S.cfg.links;
  const comBanner = S.cursos.filter(c => c.banners.length);
  // o curso atual primeiro; os outros em ordem diferente a cada visita
  const [first, ...rest] = comBanner;
  const ordem = [first, ...rest.sort(() => Math.random() - .5)];
  const escolhidos = ordem.map(c => [c, pick(c.banners)]);
  $("#car-track").innerHTML = escolhidos.map(([c, b]) => bannerHTML(c, b)).join("");
  $("#car-dots").innerHTML = escolhidos.map((_, i) => `<span${i ? "" : ' class="on"'}></span>`).join("");
  // um segundo banner no fim da lista, de outro curso, com outro detalhe
  const outro = ordem[1 + Math.floor(Math.random() * (ordem.length - 1))];
  const outroB = outro.banners.length > 1 ? outro.banners.find(b => b !== escolhidos.find(x => x[0] === outro)[1]) : outro.banners[0];
  $("#list-promo").innerHTML = bannerHTML(outro, outroB);
  // aba Aprofunde seu estudo
  $("#study-top").innerHTML = isAluna()
    ? `<a class="promo aluna" href="${L.nutror}" target="_blank" rel="noopener" style="margin-bottom:14px"><div class="in"><div class="k">Área da aluna</div><h3>Continue suas aulas</h3><p>Entre direto nos seus cursos na Nutror, com o seu e-mail e senha.</p><span class="cta">Entrar nas minhas aulas ›</span></div></a>`
    : `<a class="nutror" href="${L.nutror}" target="_blank" rel="noopener" style="margin:0 0 14px"><div><b>Já é aluna?</b><br><span>Entre nas suas aulas na Nutror</span></div><div style="font-size:22px;color:var(--gold)">›</div></a>`;
  $("#study-list").innerHTML = S.cursos.map((c, i) => `<div class="course${i ? "" : " feat"}">
      ${c.selo ? `<div class="k">${esc(c.selo)}</div>` : ""}<h3>${esc(c.nome)}</h3><p>${esc(c.texto)}</p>
      ${c.detalhes.length ? `<ul>${c.detalhes.map(d => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
      <a href="${esc(c.link)}" target="_blank" rel="noopener">${esc(c.botao || "Quero me inscrever")}</a></div>`).join("");
  startCarousel();
}
function startCarousel() {
  const track = $("#car-track"), dots = $$("#car-dots span");
  const idx = () => Math.round(track.scrollLeft / (track.firstElementChild?.offsetWidth + 10 || 1));
  track.onscroll = () => { const i = idx(); dots.forEach((d, j) => d.classList.toggle("on", j === i)); };
  clearInterval(carT);
  let paused = false;
  track.onpointerdown = track.ontouchstart = () => { paused = true; setTimeout(() => paused = false, 12000); };
  carT = setInterval(() => {
    if (paused || $("#v-home").classList.contains("hidden") || !track.children.length) return;
    const i = (idx() + 1) % track.children.length;
    track.scrollTo({ left: track.children[i].offsetLeft - 16, behavior: "smooth" });
  }, 6000);
}

/* ---------- lista ---------- */
const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const cifraCache = {};
function renderList() {
  const q = norm($("#q").value.trim());
  const txt = s => {
    if (!cifraCache[s.id] && s.cifraJson) try { cifraCache[s.id] = JSON.parse(s.cifraJson); } catch (e) {}
    return s.titulo + " " + (s.autor || "") + " " + (cifraCache[s.id]?.[0] ? cifraCache[s.id][0].linhas.map(l => l.l || "").join(" ") : "");
  };
  const hits = S.songs.filter(s => !q || norm(txt(s)).includes(q));
  const L = S.cfg.links;
  let h = hits.map((s, i) => `<button class="song" data-id="${esc(s.id)}" type="button">
      <div class="num">${i + 1}</div>
      <div><div class="t">${esc(s.titulo)}</div><div class="a">${esc(s.autor)}</div>
      <div class="chips">${s.cifra || s.cifraJson ? '<span class="chip">Cifra</span>' : ""}${s.partituras?.length ? '<span class="chip">Partitura</span>' : ""}${s.youtube || s.audio ? '<span class="chip">Ouvir</span>' : ""}${s.curso ? '<span class="badge-aula">Tem aula no curso</span>' : ""}</div></div></button>`).join("");
  if (!q) {
    const have = new Set(S.songs.map(x => norm(x.titulo)));
    h += (S.cfg.emBreve || []).filter(t => !have.has(norm(t))).map(t => `<div class="song soon"><div class="num">·</div><div><div class="t">${esc(t)}</div><div class="a">Em breve</div></div></div>`).join("");
  }
  $("#list").innerHTML = h || '<div class="empty">Nenhuma música encontrada.</div>';
  $$("#list .song[data-id]").forEach(b => b.onclick = () => openSong(b.dataset.id));
}
$("#q").addEventListener("input", renderList);
// carrega as cifras em segundo plano para a busca por trecho da letra
dataReady.then(() => S.static.forEach(s => fetch(s.cifra).then(r => r.json()).then(v => { cifraCache[s.id] = v; }).catch(() => {})));
const getCifra = async s => cifraCache[s.id] || (cifraCache[s.id] = s.cifraJson ? JSON.parse(s.cifraJson) : s.cifra ? await fetch(s.cifra).then(r => r.json()) : null);

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
    versions = await getCifra(cur);
    if (!versions?.length) { $("#cifra").innerHTML = '<span class="ly" style="color:var(--muted)">Esta música ainda não tem cifra com troca de tom. A cifra está na aba Partituras.</span>'; $("#s-meta").innerHTML = ""; $(".controls").classList.add("hidden"); return; }
    $(".controls").classList.remove("hidden");
    const lv = [...new Set(versions.map(v => v.nivel))];
    if (!lv.includes(lvl)) lvl = lv[0];
    $$("#pane-cifra .lvl button").forEach(b => { b.classList.toggle("on", b.dataset.lvl === lvl); b.classList.toggle("hidden", !lv.includes(b.dataset.lvl)); });
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
    inner = `<audio controls preload="none" id="aud"></audio>`;
  }
  box.innerHTML = inner ? `<div class="listen"><button class="hd" type="button" id="listen-t">Ouvir a música <span>mostrar</span></button><div class="body hidden">${inner}</div></div>` : "";
  if (cur.audio && !cur.youtube) { const s = cur; fileUrl(s, s.audio).then(u => { if (cur === s && $("#aud")) $("#aud").src = u; }).catch(() => {}); }
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
$$("#pane-cifra .lvl button").forEach(b => b.onclick = () => { lvl = b.dataset.lvl; $$("#pane-cifra .lvl button").forEach(x => x.classList.toggle("on", x === b)); renderCifra(); });
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
  $("#sheets").innerHTML = ps.map((p, i) => `<button class="sheet-card" data-i="${i}" type="button"><img data-src="${esc(p.paginas[0])}" alt="" loading="lazy"><div><div class="t">${esc(p.nome)}</div><div class="a">${esc(p.desc)} · ${p.paginas.length} ${p.paginas.length > 1 ? "páginas" : "página"}</div></div></button>`).join("");
  $$("#sheets .sheet-card").forEach(b => b.onclick = () => openViewer(ps[+b.dataset.i]));
  const s = cur; $$("#sheets img[data-src]").forEach(img => fileUrl(s, img.dataset.src).then(u => img.src = u).catch(() => {}));
}
let zoom = 1;
function openViewer(p) {
  zoom = 1; $("#v-title").textContent = p.nome;
  $("#v-pages").innerHTML = p.paginas.map(src => `<img data-src="${esc(src)}" alt="">`).join("");
  const s = cur; $$("#v-pages img").forEach(img => fileUrl(s, img.dataset.src).then(u => img.src = u).catch(() => {}));
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
    renderAdmin(); loadMode(); countAlunas(); renderMusicAdmin();
  } catch (e) { console.error(e); $("#adm-list").innerHTML = '<div class="empty">Não consegui abrir os cadastros. Confira se as regras do Firestore foram publicadas.</div>'; }
}
function admFiltered() {
  const q = norm($("#adm-q").value.trim()), f = $("#adm-f").value;
  return ADM.filter(u => (!f || (f === "pendente" ? u.status === "pendente" : u.aluna === f)) && (!q || norm([u.nome, u.cidade, u.uf, u.grupo, u.email].join(" ")).includes(q)));
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
    return `<div class="adm-row${u.status === "pendente" ? " pend-box" : ""}"><b>${esc(u.nome)}</b>${u.aluna === "sim" ? '<span class="tag-aluna">aluna</span>' : ""}${u.status === "pendente" ? '<span class="tag-pend">aguardando</span>' : ""}<br>
      <span class="m">${esc(u.grupo)} · ${esc(u.cidade)}/${esc(u.uf)} · ${esc(u.instr)}</span><br>
      ${esc(u.email)} · ${wa ? `<a href="${wa}" target="_blank" rel="noopener">${esc(u.whats)}</a>` : esc(u.whats)}<br>
      <span class="m">Cadastro ${fmt(tsDate(u.criadoEm))} · último acesso ${fmt(tsDate(u.ultimoAcesso))} · ${u.acessos || 1} acessos</span>
      ${u.aluna !== "sim" ? `<br><button class="lib" type="button" data-lib="${esc(u.id)}">Liberar como aluna</button>` : ""}</div>`;
  }).join("") || '<div class="empty">Nenhum cadastro encontrado.</div>';
  $$("#adm-list [data-lib]").forEach(b => b.onclick = () => liberar(ADM.find(u => u.id === b.dataset.lib)));
  const np = ADM.filter(u => u.status === "pendente").length;
  $("#adm-pend").innerHTML = np ? `<div class="verify">${np} ${np > 1 ? "mães aguardam" : "mãe aguarda"} liberação. Escolha "Aguardando liberação" no filtro para ver.</div>` : "";
}
async function liberar(u) {
  try {
    await setDoc(doc(db, "alunas", u.email), { em: serverTimestamp(), origem: "manual" });
    await updateDoc(doc(db, "users", u.id), { aluna: "sim", status: "ativa" });
    u.aluna = "sim"; u.status = "ativa"; renderAdmin(); countAlunas(); toast(u.nome.split(" ")[0] + " liberada.");
  } catch (e) { console.error(e); toast("Não consegui liberar. Tente de novo."); }
}
async function countAlunas() {
  try { const c = await getCountFromServer(collection(db, "alunas")); $("#al-count").textContent = "· " + c.data().count + " e-mails"; } catch (e) {}
}
async function loadMode() {
  let modo = "alunas";
  try { const x = await getDoc(doc(db, "config", "acesso")); if (x.exists()) modo = x.data().modo; } catch (e) {}
  showMode(modo);
}
function showMode(modo) {
  $$(".adm-mode button").forEach(b => b.classList.toggle("on", b.dataset.modo === modo));
  $("#mode-note").textContent = modo === "aberto"
    ? "Qualquer mãe que se cadastrar entra. As alunas da lista continuam reconhecidas como alunas."
    : "Só entra quem está na lista de alunas. As outras ficam aguardando, e você libera aqui.";
}
$$(".adm-mode button").forEach(b => b.onclick = async () => {
  const modo = b.dataset.modo;
  try { await setDoc(doc(db, "config", "acesso"), { modo, em: serverTimestamp() }); showMode(modo); toast(modo === "aberto" ? "Aplicativo aberto para todas as mães." : "Aplicativo só para alunas."); }
  catch (e) { console.error(e); toast("Não consegui mudar. Tente de novo."); }
});
async function importEmails(list, origem) {
  for (let i = 0; i < list.length; i += 400) {
    const batch = writeBatch(db);
    list.slice(i, i + 400).forEach(em => batch.set(doc(db, "alunas", em), { em: serverTimestamp(), origem }));
    await batch.commit();
  }
  // quem já tinha se cadastrado e está na lista nova passa a aluna
  const set = new Set(list);
  for (const u of ADM.filter(u => set.has(u.email) && u.aluna !== "sim")) {
    await updateDoc(doc(db, "users", u.id), { aluna: "sim", status: "ativa" }).catch(() => {});
    u.aluna = "sim"; u.status = "ativa";
  }
  renderAdmin(); countAlunas();
}
$("#al-file").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const txt = await f.text();
  const list = [...new Set((txt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(x => x.toLowerCase()))];
  e.target.value = "";
  if (!list.length) return toast("Não encontrei e-mails nesse arquivo.");
  toast(`Importando ${list.length} e-mails...`);
  try { await importEmails(list, "planilha"); toast(`${list.length} e-mails na lista de alunas.`); }
  catch (err) { console.error(err); toast("A importação parou no meio. Tente de novo, quem já entrou não duplica."); }
};
$("#al-add").onclick = async () => {
  const em = $("#al-one").value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return toast("Confira o e-mail.");
  try { await importEmails([em], "manual"); $("#al-one").value = ""; toast(em + " liberado."); }
  catch (err) { console.error(err); toast("Não consegui liberar. Tente de novo."); }
};
$("#adm-q").addEventListener("input", renderAdmin);
$("#adm-f").addEventListener("change", renderAdmin);
$("#adm-csv").onclick = () => {
  const cols = ["nome", "email", "whats", "cidade", "uf", "grupo", "instr", "aluna", "status", "criadoEm", "ultimoAcesso", "acessos"];
  const head = ["Nome", "E-mail", "WhatsApp", "Cidade", "UF", "Grupo", "Instrumento", "Aluna", "Situação", "Cadastro", "Último acesso", "Acessos"];
  const cell = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const lines = [head.map(cell).join(";")].concat(admFiltered().map(u => cols.map(c => cell(c === "criadoEm" || c === "ultimoAcesso" ? fmt(tsDate(u[c])) : c === "aluna" ? (u.aluna === "sim" ? "sim" : "não") : u[c])).join(";")));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "cadastros-maes-" + new Date().toISOString().slice(0, 10) + ".csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

/* ---------- funciona sem internet ---------- */
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

/* ---------- músicas pelo painel ---------- */
let lote = null, REVIEW = [], sending = false;
const STORAGE_ERR = {
  "storage/unauthorized": "o armazenamento recusou. Confira se as regras do Storage foram publicadas e se o seu e-mail foi confirmado.",
  "storage/bucket-not-found": "o armazenamento ainda não foi criado no Firebase (Storage > Começar).",
  "storage/project-not-found": "o armazenamento ainda não foi criado no Firebase (Storage > Começar).",
  "storage/unknown": "o armazenamento não respondeu. Confira se o Storage foi criado e se o plano Blaze está ativo.",
  "storage/retry-limit-exceeded": "a internet caiu no meio do envio. Tente de novo.",
  "permission-denied": "o banco de dados recusou. Confira se as regras novas do Firestore foram publicadas e se o seu e-mail foi confirmado."
};
const loteMod = () => lote || (lote = import("./lote.js?v=10"));
function renderMusicAdmin() {
  const fsSongs = S.songs.filter(x => x.storage), stat = S.songs.filter(x => !x.storage);
  const row = (x, edit) => `<div class="mu-row"><div><b>${esc(x.titulo)}</b><small>${[x.cifra || x.cifraJson ? "cifra" : "", x.partituras?.length ? x.partituras.length + (x.partituras.length > 1 ? " partituras" : " partitura") : "", x.youtube ? "YouTube" : x.audio ? "áudio" : ""].filter(Boolean).join(" · ") || "sem arquivos"}</small></div>${edit ? `<button type="button" data-ed="${esc(x.id)}">Editar</button><button type="button" data-rm="${esc(x.id)}">Remover</button>` : ""}</div>`;
  $("#mu-list").innerHTML = (S.songs.length ? `<div class="mu-list-h">No aplicativo (${S.songs.length})</div>` : "") + fsSongs.map(x => row(x, true)).join("") + stat.map(x => row(x, false)).join("");
  $$("#mu-list [data-ed]").forEach(b => b.onclick = () => editSong(S.songs.find(x => x.id === b.dataset.ed)));
  $$("#mu-list [data-rm]").forEach(b => b.onclick = () => removeSong(S.songs.find(x => x.id === b.dataset.rm)));
}
async function pickFiles(list) {
  if (!list.length) return;
  const L = await loteMod();
  REVIEW = L.groupFiles([...list], S.songs);
  if (!REVIEW.length) return toast("Não encontrei PDF nem áudio nesses arquivos.");
  renderReview();
  for (const g of REVIEW.slice()) {
    const c = g.files.find(x => x.type === "cifra");
    if (c && !g.existe) {
      const r = await L.peekCifra(c.file);
      if (r?.titulo) g.titulo = r.titulo.replace(/\s+/g, " ").trim();
      if (r?.autor && !g.autor) g.autor = r.autor;
      if (r && !r.versoes) g.aviso = "Não reconheci os níveis e tons nesta cifra.";
      const card = $(`#mu-review .mu-card[data-g="${REVIEW.indexOf(g)}"]`);
      const before = REVIEW.length;
      REVIEW = L.mergeSame(REVIEW);
      if (REVIEW.length !== before && !sending) { renderReview(); continue; }
      if (card && !sending) {
        card.querySelector('[data-k="titulo"]').value = g.titulo;
        card.querySelector('[data-k="autor"]').value = g.autor;
        if (g.aviso) card.querySelector(".mu-status").textContent = g.aviso;
      }
    }
  }
}
$("#mu-files").onchange = e => { const l = [...e.target.files]; e.target.value = ""; pickFiles(l); };
$("#mu-dir").onchange = e => { const l = [...e.target.files]; e.target.value = ""; pickFiles(l); };
async function renderReview() {
  const L = await loteMod();
  if (!REVIEW.length) { $("#mu-review").innerHTML = ""; return; }
  $("#mu-review").innerHTML = REVIEW.map((g, i) => `<div class="mu-card" data-g="${i}">
      <div class="field"><label>Música${g.existe ? "" : '<span class="mu-new">nova</span>'}</label><input type="text" data-k="titulo" value="${esc(g.titulo)}"></div>
      <div class="field"><label>Autor</label><input type="text" data-k="autor" value="${esc(g.autor)}"></div>
      <div class="field"><label>Link do YouTube (se tiver)</label><input type="url" data-k="youtube" value="${esc(g.youtube)}" placeholder="https://youtu.be/..."></div>
      <label class="mu-chk"><input type="checkbox" data-k="curso" ${g.curso ? "checked" : ""}> Tem aula no curso</label>
      ${g.files.map((f, j) => `<div class="mu-file"><span>${esc(f.file.name)}</span><select data-f="${j}">${Object.entries(L.TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${k === f.type ? "selected" : ""}>${v}</option>`).join("")}</select></div>`).join("")}
      <div class="mu-bar hidden"><i></i></div><div class="mu-status">${esc(g.aviso || "")}</div></div>`).join("")
    + `<div class="mu-total hidden" id="mu-total"><div class="mu-total-t"><span id="mu-total-l"></span><b id="mu-total-p">0%</b></div><div class="mu-bar big"><i id="mu-total-i"></i></div></div>
    <div class="mu-actions"><button class="mu-cancel" type="button" id="mu-cancel">Cancelar</button><button class="mu-send" type="button" id="mu-send">Enviar ${REVIEW.length} ${REVIEW.length > 1 ? "músicas" : "música"}</button></div>`;
  $$("#mu-review .mu-card").forEach(card => {
    const g = REVIEW[+card.dataset.g];
    card.querySelectorAll("[data-k]").forEach(inp => inp.oninput = inp.onchange = () => { g[inp.dataset.k] = inp.type === "checkbox" ? inp.checked : inp.value; });
    card.querySelectorAll("[data-f]").forEach(sel => sel.onchange = () => { g.files[+sel.dataset.f].type = sel.value; });
  });
  $("#mu-cancel").onclick = () => { REVIEW = []; renderReview(); };
  $("#mu-send").onclick = sendAll;
}
async function sendAll() {
  if (sending) return;
  await auth.currentUser.reload().catch(() => {});
  if (!auth.currentUser.emailVerified) {
    toast("Antes de enviar, confirme o seu e-mail: abra a mensagem do Firebase na caixa de entrada e toque no link.");
    return;
  }
  await auth.currentUser.getIdToken(true).catch(() => {});
  const L = await loteMod();
  sending = true;
  $("#mu-send").disabled = true; $("#mu-cancel").disabled = true; $("#mu-send").textContent = "Enviando...";
  let ok = 0, erro = "";
  const n = REVIEW.length;
  const total = $("#mu-total"); total.classList.remove("hidden");
  const setTotal = (i, f) => {
    const pct = Math.round(((i + f) / n) * 100);
    $("#mu-total-i").style.width = pct + "%"; $("#mu-total-p").textContent = pct + "%";
    $("#mu-total-l").textContent = i < n ? `Música ${i + 1} de ${n}: ${REVIEW[i].titulo}` : "Concluído";
  };
  total.scrollIntoView({ behavior: "smooth", block: "center" });
  for (const [i, g] of REVIEW.entries()) {
    const card = $(`#mu-review .mu-card[data-g="${i}"]`);
    const bar = card?.querySelector(".mu-bar"); bar?.classList.remove("hidden");
    setTotal(i, 0);
    const st = () => $(`#mu-review .mu-card[data-g="${i}"] .mu-status`) || { set className(v) {}, set textContent(v) {} };
    const log = t => { g.msg = t; const e = st(); e.className = "mu-status"; e.textContent = t; };
    g.files = g.files.filter(f => f.type !== "ignorar");
    if (!g.titulo.trim()) { const e = st(); e.className = "mu-status bad"; e.textContent = "Falta o nome da música."; continue; }
    try {
      await L.sendSong(g, {
        log,
        progress: f => { if (bar) bar.firstElementChild.style.width = Math.round(f * 100) + "%"; setTotal(i, f); },
        upload: (path, blob, type) => uploadBytes(sref(storage, path), blob, { contentType: type }),
        save: (id, data) => setDoc(doc(db, "songs", id), { ...data, updatedAt: serverTimestamp() }, { merge: true })
      });
      const e = st(); e.className = "mu-status ok"; e.textContent = g.semTom ? "Enviada. A cifra está fora do modelo e foi como imagem, sem troca de tom." : "Enviada."; g.done = true; ok++;
    } catch (err) {
      console.error(err);
      const msg = STORAGE_ERR[err?.code] || err?.message || "tente de novo";
      erro = msg;
      const e = st(); e.className = "mu-status bad"; e.textContent = "Não deu certo: " + msg;
      if (STORAGE_ERR[err?.code] && err.code !== "storage/retry-limit-exceeded") break; // o mesmo erro vai se repetir nas outras
    }
  }
  setTotal(n, 0);
  sending = false;
  urlCache.clear(); Object.keys(cifraCache).forEach(k => delete cifraCache[k]);
  await loadSongs(); renderList(); renderMusicAdmin();
  REVIEW = REVIEW.filter(g => !g.done);
  const semTom = REVIEW.filter(g => g.done && g.semTom).map(g => g.titulo);
  if (ok) toast(ok + (ok === 1 ? " música enviada." : " músicas enviadas.") + (semTom.length ? " A cifra de " + semTom.join(", ") + " foi como imagem, sem troca de tom." : ""));
  if (erro && !ok) toast("Não enviou: " + erro);
  if (REVIEW.length) {
    renderReview();
    if (erro) setTimeout(() => { const e = $("#mu-review .mu-status"); if (e) { e.className = "mu-status bad"; e.textContent = "Não deu certo: " + erro; } }, 50);
  } else $("#mu-review").innerHTML = "";
}
function editSong(x) {
  REVIEW = [{ id: x.id, titulo: x.titulo, autor: x.autor || "", youtube: x.youtube || "", curso: x.curso !== false, existe: true, files: [] }];
  renderReview();
  $("#mu-review").scrollIntoView({ behavior: "smooth", block: "start" });
  toast("Mude o que quiser e toque em Enviar. Para trocar arquivos, escolha os novos PDFs.");
}
async function removeSong(x) {
  const btn = $(`#mu-list [data-rm="${x.id}"]`);
  if (btn.dataset.sure !== "1") { btn.dataset.sure = "1"; btn.textContent = "Tocar de novo para remover"; setTimeout(() => { if (btn.isConnected) { btn.dataset.sure = ""; btn.textContent = "Remover"; } }, 4000); return; }
  try {
    await deleteDoc(doc(db, "songs", x.id));
    try { const all = await listAll(sref(storage, "songs/" + x.id)); await Promise.allSettled(all.items.map(deleteObject)); } catch (e) {}
    await loadSongs(); renderList(); renderMusicAdmin(); toast(x.titulo + " removida.");
  } catch (e) { console.error(e); toast("Não consegui remover. Tente de novo."); }
}

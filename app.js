import { firebaseConfig } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, getDoc, deleteDoc, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const fmtDate = s => { if (!s) return ""; const [y, m, d] = s.split("-"); return `${y}. ${+m}. ${+d}.`; };
const kb = b => b < 1024*1024 ? Math.round(b/1024) + "KB" : (b/1024/1024).toFixed(1) + "MB";
$("date").value = todayStr();

/* ---------- 설정 확인 ---------- */
if (!firebaseConfig.projectId) {
  $("setupNotice").hidden = false;
  throw new Error("config.js 설정이 비어 있음");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

let uid = null, unsub = null;
let quotes = [], chapters = [], filter = "", formChapter = "", unsubChap = null, pickIndex = -1, imgBlob = null, imgUrl = null, pendingDelete = null;
const quotesCol = () => collection(fs, "users", uid, "quotes");
const imagesCol = () => collection(fs, "users", uid, "images");
const chapDoc = () => doc(fs, "users", uid, "meta", "chapters");
const DEFAULT_CHAPTERS = ["학생", "용기", "배려", "우울"];
const shown = () => filter ? quotes.filter(q => q.chapter === filter) : quotes;

function setStatus(msg, err) { const s = $("status"); s.textContent = msg || ""; s.classList.toggle("err", !!err); }
function showApp(on) {
  ["chapterBar", "today", "addBox", "list", "foot"].forEach(id => $(id).hidden = !on);
  $("loginBox").hidden = on;
}

/* ---------- 로그인 ---------- */
$("loginBox").addEventListener("submit", async e => {
  e.preventDefault();
  $("loginStatus").textContent = "들어가는 중이에요…"; $("loginStatus").classList.remove("err");
  try { await signInWithEmailAndPassword(auth, $("email").value.trim(), $("pw").value); }
  catch (err) {
    $("loginStatus").textContent = "이메일이나 비밀번호가 맞지 않아요. 다시 확인해 주세요.";
    $("loginStatus").classList.add("err");
  }
});
$("logout").onclick = () => signOut(auth);

onAuthStateChanged(auth, user => {
  if (unsub) { unsub(); unsub = null; }
  if (unsubChap) { unsubChap(); unsubChap = null; }
  if (!user) { uid = null; quotes = []; showApp(false); return; }
  uid = user.uid; $("who-am-i").textContent = user.email || ""; showApp(true);
  renderToday();
  unsubChap = onSnapshot(chapDoc(), snap => {
    if (!snap.exists()) { if (!snap.metadata.fromCache) setDoc(chapDoc(), { list: DEFAULT_CHAPTERS }); chapters = [...DEFAULT_CHAPTERS]; }
    else chapters = snap.data().list || [];
    renderChapters();
  });
  unsub = onSnapshot(query(quotesCol(), orderBy("createdAt", "desc")), snap => {
    quotes = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
    if (pickIndex < 0 && quotes.length) pickIndex = dailyIndex(quotes.length);
    renderChapters(); renderToday(); renderList();
  }, () => { $("emptyList").textContent = "조각을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요."; });
});

/* ---------- 오늘의 조각 ---------- */
function dailyIndex(n) { let h = 0; for (const c of todayStr()) h = (h*31 + c.charCodeAt(0)) >>> 0; return h % n; }
function renderToday() {
  const box = $("today"); const qs = shown();
  $("today").querySelector(".eyebrow").textContent = filter ? `오늘 꺼내 본 「${filter}」 조각` : "오늘 꺼내 본 조각";
  if (!qs.length) {
    box.classList.add("empty");
    $("todayText").textContent = filter ? `「${filter}」 챕터에는 아직 조각이 없어요. 아래에서 하나 담아 볼까요?` : "아직 담아 둔 조각이 없어요. 마음에 남은 문장을 하나 담아 주면, 여기에서 날마다 하나씩 다시 꺼내 줄게요.";
    $("todayMeta").textContent = ""; $("shuffle").hidden = true; return;
  }
  box.classList.remove("empty");
  const q = qs[Math.max(0, pickIndex) % qs.length];
  $("todayText").textContent = q.text;
  $("todayMeta").textContent = [q.who, q.chapter && !filter ? "「" + q.chapter + "」" : "", fmtDate(q.date) + "에 담은 조각"].filter(Boolean).join(" · ");
  $("shuffle").hidden = qs.length < 2;
}
$("shuffle").onclick = () => {
  const len = shown().length; if (len < 2) return;
  let n; do { n = Math.floor(Math.random() * len); } while (n === Math.max(0, pickIndex) % len);
  pickIndex = n; renderToday();
};

/* ---------- 모아 둔 조각들 ---------- */
function renderList() {
  const list = $("list");
  list.querySelectorAll(".item").forEach(e => e.remove());
  const qs = shown();
  $("emptyList").hidden = qs.length > 0;
  $("emptyList").textContent = filter ? `「${filter}」 챕터의 첫 조각을 기다리고 있어요.` : "첫 번째 조각을 기다리고 있어요.";
  $("excel").hidden = quotes.length === 0;
  $("list").querySelector("h2").textContent = filter ? `「${filter}」 조각들` : "모아 둔 조각들";
  $("count").textContent = `조각 ${quotes.length}개`; $("count").hidden = !quotes.length;
  for (const q of qs) {
    const el = document.createElement("article"); el.className = "item";
    const t = document.createElement("time"); t.dateTime = q.date; t.textContent = fmtDate(q.date);
    const body = document.createElement("div"); body.className = "body";
    if (q.chapter && !filter) { const c = document.createElement("span"); c.className = "chap"; c.textContent = q.chapter; body.append(c); }
    const p = document.createElement("p"); p.textContent = q.text; body.append(p);
    if (q.who) { const w = document.createElement("span"); w.className = "who"; w.textContent = "— " + q.who; body.append(w); }
    if (q.thumb) {
      const im = document.createElement("img"); im.src = q.thumb; im.alt = "함께 담은 사진"; im.loading = "lazy";
      im.onclick = () => openImage(q); body.append(im);
    }
    const tools = document.createElement("div"); tools.className = "tools";
    if (pendingDelete === q.id) {
      const c = document.createElement("span"); c.className = "confirm"; c.textContent = "이 조각을 덜어 낼까요?";
      const yes = document.createElement("button"); yes.textContent = "덜어 내기"; yes.onclick = () => removeQuote(q);
      const no = document.createElement("button"); no.className = "ghost"; no.textContent = "그대로 두기";
      no.onclick = () => { pendingDelete = null; renderList(); };
      c.append(yes, no); tools.append(c);
    } else {
      const del = document.createElement("button"); del.className = "ghost"; del.textContent = "덜어 내기"; del.style.paddingLeft = "0";
      del.onclick = () => { pendingDelete = q.id; renderList(); }; tools.append(del);
    }
    body.append(tools);
    el.append(t, body); list.append(el);
  }
}
async function openImage(q) {
  $("viewerImg").src = q.thumb; $("viewer").hidden = false;
  if (!q.hasImage) return;
  try { const s = await getDoc(doc(imagesCol(), q.id)); if (s.exists() && !$("viewer").hidden) $("viewerImg").src = s.data().data; } catch (e) {}
}
$("viewer").onclick = () => { $("viewer").hidden = true; };

async function removeQuote(q) {
  pendingDelete = null;
  try {
    await deleteDoc(doc(quotesCol(), q.id));
    if (q.hasImage) await deleteDoc(doc(imagesCol(), q.id));
  } catch (e) { renderList(); }
}

/* ---------- 엑셀로 내려받기 ---------- */
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); });
}
$("excel").onclick = async () => {
  const btn = $("excel"); const label = btn.textContent;
  btn.disabled = true; btn.textContent = "만드는 중…";
  try {
    if (!window.XLSX) await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
    const rows = [...quotes].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || 0) - (b.createdAt || 0))
      .map((q, i) => ({ "번호": i + 1, "날짜": q.date || "", "챕터": q.chapter || "", "문장": q.text || "", "누구의 말": q.who || "", "사진": q.hasImage ? "있음" : "" }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 6 }, { wch: 12 }, { wch: 10 }, { wch: 70 }, { wch: 24 }, { wch: 6 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "모아 둔 조각들");
    XLSX.writeFile(wb, `생각조각집_${todayStr()}.xlsx`);
  } catch (e) { alert("엑셀 파일을 만들지 못했어요. 인터넷 연결을 확인해 주세요."); }
  finally { btn.disabled = false; btn.textContent = label; }
};

/* ---------- 사진: 줄여서 보관 ---------- */
async function resize(src, max, quality) {
  const bmp = await createImageBitmap(src);
  const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}
const dataUrlBytes = u => Math.round((u.length - u.indexOf(",") - 1) * 3 / 4);

async function takeFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  imgBlob = file;
  if (imgUrl) URL.revokeObjectURL(imgUrl);
  imgUrl = URL.createObjectURL(file);
  $("previewImg").src = imgUrl; $("preview").hidden = false;
  $("previewInfo").textContent = "사진은 작게 줄여서 보관돼요";
  readText(file);
}
async function readText(file) {
  setStatus("사진 속 글자를 읽는 중이에요… (처음 한 번은 조금 걸려요)"); $("save").disabled = true;
  try {
    if (!window.Tesseract) await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js");
    // 너무 큰 사진은 줄여서 읽으면 빨라요
    const small = await resize(file, 1800, 0.9);
    const { data } = await Tesseract.recognize(small, "kor+eng");
    let txt = (data.text || "")
      .replace(/[ \t]+/g, " ")
      .replace(/([가-힣]) (?=[가-힣]\b)/g, "$1")
      .split("\n").map(l => l.trim()).filter(Boolean).join("\n").trim();
    if (!txt) setStatus("사진에서 글자를 찾지 못했어요. 직접 적어 주세요.");
    else { $("text").value = txt; setStatus("읽어 온 글자를 한 번 다듬고 담아 주세요."); }
  } catch (e) {
    setStatus("글자를 읽지 못했어요. 직접 적어 주세요.", true);
  } finally { $("save").disabled = false; }
}
function clearImage() { imgBlob = null; if (imgUrl) URL.revokeObjectURL(imgUrl); imgUrl = null; $("preview").hidden = true; $("file").value = ""; }

$("drop").onclick = () => $("file").click();
$("drop").onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } };
$("file").onchange = e => takeFile(e.target.files[0]);
["dragover", "dragenter"].forEach(ev => $("drop").addEventListener(ev, e => { e.preventDefault(); $("drop").classList.add("over"); }));
["dragleave", "drop"].forEach(ev => $("drop").addEventListener(ev, e => { e.preventDefault(); $("drop").classList.remove("over"); }));
$("drop").addEventListener("drop", e => takeFile(e.dataTransfer.files[0]));
document.addEventListener("paste", e => { const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith("image/")); if (f && uid) takeFile(f); });
$("clearImg").onclick = clearImage;

/* ---------- 담아 두기 ---------- */
$("save").onclick = async () => {
  const text = $("text").value.trim();
  if (!text) { setStatus("담을 문장을 적어 주세요.", true); $("text").focus(); return; }
  $("save").disabled = true; setStatus("담는 중이에요…");
  try {
    const ref = doc(quotesCol());
    const data = { text, date: $("date").value || todayStr(), who: $("who").value.trim(), chapter: formChapter, createdAt: Date.now(), hasImage: false };
    let full = null;
    if (imgBlob && $("keepImg").checked) {
      data.thumb = await resize(imgBlob, 240, 0.7);
      full = await resize(imgBlob, 1000, 0.72);
      if (dataUrlBytes(full) > 900 * 1024) full = await resize(imgBlob, 800, 0.6);
      data.hasImage = true;
    }
    if (full) await setDoc(doc(imagesCol(), ref.id), { data: full });
    await setDoc(ref, data);
    $("text").value = ""; $("who").value = ""; $("date").value = todayStr(); clearImage();
    setStatus(full ? `잘 담아 두었어요. (사진 ${kb(dataUrlBytes(full))})` : "잘 담아 두었어요.");
  } catch (e) { setStatus("담지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.", true); }
  finally { $("save").disabled = false; }
};

/* ---------- 챕터 ---------- */
function chip(label, pressed, onclick, count) {
  const b = document.createElement("button"); b.type = "button"; b.className = "chip";
  b.setAttribute("aria-pressed", pressed ? "true" : "false"); b.textContent = label;
  if (count !== undefined) { const n = document.createElement("span"); n.className = "n"; n.textContent = count; b.append(n); }
  b.onclick = onclick; return b;
}
function renderChapters() {
  if (filter && !chapters.includes(filter)) filter = "";
  const counts = {}; quotes.forEach(q => { if (q.chapter) counts[q.chapter] = (counts[q.chapter] || 0) + 1; });
  const f = $("filterChips"); f.replaceChildren();
  f.append(chip("전체", !filter, () => setFilter(""), quotes.length || undefined));
  chapters.forEach(c => f.append(chip(c, filter === c, () => setFilter(c), counts[c] || undefined)));
  const add = chip("+ 새 챕터", false, () => { $("newChap").hidden = false; $("newChapName").focus(); });
  add.classList.add("add"); add.removeAttribute("aria-pressed"); f.append(add);

  const g = $("formChips"); g.replaceChildren();
  g.append(chip("고르지 않기", !formChapter, () => { formChapter = ""; renderChapters(); }));
  chapters.forEach(c => g.append(chip(c, formChapter === c, () => { formChapter = c; renderChapters(); })));
}
function setFilter(c) {
  filter = c; pickIndex = shown().length ? dailyIndex(shown().length) : 0;
  if (c) formChapter = c;
  renderChapters(); renderToday(); renderList();
}
$("newChap").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("newChapName").value.trim().replace(/\s+/g, " ");
  if (!name) return;
  if (!chapters.includes(name)) {
    chapters = [...chapters, name]; renderChapters();
    try { await setDoc(chapDoc(), { list: chapters }); } catch (err) {}
  }
  $("newChapName").value = ""; $("newChap").hidden = true; setFilter(name);
});
$("newChapCancel").onclick = () => { $("newChapName").value = ""; $("newChap").hidden = true; };

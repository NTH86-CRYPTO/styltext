/* =========================
   StealthText – Mode API
   ========================= */

window.scrollToSection = (sel) => {
  const el = document.querySelector(sel);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
};

// === URL API
const API = "http://localhost:4000"; // change si déployé
let TOKEN = localStorage.getItem("st_token") || null;

// --- Helpers
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(API + path, { ...opts, headers });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text } }
  if (!res.ok) throw data;
  return data;
}
function setText(id, txt){ const el=document.getElementById(id); if(el) el.textContent = txt; }
function showErr(where,e){
  console.error(`[${where}]`, e);
  alert((e && (e.error||e.message)) || "Erreur");
  setText("authStatus",(e && (e.error||e.message)) || "Erreur");
}

// --- Elements
const inputEl   = document.getElementById("inputText");
const outputEl  = document.getElementById("outputText");
const convertEl = document.getElementById("convertBtn");
const copyEl    = document.getElementById("copyBtn");
const msgEl     = document.getElementById("message");
const charCount = document.getElementById("charCount");
const charBar   = document.getElementById("charBar");
const attemptEl = document.getElementById("attemptCount");

// --- Auth elements
const emailEl   = document.getElementById("email");
const passEl    = document.getElementById("password");
const statusEl  = document.getElementById("authStatus");

// --- Statut auth initial
function setAuthStatus(txt){ if (statusEl) statusEl.textContent = txt; }
if (TOKEN) {
  api("/api/me")
    .then(u=>{
      setAuthStatus(`Connecté : ${u.email}${u.premium?" (Premium)":""}`);
      if (u.premium && attemptEl) attemptEl.textContent = "Essais illimités (Premium)";
    })
    .catch(()=> setAuthStatus("Déconnecté"));
}

// --- SIGNUP / LOGIN / LOGOUT
document.getElementById("btnSignup")?.addEventListener("click", async ()=>{
  try{
    const r = await api("/api/auth/signup", {
      method:"POST",
      body: JSON.stringify({ email: (emailEl?.value||"").trim(), password: passEl?.value||"" })
    });
    TOKEN = r.token; localStorage.setItem("st_token", TOKEN);
    setAuthStatus(`Connecté : ${r.user.email}${r.user.premium?" (Premium)":""}`);
    if (r.user.premium && attemptEl) attemptEl.textContent = "Essais illimités (Premium)";
  }catch(e){ showErr("signup", e); }
});
document.getElementById("btnLogin")?.addEventListener("click", async ()=>{
  try{
    const r = await api("/api/auth/login", {
      method:"POST",
      body: JSON.stringify({ email: (emailEl?.value||"").trim(), password: passEl?.value||"" })
    });
    TOKEN = r.token; localStorage.setItem("st_token", TOKEN);
    setAuthStatus(`Connecté : ${r.user.email}${r.user.premium?" (Premium)":""}`);
    if (r.user.premium && attemptEl) attemptEl.textContent = "Essais illimités (Premium)";
  }catch(e){ showErr("login", e); }
});
document.getElementById("btnLogout")?.addEventListener("click", ()=>{
  TOKEN = null; localStorage.removeItem("st_token");
  setAuthStatus("Déconnecté");
});

// --- CONVERTIR
convertEl?.addEventListener("click", async ()=>{
  const input = inputEl?.value || "";
  try{
    const r = await api("/api/convert", { method:"POST", body: JSON.stringify({ text: input })});
    if (outputEl) outputEl.value = r.result || "";
    if (copyEl)  copyEl.disabled = !(r.result||"").trim();
    if (msgEl)   msgEl.textContent = r.premium ? "Conversion (Premium) ✔" : `Conversion ✔ — essais restants : ${r.remaining}`;
    if (attemptEl) attemptEl.textContent = r.premium ? "Essais illimités (Premium)" : `${r.remaining} essais restants aujourd’hui`;
  }catch(e){
    if (msgEl) msgEl.textContent = (e && (e.error||e.message)) || "Erreur";
    if (attemptEl && /limite|atteint/i.test(msgEl.textContent)) attemptEl.textContent = msgEl.textContent;
  }
});

// --- COPIER
copyEl?.addEventListener("click", async ()=>{
  if (!outputEl?.value) return;
  try { await navigator.clipboard.writeText(outputEl.value); if (msgEl) msgEl.textContent = "Texte copié ✔"; }
  catch { outputEl.select(); document.execCommand("copy"); if (msgEl) msgEl.textContent = "Texte copié ✔"; }
});

// --- COMPTEUR CARACTÈRES
inputEl?.addEventListener("input", ()=>{
  const len = inputEl.value.length;
  if (charCount) charCount.textContent = `${len} / 200 caractères`;
  if (charBar) {
    const r = Math.min(len/200, 1);
    charBar.style.width = `${r*100}%`;
    charBar.style.background = r < 0.7 ? "#4cc9f0" : (r < 1 ? "#ffb703" : "#ef233c");
  }
});

// --- FAQ (si besoin)
document.querySelectorAll(".faq-question").forEach(btn=>{
  btn.addEventListener("click", ()=> btn.parentElement.classList.toggle("active"));
});

/* ---------- PREMIUM ---------- */
// Handler global appelé par onclick dans l'HTML
window.handlePremium = async function handlePremium(){
  try {
    if (!TOKEN) {
      alert("Connecte-toi d’abord (ou crée un compte) pour passer en Premium.");
      document.getElementById("email")?.focus();
      return;
    }
    const r = await api("/api/premium/activate", { method: "POST" });
    setAuthStatus(`Connecté : ${r.user.email} (Premium)`);
    if (attemptEl) attemptEl.textContent = "Essais illimités (Premium)";
    alert("Ton compte est maintenant Premium ✅");
  } catch (e) {
    showErr("premium", e);
  }
};
// Listener de secours si jamais l’onclick n’était pas pris
document.getElementById("btnPremium")?.addEventListener("click", window.handlePremium);

// (Optionnel) ping santé API
window.addEventListener("load", async ()=>{
  try { await api("/api/health"); }
  catch(e){ showErr("health", e); }
});

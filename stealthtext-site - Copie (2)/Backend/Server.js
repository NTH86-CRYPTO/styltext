// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// --- DB (SQLite fichier local)
const db = new sqlite3.Database(path.join(__dirname, 'db.sqlite'));

// --- init tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    premium INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS usage_daily(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    day TEXT NOT NULL,      -- format YYYY-MM-DD
    count INTEGER DEFAULT 0,
    UNIQUE(user_id, day),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );`);
});

// --- config
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const FREE_CHAR_LIMIT = 200;
const FREE_CONVERSION_LIMIT = 5;

// --- helpers
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}
function auth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}
const todayISO = () => new Date().toISOString().slice(0,10);
const jwt = require("jsonwebtoken");

// --- middleware simple pour vérifier le token
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Non authentifié" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token invalide" });
  }
}

// --- route d’activation Premium
app.post("/api/premium/activate", auth, (req, res, next) => {
  const userId = req.user.id;
  db.run("UPDATE users SET premium = 1 WHERE id = ?", [userId], function (err) {
    if (err) return next(err);
    db.get("SELECT id, email, premium FROM users WHERE id = ?", [userId], (err2, row) => {
      if (err2) return next(err2);
      res.json({ user: row });
    });
  });
});

// --- conversion map
const MAP_BASE = {
  'A':'А','B':'В','C':'С','E':'Е','H':'Н','I':'І','J':'Ј','K':'К','M':'М','N':'Ν','O':'О','P':'Р','S':'Ѕ','T':'Т','X':'Х','Y':'Υ',
  'a':'а','c':'с','e':'е','i':'і','j':'ј','o':'о','p':'р','s':'ѕ','x':'х','y':'у',
  'd':'ԁ','h':'һ','n':'п','t':'т','u':'υ','v':'ѵ','w':'ԝ','r':'г','b':'Ь','z':'ᴢ'
};
const MAP_GREEK_OX = { O:'Ο', X:'Χ' };
function convertText(text, useGreekOX=false) {
  const map = { ...MAP_BASE };
  if (useGreekOX) { map.O = MAP_GREEK_OX.O; map.X = MAP_GREEK_OX.X; }
  let out = '';
  for (const ch of text) out += map[ch] ?? ch;
  return out;
}

// --- AUTH
app.post('/api/auth/signup', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  const hash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare(`INSERT INTO users(email, password_hash) VALUES(?, ?)`);
  stmt.run(email.toLowerCase(), hash, function(err) {
    if (err) {
      if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'Email déjà utilisé' });
      return res.status(500).json({ error: 'Erreur serveur' });
    }
    const token = signToken({ id: this.lastID, email: email.toLowerCase() });
    res.json({ token, user: { id: this.lastID, email, premium: 0 } });
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Identifiants manquants' });
  db.get(`SELECT * FROM users WHERE email = ?`, [email.toLowerCase()], (err, row) => {
    if (err) return res.status(500).json({ error: 'Erreur serveur' });
    if (!row) return res.status(401).json({ error: 'Email ou mot de passe invalide' });
    if (!bcrypt.compareSync(password, row.password_hash)) return res.status(401).json({ error: 'Email ou mot de passe invalide' });
    const token = signToken({ id: row.id, email: row.email });
    res.json({ token, user: { id: row.id, email: row.email, premium: !!row.premium } });
  });
});

app.get('/api/me', auth, (req, res) => {
  db.get(`SELECT id, email, premium FROM users WHERE id = ?`, [req.user.id], (err, row) => {
    if (err || !row) return res.status(401).json({ error: 'Utilisateur introuvable' });
    res.json({ id: row.id, email: row.email, premium: !!row.premium });
  });
});

// --- CONVERT (avec limites)
app.post('/api/convert', auth, (req, res) => {
  const { text = '', useGreekOX = false } = req.body || {};
  if (typeof text !== 'string') return res.status(400).json({ error: 'Texte invalide' });

  db.get(`SELECT premium FROM users WHERE id = ?`, [req.user.id], (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'Utilisateur introuvable' });

    const premium = !!user.premium;
    const day = todayISO();

    if (!premium) {
      if (text.length > FREE_CHAR_LIMIT) {
        return res.status(403).json({ error: `Limite gratuite : ${FREE_CHAR_LIMIT} caractères par conversion.` });
      }
      // fetch compteur
      db.get(`SELECT count FROM usage_daily WHERE user_id = ? AND day = ?`, [req.user.id, day], (err2, row2) => {
        if (err2) return res.status(500).json({ error: 'Erreur serveur' });
        const used = row2 ? row2.count : 0;
        if (used >= FREE_CONVERSION_LIMIT) {
          return res.status(403).json({ error: `Vous avez atteint vos ${FREE_CONVERSION_LIMIT} essais gratuits aujourd’hui.` });
        }
        // increment + convert
        const next = used + 1;
        db.run(`INSERT INTO usage_daily(user_id, day, count) VALUES(?,?,?)
                ON CONFLICT(user_id, day) DO UPDATE SET count = excluded.count`,
          [req.user.id, day, next], (err3) => {
            if (err3) return res.status(500).json({ error: 'Erreur serveur' });
            const result = convertText(text, !!useGreekOX);
            res.json({ result, remaining: FREE_CONVERSION_LIMIT - next, premium: false });
          });
      });
    } else {
      const result = convertText(text, !!useGreekOX);
      res.json({ result, remaining: null, premium: true });
    }
  });
});

// --- Stripe webhook (stub) : à activer quand tu as Stripe
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  // TODO: vérifier la signature Stripe ici puis:
  // const email = ...; db.run('UPDATE users SET premium = 1 WHERE email = ?', [email])
  res.sendStatus(200);
});

// --- Start
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));

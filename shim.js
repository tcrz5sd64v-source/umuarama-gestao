/* =====================================================================
 * ADAPTADOR FIREBASE — Umuarama Gestão Operacional (versão hospedada)
 * O sistema foi escrito para o banco de documentos do Claude. Este arquivo
 * oferece a mesma interface (window.claude.use('db' | 'user' | 'downloads'))
 * usando o Cloud Firestore. Telas, fórmulas e validação não mudam.
 * Acesso ABERTO: qualquer pessoa com o link vê e edita (sem senha).
 * ===================================================================== */
(function () {
  'use strict';
  const cfg = window.FIREBASE_CONFIG;
  const configurado = cfg && cfg.apiKey && !/COLE_AQUI/.test(cfg.apiKey);
  let fs = null;
  if (configurado && window.firebase) {
    firebase.initializeApp(cfg);
    fs = firebase.firestore();
  }
  const FieldPath = window.firebase && firebase.firestore ? firebase.firestore.FieldPath : null;

  // ---------- erros no formato que o sistema espera ----------
  const mapErr = (e) => {
    const c = (e && e.code) || '';
    if (c === 'not-found' || c === 'invalid-argument' || c === 'permission-denied') return { code: 'invalid_argument', message: String(e.message || c) };
    if (c === 'resource-exhausted') return { code: 'resource_exhausted', message: String(e.message || c) };
    return { code: 'unavailable', message: String((e && e.message) || e) };
  };
  const wrapDoc = (snap) => { const d = snap.exists ? snap.data() : undefined; return { id: snap.id, exists: snap.exists, data: () => d, metadata: { fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites } }; };
  const wrapQuery = (qs) => { const docs = qs.docs.map(wrapDoc); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: qs.metadata.fromCache, hasPendingWrites: qs.metadata.hasPendingWrites } }; };
  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  /** update com mesclagem recursiva (como o banco do Claude): achata objetos em caminhos de campo */
  function flatten(obj, prefix, out) {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix.concat([k]);
      if (isPlain(v) && Object.keys(v).length) flatten(v, path, out);
      else out.push([path, v === undefined ? null : v]);
    }
    return out;
  }
  function docRef(path) {
    const ref = fs.doc(path);
    return {
      id: ref.id, path,
      get: () => ref.get().then(wrapDoc, (e) => { throw mapErr(e); }),
      set: (data) => ref.set(JSON.parse(JSON.stringify(data))).catch((e) => { throw mapErr(e); }),
      update: (data) => {
        const pares = flatten(JSON.parse(JSON.stringify(data)), [], []);
        if (!pares.length) return Promise.resolve();
        const args = []; for (const [p, v] of pares) args.push(new FieldPath(...p), v);
        return ref.update(...args).catch((e) => { throw mapErr(e); });
      },
      delete: () => ref.delete().catch((e) => { throw mapErr(e); }),
      onSnapshot: (next, err) => ref.onSnapshot({ includeMetadataChanges: false }, (s) => next(wrapDoc(s)), (e) => err && err(mapErr(e))),
      collection: (c) => query(fs.collection(path + '/' + c), path + '/' + c),
    };
  }
  function query(q, path) {
    return {
      path,
      where: (f, op, v) => query(q.where(f, op, v), path),
      orderBy: (f, dir) => query(q.orderBy(f, dir || 'asc'), path),
      limit: (n) => query(q.limit(n), path),
      get: () => q.get().then(wrapQuery, (e) => { throw mapErr(e); }),
      onSnapshot: (next, err) => q.onSnapshot((s) => next(wrapQuery(s)), (e) => err && err(mapErr(e))),
      doc: (id) => docRef(path + '/' + (id || fs.collection(path).doc().id)),
      add: (data) => { const r = docRef(path + '/' + fs.collection(path).doc().id); return r.set(data).then(() => r); },
    };
  }
  const db = fs ? { doc: docRef, collection: (c) => query(fs.collection(c), c) } : null;

  // ---------- carga inicial (dados que estavam no sistema) ----------
  async function instalarSeVazio() {
    const marca = fs.doc('config/_instalacao');
    const s = await marca.get();
    if (s.exists) return;
    let dados;
    try { dados = await (await fetch('dados-iniciais.json', { cache: 'no-store' })).json(); } catch (e) { return; }
    aviso('Preparando o sistema pela primeira vez — carregando os dados das planilhas…');
    let batch = fs.batch(), n = 0;
    for (const d of dados.docs) {
      batch.set(fs.doc(d.path), d.data); n++;
      if (n % 400 === 0) { await batch.commit(); batch = fs.batch(); }
    }
    batch.set(marca, { instalado: new Date().toISOString(), documentos: dados.docs.length, origem: dados.origem || '' });
    await batch.commit();
    aviso(null);
  }
  function aviso(txt) {
    let el = document.getElementById('fb-aviso');
    if (!txt) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'fb-aviso'; el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = txt;
  }

  // ---------- identidade simples (sem senha): nome guardado no aparelho ----------
  const LS = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* */ } } };
  let uid = LS.get('umuarama:uid'); if (!uid) { uid = 'u_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); LS.set('umuarama:uid', uid); }
  let nomes = {}, nomesEm = 0;
  async function carregarNomes() {
    if (!fs || Date.now() - nomesEm < 30000) return;
    nomesEm = Date.now();
    try { const qs = await fs.collection('pessoas').get(); qs.forEach((d) => { nomes[d.id] = (d.data() || {}).nome || ''; }); } catch (e) { /* */ }
  }
  function pedirNome() {
    return new Promise((resolve) => {
      const atual = LS.get('umuarama:nome');
      if (atual) return resolve(atual);
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = '<form class="modal" style="max-width:440px" id="fb-nome"><header><h2>Bem-vindo(a) ao sistema</h2></header><div class="body"><div class="field"><label for="fb-nome-i">Como você se chama?</label><input type="text" id="fb-nome-i" autocomplete="name" placeholder="Ex.: Leticia" required><span class="hint">Seu nome aparece no histórico de alterações. Fica salvo só neste aparelho.</span></div></div><footer><button type="button" class="btn" id="fb-pular">Pular</button><button type="submit" class="btn primary">Entrar</button></footer></form>';
      document.body.appendChild(ov);
      const fim = (nome) => { ov.remove(); if (nome) { LS.set('umuarama:nome', nome); if (fs) fs.doc('pessoas/' + uid).set({ nome, atualizado: new Date().toISOString() }, { merge: true }).catch(() => {}); } resolve(nome || ''); };
      ov.querySelector('#fb-nome').addEventListener('submit', (e) => { e.preventDefault(); fim(ov.querySelector('#fb-nome-i').value.trim()); });
      ov.querySelector('#fb-pular').addEventListener('click', () => fim(''));
      setTimeout(() => { const i = ov.querySelector('#fb-nome-i'); if (i) i.focus(); }, 50);
    });
  }
  const iniciais = (n) => (n || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const avatar = (n) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#1F5FBF"/><text x="32" y="40" font-family="sans-serif" font-size="24" fill="#fff" text-anchor="middle">${iniciais(n)}</text></svg>`);
  let nomeP = null;
  const user = {
    async me() { if (!nomeP) nomeP = pedirNome(); const name = await nomeP; nomes[uid] = name; return { id: uid, name, avatarUrl: avatar(name), color: '#1F5FBF', email: null, isOwner: false, canEdit: true }; },
    async id() { return uid; },
    async isOwner() { return false; },
    async canEdit() { return true; },
    async can() { return true; },
    async name() { return (await user.me()).name; },
    async profiles(ids) {
      await carregarNomes();
      const arr = Array.isArray(ids) ? ids : [ids]; const out = {};
      for (const i of arr) { const n = nomes[i] || ''; out[i] = { id: i, name: n, avatarUrl: avatar(n), color: '#1F5FBF', email: null, isMe: i === uid, guest: false }; }
      return out;
    },
    async search() { return []; },
  };

  // ---------- downloads: arquivo salvo direto pelo navegador ----------
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { status: 'saved' };
    },
  };

  let pronto = null;
  window.claude = {
    async use(nome) {
      if (nome === 'db') {
        if (!db) return null;
        if (!pronto) pronto = instalarSeVazio().catch((e) => console.error('Carga inicial', e));
        await pronto; return db;
      }
      if (nome === 'user') return user;
      if (nome === 'downloads') return downloads;
      return null;
    },
  };
  if (!configurado) console.warn('Firebase não configurado: edite firebase-config.js');
})();

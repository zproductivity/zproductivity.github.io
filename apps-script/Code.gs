/**
 * Z-Productivity — Work 1% daily
 * Backend Google Apps Script (Code.gs)
 *
 * Langkah pasang:
 * 1. Buka spreadsheet "Z-Productivity DB" > Ekstensi > Apps Script.
 * 2. Tempel file ini sebagai Code.gs, lalu buat file HTML bernama "Index" dan tempel Index.html.
 * 3. Pilih fungsi setupDatabase di toolbar editor lalu klik Run (sekali saja, izinkan akses).
 * 4. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 * 5. Login pertama: admin / admin123 lalu segera ganti password.
 */

const SPREADSHEET_ID = '13NhR-EG8DKgEOLslC112M2cjv3PXm8cgMzuSv-XKtOQ';
const APP_NAME = 'Z-Productivity';
const MENUS = ['work', 'home', 'monitor', 'kalender', 'setting'];
const LEVELS = ['LONG', 'GOAL', 'SHORT', 'TASK', 'SUB'];
const LEVEL_LABEL = { LONG: 'Jangka panjang', GOAL: 'Goal', SHORT: 'Jangka pendek', TASK: 'Task harian', SUB: 'Sub-task' };
const DOMAINS = ['WORK', 'HOME'];
const DEFAULT_KATEGORI = {
  WORK: [['Pekerjaan utama', '#2E5BFF'], ['Koordinasi & rapat', '#0EA5B7'], ['Belajar & sertifikasi', '#8B5CF6']],
  HOME: [['Kesehatan', '#17A673'], ['Keluarga', '#F97316'], ['Keuangan', '#FFB21E']]
};

const SCHEMA = {
  Users: ['user_id', 'username', 'password_hash', 'salt', 'nama', 'email', 'role', 'akses', 'aktif', 'created_at', 'last_login'],
  Settings: ['key', 'value', 'keterangan'],
  Kategori: ['kategori_id', 'domain', 'nama', 'warna', 'owner_id', 'urutan', 'created_at'],
  Items: ['item_id', 'parent_id', 'level', 'domain', 'kategori_id', 'judul', 'deskripsi', 'owner_id', 'assignee_id',
    'status', 'progress', 'bobot', 'start_date', 'due_date', 'created_at', 'updated_at', 'completed_at', 'completed_by'],
  Delegasi: ['delegasi_id', 'item_id', 'dari_user', 'ke_user', 'catatan', 'status', 'created_at', 'responded_at'],
  ActivityLog: ['log_id', 'timestamp', 'user_id', 'aksi', 'item_id', 'detail'],
  Sessions: ['token', 'user_id', 'created_at', 'expires_at']
};

const DEFAULT_SETTINGS = [
  ['app_name', APP_NAME, 'Nama aplikasi'],
  ['filosofi', 'Work 1% daily', 'Filosofi aplikasi'],
  ['session_hours', '168', 'Lama sesi login dalam jam'],
  ['default_akses', 'work,home,monitor,kalender', 'Akses menu default untuk pengguna baru']
];

/* =========================================================
 * Web app
 * ========================================================= */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* Menu khusus di spreadsheet */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Z-Productivity')
    .addItem('Setup / perbarui struktur database', 'setupDatabase')
    .addItem('Reset password admin ke admin123', 'resetAdminPassword')
    .addToUi();
}

/* =========================================================
 * Setup database — jalankan dari editor
 * Membuat sheet, kolom, format, setting awal, dan akun super admin.
 * Aman dijalankan ulang: sheet dan data yang sudah ada tidak dihapus.
 * ========================================================= */
function setupDatabase() {
  const ss = ss_();
  Object.keys(SCHEMA).forEach(function (name) {
    const h = SCHEMA[name];
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getMaxColumns() < h.length) sh.insertColumnsAfter(sh.getMaxColumns(), h.length - sh.getMaxColumns());
    if (sh.getMaxColumns() > h.length) sh.deleteColumns(h.length + 1, sh.getMaxColumns() - h.length);
    if (sh.getMaxRows() < 200) sh.insertRowsAfter(sh.getMaxRows(), 200 - sh.getMaxRows());
    sh.getRange(1, 1, 1, h.length).setValues([h])
      .setFontWeight('bold').setBackground('#131A2E').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, sh.getMaxRows() - 1, h.length).setNumberFormat('@');
    sh.autoResizeColumns(1, h.length);
  });

  ['Sheet1', 'Lembar1', 'Sheet 1', 'Lembar 1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  const existing = {};
  readAll_('Settings').forEach(function (r) { existing[r.key] = true; });
  DEFAULT_SETTINGS.forEach(function (r) {
    if (!existing[r[0]]) insert_('Settings', { key: r[0], value: r[1], keterangan: r[2] });
  });

  if (!readAll_('Users').length) {
    createUser_({ username: 'admin', password: 'admin123', nama: 'Super Admin', role: 'superadmin', akses: MENUS.join(',') });
  }
  SpreadsheetApp.flush();
  Logger.log('Database siap. Login awal: admin / admin123 (segera ganti password).');
  try { ss.toast('Database siap. Login awal: admin / admin123', APP_NAME, 8); } catch (e) {}
}

function resetAdminPassword() {
  const u = readAll_('Users').find(function (x) { return x.username === 'admin'; });
  if (!u) throw new Error('User admin tidak ditemukan.');
  const salt = Utilities.getUuid();
  update_('Users', u._row, { salt: salt, password_hash: hash_('admin123', salt), aktif: 'TRUE' });
  Logger.log('Password admin direset ke admin123');
}

/* =========================================================
 * Auth
 * ========================================================= */
function login(username, password) {
  try {
    const uname = String(username || '').trim().toLowerCase();
    const u = readAll_('Users').find(function (x) { return String(x.username).toLowerCase() === uname; });
    if (!u || !isTrue_(u.aktif) || hash_(String(password || ''), u.salt) !== u.password_hash) {
      throw new Error('Username atau password salah.');
    }
    const hours = Number(settingsMap_().session_hours) || 168;
    const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    const now = new Date();
    withLock_(function () {
      cleanupSessions_();
      insert_('Sessions', {
        token: token, user_id: u.user_id, created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + hours * 3600 * 1000).toISOString()
      });
      update_('Users', u._row, { last_login: now.toISOString() });
      log_(u, 'LOGIN', '', '');
    });
    CacheService.getScriptCache().put('s_' + token, u.user_id, 21600);
    const fresh = readAll_('Users').find(function (x) { return x.user_id === u.user_id; });
    return { ok: true, data: { token: token, boot: bootstrap_(fresh) } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function logout(token) {
  try {
    CacheService.getScriptCache().remove('s_' + token);
    withLock_(function () {
      const s = readAll_('Sessions').find(function (x) { return x.token === token; });
      if (s) deleteRows_('Sessions', [s._row]);
    });
  } catch (e) {}
  return { ok: true };
}

function auth_(token) {
  if (!token) throw authErr_();
  const cache = CacheService.getScriptCache();
  let uid = cache.get('s_' + token);
  if (!uid) {
    const s = readAll_('Sessions').find(function (x) { return x.token === token; });
    if (!s || new Date(s.expires_at) < new Date()) throw authErr_();
    uid = s.user_id;
    cache.put('s_' + token, uid, 21600);
  }
  const u = readAll_('Users').find(function (x) { return x.user_id === uid; });
  if (!u || !isTrue_(u.aktif)) throw authErr_();
  return u;
}

function authErr_() {
  const e = new Error('Sesi berakhir. Silakan masuk lagi.');
  e.code = 'AUTH';
  return e;
}

function cleanupSessions_() {
  const now = new Date();
  const rows = readAll_('Sessions')
    .filter(function (s) { return new Date(s.expires_at) < now; })
    .map(function (s) { return s._row; })
    .slice(0, 50);
  if (rows.length) deleteRows_('Sessions', rows);
}

/* =========================================================
 * API router — dipanggil dari client lewat google.script.run.api()
 * ========================================================= */
const ACTIONS = {
  bootstrap: function (u) { return bootstrap_(u); },
  saveItem: saveItem_,
  toggleItem: toggleItem_,
  deleteItem: deleteItem_,
  delegate: delegate_,
  undelegate: undelegate_,
  respondDelegasi: respondDelegasi_,
  saveKategori: saveKategori_,
  deleteKategori: deleteKategori_,
  listUsers: listUsers_,
  saveUser: saveUser_,
  changePassword: changePassword_,
  logs: logs_
};
const READ_ONLY = { bootstrap: 1, listUsers: 1, logs: 1 };

function api(token, action, payload) {
  try {
    const u = auth_(token);
    const fn = ACTIONS[action];
    if (!fn) throw new Error('Aksi tidak dikenal: ' + action);
    const p = payload || {};
    const data = READ_ONLY[action] ? fn(u, p) : withLock_(function () { return fn(u, p); });
    return { ok: true, data: data };
  } catch (e) {
    return { ok: false, error: e.message, code: e.code || '' };
  }
}

/* =========================================================
 * Bootstrap: semua data yang boleh dilihat user
 * ========================================================= */
function bootstrap_(u) {
  const items = readAll_('Items');
  const kat = readAll_('Kategori');
  const del = readAll_('Delegasi');
  const users = readAll_('Users');
  let visItems, visKat, visDel;

  if (isSA_(u)) {
    visItems = items; visKat = kat; visDel = del;
  } else {
    const vis = visibleIds_(items, u.user_id);
    visItems = items.filter(function (i) { return vis[i.item_id]; });
    const katIds = {};
    visItems.forEach(function (i) { katIds[i.kategori_id] = true; });
    visKat = kat.filter(function (k) { return k.owner_id === u.user_id || katIds[k.kategori_id]; });
    visDel = del.filter(function (d) { return d.dari_user === u.user_id || d.ke_user === u.user_id; });
  }

  return {
    user: safeUser_(u),
    users: users.filter(function (x) { return isTrue_(x.aktif); })
      .map(function (x) { return { user_id: x.user_id, nama: x.nama, username: x.username, role: x.role }; }),
    kategori: visKat.map(strip_),
    items: visItems.map(strip_),
    delegasi: visDel.map(strip_),
    settings: settingsMap_()
  };
}

/** Item milik user, yang ditugaskan ke user, dan seluruh turunannya. */
function visibleIds_(items, uid) {
  const kids = {};
  items.forEach(function (i) { (kids[i.parent_id] = kids[i.parent_id] || []).push(i); });
  const vis = {};
  function walk(it) {
    if (vis[it.item_id]) return;
    vis[it.item_id] = true;
    (kids[it.item_id] || []).forEach(walk);
  }
  items.forEach(function (i) { if (i.owner_id === uid || i.assignee_id === uid) walk(i); });
  return vis;
}

/* =========================================================
 * Items: jangka panjang > goal > jangka pendek > task harian > sub-task
 * ========================================================= */
function saveItem_(u, p) {
  const items = readAll_('Items');
  const judul = String(p.judul || '').trim();
  if (!judul) throw new Error('Judul wajib diisi.');
  if (LEVELS.indexOf(p.level) < 0) throw new Error('Level tidak valid.');
  const now = now_();
  const prog = clamp_(p.progress, 0, 100, 0);

  if (p.item_id) {
    const it = findItem_(items, p.item_id);
    assertAccess_(u, it, items);
    const hasKids = items.some(function (x) { return x.parent_id === it.item_id; });
    const upd = {
      judul: judul, level: p.level, deskripsi: String(p.deskripsi || ''),
      start_date: date_(p.start_date), due_date: date_(p.due_date),
      bobot: clamp_(p.bobot, 1, 5, 1), updated_at: now
    };
    if (!hasKids) {
      upd.progress = prog;
      if (prog >= 100 && it.status !== 'done') Object.assign(upd, { status: 'done', completed_at: now, completed_by: u.user_id });
      if (prog < 100 && it.status === 'done') Object.assign(upd, { status: 'todo', completed_at: '', completed_by: '' });
    }
    const moveKat = !it.parent_id && p.kategori_id && p.kategori_id !== it.kategori_id;
    if (moveKat) {
      assertKategori_(u, p.kategori_id, it.domain);
      upd.kategori_id = p.kategori_id;
    }
    update_('Items', it._row, upd);
    if (moveKat) {
      const ids = descendants_(items, it.item_id);
      items.forEach(function (x) {
        if (ids[x.item_id] && x.item_id !== it.item_id) update_('Items', x._row, { kategori_id: p.kategori_id });
      });
    }
    log_(u, 'ITEM_UPDATE', it.item_id, judul);
  } else {
    let domain = p.domain, kategoriId = p.kategori_id, parentId = '';
    if (p.parent_id) {
      const par = findItem_(items, p.parent_id);
      assertAccess_(u, par, items);
      const pr = LEVELS.indexOf(par.level), lr = LEVELS.indexOf(p.level);
      if (!(lr > pr || (par.level === 'SUB' && p.level === 'SUB'))) {
        throw new Error('Level harus berada di bawah ' + LEVEL_LABEL[par.level] + '.');
      }
      domain = par.domain; kategoriId = par.kategori_id; parentId = par.item_id;
    } else {
      if (DOMAINS.indexOf(domain) < 0) throw new Error('Pilih area Work atau Home.');
      if (!kategoriId) throw new Error('Pilih kategori dulu.');
      assertKategori_(u, kategoriId, domain);
    }
    const id = uid_('IT');
    const done = prog >= 100;
    insert_('Items', {
      item_id: id, parent_id: parentId, level: p.level, domain: domain, kategori_id: kategoriId,
      judul: judul, deskripsi: String(p.deskripsi || ''), owner_id: u.user_id, assignee_id: '',
      status: done ? 'done' : 'todo', progress: prog, bobot: clamp_(p.bobot, 1, 5, 1),
      start_date: date_(p.start_date), due_date: date_(p.due_date), created_at: now, updated_at: now,
      completed_at: done ? now : '', completed_by: done ? u.user_id : ''
    });
    log_(u, 'ITEM_CREATE', id, LEVEL_LABEL[p.level] + ': ' + judul);
  }
  return bootstrap_(u);
}

function toggleItem_(u, p) {
  const items = readAll_('Items');
  const it = findItem_(items, p.item_id);
  assertAccess_(u, it, items);
  const done = !!p.done;
  const now = now_();
  update_('Items', it._row, done
    ? { status: 'done', progress: 100, completed_at: now, completed_by: u.user_id, updated_at: now }
    : { status: 'todo', progress: 0, completed_at: '', completed_by: '', updated_at: now });
  if (done) {
    readAll_('Delegasi')
      .filter(function (d) { return d.item_id === it.item_id && (d.status === 'pending' || d.status === 'diterima'); })
      .forEach(function (d) { update_('Delegasi', d._row, { status: 'selesai', responded_at: now }); });
  }
  log_(u, done ? 'ITEM_DONE' : 'ITEM_UNDONE', it.item_id, it.judul);
  return bootstrap_(u);
}

function deleteItem_(u, p) {
  const items = readAll_('Items');
  const it = findItem_(items, p.item_id);
  if (!(isSA_(u) || it.owner_id === u.user_id)) throw new Error('Hanya pembuat item yang bisa menghapus.');
  const ids = descendants_(items, it.item_id);
  deleteRows_('Items', items.filter(function (x) { return ids[x.item_id]; }).map(function (x) { return x._row; }));
  const dl = readAll_('Delegasi').filter(function (d) { return ids[d.item_id]; }).map(function (d) { return d._row; });
  if (dl.length) deleteRows_('Delegasi', dl);
  log_(u, 'ITEM_DELETE', it.item_id, it.judul);
  return bootstrap_(u);
}

function descendants_(items, rootId) {
  const kids = {};
  items.forEach(function (i) { (kids[i.parent_id] = kids[i.parent_id] || []).push(i.item_id); });
  const out = {};
  (function walk(id) { out[id] = true; (kids[id] || []).forEach(walk); })(rootId);
  return out;
}

/* =========================================================
 * Delegasi
 * ========================================================= */
function delegate_(u, p) {
  const items = readAll_('Items');
  const it = findItem_(items, p.item_id);
  assertAccess_(u, it, items);
  const to = readAll_('Users').find(function (x) { return x.user_id === p.ke_user && isTrue_(x.aktif); });
  if (!to) throw new Error('Pengguna tujuan tidak ditemukan.');
  if (to.user_id === u.user_id) throw new Error('Tidak bisa mendelegasikan ke diri sendiri.');
  const now = now_();
  readAll_('Delegasi')
    .filter(function (d) { return d.item_id === it.item_id && (d.status === 'pending' || d.status === 'diterima'); })
    .forEach(function (d) { update_('Delegasi', d._row, { status: 'dialihkan', responded_at: now }); });
  update_('Items', it._row, { assignee_id: to.user_id, updated_at: now });
  insert_('Delegasi', {
    delegasi_id: uid_('DL'), item_id: it.item_id, dari_user: u.user_id, ke_user: to.user_id,
    catatan: String(p.catatan || '').slice(0, 500), status: 'pending', created_at: now, responded_at: ''
  });
  log_(u, 'DELEGATE', it.item_id, it.judul + ' ke ' + to.nama);
  return bootstrap_(u);
}

function undelegate_(u, p) {
  const items = readAll_('Items');
  const it = findItem_(items, p.item_id);
  const active = readAll_('Delegasi').filter(function (d) {
    return d.item_id === it.item_id && (d.status === 'pending' || d.status === 'diterima');
  });
  const allowed = isSA_(u) || it.owner_id === u.user_id || active.some(function (d) { return d.dari_user === u.user_id; });
  if (!allowed) throw new Error('Kamu tidak bisa menarik delegasi ini.');
  const now = now_();
  active.forEach(function (d) { update_('Delegasi', d._row, { status: 'ditarik', responded_at: now }); });
  update_('Items', it._row, { assignee_id: '', updated_at: now });
  log_(u, 'DELEGASI_TARIK', it.item_id, it.judul);
  return bootstrap_(u);
}

function respondDelegasi_(u, p) {
  const dl = readAll_('Delegasi').find(function (d) { return d.delegasi_id === p.delegasi_id; });
  if (!dl) throw new Error('Delegasi tidak ditemukan.');
  if (dl.ke_user !== u.user_id) throw new Error('Delegasi ini bukan untukmu.');
  if (dl.status !== 'pending') throw new Error('Delegasi sudah direspons.');
  const now = now_();
  update_('Delegasi', dl._row, { status: p.terima ? 'diterima' : 'ditolak', responded_at: now });
  const it = readAll_('Items').find(function (i) { return i.item_id === dl.item_id; });
  if (!p.terima && it && it.assignee_id === u.user_id) update_('Items', it._row, { assignee_id: '', updated_at: now });
  log_(u, p.terima ? 'DELEGASI_TERIMA' : 'DELEGASI_TOLAK', dl.item_id, it ? it.judul : '');
  return bootstrap_(u);
}

/* =========================================================
 * Kategori (sub kategori per Daily Work / Daily Home)
 * ========================================================= */
function saveKategori_(u, p) {
  const nama = String(p.nama || '').trim().slice(0, 40);
  if (!nama) throw new Error('Nama kategori wajib diisi.');
  const warna = /^#[0-9A-Fa-f]{6}$/.test(String(p.warna || '')) ? p.warna : '';
  if (p.kategori_id) {
    const k = readAll_('Kategori').find(function (x) { return x.kategori_id === p.kategori_id; });
    if (!k) throw new Error('Kategori tidak ditemukan.');
    if (!(isSA_(u) || k.owner_id === u.user_id)) throw new Error('Akses ditolak.');
    update_('Kategori', k._row, { nama: nama, warna: warna || k.warna });
  } else {
    if (DOMAINS.indexOf(p.domain) < 0) throw new Error('Area tidak valid.');
    const mine = readAll_('Kategori').filter(function (k) { return k.owner_id === u.user_id && k.domain === p.domain; });
    insert_('Kategori', {
      kategori_id: uid_('KT'), domain: p.domain, nama: nama, warna: warna || '#2E5BFF',
      owner_id: u.user_id, urutan: mine.length + 1, created_at: now_()
    });
  }
  log_(u, 'KATEGORI_SAVE', '', nama);
  return bootstrap_(u);
}

function deleteKategori_(u, p) {
  const k = readAll_('Kategori').find(function (x) { return x.kategori_id === p.kategori_id; });
  if (!k) throw new Error('Kategori tidak ditemukan.');
  if (!(isSA_(u) || k.owner_id === u.user_id)) throw new Error('Akses ditolak.');
  const n = readAll_('Items').filter(function (i) { return i.kategori_id === k.kategori_id; }).length;
  if (n) throw new Error('Kategori masih berisi ' + n + ' item. Hapus item-nya dulu.');
  deleteRows_('Kategori', [k._row]);
  log_(u, 'KATEGORI_DELETE', '', k.nama);
  return bootstrap_(u);
}

/* =========================================================
 * Pengguna & akses menu (super admin)
 * ========================================================= */
function listUsers_(u) {
  requireSA_(u);
  return readAll_('Users').map(safeUser_);
}

function saveUser_(u, p) {
  requireSA_(u);
  const users = readAll_('Users');
  const username = String(p.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('Username 3–30 karakter: huruf kecil, angka, titik, garis bawah, atau strip.');
  const role = p.role === 'superadmin' ? 'superadmin' : 'user';
  const akses = (p.akses || []).filter(function (m) { return MENUS.indexOf(m) >= 0; }).join(',');
  const aktif = p.aktif === false ? 'FALSE' : 'TRUE';
  const dup = users.find(function (x) { return String(x.username).toLowerCase() === username && x.user_id !== p.user_id; });
  if (dup) throw new Error('Username sudah dipakai.');

  if (p.user_id) {
    const t = users.find(function (x) { return x.user_id === p.user_id; });
    if (!t) throw new Error('Pengguna tidak ditemukan.');
    const activeSA = users.filter(function (x) { return x.role === 'superadmin' && isTrue_(x.aktif); });
    if (t.role === 'superadmin' && (role !== 'superadmin' || aktif === 'FALSE') && activeSA.length <= 1) {
      throw new Error('Minimal harus ada satu super admin aktif.');
    }
    const upd = { username: username, nama: String(p.nama || username), email: String(p.email || ''), role: role, akses: akses, aktif: aktif };
    if (p.password) {
      if (String(p.password).length < 6) throw new Error('Password minimal 6 karakter.');
      upd.salt = Utilities.getUuid();
      upd.password_hash = hash_(String(p.password), upd.salt);
    }
    update_('Users', t._row, upd);
  } else {
    if (!p.password || String(p.password).length < 6) throw new Error('Password minimal 6 karakter.');
    createUser_({ username: username, password: String(p.password), nama: String(p.nama || username), email: String(p.email || ''), role: role, akses: akses, aktif: aktif });
  }
  log_(u, 'USER_SAVE', '', username);
  const me = readAll_('Users').find(function (x) { return x.user_id === u.user_id; });
  return { users: listUsers_(me), boot: bootstrap_(me) };
}

function changePassword_(u, p) {
  if (hash_(String(p.lama || ''), u.salt) !== u.password_hash) throw new Error('Password lama tidak cocok.');
  const baru = String(p.baru || '');
  if (baru.length < 6) throw new Error('Password baru minimal 6 karakter.');
  const salt = Utilities.getUuid();
  update_('Users', u._row, { salt: salt, password_hash: hash_(baru, salt) });
  log_(u, 'PASSWORD', '', '');
  return true;
}

function createUser_(o) {
  const salt = Utilities.getUuid();
  const id = uid_('US');
  const now = now_();
  insert_('Users', {
    user_id: id, username: o.username, password_hash: hash_(o.password, salt), salt: salt,
    nama: o.nama || o.username, email: o.email || '', role: o.role || 'user',
    akses: o.akses != null ? o.akses : 'work,home,monitor,kalender', aktif: o.aktif || 'TRUE',
    created_at: now, last_login: ''
  });
  DOMAINS.forEach(function (d) {
    DEFAULT_KATEGORI[d].forEach(function (k, i) {
      insert_('Kategori', { kategori_id: uid_('KT'), domain: d, nama: k[0], warna: k[1], owner_id: id, urutan: i + 1, created_at: now });
    });
  });
  return id;
}

/* =========================================================
 * Log aktivitas
 * ========================================================= */
function logs_(u, p) {
  const uid = p.user_id || '';
  if (!isSA_(u) && uid !== u.user_id) throw new Error('Akses ditolak.');
  const names = {};
  readAll_('Users').forEach(function (x) { names[x.user_id] = x.nama; });
  let rows = readAll_('ActivityLog');
  if (uid) rows = rows.filter(function (r) { return r.user_id === uid; });
  const limit = Math.min(Number(p.limit) || 150, 500);
  return rows.slice(-limit).reverse().map(function (r) {
    return { timestamp: r.timestamp, user_id: r.user_id, nama: names[r.user_id] || r.user_id, aksi: r.aksi, item_id: r.item_id, detail: r.detail };
  });
}

function log_(u, aksi, itemId, detail) {
  insert_('ActivityLog', {
    log_id: uid_('LG'), timestamp: now_(), user_id: u.user_id, aksi: aksi,
    item_id: itemId || '', detail: String(detail || '').slice(0, 300)
  });
}

/* =========================================================
 * Helper akses
 * ========================================================= */
function isSA_(u) { return u.role === 'superadmin'; }
function requireSA_(u) { if (!isSA_(u)) throw new Error('Hanya super admin yang bisa melakukan ini.'); }

function assertAccess_(u, it, items) {
  if (isSA_(u)) return;
  if (!visibleIds_(items, u.user_id)[it.item_id]) throw new Error('Kamu tidak punya akses ke item ini.');
}

function assertKategori_(u, kategoriId, domain) {
  const k = readAll_('Kategori').find(function (x) { return x.kategori_id === kategoriId; });
  if (!k) throw new Error('Kategori tidak ditemukan.');
  if (k.domain !== domain) throw new Error('Kategori tidak sesuai area.');
  if (!(isSA_(u) || k.owner_id === u.user_id)) throw new Error('Kategori ini bukan milikmu.');
}

function findItem_(items, id) {
  const it = items.find(function (x) { return x.item_id === id; });
  if (!it) throw new Error('Item tidak ditemukan, mungkin sudah dihapus.');
  return it;
}

function safeUser_(u) {
  return {
    user_id: u.user_id, username: u.username, nama: u.nama, email: u.email, role: u.role,
    akses: String(u.akses || '').split(',').filter(String), aktif: isTrue_(u.aktif), last_login: u.last_login
  };
}

function settingsMap_() {
  const m = {};
  readAll_('Settings').forEach(function (r) { m[r.key] = r.value; });
  return m;
}

/* =========================================================
 * Helper data spreadsheet
 * ========================================================= */
let _rows = {};

function ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Sheet ' + name + ' belum ada. Jalankan setupDatabase() dari editor Apps Script.');
  return sh;
}

function readAll_(name) {
  if (_rows[name]) return _rows[name];
  const sh = sheet_(name);
  const h = SCHEMA[name];
  const last = sh.getLastRow();
  const vals = last > 1 ? sh.getRange(2, 1, last - 1, h.length).getValues() : [];
  const out = [];
  vals.forEach(function (r, i) {
    if (r[0] === '' || r[0] === null) return;
    const o = { _row: i + 2 };
    h.forEach(function (k, j) { o[k] = r[j] instanceof Date ? r[j].toISOString() : String(r[j]); });
    out.push(o);
  });
  _rows[name] = out;
  return out;
}

function insert_(name, obj) {
  const sh = sheet_(name);
  const h = SCHEMA[name];
  const row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  const rg = sh.getRange(row, 1, 1, h.length);
  rg.setNumberFormat('@');
  rg.setValues([h.map(function (k) { return obj[k] == null ? '' : String(obj[k]); })]);
  delete _rows[name];
}

function update_(name, row, obj) {
  const sh = sheet_(name);
  const h = SCHEMA[name];
  const rg = sh.getRange(row, 1, 1, h.length);
  const cur = rg.getValues()[0];
  const next = h.map(function (k, i) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k] == null ? '' : String(obj[k]);
    return cur[i] instanceof Date ? cur[i].toISOString() : cur[i];
  });
  rg.setNumberFormat('@');
  rg.setValues([next]);
  delete _rows[name];
}

function deleteRows_(name, rows) {
  const sh = sheet_(name);
  const h = SCHEMA[name];
  rows.slice().sort(function (a, b) { return b - a; }).forEach(function (r) {
    if (sh.getMaxRows() > 2) sh.deleteRow(r);
    else sh.getRange(r, 1, 1, h.length).clearContent();
  });
  delete _rows[name];
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* =========================================================
 * Utilitas
 * ========================================================= */
function hash_(pw, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '::' + pw, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function uid_(prefix) { return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
function now_() { return new Date().toISOString(); }
function isTrue_(v) { const s = String(v).toUpperCase(); return v === true || s === 'TRUE' || s === '1'; }
function date_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : ''; }
function clamp_(v, min, max, def) {
  const n = Number(v);
  if (v === '' || v == null || isNaN(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}
function strip_(o) {
  const c = {};
  Object.keys(o).forEach(function (k) { if (k !== '_row' && k !== 'password_hash' && k !== 'salt') c[k] = o[k]; });
  return c;
}

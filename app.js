import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getDatabase, ref, set, onValue, push, remove, update, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ==================== INITIALIZATION & CONFIGURATIONS ====================
const API_BASE_URL = "https://api.genetek.co.id"; 
const firebaseConfig = {
  apiKey: "AIzaSyAQWeEYQNtocfIuKvKk8tbpKuIeW4CmZOI",
  authDomain: "rab-monitoring.firebaseapp.com",
  databaseURL: "https://rab-monitoring-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "rab-monitoring",
  storageBucket: "rab-monitoring.firebasestorage.app",
  messagingSenderId: "712435056277",
  appId: "1:712435056277:web:54db7d9ffd327bc3d9259c"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Global Arrays Data Cache
let projects = [];
let rabItems = [];
let claims = [];
let users = [];
let truenasFiles = [];

// Application State Management
let currentSelectedProjectId = null;
let currentRole = ""; 
let currentUserEmail = "";
let claimItemsListArray = [];
let reportsBarChartInstance = null;

const rolePermissions = {
  "Administrator": ['dashboard', 'project', 'claim', 'approval', 'monitoring', 'report', 'upload', 'files', 'users'],
  "Finance": ['dashboard', 'claim', 'approval', 'report', 'upload', 'files'],
  "Project Manager": ['dashboard', 'project', 'claim', 'monitoring', 'upload', 'files']
};

// ==================== HELPER CORE UTILITIES ====================
function hideLoadingScreen() {
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = 'flex';
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = message;
  toast.style.display = 'block';
  if (type === 'error') {
    toast.style.backgroundColor = '#e74c3c';
  } else if (type === 'warning') {
    toast.style.backgroundColor = '#f1c40f';
  } else {
    toast.style.backgroundColor = '#2ecc71';
  }
  setTimeout(() => { toast.style.display = 'none'; }, 4000);
}

window.openModal = function(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.add('show');
};

window.closeModal = function(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('show');
};

function formatIDR(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(value || 0);
}

function calculateRiskBadge(realisasi, anggaran) {
  if (realisasi > anggaran) return '<span class="badge badge-danger">Over Budget</span>';
  if (anggaran > 0 && (realisasi / anggaran) >= 0.9) return '<span class="badge badge-warning">Near Limit</span>';
  return '<span class="badge badge-success">Aman</span>';
}

// ==================== AUTHENTICATION & ACCESS PROTOCOLS ====================
async function executeCreateUser(email, password, role) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    await set(ref(db, `users/${user.uid}`), {
      email: email,
      role: role,
      createdAt: new Date().toLocaleDateString('id-ID'),
      timestamp: Date.now()
    });
    showToast(`Akun identitas baru atas nama ${email} berhasil terdaftar!`);
    return { success: true };
  } catch (err) {
    let msg = "Gagal membuat user: " + err.message;
    if (err.code === 'auth/email-already-in-use') msg = "Alamat email ini sudah terdaftar di sistem!";
    showToast(msg, 'error');
    return { success: false };
  }
}

async function executeUpdateUserRole(uid, newRole) {
  try {
    await update(ref(db, `users/${uid}`), { role: newRole, lastModified: new Date().toLocaleDateString('id-ID') });
    showToast(`Hak akses berhasil diubah menjadi ${newRole}!`);
    return { success: true };
  } catch (err) {
    showToast("Gagal memutasi hak akses data user.", "error");
    return { success: false };
  }
}

async function executeResetPasswordLink(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    showToast(`Tautan pengaturan ulang sandi dikirim ke alamat ${email}.`, 'warning');
    return { success: true };
  } catch (err) {
    showToast("Gagal mengirim permintaan enkripsi reset kata sandi.", "error");
    return { success: false };
  }
}

async function executeDeleteUserNode(uid, email) {
  try {
    await remove(ref(db, `users/${uid}`));
    showToast(`Profil pengguna berhasil dihapus dari sistem: ${email}`, 'warning');
    return { success: true };
  } catch (err) {
    showToast("Gagal memutuskan sinkronisasi data user.", "error");
    return { success: false };
  }
}

function enforceSidebarPermissions() {
  const allowedSections = rolePermissions[currentRole] || [];
  document.querySelectorAll('#menu li').forEach(li => {
    const sectionKey = li.getAttribute('data-section');
    if (allowedSections.includes(sectionKey)) {
      li.classList.remove('restricted');
    } else {
      li.classList.add('restricted');
    }
  });

  const activeLi = document.querySelector('#menu li.active');
  if (activeLi && activeLi.classList.contains('restricted')) {
    const fallbackDashboardBtn = document.querySelector('#menu li[data-section="dashboard"]');
    if (fallbackDashboardBtn) fallbackDashboardBtn.click();
  }
}

// ==================== CORE FIREBASE DATA SINKRONISASI ====================
function startRealtimeDatabaseListeners() {
  onValue(ref(db, 'projects'), (snapshot) => {
    const data = snapshot.val();
    projects = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
    refreshApplicationGlobalUI();
  });

  onValue(ref(db, 'rabItems'), (snapshot) => {
    const data = snapshot.val();
    rabItems = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
    refreshApplicationGlobalUI();
  });

  onValue(ref(db, 'claims'), (snapshot) => {
    const data = snapshot.val();
    claims = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
    refreshApplicationGlobalUI();
  });

  onValue(ref(db, 'truenasFiles'), (snapshot) => {
    const data = snapshot.val();
    truenasFiles = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
    renderTrueNASTreeView();
  });

  onValue(ref(db, 'users'), (snapshot) => {
    const data = snapshot.val();
    users = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
    renderUsersManagementTable();
  });
}

function refreshApplicationGlobalUI() {
  renderDashboardDataPanel();
  renderMasterProjectSection();
  renderApprovalQueuePanel();
  renderClaimHistoryLogPanel();
  renderGlobalMonitoringReportTable();
  rebuildAnalyticalCharts();
  populateComponentDropdownSelections();
}

function populateComponentDropdownSelections() {
  const upSel = document.getElementById('uploadProject');
  if (upSel) {
    const activeVal = upSel.value;
    upSel.innerHTML = '<option value="">-- Pilih Project Target --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (activeVal) upSel.value = activeVal;
  }

  const claimSel = document.getElementById('claimProject');
  if (claimSel) {
    const activeClaimVal = claimSel.value;
    claimSel.innerHTML = '<option value="">-- Pilih Project Pengajuan --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (activeClaimVal) claimSel.value = activeClaimVal;
  }
}

// ==================== RENDERING COMPONENT ENGINE MANAGEMENT ====================

// 1. DASHBOARD COMPONENT
function renderDashboardDataPanel() {
  const globalTotalBudget = projects.reduce((sum, p) => sum + (parseFloat(p.totalBudget) || 0), 0);
  const globalTotalRealisasi = rabItems.reduce((sum, i) => sum + (parseFloat(i.realisasi) || 0), 0);
  const overBudgetCount = rabItems.filter(i => parseFloat(i.realisasi) > parseFloat(i.budget)).length;

  const container = document.getElementById('dashboardCards');
  if (container) {
    container.innerHTML = `
      <div class="card"><h3>Project Aktif</h3><p>${projects.length}</p></div>
      <div class="card"><h3>Total Pagu Global</h3><p>${formatIDR(globalTotalBudget)}</p></div>
      <div class="card"><h3>Total Penyerapan Dana</h3><p>${formatIDR(globalTotalRealisasi)}</p></div>
      <div class="card"><h3>Item Over Budget</h3><p style="color:#e74c3c">${overBudgetCount} Komponen</p></div>
    `;
  }

  const tbody = document.getElementById('dashboardTableBody');
  if (tbody) {
    const sortedRAB = [...rabItems].sort((a, b) => b.budget - a.budget).slice(0, 5);
    tbody.innerHTML = sortedRAB.map(i => {
      const p = projects.find(proj => proj.id === i.projectId);
      return `<tr>
        <td><strong>${p ? p.name : 'Unassigned Proyek'}</strong></td>
        <td>${i.itemName}</td>
        <td>${formatIDR(i.budget)}</td>
        <td>${formatIDR(i.realisasi)}</td>
        <td>${calculateRiskBadge(i.realisasi, i.budget)}</td>
      </tr>`;
    }).join('');
  }
}

// 2. DATA MASTER PROJECT & SUB-ITEMS RAB
function renderMasterProjectSection() {
  const tbody = document.getElementById('projectTableBody');
  if (tbody) {
    tbody.innerHTML = projects.map(p => {
      const allocatedBudgetSum = rabItems.filter(i => i.projectId === p.id).reduce((sum, i) => sum + (parseFloat(i.budget) || 0), 0);
      const openPaguRemains = p.totalBudget - allocatedBudgetSum;

      return `<tr>
        <td><strong>${p.name}</strong></td>
        <td>${p.client}</td>
        <td>${formatIDR(p.totalBudget)}</td>
        <td style="font-weight:bold; color:${openPaguRemains < 0 ? '#e74c3c':'#2ecc71'}">${formatIDR(openPaguRemains)}</td>
        <td><button class="btn btn-danger btn-delete-project-act" style="padding:4px 8px; font-size:12px;" data-id="${p.id}"><i class="fas fa-trash"></i> Hapus</button></td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-delete-project-act').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (confirm('Hapus master data proyek ini beserta seluruh komponen struktural sub-RAB di dalamnya?')) {
          remove(ref(db, `projects/${id}`));
          rabItems.filter(i => i.projectId === id).forEach(i => remove(ref(db, `rabItems/${i.id}`)));
        }
      });
    });
  }

  const filter = document.getElementById('selectFilterProject');
  if (filter) {
    const oldFilterVal = currentSelectedProjectId;
    filter.innerHTML = '<option value="">-- Saring Berdasarkan Project --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (oldFilterVal) filter.value = oldFilterVal;
  }
  renderSubItemsRABTable();
}

function renderSubItemsRABTable() {
  const tbody = document.getElementById('rabTableBody');
  if (!tbody) return;

  if (!currentSelectedProjectId) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#7f8c8d;">Pilih proyek di atas untuk menampilkan rincian data komponen RAB.</td></tr>';
    return;
  }

  const filteredItems = rabItems.filter(i => i.projectId === currentSelectedProjectId);
  if (filteredItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#7f8c8d;">Belum ada komponen anggaran terdaftar di proyek ini.</td></tr>';
    return;
  }

  tbody.innerHTML = filteredItems.map(i => `
    <tr>
      <td>${i.itemName}</td>
      <td>${formatIDR(i.budget)}</td>
      <td>${formatIDR(i.realisasi)}</td>
      <td style="font-weight:bold;">${formatIDR(i.budget - i.realisasi)}</td>
      <td><button class="btn btn-danger btn-delete-sub-rab-act" style="padding:4px 8px; font-size:12px;" data-id="${i.id}"><i class="fas fa-minus-circle"></i></button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-delete-sub-rab-act').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (confirm('Hapus komponen alokasi sub-item anggaran RAB ini?')) {
        remove(ref(db, `rabItems/${id}`));
      }
    });
  });
}

// 3. CLAIM REQUEST MANAGEMENT (MANIFREST ARRAY)
function renderDynamicClaimFormRows() {
  const container = document.getElementById('claimItemsContainer');
  if (!container) return;

  const targetProjectId = document.getElementById('claimProject').value;
  const matchRABSubItems = rabItems.filter(i => i.projectId === targetProjectId);

  if (claimItemsListArray.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:#95a5a6; padding:10px;">Belum ada baris biaya. Tekan tombol Tambah Item.</div>';
    return;
  }

  container.innerHTML = claimItemsListArray.map((item, idx) => `
    <div class="item-row">
      <select data-index="${idx}" class="claim-node-select-input">
        <option value="">-- Pilih Komponen Alokasi Anggaran --</option>
        ${matchRABSubItems.map(av => `<option value="${av.id}" ${item.itemId === av.id ? 'selected':''}>${av.itemName} (Sisa Dana: ${formatIDR(av.budget - av.realisasi)})</option>`).join('')}
      </select>
      <input type="number" data-index="${idx}" class="claim-node-nominal-input" placeholder="Nominal Biaya (IDR)" value="${item.nominal || ''}" />
      <button type="button" class="btn-remove-item" data-index="${idx}"><i class="fas fa-times"></i></button>
    </div>
  `).join('');

  // Bind Listeners to DOM Elements Synchronously
  container.querySelectorAll('.claim-node-select-input').forEach(sel => {
    sel.addEventListener('change', (e) => { claimItemsListArray[parseInt(sel.dataset.index)].itemId = e.target.value; });
  });
  container.querySelectorAll('.claim-node-nominal-input').forEach(inp => {
    inp.addEventListener('change', (e) => { claimItemsListArray[parseInt(inp.dataset.index)].nominal = parseFloat(e.target.value) || 0; });
  });
  container.querySelectorAll('.btn-remove-item').forEach(btn => {
    btn.addEventListener('click', () => { claimItemsListArray.splice(parseInt(btn.dataset.index), 1); renderDynamicClaimFormRows(); });
  });
}

function renderClaimHistoryLogPanel() {
  const tbody = document.getElementById('claimHistoryTableBody');
  if (tbody) {
    if (claims.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#95a5a6;">Belum ditemukan riwayat mutasi klaim keuangan.</td></tr>';
      return;
    }
    tbody.innerHTML = claims.map(c => {
      const p = projects.find(pr => pr.id === c.projectId);
      const itemSummaries = c.items ? c.items.map(ci => {
        const subRAB = rabItems.find(r => r.id === ci.itemId);
        return `• ${subRAB ? subRAB.itemName : 'Item'}: <span style="font-weight:600;">${formatIDR(ci.nominal)}</span>`;
      }).join('<br>') : '-';

      let statusBadgeClass = c.status === 'approved' ? 'badge-success' : (c.status === 'rejected' ? 'badge-danger' : 'badge-warning');
      return `<tr>
        <td><strong>${p ? p.name : 'Unknown Cloud Context'}</strong></td>
        <td style="line-height:1.4;">${itemSummaries}</td>
        <td style="font-weight:bold; color:#2c3e50;">${formatIDR(c.totalNominal)}</td>
        <td>${c.vendor}</td>
        <td><span class="badge ${statusBadgeClass}">${c.status}</span></td>
        <td><small>${c.tanggal}</small></td>
      </tr>`;
    }).join('');
  }
}

// 4. APPROVAL PIPELINE CONTROLLER
function renderApprovalQueuePanel() {
  const tbody = document.getElementById('approvalTableBody');
  if (!tbody) return;

  const pendingClaims = claims.filter(c => c.status === 'pending');
  if (pendingClaims.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#95a5a6; padding:20px;">Antrean bersih. Seluruh pengajuan klaim operasional telah diproses.</td></tr>';
    return;
  }

  tbody.innerHTML = pendingClaims.map(c => {
    const p = projects.find(pr => pr.id === c.projectId);
    const rincianStr = c.items ? c.items.map(ci => {
      const sub = rabItems.find(r => r.id === ci.itemId);
      return `${sub ? sub.itemName : 'Komponen'}: ${formatIDR(ci.nominal)}`;
    }).join(', ') : '-';

    return `<tr>
      <td><strong>${p ? p.name : 'Proyek Tidak Terpeta'}</strong><br><small style="color:#7f8c8d;">Tanggal: ${c.tanggal} | Memo: ${c.desc || '-'}</small></td>
      <td><span style="font-size:13px; color:#34495e;">${rincianStr}</span></td>
      <td style="font-weight:bold; color:#2c3e50;">${formatIDR(c.totalNominal)}</td>
      <td>${c.vendor}</td>
      <td>
        <button class="btn btn-success btn-approve-act" style="padding:5px 10px; font-size:12px; margin-right:4px;" data-id="${c.id}"><i class="fas fa-check"></i> Setujui</button>
        <button class="btn btn-danger btn-reject-act" style="padding:5px 10px; font-size:12px;" data-id="${c.id}"><i class="fas fa-ban"></i> Tolak</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.btn-approve-act').forEach(b => b.addEventListener('click', () => processDecisionAction(b.dataset.id, 'approved')));
  tbody.querySelectorAll('.btn-reject-act').forEach(b => b.addEventListener('click', () => processDecisionAction(b.dataset.id, 'rejected')));
}

async function processDecisionAction(claimId, decisionStatus) {
  try {
    const targetClaimObj = claims.find(c => c.id === claimId);
    if (!targetClaimObj) return;

    if (decisionStatus === 'approved') {
      for (const singleItem of targetClaimObj.items || []) {
        const rabItemReferenceRef = ref(db, `rabItems/${singleItem.itemId}`);
        const currentDataSnapshot = await get(rabItemReferenceRef);
        if (currentDataSnapshot.exists()) {
          const pastRealisationValue = parseFloat(currentDataSnapshot.val().realisasi) || 0;
          await update(rabItemReferenceRef, { realisasi: pastRealisationValue + parseFloat(singleItem.nominal) });
        }
      }
    }
    await update(ref(db, `claims/${claimId}`), { status: decisionStatus });
    showToast(`Status pengajuan klaim berhasil diperbarui menjadi: ${decisionStatus}`);
  } catch (err) {
    console.error(err);
    showToast("Gagal menyimpan keputusan approval ke cloud database.", "error");
  }
}

// 5. MONITORING VIEW
function renderGlobalMonitoringReportTable() {
  const tbody = document.getElementById('monitoringTableBody');
  if (!tbody) return;

  if (rabItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Tidak ada data monitoring untuk dimuat.</td></tr>';
    return;
  }

  tbody.innerHTML = rabItems.map(i => {
    const p = projects.find(pr => pr.id === i.projectId);
    const sisaSaku = i.budget - i.realisasi;
    return `<tr>
      <td><strong>${p ? p.name : 'Orphan Node Project'}</strong></td>
      <td>${i.itemName}</td>
      <td>${formatIDR(i.budget)}</td>
      <td style="color:#2980b9; font-weight:600;">${formatIDR(i.realisasi)}</td>
      <td style="font-weight:bold; color:${sisaSaku < 0 ? '#e74c3c':'#2ecc71'}">${formatIDR(sisaSaku)}</td>
      <td>${calculateRiskBadge(i.realisasi, i.budget)}</td>
    </tr>`;
  }).join('');
}

// 6. MANAGEMENT IDENTITY USERS LIST
function renderUsersManagementTable() {
  const tbody = document.getElementById('userTableBody');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#95a5a6;">Belum mendeteksi akun IAM terdaftar.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => {
    let internalRoleBadge = u.role === 'Administrator' ? 'badge-danger' : (u.role === 'Finance' ? 'badge-warning' : 'badge-success');
    const isSelfCurrentAccountNode = (currentUserEmail === u.email);

    return `<tr>
      <td><strong>${u.email}</strong> ${isSelfCurrentAccountNode ? '<span class="badge badge-info">Sesi Aktif</span>' : ''}</td>
      <td><span class="badge ${internalRoleBadge}">${u.role}</span></td>
      <td style="font-size:12px; font-family:monospace; color:#7f8c8d;">${u.id || '-'}</td>
      <td>${u.createdAt || '-'}</td>
      <td>
        ${currentRole === 'Administrator' ? `
          ${!isSelfCurrentAccountNode ? `
            <button class="btn btn-warning btn-edit-user-node" style="padding:4px 8px; font-size:11px;" data-uid="${u.id}" data-email="${u.email}" data-role="${u.role}"><i class="fas fa-edit"></i> Role</button>
            <button class="btn btn-primary btn-reset-pass-node" style="padding:4px 8px; font-size:11px; background:#7f8c8d;" data-uid="${u.id}" data-email="${u.email}"><i class="fas fa-key"></i> Sandi</button>
            <button class="btn btn-danger btn-delete-user-node" style="padding:4px 8px; font-size:11px;" data-uid="${u.id}" data-email="${u.email}"><i class="fas fa-trash"></i> Drop</button>
          ` : `<span class="badge badge-info" style="background:#bdc3c7; color:#2c3e50;"><i class="fas fa-shield-alt"></i> Profil Anda</span>`}
        ` : `<span class="badge badge-info" style="background:#bdc3c7; color:#2c3e50;">Terkunci</span>`}
      </td>
    </tr>`;
  }).join('');

  if (currentRole === 'Administrator') {
    tbody.querySelectorAll('.btn-edit-user-node').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('userModalTitle').innerHTML = '<i class="fas fa-user-edit"></i> Ubah Role Akses User';
        document.getElementById('userFormEmail').value = btn.dataset.email;
        document.getElementById('userFormEmail').disabled = true;
        if (document.getElementById('userPasswordGroup')) document.getElementById('userPasswordGroup').style.display = 'none';
        document.getElementById('userFormRole').value = btn.dataset.role;
        document.getElementById('userFormEditUid').value = btn.dataset.uid;

        document.getElementById('btnSaveUser').onclick = async () => {
          if (document.getElementById('userFormRole').value !== btn.dataset.role) {
            await executeUpdateUserRole(btn.dataset.uid, document.getElementById('userFormRole').value);
          }
          closeModal('modalUser');
          resetUserFormModalState();
        };
        openModal('modalUser');
      });
    });

    tbody.querySelectorAll('.btn-reset-pass-node').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('resetPasswordEmailTarget').value = btn.dataset.email;
        document.getElementById('btnConfirmResetPassword').onclick = async () => {
          await executeResetPasswordLink(btn.dataset.email);
          closeModal('modalResetPassword');
        };
        openModal('modalResetPassword');
      });
    });

    tbody.querySelectorAll('.btn-delete-user-node').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm(`Apakah Anda yakin ingin menghapus penuh seluruh otorisasi akun milik ${btn.dataset.email}?`)) {
          await executeDeleteUserNode(btn.dataset.uid, btn.dataset.email);
        }
      });
    });
  }
}

function resetUserFormModalState() {
  document.getElementById('userFormEmail').disabled = false;
  document.getElementById('userFormEmail').value = '';
  document.getElementById('userFormPassword').value = '';
  if (document.getElementById('userPasswordGroup')) document.getElementById('userPasswordGroup').style.display = 'block';
  document.getElementById('userModalTitle').innerHTML = '<i class="fas fa-user-plus"></i> Daftarkan Identitas Pengguna';
  document.getElementById('btnSaveUser').onclick = executeSaveNewUserForm;
}

async function executeSaveNewUserForm() {
  const email = document.getElementById('userFormEmail').value.trim().toLowerCase();
  let pass = document.getElementById('userFormPassword').value;
  const role = document.getElementById('userFormRole').value;

  if (!email) { showToast('Variabel form salah: Kolom email wajib diisi!', 'error'); return; }
  pass = pass || 'password123';
  if (pass.length < 6) { showToast('Kata sandi keamanan minimal berjumlah 6 karakter!', 'error'); return; }

  const res = await executeCreateUser(email, pass, role);
  if (res && res.success) {
    closeModal('modalUser');
    document.getElementById('userFormEmail').value = '';
    document.getElementById('userFormPassword').value = '';
  }
}

// ==================== CHART VISUALIZATION PIPELINE ====================
function rebuildAnalyticalCharts() {
  const canvasElement = document.getElementById('analyticsChart');
  if (!canvasElement) return;

  const datasetLabels = projects.map(p => p.name);
  const graphAllocatedBudgets = projects.map(p => p.totalBudget);
  const graphConsumedBudgets = projects.map(p => {
    return rabItems.filter(i => i.projectId === p.id).reduce((sum, i) => sum + (parseFloat(i.realisasi) || 0), 0);
  });

  if (reportsBarChartInstance) { reportsBarChartInstance.destroy(); }

  reportsBarChartInstance = new Chart(canvasElement, {
    type: 'bar',
    data: {
      labels: datasetLabels,
      datasets: [
        { label: 'Pagu Anggaran Utama Proyek (IDR)', data: graphAllocatedBudgets, backgroundColor: 'rgba(52, 152, 219, 0.8)', borderColor: '#3498db', borderWidth: 1 },
        { label: 'Realisasi Penyerapan Dana Biaya (IDR)', data: graphConsumedBudgets, backgroundColor: 'rgba(155, 89, 182, 0.8)', borderColor: '#9b59b4', borderWidth: 1 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true } }
    }
  });
}

// ==================== TRUENAS DISK BINARY STORAGE MANAGEMENT ====================
async function uploadFileStreamToTrueNAS(fileObject, projectId, targetFolder) {
  const matchProj = projects.find(p => p.id === projectId);
  const clearedProjectName = matchProj ? matchProj.name.replace(/[^a-zA-Z0-9]/g, "_") : "General_Project";

  const dataForm = new FormData();
  dataForm.append("file", fileObject);
  dataForm.append("project", clearedProjectName);
  dataForm.append("folder", targetFolder);

  try {
    const netResponse = await fetch(`${API_BASE_URL}/upload.php`, { method: "POST", body: dataForm });
    if (!netResponse.ok) throw new Error("Server API kluster TrueNAS menolak atau memutus sambungan.");

    const json = await netResponse.json();
    if (json.status === "success" || json.url) {
      const generatedFileReferenceKeyRef = push(ref(db, 'truenasFiles'));
      await set(generatedFileReferenceKeyRef, {
        projectId: projectId,
        folder: targetFolder,
        fileName: fileObject.name,
        networkFileUrl: json.url || json.file_path,
        uploadedAt: new Date().toLocaleString()
      });
      showToast("File lampiran berhasil disimpan dan disinkronisasikan ke kluster TrueNAS.");
      document.getElementById('fileDocument').value = '';
    } else {
      throw new Error(json.message || "Gagal melakukan verifikasi penyimpanan berkas.");
    }
  } catch (err) {
    console.error(err);
    showToast("Kesalahan I/O Gateway TrueNAS: " + err.message, "error");
  }
}

function renderTrueNASTreeView() {
  const treeContainer = document.getElementById('fileTreeContainer');
  if (!treeContainer) return;

  if (truenasFiles.length === 0) {
    treeContainer.innerHTML = '<li class="folder"><i class="fas fa-database"></i> Pool Vault TrueNAS: Kosong</li>';
    return;
  }

  let finalTreeHtml = `<li class="folder" style="border-bottom: 1px dashed #bdc3c7; padding-bottom:5px; margin-bottom:10px;"><i class="fas fa-database"></i> /mnt/vault/projects_rab</li>`;
  const directoryStructuredObj = {};

  truenasFiles.forEach(f => {
    const p = projects.find(proj => proj.id === f.projectId);
    const projectNameKey = p ? p.name : "Unlinked Repository Archive";
    if (!directoryStructuredObj[projectNameKey]) directoryStructuredObj[projectNameKey] = {};
    if (!directoryStructuredObj[projectNameKey][f.folder]) directoryStructuredObj[projectNameKey][f.folder] = [];
    directoryStructuredObj[projectNameKey][f.folder].push(f);
  });

  for (const projKey in directoryStructuredObj) {
    finalTreeHtml += `<li style="padding-left:10px;"><div class="folder"><i class="fas fa-folder-open" style="color:#f1c40f;"></i> ${projKey}</div><ul style="list-style-type:none; padding-left:15px;">`;
    for (const folderKey in directoryStructuredObj[projKey]) {
      finalTreeHtml += `<li><div class="folder" style="color:#7f8c8d;"><i class="fas fa-folder" style="color:#f39c12;"></i> Kategori: ${folderKey}</div><ul style="list-style-type:none; padding-left:15px;">`;
      directoryStructuredObj[projKey][folderKey].forEach(file => {
        finalTreeHtml += `<li class="file-item">
          <div><i class="fas fa-file-alt" style="color:#3498db; margin-right:5px;"></i><span>${file.fileName}</span></div>
          <div class="file-actions">
            <a href="${file.networkFileUrl}" target="_blank" style="color:#2ecc71; text-decoration:none; font-weight:bold; font-size:13px;"><i class="fas fa-external-link-alt"></i> Buka File</a>
            ${currentRole === 'Administrator' ? `<button class="btn-delete-file" data-id="${file.id}"><i class="fas fa-trash-alt"></i></button>` : ''}
          </div>
        </li>`;
      });
      finalTreeHtml += `</ul></li>`;
    }
    finalTreeHtml += `</ul></li>`;
  }

  treeContainer.innerHTML = finalTreeHtml;

  treeContainer.querySelectorAll('.btn-delete-file').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm("Hapus tautan metadata berkas ini? File fisik asli pada sistem komparasi TrueNAS tidak akan hilang demi alasan riwayat audit.")) {
        remove(ref(db, `truenasFiles/${btn.dataset.id}`));
      }
    });
  });
}

// ==================== WORKBOOK REPORT EXPORTS HANDLING ====================
document.getElementById('btnExportExcel')?.addEventListener('click', () => {
  const matrixDataRows = [["Nama Proyek", "Komponen Sub-Item Anggaran", "Pagu Batas Dana (IDR)", "Total Realisasi Terpakai (IDR)", "Sisa Likuiditas Bersih (IDR)"]];
  rabItems.forEach(i => {
    const p = projects.find(pr => pr.id === i.projectId);
    matrixDataRows.push([p ? p.name : 'Orphan', i.itemName, i.budget, i.realisasi, (i.budget - i.realisasi)]);
  });
  const ws = XLSX.utils.aoa_to_sheet(matrixDataRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Laporan Pemantauan Anggaran");
  XLSX.writeFile(wb, "RAB_Financial_Monitoring_Report.xlsx");
});

document.getElementById('btnExportPdf')?.addEventListener('click', () => {
  const element = document.getElementById('pdfExportArea');
  if (!element) return;
  const config = { margin: 10, filename: 'Laporan_Eksekutif_Monitoring_RAB.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' } };
  html2pdf().set(config).from(element).save();
});

// ==================== EVENT LISTENERS HOOK WIRE-UP ====================
document.getElementById('selectFilterProject')?.addEventListener('change', (e) => {
  currentSelectedProjectId = e.target.value;
  renderSubItemsRABTable();
});

document.getElementById('btnSaveProject')?.addEventListener('click', () => {
  const name = document.getElementById('projectFormName').value.trim();
  const client = document.getElementById('projectFormClient').value.trim();
  const totalBudget = parseFloat(document.getElementById('projectFormBudget').value) || 0;

  if (!name || !client || totalBudget <= 0) { showToast('Kriteria validasi gagal: Mohon lengkapi seluruh variabel form proyek!', 'error'); return; }

  push(ref(db, 'projects'), { name, client, totalBudget }).then(() => {
    closeModal('modalProject');
    document.getElementById('projectFormName').value = '';
    document.getElementById('projectFormClient').value = '';
    document.getElementById('projectFormBudget').value = '';
    showToast('Master record data proyek baru berhasil diarsipkan.');
  });
});

document.getElementById('btnOpenModalRAB')?.addEventListener('click', () => {
  if (!currentSelectedProjectId) { showToast('Operasi ditolak: Anda wajib memilih filter proyek utama!', 'warning'); return; }
  const match = projects.find(p => p.id === currentSelectedProjectId);
  document.getElementById('rabFormProjectTargetName').value = match ? match.name : '';
  document.getElementById('rabFormItemName').value = '';
  document.getElementById('rabFormBudget').value = '';
  openModal('modalRAB');
});

document.getElementById('btnSaveRAB')?.addEventListener('click', () => {
  const itemName = document.getElementById('rabFormItemName').value.trim();
  const budget = parseFloat(document.getElementById('rabFormBudget').value) || 0;

  if (!itemName || budget <= 0) { showToast('Validasi Gagal: Parameter sub-item salah!', 'error'); return; }

  push(ref(db, 'rabItems'), { projectId: currentSelectedProjectId, itemName, budget, realisasi: 0 }).then(() => {
    closeModal('modalRAB');
    showToast('Komponen sub-item anggaran sukses terikat pada proyek.');
  });
});

document.getElementById('claimProject')?.addEventListener('change', () => {
  claimItemsListArray = [];
  renderDynamicClaimFormRows();
});

document.getElementById('btnAddClaimItem')?.addEventListener('click', () => {
  if (!document.getElementById('claimProject').value) { showToast('Anda harus memilih proyek tujuan terlebih dahulu!', 'warning'); return; }
  claimItemsListArray.push({ itemId: '', nominal: 0 });
  renderDynamicClaimFormRows();
});

document.getElementById('btnSubmitClaim')?.addEventListener('click', () => {
  const projectId = document.getElementById('claimProject').value;
  const vendor = document.getElementById('claimVendor').value.trim();
  const tanggal = document.getElementById('claimDate').value;
  const desc = document.getElementById('claimDesc').value;
  const validArrayItems = claimItemsListArray.filter(it => it.itemId && it.nominal > 0);

  if (!projectId || validArrayItems.length === 0 || !vendor || !tanggal) { showToast('Data formulir klaim biaya tidak lengkap!', 'error'); return; }

  const totalNominal = validArrayItems.reduce((sum, i) => sum + i.nominal, 0);
  push(ref(db, 'claims'), { projectId, vendor, tanggal, desc, status: 'pending', totalNominal, items: validArrayItems }).then(() => {
    claimItemsListArray = [];
    document.getElementById('claimVendor').value = '';
    document.getElementById('claimDesc').value = '';
    document.getElementById('claimDate').value = '';
    renderDynamicClaimFormRows();
    showToast('Pengajuan klaim berhasil diteruskan ke dalam pipa verifikasi persetujuan.');
  });
});

document.getElementById('btnExecuteUpload')?.addEventListener('click', () => {
  const pId = document.getElementById('uploadProject').value;
  const folder = document.getElementById('uploadFolder').value;
  const fileInput = document.getElementById('fileDocument');

  if (!pId || !fileInput.files || fileInput.files.length === 0) {
    showToast("Berkas muatan atau parameter id proyek kosong.", "error");
    return;
  }
  uploadFileStreamToTrueNAS(fileInput.files[0], pId, folder);
});

document.getElementById('btnOpenModalUser')?.addEventListener('click', () => {
  resetUserFormModalState();
  openModal('modalUser');
});
document.getElementById('btnCancelUserModal')?.addEventListener('click', () => closeModal('modalUser'));
document.getElementById('btnCancelResetModal')?.addEventListener('click', () => closeModal('modalResetPassword'));
document.getElementById('btnRefresh')?.addEventListener('click', () => refreshApplicationGlobalUI());
document.getElementById('btnLogout')?.addEventListener('click', () => { signOut(auth).then(() => window.location.reload()); });

// ==================== ROUTING INTERACTION TABS MANAGER ====================
const systemTabRoutingSectionsMaps = {
  dashboard: 'section-dashboard',
  project: 'section-project',
  claim: 'section-claim',
  approval: 'section-approval',
  monitoring: 'section-monitoring',
  report: 'section-report',
  upload: 'section-upload',
  files: 'section-files',
  users: 'section-users'
};

document.querySelectorAll('#menu li').forEach(li => {
  li.addEventListener('click', () => {
    if (li.classList.contains('restricted')) return;

    document.querySelectorAll('#menu li').forEach(l => l.classList.remove('active'));
    li.classList.add('active');

    const targetKey = li.getAttribute('data-section');
    Object.values(systemTabRoutingSectionsMaps).forEach(domId => {
      const el = document.getElementById(domId);
      if (el) el.classList.add('hidden');
    });

    if (systemTabRoutingSectionsMaps[targetKey]) {
      const currentActiveLayout = document.getElementById(systemTabRoutingSectionsMaps[targetKey]);
      if (currentActiveLayout) currentActiveLayout.classList.remove('hidden');
    }

    const titleHeaderNode = document.getElementById('sectionTitle');
    if (titleHeaderNode) {
      const innerIconNode = li.querySelector('i');
      titleHeaderNode.innerHTML = `<i class="${innerIconNode ? innerIconNode.className : 'fas fa-tachometer-alt'}"></i> ${li.innerText.trim()}`;
    }
  });
});

// ==================== SECURITY ARCHITECTURE ACCESS ATTACH ROOT HOOK ====================
function verifyRootAdministratorRecordExistence(user) {
  const masterSystemAdminEmail = "admin@genetek.co.id";
  if (user.email === masterSystemAdminEmail) {
    const userDbPathRef = ref(db, `users/${user.uid}`);
    get(userDbPathRef).then((snap) => {
      if (!snap.exists()) {
        set(userDbPathRef, { email: user.email, role: "Administrator", createdAt: new Date().toLocaleDateString('id-ID'), rootMaster: true });
      }
    });
  }
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUserEmail = user.email;
    verifyRootAdministratorRecordExistence(user);

    get(ref(db, `users/${user.uid}`)).then((snapshot) => {
      if (snapshot.exists()) {
        currentRole = snapshot.val().role || "Project Manager";
      } else {
        currentRole = "Project Manager";
      }

      const emailNode = document.getElementById('userEmail');
      const roleNode = document.getElementById('userRole');
      if (emailNode) emailNode.innerText = currentUserEmail;
      if (roleNode) {
        roleNode.innerText = currentRole;
        roleNode.className = "badge " + (currentRole === 'Administrator' ? 'badge-danger' : (currentRole === 'Finance' ? 'badge-warning' : 'badge-success'));
      }

      enforceSidebarPermissions();
      startRealtimeDatabaseListeners();
      hideLoadingScreen();
    }).catch((err) => {
      console.error("Critical authentication handshake loop failed:", err);
      hideLoadingScreen();
    });
  } else {
    window.location.href = "login.html";
  }
});

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getDatabase, ref, set, onValue, push, remove, update, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ==================== CONFIGURATIONS ====================
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

// Initialize Firebase - ONLY ONCE
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Global Application States
let projects = [];
let rabItems = [];
let claims = [];
let users = [];
let truenasFiles = [];
let currentUserData = null;

let currentSelectedProjectId = null;
let currentRole = ""; 
let currentUserEmail = "";
let currentUserUid = "";

const rolePermissions = {
  "Administrator": ['dashboard', 'master-project', 'claim-request', 'approval-budget', 'monitoring', 'reports', 'upload-document', 'files', 'user-management'],
  "Finance": ['dashboard', 'approval-budget', 'claim-request', 'reports', 'upload-document', 'files'],
  "Project Manager": ['dashboard', 'master-project', 'claim-request', 'monitoring', 'upload-document', 'files']
};

// ==================== HELPER FUNCTIONS ====================
function hideLoadingScreen() {
  const loadingScreen = document.getElementById('loadingScreen');
  const mainAppBody = document.getElementById('mainAppBody');
  if (loadingScreen) {
    loadingScreen.style.display = 'none';
  }
  if (mainAppBody) {
    mainAppBody.style.display = 'block';
  }
}

function triggerNotification(message, isSuccess = true, type = 'success') {
  const popup = document.getElementById('customPopupNotice');
  const icon = document.getElementById('noticeIcon');
  const msgSpan = document.getElementById('noticeMessage');

  if (!popup) return;
  
  msgSpan.innerText = message;
  if (type === 'success' || isSuccess) {
    popup.className = "notify-popup active success";
    icon.className = "fas fa-check-circle";
  } else if (type === 'error') {
    popup.className = "notify-popup active error";
    icon.className = "fas fa-exclamation-circle";
  } else {
    popup.className = "notify-popup active info";
    icon.className = "fas fa-info-circle";
  }
  setTimeout(() => { popup.classList.remove('active'); }, 4500);
}

function formatRp(val) { 
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(val || 0); 
}

function getBadge(real, budget) { 
  if (real > budget) return '<span class="badge badge-danger">Over Budget</span>'; 
  if (budget > 0 && (real / budget) >= 0.9) return '<span class="badge badge-warning">Near Limit</span>'; 
  return '<span class="badge badge-success">Aman</span>'; 
}

// ==================== USER MANAGEMENT FUNCTIONS ====================
async function createNewUser(email, password, role) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    await set(ref(db, `users/${user.uid}`), {
      email: email,
      role: role,
      createdAt: new Date().toLocaleDateString('id-ID'),
      createdAtTimestamp: Date.now()
    });
    
    triggerNotification(`User ${email} berhasil dibuat dengan role ${role}!`, true);
    return { success: true, uid: user.uid };
  } catch (error) {
    console.error("Error creating user:", error);
    let errorMessage = "Gagal membuat user: ";
    if (error.code === 'auth/email-already-in-use') {
      errorMessage += "Email sudah terdaftar!";
    } else if (error.code === 'auth/invalid-email') {
      errorMessage += "Format email tidak valid!";
    } else if (error.code === 'auth/weak-password') {
      errorMessage += "Password terlalu lemah! Minimal 6 karakter.";
    } else {
      errorMessage += error.message;
    }
    triggerNotification(errorMessage, false, 'error');
    return { success: false, error: errorMessage };
  }
}

async function updateUserRole(uid, newRole) {
  try {
    await update(ref(db, `users/${uid}`), {
      role: newRole,
      updatedAt: new Date().toLocaleDateString('id-ID'),
      updatedBy: currentUserEmail
    });
    triggerNotification(`Role user berhasil diupdate menjadi ${newRole}!`, true);
    return { success: true };
  } catch (error) {
    console.error("Error updating user role:", error);
    triggerNotification("Gagal mengupdate role user!", false, 'error');
    return { success: false };
  }
}

async function resetUserPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    triggerNotification(`Email reset password telah dikirim ke ${email}.`, true, 'info');
    return { success: true };
  } catch (error) {
    console.error("Error resetting password:", error);
    triggerNotification("Gagal mereset password: " + error.message, false, 'error');
    return { success: false };
  }
}

async function deleteUserAccount(uid, email) {
  try {
    await remove(ref(db, `users/${uid}`));
    
    await set(ref(db, `deletedUsers/${uid}`), {
      email: email,
      deletedAt: new Date().toLocaleString(),
      deletedBy: currentUserEmail
    });
    
    triggerNotification(`User ${email} telah dihapus dari database.`, true, 'info');
    return { success: true };
  } catch (error) {
    console.error("Error deleting user:", error);
    triggerNotification("Gagal menghapus user!", false, 'error');
    return { success: false };
  }
}

// ==================== AUTH SECURITY CHECK PIPELINE ====================
function ensureAdminUIDInDatabase(user) {
  const adminUIDs = ["Wswgb5mhjRe1gnTF3X365bKXo7k1"];
  const adminEmails = ["admin@genetek.co.id"];
  
  if (adminUIDs.includes(user.uid) || adminEmails.includes(user.email)) {
    const adminRef = ref(db, `users/${user.uid}`);
    get(adminRef).then((snapshot) => {
      if (!snapshot.exists()) {
        set(adminRef, {
          email: user.email,
          role: "Administrator",
          createdAt: new Date().toLocaleDateString('id-ID'),
          isAdmin: true
        });
      }
    }).catch(error => console.error("Error ensuring admin:", error));
  }
}

function enforceRoleVisibility() {
  const allowedPages = rolePermissions[currentRole] || [];
  document.querySelectorAll('#sidebarMenu li').forEach(li => {
    const pageKey = li.getAttribute('data-page');
    if (allowedPages.includes(pageKey)) {
      li.classList.remove('restricted');
      li.style.display = 'flex';
    } else {
      li.classList.add('restricted');
      li.style.display = 'none';
    }
  });
  
  const activeLi = document.querySelector('#sidebarMenu li.active');
  if (activeLi && activeLi.classList.contains('restricted')) {
     document.querySelector('#sidebarMenu li[data-page="dashboard"]').click();
  }
}

// ==================== REALTIME CLOUD LISTENERS ====================
function initCloudDatabaseListeners() {
  onValue(ref(db, 'projects'), (snapshot) => {
    const data = snapshot.val();
    projects = data ? Object.keys(data).map(k => ({id: k, ...data[k]})) : [];
    updateWholeUI();
  });

  onValue(ref(db, 'rabItems'), (snapshot) => {
    const data = snapshot.val();
    rabItems = data ? Object.keys(data).map(k => ({id: k, ...data[k]})) : [];
    updateWholeUI();
  });

  onValue(ref(db, 'claims'), (snapshot) => {
    const data = snapshot.val();
    claims = data ? Object.keys(data).map(k => ({id: k, ...data[k]})) : [];
    updateWholeUI();
  });

  onValue(ref(db, 'truenasFiles'), (snapshot) => {
    const data = snapshot.val();
    truenasFiles = data ? Object.keys(data).map(k => ({id: k, ...data[k]})) : [];
    renderTreeHierarchy();
  });

  onValue(ref(db, 'users'), (snapshot) => {
    const data = snapshot.val();
    if (data) {
      users = Object.keys(data).map(k => ({id: k, ...data[k]}));
    } else {
      users = [];
    }
    renderUsersTable();
  });
}

function updateWholeUI() {
  renderDashboard();
  renderMasterProject();
  renderApprovalList();
  renderClaimView();
  renderMonitoringTable();
  renderReports();
  refreshGraphicCharts();
  populateDropdownMenus();
}

function populateDropdownMenus() {
  const upSel = document.getElementById('uploadProjectSelect');
  if (upSel) {
    const valBackup = upSel.value;
    upSel.innerHTML = '<option value="">-- Pilih Project Target --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (valBackup) upSel.value = valBackup;
  }
}

// ==================== DASHBOARD MODUL ====================
function renderDashboard() {
  const totalPaguGlobal = projects.reduce((sum, p) => sum + (parseFloat(p.totalBudget) || 0), 0);
  const totalRealisasiGlobal = rabItems.reduce((sum, i) => sum + (parseFloat(i.realisasi) || 0), 0);
  const overCount = rabItems.filter(i => i.realisasi > i.budget).length;

  const cardsContainer = document.getElementById('cardsContainer');
  if (cardsContainer) {
    cardsContainer.innerHTML = `
      <div class="card"><h3>Project Aktif</h3><p>${projects.length}</p></div>
      <div class="card"><h3>Total Budget</h3><p>${formatRp(totalPaguGlobal)}</p></div>
      <div class="card"><h3>Total Realisasi</h3><p>${formatRp(totalRealisasiGlobal)}</p></div>
      <div class="card"><h3>Item Over Anggaran</h3><p style="color:#ef4444">${overCount}</p></div>
    `;
  }

  const tbody = document.getElementById('monitoringBody');
  if (tbody) {
    const limitedSorted = [...rabItems].sort((a,b) => b.budget - a.budget).slice(0, 6);
    tbody.innerHTML = limitedSorted.map(i => {
      const p = projects.find(proj => proj.id === i.projectId);
      return `<tr><td>${p ? p.name : 'Unassigned'}</td><td>${i.itemName}</td><td>${formatRp(i.budget)}</td><td>${formatRp(i.realisasi)}</td><td>${getBadge(i.realisasi, i.budget)}</td></tr>`;
    }).join('');
  }
}

// ==================== MASTER PROJECT COMPONENT ====================
function renderMasterProject() {
  const tbody = document.getElementById('masterProjectBody');
  if (tbody) {
    tbody.innerHTML = projects.map(p => {
      const totalAllocatedToSubItems = rabItems.filter(i => i.projectId === p.id).reduce((sum, i) => sum + (parseFloat(i.budget) || 0), 0);
      const remainingPagu = p.totalBudget - totalAllocatedToSubItems;

      return `<tr>
        <td><strong>${p.name}</strong></td>
        <td>${p.client}</td>
        <td>${formatRp(p.totalBudget)}</td>
        <td style="font-weight:700; color:${remainingPagu < 0 ? '#ef4444':'#10b981'}">${formatRp(remainingPagu)}</td>
        <td><button class="btn btn-danger btn-del-proj" style="padding: 4px 12px; border-radius:12px; font-size:0.75rem;" data-id="${p.id}"><i class="fas fa-trash"></i> Hapus</button></td>
       </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-del-proj').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (confirm('Hapus master project beserta struktur item di dalamnya?')) {
           remove(ref(db, `projects/${id}`));
           rabItems.filter(i => i.projectId === id).forEach(i => remove(ref(db, `rabItems/${i.id}`)));
        }
      });
    });
  }

  const filter = document.getElementById('filterProjectRAB');
  if (filter) {
    const prevFilterValue = currentSelectedProjectId;
    filter.innerHTML = '<option value="">-- Filter Master Project --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (prevFilterValue) filter.value = prevFilterValue;
  }
  renderRABItemsSubTable();
}

function renderRABItemsSubTable() {
  const tbody = document.getElementById('rabItemsMasterBody');
  if (!tbody) return;
  
  if (!currentSelectedProjectId) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748b;">Silakan tentukan filter project terlebih dahulu.</td></tr>';
    return;
  }

  const filtered = rabItems.filter(i => i.projectId === currentSelectedProjectId);
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748b;">Belum ada item komponen di dalam project ini.</tr></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(i => `
    <tr>
      <td>${i.itemName}</td>
      <td>${formatRp(i.budget)}</td>
      <td>${formatRp(i.realisasi)}</td>
      <td>${formatRp(i.budget - i.realisasi)}</td>
      <td><button class="btn btn-danger btn-del-rab-sub" style="padding: 4px 12px; border-radius:12px; font-size:0.75rem;" data-id="${i.id}"><i class="fas fa-trash"></i></button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-del-rab-sub').forEach(btn => {
    btn.addEventListener('click', () => {
       const itemId = btn.getAttribute('data-id');
       if (confirm('Hapus parameter anggaran item ini?')) {
         remove(ref(db, `rabItems/${itemId}`));
       }
    });
  });
}

// ==================== USER MANAGEMENT RENDERING ====================
function renderUsersTable() {
  const tbody = document.getElementById('userTableBody');
  if (!tbody) return;

  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94a3b8;">Belum ada user terdaftar. Silakan tambah user baru.</td><tr>';
    return;
  }

  tbody.innerHTML = users.map(u => {
    let roleBadgeClass = '';
    if (u.role === 'Administrator') roleBadgeClass = 'badge-danger';
    else if (u.role === 'Finance') roleBadgeClass = 'badge-warning';
    else roleBadgeClass = 'badge-success';
    
    const isCurrentUser = (currentUserEmail === u.email);
    
    return `<tr>
      <td><strong>${u.email}</strong> ${isCurrentUser ? '<span class="badge badge-info">(Anda)</span>' : ''}</td>
      <td><span class="badge ${roleBadgeClass}">${u.role}</span></td>
      <td style="font-size:0.7rem; color:#64748b; font-family: monospace;">${u.id ? u.id.substring(0, 12) + '...' : '-'}</td>
      <td>${u.createdAt || '-'}</td>
      <td class="action-buttons">
        ${currentRole === 'Administrator' ? `
          ${!isCurrentUser ? `
            <button class="btn-edit" data-uid="${u.id}" data-email="${u.email}" data-role="${u.role}"><i class="fas fa-edit"></i> Edit Role</button>
            <button class="btn-reset" data-uid="${u.id}" data-email="${u.email}"><i class="fas fa-key"></i> Reset Pass</button>
            <button class="btn-delete" data-uid="${u.id}" data-email="${u.email}"><i class="fas fa-trash"></i> Hapus</button>
          ` : `
            <span class="badge badge-secondary"><i class="fas fa-user-shield"></i> Akun Anda</span>
          `}
        ` : `
          <span class="badge badge-secondary">Hanya Admin</span>
        `}
      </td>
    </tr>`;
  }).join('');

  if (currentRole === 'Administrator') {
    tbody.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.getAttribute('data-uid');
        const email = btn.getAttribute('data-email');
        const currentRoleUser = btn.getAttribute('data-role');
        openEditUserModal(uid, email, currentRoleUser);
      });
    });
    
    tbody.querySelectorAll('.btn-reset').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.getAttribute('data-uid');
        const email = btn.getAttribute('data-email');
        openResetPasswordModal(uid, email);
      });
    });
    
    tbody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.getAttribute('data-uid');
        const email = btn.getAttribute('data-email');
        if (confirm(`Apakah Anda yakin ingin menghapus user ${email}?`)) {
          await deleteUserAccount(uid, email);
        }
      });
    });
  }
}

function openEditUserModal(uid, email, currentRoleUser) {
  const modal = document.getElementById('userModal');
  const title = document.getElementById('userModalTitle');
  const emailInput = document.getElementById('modalUserEmail');
  const passwordFieldGroup = document.getElementById('passwordFieldGroup');
  const roleSelect = document.getElementById('modalRole');
  const saveBtn = document.getElementById('saveUserBtn');
  const editUserId = document.getElementById('editUserId');
  
  title.innerHTML = '<i class="fas fa-user-edit"></i> Edit Role User';
  emailInput.value = email;
  emailInput.disabled = true;
  if (passwordFieldGroup) passwordFieldGroup.style.display = 'none';
  roleSelect.value = currentRoleUser;
  editUserId.value = uid;
  
  const newSaveHandler = async () => {
    const newRole = roleSelect.value;
    if (newRole !== currentRoleUser) {
      await updateUserRole(uid, newRole);
    }
    modal.classList.remove('active');
    emailInput.disabled = false;
    emailInput.value = '';
    if (passwordFieldGroup) passwordFieldGroup.style.display = 'block';
    editUserId.value = '';
    title.innerHTML = '<i class="fas fa-user-plus"></i> Tambah User Baru';
    saveBtn.onclick = saveNewUser;
  };
  
  saveBtn.onclick = newSaveHandler;
  modal.classList.add('active');
}

function openResetPasswordModal(uid, email) {
  const modal = document.getElementById('resetPasswordModal');
  const emailInput = document.getElementById('resetUserEmail');
  
  emailInput.value = email;
  
  const confirmBtn = document.getElementById('confirmResetPasswordBtn');
  confirmBtn.onclick = async () => {
    await resetUserPassword(email);
    modal.classList.remove('active');
  };
  
  modal.classList.add('active');
}

async function saveNewUser() {
  const email = document.getElementById('modalUserEmail').value.trim().toLowerCase();
  let password = document.getElementById('modalUserPassword').value;
  const role = document.getElementById('modalRole').value;
  
  if (!email) {
    triggerNotification('Email wajib diisi!', false, 'error');
    return;
  }
  
  const existingUser = users.find(u => u.email === email);
  if (existingUser) {
    triggerNotification('Email sudah terdaftar!', false, 'error');
    return;
  }
  
  if (!password) {
    password = 'password123';
  }
  
  if (password.length < 6) {
    triggerNotification('Password minimal 6 karakter!', false, 'error');
    return;
  }
  
  const result = await createNewUser(email, password, role);
  
  if (result.success) {
    const modal = document.getElementById('userModal');
    modal.classList.remove('active');
    document.getElementById('modalUserEmail').value = '';
    document.getElementById('modalUserPassword').value = '';
  }
}

// ==================== EVENT LISTENERS ====================
document.getElementById('filterProjectRAB')?.addEventListener('change', (e) => {
  currentSelectedProjectId = e.target.value;
  renderRABItemsSubTable();
});

document.getElementById('saveProjectBtn')?.addEventListener('click', () => {
  const name = document.getElementById('modalProjectName').value.trim();
  const client = document.getElementById('modalClientName').value.trim();
  const totalBudget = parseFloat(document.getElementById('modalBudget').value) || 0;

  if (!name || !client || totalBudget <= 0) { triggerNotification('Form harus diisi lengkap & valid!', false); return; }

  const newProjectRef = push(ref(db, 'projects'));
  set(newProjectRef, { name, client, totalBudget }).then(() => {
    document.getElementById('projectModal').classList.remove('active');
    document.getElementById('modalProjectName').value = '';
    document.getElementById('modalClientName').value = '';
    document.getElementById('modalBudget').value = '';
    triggerNotification('Master project berhasil ditambahkan!');
  });
});

document.getElementById('openRABModalBtn')?.addEventListener('click', () => {
  if (!currentSelectedProjectId) { triggerNotification('Pilih filter project terlebih dahulu!', false); return; }
  const currentProj = projects.find(p => p.id === currentSelectedProjectId);
  document.getElementById('rabModalProjectName').value = currentProj ? currentProj.name : '';
  document.getElementById('rabItemName').value = '';
  document.getElementById('rabBudget').value = '';
  document.getElementById('rabModal').classList.add('active');
});

document.getElementById('saveRabBtn')?.addEventListener('click', () => {
  const itemName = document.getElementById('rabItemName').value.trim();
  const budget = parseFloat(document.getElementById('rabBudget').value) || 0;

  if (!itemName || budget <= 0) { triggerNotification('Isi data nominal komponen dengan valid!', false); return; }

  const newRabRef = push(ref(db, 'rabItems'));
  set(newRabRef, {
    projectId: currentSelectedProjectId,
    itemName,
    budget,
    realisasi: 0
  }).then(() => {
    document.getElementById('rabModal').classList.remove('active');
    triggerNotification('Item komponen RAB berhasil disimpan!');
  });
});

// ==================== MULTI-ITEM CLAIM LOGIC ====================
let claimItemsListArray = [];

function renderClaimItemsBuildLayout() {
  const container = document.getElementById('itemList');
  if (!container) return;
  
  const targetProjId = document.getElementById('claimProjectSelect').value;
  const availableItems = rabItems.filter(i => i.projectId === targetProjId);

  if (claimItemsListArray.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:10px;">Belum ada baris item klaim. Klik Tambah Baris Item.</div>';
    return;
  }

  container.innerHTML = claimItemsListArray.map((item, idx) => `
    <div class="item-row">
      <select data-idx="${idx}" class="item-sel-node">
        <option value="">-- Tentukan Item RAB --</option>
        ${availableItems.map(av => `<option value="${av.id}" ${item.itemId === av.id ? 'selected':''}>${av.itemName} (Sisa: ${formatRp(av.budget - av.realisasi)})</option>`).join('')}
      </select>
      <input type="number" data-idx="${idx}" class="item-nom-node" placeholder="Nominal Rp" value="${item.nominal || ''}" />
      <button type="button" class="remove-item" data-idx="${idx}"><i class="fas fa-trash"></i></button>
    </div>
  `).join('');

  container.querySelectorAll('.item-sel-node').forEach(sel => {
    sel.addEventListener('change', (e) => { claimItemsListArray[parseInt(sel.dataset.idx)].itemId = e.target.value; });
  });
  container.querySelectorAll('.item-nom-node').forEach(inp => {
    inp.addEventListener('change', (e) => { claimItemsListArray[parseInt(inp.dataset.idx)].nominal = parseFloat(e.target.value) || 0; });
  });
  container.querySelectorAll('.remove-item').forEach(btn => {
    btn.addEventListener('click', () => {
      claimItemsListArray.splice(parseInt(btn.dataset.idx), 1);
      renderClaimItemsBuildLayout();
    });
  });
}

function renderClaimView() {
  const selectPr = document.getElementById('claimProjectSelect');
  if (selectPr) {
    const backupSelectedVal = selectPr.value;
    selectPr.innerHTML = '<option value="">-- Pilih Asosiasi Project --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (backupSelectedVal) selectPr.value = backupSelectedVal;
  }

  const historyBody = document.getElementById('historyClaimBody');
  if (historyBody) {
    historyBody.innerHTML = claims.map(c => {
      const p = projects.find(pr => pr.id === c.projectId);
      const summaries = c.items ? c.items.map(ci => {
        const r = rabItems.find(rab => rab.id === ci.itemId);
        return `${r ? r.itemName : 'Eksternal Component'}: ${formatRp(ci.nominal)}`;
      }).join('<br>') : '-';

      let classBadge = 'badge-warning';
      if (c.status === 'approved') classBadge = 'badge-success';
      if (c.status === 'rejected') classBadge = 'badge-danger';

      return `<tr>
        <td><strong>${p ? p.name : 'Unknown'}</strong></td>
        <td style="font-size:0.8rem; color:#475569;">${summaries}</td>
        <td style="font-weight:700;">${formatRp(c.totalNominal)}</td>
        <td>${c.vendor}</td>
        <td><span class="badge ${classBadge}">${c.status}</span></td>
        <td>${c.tanggal}</td>
       </tr>`;
    }).join('');
  }
}

document.getElementById('claimProjectSelect')?.addEventListener('change', () => {
   claimItemsListArray = [];
   renderClaimItemsBuildLayout();
});

document.getElementById('addItemBtn')?.addEventListener('click', () => {
   if (!document.getElementById('claimProjectSelect').value) { triggerNotification('Pilih asosiasi project terlebih dahulu!', false); return; }
   claimItemsListArray.push({ itemId: '', nominal: 0 });
   renderClaimItemsBuildLayout();
});

document.getElementById('submitClaimMainBtn')?.addEventListener('click', () => {
  const projectId = document.getElementById('claimProjectSelect').value;
  const vendor = document.getElementById('claimVendor').value.trim();
  const tanggal = document.getElementById('claimDate').value;
  const desc = document.getElementById('claimDesc').value;

  const validItems = claimItemsListArray.filter(it => it.itemId && it.nominal > 0);
  if (!projectId || validItems.length === 0 || !vendor || !tanggal) {
    triggerNotification('Harap isi kelengkapan form klaim multi-item!', false);
    return;
  }

  const totalNominal = validItems.reduce((sum, i) => sum + i.nominal, 0);
  const newClaimRef = push(ref(db, 'claims'));
  
  set(newClaimRef, {
    projectId, vendor, tanggal, desc,
    status: 'pending', totalNominal, items: validItems
  }).then(() => {
     claimItemsListArray = [];
     document.getElementById('claimVendor').value = '';
     document.getElementById('claimDesc').value = '';
     document.getElementById('claimDate').value = '';
     renderClaimItemsBuildLayout();
     triggerNotification('Pengajuan klaim berhasil dikirim ke pipeline!');
  });
});

// ==================== APPROVAL LOGICS ====================
function renderApprovalList() {
  const tbody = document.getElementById('approvalBody');
  if (!tbody) return;

  const pendingClaims = claims.filter(c => c.status === 'pending');
  if (pendingClaims.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#94a3b8;">Antrean persetujuan pipeline bersih.</td></tr>';
    return;
  }

  tbody.innerHTML = pendingClaims.map((c, idx) => {
    const p = projects.find(pr => pr.id === c.projectId);
    const names = c.items ? c.items.map(it => {
       const r = rabItems.find(rab => rab.id === it.itemId);
       return r ? r.itemName : 'Unknown';
    }).join(', ') : '';

    return `<tr>
      <td>${idx+1}</td>
      <td><strong>${p ? p.name : 'Unknown'}</strong></td>
      <td>${names}</td>
      <td style="font-weight:700; color:#2563eb;">${formatRp(c.totalNominal)}</td>
      <td>${c.vendor}</td>
      <td><span class="badge badge-warning">PENDING</span></td>
      <td>
        <button class="btn btn-success app-btn" style="padding:4px 10px; border-radius:8px; font-size:0.75rem" data-id="${c.id}"><i class="fas fa-check"></i> Setuju</button>
        <button class="btn btn-danger rej-btn" style="padding:4px 10px; border-radius:8px; font-size:0.75rem" data-id="${c.id}"><i class="fas fa-times"></i> Tolak</button>
       </td>
     </tr>`;
  }).join('');

  tbody.querySelectorAll('.app-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const claimId = btn.getAttribute('data-id');
      const targetObj = claims.find(c => c.id === claimId);
      if (targetObj) {
        targetObj.items.forEach(item => {
           const matchedRab = rabItems.find(r => r.id === item.itemId);
           if (matchedRab) {
              const existingRealization = parseFloat(matchedRab.realisasi) || 0;
              update(ref(db, `rabItems/${matchedRab.id}`), { realisasi: existingRealization + item.nominal });
           }
        });
        update(ref(db, `claims/${claimId}`), { status: 'approved' }).then(() => {
          triggerNotification('Klaim disetujui, anggaran realisasi diperbarui.');
        });
      }
    });
  });

  tbody.querySelectorAll('.rej-btn').forEach(btn => {
     btn.addEventListener('click', () => {
       const claimId = btn.getAttribute('data-id');
       update(ref(db, `claims/${claimId}`), { status: 'rejected' }).then(() => {
         triggerNotification('Pengajuan klaim berhasil ditolak.', false);
       });
     });
  });
}

// ==================== MONITORING COMPONENTS ====================
function renderMonitoringTable() {
  const tbody = document.getElementById('monitoringProjectBody');
  if (!tbody) return;

  tbody.innerHTML = projects.map((p, index) => {
    const relatedSubItems = rabItems.filter(i => i.projectId === p.id);
    const computedBudgets = relatedSubItems.reduce((sum, i) => sum + i.budget, 0);
    const computedRealizations = relatedSubItems.reduce((sum, i) => sum + i.realisasi, 0);
    const balance = computedBudgets - computedRealizations;
    const percentage = computedBudgets > 0 ? ((computedRealizations / computedBudgets) * 100).toFixed(1) : 0;

    return `<tr class="project-row" data-id="${p.id}">
      <td>${index+1}</td>
      <td><span class="project-name-link"><i class="fas fa-chart-simple"></i> ${p.name}</span></td>
      <td>${p.client}</td>
      <td>${formatRp(computedBudgets)}</td>
      <td>${formatRp(computedRealizations)}</td>
      <td style="font-weight:600; color:${balance < 0 ? '#ef4444':'#475569'}">${formatRp(balance)}</td>
      <td><strong>${percentage}%</strong></td>
     </td>`;
  }).join('');

  tbody.querySelectorAll('.project-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const id = row.getAttribute('data-id');
      const proj = projects.find(p => p.id === id);
      const elements = rabItems.filter(i => i.projectId === id);

      document.getElementById('detailModalTitle').innerHTML = `<i class="fas fa-clipboard-list"></i> Komponen Konstruksi - ${proj ? proj.name : ''}`;
      const detailBody = document.getElementById('detailRabBody');
      
      if (elements.length === 0) {
        detailBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Tidak ada item alokasi di dalam project ini.</td></tr>';
      } else {
        detailBody.innerHTML = elements.map(i => `
          <tr>
            <td>${i.itemName}</td>
            <td>${formatRp(i.budget)}</td>
            <td>${formatRp(i.realisasi)}</td>
            <td>${formatRp(i.budget - i.realisasi)}</td>
            <td>${getBadge(i.realisasi, i.budget)}</td>
          </tr>
        `).join('');
      }
      document.getElementById('detailRabModal').classList.add('active');
    });
  });
}

// ==================== REPORTS WITH PDF DOWNLOAD ====================
function renderReports() {
  const tbody = document.getElementById('laporanBody');
  if (!tbody) return;

  tbody.innerHTML = projects.map(p => {
     const insideItems = rabItems.filter(i => i.projectId === p.id);
     const subBudget = insideItems.reduce((sum, i) => sum + i.budget, 0);
     const subReal = insideItems.reduce((sum, i) => sum + i.realisasi, 0);
     const diff = subBudget - subReal;
     return `<tr>
       <td><strong>${p.name}</strong></td>
       <td>${formatRp(subBudget)}</td>
       <td>${formatRp(subReal)}</td>
       <td>${formatRp(diff)}</td>
       <td><span class="badge ${diff < 0 ? 'badge-danger':'badge-success'}">${diff < 0 ? 'Over Budget':'On Track'}</span></td>
      </tr>`;
  }).join('');
}

function downloadPDF() {
  const reportContent = document.getElementById('reportContent');
  if (!reportContent) return;

  // Create a temporary container for PDF
  const originalContent = reportContent.innerHTML;
  
  // Get current date for report header
  const currentDate = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  // Create full report HTML
  const reportHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Laporan RAB - ${currentDate}</title>
      <style>
        body {
          font-family: 'Inter', Arial, sans-serif;
          padding: 40px;
          margin: 0;
          color: #1e293b;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 2px solid #3b82f6;
          padding-bottom: 20px;
        }
        .header h1 {
          color: #1e293b;
          margin: 0;
          font-size: 24px;
        }
        .header h2 {
          color: #3b82f6;
          margin: 10px 0 0;
          font-size: 18px;
        }
        .header p {
          color: #64748b;
          margin: 10px 0 0;
          font-size: 12px;
        }
        .summary {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 30px;
          flex-wrap: wrap;
        }
        .summary-card {
          flex: 1;
          background: #f1f5f9;
          padding: 15px;
          border-radius: 12px;
          text-align: center;
        }
        .summary-card h3 {
          margin: 0 0 10px;
          font-size: 12px;
          color: #64748b;
        }
        .summary-card p {
          margin: 0;
          font-size: 20px;
          font-weight: bold;
          color: #1e293b;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        th, td {
          border: 1px solid #e2e8f0;
          padding: 12px;
          text-align: left;
          font-size: 12px;
        }
        th {
          background: #f1f5f9;
          font-weight: 600;
        }
        .footer {
          margin-top: 40px;
          text-align: center;
          font-size: 10px;
          color: #94a3b8;
          border-top: 1px solid #e2e8f0;
          padding-top: 20px;
        }
        .badge-success {
          background: #d1fae5;
          color: #065f46;
          padding: 4px 8px;
          border-radius: 20px;
          font-size: 10px;
        }
        .badge-danger {
          background: #fee2e2;
          color: #991b1b;
          padding: 4px 8px;
          border-radius: 20px;
          font-size: 10px;
        }
        .badge-warning {
          background: #fed7aa;
          color: #9a3412;
          padding: 4px 8px;
          border-radius: 20px;
          font-size: 10px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>LAPORAN RAB MONITORING</h1>
        <h2>PT Genetek Indonesia</h2>
        <p>Dicetak pada: ${currentDate}</p>
      </div>
      
      <div class="summary">
        <div class="summary-card">
          <h3>Total Project</h3>
          <p>${projects.length}</p>
        </div>
        <div class="summary-card">
          <h3>Total Budget</h3>
          <p>${formatRp(projects.reduce((sum, p) => sum + (parseFloat(p.totalBudget) || 0), 0))}</p>
        </div>
        <div class="summary-card">
          <h3>Total Realisasi</h3>
          <p>${formatRp(rabItems.reduce((sum, i) => sum + (parseFloat(i.realisasi) || 0), 0))}</p>
        </div>
        <div class="summary-card">
          <h3>Item Over Budget</h3>
          <p>${rabItems.filter(i => i.realisasi > i.budget).length}</p>
        </div>
      </div>
      
      <h3 style="margin-top: 30px;">Detail Laporan per Project</h3>
      ${reportContent.innerHTML}
      
      <div class="footer">
        <p>Laporan ini dibuat secara otomatis oleh sistem RAB Monitoring</p>
      </div>
    </body>
    </html>
  `;
  
  // Configure pdf options
  const element = document.createElement('div');
  element.innerHTML = reportHTML;
  
  const opt = {
    margin: [0.5, 0.5, 0.5, 0.5],
    filename: `Laporan_RAB_${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, letterRendering: true },
    jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' }
  };
  
  html2pdf().set(opt).from(element).save();
  triggerNotification('Laporan PDF sedang diproses...', true);
}

document.getElementById('downloadPDFBtn')?.addEventListener('click', downloadPDF);

// ==================== TRUENAS STORAGE Pool (Simplified - No subfolders) ====================
document.getElementById('trueNasUploadForm')?.addEventListener('submit', function(e) {
  e.preventDefault();
  const fileInputElement = document.getElementById('trueNasFile');
  const attachedProjectId = document.getElementById('uploadProjectSelect').value;

  if (!attachedProjectId || fileInputElement.files.length === 0) {
    triggerNotification('Data parameter berkas tidak valid!', false);
    return;
  }

  const fileObj = fileInputElement.files[0];
  const resolvedProjectObj = projects.find(p => p.id === attachedProjectId);
  
  const safeProjectDirName = resolvedProjectObj.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const serverStoragePath = `/mnt/EXTERNAL-4TB/Data/speakup/apps/rab/${safeProjectDirName}`;

  const dataPayload = new FormData();
  dataPayload.append('path', serverStoragePath); 
  dataPayload.append('file', fileObj);

  fetch(`${API_BASE_URL}/upload`, { method: 'POST', body: dataPayload })
  .then(async response => {
    if (!response.ok) throw new Error('Server TrueNAS menolak unggahan berkas');
    return response.json();
  })
  .then(data => {
     triggerNotification('File sukses diunggah ke storage!');
     const pushedFileRef = push(ref(db, 'truenasFiles'));
     set(pushedFileRef, {
        projectId: attachedProjectId,
        projectName: resolvedProjectObj.name,
        fileName: fileObj.name,
        uploadedAt: new Date().toLocaleString(),
        fullServerDiskPath: `${serverStoragePath}/${fileObj.name}`
     });
     fileInputElement.value = '';
  })
  .catch(error => {
     triggerNotification(`Gagal Upload: ${error.message}`, false);
  });
});

window.deleteTrueNasFileRecord = function(firebaseKey, fullPath) {
  if(!confirm("Hapus file ini secara permanen dari penyimpanan?")) return;

  fetch(`${API_BASE_URL}/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filePath: fullPath })
  })
  .then(async res => {
    if(!res.ok) throw new Error("Gagal menghapus berkas fisik");
    return res.json();
  })
  .then(() => {
    remove(ref(db, `truenasFiles/${firebaseKey}`)).then(() => {
      triggerNotification("Berkas dibersihkan permanen dari penyimpanan.");
    });
  })
  .catch(err => {
    remove(ref(db, `truenasFiles/${firebaseKey}`)).then(() => {
      triggerNotification("Metadata dibersihkan dari database.", false);
    });
  });
}

function renderTreeHierarchy() {
  const treeWrapper = document.getElementById('rootTreeContainer');
  if (!treeWrapper) return;

  if (projects.length === 0) {
    treeWrapper.innerHTML = '<li><i class="fas fa-info-circle"></i> Master project kosong.</li>';
    return;
  }

  let innerLayoutCodeHtml = `<li><span class="root-node"><i class="fas fa-server"></i> Storage Server: .../apps/rab/</span><ul class="nested-tree">`;
  projects.forEach(p => {
     const folderSanitizedName = p.name.replace(/[^a-zA-Z0-9_-]/g, '_');
     innerLayoutCodeHtml += `<li><span class="folder-node"><i class="fas fa-folder-open"></i> ${p.name}</span><ul class="nested-tree">`;
     
     const projectFiles = truenasFiles.filter(f => f.projectId === p.id);
     if (projectFiles.length === 0) {
       innerLayoutCodeHtml += '<li class="file-node" style="color:#94a3b8; font-style:italic;">Tidak ada file</li>';
     } else {
       projectFiles.forEach(f => {
         const safeUrl = `${API_BASE_URL}/unduh-dokumen/${encodeURIComponent(folderSanitizedName)}/${encodeURIComponent(f.fileName)}`;
         innerLayoutCodeHtml += `<li class="file-node">
                                    <i class="fas fa-file"></i> ${f.fileName} 
                                    <div class="action-links">
                                      <a href="${safeUrl}" target="_blank" class="preview-link"><i class="fas fa-eye"></i> Preview</a>
                                      <button onclick="deleteTrueNasFileRecord('${f.id}', '${f.fullServerDiskPath}')" class="delete-file-btn"><i class="fas fa-times-circle"></i></button>
                                    </div>
                                  </li>`;
       });
     }
     
     innerLayoutCodeHtml += `</ul></li>`;
  });
  treeWrapper.innerHTML = innerLayoutCodeHtml + `</ul></li>`;
}

// ==================== GRAPHIC ENGINE ====================
let mainBarChartInstance, systemLineReportChartInstance;

function refreshGraphicCharts() {
  const barCtx = document.getElementById('budgetChart')?.getContext('2d');
  if (barCtx) {
     if (mainBarChartInstance) mainBarChartInstance.destroy();
     mainBarChartInstance = new Chart(barCtx, {
        type: 'bar',
        data: {
           labels: projects.map(p => p.name),
           datasets: [
             { label: 'Total Anggaran Pagu (Juta)', data: projects.map(p => rabItems.filter(i => i.projectId === p.id).reduce((s,i)=>s+i.budget,0)/1e6), backgroundColor: '#3b82f6' },
             { label: 'Realisasi Klaim (Juta)', data: projects.map(p => rabItems.filter(i => i.projectId === p.id).reduce((s,i)=>s+i.realisasi,0)/1e6), backgroundColor: '#10b981' }
           ]
        },
        options: { responsive: true }
     });
  }

  const lineCtx = document.getElementById('laporanChart')?.getContext('2d');
  if (lineCtx) {
     if (systemLineReportChartInstance) systemLineReportChartInstance.destroy();
     systemLineReportChartInstance = new Chart(lineCtx, {
        type: 'line',
        data: {
           labels: projects.map(p => p.name),
           datasets: [
             { label: 'Kurva Pola Alokasi', data: projects.map(p => rabItems.filter(i => i.projectId === p.id).reduce((s,i)=>s+i.budget,0)/1e6), borderColor: '#8b5cf6', fill: false, tension:0.2 },
             { label: 'Kurva Penyerapan Dana', data: projects.map(p => rabItems.filter(i => i.projectId === p.id).reduce((s,i)=>s+i.realisasi,0)/1e6), borderColor: '#f97316', fill: false, tension:0.2 }
           ]
        },
        options: { responsive: true }
     });
  }
}

// ==================== AUTH STATE HANDLER ====================
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = 'login.html';
  } else {
    currentUserEmail = user.email;
    currentUserUid = user.uid;
    ensureAdminUIDInDatabase(user);

    get(ref(db, `users/${user.uid}`)).then((snapshot) => {
      if (snapshot.exists()) {
        const profile = snapshot.val();
        currentRole = profile.role || "Project Manager";
        currentUserData = profile;
        
        const sbUserEmail = document.getElementById('sbUserEmail');
        const sbUserRole = document.getElementById('sbUserRole');
        if (sbUserEmail) sbUserEmail.innerText = user.email;
        if (sbUserRole) sbUserRole.innerText = currentRole;
        
        enforceRoleVisibility();
        initCloudDatabaseListeners();
        
        hideLoadingScreen();
      } else {
        set(ref(db, `users/${user.uid}`), {
          email: user.email,
          role: "Project Manager",
          createdAt: new Date().toLocaleDateString('id-ID')
        }).then(() => {
          currentRole = "Project Manager";
          enforceRoleVisibility();
          initCloudDatabaseListeners();
          hideLoadingScreen();
        });
      }
    }).catch(error => {
      console.error("Error fetching user profile:", error);
      signOut(auth);
    });
  }
});

// ==================== LOGOUT ====================
document.getElementById('logoutBtn')?.addEventListener('click', () => {
  if(confirm("Apakah Anda yakin ingin keluar dari aplikasi?")) {
    signOut(auth).then(() => { window.location.href = 'login.html'; });
  }
});

// ==================== MODAL CONTROLS ====================
const projModalNode = document.getElementById('projectModal');
const usrModalNode = document.getElementById('userModal');
const detailModalNode = document.getElementById('detailRabModal');
const resetModalNode = document.getElementById('resetPasswordModal');

document.getElementById('openProjectModalBtn')?.addEventListener('click', () => projModalNode?.classList.add('active'));
document.getElementById('openUserModalBtn')?.addEventListener('click', () => {
  const title = document.getElementById('userModalTitle');
  const emailInput = document.getElementById('modalUserEmail');
  const passwordInput = document.getElementById('modalUserPassword');
  const passwordFieldGroup = document.getElementById('passwordFieldGroup');
  const roleSelect = document.getElementById('modalRole');
  const editUserId = document.getElementById('editUserId');
  const saveBtn = document.getElementById('saveUserBtn');
  
  title.innerHTML = '<i class="fas fa-user-plus"></i> Tambah User Baru';
  emailInput.value = '';
  emailInput.disabled = false;
  passwordInput.value = '';
  if (passwordFieldGroup) passwordFieldGroup.style.display = 'block';
  roleSelect.value = 'Project Manager';
  editUserId.value = '';
  saveBtn.onclick = saveNewUser;
  
  usrModalNode?.classList.add('active');
});
document.getElementById('closeModalBtn')?.addEventListener('click', () => projModalNode?.classList.remove('active'));
document.getElementById('closeUserModalBtn')?.addEventListener('click', () => usrModalNode?.classList.remove('active'));
document.getElementById('closeResetModalBtn')?.addEventListener('click', () => resetModalNode?.classList.remove('active'));
document.getElementById('closeRabModalBtn')?.addEventListener('click', () => document.getElementById('rabModal')?.classList.remove('active'));
document.getElementById('closeDetailModalBtn')?.addEventListener('click', () => detailModalNode?.classList.remove('active'));

// ==================== SYSTEM ROUTING ====================
const applicationRoutingPagesMap = { 
  dashboard: 'dashboardPage', 
  'master-project': 'masterProjectPage', 
  'claim-request': 'claimRequestPage',
  'approval-budget': 'approvalBudgetPage', 
  monitoring: 'monitoringPage', 
  reports: 'reportsPage', 
  'upload-document': 'uploadDocumentPage',
  'files': 'filesPage',
  'user-management': 'userManagementPage' 
};

document.querySelectorAll('#sidebarMenu li').forEach(li => {
   li.addEventListener('click', () => {
      if (li.classList.contains('restricted')) return;

      document.querySelectorAll('#sidebarMenu li').forEach(l => l.classList.remove('active'));
      li.classList.add('active');

      const activePageKey = li.getAttribute('data-page');
      Object.values(applicationRoutingPagesMap).forEach(p => {
        const element = document.getElementById(p);
        if (element) element.classList.add('hidden-section');
      });
      
      if (applicationRoutingPagesMap[activePageKey]) {
         const targetPage = document.getElementById(applicationRoutingPagesMap[activePageKey]);
         if (targetPage) targetPage.classList.remove('hidden-section');
      }
      
      const pageTitleElement = document.getElementById('pageTitle');
      if (pageTitleElement) {
        const icon = li.querySelector('i');
        pageTitleElement.innerHTML = `<i class="${icon ? icon.className : 'fas fa-chart-pie'}"></i> ${li.innerText.trim()}`;
      }
      
      const actionButtonContext = document.getElementById('globalActionBtn');
      if (actionButtonContext) {
        actionButtonContext.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
        actionButtonContext.onclick = () => updateWholeUI();
      }
   });
});

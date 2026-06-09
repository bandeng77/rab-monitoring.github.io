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
let currentAuthUser = null;

let currentSelectedProjectId = null;
let currentRole = ""; 
let currentUserEmail = "";
let currentUserUid = "";

// Global References for Active Chart Elements
let lineCurveChartInstanceRef = null;
let pieShareChartInstanceRef = null;

const rolePermissions = {
  "Administrator": ['dashboard', 'master-project', 'claim-request', 'approval-budget', 'monitoring', 'reports', 'upload-document', 'files', 'user-management'],
  "Finance": ['dashboard', 'approval-budget', 'claim-request', 'reports', 'upload-document', 'files'],
  "Project Manager": ['dashboard', 'master-project', 'claim-request', 'monitoring', 'upload-document', 'files']
};

// ==================== HELPER FUNCTIONS ====================
function hideLoadingScreen() {
  const loadingScreen = document.getElementById('loadingScreen');
  const mainAppBody = document.getElementById('mainAppBody');
  if (loadingScreen) loadingScreen.style.display = 'none';
  if (mainAppBody) mainAppBody.style.display = 'block';
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

function formatNumber(val) {
  return new Intl.NumberFormat('id-ID').format(val || 0);
}

function getBadge(real, budget) { 
  if (real > budget) return '<span class="badge badge-danger">Over Budget</span>'; 
  if (budget > 0 && (real / budget) >= 0.9) return '<span class="badge badge-warning">Near Limit</span>'; 
  return '<span class="badge badge-success">Safe</span>'; 
}

// Progress Bar Render Utility Berdasarkan Aturan Warna Persentase Pengerjaan Riil
function createProgressBarMarkup(progressValue, rabItemId) {
  let percent = parseInt(progressValue) || 0;
  if (percent < 0) percent = 0;
  if (percent > 100) percent = 100;
  
  // Penentuan Warna Dinamis Berdasarkan Tingkat Persentase Penyelesaian Kerja
  let barColor = '#ef4444'; // Red (< 30%)
  let textColor = '#ef4444';
  
  if (percent >= 30 && percent < 70) {
    barColor = '#f59e0b'; // Orange / Amber (30% - 69%)
    textColor = '#d97706';
  } else if (percent >= 70 && percent < 100) {
    barColor = '#3b82f6'; // Indigo Blue (70% - 99%)
    textColor = '#2563eb';
  } else if (percent === 100) {
    barColor = '#10b981'; // Green (Selesai 100%)
    textColor = '#059669';
  }

  return `
    <div class="progress-wrapper">
      <input type="number" min="0" max="100" class="input-progress-inline" 
             value="${percent}" data-id="${rabItemId}" />
      <div class="progress-bar-container">
        <div class="progress-bar-fill" style="width: ${percent}%; background-color: ${barColor};"></div>
      </div>
      <span class="progress-percent-label" style="color: ${textColor};">${percent}%</span>
    </div>
  `;
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
    
    triggerNotification(`User ${email} successfully created with role ${role}!`, true);
    return { success: true, uid: user.uid };
  } catch (error) {
    console.error("Error creating user:", error);
    let errorMessage = "Failed to create user: ";
    if (error.code === 'auth/email-already-in-use') {
      errorMessage += "Email already registered!";
    } else if (error.code === 'auth/invalid-email') {
      errorMessage += "Invalid email format!";
    } else if (error.code === 'auth/weak-password') {
      errorMessage += "Password too weak! Minimum 6 characters.";
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
    triggerNotification(`User role updated to ${newRole}!`, true);
    return { success: true };
  } catch (error) {
    console.error("Error updating user role:", error);
    triggerNotification("Failed to update user role!", false, 'error');
    return { success: false };
  }
}

async function resetUserPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    triggerNotification(`Password reset email sent to ${email}.`, true, 'info');
    return { success: true };
  } catch (error) {
    console.error("Error resetting password:", error);
    triggerNotification("Failed to reset password: " + error.message, false, 'error');
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
    triggerNotification(`User ${email} has been removed from database.`, true, 'info');
    return { success: true };
  } catch (error) {
    console.error("Error deleting user:", error);
    triggerNotification("Failed to delete user!", false, 'error');
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
    
    // Sinkronisasi data ulang jika pop-up monitoring sedang terbuka aktif
    const detailsModal = document.getElementById('monitoringDetailsModal');
    if (detailsModal && detailsModal.classList.contains('active') && currentSelectedProjectId) {
      refreshMonitoringDetailsModalContent(currentSelectedProjectId);
    }
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
    users = data ? Object.keys(data).map(k => ({id: k, ...data[k]})) : [];
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
  populateDropdownMenus();
}

function populateDropdownMenus() {
  const upSel = document.getElementById('uploadProjectSelect');
  if (upSel) {
    const valBackup = upSel.value;
    upSel.innerHTML = '<option value="">-- Select Target Project --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (valBackup) upSel.value = valBackup;
  }
  
  const repSel = document.getElementById('reportProjectFilterSelect');
  if (repSel) {
    const repBackup = repSel.value;
    repSel.innerHTML = '<option value="">-- Pilih Project Mandiri --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (repBackup) repSel.value = repBackup;
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
      <div class="card"><h3>Active Projects</h3><p>${projects.length}</p></div>
      <div class="card"><h3>Total Budget</h3><p>${formatRp(totalPaguGlobal)}</p></div>
      <div class="card"><h3>Total Realization</h3><p>${formatRp(totalRealisasiGlobal)}</p></div>
      <div class="card"><h3>Over Budget Items</h3><p style="color:#ef4444">${overCount}</p></div>
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
        <td><button class="btn btn-danger btn-del-proj" style="padding: 4px 12px; border-radius:12px; font-size:0.75rem;" data-id="${p.id}"><i class="fas fa-trash"></i> Delete</button></td>
       </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-del-proj').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (confirm('Delete master project and all its RAB items?')) {
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
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748b;">Please select a project filter first.</td></tr>';
    return;
  }

  const filtered = rabItems.filter(i => i.projectId === currentSelectedProjectId);
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748b;">No RAB items in this project.</td></tr>';
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
       if (confirm('Delete this RAB budget item?')) {
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
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94a3b8;">No users registered.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => {
    let roleBadgeClass = u.role === 'Administrator' ? 'badge-danger' : (u.role === 'Finance' ? 'badge-warning' : 'badge-success');
    const isCurrentUser = (currentUserEmail === u.email);
    
    return `<tr>
      <td><strong>${u.email}</strong> ${isCurrentUser ? '<span class="badge badge-info">(You)</span>' : ''}</td>
      <td><span class="badge ${roleBadgeClass}">${u.role}</span></td>
      <td style="font-size:0.7rem; color:#64748b; font-family: monospace;">${u.id ? u.id.substring(0, 12) + '...' : '-'}</td>
      <td>${u.createdAt || '-'}</td>
      <td class="action-buttons">
        ${currentRole === 'Administrator' ? `
          ${!isCurrentUser ? `
            <button class="btn-edit" data-uid="${u.id}" data-email="${u.email}" data-role="${u.role}"><i class="fas fa-edit"></i> Edit Role</button>
            <button class="btn-reset" data-uid="${u.id}" data-email="${u.email}"><i class="fas fa-key"></i> Reset Pass</button>
            <button class="btn-delete" data-uid="${u.id}" data-email="${u.email}"><i class="fas fa-trash"></i> Delete</button>
          ` : `<span class="badge badge-secondary"><i class="fas fa-user-shield"></i> Your Account</span>`}
        ` : `<span class="badge badge-secondary">Admin Only</span>`}
       </td>
    </tr>`;
  }).join('');

  if (currentRole === 'Administrator') {
    tbody.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        openEditUserModal(btn.getAttribute('data-uid'), btn.getAttribute('data-email'), btn.getAttribute('data-role'));
      });
    });
    tbody.querySelectorAll('.btn-reset').forEach(btn => {
      btn.addEventListener('click', () => {
        openResetPasswordModal(btn.getAttribute('data-uid'), btn.getAttribute('data-email'));
      });
    });
    tbody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const email = btn.getAttribute('data-email');
        if (confirm(`Are you sure you want to delete user ${email}?`)) {
          await deleteUserAccount(btn.getAttribute('data-uid'), email);
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
  
  title.innerHTML = '<i class="fas fa-user-edit"></i> Edit User Role';
  emailInput.value = email;
  emailInput.disabled = true;
  if (passwordFieldGroup) passwordFieldGroup.style.display = 'none';
  roleSelect.value = currentRoleUser;
  editUserId.value = uid;
  
  saveBtn.onclick = async () => {
    const newRole = roleSelect.value;
    if (newRole !== currentRoleUser) {
      await updateUserRole(uid, newRole);
    }
    modal.classList.remove('active');
    emailInput.disabled = false;
    emailInput.value = '';
    if (passwordFieldGroup) passwordFieldGroup.style.display = 'block';
    editUserId.value = '';
    title.innerHTML = '<i class="fas fa-user-plus"></i> Add New User';
    saveBtn.onclick = saveNewUser;
  };
  modal.classList.add('active');
}

function openResetPasswordModal(uid, email) {
  const modal = document.getElementById('resetPasswordModal');
  document.getElementById('resetUserEmail').value = email;
  document.getElementById('confirmResetPasswordBtn').onclick = async () => {
    await resetUserPassword(email);
    modal.classList.remove('active');
  };
  modal.classList.add('active');
}

async function saveNewUser() {
  const email = document.getElementById('modalUserEmail').value.trim().toLowerCase();
  let password = document.getElementById('modalUserPassword').value;
  const role = document.getElementById('modalRole').value;
  if (!email) { triggerNotification('Email is required!', false, 'error'); return; }
  if (users.find(u => u.email === email)) { triggerNotification('Email already registered!', false, 'error'); return; }
  if (!password) password = 'password123';
  if (password.length < 6) { triggerNotification('Password must be at least 6 characters!', false, 'error'); return; }
  
  const result = await createNewUser(email, password, role);
  if (result.success) {
    document.getElementById('userModal').classList.remove('active');
    document.getElementById('modalUserEmail').value = '';
    document.getElementById('modalUserPassword').value = '';
  }
}

// ==================== EVENT LISTENERS SETUP ====================
document.getElementById('filterProjectRAB')?.addEventListener('change', (e) => {
  currentSelectedProjectId = e.target.value;
  renderRABItemsSubTable();
});

document.getElementById('saveProjectBtn')?.addEventListener('click', () => {
  const name = document.getElementById('modalProjectName').value.trim();
  const client = document.getElementById('modalClientName').value.trim();
  const totalBudget = parseFloat(document.getElementById('modalBudget').value) || 0;

  if (!name || !client || totalBudget <= 0) { triggerNotification('Please fill all form fields correctly!', false); return; }

  const newProjectRef = push(ref(db, 'projects'));
  set(newProjectRef, { name, client, totalBudget }).then(() => {
    document.getElementById('projectModal').classList.remove('active');
    document.getElementById('modalProjectName').value = '';
    document.getElementById('modalClientName').value = '';
    document.getElementById('modalBudget').value = '';
    triggerNotification('Master project added successfully!');
  });
});

document.getElementById('openRABModalBtn')?.addEventListener('click', () => {
  if (!currentSelectedProjectId) { triggerNotification('Please select a project filter first!', false); return; }
  const currentProj = projects.find(p => p.id === currentSelectedProjectId);
  document.getElementById('rabModalProjectName').value = currentProj ? currentProj.name : '';
  document.getElementById('rabItemName').value = '';
  document.getElementById('rabBudget').value = '';
  document.getElementById('rabModal').classList.add('active');
});

document.getElementById('saveRabBtn')?.addEventListener('click', () => {
  const itemName = document.getElementById('rabItemName').value.trim();
  const budget = parseFloat(document.getElementById('rabBudget').value) || 0;

  if (!itemName || budget <= 0) { triggerNotification('Please fill item name and budget correctly!', false); return; }

  const newRabRef = push(ref(db, 'rabItems'));
  set(newRabRef, {
    projectId: currentSelectedProjectId,
    itemName,
    budget,
    realisasi: 0,
    progressKerja: 0 // Inisialisasi progress pengerjaan riil awal = 0%
  }).then(() => {
    document.getElementById('rabModal').classList.remove('active');
    triggerNotification('RAB component item saved successfully!');
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
    container.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:10px;">Belum ada item klaim. Klik Tambah Baris Transaksi.</div>';
    return;
  }

  container.innerHTML = claimItemsListArray.map((item, idx) => `
    <div class="item-row">
      <button type="button" class="remove-item" data-idx="${idx}"><i class="fas fa-times"></i></button>
      
      <div class="item-row-grid">
        <div>
          <select data-idx="${idx}" class="item-sel-node">
            <option value="">-- Pilih Komponen RAB --</option>
            ${availableItems.map(av => `<option value="${av.id}" ${item.itemId === av.id ? 'selected':''}>${av.itemName} (Sisa: ${formatRp(av.budget - av.realisasi)})</option>`).join('')}
          </select>
        </div>
        <div>
          <input type="number" data-idx="${idx}" class="item-nom-node" placeholder="Nominal (IDR)" value="${item.nominal || ''}" />
        </div>
      </div>

      <div class="item-row-subgrid">
        <div>
          <input type="text" data-idx="${idx}" class="item-vendor-node" placeholder="Vendor / Supplier" value="${item.vendor || ''}" />
        </div>
        <div>
          <input type="date" data-idx="${idx}" class="item-date-node" value="${item.tanggal || ''}" />
        </div>
        <div>
          <input type="text" data-idx="${idx}" class="item-notes-node" placeholder="Catatan Pengeluaran / Keterangan" value="${item.desc || ''}" />
        </div>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.item-sel-node').forEach(sel => {
    sel.addEventListener('change', (e) => {
      claimItemsListArray[parseInt(sel.dataset.idx)].itemId = e.target.value;
    });
  });
  container.querySelectorAll('.item-nom-node').forEach(inp => {
    inp.addEventListener('input', (e) => {
      claimItemsListArray[parseInt(inp.dataset.idx)].nominal = parseFloat(e.target.value) || 0;
    });
  });
  container.querySelectorAll('.item-vendor-node').forEach(vInp => {
    vInp.addEventListener('input', (e) => {
      claimItemsListArray[parseInt(vInp.dataset.idx)].vendor = e.target.value;
    });
  });
  container.querySelectorAll('.item-date-node').forEach(dInp => {
    dInp.addEventListener('change', (e) => {
      claimItemsListArray[parseInt(dInp.dataset.idx)].tanggal = e.target.value;
    });
  });
  container.querySelectorAll('.item-notes-node').forEach(nInp => {
    nInp.addEventListener('input', (e) => {
      claimItemsListArray[parseInt(nInp.dataset.idx)].desc = e.target.value;
    });
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
    selectPr.innerHTML = '<option value="">-- Select Project --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (backupSelectedVal) selectPr.value = backupSelectedVal;
  }

  const historyBody = document.getElementById('historyClaimBody');
  if (historyBody) {
    historyBody.innerHTML = claims.map(c => {
      const p = projects.find(pr => pr.id === c.projectId);
      const summaries = c.items ? c.items.map(ci => {
        const r = rabItems.find(rab => rab.id === ci.itemId);
        return `• <strong>${r ? r.itemName : 'Komponen'}</strong>: ${formatRp(ci.nominal)} <br><small style="color:#64748b;">(Vendor: ${ci.vendor || '-'} | Tgl: ${ci.tanggal || '-'} | Ket: ${ci.desc || '-'})</small>`;
      }).join('<br>') : '-';
      
      let classBadge = c.status === 'approved' ? 'badge-success' : (c.status === 'rejected' ? 'badge-danger' : 'badge-warning');
      return `<tr>
        <td><strong>${p ? p.name : 'Unknown'}</strong></td>
        <td style="font-size:0.8rem; color:#475569; line-height: 1.4;">${summaries}</td>
        <td style="font-weight:700;">${formatRp(c.totalNominal)}</td>
        <td><span class="badge ${classBadge}">${c.status}</span></td>
      </tr>`;
    }).join('');
  }
}

document.getElementById('claimProjectSelect')?.addEventListener('change', () => {
  claimItemsListArray = [];
  renderClaimItemsBuildLayout();
});

document.getElementById('addItemBtn')?.addEventListener('click', () => {
  if (!document.getElementById('claimProjectSelect').value) {
    triggerNotification('Silakan tentukan entity project target dahulu!', false, 'error');
    return;
  }
  claimItemsListArray.push({ itemId: '', nominal: 0, vendor: '', tanggal: '', desc: '' });
  renderClaimItemsBuildLayout();
});

document.getElementById('submitClaimMainBtn')?.addEventListener('click', () => {
  const projectId = document.getElementById('claimProjectSelect').value;
  const validItems = claimItemsListArray.filter(it => it.itemId && it.nominal > 0 && it.vendor && it.tanggal);

  if (!projectId || validItems.length === 0) {
    triggerNotification('Lengkapi minimal satu detail item (Komponen, Nominal, Vendor, & Tanggal)!', false, 'error');
    return;
  }

  const totalNominal = validItems.reduce((sum, i) => sum + i.nominal, 0);
  const newClaimRef = push(ref(db, 'claims'));
  set(newClaimRef, {
    projectId,
    status: 'pending',
    totalNominal,
    items: validItems,
    timestamp: Date.now()
  }).then(() => {
    claimItemsListArray = [];
    document.getElementById('claimProjectSelect').value = "";
    renderClaimItemsBuildLayout();
    triggerNotification('Pengajuan klaim anggaran modular berhasil di-submit!');
  });
});

// ==================== BUDGET APPROVAL CORE SYSTEM ====================
function renderApprovalList() {
  const tbody = document.getElementById('approvalTableBody');
  if (!tbody) return;

  const pendingClaims = claims.filter(c => c.status === 'pending');
  if (pendingClaims.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748b;">No pending budget requests currently.</td></tr>';
    return;
  }

  tbody.innerHTML = pendingClaims.map(c => {
    const p = projects.find(pr => pr.id === c.projectId);
    const splitDetails = c.items ? c.items.map(ci => {
      const r = rabItems.find(rab => rab.id === ci.itemId);
      return `• <strong>${r ? r.itemName : 'Komponen'}</strong>: ${formatRp(ci.nominal)}<br><small style="color:#64748b;">(Vendor: ${ci.vendor || '-'} | Notes: ${ci.desc || '-'})</small>`;
    }).join('<br>') : '-';

    return `<tr>
      <td><strong>${p ? p.name : 'Unknown'}</strong></td>
      <td style="font-size:0.8rem; line-height:1.4;">${splitDetails}</td>
      <td style="font-weight:700; color:#1e1b4b;">${formatRp(c.totalNominal)}</td>
      <td><span class="badge badge-warning">Awaiting Auth</span></td>
      <td>
        <div class="action-buttons">
          <button class="btn-edit btn-appr-ok" style="background:#d1fae5; color:#065f46;" data-id="${c.id}"><i class="fas fa-check"></i> Approve</button>
          <button class="btn-delete btn-appr-no" style="background:#fee2e2; color:#991b1b;" data-id="${c.id}"><i class="fas fa-times"></i> Reject</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.btn-appr-ok').forEach(btn => {
    btn.addEventListener('click', () => executeApprovalCommand(btn.getAttribute('data-id'), true));
  });
  tbody.querySelectorAll('.btn-appr-no').forEach(btn => {
    btn.addEventListener('click', () => executeApprovalCommand(btn.getAttribute('data-id'), false));
  });
}

async function executeApprovalCommand(claimId, isApproved) {
  const claimObj = claims.find(c => c.id === claimId);
  if (!claimObj) return;

  if (isApproved) {
    if (claimObj.items) {
      for (let item of claimObj.items) {
        const matchedRab = rabItems.find(r => r.id === item.itemId);
        if (matchedRab) {
          const currentReal = parseFloat(matchedRab.realisasi) || 0;
          await update(ref(db, `rabItems/${matchedRab.id}`), {
            realisasi: currentReal + parseFloat(item.nominal)
          });
        }
      }
    }
    await update(ref(db, `claims/${claimId}`), { status: 'approved' });
    triggerNotification('Claim transaction approved & cloud records adjusted.');
  } else {
    await update(ref(db, `claims/${claimId}`), { status: 'rejected' });
    triggerNotification('Claim transaction rejected successfully.', false, 'error');
  }
}

// ==================== MONITORING MODULE ====================
function renderMonitoringTable() {
  const tbody = document.getElementById('monitoringMainGridBody');
  if (!tbody) return;

  tbody.innerHTML = projects.map(p => {
    const subItems = rabItems.filter(i => i.projectId === p.id);
    const totalSpent = subItems.reduce((sum, i) => sum + (parseFloat(i.realisasi) || 0), 0);
    const isOver = subItems.some(i => i.realisasi > i.budget);
    
    let statusBadge = '<span class="badge badge-success">Healthy</span>';
    if (totalSpent > p.totalBudget || isOver) {
      statusBadge = '<span class="badge badge-danger">Critical Leak</span>';
    } else if (p.totalBudget > 0 && (totalSpent / p.totalBudget) >= 0.88) {
      statusBadge = '<span class="badge badge-warning">Attention Needed</span>';
    }

    return `<tr class="project-row" data-id="${p.id}">
      <td><a class="project-name-link" href="#"><i class="fas fa-folder text-indigo-500"></i> ${p.name}</a></td>
      <td>${p.client}</td>
      <td style="font-weight:600;">${formatRp(p.totalBudget)}</td>
      <td style="color:#2563eb; font-weight:700;">${formatRp(totalSpent)}</td>
      <td>${statusBadge}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.project-row').forEach(row => {
    row.addEventListener('click', (e) => {
      e.preventDefault();
      currentSelectedProjectId = row.getAttribute('data-id');
      openMonitoringDetailsPopup(currentSelectedProjectId);
    });
  });
}

function openMonitoringDetailsPopup(projectId) {
  const targetProj = projects.find(p => p.id === projectId);
  if (!targetProj) return;

  document.getElementById('modalDetailsProjectName').innerText = targetProj.name;
  refreshMonitoringDetailsModalContent(projectId);
  document.getElementById('monitoringDetailsModal').classList.add('active');
}

// Fungsi Terpisah untuk Refresh Content Modal Detail Saat Terjadi Realtime Input
function refreshMonitoringDetailsModalContent(projectId) {
  const gridBody = document.getElementById('modalDetailsComponentsTableGridBody');
  if (!gridBody) return;

  const items = rabItems.filter(i => i.projectId === projectId);

  if (items.length === 0) {
    gridBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748b;">No components allocated inside this project context.</td></tr>';
    return;
  }

  gridBody.innerHTML = items.map(i => {
    const balance = i.budget - i.realisasi;
    // Menggunakan progressKerja dari database, default ke 0 jika belum diisi manual
    const currentProgressValue = i.progressKerja !== undefined ? i.progressKerja : 0;
    const progressMarkup = createProgressBarMarkup(currentProgressValue, i.id);

    return `<tr>
      <td><strong>${i.itemName}</strong></td>
      <td>${formatRp(i.budget)}</td>
      <td style="color:#2563eb; font-weight:600;">${formatRp(i.realisasi)}</td>
      <td style="font-weight:600; color:${balance < 0 ? '#ef4444':'#10b981'};">${formatRp(balance)}</td>
      <td>${getBadge(i.realisasi, i.budget)}</td>
      <td>${progressMarkup}</td>
    </tr>`;
  }).join('');

  // Menambahkan Event Listener "change" pada Input Manual Progress Persentase Kerja Terbimbing
  gridBody.querySelectorAll('.input-progress-inline').forEach(input => {
    input.addEventListener('change', async (e) => {
      const rabItemId = input.getAttribute('data-id');
      let updatedValue = parseInt(e.target.value) || 0;
      
      if (updatedValue < 0) updatedValue = 0;
      if (updatedValue > 100) updatedValue = 100;
      
      // Update Nilai Progress Fisik Pengerjaan Riil Secara Langsung Ke Firebase Cluster Node
      await update(ref(db, `rabItems/${rabItemId}`), {
        progressKerja: updatedValue
      });
      
      triggerNotification(`Progress Kerja Berhasil Diperbarui Ke ${updatedValue}%!`, true, 'success');
    });
  });
}

// ==================== REPORTS MODULE (REFACTORED TO SINGLE PROJECT ANALYTICS & DETAILED CURVE) ====================
function renderReports() {
  const filterSelect = document.getElementById('reportProjectFilterSelect'); //
  if (!filterSelect) return;
  
  const selectedProjId = filterSelect.value; //
  const tbody = document.getElementById('reportsTableGridBody'); //
  
  // Jika tidak ada proyek yang dipilih, reset tampilan laporan ke kondisi kosong yang rapi
  if (!selectedProjId) { //
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; color:#64748b; padding: 24px; font-style: italic;">
          <i class="fas fa-chart-line" style="font-size: 1.5rem; display:block; margin-bottom: 8px; color: #94a3b8;"></i>
          Silakan pilih proyek di atas untuk menampilkan bagan rincian audit.
        </td>
      </tr>`; //
    document.getElementById('reportContainerProjectTitle').innerHTML = '<i class="fas fa-briefcase"></i> Ringkasan Eksekutif Finansial Proyek'; //
    document.getElementById('repStatTotalPagu').innerText = "Rp 0"; //
    document.getElementById('repStatTotalRealisasi').innerText = "Rp 0"; //
    document.getElementById('repStatSisaSaldo').innerText = "Rp 0"; //
    document.getElementById('repStatAvgProgress').innerText = "0%"; //
    destroyGraphicChartsIfExist(); //
    return;
  }

  const proj = projects.find(p => p.id === selectedProjId); //
  if (!proj) return;

  // Header judul dengan style info proyek yang bersih
  document.getElementById('reportContainerProjectTitle').innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px;">
      <i class="fas fa-briefcase" style="color: #4f46e5;"></i> 
      <span>Analisis Finansial Terbimbing: <strong style="color:#2563eb;">${proj.name}</strong></span> 
      <span class="badge badge-info" style="font-size:0.75rem; font-weight:400; padding: 4px 8px; border-radius: 6px;">Client: ${proj.client}</span>
    </div>
  `; //

  const relatedComponents = rabItems.filter(i => i.projectId === selectedProjId); //
  const aggregatePaguAllocated = relatedComponents.reduce((sum, i) => sum + (parseFloat(i.budget) || 0), 0); //
  const aggregateRealisasiFunds = relatedComponents.reduce((sum, i) => sum + (parseFloat(i.realisasi) || 0), 0); //
  
  // Hitung rata-rata progres berdasarkan total realisasi dana proyek
  let averageProgressCalculated = 0; //
  if (proj.totalBudget > 0) {
    averageProgressCalculated = Math.round((aggregateRealisasiFunds / proj.totalBudget) * 100);
  }

  // Bind Nilai Statistik Eksekutif Proyek
  document.getElementById('repStatTotalPagu').innerText = formatRp(proj.totalBudget); //
  document.getElementById('repStatTotalRealisasi').innerText = formatRp(aggregateRealisasiFunds); //
  
  const sisaSaldoSistem = proj.totalBudget - aggregateRealisasiFunds; //
  const sisaSaldoElement = document.getElementById('repStatSisaSaldo'); //
  sisaSaldoElement.innerText = formatRp(sisaSaldoSistem); //
  
  // Berikan warna dinamis (Merah jika over-budget, Hijau jika aman)
  if (sisaSaldoSistem < 0) {
    sisaSaldoElement.style.color = '#ef4444'; // Merah
    sisaSaldoElement.style.fontWeight = '700';
  } else {
    sisaSaldoElement.style.color = '#10b981'; // Hijau
    sisaSaldoElement.style.fontWeight = '700';
  }
  
  document.getElementById('repStatAvgProgress').innerText = `${averageProgressCalculated}%`; //

  // Kondisi jika komponen RAB proyek belum diinput
  if (relatedComponents.length === 0) { //
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; color:#94a3b8; padding: 24px;">
          <i class="fas fa-exclamation-triangle" style="display:block; margin-bottom: 8px; color: #f59e0b;"></i>
          Belum ada item breakdown teralokasi pada project ini.
        </td>
      </tr>`; //
    destroyGraphicChartsIfExist(); //
    return;
  }

  // Populasi baris tabel data audit ledger rincian komponen RAB
  tbody.innerHTML = relatedComponents.map(i => {
    const rem = i.budget - i.realisasi; //
    const itemPct = i.budget > 0 ? Math.round((i.realisasi / i.budget) * 100) : 0; //
    
    return `
      <tr style="transition: background 0.2s; &:hover { background-color: #f8fafc; }">
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;"><strong>${i.itemName}</strong></td> //
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; font-family: monospace;">${formatRp(i.budget)}</td> //
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; color:#2563eb; font-family: monospace;">${formatRp(i.realisasi)}</td> //
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; font-weight:600; font-family: monospace; color:${rem < 0 ? '#ef4444':'#10b981'}">
          ${formatRp(rem)}
        </td> //
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight:700; color:#475569; min-width: 40px;">${itemPct}%</span> //
            <div style="width: 100%; background-color: #e2e8f0; height: 6px; border-radius: 3px; overflow: hidden;">
              <div style="width: ${itemPct > 100 ? 100 : itemPct}%; background-color: ${rem < 0 ? '#ef4444' : itemPct >= 90 ? '#f59e0b' : '#10b981'}; height: 100%;"></div>
            </div>
          </div>
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">${getBadge(i.realisasi, i.budget)}</td> //
      </tr>`;
  }).join('');

  // Re-Inisialisasi sistem rendering diagram grafik Chart.js
  renderAdvancedGraphicReportCharts(relatedComponents); //
}

function destroyGraphicChartsIfExist() {
  if (lineCurveChartInstanceRef) { lineCurveChartInstanceRef.destroy(); lineCurveChartInstanceRef = null; } //
  if (pieShareChartInstanceRef) { pieShareChartInstanceRef.destroy(); pieShareChartInstanceRef = null; } //
}

function renderAdvancedGraphicReportCharts(components) {
  destroyGraphicChartsIfExist(); //

  // Batasi panjang string label agar layout chart tidak hancur atau bertabrakan
  const labels = components.map(c => c.itemName.length > 22 ? c.itemName.substring(0,20)+'...' : c.itemName); //
  const budgetDataset = components.map(c => c.budget); //
  const realisasiDataset = components.map(c => c.realisasi); //

  // 1. Pembuatan Line Area Chart (Kurva Alokasi Anggaran vs Realisasi Aktual)
  const lineCtx = document.getElementById('projectDistributionLineCurveChart')?.getContext('2d'); //
  if (lineCtx) {
    lineCurveChartInstanceRef = new Chart(lineCtx, { //
      type: 'line',
      data: {
        labels: labels, //
        datasets: [
          {
            label: 'Pagu Alokasi Anggaran', //
            data: budgetDataset, //
            borderColor: '#6366f1', //
            backgroundColor: 'rgba(99, 102, 241, 0.06)', //
            fill: true, //
            tension: 0.35, //
            borderWidth: 3, //
            pointBackgroundColor: '#6366f1' //
          },
          {
            label: 'Realisasi Pengeluaran Aktual', //
            data: realisasiDataset, //
            borderColor: '#2563eb', //
            backgroundColor: 'rgba(37, 99, 235, 0.12)', //
            fill: true, //
            tension: 0.35, //
            borderWidth: 3, //
            pointBackgroundColor: '#2563eb' //
          }
        ]
      },
      options: {
        responsive: true, //
        maintainAspectRatio: false, //
        plugins: {
          legend: { position: 'top', labels: { font: { weight: 600, family: 'Inter' } } }
        },
        scales: {
          y: { grid: { color: '#f1f5f9' }, ticks: { font: { family: 'Inter' } } }, //
          x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 11 } } } //
        }
      }
    });
  }

  // 2. Pembuatan Proportional Doughnut Chart (Komposisi Distribusi Biaya Aktual)
  const pieCtx = document.getElementById('projectCompositionPieShareChart')?.getContext('2d'); //
  if (pieCtx) {
    const pieColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6']; //
    const backgroundColorsGenerated = realisasiDataset.map((_, i) => pieColors[i % pieColors.length]); //

    pieShareChartInstanceRef = new Chart(pieCtx, { //
      type: 'doughnut',
      data: {
        labels: labels, //
        datasets: [{
          data: realisasiDataset.map(v => v === 0 ? 0.1 : v), // Cegah bug visual Chart.js jika bernilai nol
          backgroundColor: backgroundColorsGenerated, //
          borderWidth: 2 //
        }]
      },
      options: {
        responsive: true, //
        maintainAspectRatio: false, //
        plugins: {
          legend: { 
            position: 'right', 
            labels: { boxWidth: 12, font: { size: 10, family: 'Inter' } } //
          }
        }
      }
    });
  }
}

// ==================== DOCUMENT SYNC UPLOAD HANDLER ====================
document.getElementById('startUploadDocBtn')?.addEventListener('click', async () => {
  const pId = document.getElementById('uploadProjectSelect').value;
  const fileInput = document.getElementById('documentLocalFile');
  
  if (!pId || !fileInput.files || fileInput.files.length === 0) {
    triggerNotification('Complete file association targets correctly!', false, 'error');
    return;
  }

  const file = fileInput.files[0];
  const payloadData = {
    projectId: pId,
    fileName: file.name,
    fileSize: file.size,
    uploadedBy: currentUserEmail,
    timestamp: Date.now()
  };

  const newFileRef = push(ref(db, 'truenasFiles'));
  set(newFileRef, payloadData).then(() => {
     fileInput.value = "";
     document.getElementById('uploadProjectSelect').value = "";
     triggerNotification('Document entry registered in cloud cluster system!');
  });
});

// ==================== DOM SECTION ROUTER ARCHITECTURE ====================
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
        pageTitleElement.innerHTML = `<i class="${icon ? icon.className : 'fas fa-chart-pie'}"></i> ${li.innerText.trim()}`
      }
      
      const actionButtonContext = document.getElementById('globalActionBtn');
      if (actionButtonContext) {
        actionButtonContext.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
        actionButtonContext.onclick = () => updateWholeUI();
      }
      
      if (activePageKey === 'reports') {
        renderReports();
      }
   });
});

// Bind UI Close Trigger Event Modals
document.getElementById('closeProjectModalBtn')?.addEventListener('click', () => document.getElementById('projectModal').classList.remove('active'));
document.getElementById('openProjectModalBtn')?.addEventListener('click', () => document.getElementById('projectModal').classList.add('active'));
document.getElementById('closeRabModalBtn')?.addEventListener('click', () => document.getElementById('rabModal').classList.remove('active'));
document.getElementById('closeMonitoringDetailsModalBtn')?.addEventListener('click', () => {
  document.getElementById('monitoringDetailsModal').classList.remove('active');
  currentSelectedProjectId = null;
});
document.getElementById('openAddUserModalBtn')?.addEventListener('click', () => {
  document.getElementById('userModalTitle').innerHTML = '<i class="fas fa-user-plus"></i> Register System Identity User';
  document.getElementById('modalUserEmail').value = '';
  document.getElementById('modalUserEmail').disabled = false;
  document.getElementById('passwordFieldGroup').style.display = 'block';
  document.getElementById('saveUserBtn').onclick = saveNewUser;
  document.getElementById('userModal').classList.add('active');
});
document.getElementById('closeUserModalBtn')?.addEventListener('click', () => document.getElementById('userModal').classList.remove('active'));
document.getElementById('closeResetModalBtn')?.addEventListener('click', () => document.getElementById('resetPasswordModal').classList.remove('active'));

document.getElementById('logoutBtn')?.addEventListener('click', () => {
  signOut(auth).then(() => {
    window.location.reload();
  });
});

// ==================== AUTH PIPELINE INITIALIZATION ====================
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentAuthUser = user;
    currentUserEmail = user.email;
    currentUserUid = user.uid;
    
    ensureAdminUIDInDatabase(user);

    const userProfileRef = ref(db, `users/${user.uid}`);
    onValue(userProfileRef, (snapshot) => {
      const userData = snapshot.val();
      if (userData) {
        currentUserData = userData;
        currentRole = userData.role;
        
        const emailLabel = document.getElementById('sidebarUserEmail');
        const roleLabel = document.getElementById('sidebarUserRole');
        if (emailLabel) emailLabel.innerText = user.email;
        if (roleLabel) roleLabel.innerText = currentRole;

        enforceRoleVisibility();
        initCloudDatabaseListeners();
        hideLoadingScreen();
      } else {
        get(ref(db, `users/${user.uid}`)).then((snap) => {
          if(!snap.exists() && (user.email === 'admin@genetek.co.id')) {
             currentRole = "Administrator";
             enforceRoleVisibility();
             initCloudDatabaseListeners();
             hideLoadingScreen();
          }
        });
      }
    });
  } else {
    hideLoadingScreen();
    triggerNotification("No active cloud session found. Simulating sandbox pipeline gateway...", false, 'info');
    currentRole = "Administrator";
    currentUserEmail = "sandbox-pm@genetek.co.id";
    const emailLabel = document.getElementById('sidebarUserEmail');
    const roleLabel = document.getElementById('sidebarUserRole');
    if (emailLabel) emailLabel.innerText = currentUserEmail;
    if (roleLabel) roleLabel.innerText = currentRole;
    enforceRoleVisibility();
    initCloudDatabaseListeners();
  }
});

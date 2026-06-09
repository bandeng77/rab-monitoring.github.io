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

const rolePermissions = {
  "Administrator": ['dashboard', 'master-project', 'claim-request', 'approval-budget', 'monitoring', 'reports', 'upload-document', 'files', 'user-management'],
  "Finance": ['dashboard', 'approval-budget', 'claim-request', 'reports', 'upload-document', 'files'],
  "Project Manager": ['dashboard', 'master-project', 'claim-request', 'monitoring', 'upload-document', 'files']
};

// Chart instances
let currentChart = null;
let currentPieChart = null;
let currentBarChart = null;

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

// Progress Bar Render Utility
function createProgressBarMarkup(real, budget) {
  let percent = 0;
  if (budget > 0) {
    percent = Math.round((real / budget) * 100);
  }
  if (percent > 100) percent = 100;
  
  let barColor = '#10b981';
  if (percent >= 90) barColor = '#f59e0b';
  if (real > budget) barColor = '#ef4444';

  const rawPercentageNum = budget > 0 ? Math.round((real / budget) * 100) : 0;

  return `
    <div class="progress-wrapper">
      <div class="progress-bar-container">
        <div class="progress-bar-fill" style="width: ${percent}%; background-color: ${barColor};"></div>
      </div>
      <span class="progress-percent-label">${rawPercentageNum}%</span>
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
  // Populate Upload Project Select
  const upSel = document.getElementById('uploadProjectSelect');
  if (upSel) {
    const valBackup = upSel.value;
    upSel.innerHTML = '<option value="">-- Select Target Project --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (valBackup) upSel.value = valBackup;
  }
  
  // Populate Report Project Filter Select
  const repSel = document.getElementById('reportProjectFilterSelect');
  if (repSel) {
    const repBackup = repSel.value;
    repSel.innerHTML = '<option value="">-- Pilih Project --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (repBackup) repSel.value = repBackup;
    // Trigger renderReports when selection changes
    repSel.onchange = () => renderReports();
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
      return `<tr>
        <td>${p ? p.name : 'Unassigned'}</td>
        <td>${i.itemName}</td>
        <td>${formatRp(i.budget)}</td>
        <td>${formatRp(i.realisasi)}</td>
        <td>${getBadge(i.realisasi, i.budget)}</td>
      </tr>`;
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
    tbody.innerHTML = '<td><td colspan="5" style="text-align:center; color:#94a3b8;">No users registered.</td></tr>';
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
    realisasi: 0
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
      openMonitoringDetailsPopup(row.getAttribute('data-id'));
    });
  });
}

function openMonitoringDetailsPopup(projectId) {
  const targetProj = projects.find(p => p.id === projectId);
  if (!targetProj) return;

  const projectNameElem = document.getElementById('modalDetailsProjectName');
  if (projectNameElem) projectNameElem.innerText = targetProj.name;
  
  const gridBody = document.getElementById('modalDetailsComponentsTableGridBody');
  const items = rabItems.filter(i => i.projectId === projectId);

  if (gridBody) {
    if (items.length === 0) {
      gridBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748b;">No components allocated inside this project context.</td></tr>';
    } else {
      gridBody.innerHTML = items.map(i => {
        const balance = i.budget - i.realisasi;
        const progressMarkup = createProgressBarMarkup(i.realisasi, i.budget);

        return `<tr>
          <td><strong>${i.itemName}</strong></td>
          <td>${formatRp(i.budget)}</td>
          <td style="color:#2563eb; font-weight:600;">${formatRp(i.realisasi)}</td>
          <td style="font-weight:600; color:${balance < 0 ? '#ef4444':'#10b981'};">${formatRp(balance)}</td>
          <td>${getBadge(i.realisasi, i.budget)}</td>
          <td>${progressMarkup}</td>
        </tr>`;
      }).join('');
    }
  }

  const modal = document.getElementById('monitoringDetailsModal');
  if (modal) modal.classList.add('active');
}

// ==================== REPORTS MODULE WITH DETAILED CHARTS ====================
function destroyCharts() {
  if (currentChart) {
    currentChart.destroy();
    currentChart = null;
  }
  if (currentPieChart) {
    currentPieChart.destroy();
    currentPieChart = null;
  }
  if (currentBarChart) {
    currentBarChart.destroy();
    currentBarChart = null;
  }
}

function renderReports() {
  const filterSelect = document.getElementById('reportProjectFilterSelect');
  if (!filterSelect) return;
  
  const selectedProjId = filterSelect.value;
  const tbody = document.getElementById('reportsTableGridBody');
  const containerTitle = document.getElementById('reportContainerProjectTitle');
  const statTotalPagu = document.getElementById('repStatTotalPagu');
  const statTotalRealisasi = document.getElementById('repStatTotalRealisasi');
  const statSisaSaldo = document.getElementById('repStatSisaSaldo');
  const statAvgProgress = document.getElementById('repStatAvgProgress');
  const statOverBudget = document.getElementById('repStatOverBudget');
  const statNearLimit = document.getElementById('repStatNearLimit');
  const statSafe = document.getElementById('repStatSafe');
  
  if (!selectedProjId) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748b;">Silakan pilih proyek di atas untuk menampilkan bagan rincian audit.<tr></tr>';
    if (containerTitle) containerTitle.innerHTML = '<i class="fas fa-briefcase"></i> Ringkasan Eksekutif Finansial Proyek';
    if (statTotalPagu) statTotalPagu.innerText = "Rp 0";
    if (statTotalRealisasi) statTotalRealisasi.innerText = "Rp 0";
    if (statSisaSaldo) statSisaSaldo.innerText = "Rp 0";
    if (statAvgProgress) statAvgProgress.innerText = "0%";
    if (statOverBudget) statOverBudget.innerText = "0";
    if (statNearLimit) statNearLimit.innerText = "0";
    if (statSafe) statSafe.innerText = "0";
    destroyCharts();
    return;
  }

  const proj = projects.find(p => p.id === selectedProjId);
  if (!proj) return;

  if (containerTitle) {
    containerTitle.innerHTML = `<i class="fas fa-briefcase"></i> Analisis Finansial Terbimbing: <span style="color:#2563eb;">${proj.name}</span> <small style="font-size:0.8rem; color:#64748b; font-weight:400;">(${proj.client})</small>`;
  }

  const relatedComponents = rabItems.filter(i => i.projectId === selectedProjId);
  const aggregatePaguAllocated = relatedComponents.reduce((sum, i) => sum + (parseFloat(i.budget) || 0), 0);
  const aggregateRealisasiFunds = relatedComponents.reduce((sum, i) => sum + (parseFloat(i.realisasi) || 0), 0);
  
  let averageProgressCalculated = 0;
  if (aggregatePaguAllocated > 0) {
    averageProgressCalculated = Math.round((aggregateRealisasiFunds / aggregatePaguAllocated) * 100);
  }

  const overBudgetCount = relatedComponents.filter(i => i.realisasi > i.budget).length;
  const nearLimitCount = relatedComponents.filter(i => i.budget > 0 && (i.realisasi / i.budget) >= 0.9 && i.realisasi <= i.budget).length;
  const safeCount = relatedComponents.filter(i => i.budget > 0 && (i.realisasi / i.budget) < 0.9 && i.realisasi <= i.budget).length;

  if (statTotalPagu) statTotalPagu.innerText = formatRp(proj.totalBudget);
  if (statTotalRealisasi) statTotalRealisasi.innerText = formatRp(aggregateRealisasiFunds);
  if (statSisaSaldo) {
    statSisaSaldo.innerText = formatRp(proj.totalBudget - aggregateRealisasiFunds);
    statSisaSaldo.style.color = (proj.totalBudget - aggregateRealisasiFunds) < 0 ? '#ef4444' : '#10b981';
  }
  if (statAvgProgress) statAvgProgress.innerText = `${averageProgressCalculated}%`;
  if (statOverBudget) statOverBudget.innerText = overBudgetCount;
  if (statNearLimit) statNearLimit.innerText = nearLimitCount;
  if (statSafe) statSafe.innerText = safeCount;

  if (relatedComponents.length === 0) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">Belum ada item breakdown teralokasi pada project ini.<tr></tr>';
    destroyCharts();
    return;
  }

  // Populate Grid Representation
  if (tbody) {
    tbody.innerHTML = relatedComponents.map(i => {
      const rem = i.budget - i.realisasi;
      const itemPct = i.budget > 0 ? Math.round((i.realisasi / i.budget) * 100) : 0;
      return `<tr>
        <td><strong>${i.itemName}</strong></td>
        <td>${formatRp(i.budget)}</td>
        <td>${formatRp(i.realisasi)}</td>
        <td style="font-weight:600; color:${rem < 0 ? '#ef4444':'#10b981'}">${formatRp(rem)}</td>
        <td style="font-weight:700; color:#475569;">${itemPct}%</td>
        <td>${getBadge(i.realisasi, i.budget)}</td>
      </tr>`;
    }).join('');
  }

  // Create Detailed Charts
  createDetailedCharts(relatedComponents, proj);
}

function createDetailedCharts(components, project) {
  // Destroy existing charts
  destroyCharts();

  const chartCanvas = document.getElementById('reportChartCanvas');
  const pieCanvas = document.getElementById('reportPieChartCanvas');
  const barCanvas = document.getElementById('reportBarChartCanvas');

  if (!chartCanvas || !pieCanvas || !barCanvas) return;

  const ctx = chartCanvas.getContext('2d');
  const pieCtx = pieCanvas.getContext('2d');
  const barCtx = barCanvas.getContext('2d');

  // Sort components by budget for better visualization
  const sortedComponents = [...components].sort((a, b) => b.budget - a.budget);
  const labels = sortedComponents.map(c => c.itemName.length > 20 ? c.itemName.substring(0, 17) + '...' : c.itemName);
  const budgetData = sortedComponents.map(c => c.budget);
  const realizationData = sortedComponents.map(c => c.realisasi);

  // Bar Chart - Budget vs Realization
  currentChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Budget (Rp)',
          data: budgetData,
          backgroundColor: 'rgba(54, 162, 235, 0.7)',
          borderColor: 'rgba(54, 162, 235, 1)',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: 'Realization (Rp)',
          data: realizationData,
          backgroundColor: 'rgba(255, 99, 132, 0.7)',
          borderColor: 'rgba(255, 99, 132, 1)',
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'top',
          labels: { font: { size: 12 } }
        },
        title: {
          display: true,
          text: `Budget vs Realization Comparison - ${project.name}`,
          font: { size: 14, weight: 'bold' }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              if (context.parsed.y !== null) {
                label += formatRp(context.parsed.y);
              }
              return label;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return formatRp(value);
            }
          },
          title: {
            display: true,
            text: 'Amount (Rp)',
            font: { weight: 'bold' }
          }
        },
        x: {
          title: {
            display: true,
            text: 'Component Name',
            font: { weight: 'bold' }
          },
          ticks: {
            rotate: 45,
            maxRotation: 45,
            minRotation: 45,
            font: { size: 10 }
          }
        }
      }
    }
  });

  // Pie Chart - Budget Distribution
  const pieLabels = sortedComponents.map(c => c.itemName.length > 15 ? c.itemName.substring(0, 12) + '...' : c.itemName);
  const pieColors = [
    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40',
    '#FF6384', '#C9CBCF', '#4CAF50', '#FF5722', '#9C27B0', '#00BCD4'
  ];
  
  currentPieChart = new Chart(pieCtx, {
    type: 'pie',
    data: {
      labels: pieLabels,
      datasets: [{
        data: budgetData,
        backgroundColor: pieColors.slice(0, budgetData.length),
        borderWidth: 1,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'right',
          labels: { font: { size: 10 } }
        },
        title: {
          display: true,
          text: `Budget Distribution by Component - ${project.name}`,
          font: { size: 14, weight: 'bold' }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed || 0;
              const total = budgetData.reduce((a, b) => a + b, 0);
              const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
              return `${label}: ${formatRp(value)} (${percentage}%)`;
            }
          }
        }
      }
    }
  });

  // Bar Chart - Remaining Budget
  const remainingData = sortedComponents.map(c => Math.max(0, c.budget - c.realisasi));
  const overBudgetData = sortedComponents.map(c => Math.max(0, c.realisasi - c.budget));
  
  currentBarChart = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Remaining Budget (Rp)',
          data: remainingData,
          backgroundColor: 'rgba(75, 192, 192, 0.7)',
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: 'Over Budget (Rp)',
          data: overBudgetData,
          backgroundColor: 'rgba(255, 99, 132, 0.7)',
          borderColor: 'rgba(255, 99, 132, 1)',
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'top',
          labels: { font: { size: 12 } }
        },
        title: {
          display: true,
          text: `Budget Health Status - ${project.name}`,
          font: { size: 14, weight: 'bold' }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              if (context.parsed.y !== null) {
                label += formatRp(context.parsed.y);
              }
              return label;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return formatRp(value);
            }
          },
          title: {
            display: true,
            text: 'Amount (Rp)',
            font: { weight: 'bold' }
          }
        },
        x: {
          title: {
            display: true,
            text: 'Component Name',
            font: { weight: 'bold' }
          },
          ticks: {
            rotate: 45,
            maxRotation: 45,
            minRotation: 45,
            font: { size: 10 }
          }
        }
      }
    }
  });
}

// ==================== DOCUMENT PRINT EXPORT DRIVERS ====================
document.getElementById('printPdfReportBtn')?.addEventListener('click', () => {
  const currentFilterVal = document.getElementById('reportProjectFilterSelect')?.value;
  if (!currentFilterVal) { triggerNotification('Tentukan project target laporan dahulu!', false, 'error'); return; }
  
  const element = document.getElementById('printableReportAreaContainer');
  if (!element) {
    triggerNotification('Area laporan tidak ditemukan!', false, 'error');
    return;
  }
  
  const config = {
    margin: 10,
    filename: `RAB_Pro_Report_Project_${currentFilterVal}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  };
  html2pdf().set(config).from(element).save();
});

// ==================== HIERARCHICAL TREE ENGINE ====================
function renderTreeHierarchy() {
  const rootUl = document.getElementById('rootFileTreeDirectory');
  if (!rootUl) return;

  if (truenasFiles.length === 0) {
    rootUl.innerHTML = '<li style="color:#64748b; padding-left:10px;">No documents compiled in backup cluster stack.</li>';
    return;
  }

  let hierarchicalStructureMap = {};

  truenasFiles.forEach(file => {
    const associatedProject = projects.find(p => p.id === file.projectId);
    const projectNameString = associatedProject ? associatedProject.name : "Unsorted System Attachments";

    if (!hierarchicalStructureMap[projectNameString]) {
      hierarchicalStructureMap[projectNameString] = [];
    }
    hierarchicalStructureMap[projectNameString].push(file);
  });

  rootUl.innerHTML = `
    <li class="root-node"><i class="fas fa-network-wired"></i> Network NAS Storage File-System Root</li>
    ${Object.keys(hierarchicalStructureMap).map(folderName => `
      <li style="padding-left: 12px;">
        <div class="folder-node"><i class="fas fa-folder-open"></i> ${folderName}</div>
        <ul style="list-style-type:none; padding-left:12px;">
          ${hierarchicalStructureMap[folderName].map(f => `
            <li class="file-node">
              <i class="fas fa-file-invoice"></i>
              <span>${f.fileName} <small style="font-size:0.75rem; color:#64748b;">(${f.uploadedBy || 'System'})</small></span>
              <div class="action-links">
                <a class="preview-link" href="${API_BASE_URL}/preview/${f.fileId || f.id}" target="_blank"><i class="fas fa-external-link-alt"></i> View</a>
                ${currentRole === 'Administrator' ? `<button class="delete-file-btn" data-id="${f.id}"><i class="fas fa-trash"></i></button>` : ''}
              </div>
            </li>
          `).join('')}
        </ul>
      </li>
    `).join('')}
  `;

  rootUl.querySelectorAll('.delete-file-btn').forEach(btn => {
     btn.addEventListener('click', () => {
       const fId = btn.getAttribute('data-id');
       if (confirm('Erase selected file from network tracking clusters permanently?')) {
          remove(ref(db, `truenasFiles/${fId}`));
          triggerNotification('Document association scrubbed successfully.', true, 'info');
       }
     });
  });
}

// ==================== DOCUMENT SYNC UPLOAD HANDLER ====================
document.getElementById('startUploadDocBtn')?.addEventListener('click', async () => {
  const pId = document.getElementById('uploadProjectSelect')?.value;
  const fileInput = document.getElementById('documentLocalFile');
  
  if (!pId || !fileInput?.files || fileInput.files.length === 0) {
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
     if (document.getElementById('uploadProjectSelect')) {
       document.getElementById('uploadProjectSelect').value = "";
     }
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
        // Delay chart rendering to ensure canvas elements are visible
        setTimeout(() => renderReports(), 100);
      }
   });
});

// Bind UI Close Trigger Event Modals
document.getElementById('closeProjectModalBtn')?.addEventListener('click', () => document.getElementById('projectModal')?.classList.remove('active'));
document.getElementById('openProjectModalBtn')?.addEventListener('click', () => document.getElementById('projectModal')?.classList.add('active'));
document.getElementById('closeRabModalBtn')?.addEventListener('click', () => document.getElementById('rabModal')?.classList.remove('active'));
document.getElementById('closeMonitoringDetailsModalBtn')?.addEventListener('click', () => document.getElementById('monitoringDetailsModal')?.classList.remove('active'));
document.getElementById('openAddUserModalBtn')?.addEventListener('click', () => {
  const titleElem = document.getElementById('userModalTitle');
  if (titleElem) titleElem.innerHTML = '<i class="fas fa-user-plus"></i> Register System Identity User';
  const emailInput = document.getElementById('modalUserEmail');
  if (emailInput) {
    emailInput.value = '';
    emailInput.disabled = false;
  }
  const passwordGroup = document.getElementById('passwordFieldGroup');
  if (passwordGroup) passwordGroup.style.display = 'block';
  const saveBtn = document.getElementById('saveUserBtn');
  if (saveBtn) saveBtn.onclick = saveNewUser;
  const modal = document.getElementById('userModal');
  if (modal) modal.classList.add('active');
});
document.getElementById('closeUserModalBtn')?.addEventListener('click', () => document.getElementById('userModal')?.classList.remove('active'));
document.getElementById('closeResetModalBtn')?.addEventListener('click', () => document.getElementById('resetPasswordModal')?.classList.remove('active'));

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

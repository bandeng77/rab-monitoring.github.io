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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Global State
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

// Chart instances
let comparisonChart = null;
let pieChart = null;
let healthChart = null;

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

function createProgressBarMarkup(real, budget) {
  let percent = 0;
  if (budget > 0) {
    percent = Math.round((real / budget) * 100);
  }
  if (percent > 100) percent = 100;
  
  let barColor = '#10b981';
  if (percent >= 90) barColor = '#f59e0b';
  if (real > budget) barColor = '#ef4444';

  return `
    <div class="progress-wrapper">
      <div class="progress-bar-container">
        <div class="progress-bar-fill" style="width: ${percent}%; background-color: ${barColor};"></div>
      </div>
      <span class="progress-percent-label">${percent}%</span>
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
  const upSel = document.getElementById('uploadProjectSelect');
  if (upSel) {
    const valBackup = upSel.value;
    upSel.innerHTML = '<option value="">-- Select Target Project --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (valBackup) upSel.value = valBackup;
  }
  
  const repSel = document.getElementById('reportProjectFilterSelect');
  if (repSel) {
    const repBackup = repSel.value;
    repSel.innerHTML = '<option value="">-- Pilih Project --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (repBackup && projects.find(p => p.id === repBackup)) repSel.value = repBackup;
    repSel.onchange = () => renderReports();
  }
  
  const filterRAB = document.getElementById('filterProjectRAB');
  if (filterRAB) {
    const prevVal = filterRAB.value;
    filterRAB.innerHTML = '<option value="">-- Filter Master Project --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (prevVal) filterRAB.value = prevVal;
  }
  
  const claimSel = document.getElementById('claimProjectSelect');
  if (claimSel) {
    const oldVal = claimSel.value;
    claimSel.innerHTML = '<option value="">-- Select Project --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (oldVal) claimSel.value = oldVal;
  }
}

// ==================== DASHBOARD ====================
function renderDashboard() {
  const totalPagu = projects.reduce((sum, p) => sum + (parseFloat(p.totalBudget) || 0), 0);
  const totalReal = rabItems.reduce((sum, i) => sum + (parseFloat(i.realisasi) || 0), 0);
  const overCount = rabItems.filter(i => i.realisasi > i.budget).length;
  
  const cardsContainer = document.getElementById('cardsContainer');
  if (cardsContainer) {
    cardsContainer.innerHTML = `
      <div class="card"><h3>Active Projects</h3><p>${projects.length}</p></div>
      <div class="card"><h3>Total Budget</h3><p>${formatRp(totalPagu)}</p></div>
      <div class="card"><h3>Total Realization</h3><p>${formatRp(totalReal)}</p></div>
      <div class="card"><h3>Over Budget Items</h3><p style="color:#ef4444">${overCount}</p></div>
    `;
  }
  
  const tbody = document.getElementById('monitoringBody');
  if (tbody) {
    const limited = [...rabItems].sort((a,b) => b.budget - a.budget).slice(0, 6);
    tbody.innerHTML = limited.map(i => {
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

// ==================== MASTER PROJECT ====================
function renderMasterProject() {
  const tbody = document.getElementById('masterProjectBody');
  if (tbody) {
    tbody.innerHTML = projects.map(p => {
      const totalAllocated = rabItems.filter(i => i.projectId === p.id).reduce((sum, i) => sum + (parseFloat(i.budget) || 0), 0);
      const remaining = p.totalBudget - totalAllocated;
      return `<tr>
        <td><strong>${p.name}</strong></td>
        <td>${p.client}</td>
        <td>${formatRp(p.totalBudget)}</td>
        <td style="color:${remaining < 0 ? '#ef4444':'#10b981'}">${formatRp(remaining)}</td>
        <td><button class="btn btn-danger btn-del-proj" data-id="${p.id}"><i class="fas fa-trash"></i> Delete</button></td>
      </tr>`;
    }).join('');
    
    document.querySelectorAll('.btn-del-proj').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (confirm('Delete project and all its RAB items?')) {
          remove(ref(db, `projects/${id}`));
          rabItems.filter(i => i.projectId === id).forEach(i => remove(ref(db, `rabItems/${i.id}`)));
        }
      });
    });
  }
  
  const filter = document.getElementById('filterProjectRAB');
  if (filter) {
    const prevVal = currentSelectedProjectId;
    filter.innerHTML = '<option value="">-- Filter Master Project --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (prevVal) filter.value = prevVal;
  }
  renderRABItemsSubTable();
}

function renderRABItemsSubTable() {
  const tbody = document.getElementById('rabItemsMasterBody');
  if (!tbody) return;
  
  if (!currentSelectedProjectId) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Pilih project terlebih dahulu</td></tr>';
    return;
  }
  
  const filtered = rabItems.filter(i => i.projectId === currentSelectedProjectId);
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Belum ada item RAB pada project ini</td></tr>';
    return;
  }
  
  tbody.innerHTML = filtered.map(i => `
    <tr>
      <td>${i.itemName}</td>
      <td>${formatRp(i.budget)}</td>
      <td>${formatRp(i.realisasi)}</td>
      <td>${formatRp(i.budget - i.realisasi)}</td>
      <td><button class="btn btn-danger btn-del-rab-sub" data-id="${i.id}"><i class="fas fa-trash"></i></button></td>
    </tr>
  `).join('');
  
  document.querySelectorAll('.btn-del-rab-sub').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (confirm('Delete this RAB item?')) {
        remove(ref(db, `rabItems/${id}`));
      }
    });
  });
}

// ==================== USER MANAGEMENT RENDERING ====================
function renderUsersTable() {
  const tbody = document.getElementById('userTableBody');
  if (!tbody) return;
  
  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No users registered</td></tr>';
    return;
  }
  
  tbody.innerHTML = users.map(u => {
    const badgeClass = u.role === 'Administrator' ? 'badge-danger' : (u.role === 'Finance' ? 'badge-warning' : 'badge-success');
    const isCurrent = currentUserEmail === u.email;
    return `<tr>
      <td><strong>${u.email}</strong> ${isCurrent ? '<span class="badge badge-info">(You)</span>' : ''}</td>
      <td><span class="badge ${badgeClass}">${u.role}</span></td>
      <td style="font-size:0.7rem;">${u.id ? u.id.substring(0, 12) + '...' : '-'}</td>
      <td>${u.createdAt || '-'}</td>
      <td class="action-buttons">
        ${currentRole === 'Administrator' ? `
          ${!isCurrent ? `
            <button class="btn-edit" data-uid="${u.id}" data-email="${u.email}" data-role="${u.role}"><i class="fas fa-edit"></i> Edit</button>
            <button class="btn-reset" data-uid="${u.id}" data-email="${u.email}"><i class="fas fa-key"></i> Reset</button>
            <button class="btn-delete" data-uid="${u.id}" data-email="${u.email}"><i class="fas fa-trash"></i> Delete</button>
          ` : '<span class="badge badge-secondary">Your Account</span>'}
        ` : '<span class="badge badge-secondary">Admin Only</span>'}
        </td>
    </tr>`;
  }).join('');
  
  if (currentRole === 'Administrator') {
    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => openEditUserModal(btn.dataset.uid, btn.dataset.email, btn.dataset.role));
    });
    document.querySelectorAll('.btn-reset').forEach(btn => {
      btn.addEventListener('click', () => openResetPasswordModal(btn.dataset.uid, btn.dataset.email));
    });
    document.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm(`Delete user ${btn.dataset.email}?`)) {
          await deleteUserAccount(btn.dataset.uid, btn.dataset.email);
        }
      });
    });
  }
}

function openEditUserModal(uid, email, currentRoleUser) {
  const modal = document.getElementById('userModal');
  const title = document.getElementById('userModalTitle');
  const emailInput = document.getElementById('modalUserEmail');
  const passwordGroup = document.getElementById('passwordFieldGroup');
  const roleSelect = document.getElementById('modalRole');
  const saveBtn = document.getElementById('saveUserBtn');
  const editUserId = document.getElementById('editUserId');
  
  title.innerHTML = '<i class="fas fa-user-edit"></i> Edit User Role';
  emailInput.value = email;
  emailInput.disabled = true;
  if (passwordGroup) passwordGroup.style.display = 'none';
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
    if (passwordGroup) passwordGroup.style.display = 'block';
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
  
  if (!email) { triggerNotification('Email required!', false, 'error'); return; }
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
  const budget = parseFloat(document.getElementById('modalBudget').value) || 0;
  
  if (!name || !client || budget <= 0) { 
    triggerNotification('Please fill all fields correctly!', false, 'error'); 
    return; 
  }
  
  const newProjectRef = push(ref(db, 'projects'));
  set(newProjectRef, { name, client, totalBudget: budget }).then(() => {
    document.getElementById('projectModal').classList.remove('active');
    document.getElementById('modalProjectName').value = '';
    document.getElementById('modalClientName').value = '';
    document.getElementById('modalBudget').value = '';
    triggerNotification('Project added successfully!');
  });
});

document.getElementById('openRABModalBtn')?.addEventListener('click', () => {
  if (!currentSelectedProjectId) { 
    triggerNotification('Please select a project first!', false, 'error'); 
    return; 
  }
  const proj = projects.find(p => p.id === currentSelectedProjectId);
  document.getElementById('rabModalProjectName').value = proj ? proj.name : '';
  document.getElementById('rabItemName').value = '';
  document.getElementById('rabBudget').value = '';
  document.getElementById('rabModal').classList.add('active');
});

document.getElementById('saveRabBtn')?.addEventListener('click', () => {
  const name = document.getElementById('rabItemName').value.trim();
  const budget = parseFloat(document.getElementById('rabBudget').value) || 0;
  
  if (!name || budget <= 0) { 
    triggerNotification('Please fill item name and budget correctly!', false, 'error'); 
    return; 
  }
  
  const newRabRef = push(ref(db, 'rabItems'));
  set(newRabRef, {
    projectId: currentSelectedProjectId,
    itemName: name,
    budget: budget,
    realisasi: 0
  }).then(() => {
    document.getElementById('rabModal').classList.remove('active');
    triggerNotification('RAB item added successfully!');
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
    container.innerHTML = '<div style="text-align:center; padding:10px;">Belum ada item. Klik Tambah Baris.</div>';
    return;
  }
  
  container.innerHTML = claimItemsListArray.map((item, idx) => `
    <div class="item-row">
      <button type="button" class="remove-item" data-idx="${idx}"><i class="fas fa-times"></i></button>
      <div class="item-row-grid">
        <div>
          <select data-idx="${idx}" class="item-sel-node">
            <option value="">-- Pilih Komponen --</option>
            ${availableItems.map(av => `<option value="${av.id}" ${item.itemId === av.id ? 'selected' : ''}>${av.itemName} (Sisa: ${formatRp(av.budget - av.realisasi)})</option>`).join('')}
          </select>
        </div>
        <div>
          <input type="number" data-idx="${idx}" class="item-nom-node" placeholder="Nominal" value="${item.nominal || ''}" />
        </div>
      </div>
      <div class="item-row-subgrid">
        <div><input type="text" data-idx="${idx}" class="item-vendor-node" placeholder="Vendor" value="${item.vendor || ''}" /></div>
        <div><input type="date" data-idx="${idx}" class="item-date-node" value="${item.tanggal || ''}" /></div>
        <div><input type="text" data-idx="${idx}" class="item-notes-node" placeholder="Catatan" value="${item.desc || ''}" /></div>
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
  container.querySelectorAll('.item-vendor-node').forEach(inp => {
    inp.addEventListener('input', (e) => {
      claimItemsListArray[parseInt(inp.dataset.idx)].vendor = e.target.value;
    });
  });
  container.querySelectorAll('.item-date-node').forEach(inp => {
    inp.addEventListener('change', (e) => {
      claimItemsListArray[parseInt(inp.dataset.idx)].tanggal = e.target.value;
    });
  });
  container.querySelectorAll('.item-notes-node').forEach(inp => {
    inp.addEventListener('input', (e) => {
      claimItemsListArray[parseInt(inp.dataset.idx)].desc = e.target.value;
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
    const oldVal = selectPr.value;
    selectPr.innerHTML = '<option value="">-- Select Project --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (oldVal) selectPr.value = oldVal;
  }
  
  const historyBody = document.getElementById('historyClaimBody');
  if (historyBody) {
    historyBody.innerHTML = claims.map(c => {
      const p = projects.find(pr => pr.id === c.projectId);
      const summaries = c.items ? c.items.map(ci => {
        const r = rabItems.find(rab => rab.id === ci.itemId);
        return `• <strong>${r ? r.itemName : 'Komponen'}</strong>: ${formatRp(ci.nominal)}<br><small>(Vendor: ${ci.vendor || '-'} | Tgl: ${ci.tanggal || '-'})</small>`;
      }).join('<br>') : '-';
      const badgeClass = c.status === 'approved' ? 'badge-success' : (c.status === 'rejected' ? 'badge-danger' : 'badge-warning');
      return `<tr>
        <td><strong>${p ? p.name : '-'}</strong></td>
        <td style="font-size:0.8rem;">${summaries}</td>
        <td>${formatRp(c.totalNominal)}</td>
        <td><span class="badge ${badgeClass}">${c.status}</span></td>
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
    triggerNotification('Pilih project terlebih dahulu!', false, 'error');
    return;
  }
  claimItemsListArray.push({ itemId: '', nominal: 0, vendor: '', tanggal: '', desc: '' });
  renderClaimItemsBuildLayout();
});

document.getElementById('submitClaimMainBtn')?.addEventListener('click', () => {
  const projectId = document.getElementById('claimProjectSelect').value;
  const validItems = claimItemsListArray.filter(it => it.itemId && it.nominal > 0 && it.vendor && it.tanggal);
  
  if (!projectId || validItems.length === 0) {
    triggerNotification('Lengkapi minimal satu item (Komponen, Nominal, Vendor, Tanggal)!', false, 'error');
    return;
  }
  
  const totalNominal = validItems.reduce((sum, i) => sum + i.nominal, 0);
  const newClaimRef = push(ref(db, 'claims'));
  set(newClaimRef, {
    projectId: projectId,
    status: 'pending',
    totalNominal: totalNominal,
    items: validItems,
    timestamp: Date.now()
  }).then(() => {
    claimItemsListArray = [];
    document.getElementById('claimProjectSelect').value = '';
    renderClaimItemsBuildLayout();
    triggerNotification('Claim submitted successfully!');
  });
});

// ==================== BUDGET APPROVAL ====================
function renderApprovalList() {
  const tbody = document.getElementById('approvalTableBody');
  if (!tbody) return;
  
  const pending = claims.filter(c => c.status === 'pending');
  if (pending.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No pending requests</td></tr>';
    return;
  }
  
  tbody.innerHTML = pending.map(c => {
    const p = projects.find(pr => pr.id === c.projectId);
    const details = c.items ? c.items.map(ci => {
      const r = rabItems.find(rab => rab.id === ci.itemId);
      return `• ${r ? r.itemName : '-'}: ${formatRp(ci.nominal)}<br><small>Vendor: ${ci.vendor || '-'}</small>`;
    }).join('<br>') : '-';
    return `<tr>
      <td><strong>${p ? p.name : '-'}</strong></td>
      <td style="font-size:0.8rem;">${details}</td>
      <td>${formatRp(c.totalNominal)}</td>
      <td><span class="badge badge-warning">Pending</span></td>
      <td class="action-buttons">
        <button class="btn-appr-ok" data-id="${c.id}" style="background:#d1fae5;color:#065f46;"><i class="fas fa-check"></i> Approve</button>
        <button class="btn-appr-no" data-id="${c.id}" style="background:#fee2e2;color:#991b1b;"><i class="fas fa-times"></i> Reject</button>
      </td>
    </tr>`;
  }).join('');
  
  document.querySelectorAll('.btn-appr-ok').forEach(btn => {
    btn.addEventListener('click', () => executeApproval(btn.dataset.id, true));
  });
  document.querySelectorAll('.btn-appr-no').forEach(btn => {
    btn.addEventListener('click', () => executeApproval(btn.dataset.id, false));
  });
}

async function executeApproval(claimId, isApproved) {
  const claim = claims.find(c => c.id === claimId);
  if (!claim) return;
  
  if (isApproved && claim.items) {
    for (let item of claim.items) {
      const rab = rabItems.find(r => r.id === item.itemId);
      if (rab) {
        const currentReal = parseFloat(rab.realisasi) || 0;
        await update(ref(db, `rabItems/${rab.id}`), {
          realisasi: currentReal + parseFloat(item.nominal)
        });
      }
    }
    await update(ref(db, `claims/${claimId}`), { status: 'approved' });
    triggerNotification('Claim approved and realization updated!');
  } else {
    await update(ref(db, `claims/${claimId}`), { status: 'rejected' });
    triggerNotification('Claim rejected.', false, 'error');
  }
}

// ==================== MONITORING ====================
function renderMonitoringTable() {
  const tbody = document.getElementById('monitoringMainGridBody');
  if (!tbody) return;
  
  tbody.innerHTML = projects.map(p => {
    const subItems = rabItems.filter(i => i.projectId === p.id);
    const spent = subItems.reduce((sum, i) => sum + (parseFloat(i.realisasi) || 0), 0);
    let status = '<span class="badge badge-success">Healthy</span>';
    if (spent > p.totalBudget) status = '<span class="badge badge-danger">Critical</span>';
    else if (p.totalBudget > 0 && (spent / p.totalBudget) >= 0.88) status = '<span class="badge badge-warning">Attention</span>';
    
    return `<tr class="project-row" data-id="${p.id}">
      <td><a class="project-name-link" href="#"><i class="fas fa-folder"></i> ${p.name}</a></td>
      <td>${p.client}</td>
      <td>${formatRp(p.totalBudget)}</td>
      <td style="color:#2563eb; font-weight:700;">${formatRp(spent)}</td>
      <td>${status}</td>
    </tr>`;
  }).join('');
  
  document.querySelectorAll('.project-row').forEach(row => {
    row.addEventListener('click', () => openMonitoringDetail(row.dataset.id));
  });
}

function openMonitoringDetail(projectId) {
  const proj = projects.find(p => p.id === projectId);
  if (!proj) return;
  
  document.getElementById('modalDetailsProjectName').innerText = proj.name;
  const items = rabItems.filter(i => i.projectId === projectId);
  const tbody = document.getElementById('modalDetailsComponentsTableGridBody');
  
  if (tbody) {
    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No components yet</td></tr>';
    } else {
      tbody.innerHTML = items.map(i => `<tr>
        <td><strong>${i.itemName}</strong></td>
        <td>${formatRp(i.budget)}</td>
        <td>${formatRp(i.realisasi)}</td>
        <td style="color:${(i.budget - i.realisasi) < 0 ? '#ef4444' : '#10b981'}">${formatRp(i.budget - i.realisasi)}</td>
        <td>${getBadge(i.realisasi, i.budget)}</td>
        <td>${createProgressBarMarkup(i.realisasi, i.budget)}</td>
      </tr>`).join('');
    }
  }
  document.getElementById('monitoringDetailsModal').classList.add('active');
}

// ==================== REPORTS WITH DETAILED CHARTS ====================
function destroyCharts() {
  if (comparisonChart) { comparisonChart.destroy(); comparisonChart = null; }
  if (pieChart) { pieChart.destroy(); pieChart = null; }
  if (healthChart) { healthChart.destroy(); healthChart = null; }
}

function renderReports() {
  const filterSelect = document.getElementById('reportProjectFilterSelect');
  if (!filterSelect) return;
  
  const projectId = filterSelect.value;
  const tbody = document.getElementById('reportsTableGridBody');
  const containerTitle = document.getElementById('reportContainerProjectTitle');
  const statTotalPagu = document.getElementById('repStatTotalPagu');
  const statTotalRealisasi = document.getElementById('repStatTotalRealisasi');
  const statSisaSaldo = document.getElementById('repStatSisaSaldo');
  const statAvgProgress = document.getElementById('repStatAvgProgress');
  const statOverBudget = document.getElementById('repStatOverBudget');
  const statNearLimit = document.getElementById('repStatNearLimit');
  const statSafe = document.getElementById('repStatSafe');
  
  if (!projectId) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Pilih proyek terlebih dahulu</td></tr>';
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
  
  const proj = projects.find(p => p.id === projectId);
  if (!proj) return;
  
  if (containerTitle) {
    containerTitle.innerHTML = `<i class="fas fa-briefcase"></i> Analisis Finansial: <span style="color:#2563eb;">${proj.name}</span> <small>(${proj.client})</small>`;
  }
  
  const components = rabItems.filter(i => i.projectId === projectId);
  const totalReal = components.reduce((sum, i) => sum + (parseFloat(i.realisasi) || 0), 0);
  const avgProgress = proj.totalBudget > 0 ? Math.round((totalReal / proj.totalBudget) * 100) : 0;
  const overBudgetCount = components.filter(i => i.realisasi > i.budget).length;
  const nearLimitCount = components.filter(i => i.budget > 0 && (i.realisasi / i.budget) >= 0.9 && i.realisasi <= i.budget).length;
  const safeCount = components.filter(i => i.budget > 0 && (i.realisasi / i.budget) < 0.9 && i.realisasi <= i.budget).length;
  
  if (statTotalPagu) statTotalPagu.innerText = formatRp(proj.totalBudget);
  if (statTotalRealisasi) statTotalRealisasi.innerText = formatRp(totalReal);
  if (statSisaSaldo) {
    statSisaSaldo.innerText = formatRp(proj.totalBudget - totalReal);
    statSisaSaldo.style.color = (proj.totalBudget - totalReal) < 0 ? '#ef4444' : '#10b981';
  }
  if (statAvgProgress) statAvgProgress.innerText = `${avgProgress}%`;
  if (statOverBudget) statOverBudget.innerText = overBudgetCount;
  if (statNearLimit) statNearLimit.innerText = nearLimitCount;
  if (statSafe) statSafe.innerText = safeCount;
  
  if (components.length === 0) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Belum ada komponen RAB pada proyek ini</td></tr>';
    destroyCharts();
    return;
  }
  
  if (tbody) {
    tbody.innerHTML = components.map(c => {
      const remaining = c.budget - c.realisasi;
      const percent = c.budget > 0 ? Math.round((c.realisasi / c.budget) * 100) : 0;
      return `<tr>
        <td><strong>${c.itemName}</strong></td>
        <td>${formatRp(c.budget)}</td>
        <td>${formatRp(c.realisasi)}</td>
        <td style="color:${remaining < 0 ? '#ef4444' : '#10b981'}">${formatRp(remaining)}</td>
        <td><div class="progress-wrapper"><div class="progress-bar-container"><div class="progress-bar-fill" style="width: ${percent}%; background-color: ${percent >= 90 ? '#f59e0b' : (percent >= 100 ? '#ef4444' : '#10b981')};"></div></div><span>${percent}%</span></div></td>
        <td>${getBadge(c.realisasi, c.budget)}</td>
      </tr>`;
    }).join('');
  }
  
  createDetailedCharts(components, proj);
}

function createDetailedCharts(components, project) {
  destroyCharts();
  
  const comparisonCanvas = document.getElementById('reportComparisonChartCanvas');
  const pieCanvas = document.getElementById('reportPieChartCanvas');
  const healthCanvas = document.getElementById('reportHealthChartCanvas');
  
  if (!comparisonCanvas || !pieCanvas || !healthCanvas) {
    console.error("Canvas elements not found");
    return;
  }
  
  const sorted = [...components].sort((a, b) => b.budget - a.budget);
  const labels = sorted.map(c => c.itemName.length > 20 ? c.itemName.substring(0, 17) + '...' : c.itemName);
  const budgetData = sorted.map(c => c.budget);
  const realizationData = sorted.map(c => c.realisasi);
  const remainingData = sorted.map(c => Math.max(0, c.budget - c.realisasi));
  const overData = sorted.map(c => Math.max(0, c.realisasi - c.budget));
  
  const pieColors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#C9CBCF', '#4CAF50'];
  
  // Chart 1: Budget vs Realization
  const ctx1 = comparisonCanvas.getContext('2d');
  comparisonChart = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { label: 'Budget', data: budgetData, backgroundColor: 'rgba(54, 162, 235, 0.8)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1, borderRadius: 4 },
        { label: 'Realisasi', data: realizationData, backgroundColor: 'rgba(255, 99, 132, 0.8)', borderColor: 'rgba(255, 99, 132, 1)', borderWidth: 1, borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'top' },
        title: { display: true, text: `Budget vs Realisasi - ${project.name}`, font: { size: 13, weight: 'bold' } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              let label = ctx.dataset.label || '';
              let value = ctx.parsed.y;
              let comp = sorted[ctx.dataIndex];
              let pct = '';
              if (ctx.dataset.label === 'Realisasi' && comp.budget > 0) {
                pct = ` (${Math.round((value / comp.budget) * 100)}% dari Budget)`;
              }
              return `${label}: ${formatRp(value)}${pct}`;
            }
          }
        }
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => formatRp(v) }, title: { display: true, text: 'Jumlah (Rp)' } },
        x: { ticks: { rotate: 45, maxRotation: 45, minRotation: 45, font: { size: 10 } }, title: { display: true, text: 'Komponen' } }
      }
    }
  });
  
  // Chart 2: Pie Chart
  const ctx2 = pieCanvas.getContext('2d');
  pieChart = new Chart(ctx2, {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{ data: budgetData, backgroundColor: pieColors.slice(0, budgetData.length), borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'right' },
        title: { display: true, text: `Distribusi Budget - ${project.name}`, font: { size: 13, weight: 'bold' } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = budgetData.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
              return `${ctx.label}: ${formatRp(ctx.parsed)} (${pct}%)`;
            }
          }
        }
      }
    }
  });
  
  // Chart 3: Health Chart
  const ctx3 = healthCanvas.getContext('2d');
  healthChart = new Chart(ctx3, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { label: 'Sisa Budget', data: remainingData, backgroundColor: 'rgba(75, 192, 192, 0.8)', borderColor: 'rgba(75, 192, 192, 1)', borderWidth: 1, borderRadius: 4 },
        { label: 'Over Budget', data: overData, backgroundColor: 'rgba(255, 99, 132, 0.8)', borderColor: 'rgba(255, 99, 132, 1)', borderWidth: 1, borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'top' },
        title: { display: true, text: `Status Kesehatan Budget - ${project.name}`, font: { size: 13, weight: 'bold' } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              let label = ctx.dataset.label || '';
              let value = ctx.parsed.y;
              let comp = sorted[ctx.dataIndex];
              let info = '';
              if (ctx.dataset.label === 'Sisa Budget' && comp.budget > 0) {
                info = ` (${((value / comp.budget) * 100).toFixed(1)}% tersisa)`;
              } else if (ctx.dataset.label === 'Over Budget' && value > 0 && comp.budget > 0) {
                info = ` (Melebihi ${((value / comp.budget) * 100).toFixed(1)}%)`;
              }
              return `${label}: ${formatRp(value)}${info}`;
            }
          }
        }
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => formatRp(v) }, title: { display: true, text: 'Jumlah (Rp)' } },
        x: { ticks: { rotate: 45, maxRotation: 45, minRotation: 45, font: { size: 10 } }, title: { display: true, text: 'Komponen' } }
      }
    }
  });
}

// ==================== EXPORT EXCEL ====================
document.getElementById('exportExcelReportBtn')?.addEventListener('click', () => {
  const projectId = document.getElementById('reportProjectFilterSelect')?.value;
  if (!projectId) { triggerNotification('Pilih proyek terlebih dahulu!', false, 'error'); return; }
  
  const project = projects.find(p => p.id === projectId);
  if (!project) return;
  
  const components = rabItems.filter(i => i.projectId === projectId);
  const data = components.map(c => ({
    'Komponen': c.itemName,
    'Budget': c.budget,
    'Realisasi': c.realisasi,
    'Sisa': c.budget - c.realisasi,
    'Persentase': c.budget > 0 ? `${Math.round((c.realisasi / c.budget) * 100)}%` : '0%'
  }));
  
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Report_${project.name}`);
  XLSX.writeFile(wb, `RAB_Report_${project.name}.xlsx`);
  triggerNotification('Excel exported successfully!');
});

// ==================== PDF EXPORT ====================
document.getElementById('printPdfReportBtn')?.addEventListener('click', async () => {
  const projectId = document.getElementById('reportProjectFilterSelect')?.value;
  if (!projectId) { triggerNotification('Pilih proyek terlebih dahulu!', false, 'error'); return; }
  
  const element = document.getElementById('printableReportAreaContainer');
  if (!element) return;
  
  triggerNotification('Generating PDF...', true, 'info');
  const opt = {
    margin: [0.5, 0.5, 0.5, 0.5],
    filename: `RAB_Report_${projectId}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 3, useCORS: true, logging: false, letterRendering: true },
    jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' }
  };
  
  try {
    await html2pdf().set(opt).from(element).save();
    triggerNotification('PDF saved successfully!');
  } catch (err) {
    console.error(err);
    triggerNotification('PDF generation failed!', false, 'error');
  }
});

// ==================== FILE TREE ====================
function renderTreeHierarchy() {
  const root = document.getElementById('rootFileTreeDirectory');
  if (!root) return;
  
  if (!truenasFiles.length) {
    root.innerHTML = '<li>Tidak ada dokumen</li>';
    return;
  }
  
  const map = {};
  truenasFiles.forEach(f => {
    const p = projects.find(pr => pr.id === f.projectId);
    const folder = p ? p.name : 'Unsorted';
    if (!map[folder]) map[folder] = [];
    map[folder].push(f);
  });
  
  root.innerHTML = `
    <li class="root-node"><i class="fas fa-network-wired"></i> Storage Root</li>
    ${Object.keys(map).map(folder => `
      <li style="padding-left:12px;">
        <div class="folder-node"><i class="fas fa-folder-open"></i> ${folder}</div>
        <ul style="list-style:none;padding-left:12px;">
          ${map[folder].map(f => `
            <li class="file-node">
              <i class="fas fa-file-invoice"></i>
              <span>${f.fileName} <small>(${f.uploadedBy || 'System'})</small></span>
              <div class="action-links">
                <a href="${API_BASE_URL}/preview/${f.id}" target="_blank">View</a>
                ${currentRole === 'Administrator' ? `<button class="delete-file-btn" data-id="${f.id}"><i class="fas fa-trash"></i></button>` : ''}
              </div>
            </li>
          `).join('')}
        </ul>
      </li>
    `).join('')}
  `;
  
  document.querySelectorAll('.delete-file-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('Delete this file?')) {
        remove(ref(db, `truenasFiles/${btn.dataset.id}`));
        triggerNotification('File deleted!');
      }
    });
  });
}

// ==================== UPLOAD DOCUMENT ====================
document.getElementById('startUploadDocBtn')?.addEventListener('click', () => {
  const pId = document.getElementById('uploadProjectSelect')?.value;
  const fileInput = document.getElementById('documentLocalFile');
  
  if (!pId || !fileInput?.files?.length) {
    triggerNotification('Pilih project dan file terlebih dahulu!', false, 'error');
    return;
  }
  
  const file = fileInput.files[0];
  push(ref(db, 'truenasFiles'), {
    projectId: pId,
    fileName: file.name,
    fileSize: file.size,
    uploadedBy: currentUserEmail,
    timestamp: Date.now()
  }).then(() => {
    fileInput.value = '';
    document.getElementById('uploadProjectSelect').value = '';
    triggerNotification('File uploaded successfully!');
  });
});

// ==================== MODAL CONTROLS ====================
document.getElementById('openProjectModalBtn')?.addEventListener('click', () => {
  document.getElementById('projectModal').classList.add('active');
});
document.getElementById('closeProjectModalBtn')?.addEventListener('click', () => {
  document.getElementById('projectModal').classList.remove('active');
});
document.getElementById('closeRabModalBtn')?.addEventListener('click', () => {
  document.getElementById('rabModal').classList.remove('active');
});
document.getElementById('closeMonitoringDetailsModalBtn')?.addEventListener('click', () => {
  document.getElementById('monitoringDetailsModal').classList.remove('active');
});
document.getElementById('openAddUserModalBtn')?.addEventListener('click', () => {
  document.getElementById('userModalTitle').innerHTML = '<i class="fas fa-user-plus"></i> Add New User';
  document.getElementById('modalUserEmail').value = '';
  document.getElementById('modalUserEmail').disabled = false;
  document.getElementById('passwordFieldGroup').style.display = 'block';
  document.getElementById('saveUserBtn').onclick = saveNewUser;
  document.getElementById('userModal').classList.add('active');
});
document.getElementById('closeUserModalBtn')?.addEventListener('click', () => {
  document.getElementById('userModal').classList.remove('active');
});
document.getElementById('closeResetModalBtn')?.addEventListener('click', () => {
  document.getElementById('resetPasswordModal').classList.remove('active');
});
document.getElementById('logoutBtn')?.addEventListener('click', () => {
  signOut(auth).then(() => window.location.reload());
});

// ==================== PAGE ROUTER ====================
const pageMap = {
  dashboard: 'dashboardPage',
  'master-project': 'masterProjectPage',
  'claim-request': 'claimRequestPage',
  'approval-budget': 'approvalBudgetPage',
  monitoring: 'monitoringPage',
  reports: 'reportsPage',
  'upload-document': 'uploadDocumentPage',
  files: 'filesPage',
  'user-management': 'userManagementPage'
};

document.querySelectorAll('#sidebarMenu li').forEach(li => {
  li.addEventListener('click', () => {
    if (li.classList.contains('restricted')) return;
    
    document.querySelectorAll('#sidebarMenu li').forEach(l => l.classList.remove('active'));
    li.classList.add('active');
    
    const page = li.dataset.page;
    Object.values(pageMap).forEach(p => {
      const el = document.getElementById(p);
      if (el) el.classList.add('hidden-section');
    });
    
    const target = document.getElementById(pageMap[page]);
    if (target) target.classList.remove('hidden-section');
    
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) {
      const icon = li.querySelector('i');
      pageTitle.innerHTML = `<i class="${icon ? icon.className : 'fas fa-chart-pie'}"></i> ${li.innerText.trim()}`;
    }
    
    const actionBtn = document.getElementById('globalActionBtn');
    if (actionBtn) {
      actionBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
      actionBtn.onclick = () => updateWholeUI();
    }
    
    if (page === 'reports') {
      setTimeout(() => renderReports(), 200);
    }
  });
});

// ==================== AUTH INITIALIZATION ====================
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentAuthUser = user;
    currentUserEmail = user.email;
    currentUserUid = user.uid;
    
    ensureAdminUIDInDatabase(user);
    
    const userRef = ref(db, `users/${user.uid}`);
    onValue(userRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        currentUserData = data;
        currentRole = data.role;
        
        const emailLabel = document.getElementById('sidebarUserEmail');
        const roleLabel = document.getElementById('sidebarUserRole');
        if (emailLabel) emailLabel.innerText = user.email;
        if (roleLabel) roleLabel.innerText = currentRole;
        
        enforceRoleVisibility();
        initCloudDatabaseListeners();
        hideLoadingScreen();
      }
    });
  } else {
    hideLoadingScreen();
    currentRole = 'Administrator';
    currentUserEmail = 'demo@genetek.co.id';
    
    const emailLabel = document.getElementById('sidebarUserEmail');
    const roleLabel = document.getElementById('sidebarUserRole');
    if (emailLabel) emailLabel.innerText = currentUserEmail;
    if (roleLabel) roleLabel.innerText = currentRole;
    
    enforceRoleVisibility();
    initCloudDatabaseListeners();
  }
});

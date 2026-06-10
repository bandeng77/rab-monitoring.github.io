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
let mainBarChartInstance = null;
let systemLineReportChartInstance = null;

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

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatFileSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
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
  refreshGraphicCharts();
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
    if (prevVal && projects.find(p => p.id === prevVal)) filterRAB.value = prevVal;
  }
  
  const claimSel = document.getElementById('claimProjectSelect');
  if (claimSel) {
    const oldVal = claimSel.value;
    claimSel.innerHTML = '<option value="">-- Select Project --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (oldVal && projects.find(p => p.id === oldVal)) claimSel.value = oldVal;
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
    if (prevVal && projects.find(p => p.id === prevVal)) filter.value = prevVal;
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

// ==================== EVENT LISTENERS ====================
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
    if (oldVal && projects.find(p => p.id === oldVal)) selectPr.value = oldVal;
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

// ==================== REPORTS ====================
function renderReports() {
  const tbody = document.getElementById('reportsTableGridBody');
  if (!tbody) return;
  
  if (projects.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No projects available</td></tr>';
    return;
  }
  
  let html = '';
  projects.forEach(p => {
    const items = rabItems.filter(i => i.projectId === p.id);
    const totalBudget = items.reduce((sum, i) => sum + i.budget, 0);
    const totalReal = items.reduce((sum, i) => sum + i.realisasi, 0);
    const remaining = totalBudget - totalReal;
    const percentage = totalBudget > 0 ? ((totalReal / totalBudget) * 100).toFixed(1) : 0;
    
    html += `<tr style="background-color: #f1f5f9;">
      <td colspan="6" style="padding: 12px; font-weight: bold;">${p.name} (${p.client})</td>
    </tr>`;
    
    if (items.length === 0) {
      html += `<tr><td colspan="6" style="text-align: center; padding: 8px;">No RAB items</td></tr>`;
    } else {
      items.forEach(item => {
        const itemRemaining = item.budget - item.realisasi;
        const itemPercentage = item.budget > 0 ? ((item.realisasi / item.budget) * 100).toFixed(1) : 0;
        html += `<tr>
          <td>${item.itemName}</td>
          <td class="text-right">${formatRp(item.budget)}</td>
          <td class="text-right">${formatRp(item.realisasi)}</td>
          <td class="text-right">${formatRp(itemRemaining)}</td>
          <td class="text-center">${itemPercentage}%</td>
          <td class="text-center">${getBadge(item.realisasi, item.budget)}</td>
        </tr>`;
      });
    }
    
    html += `<tr style="background-color: #f8fafc; font-weight: bold;">
      <td>TOTAL for ${p.name}</td>
      <td class="text-right">${formatRp(totalBudget)}</td>
      <td class="text-right">${formatRp(totalReal)}</td>
      <td class="text-right">${formatRp(remaining)}</td>
      <td class="text-center">${percentage}%</td>
      <td></td>
    </tr>`;
  });
  
  tbody.innerHTML = html;
}

// ==================== GRAPHIC CHARTS ====================
function refreshGraphicCharts() {
  const barCtx = document.getElementById('budgetChart')?.getContext('2d');
  if (barCtx) {
    if (mainBarChartInstance) mainBarChartInstance.destroy();
    mainBarChartInstance = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: projects.map(p => p.name.length > 15 ? p.name.substring(0, 12) + '...' : p.name),
        datasets: [
          { 
            label: 'Total Budget (Juta Rp)', 
            data: projects.map(p => rabItems.filter(i => i.projectId === p.id).reduce((s,i) => s + i.budget, 0) / 1e6), 
            backgroundColor: '#3b82f6',
            borderRadius: 4
          },
          { 
            label: 'Claim Realization (Juta Rp)', 
            data: projects.map(p => rabItems.filter(i => i.projectId === p.id).reduce((s,i) => s + i.realisasi, 0) / 1e6), 
            backgroundColor: '#10b981',
            borderRadius: 4
          }
        ]
      },
      options: { 
        responsive: true, 
        maintainAspectRatio: true,
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: Rp ${ctx.raw.toFixed(2)} Juta`
            }
          }
        }
      }
    });
  }
  
  const lineCtx = document.getElementById('laporanChart')?.getContext('2d');
  if (lineCtx) {
    if (systemLineReportChartInstance) systemLineReportChartInstance.destroy();
    systemLineReportChartInstance = new Chart(lineCtx, {
      type: 'line',
      data: {
        labels: projects.map(p => p.name.length > 15 ? p.name.substring(0, 12) + '...' : p.name),
        datasets: [
          { 
            label: 'Allocation Curve (Budget)', 
            data: projects.map(p => rabItems.filter(i => i.projectId === p.id).reduce((s,i) => s + i.budget, 0) / 1e6), 
            borderColor: '#8b5cf6', 
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            fill: true, 
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6
          },
          { 
            label: 'Absorption Curve (Realization)', 
            data: projects.map(p => rabItems.filter(i => i.projectId === p.id).reduce((s,i) => s + i.realisasi, 0) / 1e6), 
            borderColor: '#f97316', 
            backgroundColor: 'rgba(249, 115, 22, 0.1)',
            fill: true, 
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6
          }
        ]
      },
      options: { 
        responsive: true, 
        maintainAspectRatio: true,
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: Rp ${ctx.raw.toFixed(2)} Juta`
            }
          }
        }
      }
    });
  }
}

// ==================== PDF DOWNLOAD ====================
async function downloadPDF() {
  triggerNotification('Generating PDF report...', true, 'info');
  
  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  const totalBudget = projects.reduce((sum, p) => sum + (parseFloat(p.totalBudget) || 0), 0);
  const totalRealization = rabItems.reduce((sum, i) => sum + (parseFloat(i.realisasi) || 0), 0);
  const totalProjects = projects.length;
  const overBudgetItems = rabItems.filter(i => i.realisasi > i.budget).length;
  const pendingClaims = claims.filter(c => c.status === 'pending').length;
  const approvedClaims = claims.filter(c => c.status === 'approved').length;
  const rejectedClaims = claims.filter(c => c.status === 'rejected').length;
  
  const chartCanvas = document.getElementById('laporanChart');
  let chartImage = '';
  if (chartCanvas) {
    chartImage = chartCanvas.toDataURL('image/png');
  }
  
  const barChartCanvas = document.getElementById('budgetChart');
  let barChartImage = '';
  if (barChartCanvas) {
    barChartImage = barChartCanvas.toDataURL('image/png');
  }
  
  let projectDetailsHtml = '';
  projects.forEach(p => {
    const projectItems = rabItems.filter(i => i.projectId === p.id);
    const projectBudget = projectItems.reduce((sum, i) => sum + i.budget, 0);
    const projectRealization = projectItems.reduce((sum, i) => sum + i.realisasi, 0);
    const projectBalance = projectBudget - projectRealization;
    const percentage = projectBudget > 0 ? ((projectRealization / projectBudget) * 100).toFixed(1) : 0;
    
    projectDetailsHtml += `
      <tr style="background-color: #f1f5f9;">
        <td colspan="6" style="padding: 10px; font-weight: bold;">${escapeHtml(p.name)} (${escapeHtml(p.client)})</td>
      </tr>
    `;
    
    if (projectItems.length === 0) {
      projectDetailsHtml += `
        <tr>
          <td colspan="6" style="text-align: center; padding: 8px;">No RAB items</td>
        </tr>
      `;
    } else {
      projectItems.forEach(item => {
        const itemBalance = item.budget - item.realisasi;
        const itemPercentage = item.budget > 0 ? ((item.realisasi / item.budget) * 100).toFixed(1) : 0;
        projectDetailsHtml += `
          <tr>
            <td style="padding: 8px;">${escapeHtml(item.itemName)}</td>
            <td style="padding: 8px; text-align: right;">${formatRp(item.budget)}</td>
            <td style="padding: 8px; text-align: right;">${formatRp(item.realisasi)}</td>
            <td style="padding: 8px; text-align: right;">${formatRp(itemBalance)}</td>
            <td style="padding: 8px; text-align: center;">${itemPercentage}%</td>
            <td style="padding: 8px; text-align: center;">
              <span style="padding: 2px 8px; border-radius: 12px; ${item.realisasi > item.budget ? 'background: #fee2e2; color: #991b1b;' : (itemPercentage >= 90 ? 'background: #fed7aa; color: #9a3412;' : 'background: #d1fae5; color: #065f46;')}">
                ${item.realisasi > item.budget ? 'Over Budget' : (itemPercentage >= 90 ? 'Near Limit' : 'Safe')}
              </span>
            </td>
          </tr>
        `;
      });
    }
    
    projectDetailsHtml += `
      <tr style="background-color: #f8fafc; font-weight: bold;">
        <td style="padding: 8px;">TOTAL for ${escapeHtml(p.name)}</td>
        <td style="padding: 8px; text-align: right;">${formatRp(projectBudget)}</td>
        <td style="padding: 8px; text-align: right;">${formatRp(projectRealization)}</td>
        <td style="padding: 8px; text-align: right;">${formatRp(projectBalance)}</td>
        <td style="padding: 8px; text-align: center;">${percentage}%</td>
        <td style="padding: 8px; text-align: center;"></td>
      </tr>
    `;
  });
  
  let claimsHtml = '';
  claims.forEach(c => {
    const p = projects.find(pr => pr.id === c.projectId);
    claimsHtml += `
      <tr>
        <td style="padding: 8px;">${p ? escapeHtml(p.name) : 'Unknown'}</td>
        <td style="padding: 8px;">${c.vendor || '-'}</td>
        <td style="padding: 8px; text-align: right;">${formatRp(c.totalNominal)}</td>
        <td style="padding: 8px; text-align: center;">
          <span style="padding: 2px 8px; border-radius: 12px; ${c.status === 'approved' ? 'background: #d1fae5; color: #065f46;' : (c.status === 'rejected' ? 'background: #fee2e2; color: #991b1b;' : 'background: #fed7aa; color: #9a3412;')}">
            ${c.status.toUpperCase()}
          </span>
        </td>
        <td style="padding: 8px;">${c.tanggal || '-'}</td>
      </tr>
    `;
  });
  
  const reportHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>RAB Financial Report - ${currentDate}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
          padding: 40px;
          margin: 0;
          color: #000000;
          background: white;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 1px solid #cccccc;
          padding-bottom: 20px;
        }
        .header h1 {
          color: #000000;
          margin: 0;
          font-size: 28px;
          font-weight: 700;
        }
        .header h2 {
          color: #333333;
          margin: 10px 0 0;
          font-size: 16px;
          font-weight: 500;
        }
        .header p {
          color: #666666;
          margin: 10px 0 0;
          font-size: 12px;
        }
        .summary-cards {
          display: flex;
          justify-content: space-between;
          gap: 15px;
          margin-bottom: 30px;
          flex-wrap: wrap;
        }
        .summary-card {
          flex: 1;
          background: #f8fafc;
          padding: 20px;
          border-radius: 12px;
          text-align: center;
          border: 1px solid #e2e8f0;
        }
        .summary-card h3 {
          margin: 0 0 10px;
          font-size: 11px;
          color: #666666;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 600;
        }
        .summary-card .value {
          margin: 0;
          font-size: 22px;
          font-weight: bold;
          color: #000000;
        }
        .section {
          margin-bottom: 30px;
          page-break-inside: avoid;
        }
        .section-title {
          font-size: 18px;
          font-weight: 700;
          margin-bottom: 15px;
          padding-bottom: 10px;
          border-bottom: 1px solid #cccccc;
          color: #000000;
        }
        .chart-container {
          text-align: center;
          margin: 20px 0;
          padding: 20px;
          background: #fafafa;
          border-radius: 12px;
        }
        .chart-container img {
          max-width: 100%;
          height: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 15px;
          font-size: 11px;
        }
        th, td {
          border: 1px solid #cccccc;
          padding: 10px;
          text-align: left;
        }
        th {
          background: #f5f5f5;
          font-weight: 700;
          color: #000000;
        }
        .text-right {
          text-align: right;
        }
        .text-center {
          text-align: center;
        }
        .footer {
          margin-top: 40px;
          text-align: center;
          font-size: 10px;
          color: #999999;
          border-top: 1px solid #cccccc;
          padding-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>RAB MONITORING REPORT</h1>
        <h2>Financial Report & Budget Tracking</h2>
        <p>Generated on: ${currentDate}</p>
      </div>
      
      <div class="summary-cards">
        <div class="summary-card">
          <h3>Total Projects</h3>
          <div class="value">${totalProjects}</div>
        </div>
        <div class="summary-card">
          <h3>Total Budget</h3>
          <div class="value">${formatRp(totalBudget)}</div>
        </div>
        <div class="summary-card">
          <h3>Total Realization</h3>
          <div class="value">${formatRp(totalRealization)}</div>
        </div>
        <div class="summary-card">
          <h3>Remaining Budget</h3>
          <div class="value">${formatRp(totalBudget - totalRealization)}</div>
        </div>
        <div class="summary-card">
          <h3>Over Budget Items</h3>
          <div class="value">${overBudgetItems}</div>
        </div>
      </div>
      
      <div class="summary-cards">
        <div class="summary-card">
          <h3>Pending Claims</h3>
          <div class="value">${pendingClaims}</div>
        </div>
        <div class="summary-card">
          <h3>Approved Claims</h3>
          <div class="value">${approvedClaims}</div>
        </div>
        <div class="summary-card">
          <h3>Rejected Claims</h3>
          <div class="value">${rejectedClaims}</div>
        </div>
        <div class="summary-card">
          <h3>Total RAB Items</h3>
          <div class="value">${rabItems.length}</div>
        </div>
      </div>
      
      ${barChartImage ? `
      <div class="section">
        <div class="section-title">Budget vs Realization Chart</div>
        <div class="chart-container">
          <img src="${barChartImage}" alt="Budget Chart" style="max-width: 100%;">
        </div>
      </div>
      ` : ''}
      
      ${chartImage ? `
      <div class="section">
        <div class="section-title">Trend Analysis Chart</div>
        <div class="chart-container">
          <img src="${chartImage}" alt="Trend Chart" style="max-width: 100%;">
        </div>
      </div>
      ` : ''}
      
      <div class="section">
        <div class="section-title">Detailed Project Breakdown</div>
        <table>
          <thead>
            <tr>
              <th>Item Name</th>
              <th class="text-right">Budget (IDR)</th>
              <th class="text-right">Realization (IDR)</th>
              <th class="text-right">Balance (IDR)</th>
              <th class="text-center">Usage %</th>
              <th class="text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            ${projectDetailsHtml}
          </tbody>
        </table>
      </div>
      
      <div class="section">
        <div class="section-title">Claim History</div>
        ${claims.length > 0 ? `
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Vendor</th>
              <th class="text-right">Amount</th>
              <th class="text-center">Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${claimsHtml}
          </tbody>
        </table>
        ` : '<p style="text-align: center; padding: 20px; color: #666666;">No claims data available.</p>'}
      </div>
      
      <div class="footer">
        <p>Report generated by RAB Monitoring System</p>
        <p>This is an automated system-generated report</p>
      </div>
    </body>
    </html>
  `;
  
  const opt = {
    margin: [0.5, 0.5, 0.5, 0.5],
    filename: `RAB_Report_${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, letterRendering: true, useCORS: true },
    jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' }
  };
  
  const element = document.createElement('div');
  element.innerHTML = reportHTML;
  document.body.appendChild(element);
  
  html2pdf().set(opt).from(element).save().then(() => {
    document.body.removeChild(element);
    triggerNotification('PDF report generated successfully!', true);
  }).catch(err => {
    document.body.removeChild(element);
    triggerNotification('Error generating PDF: ' + err.message, false, 'error');
  });
}

document.getElementById('downloadPDFBtn')?.addEventListener('click', downloadPDF);

// ==================== STORAGE SERVER (FILES) ====================
window.deleteTrueNasFileRecord = function(firebaseKey, fullPath) {
  if(!confirm("Delete this file permanently from storage?")) return;
  
  if (fullPath) {
    fetch(`${API_BASE_URL}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: fullPath })
    })
    .then(async res => {
      if(!res.ok) throw new Error("Failed to delete physical file");
      return res.json();
    })
    .then(() => {
      remove(ref(db, `truenasFiles/${firebaseKey}`)).then(() => {
        triggerNotification("File permanently deleted from storage.");
      });
    })
    .catch(err => {
      remove(ref(db, `truenasFiles/${firebaseKey}`)).then(() => {
        triggerNotification("Metadata removed from database.", false);
      });
    });
  } else {
    remove(ref(db, `truenasFiles/${firebaseKey}`)).then(() => {
      triggerNotification("File record removed from database.");
    });
  }
};

function renderTreeHierarchy() {
  const treeWrapper = document.getElementById('rootFileTreeDirectory');
  if (!treeWrapper) return;
  
  if (projects.length === 0) {
    treeWrapper.innerHTML = '<li><i class="fas fa-info-circle"></i> No projects available.</li>';
    return;
  }
  
  let innerLayoutCodeHtml = `<li><span class="root-node"><i class="fas fa-database"></i> Document Storage</span><ul class="nested-tree" style="list-style:none; padding-left:20px;">`;
  
  projects.forEach(p => {
    innerLayoutCodeHtml += `<li style="margin: 10px 0;"><span class="folder-node"><i class="fas fa-folder-open"></i> ${escapeHtml(p.name)}</span><ul class="nested-tree" style="list-style:none; padding-left:25px;">`;
    
    const projectFiles = truenasFiles.filter(f => f.projectId === p.id);
    if (projectFiles.length === 0) {
      innerLayoutCodeHtml += '<li class="file-node" style="color:#94a3b8; font-style:italic; padding: 5px 0;">No files</li>';
    } else {
      projectFiles.forEach(f => {
        const safeUrl = `${API_BASE_URL}/unduh-dokumen/${encodeURIComponent(p.name.replace(/[^a-zA-Z0-9_-]/g, '_'))}/${encodeURIComponent(f.fileName)}`;
        const fileSize = formatFileSize(f.fileSize);
        const uploadDate = f.timestamp ? new Date(f.timestamp).toLocaleDateString('id-ID') : (f.uploadedAt || '-');
        
        innerLayoutCodeHtml += `<li class="file-node" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #f8fafc; border-radius: 8px; margin: 5px 0;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <i class="fas fa-file-alt" style="color: #3b82f6;"></i>
            <div>
              <div style="font-weight: 500;">${escapeHtml(f.fileName)}</div>
              <div style="font-size: 0.7rem; color: #64748b;">
                <i class="fas fa-user"></i> ${escapeHtml(f.uploadedBy || 'System')} | 
                <i class="fas fa-calendar"></i> ${uploadDate} |
                <i class="fas fa-database"></i> ${fileSize}
              </div>
            </div>
          </div>
          <div class="action-links" style="display: flex; gap: 12px;">
            <a href="${safeUrl}" target="_blank" class="preview-link" style="color: #2563eb; text-decoration: none;">
              <i class="fas fa-eye"></i> Preview
            </a>
            ${currentRole === 'Administrator' ? 
              `<button onclick="deleteTrueNasFileRecord('${f.id}', '${f.fullServerDiskPath || ''}')" class="delete-file-btn" style="background: #fee2e2; border: none; padding: 4px 10px; border-radius: 6px; color: #dc2626; cursor: pointer;">
                <i class="fas fa-trash"></i> Delete
              </button>` : ''
            }
          </div>
        </li>`;
      });
    }
    
    innerLayoutCodeHtml += `</ul></li>`;
  });
  
  treeWrapper.innerHTML = innerLayoutCodeHtml + `</ul></li>`;
  
  if (projects.length > 0 && truenasFiles.length === 0) {
    const noFilesMsg = document.createElement('div');
    noFilesMsg.style.padding = '20px';
    noFilesMsg.style.textAlign = 'center';
    noFilesMsg.style.color = '#64748b';
    noFilesMsg.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Belum ada file yang diupload. Silakan upload dokumen melalui menu Upload Document.';
    if (treeWrapper.querySelectorAll('.file-node').length === 0 && projects.length > 0) {
      // Add message if no files exist
    }
  }
}

// ==================== UPLOAD DOCUMENT ====================
document.getElementById('startUploadDocBtn')?.addEventListener('click', () => {
  const pId = document.getElementById('uploadProjectSelect')?.value;
  const fileInput = document.getElementById('documentLocalFile');
  
  if (!pId) {
    triggerNotification('Pilih project target terlebih dahulu!', false, 'error');
    return;
  }
  
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    triggerNotification('Pilih file yang akan diupload!', false, 'error');
    return;
  }
  
  const file = fileInput.files[0];
  const resolvedProjectObj = projects.find(p => p.id === pId);
  
  if (!resolvedProjectObj) {
    triggerNotification('Project not found!', false, 'error');
    return;
  }
  
  if (file.size > 10 * 1024 * 1024) {
    triggerNotification('Ukuran file maksimal 10 MB!', false, 'error');
    return;
  }
  
  triggerNotification('Mengupload file...', true, 'info');
  
  const safeProjectDirName = resolvedProjectObj.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const serverStoragePath = `/mnt/EXTERNAL-4TB/Data/speakup/apps/rab/${safeProjectDirName}`;
  
  const dataPayload = new FormData();
  dataPayload.append('path', serverStoragePath);
  dataPayload.append('file', file);
  
  fetch(`${API_BASE_URL}/upload`, { method: 'POST', body: dataPayload })
    .then(async response => {
      if (!response.ok) throw new Error('Server rejected file upload');
      return response.json();
    })
    .then(data => {
      const newFileRef = push(ref(db, 'truenasFiles'));
      set(newFileRef, {
        projectId: pId,
        projectName: resolvedProjectObj.name,
        fileName: file.name,
        fileSize: file.size,
        uploadedBy: currentUserEmail,
        timestamp: Date.now(),
        uploadedAt: new Date().toLocaleString(),
        fullServerDiskPath: `${serverStoragePath}/${file.name}`
      }).then(() => {
        fileInput.value = '';
        document.getElementById('uploadProjectSelect').value = '';
        triggerNotification('File uploaded successfully to storage!', true);
      });
    })
    .catch(error => {
      console.error("Upload error:", error);
      triggerNotification(`Upload failed: ${error.message}`, false, 'error');
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
      setTimeout(() => renderReports(), 100);
      setTimeout(() => refreshGraphicCharts(), 150);
    }
    
    if (page === 'files') {
      setTimeout(() => renderTreeHierarchy(), 100);
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
      } else {
        set(ref(db, `users/${user.uid}`), {
          email: user.email,
          role: "Project Manager",
          createdAt: new Date().toLocaleDateString('id-ID')
        }).then(() => {
          currentRole = "Project Manager";
          const emailLabel = document.getElementById('sidebarUserEmail');
          const roleLabel = document.getElementById('sidebarUserRole');
          if (emailLabel) emailLabel.innerText = user.email;
          if (roleLabel) roleLabel.innerText = currentRole;
          enforceRoleVisibility();
          initCloudDatabaseListeners();
          hideLoadingScreen();
        });
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

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
let currentSelectedReportProject = "all";

// Chart instances
let mainBarChartInstance = null;
let reportPieChartInstance = null;
let reportDoughnutChartInstance = null;
let reportUtilizationChartInstance = null;

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

function getBadgeText(real, budget) {
  if (real > budget) return 'Over Budget';
  if (budget > 0 && (real / budget) >= 0.9) return 'Near Limit';
  return 'Safe';
}

function getProgressColor(percent) {
  if (percent >= 100) return '#ef4444';
  if (percent >= 90) return '#f59e0b';
  return '#10b981';
}

function createProgressBarMarkup(real, budget, progress = null) {
  let percent = 0;
  if (progress !== null && !isNaN(progress)) {
    percent = Math.min(Math.max(parseFloat(progress), 0), 100);
  } else if (budget > 0) {
    percent = Math.min(Math.round((real / budget) * 100), 100);
  }
  
  let barColor = getProgressColor(percent);

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

function formatDate(timestamp) {
  if (!timestamp) return '-';
  try {
    const date = new Date(timestamp);
    return date.toLocaleDateString('id-ID');
  } catch {
    return '-';
  }
}

// ==================== MANUAL PROGRESS UPDATE ====================
async function updateManualProgress(itemId, progressValue) {
  try {
    const progress = Math.min(Math.max(parseFloat(progressValue), 0), 100);
    await update(ref(db, `rabItems/${itemId}`), {
      manualProgress: progress,
      updatedAt: new Date().toLocaleString()
    });
    
    const progressElement = document.querySelector(`#progress_display_${itemId}`);
    if (progressElement) {
      const percent = progress;
      const barColor = getProgressColor(percent);
      const fillDiv = progressElement.querySelector('.progress-bar-fill');
      const labelSpan = progressElement.querySelector('.progress-percent-label');
      if (fillDiv) {
        fillDiv.style.width = `${percent}%`;
        fillDiv.style.backgroundColor = barColor;
      }
      if (labelSpan) labelSpan.innerText = `${percent}%`;
    }
    
    const rabItem = rabItems.find(r => r.id === itemId);
    if (rabItem) {
      rabItem.manualProgress = progress;
    }
    
    triggerNotification(`Progress updated to ${progress}%`, true);
    return { success: true };
  } catch (error) {
    console.error("Error updating progress:", error);
    triggerNotification("Failed to update progress!", false, 'error');
    return { success: false };
  }
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
    populateReportProjectSelect();
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
  renderReportsByProject();
  refreshGraphicCharts();
  renderReportDiagramsByProject();
  populateDropdownMenus();
}

function populateReportProjectSelect() {
  const reportSelect = document.getElementById('reportProjectSelect');
  if (reportSelect) {
    const oldVal = reportSelect.value;
    reportSelect.innerHTML = '<option value="all">-- Semua Project --</option>' + 
      projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    if (oldVal && (oldVal === 'all' || projects.find(p => p.id === oldVal))) {
      reportSelect.value = oldVal;
    }
    currentSelectedReportProject = reportSelect.value;
  }
}

function populateDropdownMenus() {
  const upSel = document.getElementById('uploadProjectSelect');
  if (upSel) {
    const valBackup = upSel.value;
    upSel.innerHTML = '<option value="">-- Select Target Project --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (valBackup) upSel.value = valBackup;
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
        <td>
          <button class="btn btn-primary btn-edit-proj" data-id="${p.id}" data-name="${p.name}" data-client="${p.client}" data-budget="${p.totalBudget}" style="padding: 4px 12px; font-size: 0.7rem; margin-right: 6px;"><i class="fas fa-edit"></i> Edit</button>
          <button class="btn btn-danger btn-del-proj" data-id="${p.id}" style="padding: 4px 12px; font-size: 0.7rem;"><i class="fas fa-trash"></i> Delete</button>
        </td>
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
    
    document.querySelectorAll('.btn-edit-proj').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        const client = btn.dataset.client;
        const budget = btn.dataset.budget;
        openEditProjectModal(id, name, client, budget);
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

function openEditProjectModal(id, name, client, budget) {
  document.getElementById('modalProjectId').value = id;
  document.getElementById('modalProjectName').value = name;
  document.getElementById('modalClientName').value = client;
  document.getElementById('modalBudget').value = budget;
  document.getElementById('projectModalTitle').innerHTML = '<i class="fas fa-edit"></i> Edit Project';
  document.getElementById('saveProjectBtn').innerHTML = '<i class="fas fa-save"></i> Update Project';
  document.getElementById('saveProjectBtn').onclick = updateProject;
  document.getElementById('projectModal').classList.add('active');
}

async function updateProject() {
  const id = document.getElementById('modalProjectId').value;
  const name = document.getElementById('modalProjectName').value.trim();
  const client = document.getElementById('modalClientName').value.trim();
  const budget = parseFloat(document.getElementById('modalBudget').value) || 0;
  
  if (!name || !client || budget <= 0) { 
    triggerNotification('Please fill all fields correctly!', false, 'error'); 
    return; 
  }
  
  try {
    await update(ref(db, `projects/${id}`), {
      name: name,
      client: client,
      totalBudget: budget
    });
    document.getElementById('projectModal').classList.remove('active');
    document.getElementById('modalProjectName').value = '';
    document.getElementById('modalClientName').value = '';
    document.getElementById('modalBudget').value = '';
    document.getElementById('modalProjectId').value = '';
    document.getElementById('projectModalTitle').innerHTML = '<i class="fas fa-folder-plus"></i> Add New Project';
    document.getElementById('saveProjectBtn').innerHTML = 'Save Project';
    document.getElementById('saveProjectBtn').onclick = saveNewProject;
    triggerNotification('Project updated successfully!');
  } catch (error) {
    console.error("Error updating project:", error);
    triggerNotification('Failed to update project!', false, 'error');
  }
}

async function saveNewProject() {
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
    document.getElementById('modalProjectId').value = '';
    document.getElementById('projectModalTitle').innerHTML = '<i class="fas fa-folder-plus"></i> Add New Project';
    document.getElementById('saveProjectBtn').innerHTML = 'Save Project';
    document.getElementById('saveProjectBtn').onclick = saveNewProject;
    triggerNotification('Project added successfully!');
  });
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
      <td>
        <button class="btn btn-primary btn-edit-rab-sub" data-id="${i.id}" data-name="${i.itemName}" data-budget="${i.budget}" style="padding: 4px 12px; font-size: 0.7rem; margin-right: 6px;"><i class="fas fa-edit"></i></button>
        <button class="btn btn-danger btn-del-rab-sub" data-id="${i.id}" style="padding: 4px 12px; font-size: 0.7rem;"><i class="fas fa-trash"></i></button>
      </td>
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
  
  document.querySelectorAll('.btn-edit-rab-sub').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const name = btn.dataset.name;
      const budget = btn.dataset.budget;
      openEditRABModal(id, name, budget);
    });
  });
}

function openEditRABModal(id, name, budget) {
  document.getElementById('rabItemId').value = id;
  document.getElementById('rabItemName').value = name;
  document.getElementById('rabBudget').value = budget;
  document.getElementById('rabModalTitle').innerHTML = '<i class="fas fa-edit"></i> Edit RAB Component';
  document.getElementById('saveRabBtn').innerHTML = '<i class="fas fa-save"></i> Update Item';
  document.getElementById('saveRabBtn').onclick = updateRABItem;
  document.getElementById('rabModal').classList.add('active');
}

async function updateRABItem() {
  const id = document.getElementById('rabItemId').value;
  const name = document.getElementById('rabItemName').value.trim();
  const budget = parseFloat(document.getElementById('rabBudget').value) || 0;
  
  if (!name || budget <= 0) { 
    triggerNotification('Please fill item name and budget correctly!', false, 'error'); 
    return; 
  }
  
  try {
    await update(ref(db, `rabItems/${id}`), {
      itemName: name,
      budget: budget
    });
    document.getElementById('rabModal').classList.remove('active');
    document.getElementById('rabItemName').value = '';
    document.getElementById('rabBudget').value = '';
    document.getElementById('rabItemId').value = '';
    document.getElementById('rabModalTitle').innerHTML = '<i class="fas fa-plus-circle"></i> Add RAB Component';
    document.getElementById('saveRabBtn').innerHTML = 'Save Item';
    document.getElementById('saveRabBtn').onclick = saveNewRABItem;
    triggerNotification('RAB item updated successfully!');
  } catch (error) {
    console.error("Error updating RAB item:", error);
    triggerNotification('Failed to update RAB item!', false, 'error');
  }
}

async function saveNewRABItem() {
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
    realisasi: 0,
    manualProgress: 0
  }).then(() => {
    document.getElementById('rabModal').classList.remove('active');
    document.getElementById('rabItemName').value = '';
    document.getElementById('rabBudget').value = '';
    document.getElementById('rabItemId').value = '';
    document.getElementById('rabModalTitle').innerHTML = '<i class="fas fa-plus-circle"></i> Add RAB Component';
    document.getElementById('saveRabBtn').innerHTML = 'Save Item';
    document.getElementById('saveRabBtn').onclick = saveNewRABItem;
    triggerNotification('RAB item added successfully!');
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

document.getElementById('reportProjectSelect')?.addEventListener('change', (e) => {
  currentSelectedReportProject = e.target.value;
  renderReportsByProject();
  renderReportDiagramsByProject();
});

document.getElementById('saveProjectBtn')?.addEventListener('click', saveNewProject);

document.getElementById('openRABModalBtn')?.addEventListener('click', () => {
  if (!currentSelectedProjectId) { 
    triggerNotification('Please select a project first!', false, 'error'); 
    return; 
  }
  const proj = projects.find(p => p.id === currentSelectedProjectId);
  document.getElementById('rabModalProjectName').value = proj ? proj.name : '';
  document.getElementById('rabItemName').value = '';
  document.getElementById('rabBudget').value = '';
  document.getElementById('rabItemId').value = '';
  document.getElementById('rabModalTitle').innerHTML = '<i class="fas fa-plus-circle"></i> Add RAB Component';
  document.getElementById('saveRabBtn').innerHTML = 'Save Item';
  document.getElementById('saveRabBtn').onclick = saveNewRABItem;
  document.getElementById('rabModal').classList.add('active');
});

document.getElementById('saveRabBtn')?.addEventListener('click', saveNewRABItem);

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
    
    return `<tr class="project-row" data-id="${p.id}" style="cursor:pointer;">
      <td><i class="fas fa-folder"></i> ${p.name}</td>
      <td>${p.client}</td>
      <td>${formatRp(p.totalBudget)}</td>
      <td style="color:#2563eb; font-weight:700;">${formatRp(spent)}</td>
      <td>${status}</td>
    </tr>`;
  }).join('');
  
  document.querySelectorAll('#monitoringMainGridBody .project-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const projectId = row.getAttribute('data-id');
      if (projectId) {
        openMonitoringDetail(projectId);
      }
    });
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
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No components yet</td></tr>';
    } else {
      tbody.innerHTML = items.map(i => {
        const progressPercent = i.manualProgress !== undefined && i.manualProgress !== null ? i.manualProgress : (i.budget > 0 ? Math.min(Math.round((i.realisasi / i.budget) * 100), 100) : 0);
        const barColor = getProgressColor(progressPercent);
        return `<tr>
          <td><strong>${i.itemName}</strong></td>
          <td>${formatRp(i.budget)}</td>
          <td>${formatRp(i.realisasi)}</td>
          <td style="color:${(i.budget - i.realisasi) < 0 ? '#ef4444' : '#10b981'}">${formatRp(i.budget - i.realisasi)}</td>
          <td>${getBadge(i.realisasi, i.budget)}</td>
          <td>
            <div class="progress-wrapper" id="progress_display_${i.id}">
              <div class="progress-bar-container">
                <div class="progress-bar-fill" style="width: ${progressPercent}%; background-color: ${barColor};"></div>
              </div>
              <span class="progress-percent-label">${progressPercent}%</span>
            </div>
             </td>
          <td>
            <div class="manual-progress-group">
              <input type="number" class="manual-progress-input" id="progress_input_${i.id}" value="${progressPercent}" min="0" max="100" step="1" style="width:70px;">
              <button class="progress-update-btn" data-id="${i.id}"><i class="fas fa-save"></i> Set</button>
            </div>
             </td>
        </tr>`;
      }).join('');
      
      document.querySelectorAll('.progress-update-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const itemId = btn.getAttribute('data-id');
          const input = document.getElementById(`progress_input_${itemId}`);
          const newProgress = parseFloat(input.value);
          if (!isNaN(newProgress) && newProgress >= 0 && newProgress <= 100) {
            await updateManualProgress(itemId, newProgress);
            input.value = newProgress;
          } else {
            triggerNotification('Please enter a value between 0 and 100', false, 'error');
          }
        });
      });
    }
  }
  document.getElementById('monitoringDetailsModal').classList.add('active');
}

// ==================== REPORTS PER PROJECT ====================
function renderReportsByProject() {
  const tbody = document.getElementById('reportsTableGridBody');
  if (!tbody) return;
  
  let filteredProjects = projects;
  let filteredRabItems = rabItems;
  
  if (currentSelectedReportProject !== 'all') {
    filteredProjects = projects.filter(p => p.id === currentSelectedReportProject);
    filteredRabItems = rabItems.filter(i => i.projectId === currentSelectedReportProject);
  }
  
  if (filteredProjects.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No projects available</td></tr>';
    return;
  }
  
  let html = '';
  filteredProjects.forEach(p => {
    const items = filteredRabItems.filter(i => i.projectId === p.id);
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
      <td class="text-center"></td>
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
}

// ==================== REPORT DIAGRAMS PER PROJECT ====================
function renderReportDiagramsByProject() {
  let filteredProjects = projects;
  let filteredRabItems = rabItems;
  
  if (currentSelectedReportProject !== 'all') {
    filteredProjects = projects.filter(p => p.id === currentSelectedReportProject);
    filteredRabItems = rabItems.filter(i => i.projectId === currentSelectedReportProject);
  }
  
  if (filteredProjects.length === 0) {
    if (reportPieChartInstance) reportPieChartInstance.destroy();
    if (reportDoughnutChartInstance) reportDoughnutChartInstance.destroy();
    if (reportUtilizationChartInstance) reportUtilizationChartInstance.destroy();
    return;
  }
  
  const projectNames = filteredProjects.map(p => p.name.length > 12 ? p.name.substring(0, 10) + '...' : p.name);
  const totalBudgets = filteredProjects.map(p => 
    filteredRabItems.filter(i => i.projectId === p.id).reduce((sum, i) => sum + i.budget, 0)
  );
  
  const pieCtx = document.getElementById('reportPieChart')?.getContext('2d');
  if (pieCtx) {
    if (reportPieChartInstance) reportPieChartInstance.destroy();
    reportPieChartInstance = new Chart(pieCtx, {
      type: 'pie',
      data: {
        labels: projectNames,
        datasets: [{ 
          data: totalBudgets, 
          backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'] 
        }]
      },
      options: { 
        responsive: true, 
        maintainAspectRatio: true, 
        plugins: { 
          tooltip: { 
            callbacks: { 
              label: (ctx) => {
                const total = totalBudgets.reduce((a,b) => a + b, 0);
                const percentage = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                return `${ctx.label}: ${formatRp(ctx.raw)} (${percentage}%)`;
              } 
            } 
          } 
        } 
      }
    });
  }
  
  const filteredItems = filteredRabItems;
  const overBudget = filteredItems.filter(i => i.realisasi > i.budget).length;
  const nearLimit = filteredItems.filter(i => i.budget > 0 && (i.realisasi / i.budget) >= 0.9 && i.realisasi <= i.budget).length;
  const safe = filteredItems.filter(i => i.budget > 0 && (i.realisasi / i.budget) < 0.9 && i.realisasi <= i.budget).length;
  
  const doughnutCtx = document.getElementById('reportDoughnutChart')?.getContext('2d');
  if (doughnutCtx) {
    if (reportDoughnutChartInstance) reportDoughnutChartInstance.destroy();
    reportDoughnutChartInstance = new Chart(doughnutCtx, {
      type: 'doughnut',
      data: {
        labels: ['Over Budget', 'Near Limit', 'Safe'],
        datasets: [{ data: [overBudget, nearLimit, safe], backgroundColor: ['#ef4444', '#f59e0b', '#10b981'] }]
      },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } }
    });
  }
  
  const utilization = filteredProjects.map(p => {
    const budget = filteredRabItems.filter(i => i.projectId === p.id).reduce((sum, i) => sum + i.budget, 0);
    const real = filteredRabItems.filter(i => i.projectId === p.id).reduce((sum, i) => sum + i.realisasi, 0);
    return budget > 0 ? Math.min(Math.round((real / budget) * 100), 100) : 0;
  });
  
  const utilCtx = document.getElementById('reportUtilizationChart')?.getContext('2d');
  if (utilCtx) {
    if (reportUtilizationChartInstance) reportUtilizationChartInstance.destroy();
    reportUtilizationChartInstance = new Chart(utilCtx, {
      type: 'bar',
      data: {
        labels: projectNames,
        datasets: [{ 
          label: 'Budget Utilization (%)', 
          data: utilization, 
          backgroundColor: (ctx) => {
            const val = ctx.raw;
            if (val >= 100) return '#ef4444';
            if (val >= 90) return '#f59e0b';
            return '#10b981';
          }, 
          borderRadius: 6 
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: true,
        scales: { x: { max: 100, ticks: { callback: (val) => val + '%' } } },
        plugins: { tooltip: { callbacks: { label: (ctx) => `Utilization: ${ctx.raw}%` } } }
      }
    });
  }
}

// ==================== PDF DOWNLOAD - FIXED WORKING VERSION ====================
async function downloadPDF() {
  const downloadBtn = document.getElementById('downloadPDFBtn');
  const originalBtnText = downloadBtn?.innerHTML;
  
  if (downloadBtn) {
    downloadBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Generating PDF...';
    downloadBtn.disabled = true;
  }
  
  try {
    triggerNotification('Membuat PDF report... Mohon tunggu', true, 'info');
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const currentDate = new Date().toLocaleDateString('id-ID', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    const currentTime = new Date().toLocaleTimeString('id-ID');
    
    let filteredProjects = [...projects];
    let filteredRabItems = [...rabItems];
    let filteredClaims = [...claims];
    
    if (currentSelectedReportProject !== 'all') {
      filteredProjects = projects.filter(p => p.id === currentSelectedReportProject);
      filteredRabItems = rabItems.filter(i => i.projectId === currentSelectedReportProject);
      filteredClaims = claims.filter(c => c.projectId === currentSelectedReportProject);
    }
    
    if (filteredProjects.length === 0) {
      triggerNotification('Tidak ada data untuk project yang dipilih!', false, 'error');
      if (downloadBtn) {
        downloadBtn.innerHTML = originalBtnText;
        downloadBtn.disabled = false;
      }
      return;
    }
    
    // Calculate summary statistics
    const totalBudget = filteredRabItems.reduce((sum, i) => sum + (parseFloat(i.budget) || 0), 0);
    const totalRealization = filteredRabItems.reduce((sum, i) => sum + (parseFloat(i.realisasi) || 0), 0);
    const totalProjects = filteredProjects.length;
    const totalRabItemsCount = filteredRabItems.length;
    const overBudgetItems = filteredRabItems.filter(i => i.realisasi > i.budget).length;
    const nearLimitItems = filteredRabItems.filter(i => i.budget > 0 && (i.realisasi / i.budget) >= 0.9 && i.realisasi <= i.budget).length;
    const safeItems = filteredRabItems.filter(i => i.budget > 0 && (i.realisasi / i.budget) < 0.9 && i.realisasi <= i.budget).length;
    const pendingClaims = filteredClaims.filter(c => c.status === 'pending').length;
    const approvedClaims = filteredClaims.filter(c => c.status === 'approved').length;
    const rejectedClaims = filteredClaims.filter(c => c.status === 'rejected').length;
    const totalClaimsAmount = filteredClaims.reduce((sum, c) => sum + (c.totalNominal || 0), 0);
    
    // Build project details HTML
    let projectDetailsHtml = '';
    let grandTotalBudget = 0;
    let grandTotalRealization = 0;
    
    for (const p of filteredProjects) {
      const projectItems = filteredRabItems.filter(i => i.projectId === p.id);
      const projectBudget = projectItems.reduce((sum, i) => sum + i.budget, 0);
      const projectRealization = projectItems.reduce((sum, i) => sum + i.realisasi, 0);
      const projectBalance = projectBudget - projectRealization;
      const percentage = projectBudget > 0 ? ((projectRealization / projectBudget) * 100).toFixed(1) : 0;
      
      grandTotalBudget += projectBudget;
      grandTotalRealization += projectRealization;
      
      projectDetailsHtml += `
        <div style="margin-bottom: 20px; border: 1px solid #d1d5db; border-radius: 8px; page-break-inside: avoid;">
          <div style="padding: 12px 16px; background: #f3f4f6; border-bottom: 1px solid #d1d5db;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
              <div>
                <h3 style="margin: 0 0 4px 0; font-size: 14px; font-weight: bold; color: #111827;">${escapeHtml(p.name)}</h3>
                <p style="margin: 0; font-size: 10px; color: #4b5563;">Client: ${escapeHtml(p.client)}</p>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 11px; color: #374151;">Initial Budget: ${formatRp(p.totalBudget)}</div>
                <div style="font-size: 10px; color: #6b7280;">Remaining: ${formatRp(p.totalBudget - projectRealization)}</div>
              </div>
            </div>
          </div>
          
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: #e5e7eb;">
            <div style="background: #f0fdf4; padding: 8px 10px; text-align: center;">
              <div style="font-size: 8px; color: #166534;">Total Budget</div>
              <div style="font-size: 11px; font-weight: bold; color: #166534;">${formatRp(projectBudget)}</div>
            </div>
            <div style="background: #eff6ff; padding: 8px 10px; text-align: center;">
              <div style="font-size: 8px; color: #1e40af;">Realisasi</div>
              <div style="font-size: 11px; font-weight: bold; color: #1e40af;">${formatRp(projectRealization)}</div>
            </div>
            <div style="background: #fef3c7; padding: 8px 10px; text-align: center;">
              <div style="font-size: 8px; color: #92400e;">Sisa</div>
              <div style="font-size: 11px; font-weight: bold; color: #92400e;">${formatRp(projectBalance)}</div>
            </div>
            <div style="background: ${percentage >= 90 ? '#fee2e2' : (percentage >= 70 ? '#fef3c7' : '#f0fdf4')}; padding: 8px 10px; text-align: center;">
              <div style="font-size: 8px; color: #475569;">Utilisasi</div>
              <div style="font-size: 11px; font-weight: bold;">${percentage}%</div>
            </div>
          </div>
      `;
      
      if (projectItems.length === 0) {
        projectDetailsHtml += `<div style="text-align: center; padding: 16px; color: #6b7280; background: #ffffff;">Tidak ada item RAB untuk project ini</div>`;
      } else {
        projectDetailsHtml += `
          <div style="overflow-x: auto; background: #ffffff;">
            <table style="width: 100%; border-collapse: collapse; font-size: 9px;">
              <thead>
                <tr style="background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                  <th style="padding: 6px 8px; text-align: left;">Item Name</th>
                  <th style="padding: 6px 8px; text-align: right;">Budget</th>
                  <th style="padding: 6px 8px; text-align: right;">Realisasi</th>
                  <th style="padding: 6px 8px; text-align: right;">Sisa</th>
                  <th style="padding: 6px 8px; text-align: center;">Usage</th>
                </tr>
              </thead>
              <tbody>
        `;
        
        for (const item of projectItems) {
          const itemBalance = item.budget - item.realisasi;
          const itemPercentage = item.budget > 0 ? ((item.realisasi / item.budget) * 100).toFixed(1) : 0;
          
          projectDetailsHtml += `
            <tr style="border-bottom: 1px solid #f3f4f6;">
              <td style="padding: 6px 8px; text-align: left;">${escapeHtml(item.itemName)}</td>
              <td style="padding: 6px 8px; text-align: right;">${formatRp(item.budget)}</td>
              <td style="padding: 6px 8px; text-align: right;">${formatRp(item.realisasi)}</td>
              <td style="padding: 6px 8px; text-align: right; color: ${itemBalance < 0 ? '#dc2626' : '#059669'};">${formatRp(itemBalance)}</td>
              <td style="padding: 6px 8px; text-align: center;">${itemPercentage}%</td>
            </tr>
          `;
        }
        
        projectDetailsHtml += `
              </tbody>
            </table>
          </div>
        `;
      }
      
      projectDetailsHtml += `</div>`;
    }
    
    // Build claims HTML
    let claimsHtml = '';
    if (filteredClaims.length > 0) {
      for (const c of filteredClaims) {
        const p = filteredProjects.find(pr => pr.id === c.projectId);
        const statusColor = c.status === 'approved' ? '#065f46' : (c.status === 'rejected' ? '#991b1b' : '#9a3412');
        const statusBg = c.status === 'approved' ? '#d1fae5' : (c.status === 'rejected' ? '#fee2e2' : '#fed7aa');
        
        claimsHtml += `
          <div style="border: 1px solid #d1d5db; border-radius: 8px; margin-bottom: 12px; page-break-inside: avoid;">
            <div style="padding: 8px 12px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; flex-wrap: wrap;">
              <div>
                <strong style="font-size: 11px;">${p ? escapeHtml(p.name) : 'Unknown Project'}</strong>
                <span style="margin-left: 8px; display: inline-block; padding: 2px 8px; border-radius: 12px; background: ${statusBg}; color: ${statusColor}; font-size: 8px; font-weight: bold;">${c.status.toUpperCase()}</span>
              </div>
              <div style="font-size: 10px; color: #4b5563;">Total: ${formatRp(c.totalNominal)}</div>
            </div>
            <div style="padding: 6px 12px; font-size: 9px; color: #6b7280; background: #ffffff; border-bottom: 1px solid #f3f4f6;">
              Submitted: ${formatDate(c.timestamp)}
            </div>
            <div style="padding: 8px 12px; background: #ffffff;">
              <table style="width: 100%; border-collapse: collapse; font-size: 8px;">
                <thead>
                  <tr style="background: #f9fafb;">
                    <th style="padding: 4px 6px; text-align: left;">Item</th>
                    <th style="padding: 4px 6px; text-align: right;">Amount</th>
                    <th style="padding: 4px 6px; text-align: left;">Vendor</th>
                    <th style="padding: 4px 6px; text-align: left;">Date</th>
                  </tr>
                </thead>
                <tbody>
        `;
        
        if (c.items && c.items.length > 0) {
          for (const item of c.items) {
            const rab = filteredRabItems.find(r => r.id === item.itemId);
            claimsHtml += `
              <tr style="border-bottom: 1px solid #f3f4f6;">
                <td style="padding: 4px 6px;">${rab ? escapeHtml(rab.itemName) : '-'}</td>
                <td style="padding: 4px 6px; text-align: right;">${formatRp(item.nominal)}</td>
                <td style="padding: 4px 6px;">${escapeHtml(item.vendor || '-')}</td>
                <td style="padding: 4px 6px;">${item.tanggal || '-'}</td>
              </tr>
            `;
          }
        }
        
        claimsHtml += `
                </tbody>
              </table>
            </div>
          </div>
        `;
      }
    } else {
      claimsHtml = '<div style="text-align: center; padding: 16px; color: #6b7280; background: #f9fafb; border-radius: 8px;">Tidak ada data klaim untuk project yang dipilih</div>';
    }
    
    const projectNameForTitle = currentSelectedReportProject !== 'all' && filteredProjects.length === 1
      ? filteredProjects[0].name
      : (currentSelectedReportProject !== 'all' ? `Selected Projects (${filteredProjects.length})` : 'All Projects');
    
    const reportTitle = `RAB_Report_${projectNameForTitle.replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}`;
    
    // Create a temporary div for PDF content
    const pdfContainer = document.createElement('div');
    pdfContainer.style.position = 'absolute';
    pdfContainer.style.left = '-9999px';
    pdfContainer.style.top = '-9999px';
    pdfContainer.style.width = '210mm';
    pdfContainer.style.backgroundColor = 'white';
    pdfContainer.style.padding = '20px';
    pdfContainer.style.fontFamily = "'Segoe UI', 'Inter', Arial, sans-serif";
    
    pdfContainer.innerHTML = `
      <div style="text-align: center; margin-bottom: 20px; border-bottom: 2px solid #111827; padding-bottom: 12px;">
        <h1 style="font-size: 18px; margin: 0; color: #111827; font-weight: 700;">RAB Report - ${escapeHtml(projectNameForTitle)}</h1>
        <h2 style="font-size: 11px; margin: 5px 0 0; color: #4b5563; font-weight: normal;">Laporan Monitoring Anggaran & Realisasi</h2>
        <p style="font-size: 9px; margin: 5px 0 0; color: #6b7280;">Dibuat pada: ${currentDate} pukul ${currentTime} | Oleh: ${escapeHtml(currentUserEmail)}</p>
      </div>
      
      <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px;">
        <div style="flex: 1; min-width: 90px; background: #f9fafb; padding: 8px 6px; border-radius: 6px; text-align: center; border: 1px solid #e5e7eb;">
          <div style="font-size: 7px; color: #6b7280; text-transform: uppercase;">Total Project</div>
          <div style="font-size: 12px; font-weight: bold;">${totalProjects}</div>
        </div>
        <div style="flex: 1; min-width: 90px; background: #f9fafb; padding: 8px 6px; border-radius: 6px; text-align: center; border: 1px solid #e5e7eb;">
          <div style="font-size: 7px; color: #6b7280; text-transform: uppercase;">Total Item RAB</div>
          <div style="font-size: 12px; font-weight: bold;">${totalRabItemsCount}</div>
        </div>
        <div style="flex: 1; min-width: 90px; background: #f9fafb; padding: 8px 6px; border-radius: 6px; text-align: center; border: 1px solid #e5e7eb;">
          <div style="font-size: 7px; color: #6b7280; text-transform: uppercase;">Total Anggaran</div>
          <div style="font-size: 12px; font-weight: bold;">${formatRp(totalBudget)}</div>
        </div>
        <div style="flex: 1; min-width: 90px; background: #f9fafb; padding: 8px 6px; border-radius: 6px; text-align: center; border: 1px solid #e5e7eb;">
          <div style="font-size: 7px; color: #6b7280; text-transform: uppercase;">Total Realisasi</div>
          <div style="font-size: 12px; font-weight: bold;">${formatRp(totalRealization)}</div>
        </div>
        <div style="flex: 1; min-width: 90px; background: #f9fafb; padding: 8px 6px; border-radius: 6px; text-align: center; border: 1px solid #e5e7eb;">
          <div style="font-size: 7px; color: #6b7280; text-transform: uppercase;">Sisa Anggaran</div>
          <div style="font-size: 12px; font-weight: bold; color: #059669;">${formatRp(totalBudget - totalRealization)}</div>
        </div>
      </div>
      
      <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px;">
        <div style="flex: 1; min-width: 90px; background: #f9fafb; padding: 8px 6px; border-radius: 6px; text-align: center; border: 1px solid #e5e7eb;">
          <div style="font-size: 7px; color: #6b7280; text-transform: uppercase;">Over Budget</div>
          <div style="font-size: 12px; font-weight: bold; color: #dc2626;">${overBudgetItems}</div>
        </div>
        <div style="flex: 1; min-width: 90px; background: #f9fafb; padding: 8px 6px; border-radius: 6px; text-align: center; border: 1px solid #e5e7eb;">
          <div style="font-size: 7px; color: #6b7280; text-transform: uppercase;">Near Limit</div>
          <div style="font-size: 12px; font-weight: bold; color: #d97706;">${nearLimitItems}</div>
        </div>
        <div style="flex: 1; min-width: 90px; background: #f9fafb; padding: 8px 6px; border-radius: 6px; text-align: center; border: 1px solid #e5e7eb;">
          <div style="font-size: 7px; color: #6b7280; text-transform: uppercase;">Safe</div>
          <div style="font-size: 12px; font-weight: bold; color: #059669;">${safeItems}</div>
        </div>
        <div style="flex: 1; min-width: 90px; background: #f9fafb; padding: 8px 6px; border-radius: 6px; text-align: center; border: 1px solid #e5e7eb;">
          <div style="font-size: 7px; color: #6b7280; text-transform: uppercase;">Klaim Pending</div>
          <div style="font-size: 12px; font-weight: bold; color: #d97706;">${pendingClaims}</div>
        </div>
        <div style="flex: 1; min-width: 90px; background: #f9fafb; padding: 8px 6px; border-radius: 6px; text-align: center; border: 1px solid #e5e7eb;">
          <div style="font-size: 7px; color: #6b7280; text-transform: uppercase;">Klaim Approved</div>
          <div style="font-size: 12px; font-weight: bold; color: #059669;">${approvedClaims}</div>
        </div>
      </div>
      
      <div style="margin-bottom: 20px;">
        <div style="font-size: 13px; font-weight: bold; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 1.5px solid #111827;">📋 Detail Breakdown per Project</div>
        ${projectDetailsHtml}
        <div style="margin-top: 12px; background: #f3f4f6; padding: 8px 12px; border-radius: 6px; display: flex; justify-content: space-between; font-weight: bold; font-size: 10px;">
          <span>GRAND TOTAL</span>
          <span>Budget: ${formatRp(grandTotalBudget)}</span>
          <span>Realisasi: ${formatRp(grandTotalRealization)}</span>
          <span>Sisa: ${formatRp(grandTotalBudget - grandTotalRealization)}</span>
        </div>
      </div>
      
      <div style="margin-bottom: 20px;">
        <div style="font-size: 13px; font-weight: bold; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 1.5px solid #111827;">📝 Riwayat Klaim</div>
        ${claimsHtml}
      </div>
      
      <div style="margin-top: 20px; text-align: center; font-size: 7px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 8px;">
        <p>Laporan ini dibuat secara otomatis oleh Sistem Monitoring RAB</p>
        <p>&copy; ${new Date().getFullYear()} - RAB Monitoring System</p>
      </div>
    `;
    
    document.body.appendChild(pdfContainer);
    
    const opt = {
      margin: [0.5, 0.5, 0.5, 0.5],
      filename: `${reportTitle}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, letterRendering: true, useCORS: true, logging: false },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
    };
    
    await html2pdf().set(opt).from(pdfContainer).save();
    
    document.body.removeChild(pdfContainer);
    triggerNotification('PDF report berhasil dibuat!', true);
    
  } catch (err) {
    console.error("PDF Error:", err);
    triggerNotification('Error generating PDF: ' + err.message, false, 'error');
  } finally {
    if (downloadBtn) {
      downloadBtn.innerHTML = originalBtnText;
      downloadBtn.disabled = false;
    }
  }
}

// ==================== STORAGE SERVER (FILES) ====================
document.getElementById('trueNasUploadForm')?.addEventListener('submit', function(e) {
  e.preventDefault();
  const fileInputElement = document.getElementById('trueNasFile');
  const attachedProjectId = document.getElementById('uploadProjectSelect').value;

  if (!attachedProjectId || fileInputElement.files.length === 0) {
    triggerNotification('Invalid file or project data!', false, 'error');
    return;
  }

  const fileObj = fileInputElement.files[0];
  const resolvedProjectObj = projects.find(p => p.id === attachedProjectId);
  
  if (!resolvedProjectObj) {
    triggerNotification('Project not found!', false, 'error');
    return;
  }
  
  if (fileObj.size > 10 * 1024 * 1024) {
    triggerNotification('File size maximum 10 MB!', false, 'error');
    return;
  }
  
  triggerNotification('Uploading file...', true, 'info');
  
  const safeProjectDirName = resolvedProjectObj.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const serverStoragePath = `/mnt/EXTERNAL-4TB/Data/speakup/apps/rab/${safeProjectDirName}`;

  const dataPayload = new FormData();
  dataPayload.append('path', serverStoragePath); 
  dataPayload.append('file', fileObj);

  fetch(`${API_BASE_URL}/upload`, { method: 'POST', body: dataPayload })
  .then(async response => {
    if (!response.ok) throw new Error('Server rejected file upload');
    return response.json();
  })
  .then(data => {
    const pushedFileRef = push(ref(db, 'truenasFiles'));
    set(pushedFileRef, {
      projectId: attachedProjectId,
      projectName: resolvedProjectObj.name,
      fileName: fileObj.name,
      fileSize: fileObj.size,
      uploadedBy: currentUserEmail,
      timestamp: Date.now(),
      uploadedAt: new Date().toLocaleString(),
      fullServerDiskPath: `${serverStoragePath}/${fileObj.name}`
    }).then(() => {
      fileInputElement.value = '';
      document.getElementById('uploadProjectSelect').value = '';
      triggerNotification('File uploaded successfully to storage!', true);
    });
  })
  .catch(error => {
    console.error("Upload error:", error);
    triggerNotification(`Upload failed: ${error.message}`, false, 'error');
  });
});

window.deleteTrueNasFileRecord = function(firebaseKey, fullPath) {
  if(!confirm("Delete this file permanently from storage?")) return;

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
}

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
}

// ==================== MODAL CONTROLS ====================
document.getElementById('openProjectModalBtn')?.addEventListener('click', () => {
  document.getElementById('modalProjectId').value = '';
  document.getElementById('modalProjectName').value = '';
  document.getElementById('modalClientName').value = '';
  document.getElementById('modalBudget').value = '';
  document.getElementById('projectModalTitle').innerHTML = '<i class="fas fa-folder-plus"></i> Add New Project';
  document.getElementById('saveProjectBtn').innerHTML = 'Save Project';
  document.getElementById('saveProjectBtn').onclick = saveNewProject;
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
      setTimeout(() => renderReportsByProject(), 100);
      setTimeout(() => renderReportDiagramsByProject(), 150);
    }
    
    if (page === 'files') {
      setTimeout(() => renderTreeHierarchy(), 100);
    }
  });
});

document.getElementById('downloadPDFBtn')?.addEventListener('click', downloadPDF);

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
    currentUserEmail = '';
    
    const emailLabel = document.getElementById('sidebarUserEmail');
    const roleLabel = document.getElementById('sidebarUserRole');
    if (emailLabel) emailLabel.innerText = 'Not Logged In';
    if (roleLabel) roleLabel.innerText = currentRole;
    
    enforceRoleVisibility();
    initCloudDatabaseListeners();
  }
});

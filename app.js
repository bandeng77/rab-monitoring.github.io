import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getDatabase, ref, set, onValue, push, remove, update, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ==================== CONFIGURATIONS AND INITIALIZATION ====================
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

// Global State Arrays Mapping Data Objects
let projects = [];
let rabItems = [];
let claims = [];
let users = [];
let truenasFiles = [];

// App Core State Context Pointers
let currentSelectedProjectId = null;
let currentRole = ""; 
let currentUserEmail = "";
let claimItemsListArray = [];
let reportsBarChartInstance = null;

const rolePermissions = {
  "Administrator": ['dashboard', 'master-project', 'claim-request', 'approval-budget', 'monitoring', 'reports', 'upload-document', 'files', 'user-management'],
  "Finance": ['dashboard', 'approval-budget', 'claim-request', 'reports', 'upload-document', 'files'],
  "Project Manager": ['dashboard', 'master-project', 'claim-request', 'monitoring', 'upload-document', 'files']
};

// ==================== HELPER CORE UTILITIES ====================
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
  setTimeout(() => { popup.classList.remove('active'); }, 4000);
}

function formatRp(val) { 
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(val || 0); 
}

function getBadge(real, budget) { 
  if (real > budget) return '<span class="badge badge-danger">Over Budget</span>'; 
  if (budget > 0 && (real / budget) >= 0.9) return '<span class="badge badge-warning">Near Limit</span>'; 
  return '<span class="badge badge-success">Safe</span>'; 
}

// ==================== USER DATA PROTOCOLS & IMPLEMENTATION ====================
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
    triggerNotification(`Identity account user ${email} successfully written!`, true);
    return { success: true };
  } catch (error) {
    let msg = "Error: " + error.message;
    if (error.code === 'auth/email-already-in-use') msg = "This operational email address already exists!";
    triggerNotification(msg, false, 'error');
    return { success: false };
  }
}

async function updateUserRole(uid, newRole) {
  try {
    await update(ref(db, `users/${uid}`), { role: newRole, updatedAt: new Date().toLocaleDateString('id-ID') });
    triggerNotification(`Account user privilege mapping mutated to ${newRole}!`, true);
    return { success: true };
  } catch (error) {
    triggerNotification("Access profile mutation failed!", false, 'error');
    return { success: false };
  }
}

async function resetUserPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    triggerNotification(`Reset signature matrix dispatched to link email ${email}.`, true, 'info');
    return { success: true };
  } catch (error) {
    triggerNotification("Crypto link signature allocation error.", false, 'error');
    return { success: false };
  }
}

async function deleteUserAccount(uid, email) {
  try {
    await remove(ref(db, `users/${uid}`));
    triggerNotification(`User instance completely decoupled from data cluster: ${email}`, true, 'info');
    return { success: true };
  } catch (error) {
    triggerNotification("IAM network termination error.", false, 'error');
    return { success: false };
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
     const fallbackBtn = document.querySelector('#sidebarMenu li[data-page="dashboard"]');
     if(fallbackBtn) fallbackBtn.click();
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
  
  const claimSel = document.getElementById('claimProjectSelect');
  if (claimSel) {
    const valBackupClaim = claimSel.value;
    claimSel.innerHTML = '<option value="">-- Select Project --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (valBackupClaim) claimSel.value = valBackupClaim;
  }
}

// ==================== ENGINE MODULE PANELS RENDERING ====================

// 1. DASHBOARD PANEL RENDER
function renderDashboard() {
  const totalPaguGlobal = projects.reduce((sum, p) => sum + (parseFloat(p.totalBudget) || 0), 0);
  const totalRealisasiGlobal = rabItems.reduce((sum, i) => sum + (parseFloat(i.realisasi) || 0), 0);
  const overCount = rabItems.filter(i => parseFloat(i.realisasi) > parseFloat(i.budget)).length;

  const cardsContainer = document.getElementById('cardsContainer');
  if (cardsContainer) {
    cardsContainer.innerHTML = `
      <div class="card"><h3>Active System Projects</h3><p>${projects.length}</p></div>
      <div class="card"><h3>Global Budget Scope</h3><p>${formatRp(totalPaguGlobal)}</p></div>
      <div class="card"><h3>Total Financial Drain</h3><p>${formatRp(totalRealisasiGlobal)}</p></div>
      <div class="card"><h3>Risk Threshold Cross</h3><p style="color:#ef4444">${overCount} Components</p></div>
    `;
  }

  const tbody = document.getElementById('monitoringBody');
  if (tbody) {
    const limitedSorted = [...rabItems].sort((a,b) => b.budget - a.budget).slice(0, 6);
    tbody.innerHTML = limitedSorted.map(i => {
      const p = projects.find(proj => proj.id === i.projectId);
      return `<tr>
        <td><strong>${p ? p.name : 'Unassigned Node'}</strong></td>
        <td>${i.itemName}</td>
        <td>${formatRp(i.budget)}</td>
        <td>${formatRp(i.realisasi)}</td>
        <td>${getBadge(i.realisasi, i.budget)}</td>
      </tr>`;
    }).join('');
  }
}

// 2. MASTER PROJECT PANEL RENDER
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
        <td><button class="btn btn-danger btn-del-proj" style="padding: 5px 12px; border-radius:12px; font-size:0.75rem;" data-id="${p.id}"><i class="fas fa-trash"></i> Drop</button></td>
       </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-del-proj').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (confirm('Delete this project asset along with its structural sub-items?')) {
           remove(ref(db, `projects/${id}`));
           rabItems.filter(i => i.projectId === id).forEach(i => remove(ref(db, `rabItems/${i.id}`)));
        }
      });
    });
  }

  const filter = document.getElementById('filterProjectRAB');
  if (filter) {
    const prevFilterValue = currentSelectedProjectId;
    filter.innerHTML = '<option value="">-- Filter Master Project Selection --</option>' + projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (prevFilterValue) filter.value = prevFilterValue;
  }
  renderRABItemsSubTable();
}

function renderRABItemsSubTable() {
  const tbody = document.getElementById('rabItemsMasterBody');
  if (!tbody) return;
  
  if (!currentSelectedProjectId) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748b;">Active network pointer query missing. Select filter above.</td></tr>';
    return;
  }

  const filtered = rabItems.filter(i => i.projectId === currentSelectedProjectId);
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748b;">No sub-structural component mapped inside target ledger registry node.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(i => `
    <tr>
      <td>${i.itemName}</td>
      <td>${formatRp(i.budget)}</td>
      <td>${formatRp(i.realisasi)}</td>
      <td style="font-weight:600;">${formatRp(i.budget - i.realisasi)}</td>
      <td><button class="btn btn-danger btn-del-rab-sub" style="padding: 5px 10px; border-radius:12px; font-size:0.75rem;" data-id="${i.id}"><i class="fas fa-minus-circle"></i></button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-del-rab-sub').forEach(btn => {
    btn.addEventListener('click', () => {
       const itemId = btn.getAttribute('data-id');
       if (confirm('Sever and purge this structural sub-allocation budget component node?')) {
         remove(ref(db, `rabItems/${itemId}`));
       }
    });
  });
}

// 3. CLAIM REQUEST FORMS LOGIC
function renderClaimItemsBuildLayout() {
  const container = document.getElementById('itemList');
  if (!container) return;
  
  const targetProjId = document.getElementById('claimProjectSelect').value;
  const availableItems = rabItems.filter(i => i.projectId === targetProjId);

  if (claimItemsListArray.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:14px; font-weight:500;">No entry points configured. Add operational row manifest.</div>';
    return;
  }

  container.innerHTML = claimItemsListArray.map((item, idx) => `
    <div class="item-row">
      <select data-idx="${idx}" class="item-sel-node">
        <option value="">-- Choose Target Allocation Item Component --</option>
        ${availableItems.map(av => `<option value="${av.id}" ${item.itemId === av.id ? 'selected':''}>${av.itemName} (Liquid Balance: ${formatRp(av.budget - av.realisasi)})</option>`).join('')}
      </select>
      <input type="number" data-idx="${idx}" class="item-nom-node" placeholder="Expense Numeric Metric (IDR)" value="${item.nominal || ''}" />
      <button type="button" class="remove-item" data-idx="${idx}"><i class="fas fa-times"></i></button>
    </div>
  `).join('');

  // Re-attach state listeners to elements explicitly
  container.querySelectorAll('.item-sel-node').forEach(sel => {
    sel.addEventListener('change', (e) => { claimItemsListArray[parseInt(sel.dataset.idx)].itemId = e.target.value; });
  });
  container.querySelectorAll('.item-nom-node').forEach(inp => {
    inp.addEventListener('change', (e) => { claimItemsListArray[parseInt(inp.dataset.idx)].nominal = parseFloat(e.target.value) || 0; });
  });
  container.querySelectorAll('.remove-item').forEach(btn => {
    btn.addEventListener('click', () => { claimItemsListArray.splice(parseInt(btn.dataset.idx), 1); renderClaimItemsBuildLayout(); });
  });
}

function renderClaimView() {
  const historyBody = document.getElementById('historyClaimBody');
  if (historyBody) {
    if(claims.length === 0) {
      historyBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">No historical operation logs captured.</td></tr>';
      return;
    }
    historyBody.innerHTML = claims.map(c => {
      const p = projects.find(pr => pr.id === c.projectId);
      const summaries = c.items ? c.items.map(ci => {
        const r = rabItems.find(rab => rab.id === ci.itemId);
        return `• ${r ? r.itemName : 'Component'}: <span style="font-weight:600;">${formatRp(ci.nominal)}</span>`;
      }).join('<br>') : '-';
      let classBadge = c.status === 'approved' ? 'badge-success' : (c.status === 'rejected' ? 'badge-danger' : 'badge-warning');
      return `<tr>
        <td><strong>${p ? p.name : 'Unknown Cloud Context'}</strong></td>
        <td style="line-height:1.4;">${summaries}</td>
        <td style="font-weight:700; color:#1e1b4b">${formatRp(c.totalNominal)}</td>
        <td>${c.vendor}</td>
        <td><span class="badge ${classBadge}">${c.status}</span></td>
        <td><small>${c.tanggal}</small></td>
      </tr>`;
    }).join('');
  }
}

// 4. PIPELINE REVIEW QUEUE VERIFICATION
function renderApprovalList() {
  const tbody = document.getElementById('approvalBody');
  if (!tbody) return;
  const pendingClaims = claims.filter(c => c.status === 'pending');
  
  if (pendingClaims.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:20px;">Verification pipeline stable. Queue clear of execution requests.</td></tr>';
    return;
  }
  
  tbody.innerHTML = pendingClaims.map(c => {
    const p = projects.find(pr => pr.id === c.projectId);
    const summaries = c.items ? c.items.map(ci => {
      const r = rabItems.find(rab => rab.id === ci.itemId);
      return `${r ? r.itemName : 'Internal'}: ${formatRp(ci.nominal)}`;
    }).join(', ') : '-';
    return `<tr>
      <td><strong>${p ? p.name : 'Unknown Context Asset'}</strong><br><small style="color:#64748b;">Date: ${c.tanggal} | Memo: ${c.desc || '-'}</small></td>
      <td><span style="font-size:0.8rem; color:#334155;">${summaries}</span></td>
      <td style="font-weight:700; color:#4338ca">${formatRp(c.totalNominal)}</td>
      <td>${c.vendor}</td>
      <td>
        <button class="btn btn-success btn-approve" style="padding:6px 14px; font-size:0.75rem; border-radius:12px; margin-right:4px;" data-id="${c.id}"><i class="fas fa-check"></i> Authorize</button>
        <button class="btn btn-danger btn-reject" style="padding:6px 14px; font-size:0.75rem; border-radius:12px;" data-id="${c.id}"><i class="fas fa-ban"></i> Terminate</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.btn-approve').forEach(b => b.addEventListener('click', () => processedApprovalTransactionAction(b.dataset.id, 'approved')));
  tbody.querySelectorAll('.btn-reject').forEach(b => b.addEventListener('click', () => processedApprovalTransactionAction(b.dataset.id, 'rejected')));
}

async function processedApprovalTransactionAction(claimId, decStatus) {
  try {
    const targetClaim = claims.find(c => c.id === claimId);
    if (!targetClaim) return;

    if (decStatus === 'approved') {
      for (const it of targetClaim.items || []) {
        const rabRef = ref(db, `rabItems/${it.itemId}`);
        const snap = await get(rabRef);
        if (snap.exists()) {
          const currentReal = parseFloat(snap.val().realisasi) || 0;
          await update(rabRef, { realisasi: currentReal + parseFloat(it.nominal) });
        }
      }
    }
    await update(ref(db, `claims/${claimId}`), { status: decStatus });
    triggerNotification(`State delta successfully mutated transaction as: ${decStatus}`);
  } catch (err) {
    console.error(err);
    triggerNotification('Cloud update routing error!', false, 'error');
  }
}

// 5. MONITORING LOG VIEW
function renderMonitoringTable() {
  const tbody = document.getElementById('globalTrackingBody');
  if (!tbody) return;
  if(rabItems.length === 0){
     tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No tracking nodes available.</td></tr>';
     return;
  }
  tbody.innerHTML = rabItems.map(i => {
    const p = projects.find(pr => pr.id === i.projectId);
    const balance = i.budget - i.realisasi;
    return `<tr>
      <td><strong>${p ? p.name : 'System Orphan Node'}</strong></td>
      <td>${i.itemName}</td>
      <td>${formatRp(i.budget)}</td>
      <td style="color:#4f46e5; font-weight:600;">${formatRp(i.realisasi)}</td>
      <td style="font-weight:700; color:${balance < 0 ? '#ef4444':'#059669'}">${formatRp(balance)}</td>
      <td>${getBadge(i.realisasi, i.budget)}</td>
    </tr>`;
  }).join('');
}

// 6. ACCESS CONTROL USER ARCHITECTURE PANEL
function renderUsersTable() {
  const tbody = document.getElementById('userTableBody');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94a3b8;">No registered profiles detected.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => {
    let roleBadgeClass = u.role === 'Administrator' ? 'badge-danger' : (u.role === 'Finance' ? 'badge-warning' : 'badge-success');
    const isCurrentUser = (currentUserEmail === u.email);
    
    return `<tr>
      <td><strong>${u.email}</strong> ${isCurrentUser ? '<span class="badge badge-info">Active Node</span>' : ''}</td>
      <td><span class="badge ${roleBadgeClass}">${u.role}</span></td>
      <td style="font-size:0.75rem; color:#64748b; font-family: monospace;">${u.id || '-'}</td>
      <td>${u.createdAt || '-'}</td>
      <td>
        ${currentRole === 'Administrator' ? `
          ${!isCurrentUser ? `
            <button class="btn btn-warning btn-edit" style="padding:5px 12px; font-size:0.75rem; border-radius:12px;" data-uid="${u.id}" data-email="${u.email}" data-role="${u.role}"><i class="fas fa-edit"></i> Role</button>
            <button class="btn btn-outline btn-reset" style="padding:5px 12px; font-size:0.75rem; border-radius:12px;" data-uid="${u.id}" data-email="${u.email}"><i class="fas fa-key"></i> Pass</button>
            <button class="btn btn-danger btn-delete" style="padding:5px 12px; font-size:0.75rem; border-radius:12px;" data-uid="${u.id}" data-email="${u.email}"><i class="fas fa-trash"></i> Drop</button>
          ` : `<span class="badge badge-secondary"><i class="fas fa-user-shield"></i> Personal Node</span>`}
        ` : `<span class="badge badge-secondary">Locked Protocol</span>`}
       </td>
    </tr>`;
  }).join('');

  if (currentRole === 'Administrator') {
    tbody.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => openEditUserModal(btn.dataset.uid, btn.dataset.email, btn.dataset.role));
    });
    tbody.querySelectorAll('.btn-reset').forEach(btn => {
      btn.addEventListener('click', () => openResetPasswordModal(btn.dataset.uid, btn.dataset.email));
    });
    tbody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm(`Sever and terminate full network profile authorization for ${btn.dataset.email}?`)) {
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
  const passwordFieldGroup = document.getElementById('passwordFieldGroup');
  const roleSelect = document.getElementById('modalRole');
  const saveBtn = document.getElementById('saveUserBtn');
  const editUserId = document.getElementById('editUserId');
  
  title.innerHTML = '<i class="fas fa-user-edit"></i> Edit Security Mapping Role';
  emailInput.value = email;
  emailInput.disabled = true;
  if (passwordFieldGroup) passwordFieldGroup.style.display = 'none';
  roleSelect.value = currentRoleUser;
  editUserId.value = uid;
  
  saveBtn.onclick = async () => {
    if (roleSelect.value !== currentRoleUser) await updateUserRole(uid, roleSelect.value);
    modal.classList.remove('active');
    resetUserModalToDefaultState();
  };
  modal.classList.add('active');
}

function resetUserModalToDefaultState(){
  const title = document.getElementById('userModalTitle');
  const emailInput = document.getElementById('modalUserEmail');
  const passwordFieldGroup = document.getElementById('passwordFieldGroup');
  const saveBtn = document.getElementById('saveUserBtn');
  if(emailInput) { emailInput.disabled = false; emailInput.value = ''; }
  if(passwordFieldGroup) passwordFieldGroup.style.display = 'block';
  if(title) title.innerHTML = '<i class="fas fa-user-plus"></i> Provision New Identity Node';
  if(saveBtn) saveBtn.onclick = saveNewUser;
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
  
  if (!email) { triggerNotification('Email structure is required!', false, 'error'); return; }
  password = password || 'password123';
  if (password.length < 6) { triggerNotification('Crypto cipher length constraint error!', false, 'error'); return; }
  
  const res = await createNewUser(email, password, role);
  if (res && res.success) {
    document.getElementById('userModal').classList.remove('active');
    document.getElementById('modalUserEmail').value = '';
    document.getElementById('modalUserPassword').value = '';
  }
}

// ==================== CHART MATRIX PIPELINE ====================
function refreshGraphicCharts() {
  const ctx = document.getElementById('analyticalBarChartCanvas');
  if (!ctx) return;

  const datasetLabels = projects.map(p => p.name);
  const dataAllocatedBudgets = projects.map(p => p.totalBudget);
  const dataConsumedBudgets = projects.map(p => {
    return rabItems.filter(i => i.projectId === p.id).reduce((sum, i) => sum + (parseFloat(i.realisasi) || 0), 0);
  });

  if (reportsBarChartInstance) { reportsBarChartInstance.destroy(); }

  reportsBarChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: datasetLabels,
      datasets: [
        { label: 'Total Budget Framework Threshold (IDR)', data: dataAllocatedBudgets, backgroundColor: 'rgba(59, 130, 246, 0.85)', borderColor: '#2563eb', borderWidth: 1.5, borderRadius: 6 },
        { label: 'Realized Aggregated Consumption (IDR)', data: dataConsumedBudgets, backgroundColor: 'rgba(139, 92, 246, 0.85)', borderColor: '#7c3aed', borderWidth: 1.5, borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { font: { family: 'Inter', weight: 600 } } } },
      scales: { y: { beginAtZero: true, grid: { color: '#e2e8f0' } }, x: { grid: { display: false } } }
    }
  });
}

// ==================== TRUENAS INGESTION ARCHITECTURE FILE LAYER ====================
async function triggerDirectBinaryUploadToTrueNAS(filePayload, projId, folderName) {
  const targetProject = projects.find(p => p.id === projId);
  const projectNameStr = targetProject ? targetProject.name.replace(/[^a-zA-Z0-9]/g, "_") : "General_Project";
  
  const endpointIngestionUrl = `${API_BASE_URL}/upload.php`;
  const dataFormWrapper = new FormData();
  dataFormWrapper.append("file", filePayload);
  dataFormWrapper.append("project", projectNameStr);
  dataFormWrapper.append("folder", folderName);

  try {
    const networkResponse = await fetch(endpointIngestionUrl, { method: "POST", body: dataFormWrapper });
    if(!networkResponse.ok) throw new Error("API server node returned hard transport hardware failure.");
    
    const parsedJson = await networkResponse.json();
    if (parsedJson.status === "success" || parsedJson.url) {
      const generatedFileRef = push(ref(db, 'truenasFiles'));
      await set(generatedFileRef, {
        projectId: projId,
        folder: folderName,
        fileName: filePayload.name,
        networkFileUrl: parsedJson.url || parsedJson.file_path,
        uploadedAt: new Date().toLocaleString()
      });
      triggerNotification("Binary stream fully accepted and synchronized into cloud TrueNAS clusters.");
      document.getElementById('documentFileInput').value = '';
    } else {
      throw new Error(parsedJson.message || "Endpoint logical parse exception.");
    }
  } catch (error) {
    console.error(error);
    triggerNotification("TrueNAS Gateway IO error: " + error.message, false, 'error');
  }
}

function renderTreeHierarchy() {
  const treeContainer = document.getElementById('fileTreeContainer');
  if (!treeContainer) return;

  if (truenasFiles.length === 0) {
    treeContainer.innerHTML = '<li class="root-node"><i class="fas fa-database"></i> TrueNAS Active Pool: Empty Array</li>';
    return;
  }

  let htmlTree = `<li class="root-node"><i class="fas fa-database"></i> TrueNAS Pool Space: /mnt/vault/projects_rab</li>`;
  const groupedStructure = {};
  
  truenasFiles.forEach(f => {
    const p = projects.find(proj => proj.id === f.projectId);
    const pName = p ? p.name : "Orphaned Cryptographic Pointers";
    if (!groupedStructure[pName]) groupedStructure[pName] = {};
    if (!groupedStructure[pName][f.folder]) groupedStructure[pName][f.folder] = [];
    groupedStructure[pName][f.folder].push(f);
  });

  for (const projKey in groupedStructure) {
    htmlTree += `<li style="padding-left: 8px;"><div class="folder-node"><i class="fas fa-folder-open"></i> ${projKey}</div><ul style="list-style-type:none; padding-left:16px;">`;
    for (const folderKey in groupedStructure[projKey]) {
      htmlTree += `<li><div class="folder-node" style="color:#475569;"><i class="fas fa-folder"></i> Folder: ${folderKey}</div><ul style="list-style-type:none; padding-left:12px;">`;
      groupedStructure[projKey][folderKey].forEach(fileObj => {
        htmlTree += `<li class="file-node">
          <i class="fas fa-file-invoice"></i> <span>${fileObj.fileName}</span>
          <div class="action-links">
            <a href="${fileObj.networkFileUrl}" target="_blank" class="preview-link"><i class="fas fa-external-link-alt"></i> Stream File</a>
            ${currentRole === 'Administrator' ? `<button class="delete-file-btn" data-id="${fileObj.id}"><i class="fas fa-trash-alt"></i></button>` : ''}
          </div>
        </li>`;
      });
      htmlTree += `</ul></li>`;
    }
    htmlTree += `</ul></li>`;
  }

  treeContainer.innerHTML = htmlTree;

  treeContainer.querySelectorAll('.delete-file-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm("Purge asset directory metadata file pointer link? File will remain safely archival within cold disk hardware blocks.")) {
        remove(ref(db, `truenasFiles/${btn.dataset.id}`));
      }
    });
  });
}

// ==================== COMPILING ENGINE EXPORTS HANDLING ====================
document.getElementById('exportExcelBtn')?.addEventListener('click', () => {
  const rows = [["Project Scope Master Location", "RAB Target Sub-Component Element", "Allocation Budget Cap Value (IDR)", "Realized Expenditures (IDR)", "Remaining Available Liquid Fluidity (IDR)"]];
  rabItems.forEach(i => {
    const p = projects.find(pr => pr.id === i.projectId);
    rows.push([p ? p.name : 'Orphan', i.itemName, i.budget, i.realisasi, (i.budget - i.realisasi)]);
  });
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "System Audited Balance Report");
  XLSX.writeFile(workbook, "RAB_Executive_Financial_Workbook.xlsx");
});

document.getElementById('exportPdfBtn')?.addEventListener('click', () => {
  const targetElement = document.getElementById('exportPdfTargetArea');
  if(!targetElement) return;
  const layoutConfigurationOptions = { margin: 10, filename: 'RAB_Executive_Financial_Audit.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' } };
  html2pdf().set(layoutConfigurationOptions).from(targetElement).save();
});

// ==================== INTERACTION EVENT LISTENERS WIRE-UP ====================
document.getElementById('filterProjectRAB')?.addEventListener('change', (e) => {
  currentSelectedProjectId = e.target.value;
  renderRABItemsSubTable();
});

document.getElementById('saveProjectBtn')?.addEventListener('click', () => {
  const name = document.getElementById('modalProjectName').value.trim();
  const client = document.getElementById('modalClientName').value.trim();
  const totalBudget = parseFloat(document.getElementById('modalBudget').value) || 0;

  if (!name || !client || totalBudget <= 0) { triggerNotification('Validation constraint violation: Check form variables!', false, 'error'); return; }

  push(ref(db, 'projects'), { name, client, totalBudget }).then(() => {
    document.getElementById('projectModal').classList.remove('active');
    document.getElementById('modalProjectName').value = '';
    document.getElementById('modalClientName').value = '';
    document.getElementById('modalBudget').value = '';
    triggerNotification('Master ledger structure entry written successfully.');
  });
});

document.getElementById('openRABModalBtn')?.addEventListener('click', () => {
  if (!currentSelectedProjectId) { triggerNotification('Operation blocked: Active project filter required.', false, 'info'); return; }
  const currentProj = projects.find(p => p.id === currentSelectedProjectId);
  document.getElementById('rabModalProjectName').value = currentProj ? currentProj.name : '';
  document.getElementById('rabItemName').value = '';
  document.getElementById('rabBudget').value = '';
  document.getElementById('rabModal').classList.add('active');
});

document.getElementById('saveRabBtn')?.addEventListener('click', () => {
  const itemName = document.getElementById('rabItemName').value.trim();
  const budget = parseFloat(document.getElementById('rabBudget').value) || 0;

  if (!itemName || budget <= 0) { triggerNotification('Validation Exception: Param structural error.', false, 'error'); return; }

  push(ref(db, 'rabItems'), { projectId: currentSelectedProjectId, itemName, budget, realisasi: 0 }).then(() => {
    document.getElementById('rabModal').classList.remove('active');
    triggerNotification('Sub-allocation budget item linked into primary pointer.');
  });
});

document.getElementById('claimProjectSelect')?.addEventListener('change', () => {
  claimItemsListArray = [];
  renderClaimItemsBuildLayout();
});

document.getElementById('addItemBtn')?.addEventListener('click', () => {
  if (!document.getElementById('claimProjectSelect').value) { triggerNotification('Select a valid target project architecture parent node.', false, 'info'); return; }
  claimItemsListArray.push({ itemId: '', nominal: 0 });
  renderClaimItemsBuildLayout();
});

document.getElementById('submitClaimMainBtn')?.addEventListener('click', () => {
  const projectId = document.getElementById('claimProjectSelect').value;
  const vendor = document.getElementById('claimVendor').value.trim();
  const tanggal = document.getElementById('claimDate').value;
  const desc = document.getElementById('claimDesc').value;
  const validItems = claimItemsListArray.filter(it => it.itemId && it.nominal > 0);

  if (!projectId || validItems.length === 0 || !vendor || !tanggal) { triggerNotification('Incomplete framework entities matrix!', false, 'error'); return; }

  const totalNominal = validItems.reduce((sum, i) => sum + i.nominal, 0);
  push(ref(db, 'claims'), { projectId, vendor, tanggal, desc, status: 'pending', totalNominal, items: validItems }).then(() => {
    claimItemsListArray = [];
    document.getElementById('claimVendor').value = '';
    document.getElementById('claimDesc').value = '';
    document.getElementById('claimDate').value = '';
    renderClaimItemsBuildLayout();
    triggerNotification('Reimbursement operational expense matrix routed into pipeline validation loop.');
  });
});

document.getElementById('executeUploadFileBtn')?.addEventListener('click', () => {
  const pId = document.getElementById('uploadProjectSelect').value;
  const folder = document.getElementById('uploadFolderSelect').value;
  const fileInput = document.getElementById('documentFileInput');

  if (!pId || !fileInput.files || fileInput.files.length === 0) {
    triggerNotification("Missing payload parameters.", false, 'error');
    return;
  }
  triggerDirectBinaryUploadToTrueNAS(fileInput.files[0], pId, folder);
});

document.getElementById('openAddUserModalBtn')?.addEventListener('click', () => {
  resetUserModalToDefaultState();
  document.getElementById('userModal').classList.add('active');
});
document.getElementById('closeUserModalBtn')?.addEventListener('click', () => document.getElementById('userModal').classList.remove('active'));
document.getElementById('closeResetModalBtn')?.addEventListener('click', () => document.getElementById('resetPasswordModal').classList.remove('active'));
document.getElementById('globalActionBtn')?.addEventListener('click', () => updateWholeUI());
document.getElementById('logoutApplicationBtn')?.addEventListener('click', () => { signOut(auth).then(() => window.location.reload()); });

// ==================== APP SYSTEM ROUTING COMPONENT MAPS ====================
const pageViewRoutingDOMMaps = {
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

      const targetKey = li.getAttribute('data-page');
      Object.values(pageViewRoutingDOMMaps).forEach(domId => {
        const el = document.getElementById(domId);
        if (el) el.classList.add('hidden-section');
      });
      
      if (pageViewRoutingDOMMaps[targetKey]) {
         const activeDomView = document.getElementById(pageViewRoutingDOMMaps[targetKey]);
         if (activeDomView) activeDomView.classList.remove('hidden-section');
      }
      
      const pageTitleElement = document.getElementById('pageTitle');
      if (pageTitleElement) {
        const matchingSidebarIcon = li.querySelector('i');
        pageTitleElement.innerHTML = `<i class="${matchingSidebarIcon ? matchingSidebarIcon.className : 'fas fa-chart-pie'}"></i> ${li.innerText.trim()}`;
      }
   });
});

// ==================== ROOT ENTRYPOINT HOOK SYSTEM RESOLUTION ====================
function ensureAdminUIDInDatabase(user) {
  const systemAdminMasterEmail = "admin@genetek.co.id";
  if (user.email === systemAdminMasterEmail) {
    const rootRef = ref(db, `users/${user.uid}`);
    get(rootRef).then((snap) => {
      if (!snap.exists()) {
        set(rootRef, { email: user.email, role: "Administrator", createdAt: new Date().toLocaleDateString('id-ID'), isAdmin: true });
      }
    });
  }
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUserEmail = user.email;
    ensureAdminUIDInDatabase(user);
    
    get(ref(db, `users/${user.uid}`)).then((snapshot) => {
      if (snapshot.exists()) {
        currentRole = snapshot.val().role || "Project Manager";
      } else {
        currentRole = "Project Manager"; 
      }
      
      const sidebarEmailEl = document.getElementById('sidebarUserEmail');
      const sidebarRoleEl = document.getElementById('sidebarUserRole');
      if(sidebarEmailEl) sidebarEmailEl.innerText = currentUserEmail;
      if(sidebarRoleEl) sidebarRoleEl.innerText = currentRole;
      
      enforceRoleVisibility();
      initCloudDatabaseListeners();
      hideLoadingScreen();
    }).catch((err) => {
      console.error("Pipeline panic resolution fallback triggered:", err);
      hideLoadingScreen();
    });
  } else {
    // Apabila enkripsi token sesi expired/kosong, paksa alihkan kembali ke form gateway login.html
    window.location.href = "login.html"; 
  }
});

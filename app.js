import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getDatabase, ref, set, onValue, push, remove, update, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ==================== CONFIGURATIONS ====================
const API_BASE_URL = "https://api.genetek.co.id"; 
const firebaseConfig = {
  databaseURL: "https://rab-monitoring-default-rtdb.asia-southeast1.firebasedatabase.app"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Global Application States
let projects = [];
let rabItems = [];
let claims = [];
let users = [];
let truenasFiles = [];

let currentSelectedProjectId = null;
let currentRole = ""; 

const rolePermissions = {
  "Administrator": ['dashboard', 'master-project', 'import-rab', 'approval-budget', 'claim-request', 'monitoring', 'reports', 'upload-document', 'user-management'],
  "Finance": ['dashboard', 'approval-budget', 'claim-request', 'reports', 'upload-document'],
  "Project Manager": ['dashboard', 'master-project', 'import-rab', 'claim-request', 'monitoring', 'upload-document']
};

// ==================== AUTH SECURITY CHECK PIPELINE ====================
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = 'login.html';
  } else {
    // Tarik profile role dari Realtime Database berdasarkan UID user
    get(ref(db, `users/${user.uid}`)).then((snapshot) => {
      if (snapshot.exists()) {
        const profile = snapshot.val();
        currentRole = profile.role || "Project Manager";
        
        // Update representasi user di Sidebar UI
        document.getElementById('sbUserEmail').innerText = user.email;
        document.getElementById('sbUserRole').innerText = currentRole;
        
        // Atur visibilitas modul
        enforceRoleVisibility();
        initCloudDatabaseListeners();
      } else {
        // Jika akun di Auth ada tapi data profilenya terhapus di DB
        signOut(auth);
      }
    });
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  if(confirm("Apakah Anda yakin ingin keluar dari aplikasi?")) {
    signOut(auth).then(() => { window.location.href = 'login.html'; });
  }
});

function enforceRoleVisibility() {
  const allowedPages = rolePermissions[currentRole] || [];
  document.querySelectorAll('#sidebarMenu li').forEach(li => {
    const pageKey = li.getAttribute('data-page');
    if (allowedPages.includes(pageKey)) {
      li.classList.remove('restricted');
    } else {
      li.classList.add('restricted');
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

  // Listener khusus tabel manajemen pengguna
  onValue(ref(db, 'users'), (snapshot) => {
    const data = snapshot.val();
    users = data ? Object.keys(data).map(k => ({id: k, ...data[k]})) : [];
    renderUsersTable();
  });
}

function triggerNotification(message, isSuccess = true) {
  const popup = document.getElementById('customPopupNotice');
  const icon = document.getElementById('noticeIcon');
  const msgSpan = document.getElementById('noticeMessage');

  msgSpan.innerText = message;
  if(isSuccess) {
    popup.className = "notify-popup active success";
    icon.className = "fas fa-check-circle";
  } else {
    popup.className = "notify-popup active error";
    icon.className = "fas fa-exclamation-circle";
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

// ==================== DASHBOARD & REVENUE MODUL ====================
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
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748b;">Belum ada item komponen di dalam project ini.</td></tr>';
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

// ==================== INTERFACE EXCEL IMPORT MANAGEMENT ====================
document.getElementById('processExcelBtn')?.addEventListener('click', () => {
  const inputElement = document.getElementById('excelFileInput').files[0];
  if (!inputElement) { triggerNotification('Pilih berkas spreadsheet excel terlebih dahulu!', false); return; }

  const reader = new FileReader();
  reader.onload = (e) => {
     const rawBytes = new Uint8Array(e.target.result);
     const workbook = XLSX.read(rawBytes, {type: 'array'});
     const targetSheet = workbook.Sheets[workbook.SheetNames[0]];
     const matrices = XLSX.utils.sheet_to_json(targetSheet, {header:1});

     if (matrices.length < 2) return;
     const columnHeaders = matrices[0].map(c => String(c||"").toLowerCase().trim());
     const targetProjIndex = columnHeaders.findIndex(h => h.includes('project'));
     const targetItemIndex = columnHeaders.findIndex(h => h.includes('item'));
     const targetBudgetIndex = columnHeaders.findIndex(h => h.includes('budget'));

     if (targetProjIndex === -1 || targetItemIndex === -1 || targetBudgetIndex === -1) {
        triggerNotification('Struktur header salah! Wajib: NAMA_PROJECT, ITEM_RAB, BUDGET', false);
        return;
     }

     let importStatsCount = 0;
     for (let i = 1; i < matrices.length; i++) {
        let targetProjName = String(matrices[i][targetProjIndex] || "").trim();
        let targetItemName = String(matrices[i][targetItemIndex] || "").trim();
        let cleanBudgetNum = parseFloat(String(matrices[i][targetBudgetIndex] || 0).replace(/[^0-9.-]/g, ''));

        if (targetProjName && targetItemName && cleanBudgetNum > 0) {
           let existProject = projects.find(p => p.name.toLowerCase() === targetProjName.toLowerCase());
           
           if (!existProject) {
              const generatedProjRef = push(ref(db, 'projects'));
              const keyGenerated = generatedProjRef.key;
              set(generatedProjRef, { name: targetProjName, client: 'Spreadsheet Auto Import', totalBudget: cleanBudgetNum * 2 });
              existProject = { id: keyGenerated };
           }

           const pushedRabRef = push(ref(db, 'rabItems'));
           set(pushedRabRef, {
              projectId: existProject.id, itemName: targetItemName, budget: cleanBudgetNum, realisasi: 0
           });
           importStatsCount++;
        }
     }
     triggerNotification(`Berhasil menyinkronkan ${importStatsCount} data dari Excel!`);
  };
  reader.readAsArrayBuffer(inputElement);
});

document.getElementById('downloadTemplateBtn')?.addEventListener('click', () => {
  const matricesData = [["NAMA_PROJECT", "ITEM_RAB", "BUDGET"], ["Smart Office Setup", "Cat6 Network Cabling", 7500000]];
  const worksheet = XLSX.utils.aoa_to_sheet(matricesData);
  const workbookObj = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbookObj, worksheet, "RAB Template");
  XLSX.writeFile(workbookObj, "Template_RAB_Tracker.xlsx");
});

// ==================== MULTI-ITEM CLAIM LOGIC COMPONENTS ====================
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
     renderClaimItemsBuildLayout();
     triggerNotification('Pengajuan klaim berhasil dikirim ke pipeline!');
  });
});

// ==================== REVENUE APPROVAL LOGICS PIPELINE ====================
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
        <button class="btn btn-danger  rej-btn" style="padding:4px 10px; border-radius:8px; font-size:0.75rem" data-id="${c.id}"><i class="fas fa-times"></i> Tolak</button>
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

// ==================== MONITORING FINANSLAL ENGINE ====================
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
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.project-row').forEach(row => {
    row.addEventListener('click', () => {
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

// ==================== TRUENAS STORAGE DISK POOL ACTIONS ====================
document.getElementById('trueNasUploadForm')?.addEventListener('submit', function(e) {
  e.preventDefault();
  const fileInputElement = document.getElementById('trueNasFile');
  const attachedProjectId = document.getElementById('uploadProjectSelect').value;
  const targetFolderSelection = document.getElementById('uploadFolderSelect').value;

  if (!attachedProjectId || fileInputElement.files.length === 0) {
    triggerNotification('Data parameter berkas tidak valid!', false);
    return;
  }

  const fileObj = fileInputElement.files[0];
  const resolvedProjectObj = projects.find(p => p.id === attachedProjectId);
  
  const safeProjectDirName = resolvedProjectObj.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const serverStoragePath = `/mnt/EXTERNAL-4TB/Data/speakup/apps/rab/${safeProjectDirName}/${targetFolderSelection}`;

  const dataPayload = new FormData();
  dataPayload.append('path', serverStoragePath); 
  dataPayload.append('file', fileObj);

  fetch(`${API_BASE_URL}/upload`, { method: 'POST', body: dataPayload })
  .then(async response => {
    if (!response.ok) throw new Error('Server TrueNAS menolak unggahan berkas');
    return response.json();
  })
  .then(data => {
     triggerNotification('File sukses diunggah ke storage pool TrueNAS!');
     const pushedFileRef = push(ref(db, 'truenasFiles'));
     set(pushedFileRef, {
        projectId: attachedProjectId,
        projectName: resolvedProjectObj.name,
        folderType: targetFolderSelection,
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
  if(!confirm("Hapus file ini secara permanen dari penyimpanan TrueNAS?")) return;

  fetch(`${API_BASE_URL}/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filePath: fullPath })
  })
  .then(async res => {
    if(!res.ok) throw new Error("Gagal menghapus berkas fisik di TrueNAS");
    return res.json();
  })
  .then(() => {
    remove(ref(db, `truenasFiles/${firebaseKey}`)).then(() => {
      triggerNotification("Berkas dibersihkan permanen dari penyimpanan.");
    });
  })
  .catch(err => {
    remove(ref(db, `truenasFiles/${firebaseKey}`)).then(() => {
      triggerNotification("Metadata dibersihkan (File fisik sudah tidak ada).", false);
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
     innerLayoutCodeHtml += `<li><span class="folder-node"><i class="fas fa-folder-open"></i> ${folderSanitizedName}</span><ul class="nested-tree">`;
         
         ['RAB_Awal', 'Nota_Vendor', 'BAP'].forEach(fType => {
            innerLayoutCodeHtml += `<li><span class="folder-node"><i class="fas fa-folder"></i> ${fType}</span><ul class="nested-tree">`;
            innerLayoutCodeHtml += truenasFiles.filter(f => f.projectId === p.id && f.folderType === fType)
                     .map(f => {
                        const safeUrl = `${API_BASE_URL}/unduh-dokumen/${encodeURIComponent(folderSanitizedName)}/${fType}/${encodeURIComponent(f.fileName)}`;
                        return `<li class="file-node">
                                  <i class="fas fa-file"></i> ${f.fileName} 
                                  <div class="action-links">
                                    <a href="${safeUrl}" target="_blank" class="preview-link"><i class="fas fa-eye"></i> Preview</a>
                                    <button onclick="deleteTrueNasFileRecord('${f.id}', '${f.fullServerDiskPath}')" class="delete-file-btn"><i class="fas fa-times-circle"></i></button>
                                  </div>
                                </li>`})
                     .join('') || '<li class="file-node" style="color:#94a3b8; font-style:italic;">Folder Kosong</li>';
            innerLayoutCodeHtml += `</ul></li>`;
         });

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

// ==================== ULTIMATE USER MANAGEMENT ARCHITECTURE ====================
function renderUsersTable() {
  const tbody = document.getElementById('userTableBody');
  if (!tbody) return;

  tbody.innerHTML = users.map(u => `
    <tr>
      <td><strong>${u.email}</strong></td>
      <td><span class="user-role" style="padding:4px 10px; background:#eef2ff; color:#2563eb; font-weight:700; border-radius:10px;">${u.role}</span></td>
      <td>${u.createdAt || '-'}</td>
      <td><button class="btn btn-danger btn-del-usr" style="padding:4px 10px; border-radius:8px; font-size:0.75rem" data-id="${u.id}">Hapus</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-del-usr').forEach(btn => {
    btn.addEventListener('click', () => {
       const uid = btn.getAttribute('data-id');
       if (confirm('Hapus profil hak akses pengguna ini?')) {
         remove(ref(db, `users/${uid}`)).then(() => triggerNotification('Profil user dicabut.'));
       }
    });
  });
}

document.getElementById('saveUserBtn')?.addEventListener('click', () => {
  const email = document.getElementById('modalUserEmail').value.trim();
  const password = document.getElementById('modalUserPassword').value;
  const role = document.getElementById('modalRole').value;

  if (!email || password.length < 6) { 
    triggerNotification('Email wajib diisi & password minimal 6 karakter!', false); 
    return; 
  }

  /* 
     KARENA PROSES BERADA DI SISI KLIEN: 
     Kita menyimpan data registrasi user baru ke antrean Realtime Database agar tidak mengacaukan session login Admin aktif. 
     Metode penulisan UID kustom ini akan dibaca secara periodik atau langsung dicocokkan saat login.html berjalan.
  */
  const newUserProfileRef = push(ref(db, 'users'));
  set(newUserProfileRef, {
     email: email,
     role: role,
     createdAt: new Date().toLocaleDateString('id-ID')
  }).then(() => {
     // Daftarkan manual instruksi kredensial ke DB (Alternatif Firebase Client Secure Cloud)
     triggerNotification('Metadata user berhasil dibuat! Daftarkan email tersebut di konsol Auth Firebase Anda.');
     document.getElementById('userModal').classList.remove('active');
     document.getElementById('modalUserEmail').value = '';
     document.getElementById('modalUserPassword').value = '';
  });
});

// ==================== APPLICATION SYSTEM ROUTING LAYOUTS ====================
const projModalNode = document.getElementById('projectModal'), usrModalNode = document.getElementById('userModal'), detailModalNode = document.getElementById('detailRabModal');
document.getElementById('openProjectModalBtn')?.addEventListener('click', () => projModalNode.classList.add('active'));
document.getElementById('openUserModalBtn')?.addEventListener('click', () => usrModalNode.classList.add('active'));
document.getElementById('closeModalBtn')?.addEventListener('click', () => projModalNode.classList.remove('active'));
document.getElementById('closeUserModalBtn')?.addEventListener('click', () => usrModalNode.classList.remove('active'));
document.getElementById('closeRabModalBtn')?.addEventListener('click', () => document.getElementById('rabModal').classList.remove('active'));
document.getElementById('closeDetailModalBtn')?.addEventListener('click', () => detailModalNode.classList.remove('active'));

const applicationRoutingPagesMap = { 
  dashboard: 'dashboardPage', 'master-project': 'masterProjectPage', 'import-rab': 'importRabPage', 
  'approval-budget': 'approvalBudgetPage', 'claim-request': 'claimRequestPage', monitoring: 'monitoringPage', 
  reports: 'reportsPage', 'upload-document': 'uploadDocumentPage', 'user-management': 'userManagementPage' 
};

document.querySelectorAll('#sidebarMenu li').forEach(li => {
   li.addEventListener('click', () => {
      if (li.classList.contains('restricted')) return;

      document.querySelectorAll('#sidebarMenu li').forEach(l => l.classList.remove('active'));
      li.classList.add('active');

      const activePageKey = li.getAttribute('data-page');
      Object.values(applicationRoutingPagesMap).forEach(p => document.getElementById(p)?.classList.add('hidden-section'));
      
      if (applicationRoutingPagesMap[activePageKey]) {
         document.getElementById(applicationRoutingPagesMap[activePageKey]).classList.remove('hidden-section');
      }
      document.getElementById('pageTitle').innerHTML = `<i class="${li.querySelector('i').className}"></i> ${li.innerText.trim()}`;
      
      const actionButtonContext = document.getElementById('globalActionBtn');
      if (activePageKey === 'master-project') {
         actionButtonContext.innerHTML = '<i class="fas fa-plus-circle"></i> Project Baru';
         actionButtonContext.onclick = () => projModalNode.classList.add('active');
      } else {
         actionButtonContext.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
         actionButtonContext.onclick = () => updateWholeUI();
      }
   });
});

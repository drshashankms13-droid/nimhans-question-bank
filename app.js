/* ============================================================
   NIMHANS Question Bank — app logic (multi-paper, cloud-synced)
   ============================================================ */

/* ---------- Supabase setup ---------- */
const SUPABASE_URL = 'https://mxqjvjdjnasavrbbxame.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ssmaDfCXrAr_PYAOV9glew_4mAgZLH8';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;

const PAPER_CONFIG = {
  p1: {
    label: 'Core Psychiatry',
    data: () => PAPERS1,
    primaryKinds: [
      {key:'critical', groupLabel:'Critical Essay / Evaluation', sectionTitle:'Critical Essay / Evaluation Questions', allLabel:'All Critical Essay Questions', unitNoun:'questions'},
      {key:'applied', groupLabel:'Applied Knowledge', sectionTitle:'Applied Knowledge (Case-based)', allLabel:'All Applied Knowledge Cases', unitNoun:'cases'}
    ]
  },
  p2: {
    label: 'Recent Advances in Psychiatry & Specialties',
    data: () => PAPERS2,
    primaryKinds: [
      {key:'critical', groupLabel:'Critical Essay / Evaluation', sectionTitle:'Critical Essay / Evaluation Questions', allLabel:'All Critical Essay Questions', unitNoun:'questions'},
      {key:'applied', groupLabel:'Applied Knowledge', sectionTitle:'Applied Knowledge (Case-based)', allLabel:'All Applied Knowledge Cases', unitNoun:'cases'}
    ]
  },
  p3: {
    label: 'Neurology & Consultation-Liaison Psychiatry',
    data: () => PAPERS3,
    primaryKinds: [
      {key:'essay1', groupLabel:'Essay Question 1', sectionTitle:'Essay Question 1', allLabel:'All Essay Question 1 Answers', unitNoun:'questions'},
      {key:'essay2', groupLabel:'Essay Question 2', sectionTitle:'Essay Question 2', allLabel:'All Essay Question 2 Answers', unitNoun:'questions'}
    ]
  }
};

let currentPaper = 'p1';
let currentView = 'year';
let allExpanded = false;
let checklist = {};
let PAPERS = PAPERS1;
let ITEMS = [];

/* ---------- Cloud checklist sync ---------- */
async function loadChecklistFromCloud(){
  if(!currentUser) return {};
  const { data, error } = await supabaseClient
    .from('checklist_progress')
    .select('uid')
    .eq('paper', currentPaper);
  if(error){
    console.error('Failed to load progress', error);
    return {};
  }
  const obj = {};
  (data||[]).forEach(row => { obj[row.uid] = true; });
  return obj;
}

async function upsertProgress(uid){
  return supabaseClient.from('checklist_progress').upsert({
    user_id: currentUser.id,
    paper: currentPaper,
    uid: uid,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,paper,uid' });
}

async function deleteProgress(uid){
  return supabaseClient.from('checklist_progress')
    .delete()
    .eq('user_id', currentUser.id)
    .eq('paper', currentPaper)
    .eq('uid', uid);
}

/* ---------- Build flat item list (for counts / search / topics) ---------- */
function buildItems(){
  const items = [];
  const kinds = PAPER_CONFIG[currentPaper].primaryKinds;
  PAPERS.forEach(p=>{
    kinds.forEach(k=>{
      const src = p[k.key];
      if(!src) return;
      items.push({
        uid: p.id + '-' + k.key,
        kind: k.key,
        paper: p,
        text: src.text,
        stem: src.stem,
        subs: src.subs,
        marks: src.marks,
        topic: src.topic
      });
    });
    p.shortNotes.forEach((sn, i)=>{
      items.push({
        uid: p.id + '-sn-' + i,
        kind: 'short',
        paper: p,
        text: sn.text,
        marks: sn.marks,
        topic: sn.topic
      });
    });
  });
  return items;
}

/* ---------- Helpers ---------- */
function esc(s){
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
function matchesSearch(item, q){
  if(!q) return true;
  q = q.toLowerCase();
  const hay = [
    item.text||'', item.stem||'', (item.subs||[]).join(' '),
    item.topic, item.paper.date, item.paper.sitting, item.paper.version
  ].join(' ').toLowerCase();
  return hay.includes(q);
}

function checkboxHtml(uid){
  const checked = checklist[uid] ? 'checked' : '';
  return `<input type="checkbox" ${checked} data-uid="${uid}" onchange="toggleItem('${uid}', this.closest('.qitem'))">`;
}

function questionRowHtml(item, num){
  const done = checklist[item.uid] ? 'done' : '';
  let body = '';
  if(item.subs && item.subs.length){
    const subsHtml = item.subs.map(s=>`<li>${esc(s)}</li>`).join('');
    body = `<span class="stem">${esc(item.stem)}</span><ol>${subsHtml}</ol>`;
  } else {
    body = esc(item.text);
  }
  const numHtml = (num!=null) ? `<span class="qnum">${num}</span>` : '';
  return `
  <div class="qitem ${done}" data-uid="${item.uid}">
    ${checkboxHtml(item.uid)}
    <div class="qbody">
      <div class="qtext">${numHtml}${body}</div>
      <div class="qmeta">
        <span class="badge marks">${item.marks} marks</span>
        <span class="badge topic" onclick="jumpToTopic('${esc(item.topic)}')">${esc(item.topic)}</span>
        <span class="badge date">${esc(item.paper.date)} · ${esc(item.paper.version)}</span>
      </div>
    </div>
  </div>`;
}

async function toggleItem(uid, el){
  const newState = !checklist[uid];
  checklist[uid] = newState;
  if(el){ el.classList.toggle('done', newState); }
  updateProgress();
  try{
    const { error } = newState ? await upsertProgress(uid) : await deleteProgress(uid);
    if(error) throw error;
  }catch(e){
    console.error('Sync failed', e);
    checklist[uid] = !newState;
    if(el){ el.classList.toggle('done', !newState); }
    const cb = el ? el.querySelector('input[type=checkbox]') : null;
    if(cb) cb.checked = !newState;
    updateProgress();
    alert('Could not save your progress — please check your internet connection and try again.');
  }
}

async function clearChecklist(){
  if(!confirm('Clear all checked-off questions for this paper? This cannot be undone.')) return;
  const prev = checklist;
  checklist = {};
  renderAll();
  try{
    const { error } = await supabaseClient.from('checklist_progress')
      .delete()
      .eq('user_id', currentUser.id)
      .eq('paper', currentPaper);
    if(error) throw error;
  }catch(e){
    console.error('Clear failed', e);
    checklist = prev;
    renderAll();
    alert('Could not clear your progress — please check your internet connection and try again.');
  }
}

function updateProgress(){
  const total = ITEMS.length;
  const done = ITEMS.filter(i=>checklist[i.uid]).length;
  const pct = total ? Math.round((done/total)*100) : 0;
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressLabel').textContent = `${done} / ${total} solved (${pct}%)`;
}

/* ---------- View: Year-wise ---------- */
function renderYearView(container, q){
  const papers = [...PAPERS].sort((a,b)=> b.sortKey.localeCompare(a.sortKey));
  const kinds = PAPER_CONFIG[currentPaper].primaryKinds;
  let html = `<div class="section-heading"><div class="num">Y</div><h2>Papers, most recent first</h2><div class="section-rule"></div><div class="count">${papers.length} sittings</div></div>`;

  let anyVisible = false;

  papers.forEach(p=>{
    const primaryItems = kinds.map(k=> ITEMS.find(i=>i.uid === p.id+'-'+k.key)).filter(Boolean);
    const snItems = ITEMS.filter(i=>i.kind==='short' && i.paper.id===p.id);

    const visPrimary = primaryItems.filter(i=>matchesSearch(i,q));
    const visSn = snItems.filter(i=>matchesSearch(i,q));

    if(visPrimary.length===0 && visSn.length===0) return;
    anyVisible = true;

    const paperItems = [...primaryItems, ...snItems];
    const doneCount = paperItems.filter(i=>checklist[i.uid]).length;
    const openAttr = (allExpanded || q) ? 'open' : '';

    html += `<details class="paper-card" data-paper="${p.id}" ${openAttr}>
      <summary class="paper-card-head">
        <span class="chev">▶</span>
        <div>
          <div class="title">${esc(p.sitting)} — ${esc(p.version)}</div>
          <div class="meta">Exam date: ${esc(p.date)}</div>
        </div>
        <div class="paper-progress">${doneCount} / ${paperItems.length} done</div>
      </summary>
      <div class="paper-body">`;

    kinds.forEach(k=>{
      const item = primaryItems.find(i=>i.kind===k.key);
      if(item && matchesSearch(item,q)){
        html += `<div class="qgroup-label">${esc(k.groupLabel)}</div>` + questionRowHtml(item, 1);
      }
    });
    if(visSn.length){
      html += `<div class="qgroup-label">Short Notes</div>`;
      visSn.forEach((i,idx)=> html += questionRowHtml(i, String.fromCharCode(97+idx)+'.'));
    }
    html += `</div></details>`;
  });

  if(!anyVisible){
    html += `<div class="empty-note">No questions match your search.</div>`;
  }
  container.innerHTML = html;
}

/* ---------- View: Topic-wise ---------- */
function renderTopicView(container, q){
  let html = '';
  const kinds = PAPER_CONFIG[currentPaper].primaryKinds;

  kinds.forEach((k, sectionIdx)=>{
    const kindItems = ITEMS.filter(i=>i.kind===k.key).sort((a,b)=> b.paper.sortKey.localeCompare(a.paper.sortKey));
    const kindVis = kindItems.filter(i=>matchesSearch(i,q));
    html += `<div class="section-heading"><div class="num">${sectionIdx+1}</div><h2>${esc(k.sectionTitle)}</h2><div class="section-rule"></div><div class="count">${kindItems.length} ${esc(k.unitNoun)}</div></div>`;
    if(kindVis.length){
      const doneCount = kindItems.filter(i=>checklist[i.uid]).length;
      const openAttr = (allExpanded || q) ? 'open' : '';
      html += `<details class="topic-block" ${openAttr}>
        <summary>
          <span class="chev">▶</span>
          <span class="tname">${esc(k.allLabel)}</span>
          <span class="tcount">${doneCount}/${kindItems.length} done · ${kindItems.length} ${esc(k.unitNoun)}</span>
        </summary>
        <div class="topic-body">`;
      kindVis.forEach((i,idx)=> html += questionRowHtml(i, idx+1));
      html += `</div></details>`;
    } else {
      html += `<div class="empty-note">No matches.</div>`;
    }
  });

  // Final section: Short Notes — grouped by topic (disease/subject), topics sorted by frequency desc
  const shortItems = ITEMS.filter(i=>i.kind==='short');
  const topicMap = {};
  shortItems.forEach(i=>{
    if(!topicMap[i.topic]) topicMap[i.topic] = [];
    topicMap[i.topic].push(i);
  });
  const topics = Object.keys(topicMap).sort((a,b)=> topicMap[b].length - topicMap[a].length || a.localeCompare(b));

  html += `<div class="section-heading"><div class="num">${kinds.length+1}</div><h2>Short Notes — by Topic</h2><div class="section-rule"></div><div class="count">${shortItems.length} questions across ${topics.length} topics</div></div>`;

  let anyTopicVisible = false;
  topics.forEach(topic=>{
    const list = topicMap[topic].sort((a,b)=> b.paper.sortKey.localeCompare(a.paper.sortKey));
    const vis = list.filter(i=>matchesSearch(i,q));
    if(vis.length===0 && q) return;
    anyTopicVisible = true;
    const doneCount = list.filter(i=>checklist[i.uid]).length;
    const openAttr = (allExpanded || q) ? 'open' : '';
    const slug = 'topic-' + topic.replace(/[^a-z0-9]+/gi,'-').toLowerCase();
    html += `<details class="topic-block" id="${slug}" ${openAttr}>
      <summary>
        <span class="chev">▶</span>
        <span class="tname">${esc(topic)}</span>
        <span class="tcount">${doneCount}/${list.length} done</span>
      </summary>
      <div class="topic-body">`;
    (q ? vis : list).forEach((i,idx)=> html += questionRowHtml(i, idx+1));
    html += `</div></details>`;
  });
  if(!anyTopicVisible && q){
    html += `<div class="empty-note">No short notes match your search.</div>`;
  }

  container.innerHTML = html;
}

/* ---------- Jump to a topic (from a badge click while in year view) ---------- */
function jumpToTopic(topic){
  if(currentView !== 'topic'){
    setView('topic');
  }
  setTimeout(()=>{
    const slug = 'topic-' + topic.replace(/[^a-z0-9]+/gi,'-').toLowerCase();
    const el = document.getElementById(slug);
    if(el){
      el.setAttribute('open','');
      el.scrollIntoView({behavior:'smooth', block:'start'});
      const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#b8863b';
      el.style.outline = '2px solid ' + accent;
      setTimeout(()=> el.style.outline='', 1400);
    }
  }, 60);
}

/* ---------- Paper switching ---------- */
async function setPaper(paper){
  if(paper === currentPaper) return;
  currentPaper = paper;
  PAPERS = PAPER_CONFIG[paper].data();
  ITEMS = buildItems();

  document.getElementById('btn-paper1').classList.toggle('active', paper==='p1');
  document.getElementById('btn-paper2').classList.toggle('active', paper==='p2');
  document.getElementById('btn-paper3').classList.toggle('active', paper==='p3');
  document.body.classList.toggle('paper-2', paper==='p2');
  document.body.classList.toggle('paper-3', paper==='p3');
  document.getElementById('paperSubtitle').textContent = ': ' + PAPER_CONFIG[paper].label;
  document.getElementById('searchBox').value = '';

  try{ localStorage.setItem('nimhans_active_paper', paper); }catch(e){}

  document.getElementById('app').innerHTML = '<div class="sync-note">Loading your progress…</div>';
  checklist = await loadChecklistFromCloud();
  renderAll();
}

/* ---------- View switching ---------- */
function setView(view){
  currentView = view;
  document.getElementById('btn-year').classList.toggle('active', view==='year');
  document.getElementById('btn-topic').classList.toggle('active', view==='topic');
  renderAll();
}

function toggleExpandAll(){
  allExpanded = !allExpanded;
  document.getElementById('expandBtn').textContent = allExpanded ? 'Collapse all' : 'Expand all';
  renderAll();
}

/* ---------- Master render ---------- */
function renderAll(){
  const container = document.getElementById('app');
  const q = document.getElementById('searchBox').value.trim();
  if(currentView === 'year'){
    renderYearView(container, q);
  } else {
    renderTopicView(container, q);
  }
  updateProgress();
}

/* ---------- Auth: sign in / sign out / auth state ---------- */
let isApproved = false;
let isAdmin = false;

async function handleGoogleSignIn(){
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if(error){
    document.getElementById('authStatus').className = 'auth-status err';
    document.getElementById('authStatus').textContent = error.message;
  }
}

async function handleAuthSubmit(e){
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  const btn = document.getElementById('authBtn');
  const status = document.getElementById('authStatus');
  btn.disabled = true;
  status.className = 'auth-status';
  status.textContent = 'Sending your link…';

  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname }
  });

  btn.disabled = false;
  if(error){
    status.className = 'auth-status err';
    status.textContent = error.message;
  } else {
    status.className = 'auth-status ok';
    status.textContent = 'Check your email for the sign-in link. You can close this tab after clicking it.';
  }
  return false;
}

async function handleSignOut(){
  await supabaseClient.auth.signOut();
}

function onSignedIn(user){
  currentUser = user;
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('userEmail').textContent = user.email;
  if(window.location.hash || window.location.search){
    history.replaceState(null, '', window.location.pathname);
  }
  checkAccess();
}

function onSignedOut(){
  currentUser = null;
  isApproved = false;
  isAdmin = false;
  checklist = {};
  document.getElementById('pendingGate').classList.add('hidden');
  document.getElementById('adminPanel').classList.add('hidden');
  document.getElementById('authGate').style.display = 'flex';
  document.getElementById('authStatus').textContent = '';
  document.getElementById('authStatus').className = 'auth-status';
  const emailInput = document.getElementById('authEmail');
  if(emailInput) emailInput.value = '';
}

supabaseClient.auth.onAuthStateChange((event, session)=>{
  if(session && session.user){
    if(!currentUser || currentUser.id !== session.user.id){
      onSignedIn(session.user);
    }
  } else {
    onSignedOut();
  }
});

/* ---------- Access control: is this signed-in email approved? ---------- */
async function checkAccess(){
  const email = currentUser.email;
  const { data, error } = await supabaseClient
    .from('allowed_users')
    .select('is_admin')
    .eq('email', email)
    .maybeSingle();

  if(error){ console.error('Access check failed', error); }

  if(data){
    isApproved = true;
    isAdmin = !!data.is_admin;
    document.getElementById('pendingGate').classList.add('hidden');
    document.getElementById('adminBtn').classList.toggle('hidden', !isAdmin);
    bootstrapApp();
  } else {
    isApproved = false;
    isAdmin = false;
    document.getElementById('adminBtn').classList.add('hidden');
    try{ await supabaseClient.from('pending_requests').upsert({ email }); }catch(e){ console.error(e); }
    document.getElementById('pendingEmail').textContent = email;
    document.getElementById('app').innerHTML = '';
    document.getElementById('pendingGate').classList.remove('hidden');
  }
}

/* ---------- Admin panel ---------- */
function openAdminPanel(){
  document.getElementById('adminPanel').classList.remove('hidden');
  loadAdminPanel();
}
function closeAdminPanel(){
  document.getElementById('adminPanel').classList.add('hidden');
}

async function loadAdminPanel(){
  if(!currentUser) return;
  const pendingEl = document.getElementById('pendingList');
  const approvedEl = document.getElementById('approvedList');
  pendingEl.innerHTML = '<div class="sync-note">Loading…</div>';
  approvedEl.innerHTML = '<div class="sync-note">Loading…</div>';

  const [{ data: pending, error: pErr }, { data: approved, error: aErr }] = await Promise.all([
    supabaseClient.from('pending_requests').select('email, requested_at').order('requested_at', { ascending: false }),
    supabaseClient.from('allowed_users').select('email, is_admin, added_at').order('added_at', { ascending: false })
  ]);

  if(!currentUser) return; // user signed out while this was in flight
  if(pErr) console.error(pErr);
  if(aErr) console.error(aErr);

  pendingEl.innerHTML = (pending && pending.length)
    ? pending.map(r => `
        <div class="admin-row" data-email="${esc(r.email)}">
          <span class="aemail">${esc(r.email)}</span>
          <span class="actions">
            <button class="approve" onclick="approveUser('${esc(r.email)}')">Approve</button>
            <button class="reject" onclick="rejectUser('${esc(r.email)}')">Reject</button>
          </span>
        </div>`).join('')
    : '<div class="empty-admin">No pending requests.</div>';

  approvedEl.innerHTML = (approved && approved.length)
    ? approved.map(r => `
        <div class="admin-row" data-email="${esc(r.email)}">
          <span class="aemail">${esc(r.email)} ${r.is_admin ? '<span class=\"badge-admin\">admin</span>' : ''}</span>
          <span class="actions">
            ${(currentUser && r.email === currentUser.email) ? '' : `<button class="revoke" onclick="revokeUser('${esc(r.email)}')">Revoke</button>`}
          </span>
        </div>`).join('')
    : '<div class="empty-admin">No approved users yet.</div>';
}

async function approveUser(email){
  try{
    await supabaseClient.from('allowed_users').upsert({ email });
    await supabaseClient.from('pending_requests').delete().eq('email', email);
    await loadAdminPanel();
  }catch(e){ console.error(e); alert('Could not approve — please try again.'); }
}
async function rejectUser(email){
  try{
    await supabaseClient.from('pending_requests').delete().eq('email', email);
    await loadAdminPanel();
  }catch(e){ console.error(e); alert('Could not reject — please try again.'); }
}
async function revokeUser(email){
  if(!confirm(`Revoke access for ${email}?`)) return;
  try{
    await supabaseClient.from('allowed_users').delete().eq('email', email);
    await loadAdminPanel();
  }catch(e){ console.error(e); alert('Could not revoke — please try again.'); }
}

/* ---------- Bootstrap (runs once the user is signed in and approved) ---------- */
async function bootstrapApp(){
  let startPaper = 'p1';
  try{
    const saved = localStorage.getItem('nimhans_active_paper');
    if(saved === 'p1' || saved === 'p2' || saved === 'p3') startPaper = saved;
  }catch(e){}
  currentPaper = startPaper;
  PAPERS = PAPER_CONFIG[startPaper].data();
  ITEMS = buildItems();

  document.getElementById('btn-paper1').classList.toggle('active', startPaper==='p1');
  document.getElementById('btn-paper2').classList.toggle('active', startPaper==='p2');
  document.getElementById('btn-paper3').classList.toggle('active', startPaper==='p3');
  document.body.classList.toggle('paper-2', startPaper==='p2');
  document.body.classList.toggle('paper-3', startPaper==='p3');
  document.getElementById('paperSubtitle').textContent = ': ' + PAPER_CONFIG[startPaper].label;

  document.getElementById('app').innerHTML = '<div class="sync-note">Loading your progress…</div>';
  checklist = await loadChecklistFromCloud();
  renderAll();
}

/* ============================================================
   NIMHANS Question Bank — app logic (multi-paper, cloud-synced)
   ============================================================ */

/* ---------- Resilience: never fail silently ---------- */
function showFatalBanner(message){
  let banner = document.getElementById('fatalBanner');
  if(!banner){
    banner = document.createElement('div');
    banner.id = 'fatalBanner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#7a2c22;color:#fff;padding:12px 18px;font-family:sans-serif;font-size:.85rem;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.3);';
    document.body.appendChild(banner);
  }
  banner.innerHTML = message + ' <button onclick="location.reload()" style="margin-left:10px;background:#fff;color:#7a2c22;border:none;padding:4px 12px;border-radius:5px;cursor:pointer;font-weight:700;">Refresh</button>';
}
window.addEventListener('error', function(e){
  console.error('Unhandled error:', e.error || e.message);
  showFatalBanner('Something went wrong loading part of the app.');
});
window.addEventListener('unhandledrejection', function(e){
  console.error('Unhandled promise rejection:', e.reason);
  showFatalBanner('Something went wrong syncing with the server.');
});

/* ---------- Supabase setup ---------- */
const SUPABASE_URL = 'https://mxqjvjdjnasavrbbxame.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14cWp2amRqbmFzYXZyYmJ4YW1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2NTk5OTksImV4cCI6MjA5OTIzNTk5OX0.IfEzIz3CQN4Qcd4oclgZxxLroH24p5fw_7k4nSTxu2M';
let supabaseClient = null;
try{
  if(!window.supabase) throw new Error('Supabase library did not load (check your internet connection or ad-blocker).');
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}catch(e){
  console.error('Supabase init failed:', e);
  showFatalBanner('Could not connect to the sign-in service. Please check your connection and refresh.');
}

/* ---------- Guard against missing data files (fy-data.js / notes-data.js / answers-data.js) ---------- */
function dataFilesOk(){
  const missing = [];
  if(typeof PAPERS1 === 'undefined' || typeof PAPERS2 === 'undefined' || typeof PAPERS3 === 'undefined') missing.push('Final Year question data');
  if(typeof NEURO_TOPICS === 'undefined' || typeof PSYCH_TOPICS === 'undefined' || typeof YEAR_DATA === 'undefined') missing.push('First Year question data');
  if(missing.length){
    console.error('Missing data files:', missing);
    showFatalBanner('Some content failed to load (' + missing.join(', ') + '). Please refresh — if this keeps happening, the site files may be incomplete.');
    return false;
  }
  return true;
}
// TOPIC_NOTES and ANSWER_DATA are optional (Study Notes / Q&A Mode enhancements) —
// the app should keep working without them, just without those extras.
if(typeof TOPIC_NOTES === 'undefined'){ window.TOPIC_NOTES = { neuro:{}, psych:{} }; }
if(typeof ANSWER_DATA === 'undefined'){ window.ANSWER_DATA = { 'fy-neuro':{}, 'fy-psych':{} }; }

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
  },
  'fy-neuro': {
    label: 'Basic Neurosciences',
    mode: 'topic-first',
    data: () => NEURO_TOPICS,
    yearData: () => YEAR_DATA.neuro,
    bodyClass: 'fy-neuro'
  },
  'fy-psych': {
    label: 'Psychology, Sociology & Anthropology',
    mode: 'topic-first',
    data: () => PSYCH_TOPICS,
    yearData: () => YEAR_DATA.psych,
    bodyClass: 'fy-psych'
  }
};

let examLevel = 'final'; // 'final' | 'first'
let FY_TEXT_INDEX = {}; // currentPaper -> Map(normalizedText -> item)
function fyNorm(s){ return (s||'').trim().toLowerCase().replace(/\s+/g,' '); }
function fySection(){ return currentPaper === 'fy-neuro' ? 'neuro' : 'psych'; }

let currentPaper = 'p1';
let currentView = 'year';
let allExpanded = false;
let checklist = {};
let PAPERS = PAPERS1;
let ITEMS = [];

/* ---------- Paper 3 domain split: Neurology vs Consultation-Liaison Psychiatry ---------- */
const P3_DOMAINS = [
  {
    key: 'neuro',
    label: 'Neurology',
    topics: [
      'Autoimmune & Infectious Neuropsychiatry',
      'Dementia & Neurocognitive Disorders',
      'Epilepsy & Seizure Disorders',
      'Functional Neurological Disorders',
      'Headache & Migraine',
      'Movement Disorders',
      'Neuroscience & Novel Treatments',
      'Sleep Disorders',
      'Stroke & Cerebrovascular Disease',
      'Traumatic Brain Injury & Post-concussion'
    ]
  },
  {
    key: 'cl',
    label: 'Consultation-Liaison Psychiatry',
    topics: [
      'Chronic Illness & Psychosomatic Medicine',
      'COVID-19 Neuropsychiatric Aspects',
      'Endocrine & Metabolic Neuropsychiatry',
      'Forensic & Ethics in Neuropsychiatry',
      'Geriatric Neuropsychiatry',
      "Perinatal & Women's Mental Health",
      'Psychopharmacology & Treatment-Induced Syndromes',
      'Sexual Medicine & Gender Identity'
    ]
  }
];
function domainForTopic(topic){
  for(const d of P3_DOMAINS){ if(d.topics.includes(topic)) return d; }
  return null;
}

/* ---------- Cloud checklist sync ---------- */
async function loadChecklistFromCloud(){
  if(!currentUser) return {};
  try{
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
  }catch(e){
    console.error('Failed to load progress (network):', e);
    return {};
  }
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
  if(PAPER_CONFIG[currentPaper].mode === 'topic-first'){
    return buildFYItems();
  }
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

/* ---------- Build flat item list for First Year (topic-first) papers ---------- */
function buildFYItems(){
  const items = [];
  const topics = PAPER_CONFIG[currentPaper].data();
  const textIndex = new Map();

  topics.forEach((t, ti)=>{
    if(t.subgroups){
      let qi = 0;
      t.subgroups.forEach((sg)=>{
        sg.questions.forEach(q=>{
          const item = {
            uid: currentPaper + '-t' + ti + '-' + qi,
            kind: 'fy',
            topic: t.topic,
            subgroup: sg.subgroup,
            text: q.text,
            year: q.year,
            typeLabel: q.type
          };
          items.push(item);
          textIndex.set(fyNorm(item.text), item);
          qi++;
        });
      });
    } else {
      t.questions.forEach((q, qi)=>{
        const item = {
          uid: currentPaper + '-t' + ti + '-' + qi,
          kind: 'fy',
          topic: t.topic,
          text: q.text,
          year: q.year,
          typeLabel: q.type
        };
        items.push(item);
        textIndex.set(fyNorm(item.text), item);
      });
    }
  });

  // Cross-link (and fall back to including) any questions that only appear
  // in the by-sitting dataset, so the two views always share one checklist.
  const yearGroups = PAPER_CONFIG[currentPaper].yearData ? PAPER_CONFIG[currentPaper].yearData() : null;
  if(yearGroups){
    yearGroups.forEach((g, gi)=>{
      g.questions.forEach((q, qi)=>{
        const key = fyNorm(q.text);
        if(!textIndex.has(key)){
          const item = {
            uid: currentPaper + '-y' + gi + '-' + qi,
            kind: 'fy',
            topic: null,
            text: q.text,
            year: g.year,
            typeLabel: q.type
          };
          items.push(item);
          textIndex.set(key, item);
        }
      });
    });
  }

  FY_TEXT_INDEX[currentPaper] = textIndex;
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
    item.topic||'', item.subgroup||'',
    item.paper ? item.paper.date : (item.year||''),
    item.paper ? item.paper.sitting : '',
    item.paper ? item.paper.version : ''
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

function fyQuestionRowHtml(item, num){
  const done = checklist[item.uid] ? 'done' : '';
  const numHtml = (num!=null) ? `<span class="qnum">${num}</span>` : '';
  return `
  <div class="qitem ${done}" data-uid="${item.uid}">
    ${checkboxHtml(item.uid)}
    <div class="qbody">
      <div class="qtext">${numHtml}${esc(item.text)}</div>
      <div class="qmeta">
        <span class="badge marks">${esc(item.typeLabel||'')}</span>
        ${item.topic ? `<span class="badge topic" onclick="jumpToTopic('${esc(item.topic)}')">${esc(item.topic)}</span>` : ''}
        ${item.year ? `<span class="badge date">${esc(item.year)}</span>` : ''}
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
  if(PAPER_CONFIG[currentPaper].mode === 'topic-first'){ renderFYYearView(container, q); return; }
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
        <div class="card-title-block">
          <div class="title">${esc(p.sitting)} : ${esc(p.version)}</div>
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
  if(PAPER_CONFIG[currentPaper].mode === 'topic-first'){ renderFYTopicView(container, q); return; }
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

  function renderTopicBlock(topic){
    const list = topicMap[topic].sort((a,b)=> b.paper.sortKey.localeCompare(a.paper.sortKey));
    const vis = list.filter(i=>matchesSearch(i,q));
    if(vis.length===0 && q) return '';
    anyTopicVisible = true;
    const doneCount = list.filter(i=>checklist[i.uid]).length;
    const openAttr = (allExpanded || q) ? 'open' : '';
    const slug = 'topic-' + topic.replace(/[^a-z0-9]+/gi,'-').toLowerCase();
    let block = `<details class="topic-block" id="${slug}" ${openAttr}>
      <summary>
        <span class="chev">▶</span>
        <span class="tname">${esc(topic)}</span>
        <span class="tcount">${doneCount}/${list.length} done</span>
      </summary>
      <div class="topic-body">`;
    (q ? vis : list).forEach((i,idx)=> block += questionRowHtml(i, idx+1));
    block += `</div></details>`;
    return block;
  }

  if(currentPaper === 'p3'){
    P3_DOMAINS.forEach(domain=>{
      const domainTopics = topics.filter(t=> domainForTopic(t) && domainForTopic(t).key === domain.key);
      if(!domainTopics.length) return;
      const domainItems = domainTopics.flatMap(t=>topicMap[t]);
      const domainDone = domainItems.filter(i=>checklist[i.uid]).length;
      const openAttr = (allExpanded || q) ? 'open' : '';
      html += `<details class="domain-block" ${openAttr}>
        <summary class="domain-head">
          <span class="chev">▶</span>
          <span class="dname">${esc(domain.label)}</span>
          <span class="tcount">${domainDone}/${domainItems.length} done · ${domainTopics.length} topics</span>
        </summary>
        <div class="domain-body">`;
      domainTopics.forEach(t=> html += renderTopicBlock(t));
      html += `</div></details>`;
    });
    // Any topics not classified (safety net) render flat, unclustered
    const unclassified = topics.filter(t=>!domainForTopic(t));
    unclassified.forEach(t=> html += renderTopicBlock(t));
  } else {
    topics.forEach(topic=> html += renderTopicBlock(topic));
  }

  if(!anyTopicVisible && q){
    html += `<div class="empty-note">No short notes match your search.</div>`;
  }

  container.innerHTML = html;
}

/* ---------- View: First Year — Topic-wise ---------- */
function renderFYTopicView(container, q){
  const topics = PAPER_CONFIG[currentPaper].data();
  let html = `<div class="section-heading"><div class="num">T</div><h2>${esc(PAPER_CONFIG[currentPaper].label)} — by Topic</h2><div class="section-rule"></div><div class="count">${topics.length} topics</div></div>`;
  let anyVisible = false;

  topics.forEach((t)=>{
    const topicItems = ITEMS.filter(i=>i.topic===t.topic);
    const vis = topicItems.filter(i=>matchesSearch(i,q));
    if(vis.length===0 && q) return;
    anyVisible = true;
    const doneCount = topicItems.filter(i=>checklist[i.uid]).length;
    const openAttr = (allExpanded || q) ? 'open' : '';
    const slug = 'topic-' + t.topic.replace(/[^a-z0-9]+/gi,'-').toLowerCase();

    html += `<details class="topic-block" id="${slug}" ${openAttr}>
      <summary>
        <span class="chev">▶</span>
        <span class="tname">${esc(t.topic)}</span>
        <span class="tcount">${doneCount}/${topicItems.length} done</span>
      </summary>
      <div class="topic-body">`;

    const notesHtml = TOPIC_NOTES[fySection()] ? TOPIC_NOTES[fySection()][t.topic] : null;
    if(notesHtml){
      html += `<details class="notes-panel">
        <summary class="notes-toggle"><span class="notes-icon">📖</span> Study Notes</summary>
        <div class="notes-content">${notesHtml}</div>
      </details>`;
    }

    if(t.subgroups){
      let lastSub = null;
      let idx = 0;
      (q ? vis : topicItems).forEach(i=>{
        if(i.subgroup && i.subgroup !== lastSub){
          html += `<div class="qgroup-label">${esc(i.subgroup)}</div>`;
          lastSub = i.subgroup;
        }
        idx++;
        html += fyQuestionRowHtml(i, idx);
      });
    } else {
      (q ? vis : topicItems).forEach((i,idx)=> html += fyQuestionRowHtml(i, idx+1));
    }
    html += `</div></details>`;
  });

  if(!anyVisible && q){
    html += `<div class="empty-note">No questions match your search.</div>`;
  }
  container.innerHTML = html;
}

/* ---------- View: First Year — by Exam Sitting (from the real YEAR_DATA set) ---------- */
const FY_MONTH_FULL = {Jan:'January',Feb:'February',Mar:'March',Apr:'April',May:'May',Jun:'June',Jul:'July',Aug:'August',Sep:'September',Oct:'October',Nov:'November',Dec:'December'};
function formatFYSitting(yearStr){
  const m = (yearStr||'').match(/^([A-Za-z]{3})\w*\s+(\d{4})(?:\s*\(S(\d)\))?/);
  if(!m) return yearStr||'';
  const monthFull = FY_MONTH_FULL[m[1]] || m[1];
  return m[3] ? `${monthFull} ${m[2]} : Set ${m[3]}` : `${monthFull} ${m[2]}`;
}

function renderFYYearView(container, q){
  const yearGroups = PAPER_CONFIG[currentPaper].yearData();
  const textIndex = FY_TEXT_INDEX[currentPaper];

  let html = `<div class="section-heading"><div class="num">Y</div><h2>${esc(PAPER_CONFIG[currentPaper].label)} — by Exam Sitting</h2><div class="section-rule"></div><div class="count">${yearGroups.length} sittings</div></div>`;
  let anyVisible = false;

  yearGroups.forEach((g)=>{
    const list = g.questions.map(qq => textIndex.get(fyNorm(qq.text))).filter(Boolean);
    const vis = list.filter(i=>matchesSearch(i,q));
    if(vis.length===0 && q) return;
    anyVisible = true;
    const doneCount = list.filter(i=>checklist[i.uid]).length;
    const openAttr = (allExpanded || q) ? 'open' : '';

    html += `<details class="paper-card" ${openAttr}>
      <summary class="paper-card-head">
        <span class="chev">▶</span>
        <div class="card-title-block"><div class="title">${esc(formatFYSitting(g.year))}</div></div>
        <div class="paper-progress">${doneCount} / ${list.length} done</div>
      </summary>
      <div class="paper-body">`;
    (q ? vis : list).forEach((i,idx)=> html += fyQuestionRowHtml(i, idx+1));
    html += `</div></details>`;
  });

  if(!anyVisible){
    html += `<div class="empty-note">No questions match your search.</div>`;
  }
  container.innerHTML = html;
}

/* ---------- View: First Year — Q&A Mode ---------- */
function fyQARowHtml(item, num){
  const ans = (ANSWER_DATA[currentPaper] && ANSWER_DATA[currentPaper][item.uid]) ? ANSWER_DATA[currentPaper][item.uid] : null;
  return `
  <div class="qa-item">
    <div class="qa-question">
      <span class="qnum">${num}</span>
      <span class="qa-qtext">${esc(item.text)}</span>
      <span class="badge marks">${esc(item.typeLabel||'')}</span>
      ${item.year ? `<span class="badge date">${esc(item.year)}</span>` : ''}
    </div>
    <div class="qa-answer">
      ${ans ? ans : '<span class="qa-pending">Answer not added yet — check back soon.</span>'}
    </div>
  </div>`;
}

/* Group items with the exact same question text (e.g. asked in several
   different sittings) into a single entry, so Q&A Mode doesn't repeat the
   identical question+answer block once per sitting. Questions with even
   slightly different wording are left as separate entries. */
function groupQAItems(items){
  const order = [];
  const byText = new Map();
  items.forEach(i=>{
    const key = fyNorm(i.text);
    if(!byText.has(key)){
      const group = { text:i.text, typeLabel:i.typeLabel, topic:i.topic, uids:[], years:[] };
      byText.set(key, group);
      order.push(group);
    }
    const group = byText.get(key);
    group.uids.push(i.uid);
    if(i.year) group.years.push(i.year);
  });
  return order;
}

function fyQAGroupRowHtml(group, num){
  const answerSet = ANSWER_DATA[currentPaper] || {};
  const answeredUid = group.uids.find(u=>answerSet[u]);
  const ans = answeredUid ? answerSet[answeredUid] : null;
  const yearBadges = group.years.map(y=>`<span class="badge date">${esc(y)}</span>`).join('');
  return `
  <div class="qa-item">
    <div class="qa-question">
      <span class="qnum">${num}</span>
      <span class="qa-qtext">${esc(group.text)}</span>
      <span class="badge marks">${esc(group.typeLabel||'')}</span>
      ${yearBadges}
    </div>
    <div class="qa-answer">
      ${ans ? ans : '<span class="qa-pending">Answer not added yet — check back soon.</span>'}
    </div>
  </div>`;
}

function renderFYQAView(container, q){
  const topics = PAPER_CONFIG[currentPaper].data();
  const answerSet = ANSWER_DATA[currentPaper] || {};
  const allGroups = groupQAItems(ITEMS);
  const answeredTotal = allGroups.filter(g=>g.uids.some(u=>answerSet[u])).length;

  let html = `<div class="section-heading"><div class="num">QA</div><h2>${esc(PAPER_CONFIG[currentPaper].label)} — Question &amp; Answer Mode</h2><div class="section-rule"></div></div>`;
  let anyVisible = false;

  topics.forEach((t)=>{
    const topicItems = ITEMS.filter(i=>i.topic===t.topic);
    const topicGroups = groupQAItems(topicItems);
    const visGroups = topicGroups.filter(g=>matchesSearch({text:g.text, topic:g.topic, year:g.years.join(' ')}, q));
    if(visGroups.length===0 && q) return;
    anyVisible = true;
    const answeredInTopic = topicGroups.filter(g=>g.uids.some(u=>answerSet[u])).length;
    const openAttr = (allExpanded || q) ? 'open' : '';
    const slug = 'qa-topic-' + t.topic.replace(/[^a-z0-9]+/gi,'-').toLowerCase();

    html += `<details class="topic-block" id="${slug}" ${openAttr}>
      <summary>
        <span class="chev">▶</span>
        <span class="tname">${esc(t.topic)}</span>
      </summary>
      <div class="topic-body">`;
    (q ? visGroups : topicGroups).forEach((g,idx)=> html += fyQAGroupRowHtml(g, idx+1));
    html += `</div></details>`;
  });

  if(!anyVisible && q){
    html += `<div class="empty-note">No questions match your search.</div>`;
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

/* ---------- Exam level switching (Final Year / First Year) ---------- */
function setLevel(level){
  if(level === examLevel) return;
  examLevel = level;
  document.getElementById('btn-levelFinal').classList.toggle('active', level==='final');
  document.getElementById('btn-levelFirst').classList.toggle('active', level==='first');
  document.getElementById('finalYearToggle').classList.toggle('hidden', level!=='final');
  document.getElementById('firstYearToggle').classList.toggle('hidden', level!=='first');
  document.getElementById('examLevelLabel').textContent = level==='final' ? 'NIMHANS Final Exam' : 'NIMHANS First Year Exam';
  document.getElementById('btn-qa').classList.toggle('hidden', level!=='first');
  if(level==='final' && currentView==='qa'){
    currentView = 'year';
    document.getElementById('btn-year').classList.add('active');
    document.getElementById('btn-topic').classList.remove('active');
    document.getElementById('btn-qa').classList.remove('active');
  }
  try{ localStorage.setItem('nimhans_active_level', level); }catch(e){}

  let nextPaper;
  try{
    if(level === 'final'){
      const saved = localStorage.getItem('nimhans_active_paper_final');
      nextPaper = (saved==='p1'||saved==='p2'||saved==='p3') ? saved : 'p1';
    } else {
      const saved = localStorage.getItem('nimhans_active_paper_first');
      nextPaper = (saved==='fy-neuro'||saved==='fy-psych') ? saved : 'fy-neuro';
    }
  }catch(e){ nextPaper = level==='final' ? 'p1' : 'fy-neuro'; }

  currentPaper = null; // force setPaper to re-render even if nextPaper matches a stale value
  setPaper(nextPaper);
}

/* ---------- Paper switching ---------- */
async function setPaper(paper){
  try{
    await setPaperInner(paper);
  }catch(e){
    console.error('setPaper failed:', e);
    document.getElementById('app').innerHTML =
      '<div class="sync-note">Something went wrong switching papers. '
      + `<button class="resetbtn" onclick="setPaper('${paper}')" style="margin-left:8px;">Retry</button></div>`;
  }
}

async function setPaperInner(paper){
  closeSidebar();
  if(paper === currentPaper) return;
  currentPaper = paper;
  PAPERS = PAPER_CONFIG[paper].data();
  ITEMS = buildItems();

  const isFinal = ['p1','p2','p3'].includes(paper);
  document.getElementById('btn-paper1').classList.toggle('active', paper==='p1');
  document.getElementById('btn-paper2').classList.toggle('active', paper==='p2');
  document.getElementById('btn-paper3').classList.toggle('active', paper==='p3');
  document.getElementById('btn-paperA').classList.toggle('active', paper==='fy-neuro');
  document.getElementById('btn-paperB').classList.toggle('active', paper==='fy-psych');
  document.body.classList.toggle('paper-2', paper==='p2');
  document.body.classList.toggle('paper-3', paper==='p3');
  document.body.classList.toggle('fy-neuro', paper==='fy-neuro');
  document.body.classList.toggle('fy-psych', paper==='fy-psych');
  document.getElementById('paperSubtitle').textContent = ': ' + PAPER_CONFIG[paper].label;
  document.getElementById('searchBox').value = '';

  try{
    if(isFinal) localStorage.setItem('nimhans_active_paper_final', paper);
    else localStorage.setItem('nimhans_active_paper_first', paper);
  }catch(e){}

  document.getElementById('app').innerHTML = '<div class="sync-note">Loading your progress…</div>';
  checklist = await loadChecklistFromCloud();
  renderAll();
  syncHeaderHeight();
}

/* ---------- View switching ---------- */
function setView(view){
  currentView = view;
  document.getElementById('btn-year').classList.toggle('active', view==='year');
  document.getElementById('btn-topic').classList.toggle('active', view==='topic');
  document.getElementById('btn-qa').classList.toggle('active', view==='qa');
  renderAll();
  closeSidebar();
}

function expandAll(){
  allExpanded = true;
  document.getElementById('expandBtn').classList.add('active');
  document.getElementById('collapseBtn').classList.remove('active');
  renderAll();
}
function collapseAll(){
  allExpanded = false;
  document.getElementById('collapseBtn').classList.add('active');
  document.getElementById('expandBtn').classList.remove('active');
  renderAll();
}

/* ---------- Master render ---------- */
function renderAll(){
  const container = document.getElementById('app');
  const q = document.getElementById('searchBox').value.trim();
  if(currentView === 'year'){
    renderYearView(container, q);
  } else if(currentView === 'qa'){
    renderFYQAView(container, q);
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
  if(!currentUser || !currentUser.email){
    showFatalBanner('Signed-in session looks invalid. Please sign in again.');
    return;
  }
  const email = currentUser.email;
  let data, error;
  try{
    ({ data, error } = await supabaseClient
      .from('allowed_users')
      .select('is_admin')
      .eq('email', email)
      .maybeSingle());
  }catch(e){
    error = e;
  }

  if(error){
    console.error('Access check failed', error);
    document.getElementById('app').innerHTML =
      '<div class="sync-note">Couldn\'t reach the server to check your access. '
      + '<button class="resetbtn" onclick="checkAccess()" style="margin-left:8px;">Retry</button></div>';
    return;
  }

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
  if(!dataFilesOk()) return;
  try{
    await bootstrapAppInner();
  }catch(e){
    console.error('bootstrapApp failed:', e);
    document.getElementById('app').innerHTML =
      '<div class="sync-note">Something went wrong loading the app. '
      + '<button class="resetbtn" onclick="bootstrapApp()" style="margin-left:8px;">Retry</button></div>';
  }
}

async function bootstrapAppInner(){
  let startLevel = 'final';
  try{
    const savedLevel = localStorage.getItem('nimhans_active_level');
    if(savedLevel === 'final' || savedLevel === 'first') startLevel = savedLevel;
  }catch(e){}

  let startPaper;
  try{
    if(startLevel === 'final'){
      const saved = localStorage.getItem('nimhans_active_paper_final');
      startPaper = (saved==='p1'||saved==='p2'||saved==='p3') ? saved : 'p1';
    } else {
      const saved = localStorage.getItem('nimhans_active_paper_first');
      startPaper = (saved==='fy-neuro'||saved==='fy-psych') ? saved : 'fy-neuro';
    }
  }catch(e){ startPaper = startLevel==='final' ? 'p1' : 'fy-neuro'; }

  examLevel = startLevel;
  document.getElementById('btn-levelFinal').classList.toggle('active', startLevel==='final');
  document.getElementById('btn-levelFirst').classList.toggle('active', startLevel==='first');
  document.getElementById('finalYearToggle').classList.toggle('hidden', startLevel!=='final');
  document.getElementById('firstYearToggle').classList.toggle('hidden', startLevel!=='first');
  document.getElementById('examLevelLabel').textContent = startLevel==='final' ? 'NIMHANS Final Exam' : 'NIMHANS First Year Exam';
  document.getElementById('btn-qa').classList.toggle('hidden', startLevel!=='first');

  currentPaper = startPaper;
  PAPERS = PAPER_CONFIG[startPaper].data();
  ITEMS = buildItems();

  document.getElementById('btn-paper1').classList.toggle('active', startPaper==='p1');
  document.getElementById('btn-paper2').classList.toggle('active', startPaper==='p2');
  document.getElementById('btn-paper3').classList.toggle('active', startPaper==='p3');
  document.getElementById('btn-paperA').classList.toggle('active', startPaper==='fy-neuro');
  document.getElementById('btn-paperB').classList.toggle('active', startPaper==='fy-psych');
  document.body.classList.toggle('paper-2', startPaper==='p2');
  document.body.classList.toggle('paper-3', startPaper==='p3');
  document.body.classList.toggle('fy-neuro', startPaper==='fy-neuro');
  document.body.classList.toggle('fy-psych', startPaper==='fy-psych');
  document.getElementById('paperSubtitle').textContent = ': ' + PAPER_CONFIG[startPaper].label;

  document.getElementById('app').innerHTML = '<div class="sync-note">Loading your progress…</div>';
  checklist = await loadChecklistFromCloud();
  renderAll();
  syncHeaderHeight();
}

/* ---------- Sidebar (mobile off-canvas drawer) ---------- */
function syncHeaderHeight(){
  const header = document.querySelector('.topbar');
  if(header){
    document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px');
  }
}
window.addEventListener('resize', syncHeaderHeight);
window.addEventListener('load', syncHeaderHeight);

function toggleSidebar(){
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const isOpen = sidebar.classList.contains('open');
  sidebar.classList.toggle('open', !isOpen);
  backdrop.classList.toggle('show', !isOpen);
}
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('show');
}

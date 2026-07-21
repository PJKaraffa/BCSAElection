let adminUser=null,election=null,positions=[],latestMetrics={},timer=null,loading=false,selectedMemberFile=null,importingMembers=false;
const $=id=>document.getElementById(id);
document.addEventListener('DOMContentLoaded',initializeAdmin);
async function initializeAdmin(){
  $('adminLoginButton').addEventListener('click',loginAdmin); $('logoutButton').addEventListener('click',logoutAdmin);
  $('newElectionButton').addEventListener('click',newElection); $('saveElectionButton').addEventListener('click',saveElection);
  $('importMembersButton').addEventListener('click',importMemberIds); $('addCandidateButton').addEventListener('click',addCandidate);
  $('refreshAdminButton').addEventListener('click',()=>loadDashboard(true));
  configureMemberFileImport();
  const {data:{session}}=await supabaseClient.auth.getSession(); if(session) await openAdminApp(session.user);
}
async function loginAdmin(){ const {data,error}=await supabaseClient.auth.signInWithPassword({email:$('adminEmail').value.trim(),password:$('adminPassword').value}); if(error)return setMessage('adminLoginMessage',error.message,'error'); await openAdminApp(data.user); }
async function openAdminApp(user){ const {data:p,error}=await supabaseClient.from('profiles').select('role,full_name').eq('id',user.id).single(); if(error||p?.role!=='admin'){await supabaseClient.auth.signOut();return setMessage('adminLoginMessage','This account is not authorized as an election administrator.','error');} adminUser=user;$('adminLoginCard').classList.add('hidden');$('adminApp').classList.remove('hidden');$('adminWelcome').textContent=p.full_name||user.email;await loadDashboard();timer=setInterval(()=>{if(!document.hidden)loadDashboard(false,true)},5000); }
async function logoutAdmin(){clearInterval(timer);await supabaseClient.auth.signOut();location.reload();}
async function loadDashboard(manual=false,liveOnly=false){ if(loading)return;loading=true;try{const {data,error}=await supabaseClient.rpc('get_admin_dashboard');if(error)throw error;election=data.election;positions=data.positions||[];latestMetrics=data.metrics||{};renderMetrics();renderResults(data.results||[]);if(!liveOnly){populateElectionForm();populatePositionSelect();renderCandidates();}$('liveUpdateStatus').textContent=`Live · Updated ${new Date().toLocaleTimeString()}`;}catch(e){console.error(e);if(manual)alert(e.message);}finally{loading=false;} }
function renderMetrics(){const eligible=Number(latestMetrics.eligible_count||0),voted=Number(latestMetrics.votes_cast||0),remaining=Math.max(eligible-voted,0),turnout=eligible?voted/eligible*100:0;$('eligibleCount').textContent=eligible;$('votesCastCount').textContent=voted;$('remainingCount').textContent=remaining;$('turnoutPercent').textContent=`${turnout.toFixed(1)}%`;$('adminElectionStatus').textContent=election?.status||'None';$('turnoutProgressText').textContent=`${voted} of ${eligible} eligible IDs have voted`;$('turnoutProgressBar').style.width=`${Math.min(turnout,100)}%`;$('liveElectionBadge').textContent=election?.status==='open'?'Election Open':election?.status==='closed'?'Election Closed':'Election Not Open';}
function populateElectionForm(){if(!election)return;$('electionNameInput').value=election.title||'';$('electionStatusInput').value=election.status;$('electionStartInput').value=toLocalInput(election.starts_at);$('electionEndInput').value=toLocalInput(election.ends_at);}
async function newElection(){const title=prompt('Enter the new election title:','BCSA Executive Board Election');if(!title)return;const {error}=await supabaseClient.rpc('admin_create_election',{p_title:title.trim()});if(error)return alert(error.message);await loadDashboard();setMessage('electionSaveMessage','New draft election created with all five offices.','success');}
async function saveElection(){if(!election)return;const s=new Date($('electionStartInput').value),e=new Date($('electionEndInput').value);if(!s.getTime()||!e.getTime()||e<=s)return setMessage('electionSaveMessage','Enter valid dates; the end must be after the start.','error');const {error}=await supabaseClient.rpc('admin_save_election',{p_id:election.id,p_title:$('electionNameInput').value.trim(),p_status:$('electionStatusInput').value,p_starts_at:s.toISOString(),p_ends_at:e.toISOString()});if(error)return setMessage('electionSaveMessage',error.message,'error');setMessage('electionSaveMessage','Election saved.','success');await loadDashboard();}
function populatePositionSelect(){$('candidatePosition').innerHTML=positions.length?positions.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join(''):'<option value="">No positions configured</option>';$('candidatePosition').disabled=!positions.length;$('addCandidateButton').disabled=!positions.length;}
async function addCandidate(){const name=$('candidateName').value.trim(),positionId=Number($('candidatePosition').value);if(!name||!positionId)return setMessage('candidateMessage','Enter a candidate and select an office.','error');const {error}=await supabaseClient.from('candidates').insert({election_id:election.id,position_id:positionId,name,display_order:Number($('candidateOrder').value)||1});if(error)return setMessage('candidateMessage',error.message,'error');$('candidateName').value='';await loadDashboard();}
function renderCandidates(){const rows=positions.flatMap(p=>(p.candidates||[]).map(c=>({...c,position:p.name})));$('candidateList').innerHTML=rows.length?rows.map(c=>`<div class="admin-row"><strong>${escapeHtml(c.position)}</strong><span>${escapeHtml(c.name)}</span><button class="secondary-button" onclick="removeCandidate(${c.id})">Remove</button></div>`).join(''):'<p>No candidates added yet.</p>';}
async function removeCandidate(id){if(!confirm('Remove this candidate?'))return;const {error}=await supabaseClient.from('candidates').delete().eq('id',id);if(error)return alert(error.message);await loadDashboard();}window.removeCandidate=removeCandidate;
function configureMemberFileImport(){
  const input=$('memberCsv'),dropZone=$('memberDropZone'),chooseButton=$('chooseMemberFileButton');
  if(!input||!dropZone||!chooseButton)return;
  chooseButton.addEventListener('click',event=>{event.stopPropagation();input.click();});
  dropZone.addEventListener('click',event=>{if(event.target!==chooseButton)input.click();});
  dropZone.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();input.click();}});
  input.addEventListener('change',()=>setSelectedMemberFile(input.files?.[0]||null));
  ['dragenter','dragover'].forEach(name=>dropZone.addEventListener(name,event=>{event.preventDefault();dropZone.classList.add('drag-over');}));
  ['dragleave','drop'].forEach(name=>dropZone.addEventListener(name,event=>{event.preventDefault();dropZone.classList.remove('drag-over');}));
  dropZone.addEventListener('drop',event=>{
    const file=event.dataTransfer?.files?.[0]||null;
    if(file)setSelectedMemberFile(file);
  });
}
function setSelectedMemberFile(file){
  selectedMemberFile=file;
  const name=$('memberFileName'),button=$('importMembersButton'),summary=$('memberImportSummary');
  if(name)name.textContent=file?`${file.name} · ${formatFileSize(file.size)}`:'No file selected';
  if(button)button.disabled=!file||importingMembers;
  if(summary)summary.textContent='';
  setMessage('memberImportMessage','','');
}
function formatFileSize(bytes){if(bytes<1024)return`${bytes} B`;if(bytes<1048576)return`${(bytes/1024).toFixed(1)} KB`;return`${(bytes/1048576).toFixed(1)} MB`;}
function parseMemberCsv(text){
  const rows=text.replace(/^\uFEFF/,'').split(/\r?\n/).map(row=>row.trim()).filter(Boolean);
  if(!rows.length)throw new Error('The CSV file is empty.');
  const firstCells=parseCsvRow(rows[0]);
  const memberColumn=firstCells.findIndex(cell=>cell.trim().toLowerCase()==='member_id');
  const hasHeader=memberColumn>=0;
  const columnIndex=hasHeader?memberColumn:0;
  const dataRows=hasHeader?rows.slice(1):rows;
  const ids=dataRows.map(row=>parseCsvRow(row)[columnIndex]?.trim()||'').filter(Boolean);
  const unique=[...new Set(ids)];
  if(!unique.length)throw new Error('No member IDs were found. Use a column named member_id.');
  return{ids:unique,totalRows:ids.length,duplicates:ids.length-unique.length};
}
function parseCsvRow(row){
  const cells=[];let value='',quoted=false;
  for(let i=0;i<row.length;i++){
    const char=row[i];
    if(char==='"'){
      if(quoted&&row[i+1]==='"'){value+='"';i++;}else quoted=!quoted;
    }else if(char===','&&!quoted){cells.push(value);value='';}
    else value+=char;
  }
  cells.push(value);return cells;
}
async function importMemberIds(){
  if(importingMembers)return;
  const file=selectedMemberFile||$('memberCsv')?.files?.[0]||null;
  if(!election)return setMessage('memberImportMessage','Create or load an election before importing IDs.','error');
  if(!file)return setMessage('memberImportMessage','Choose a CSV file first.','error');
  importingMembers=true;
  const button=$('importMembersButton');button.disabled=true;button.textContent='Importing…';
  try{
    const parsed=parseMemberCsv(await file.text());
    const {data,error}=await supabaseClient.rpc('admin_import_member_ids',{p_election_id:Number(election.id),p_member_ids:parsed.ids});
    if(error)throw error;
    const imported=Number(data?.imported??0),existing=Number(data?.existing??Math.max(parsed.ids.length-imported,0));
    setMessage('memberImportMessage',`Import complete: ${imported} new ID${imported===1?'':'s'} added.`,'success');
    $('memberImportSummary').textContent=`${parsed.ids.length} unique IDs read · ${existing} already existed · ${parsed.duplicates} duplicate CSV rows removed`;
    await loadDashboard();
  }catch(error){
    console.error(error);setMessage('memberImportMessage',error.message||'Unable to import the CSV file.','error');
  }finally{
    importingMembers=false;button.textContent='Import IDs';button.disabled=!selectedMemberFile;
  }
}
function renderResults(results){if(!election){$('resultsArea').innerHTML='<p>Create an election to display results.</p>';return;}const groups=results.reduce((a,r)=>((a[r.position_name]||=[]).push(r),a),{}),closed=election.status==='closed',total=Number(latestMetrics.votes_cast||0);$('resultsArea').innerHTML=Object.entries(groups).map(([name,raw])=>{const rows=[...raw].sort((a,b)=>b.vote_count-a.vote_count||a.display_order-b.display_order),seats=Number(rows[0]?.max_selections||1),cut=Number(rows[seats-1]?.vote_count||0),above=rows.filter(r=>r.vote_count>cut),at=rows.filter(r=>r.vote_count===cut),remaining=seats-above.length,tie=cut>0&&at.length>remaining,posId=rows[0]?.position_id;return `<section class="result-group"><div class="result-group-heading"><h3>${escapeHtml(name)}</h3><span>${seats} seat${seats===1?'':'s'}</span></div>${tie?`<div class="tie-alert"><div><strong>Tie detected:</strong> ${at.length} candidates are tied for ${remaining} remaining seat${remaining===1?'':'s'}.</div>${closed?`<button class="create-runoff-button" onclick="createRunoffElection(${election.id},${posId})">Create Runoff Election</button>`:''}</div>`:''}${rows.map((r,i)=>{const votes=Number(r.vote_count),pct=total?votes/total*100:0,isTie=tie&&votes===cut,isLeader=votes>0&&(votes>cut||(!tie&&i<seats));return `<div class="result-candidate ${isTie?'tie':isLeader?'leader':''}"><div class="result-candidate-topline"><strong>${escapeHtml(r.candidate_name)}</strong><span>${isTie?(closed?'Tie — runoff needed':'Tied'):isLeader?(closed?'Winner':'Leading'):''} &nbsp; ${votes} vote${votes===1?'':'s'} · ${pct.toFixed(1)}%</span></div><div class="result-bar"><div style="width:${Math.min(pct,100)}%"></div></div></div>`}).join('')}</section>`}).join('')||'<p>No candidates or results yet.</p>';}
async function createRunoffElection(eid,pid){if(!confirm('Create a runoff for this tied office?'))return;const {data,error}=await supabaseClient.rpc('admin_create_runoff_election',{p_source_election_id:eid,p_position_id:pid});if(error)return alert(error.message);alert(`Runoff created: ${data.title}\nEligible IDs copied: ${data.eligible_count}`);await loadDashboard();}window.createRunoffElection=createRunoffElection;
function toLocalInput(v){if(!v)return'';const d=new Date(v),o=d.getTimezoneOffset();return new Date(d.getTime()-o*60000).toISOString().slice(0,16);}
function setMessage(id,text,type){const e=$(id);e.textContent=text;e.className=`message ${type||''}`;}
function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}

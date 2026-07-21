let publicElection = null;
let ballotPositions = [];
let verifiedMemberId = "";
const selectedCandidates = new Map();
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  $("verifyButton").addEventListener("click", verifyMemberId);
  $("memberId").addEventListener("keydown", e => { if (e.key === "Enter") verifyMemberId(); });
  $("clearButton").addEventListener("click", clearSelections);
  $("confirmReview").addEventListener("change", updateSubmitState);
  $("submitButton").addEventListener("click", submitBallot);
  await loadElection();
});

async function loadElection() {
  const { data, error } = await supabaseClient.rpc("get_public_election");
  if (error) return setMessage("verifyMessage", error.message, "error");
  publicElection = data?.election || null;
  ballotPositions = data?.positions || [];
  if (!publicElection) {
    $("electionStatus").textContent = "No Election Open";
    $("electionTitle").textContent = "BCSA Election";
    $("electionDates").textContent = "Please check again after the election opens.";
    $("memberId").disabled = $("verifyButton").disabled = true;
    return;
  }
  $("electionStatus").textContent = "Election Open";
  $("electionTitle").textContent = publicElection.title;
  $("electionDates").textContent = `${formatDate(publicElection.starts_at)} through ${formatDate(publicElection.ends_at)}`;
}

async function verifyMemberId() {
  const memberId = $("memberId").value.trim();
  if (!memberId) return setMessage("verifyMessage", "Enter your member ID.", "error");
  setVerifyLoading(true);
  const { data, error } = await supabaseClient.rpc("verify_voter", { p_election_id: publicElection.id, p_member_id: memberId });
  setVerifyLoading(false);
  if (error) return setMessage("verifyMessage", error.message, "error");
  if (!data?.valid) return setMessage("verifyMessage", data?.message || "That ID could not be verified.", "error");
  verifiedMemberId = memberId;
  $("memberId").value = "";
  $("verifyCard").classList.add("hidden");
  $("ballotCard").classList.remove("hidden");
  renderBallot();
}

function renderBallot() {
  selectedCandidates.clear();
  $("confirmReview").checked = false;
  $("ballotPositions").innerHTML = ballotPositions.map(position => {
    const seats = Number(position.max_selections);
    return `<section class="ballot-position"><div class="ballot-position-heading"><div><h3>${escapeHtml(position.name)}</h3><p>Select exactly ${seats} candidate${seats===1?'':'s'}</p></div><span id="counter-${position.id}" class="selection-counter">0 / ${seats}</span></div><div class="candidate-grid">${(position.candidates||[]).map(c => `<button type="button" class="candidate-button" data-position-id="${position.id}" data-candidate-id="${c.id}" onclick="toggleCandidate(${position.id},${c.id})">${escapeHtml(c.name)}</button>`).join('')}</div></section>`;
  }).join('');
  updateSubmitState();
}

function toggleCandidate(button, positionId, candidateId, maxSelections) {

    if (!selected[positionId]) {
        selected[positionId] = [];
    }

    const picks = selected[positionId];
    const index = picks.indexOf(candidateId);

    if (index >= 0) {
        picks.splice(index, 1);
        button.classList.remove("selected");
    } else {

        if (picks.length >= maxSelections) {
            return;
        }

        picks.push(candidateId);
        button.classList.add("selected");
    }

    updateCounters();
}
window.toggleCandidate=toggleCandidate;

function clearSelections(){ selectedCandidates.clear(); document.querySelectorAll('.candidate-button.selected').forEach(b=>b.classList.remove('selected')); ballotPositions.forEach(p=>$(`counter-${p.id}`).textContent=`0 / ${p.max_selections}`); $("confirmReview").checked=false; updateSubmitState(); }
function ballotIsComplete(){ return ballotPositions.length>0 && ballotPositions.every(p=>(selectedCandidates.get(p.id)?.size||0)===Number(p.max_selections)); }
function updateSubmitState(){ $("submitButton").disabled=!(verifiedMemberId && ballotIsComplete() && $("confirmReview").checked); }

async function submitBallot(){
  const selections=[]; for(const p of ballotPositions) for(const candidateId of selectedCandidates.get(p.id)||[]) selections.push({position_id:p.id,candidate_id:candidateId});
  $("submitButton").disabled=true; $("submitButton").textContent="Submitting…";
  const {data,error}=await supabaseClient.rpc("submit_anonymous_ballot",{p_election_id:publicElection.id,p_member_id:verifiedMemberId,p_selections:selections});
  $("submitButton").textContent="Submit Ballot Anonymously";
  if(error) return setMessage("submitMessage",error.message,"error");
  if(!data?.success){ updateSubmitState(); return setMessage("submitMessage",data?.message||"Unable to submit ballot.","error"); }
  verifiedMemberId=""; $("ballotCard").classList.add("hidden"); $("successCard").classList.remove("hidden"); $("confirmationNumber").textContent=data.confirmation_number;
}
function setVerifyLoading(x){ $("verifyButton").disabled=x; $("verifyButton").textContent=x?"Checking…":"Verify ID"; }
function formatDate(v){ return new Date(v).toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}); }
function setMessage(id,text,type){ const e=$(id); e.textContent=text; e.className=`message ${type||''}`; }
function escapeHtml(v){ return String(v).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }

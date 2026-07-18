let activeElection = null;
let ballotPositions = [];
let verifiedToken = null;

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", initializeVoterPage);

async function initializeVoterPage() {
  $("verifyButton").addEventListener("click", verifyMemberId);
  $("memberId").addEventListener("keydown", (event) => {
    if (event.key === "Enter") verifyMemberId();
  });
  $("clearButton").addEventListener("click", clearSelections);
  $("confirmReview").addEventListener("change", updateSubmitButton);
  $("submitButton").addEventListener("click", submitBallot);
  await loadActiveElection();
}

async function loadActiveElection() {
  const { data, error } = await supabaseClient.rpc("get_public_election");
  if (error || !data?.election) {
    $("electionStatus").textContent = "No Open Election";
    $("electionTitle").textContent = "Voting is not currently available";
    $("electionDates").textContent = "Please check back during the official voting period.";
    $("verifyButton").disabled = true;
    return;
  }

  activeElection = data.election;
  ballotPositions = data.positions || [];
  $("electionStatus").textContent = "Open";
  $("electionTitle").textContent = activeElection.title;
  $("electionDates").textContent = `${formatDate(activeElection.starts_at)} – ${formatDate(activeElection.ends_at)}`;
}

async function verifyMemberId() {
  const memberId = $("memberId").value.trim();
  setMessage("verifyMessage", "", "");
  if (!memberId) return setMessage("verifyMessage", "Enter your member ID.", "error");
  if (!activeElection) return setMessage("verifyMessage", "There is no open election.", "error");

  $("verifyButton").disabled = true;
  const { data, error } = await supabaseClient.rpc("verify_voter", {
    p_election_id: activeElection.id,
    p_member_id: memberId
  });
  $("verifyButton").disabled = false;

  if (error || !data?.valid) {
    return setMessage("verifyMessage", data?.message || "That ID is invalid or has already voted.", "error");
  }

  verifiedToken = data.token;
  $("memberId").value = "";
  $("verifyCard").classList.add("hidden");
  renderBallot();
  $("ballotCard").classList.remove("hidden");
}

function renderBallot() {
  const container = $("ballotPositions");
  container.innerHTML = ballotPositions.map((position) => `
    <section class="position-block" data-position-id="${position.id}" data-max="${position.max_selections}">
      <div class="position-header">
        <h3>${escapeHtml(position.name)}</h3>
        <span class="position-counter">Select ${position.max_selections}</span>
      </div>
      <div class="candidate-grid">
        ${(position.candidates || []).map((candidate) => `
          <div class="candidate-choice">
            <input type="checkbox" id="candidate-${candidate.id}" value="${candidate.id}">
            <label for="candidate-${candidate.id}">${escapeHtml(candidate.name)}</label>
          </div>
        `).join("")}
      </div>
    </section>
  `).join("");

  container.querySelectorAll(".position-block").forEach((block) => {
    block.querySelectorAll('input[type="checkbox"]').forEach((box) => {
      box.addEventListener("change", () => enforceSelectionLimit(block));
    });
  });
}

function enforceSelectionLimit(block) {
  const max = Number(block.dataset.max);
  const boxes = [...block.querySelectorAll('input[type="checkbox"]')];
  const selected = boxes.filter((box) => box.checked);
  boxes.forEach((box) => { box.disabled = selected.length >= max && !box.checked; });
  block.querySelector(".position-counter").textContent = `${selected.length} of ${max} selected`;
  updateSubmitButton();
}

function clearSelections() {
  document.querySelectorAll('#ballotPositions input[type="checkbox"]').forEach((box) => {
    box.checked = false;
    box.disabled = false;
  });
  document.querySelectorAll(".position-block").forEach((block) => {
    block.querySelector(".position-counter").textContent = `Select ${block.dataset.max}`;
  });
  $("confirmReview").checked = false;
  updateSubmitButton();
}

function getSelections() {
  return [...document.querySelectorAll(".position-block")].map((block) => ({
    position_id: Number(block.dataset.positionId),
    candidate_ids: [...block.querySelectorAll('input[type="checkbox"]:checked')].map((box) => Number(box.value)),
    max: Number(block.dataset.max)
  }));
}

function updateSubmitButton() {
  const complete = getSelections().every((item) => item.candidate_ids.length === item.max);
  $("submitButton").disabled = !(complete && $("confirmReview").checked && verifiedToken);
}

async function submitBallot() {
  const selections = getSelections();
  if (!selections.every((item) => item.candidate_ids.length === item.max)) {
    return setMessage("submitMessage", "Complete every position before submitting.", "error");
  }

  $("submitButton").disabled = true;
  const payload = selections.flatMap((item) => item.candidate_ids.map((candidateId) => ({
    position_id: item.position_id,
    candidate_id: candidateId
  })));

  const { data, error } = await supabaseClient.rpc("submit_anonymous_ballot", {
    p_verification_token: verifiedToken,
    p_selections: payload
  });

  if (error || !data?.success) {
    $("submitButton").disabled = false;
    return setMessage("submitMessage", data?.message || error?.message || "The ballot could not be submitted.", "error");
  }

  verifiedToken = null;
  $("ballotCard").classList.add("hidden");
  $("confirmationNumber").textContent = data.confirmation_number;
  $("successCard").classList.remove("hidden");
}

function setMessage(id, text, type) {
  const element = $(id);
  element.textContent = text;
  element.className = `message ${type || ""}`;
}
function formatDate(value) { return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }

let publicElection = null;
let ballotPositions = [];
let verificationToken = null;
const selectedCandidates = new Map();
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", initializeVotingPage);

async function initializeVotingPage() {
  $("verifyButton").addEventListener("click", verifyMemberId);
  $("memberId").addEventListener("keydown", (event) => {
    if (event.key === "Enter") verifyMemberId();
  });
  $("clearButton").addEventListener("click", clearSelections);
  $("confirmReview").addEventListener("change", updateSubmitState);
  $("submitButton").addEventListener("click", submitBallot);
  await loadElection();
}

async function loadElection() {
  setMessage("verifyMessage", "", "");
  const { data, error } = await supabaseClient.rpc("get_public_election");

  if (error) {
    $("electionStatus").textContent = "Unable to load election";
    setMessage("verifyMessage", error.message, "error");
    return;
  }

  publicElection = data?.election || null;
  ballotPositions = data?.positions || [];

  if (!publicElection) {
    $("electionStatus").textContent = "No election open";
    $("electionTitle").textContent = "BCSA Election";
    $("electionDates").textContent = "Please check again after the election opens.";
    $("verifyButton").disabled = true;
    $("memberId").disabled = true;
    return;
  }

  $("electionStatus").textContent = "Election Open";
  $("electionTitle").textContent = publicElection.title;
  $("electionDates").textContent = `${formatDate(publicElection.starts_at)} through ${formatDate(publicElection.ends_at)}`;
  $("verifyButton").disabled = false;
  $("memberId").disabled = false;
}

async function verifyMemberId() {
  if (!publicElection) return;

  const memberId = $("memberId").value.trim();
  if (!memberId) return setMessage("verifyMessage", "Enter your member ID.", "error");

  setVerifyLoading(true);
  setMessage("verifyMessage", "Checking eligibility…", "");

  const { data, error } = await supabaseClient.rpc("verify_voter", {
    p_election_id: publicElection.id,
    p_member_id: memberId
  });

  setVerifyLoading(false);

  if (error) return setMessage("verifyMessage", error.message, "error");
  if (!data?.valid) return setMessage("verifyMessage", data?.message || "That ID could not be verified.", "error");

  verificationToken = data.token;
  $("memberId").value = "";
  $("verifyCard").classList.add("hidden");
  $("ballotCard").classList.remove("hidden");
  renderBallot();
  window.scrollTo({ top: $("ballotCard").offsetTop - 20, behavior: "smooth" });
}

function renderBallot() {
  selectedCandidates.clear();
  $("confirmReview").checked = false;

  $("ballotPositions").innerHTML = ballotPositions.map((position) => {
    const seats = Number(position.max_selections || 1);
    const instruction = seats === 1 ? "Select 1 candidate" : `Select exactly ${seats} candidates`;

    return `
      <section class="ballot-position" data-position-id="${position.id}">
        <div class="ballot-position-heading">
          <div>
            <h3>${escapeHtml(position.name)}</h3>
            <p>${instruction}</p>
          </div>
          <span class="selection-counter" id="counter-${position.id}">0 / ${seats}</span>
        </div>
        <div class="candidate-grid">
          ${(position.candidates || []).map((candidate) => `
            <button
              type="button"
              class="candidate-button"
              data-position-id="${position.id}"
              data-candidate-id="${candidate.id}"
              onclick="toggleCandidate(${position.id}, ${candidate.id})"
            >${escapeHtml(candidate.name)}</button>
          `).join("")}
        </div>
      </section>
    `;
  }).join("");

  updateSubmitState();
}

function toggleCandidate(positionId, candidateId) {
  const position = ballotPositions.find((item) => Number(item.id) === Number(positionId));
  if (!position) return;

  const maximum = Number(position.max_selections || 1);
  const chosen = selectedCandidates.get(positionId) || new Set();

  if (chosen.has(candidateId)) {
    chosen.delete(candidateId);
  } else {
    if (chosen.size >= maximum) return;
    chosen.add(candidateId);
  }

  selectedCandidates.set(positionId, chosen);

  document.querySelectorAll(`[data-position-id="${positionId}"][data-candidate-id]`).forEach((button) => {
    button.classList.toggle("selected", chosen.has(Number(button.dataset.candidateId)));
  });

  $(`counter-${positionId}`).textContent = `${chosen.size} / ${maximum}`;
  updateSubmitState();
}
window.toggleCandidate = toggleCandidate;

function clearSelections() {
  selectedCandidates.clear();
  document.querySelectorAll(".candidate-button.selected").forEach((button) => button.classList.remove("selected"));
  ballotPositions.forEach((position) => {
    $(`counter-${position.id}`).textContent = `0 / ${position.max_selections}`;
  });
  $("confirmReview").checked = false;
  setMessage("submitMessage", "", "");
  updateSubmitState();
}

function ballotIsComplete() {
  return ballotPositions.length > 0 && ballotPositions.every((position) => {
    return (selectedCandidates.get(position.id)?.size || 0) === Number(position.max_selections);
  });
}

function updateSubmitState() {
  $("submitButton").disabled = !(verificationToken && ballotIsComplete() && $("confirmReview").checked);
}

async function submitBallot() {
  if (!verificationToken || !ballotIsComplete()) return;

  const selections = [];
  for (const position of ballotPositions) {
    for (const candidateId of selectedCandidates.get(position.id) || []) {
      selections.push({ position_id: position.id, candidate_id: candidateId });
    }
  }

  $("submitButton").disabled = true;
  $("submitButton").textContent = "Submitting…";
  setMessage("submitMessage", "Recording your anonymous ballot…", "");

  const { data, error } = await supabaseClient.rpc("submit_anonymous_ballot", {
    p_verification_token: verificationToken,
    p_selections: selections
  });

  $("submitButton").textContent = "Submit Ballot Anonymously";

  if (error) {
    updateSubmitState();
    return setMessage("submitMessage", error.message, "error");
  }

  if (!data?.success) {
    updateSubmitState();
    return setMessage("submitMessage", data?.message || "The ballot could not be submitted.", "error");
  }

  verificationToken = null;
  $("ballotCard").classList.add("hidden");
  $("successCard").classList.remove("hidden");
  $("confirmationNumber").textContent = data.confirmation_number;
  window.scrollTo({ top: $("successCard").offsetTop - 20, behavior: "smooth" });
}

function setVerifyLoading(loading) {
  $("verifyButton").disabled = loading;
  $("verifyButton").textContent = loading ? "Checking…" : "Verify ID";
}

function formatDate(value) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function setMessage(id, text, type) {
  const element = $(id);
  element.textContent = text;
  element.className = `message ${type || ""}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[character]));
}

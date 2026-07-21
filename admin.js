let adminUser = null;
let election = null;
let positions = [];
let latestMetrics = {};
let liveRefreshTimer = null;
let dashboardLoading = false;
let runoffCreating = false;
const LIVE_REFRESH_MS = 5000;
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", initializeAdmin);

async function initializeAdmin() {
  $("adminLoginButton").addEventListener("click", loginAdmin);
  $("logoutButton").addEventListener("click", logoutAdmin);
  $("saveElectionButton").addEventListener("click", saveElection);
  $("importMembersButton").addEventListener("click", importMemberIds);
  $("addCandidateButton").addEventListener("click", addCandidate);
  $("refreshAdminButton").addEventListener("click", () => loadDashboard({ manual: true }));

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) await openAdminApp(session.user);
}

async function loginAdmin() {
  const email = $("adminEmail").value.trim();
  const password = $("adminPassword").value;
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return setMessage("adminLoginMessage", error.message, "error");
  await openAdminApp(data.user);
}

async function openAdminApp(user) {
  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("role,full_name")
    .eq("id", user.id)
    .single();

  if (error || profile?.role !== "admin") {
    await supabaseClient.auth.signOut();
    return setMessage(
      "adminLoginMessage",
      "This account is not authorized as an election administrator.",
      "error"
    );
  }

  adminUser = user;
  $("adminLoginCard").classList.add("hidden");
  $("adminApp").classList.remove("hidden");
  $("adminWelcome").textContent = profile.full_name || user.email;

  await loadDashboard();
  startLiveRefresh();
}

function startLiveRefresh() {
  stopLiveRefresh();
  liveRefreshTimer = window.setInterval(() => {
    if (!document.hidden) loadDashboard({ liveOnly: true });
  }, LIVE_REFRESH_MS);
}

function stopLiveRefresh() {
  if (liveRefreshTimer) {
    clearInterval(liveRefreshTimer);
    liveRefreshTimer = null;
  }
}

async function logoutAdmin() {
  stopLiveRefresh();
  await supabaseClient.auth.signOut();
  location.reload();
}

async function loadDashboard({ liveOnly = false, manual = false } = {}) {
  if (dashboardLoading) return;
  dashboardLoading = true;

  try {
    if (manual) setLiveStatus("Refreshing…", "refreshing");

    const { data, error } = await supabaseClient.rpc("get_admin_dashboard");
    if (error) throw error;

    election = data.election;
    positions = data.positions || [];
    latestMetrics = data.metrics || {};

    renderMetrics(latestMetrics);
    renderResults(data.results || []);
    renderLiveSummary();

    // Do not overwrite form fields while the administrator is typing.
    if (!liveOnly) {
      populateElectionForm();
      populatePositionSelect();
      renderCandidates();
    }

    setLiveStatus(`Live · Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`, "live");
  } catch (error) {
    setLiveStatus("Live update failed", "error");
    if (manual) alert(error.message);
    console.error(error);
  } finally {
    dashboardLoading = false;
  }
}

function renderMetrics(metrics) {
  const eligible = Number(metrics.eligible_count || 0);
  const voted = Number(metrics.votes_cast || 0);
  const remaining = Math.max(eligible - voted, 0);
  const turnout = eligible ? (voted / eligible) * 100 : Number(metrics.turnout || 0);

  $("eligibleCount").textContent = eligible;
  $("votesCastCount").textContent = voted;
  $("remainingCount").textContent = remaining;
  $("turnoutPercent").textContent = `${turnout.toFixed(1)}%`;
  $("adminElectionStatus").textContent = election?.status || "None";

  const progress = $("turnoutProgressBar");
  progress.style.width = `${Math.min(Math.max(turnout, 0), 100)}%`;
  progress.setAttribute("aria-valuenow", turnout.toFixed(1));
  $("turnoutProgressText").textContent = `${voted} of ${eligible} eligible IDs have voted`;
}

function renderLiveSummary() {
  const isOpen = election?.status === "open";
  const badge = $("liveElectionBadge");
  badge.textContent = isOpen ? "Election Open" : election?.status === "closed" ? "Election Closed" : "Election Not Open";
  badge.className = `live-election-badge ${isOpen ? "open" : election?.status === "closed" ? "closed" : "inactive"}`;

  $("resultsExplanation").textContent = isOpen
    ? "Current leaders are highlighted in green. Results update automatically every five seconds and are visible only to administrators."
    : election?.status === "closed"
      ? "Certified winners are highlighted in green."
      : "Results will appear as ballots are submitted.";
}

function setLiveStatus(text, state) {
  const element = $("liveUpdateStatus");
  if (!element) return;
  element.textContent = text;
  element.className = `live-update-status ${state || ""}`;
}

function populateElectionForm() {
  if (!election) return;
  $("electionNameInput").value = election.title || "";
  $("electionStatusInput").value = election.status;
  $("electionStartInput").value = toLocalInput(election.starts_at);
  $("electionEndInput").value = toLocalInput(election.ends_at);
}

async function saveElection() {
  const title = $("electionNameInput").value.trim();
  const startValue = $("electionStartInput").value;
  const endValue = $("electionEndInput").value;

  if (!title) return setMessage("electionSaveMessage", "Enter an election title.", "error");
  if (!startValue || !endValue) return setMessage("electionSaveMessage", "Enter both the start and end date.", "error");

  const startDate = new Date(startValue);
  const endDate = new Date(endValue);
  if (endDate <= startDate) return setMessage("electionSaveMessage", "The election end date must be after the start date.", "error");

  const payload = {
    p_id: election?.id || null,
    p_title: title,
    p_status: $("electionStatusInput").value,
    p_starts_at: startDate.toISOString(),
    p_ends_at: endDate.toISOString()
  };

  const { error } = await supabaseClient.rpc("admin_save_election", payload);
  if (error) return setMessage("electionSaveMessage", error.message, "error");
  setMessage("electionSaveMessage", "Election saved.", "success");
  await loadDashboard();
}

function populatePositionSelect() {
  const select = $("candidatePosition");
  select.innerHTML = positions.length
    ? positions.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("")
    : '<option value="">No positions configured</option>';
  select.disabled = !positions.length;
  $("addCandidateButton").disabled = !positions.length;
}

async function addCandidate() {
  const name = $("candidateName").value.trim();
  const positionId = Number($("candidatePosition").value);
  if (!positionId) return setMessage("candidateMessage", "Select a position.", "error");
  if (!name) return setMessage("candidateMessage", "Enter the candidate name.", "error");

  const { error } = await supabaseClient.from("candidates").insert({
    election_id: election.id,
    position_id: positionId,
    name,
    display_order: Number($("candidateOrder").value) || 1
  });

  if (error) return setMessage("candidateMessage", error.message, "error");
  $("candidateName").value = "";
  setMessage("candidateMessage", "Candidate added.", "success");
  await loadDashboard();
}

function renderCandidates() {
  const rows = positions.flatMap((position) =>
    (position.candidates || []).map((candidate) => ({ ...candidate, position: position.name }))
  );

  $("candidateList").innerHTML = rows.length
    ? rows.map((candidate) => `
      <div class="admin-row">
        <strong>${escapeHtml(candidate.position)}</strong>
        <span>${escapeHtml(candidate.name)}</span>
        <button class="secondary-button" onclick="removeCandidate(${candidate.id})">Remove</button>
      </div>
    `).join("")
    : "<p>No candidates added yet.</p>";
}

async function removeCandidate(candidateId) {
  if (!confirm("Remove this candidate?")) return;
  const { error } = await supabaseClient.from("candidates").delete().eq("id", candidateId);
  if (error) return alert(error.message);
  await loadDashboard();
}
window.removeCandidate = removeCandidate;

async function importMemberIds() {
  const file = $("memberCsv").files[0];
  if (!file || !election) return setMessage("memberImportMessage", "Choose a CSV file first.", "error");

  const text = await file.text();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const ids = lines[0]?.toLowerCase().includes("member_id") ? lines.slice(1) : lines;
  const cleanIds = [...new Set(ids.map((line) => line.split(",")[0].replace(/^"|"$/g, "").trim()).filter(Boolean))];

  const { data, error } = await supabaseClient.rpc("admin_import_member_ids", {
    p_election_id: election.id,
    p_member_ids: cleanIds
  });

  if (error) return setMessage("memberImportMessage", error.message, "error");
  setMessage("memberImportMessage", `${data.imported} IDs imported.`, "success");
  await loadDashboard();
}


async function createRunoffElection(sourceElectionId, positionId) {
  if (runoffCreating) return;

  const position = positions.find((item) => Number(item.id) === Number(positionId));
  const positionName = position?.name || "this office";
  const confirmed = confirm(
    `Create a runoff election for ${positionName}?\n\n` +
    "The runoff will be created as a DRAFT, include only the candidates tied at the winning cutoff, and copy the same eligible voter IDs."
  );
  if (!confirmed) return;

  runoffCreating = true;
  document.querySelectorAll(".create-runoff-button").forEach((button) => {
    button.disabled = true;
    button.textContent = "Creating Runoff…";
  });

  try {
    const { data, error } = await supabaseClient.rpc("admin_create_runoff_election", {
      p_source_election_id: Number(sourceElectionId),
      p_position_id: Number(positionId)
    });

    if (error) throw error;

    alert(
      `Runoff election created successfully.\n\n` +
      `Election: ${data.title}\n` +
      `Office: ${data.position_name}\n` +
      `Candidates: ${data.candidate_count}\n` +
      `Eligible IDs copied: ${data.eligible_count}\n\n` +
      "The new runoff is in Draft status. Set the dates and change the status to Open when ready."
    );

    await loadDashboard();
  } catch (error) {
    alert(error.message || "Unable to create the runoff election.");
    console.error(error);
  } finally {
    runoffCreating = false;
  }
}
window.createRunoffElection = createRunoffElection;

function renderResults(results) {
  if (!election) {
    $("resultsArea").innerHTML = "<p>Create an election to display results.</p>";
    return;
  }

  const grouped = results.reduce((groups, row) => {
    const key = row.position_name;
    (groups[key] ||= []).push(row);
    return groups;
  }, {});

  const totalBallots = Number(latestMetrics.votes_cast || 0);
  const isClosed = election.status === "closed";

  const html = Object.entries(grouped).map(([positionName, rawRows]) => {
    const position = positions.find((p) => p.name === positionName);
    const seats = Number(position?.max_selections || rawRows[0]?.max_selections || 1);

    const rows = [...rawRows].sort((a, b) => {
      const voteDifference = Number(b.vote_count) - Number(a.vote_count);
      if (voteDifference !== 0) return voteDifference;
      return Number(a.display_order || 0) - Number(b.display_order || 0);
    });

    /*
      Tie-aware cutoff logic:
      Example for two seats with totals 2, 1, 1:
      - 2 votes is a clear winner.
      - Both candidates with 1 vote are tied for the final seat.
      - Neither tied candidate is falsely declared the winner.
    */
    const cutoffRow = rows[seats - 1];
    const cutoffVotes = cutoffRow ? Number(cutoffRow.vote_count || 0) : 0;
    const candidatesAboveCutoff = rows.filter(
      (row) => Number(row.vote_count || 0) > cutoffVotes
    );
    const candidatesAtCutoff = rows.filter(
      (row) => Number(row.vote_count || 0) === cutoffVotes
    );
    const seatsRemainingAtCutoff = Math.max(0, seats - candidatesAboveCutoff.length);
    const hasCutoffTie =
      cutoffVotes > 0 && candidatesAtCutoff.length > seatsRemainingAtCutoff;

    return `
      <section class="result-group">
        <div class="result-group-heading">
          <h3>${escapeHtml(positionName)}</h3>
          <span>${seats} ${seats === 1 ? "seat" : "seats"}</span>
        </div>

        ${hasCutoffTie ? `
          <div class="tie-alert">
            <div class="tie-alert-copy">
              <strong>Tie detected:</strong>
              ${candidatesAtCutoff.length} candidates are tied for
              ${seatsRemainingAtCutoff === 1 ? "the final seat" : `${seatsRemainingAtCutoff} remaining seats`}.
              ${isClosed ? "Create a runoff election or resolve the tie according to the BCSA bylaws." : "The result is not yet determined."}
            </div>
            ${isClosed ? `
              <button
                type="button"
                class="create-runoff-button"
                onclick="createRunoffElection(${election.id}, ${position.id})"
              >
                Create Runoff Election
              </button>
            ` : ""}
          </div>
        ` : ""}

        ${rows.map((row, index) => {
          const votes = Number(row.vote_count || 0);
          const percent = totalBallots ? (votes / totalBallots) * 100 : 0;
          const isAboveCutoff = votes > cutoffVotes && votes > 0;
          const isAtCutoff = votes === cutoffVotes && votes > 0;
          const isTieCandidate = hasCutoffTie && isAtCutoff;
          const isClearLeader =
            isAboveCutoff || (!hasCutoffTie && index < seats && votes > 0);

          let badge = "";
          if (isTieCandidate) {
            badge = isClosed ? "Tie — runoff needed" : "Tied for final seat";
          } else if (isClearLeader) {
            badge = isClosed ? "Winner" : "Leading";
          }

          const stateClass = isTieCandidate ? "tie" : isClearLeader ? "leader" : "";

          return `
            <div class="result-candidate ${stateClass}">
              <div class="result-candidate-topline">
                <strong>${escapeHtml(row.candidate_name)}</strong>
                <div class="result-candidate-stats">
                  ${badge ? `<span class="${isTieCandidate ? "tie-badge" : "leader-badge"}">${badge}</span>` : ""}
                  <span>${votes} ${votes === 1 ? "vote" : "votes"} · ${percent.toFixed(1)}%</span>
                </div>
              </div>
              <div class="result-bar" role="progressbar" aria-label="${escapeHtml(row.candidate_name)} ${percent.toFixed(1)} percent" aria-valuenow="${percent.toFixed(1)}" aria-valuemin="0" aria-valuemax="100">
                <div style="width:${Math.min(percent, 100)}%"></div>
              </div>
            </div>
          `;
        }).join("")}
      </section>
    `;
  }).join("");

  $("resultsArea").innerHTML = html || "<p>No ballots have been cast yet.</p>";
}

function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
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

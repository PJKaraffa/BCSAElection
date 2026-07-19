let adminUser = null;
let election = null;
let positions = [];
let liveResultsTimer = null;
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", initializeAdmin);

async function initializeAdmin() {
  $("adminLoginButton").addEventListener("click", loginAdmin);
  $("logoutButton").addEventListener("click", logoutAdmin);
  $("saveElectionButton").addEventListener("click", saveElection);
  $("importMembersButton").addEventListener("click", importMemberIds);
  $("addCandidateButton").addEventListener("click", addCandidate);
  $("refreshAdminButton").addEventListener("click", loadDashboard);
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
  const { data: profile, error } = await supabaseClient.from("profiles").select("role,full_name").eq("id", user.id).single();
  if (error || profile?.role !== "admin") {
    await supabaseClient.auth.signOut();
    return setMessage("adminLoginMessage", "This account is not authorized as an election administrator.", "error");
  }
  adminUser = user;
  $("adminLoginCard").classList.add("hidden");
  $("adminApp").classList.remove("hidden");
  $("adminWelcome").textContent = profile.full_name || user.email;
  await loadDashboard();
  startLiveResults();
}

function startLiveResults() {
  clearInterval(liveResultsTimer);
  liveResultsTimer = setInterval(() => {
    if (adminUser && !document.hidden) loadDashboard(true);
  }, 5000);
}

async function logoutAdmin() {
  await supabaseClient.auth.signOut();
  location.reload();
}

async function loadDashboard(silent = false) {
  const { data, error } = await supabaseClient.rpc("get_admin_dashboard");
  if (error) {
    if (!silent) alert(error.message);
    return;
  }
  election = data.election;
  positions = data.positions || [];
  renderMetrics(data.metrics || {});
  populateElectionForm();
  populatePositionSelect();
  renderCandidates();
  renderResults(data.results || []);
}

function renderMetrics(metrics) {
  $("eligibleCount").textContent = metrics.eligible_count || 0;
  $("votesCastCount").textContent = metrics.votes_cast || 0;
  $("turnoutPercent").textContent = `${Number(metrics.turnout || 0).toFixed(1)}%`;
  $("adminElectionStatus").textContent = election?.status || "None";
}

function populateElectionForm() {
  if (!election) return;
  $("electionNameInput").value = election.title || "";
  $("electionStatusInput").value = election.status;
  $("electionStartInput").value = toLocalInput(election.starts_at);
  $("electionEndInput").value = toLocalInput(election.ends_at);
}

async function saveElection() {
  const payload = {
    p_id: election?.id || null,
    p_title: $("electionNameInput").value.trim(),
    p_status: $("electionStatusInput").value,
    p_starts_at: new Date($("electionStartInput").value).toISOString(),
    p_ends_at: new Date($("electionEndInput").value).toISOString()
  };
  const { error } = await supabaseClient.rpc("admin_save_election", payload);
  if (error) return setMessage("electionSaveMessage", error.message, "error");
  setMessage("electionSaveMessage", "Election saved.", "success");
  await loadDashboard();
}

function populatePositionSelect() {
  $("candidatePosition").innerHTML = positions.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
}

async function addCandidate() {
  const name = $("candidateName").value.trim();
  if (!name) return setMessage("candidateMessage", "Enter the candidate name.", "error");
  const { error } = await supabaseClient.from("candidates").insert({
    election_id: election.id,
    position_id: Number($("candidatePosition").value),
    name,
    display_order: Number($("candidateOrder").value) || 1
  });
  if (error) return setMessage("candidateMessage", error.message, "error");
  $("candidateName").value = "";
  setMessage("candidateMessage", "Candidate added.", "success");
  await loadDashboard();
}

function renderCandidates() {
  const rows = positions.flatMap((position) => (position.candidates || []).map((candidate) => ({ ...candidate, position: position.name })));
  $("candidateList").innerHTML = rows.length ? rows.map((candidate) => `
    <div class="admin-row">
      <strong>${escapeHtml(candidate.position)}</strong>
      <span>${escapeHtml(candidate.name)}</span>
      <button class="secondary-button" onclick="removeCandidate(${candidate.id})">Remove</button>
    </div>
  `).join("") : "<p>No candidates added yet.</p>";
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
  const ids = lines[0].toLowerCase().includes("member_id") ? lines.slice(1) : lines;
  const cleanIds = [...new Set(ids.map((line) => line.split(",")[0].replace(/^"|"$/g, "").trim()).filter(Boolean))];
  const { data, error } = await supabaseClient.rpc("admin_import_member_ids", { p_election_id: election.id, p_member_ids: cleanIds });
  if (error) return setMessage("memberImportMessage", error.message, "error");
  setMessage("memberImportMessage", `${data.imported} IDs imported.`, "success");
  await loadDashboard();
}

function renderResults(results) {
  if (!election) {
    $("resultsArea").innerHTML = "<p>Create an election to view results.</p>";
    return;
  }

  const grouped = Object.groupBy
    ? Object.groupBy(results, (r) => r.position_name)
    : results.reduce((a, r) => ((a[r.position_name] ||= []).push(r), a), {});

  const statusLabel = election.status === "closed" ? "Final Results" : "Live Results";
  const statusClass = election.status === "closed" ? "final" : "live";

  const header = `
    <div class="live-results-banner ${statusClass}">
      <div>
        <strong>${statusLabel}</strong>
        <span>${election.status === "closed" ? "Winners are final." : "Administrator-only results update every 5 seconds."}</span>
      </div>
      <span class="live-dot"></span>
    </div>`;

  const body = Object.entries(grouped).map(([positionName, rows]) => {
    const position = positions.find((p) => p.name === positionName);
    const seats = Number(position?.max_selections || 1);
    const sorted = [...rows].sort((a, b) => Number(b.vote_count) - Number(a.vote_count));
    const maxVotes = Math.max(...sorted.map((r) => Number(r.vote_count)), 1);
    const cutoffVotes = Number(sorted[Math.min(seats, sorted.length) - 1]?.vote_count || 0);

    return `<div class="result-group">
      <div class="result-group-heading">
        <h3>${escapeHtml(positionName)}</h3>
        <span>${seats} ${seats === 1 ? "seat" : "seats"}</span>
      </div>
      ${sorted.map((r, index) => {
        const votes = Number(r.vote_count || 0);
        const isLeader = index < seats && votes >= cutoffVotes;
        const badgeText = election.status === "closed" ? "WINNER" : "LEADING";
        const percent = Number($("votesCastCount").textContent || 0) > 0
          ? Math.round((votes / Number($("votesCastCount").textContent)) * 100)
          : 0;

        return `
          <div class="result-row ${isLeader ? "result-winner" : ""}">
            <div class="result-candidate">
              <strong>${escapeHtml(r.candidate_name)}</strong>
              ${isLeader ? `<span class="winner-badge">${badgeText}</span>` : ""}
            </div>
            <div class="result-bar" aria-label="${votes} votes">
              <div class="${isLeader ? "winner-fill" : ""}" style="width:${(votes / maxVotes) * 100}%"></div>
            </div>
            <span class="result-total">${votes} <small>${percent}%</small></span>
          </div>`;
      }).join("")}
    </div>`;
  }).join("");

  $("resultsArea").innerHTML = header + (body || "<p>No ballots were cast.</p>");
}

function toLocalInput(value) { if (!value) return ""; const d = new Date(value); const offset = d.getTimezoneOffset(); return new Date(d.getTime()-offset*60000).toISOString().slice(0,16); }
function setMessage(id, text, type) { const e=$(id); e.textContent=text; e.className=`message ${type || ""}`; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }

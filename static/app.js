const $ = (selector) => document.querySelector(selector);

const setupPanel = $("#setupPanel");
const dashboard = $("#dashboard");
const setupMessage = $("#setupMessage");
const dashboardMessage = $("#dashboardMessage");
const badge = $("#connectionBadge");
const dialog = $("#confirmDialog");
const rainDelayDialog = $("#rainDelayDialog");
const zoneNameDialog = $("#zoneNameDialog");
let pendingAction = null;
let currentRainDelay = 0;
let editingZone = null;
let zoneNames = {};

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  })[character]);
}

function zoneName(zone) {
  return zoneNames[zone] || `Zona ${zone}`;
}

function zoneTitle(zone) {
  return `
    <div class="zone-name-row">
      <h3>${escapeHtml(zoneName(zone))}</h3>
      <button class="zone-name-edit" data-zone="${zone}" type="button" aria-label="Editar nome da zona ${zone}" title="Editar nome">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 20h4.1L19.2 8.9a2.1 2.1 0 0 0 0-3L18.1 4.8a2.1 2.1 0 0 0-3 0L4 15.9V20Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="m13.7 6.2 4.1 4.1M4 20l4.6-1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
        </svg>
      </button>
    </div>`;
}

function setMessage(element, text = "", type = "") {
  element.textContent = text;
  element.className = `message ${type}`.trim();
}

function setConnected(connected) {
  badge.className = `badge ${connected ? "online" : "offline"}`;
  badge.innerHTML = `<span></span>${connected ? "Conectado" : "Desconectado"}`;
  setupPanel.classList.toggle("hidden", connected);
  dashboard.classList.toggle("hidden", !connected);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json().catch(() => ({ ok: false, error: "Resposta inválida." }));
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Não foi possível concluir.");
  return payload;
}

function activeSet(value) {
  const container = value?.stations ?? value ?? {};
  const stateList = container.states;
  if (Array.isArray(stateList)) {
    return new Set(
      stateList
        .map((isActive, index) => isActive ? index + 1 : null)
        .filter((zone) => zone !== null),
    );
  }
  const source = container.active_set ?? container.activeSet ?? container.active ?? [];
  return new Set(Array.isArray(source) ? source.map(Number) : []);
}

function renderZones(available, active) {
  const enabled = activeSet(available);
  const running = activeSet(active);
  const zones = enabled.size ? [...enabled].sort((a, b) => a - b) : [1, 2, 3, 4];
  $("#zonesGrid").innerHTML = zones.map((zone) => `
    <article class="zone-card">
      <div class="zone-top">
        <div class="zone-number">${zone}</div>
        <span class="zone-state ${running.has(zone) ? "active" : ""}">${running.has(zone) ? "Irrigando agora" : "Em espera"}</span>
      </div>
      ${zoneTitle(zone)}
      ${running.has(zone) ? `
        <div class="zone-controls stop-only">
          <button class="danger-button stop-zone" data-zone="${zone}" type="button">Desligar zona</button>
        </div>` : `
        <div class="zone-controls">
          <select id="minutes-${zone}" aria-label="Duração da zona ${zone}">
            <option value="1">1 minuto</option>
            <option value="5" selected>5 minutos</option>
            <option value="10">10 minutos</option>
            <option value="15">15 minutos</option>
            <option value="20">20 minutos</option>
            <option value="30">30 minutos</option>
          </select>
          <button class="primary-button start-zone" data-zone="${zone}" type="button">Iniciar</button>
        </div>`}
    </article>`).join("");
}

const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function scheduleRule(schedule) {
  if (schedule.frequency === 1) return "Dias ímpares";
  if (schedule.frequency === 2) return "Dias pares";
  if (schedule.frequency === 3) {
    return `A cada ${schedule.period} dia${schedule.period === 1 ? "" : "s"}`;
  }
  const days = dayNames.filter((_, index) => schedule.daysMask & (1 << index));
  return days.length === 7 ? "Todos os dias" : (days.join(", ") || "Nenhum dia");
}

function formatStart(minutes) {
  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function renderSchedule(schedules) {
  const grid = $("#scheduleGrid");
  if (!schedules.length) {
    grid.innerHTML = '<p class="schedule-empty">Nenhuma programação encontrada.</p>';
    return;
  }
  grid.innerHTML = schedules.map((schedule) => `
    <article class="schedule-card">
      <div class="schedule-card-heading">
        <div class="zone-number">${schedule.zone}</div>
        <div><span class="schedule-label">Zona ${schedule.zone}</span><h3>${escapeHtml(zoneName(schedule.zone))}</h3></div>
      </div>
      <dl class="schedule-details">
        <div><dt>Dias</dt><dd>${scheduleRule(schedule)}</dd></div>
        <div><dt>Horários</dt><dd>${schedule.starts.length ? schedule.starts.map(formatStart).join(" · ") : "Sem horário"}</dd></div>
        <div><dt>Duração</dt><dd>${schedule.duration} minuto${schedule.duration === 1 ? "" : "s"}</dd></div>
      </dl>
    </article>`).join("");
}

async function refreshSchedule() {
  $("#scheduleGrid").innerHTML = '<p class="schedule-empty">Lendo a programação…</p>';
  const data = await api("/api/schedule");
  renderSchedule(data.schedules);
}

function openStopDialog(zone = null) {
  pendingAction = { type: "stop", zone };
  $("#dialogTitle").textContent = zone ? `Desligar a zona ${zone}?` : "Parar toda a irrigação?";
  $("#dialogText").textContent = zone
    ? `A irrigação da zona ${zone} será interrompida imediatamente.`
    : "Qualquer zona ativa será desligada imediatamente.";
  $("#confirmAction").textContent = zone ? "Desligar zona" : "Parar tudo";
  dialog.showModal();
}

async function refreshStatus(silent = false) {
  if (!silent) setMessage(dashboardMessage, "Consultando o programador…");
  try {
    const data = await api("/api/status");
    zoneNames = data.zoneNames || {};
    renderZones(data.stations, data.states);
    await refreshSchedule();
    const running = activeSet(data.states);
    $("#wateringState").textContent = running.size ? `Zona ${[...running].join(", ")} ativa` : "Em espera";
    currentRainDelay = Number(data.rainDelay || 0);
    $("#rainDelay").textContent = `${currentRainDelay} dia${currentRainDelay === 1 ? "" : "s"}`;
    $("#lastUpdate").textContent = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    setMessage(dashboardMessage, silent ? "" : "Dados atualizados.", "success");
  } catch (error) {
    setMessage(dashboardMessage, error.message, "error");
  }
}

$("#togglePassword").addEventListener("click", () => {
  const input = $("#password");
  input.type = input.type === "password" ? "text" : "password";
  $("#togglePassword").textContent = input.type === "password" ? "Mostrar" : "Ocultar";
});

$("#connectForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  setMessage(setupMessage, "Testando a conexão…");
  try {
    const host = $("#host").value.trim();
    await api("/api/connect", {
      method: "POST",
      body: JSON.stringify({ host, password: $("#password").value }),
    });
    $("#password").value = "";
    $("#deviceAddress").textContent = host;
    setConnected(true);
    await refreshStatus();
  } catch (error) {
    setMessage(setupMessage, error.message, "error");
  } finally {
    button.disabled = false;
  }
});

$("#zonesGrid").addEventListener("click", (event) => {
  const editButton = event.target.closest(".zone-name-edit");
  if (editButton) {
    editingZone = Number(editButton.dataset.zone);
    $("#zoneNameTitle").textContent = `Nome da zona ${editingZone}`;
    $("#zoneNameInput").value = zoneNames[editingZone] || "";
    setMessage($("#zoneNameMessage"));
    zoneNameDialog.showModal();
    $("#zoneNameInput").focus();
    return;
  }
  const stopButton = event.target.closest(".stop-zone");
  if (stopButton) {
    openStopDialog(Number(stopButton.dataset.zone));
    return;
  }
  const button = event.target.closest(".start-zone");
  if (!button) return;
  const zone = Number(button.dataset.zone);
  const minutes = Number($(`#minutes-${zone}`).value);
  pendingAction = { type: "start", zone, minutes };
  $("#dialogTitle").textContent = `Iniciar a zona ${zone}?`;
  $("#dialogText").textContent = `A válvula ficará aberta por ${minutes} minuto${minutes === 1 ? "" : "s"}.`;
  $("#confirmAction").textContent = "Iniciar irrigação";
  dialog.showModal();
});

$("#stopButton").addEventListener("click", () => {
  openStopDialog();
});

$("#editRainDelay").addEventListener("click", () => {
  $("#rainDelayDays").value = String(Math.min(14, Math.max(0, currentRainDelay)));
  setMessage($("#rainDelayMessage"));
  rainDelayDialog.showModal();
});

$("#cancelRainDelay").addEventListener("click", () => rainDelayDialog.close());

$("#cancelZoneName").addEventListener("click", () => zoneNameDialog.close());

$("#zoneNameForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editingZone) return;
  const button = event.submitter;
  const name = $("#zoneNameInput").value.trim();
  button.disabled = true;
  setMessage($("#zoneNameMessage"), "Salvando nome…");
  try {
    const result = await api("/api/zone-name", {
      method: "POST",
      body: JSON.stringify({ zone: editingZone, name }),
    });
    if (result.name) zoneNames[editingZone] = result.name;
    else delete zoneNames[editingZone];
    zoneNameDialog.close();
    await refreshStatus(true);
    setMessage(dashboardMessage, `Nome da zona ${editingZone} salvo.`, "success");
  } catch (error) {
    setMessage($("#zoneNameMessage"), error.message, "error");
  } finally {
    button.disabled = false;
  }
});

$("#rainDelayForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const days = Number($("#rainDelayDays").value);
  button.disabled = true;
  setMessage($("#rainDelayMessage"), "Salvando no programador…");
  try {
    await api("/api/rain-delay", {
      method: "POST",
      body: JSON.stringify({ days }),
    });
    currentRainDelay = days;
    $("#rainDelay").textContent = `${days} dia${days === 1 ? "" : "s"}`;
    rainDelayDialog.close();
    setMessage(dashboardMessage, days === 0 ? "Atraso por chuva removido." : `Irrigação suspensa por ${days} dias.`, "success");
    setTimeout(() => refreshStatus(true), 700);
  } catch (error) {
    setMessage($("#rainDelayMessage"), error.message, "error");
  } finally {
    button.disabled = false;
  }
});

dialog.addEventListener("close", async () => {
  if (dialog.returnValue !== "confirm" || !pendingAction) return;
  const action = pendingAction;
  pendingAction = null;
  setMessage(dashboardMessage, "Enviando comando…");
  try {
    if (action.type === "start") {
      await api("/api/start", { method: "POST", body: JSON.stringify(action) });
      setMessage(dashboardMessage, `Zona ${action.zone} iniciada por ${action.minutes} minutos.`, "success");
    } else {
      await api("/api/stop", { method: "POST", body: "{}" });
      setMessage(dashboardMessage, "Irrigação interrompida.", "success");
    }
    setTimeout(() => refreshStatus(true), 900);
  } catch (error) {
    setMessage(dashboardMessage, error.message, "error");
  }
});

$("#refreshButton").addEventListener("click", () => refreshStatus());
$("#disconnectButton").addEventListener("click", async () => {
  await api("/api/disconnect", { method: "POST", body: "{}" });
  setConnected(false);
  setMessage(setupMessage, "PIN removido da memória deste Mac.", "success");
});

(async function init() {
  try {
    const config = await api("/api/config");
    $("#host").value = config.host;
    setConnected(config.configured);
    if (config.configured) await refreshStatus(true);
  } catch (error) {
    setMessage(setupMessage, error.message, "error");
  }
})();

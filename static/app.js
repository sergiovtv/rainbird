const $ = (selector) => document.querySelector(selector);

const setupPanel = $("#setupPanel");
const dashboard = $("#dashboard");
const setupMessage = $("#setupMessage");
const dashboardMessage = $("#dashboardMessage");
const badge = $("#connectionBadge");
const dialog = $("#confirmDialog");
let pendingAction = null;

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
  const source = value?.active_set ?? value?.activeSet ?? value?.active ?? [];
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
      <h3>Zona ${zone}</h3>
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
      </div>
    </article>`).join("");
}

async function refreshStatus(silent = false) {
  if (!silent) setMessage(dashboardMessage, "Consultando o programador…");
  try {
    const data = await api("/api/status");
    renderZones(data.stations, data.states);
    const running = activeSet(data.states);
    $("#wateringState").textContent = running.size ? `Zona ${[...running].join(", ")} ativa` : "Em espera";
    $("#rainDelay").textContent = `${Number(data.rainDelay || 0)} dia${Number(data.rainDelay || 0) === 1 ? "" : "s"}`;
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
  pendingAction = { type: "stop" };
  $("#dialogTitle").textContent = "Parar toda a irrigação?";
  $("#dialogText").textContent = "Qualquer zona ativa será desligada imediatamente.";
  $("#confirmAction").textContent = "Parar tudo";
  dialog.showModal();
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

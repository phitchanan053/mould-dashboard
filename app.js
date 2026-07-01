const API = "https://api.tualab.site";

const STATE = {
  room: "COR",
  zone: "C",
  charts: {},
  masterlog: [],
  rangeDays: 7
};

const ROOM_LABEL = {
  COR: "Corridor (COR_01)",
  MCH: "Mechanical Control Room (MCH_P1)",
  MTG: "Meeting Room (MTG_P1)"
};

const ZONE_LABEL = {
  B: "Baseline",
  C: "Clean Area",
  R: "Risk Area"
};

function activeSensor() {
  if (STATE.zone === "B") return `${STATE.room}_ROOM_IAQ`;
  return `${STATE.room}_${STATE.zone}_A_IAQ`;
}

function activeCamera() {
  return `${STATE.room}_${STATE.zone}`.toLowerCase();
}

function parseNDJSON(text) {
  return text.trim().split(/\n+/).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function toDate(row) {
  const raw = row.timestamp || row.time || row.created_at || row.datetime || "";
  const iso = typeof raw === "string" ? raw.trim().replace(" ", "T") : String(raw);
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function apiDate(date) {
  return date.toISOString().slice(0, 16);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(value, digits = 1) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits) : "--";
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function fetchIAQ() {
  const sensor = activeSensor();
  try {
    const res = await fetch(`${API}/iaq/raw?iaq=${sensor}&size=2000`);
    const rows = parseNDJSON(await res.text());
    return rows.sort((a, b) => {
      const da = toDate(a), db = toDate(b);
      return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
    });
  } catch (e) {
    console.warn("fetchIAQ error:", e);
    return [];
  }
}

async function fetchImages() {
  const cam = activeCamera();
  try {
    const res = await fetch(`${API}/images/raw?camera=${cam}&size=4`);
    const rows = parseNDJSON(await res.text());
    return rows.filter(r => r.camera_name && r.camera_name.toLowerCase().startsWith(cam));
  } catch (e) {
    console.warn("fetchImages error:", e);
    return [];
  }
}

async function loadMasterLog() {
  try {
    const res = await fetch("masterlog.csv");
    const txt = await res.text();
    const [head, ...lines] = txt.trim().split(/\n/);
    const keys = head.split(",");
    STATE.masterlog = lines.map(line =>
      Object.fromEntries(line.split(",").map((v, i) => [keys[i], v]))
    );
  } catch { STATE.masterlog = []; }
}

function metric(rows, key) {
  const vals = rows.map(r => num(r[key])).filter(v => v !== null);
  if (!vals.length) return { cur: "--", avg: "--", min: "--", max: "--" };
  return {
    cur: vals.at(-1),
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    min: Math.min(...vals),
    max: Math.max(...vals)
  };
}

function riskFromRH(rh) {
  if (rh >= 80) return ["CRITICAL", 90];
  if (rh >= 70) return ["HIGH", 72];
  if (rh >= 60) return ["MODERATE", 50];
  return ["LOW", 28];
}

function chartPoints(rows, key) {
  const pts = [];
  for (const r of rows) {
    const x = toDate(r);
    const y = num(r[key]);
    if (x && y !== null) pts.push({ x, y });
  }
  return pts;
}

function makeChart(id, label, rows, key, color) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (STATE.charts[id]) STATE.charts[id].destroy();

  const pts = chartPoints(rows, key);

  const times = pts.map(p => p.x.getTime()).filter(Boolean);
  const xMin = times.length ? new Date(Math.min(...times)) : undefined;
  const xMax = times.length ? new Date(Math.max(...times)) : undefined;

  STATE.charts[id] = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [{
        label,
        data: pts,
        borderColor: color,
        backgroundColor: color + "22",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.25,
        fill: false
      }]
    },
    options: {
      parsing: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { display: false },
        evalWindow: { start: EVAL.start, end: EVAL.end },
        tooltip: {
          callbacks: {
            title(items) {
              return new Date(items[0].parsed.x).toLocaleString("en-GB", {
                year: "numeric", month: "short", day: "2-digit",
                hour: "2-digit", minute: "2-digit"
              });
            }
          }
        },
        zoom: {
          pan: { enabled: true, mode: "x" },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "x"
          }
        }
      },
      scales: {
        x: {
          type: "time",
          min: xMin,
          max: xMax,
          time: {
            displayFormats: {
              minute: "HH:mm",
              hour: "HH:mm, MMM d",
              day: "MMM d",
              week: "MMM d"
            },
            tooltipFormat: "MMM d, yyyy HH:mm"
          },
          title: { display: true, text: "Timeline", color: "#d7e8ff" },
          ticks: { source: "auto", color: "#d7e8ff", maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
          grid: { color: "rgba(255,255,255,.10)" }
        },
        y: {
          title: {
            display: true,
            text: label.includes("Temperature") ? "°C" : label.includes("Humidity") ? "%" : "ppm",
            color: "#d7e8ff"
          },
          ticks: { color: "#d7e8ff" },
          grid: { color: "rgba(255,255,255,.10)" }
        }
      }
    }
  });
}

function imgUrl(img) {
  if (!img?.file_path) return "";
  return `${API}/images/file/${img.file_path.split("/").pop()}`;
}

function imgKey(img) {
  return `${img?.camera_name || ""} ${img?.file_path || ""}`.toUpperCase();
}

function pickImages(images) {
  const uv = images.find(img => /UV|UVA|RUV|CUV/.test(imgKey(img))) || images[0] || null;
  const white = images.find(img => /WHT|WHITE|RWHT|CWHT/.test(imgKey(img)))
    || images.find(img => img !== uv) || images[1] || images[0] || null;
  return { white, uv };
}

function updateInspection(images) {
  const panel = document.getElementById("inspectionImages");
  if (!panel) return;

  if (!images.length) {
    panel.innerHTML = `
      <div style="grid-column:1/-1;display:flex;align-items:center;justify-content:center;
                  height:160px;color:#607086;font-size:15px;text-align:center;gap:10px;">
        <span style="font-size:28px">📷</span>
        <div>No camera installed for this zone<br>
        <small style="font-size:12px">${activeSensor()}</small></div>
      </div>`;
    return;
  }

  const { white, uv } = pickImages(images);
  const cards = [
    { title: "White Light (Visible)", note: "normal camera image", img: white },
    { title: "UV Fluorescence (Dark)", note: "dark image / UV inspection view", img: uv }
  ];
  panel.innerHTML = cards.map(card => `
    <div class="inspection-img">
      <img src="${imgUrl(card.img)}" alt="${card.title}">
      <div class="image-label"><b>${card.title}</b></div>
      <small>${card.note}</small>
      <small>${card.img?.camera_name || "Camera record"} · ${card.img?.timestamp || ""}</small>
    </div>
  `).join("");
}

function updateStats(prefix, data, suffix, digits = 1) {
  setText(`${prefix}Current`, `${fmt(data.cur, digits)}${suffix}`);
  setText(`${prefix}Avg`, `${fmt(data.avg, digits)}${suffix}`);
  setText(`${prefix}Min`, `${fmt(data.min, digits)}${suffix}`);
  setText(`${prefix}Max`, `${fmt(data.max, digits)}${suffix}`);
}

function updateInsight(rh, temp, co2) {
  const room = ROOM_LABEL[STATE.room];
  const zone = ZONE_LABEL[STATE.zone];
  const [risk, score] = riskFromRH(rh.cur || 0);
  let rhNote = "relative humidity is currently within a moderate range";
  if ((rh.avg || 0) >= 70) rhNote = "relative humidity has been elevated for an extended period";
  else if ((rh.avg || 0) >= 60) rhNote = "relative humidity remains above 60%, requiring continued observation";
  setText("kpiRisk", risk);
  setText("kpiRiskScore", `Score ${score} / 100`);

  const riskEl = document.getElementById("kpiRisk");
  if (riskEl) {
    const colors = {
      CRITICAL: "#ff5353",
      HIGH:     "#ffb84d",
      MODERATE: "#4ed4d4",
      LOW:      "#35d071"
    };
    riskEl.style.color = colors[risk] || "#67adff";
  }
  setText("insightText", `For ${room} (${zone}), ${rhNote}. The current temperature is ${fmt(temp.cur)}°C and CO₂ concentration is ${fmt(co2.cur, 0)} ppm. White light and UV fluorescence images provide visual evidence for the selected monitoring area. These sensor trends and inspection images will support later field validation of the WUFI FinMould model.`);
}

// ===== Evaluation Window =====
const EVAL = { start: null, end: null };

function applyEvalWindow() {
  const s = document.getElementById("evalStart").value;
  const e = document.getElementById("evalEnd").value;
  if (!s) { alert("Please set a Start date"); return; }
  EVAL.start = new Date(s);
  EVAL.end   = e ? new Date(e) : new Date();

  const info = document.getElementById("evalWindowInfo");
  if (info) {
    const fmt = d => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getFullYear()).slice(-2)}`;
    info.textContent = `Window: ${fmt(EVAL.start)} → ${fmt(EVAL.end)}`;
  }

  Object.keys(STATE.charts).forEach(id => drawEvalLines(STATE.charts[id]));
  updateOverlay();
}

function clearEvalWindow() {
  EVAL.start = null;
  EVAL.end   = null;
  document.getElementById("evalStart").value = "";
  document.getElementById("evalEnd").value   = "";
  const info = document.getElementById("evalWindowInfo");
  if (info) info.textContent = "";
  Object.keys(STATE.charts).forEach(id => drawEvalLines(STATE.charts[id]));
}

function drawEvalLines(chart) {
  if (!chart) return;
  chart.options.plugins.evalWindow = { start: EVAL.start, end: EVAL.end };
  chart.update("none");
}

const evalWindowPlugin = {
  id: "evalWindow",
  afterDraw(chart) {
    const { start, end } = chart.options.plugins.evalWindow || {};
    if (!start && !end) return;
    const { ctx, scales: { x, y } } = chart;
    if (!x || !y) return;
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 2;

    if (start) {
      const px = x.getPixelForValue(start);
      if (px >= x.left && px <= x.right) {
        ctx.strokeStyle = "#35d071";
        ctx.beginPath(); ctx.moveTo(px, y.top); ctx.lineTo(px, y.bottom); ctx.stroke();
        ctx.fillStyle = "#35d071";
        ctx.font = "10px Inter,sans-serif";
        ctx.fillText("▶ Start", px + 4, y.top + 14);
      }
    }
    if (end) {
      const px = x.getPixelForValue(end);
      if (px >= x.left && px <= x.right) {
        ctx.strokeStyle = "#ff5353";
        ctx.beginPath(); ctx.moveTo(px, y.top); ctx.lineTo(px, y.bottom); ctx.stroke();
        ctx.fillStyle = "#ff5353";
        ctx.font = "10px Inter,sans-serif";
        ctx.fillText("End ◀", px - 44, y.top + 14);
      }
    }
    ctx.restore();
  }
};

Chart.register(evalWindowPlugin);
const SENSOR_INTERVAL_MIN = 10;
const ALERT_THRESHOLD_MIN = 30;

function updateDataQuality(rows) {
  const el = document.getElementById("kpiQuality");
  const elSmall = document.getElementById("kpiQualityDetail");
  const alertBanner = document.getElementById("dataAlertBanner");

  if (!rows.length) {
    if (el) { el.textContent = "-- %"; el.style.color = "#ff5353"; }
    if (elSmall) elSmall.textContent = "No data received";
    if (alertBanner) {
      alertBanner.style.display = "flex";
      alertBanner.innerHTML = `<span>⚠️</span> <b>${activeSensor()}</b> — No data received from sensor`;
    }
    return;
  }

  const lastRow = rows[rows.length - 1];
  const lastTime = toDate(lastRow);
  const now = new Date();
  const minutesSinceLast = lastTime ? Math.floor((now - lastTime) / 60000) : 999;

  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const recent = rows.filter(r => { const d = toDate(r); return d && d >= oneDayAgo; });
  const expected = Math.floor(24 * 60 / SENSOR_INTERVAL_MIN);
  const completeness = Math.min(100, Math.round((recent.length / expected) * 100));

  if (el) {
    el.textContent = `${completeness} %`;
    el.style.color = completeness >= 90 ? "#35d071" : completeness >= 70 ? "#ffb84d" : "#ff5353";
  }
  if (elSmall) {
    elSmall.textContent = `${recent.length}/${expected} pts · Last: ${minutesSinceLast}m ago`;
  }

  if (alertBanner) {
    if (minutesSinceLast >= ALERT_THRESHOLD_MIN) {
      alertBanner.style.display = "flex";
      alertBanner.innerHTML = `
        <span style="font-size:18px">⚠️</span>
        <div>
          <b>Missing Data Alert</b> — ${activeSensor()}<br>
          <small>No new data for <b>${minutesSinceLast} min</b> (threshold: ${ALERT_THRESHOLD_MIN} min)
          · Last seen: ${lastTime ? lastTime.toLocaleString("en-GB") : "--"}</small>
        </div>`;
    } else {
      alertBanner.style.display = "none";
    }
  }
}

async function refresh() {
  const rows = await fetchIAQ();
  const images = await fetchImages();

  const temp = metric(rows, "temperature");
  const rh   = metric(rows, "humidity");
  const co2  = metric(rows, "co2");

  setText("activeSensor", activeSensor());
  setText("activeDesc", `${ROOM_LABEL[STATE.room]} · ${ZONE_LABEL[STATE.zone]}`);
  setText("kpiTemp", `${fmt(temp.cur)} °C`);
  setText("kpiRh", `${fmt(rh.cur, 0)} %`);

  const rhEl = document.getElementById("kpiRh");
  if (rhEl) {
    const rhVal = rh.cur || 0;
    rhEl.style.color = rhVal >= 80 ? "#ff5353"
                     : rhVal >= 70 ? "#ffb84d"
                     : rhVal >= 60 ? "#4ed4d4"
                     : "#35d071";
  }
  setText("kpiCo2", `${fmt(co2.cur, 0)} ppm`);
  setText("kpiQuality", "");
  updateDataQuality(rows);
  setText("kpiTempRange", `Min ${fmt(temp.min)} | Max ${fmt(temp.max)}`);
  setText("kpiRhRange", `Min ${fmt(rh.min)} | Max ${fmt(rh.max)}`);
  setText("kpiCo2Range", `Min ${fmt(co2.min, 0)} | Max ${fmt(co2.max, 0)}`);

  updateStats("temp", temp, " °C");
  updateStats("rh", rh, " %");
  updateStats("co2", co2, " ppm", 0);

  makeChart("tempChart", "Temperature °C", rows, "temperature", "#7cc8ff");
  makeChart("rhChart", "Relative Humidity %", rows, "humidity", "#7cc8ff");
  makeChart("co2Chart", "CO₂ ppm", rows, "co2", "#35d071");

  // Chart.js sometimes measures its container before the CSS grid/flex layout
  // has fully settled (esp. on first load), producing a canvas that renders
  // too wide/misplaced until something (like a scroll) forces a re-measure.
  // Force an explicit resize on the next two frames so this never lingers
  // on screen and the user never has to scroll to "fix" it.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      Object.values(STATE.charts).forEach(c => c.resize());
    });
  });

  updateInspection(images);
  updateInsight(rh, temp, co2);
  updateAAALAC(temp, rh);
  setText("lastUpdate", new Date().toLocaleString("en-GB"));
}

function installToolbars() {
  document.querySelectorAll(".chart-tools").forEach(box => {
    const chartId = box.dataset.chart;
    box.innerHTML = [["📷","png"],["＋","zin"],["－","zout"],["⌂","reset"],["⛶","full"]]
      .map(([icon, action]) => `<button class="tool-btn" data-act="${action}" data-chart="${chartId}">${icon}</button>`)
      .join("");
  });

  document.addEventListener("click", e => {
    const button = e.target.closest(".tool-btn");
    if (!button) return;
    const chart = STATE.charts[button.dataset.chart];
    if (!chart) return;
    if (button.dataset.act === "png") {
      const a = document.createElement("a");
      a.href = chart.toBase64Image();
      a.download = `${button.dataset.chart}.png`;
      a.click();
    }
    if (button.dataset.act === "zin") chart.zoom(1.2);
    if (button.dataset.act === "zout") chart.zoom(0.8);
    if (button.dataset.act === "reset") chart.resetZoom();
    if (button.dataset.act === "full") {
      document.getElementById(button.dataset.chart).closest(".chart-card").requestFullscreen();
    }
  });
}

function bindEvents() {
  document.getElementById("roomSelect").addEventListener("change", e => {
    STATE.room = e.target.value;
    updateReportSensorList();
    updateOverlay();
    refresh();
  });

  document.querySelectorAll(".zone-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".zone-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      STATE.zone = btn.dataset.zone;
      updateReportSensorList();
      refresh();
    });
  });

  document.querySelectorAll(".pin").forEach(pin => {
    pin.addEventListener("click", () => {
      STATE.room = pin.dataset.room;
      document.getElementById("roomSelect").value = STATE.room;
      refresh();
    });
  });

  document.querySelectorAll(".chart-card").forEach(card => {
    card.addEventListener("dblclick", () => card.requestFullscreen());
  });

  document.addEventListener("dblclick", e => {
    const imageCard = e.target.closest(".inspection-img");
    if (imageCard) imageCard.requestFullscreen();
  });

  // ===== Fullscreen exit fix =====
  // Some browsers (esp. Chrome) leave a stale compositing layer painted in the
  // old fullscreen position after exiting fullscreen, making the element look
  // like it is "floating"/overlapping other cards until the page is manually
  // repainted (scroll/resize). We force a full-page reflow + repaint right
  // after fullscreen state changes so this never lingers on screen.
  document.addEventListener("fullscreenchange", () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        Object.values(STATE.charts).forEach(c => { c.resize(); c.update("none"); });

        // Force the browser to fully repaint the layout.
        document.body.style.display = "none";
        void document.body.offsetHeight; // force reflow
        document.body.style.display = "";

        // Belt-and-braces: nudge the scroll position by 1px and back,
        // which reliably clears leftover fullscreen paint artifacts.
        const y = window.scrollY;
        window.scrollTo(0, y + 1);
        window.scrollTo(0, y);
      });
    });
  });

  document.querySelectorAll(".nav button").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav button").forEach(b => b.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(button.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

// ===== Multi-sensor Overlay =====
const OVERLAY_STATE = { clean: true, risk: true, threshold: true };

function toggleOverlaySensor(key) {
  OVERLAY_STATE[key] = !OVERLAY_STATE[key];
  const btn = document.getElementById(`toggle-${key}`);
  if (btn) {
    const colors = { clean: ["#7cc8ff","#0d2b55"], risk: ["#ff5353","#401617"], threshold: ["#ffb84d","#3d2800"] };
    const [color, bg] = colors[key];
    btn.style.opacity = OVERLAY_STATE[key] ? "1" : "0.35";
  }
  const chart = STATE.charts["overlayChart"];
  if (!chart) return;
  if (key === "clean") chart.data.datasets[0].hidden = !OVERLAY_STATE.clean;
  if (key === "risk")  chart.data.datasets[1].hidden = !OVERLAY_STATE.risk;
  if (key === "threshold") {
    chart.options.plugins.threshold = OVERLAY_STATE.threshold;
  }
  chart.update();
}
async function fetchSensorRows(sensorName) {
  try {
    const res = await fetch(`${API}/iaq/raw?iaq=${sensorName}&size=2000`);
    const text = await res.text();
    const rows = parseNDJSON(text);
    return rows.sort((a, b) => {
      const da = toDate(a), db = toDate(b);
      return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
    });
  } catch (e) {
    console.warn("fetchSensorRows error:", sensorName, e);
    return [];
  }
}

let overlayLoading = false;

async function updateOverlay() {
  if (overlayLoading) return;
  overlayLoading = true;
  try {
    await _updateOverlay();
  } finally {
    overlayLoading = false;
  }
}

async function _updateOverlay() {
  const room = STATE.room;
  const cleanSensor = `${room}_C_A_IAQ`;
  const riskSensor  = `${room}_R_A_IAQ`;

  const legendClean = document.getElementById("legendClean");
  const legendRisk  = document.getElementById("legendRisk");
  if (legendClean) legendClean.textContent = `${cleanSensor} — Clean Above Ceiling`;
  if (legendRisk)  legendRisk.textContent  = `${riskSensor} — Risk Above Ceiling`;

  const [cleanRows, riskRows] = await Promise.all([
    fetchSensorRows(cleanSensor),
    fetchSensorRows(riskSensor)
  ]);

  const canvas = document.getElementById("overlayChart");
  if (!canvas) return;
  if (STATE.charts["overlayChart"]) STATE.charts["overlayChart"].destroy();

  const cleanPts = chartPoints(cleanRows, "humidity");
  const riskPts  = chartPoints(riskRows,  "humidity");

  const cleanCur = cleanRows.length ? num(cleanRows.at(-1).humidity) : null;
  const riskCur  = riskRows.length  ? num(riskRows.at(-1).humidity)  : null;
  const gap = (cleanCur !== null && riskCur !== null) ? (riskCur - cleanCur).toFixed(1) : "--";

  let exceedHours = 0;
  for (let i = 1; i < riskRows.length; i++) {
    const rh = num(riskRows[i].humidity);
    if (rh !== null && rh > 70) {
      const t1 = toDate(riskRows[i - 1]);
      const t2 = toDate(riskRows[i]);
      if (t1 && t2) exceedHours += (t2 - t1) / 3600000;
    }
  }
  const exceedEl = document.getElementById("overlayExceed");
  if (exceedEl) {
    exceedEl.textContent = riskRows.length ? `${exceedHours.toFixed(1)} hrs` : "--";
    exceedEl.style.color = exceedHours > 24 ? "#ff5353" : exceedHours > 6 ? "#ffb84d" : "#35d071";
  }

  setText("overlayCleanRh", cleanCur !== null ? `${cleanCur.toFixed(0)} %` : "--");
  setText("overlayRiskRh",  riskCur  !== null ? `${riskCur.toFixed(0)} %`  : "--");
  const gapEl = document.getElementById("overlayGap");
  if (gapEl) {
    gapEl.textContent = gap !== "--" ? `${Number(gap) > 0 ? "+" : ""}${gap} %` : "--";
    gapEl.style.color = Number(gap) > 0 ? "#ff5353" : Number(gap) < 0 ? "#35d071" : "#d7e8ff";
  }

  const allTimes = [...cleanPts, ...riskPts].map(p => p.x.getTime());
  const xMin = allTimes.length ? new Date(Math.min(...allTimes)) : undefined;
  const xMax = allTimes.length ? new Date(Math.max(...allTimes)) : undefined;

  const showThreshold = OVERLAY_STATE.threshold;
  const thresholdPlugin = {
    id: "threshold",
    afterDraw(chart) {
      if (!OVERLAY_STATE.threshold) return;
      const { ctx, scales: { x, y } } = chart;
      const yPx = y.getPixelForValue(70);
      ctx.save();
      ctx.strokeStyle = "#ffb84d";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x.left, yPx);
      ctx.lineTo(x.right, yPx);
      ctx.stroke();
      ctx.fillStyle = "#ffb84d";
      ctx.font = "11px Inter,sans-serif";
      ctx.fillText("RH 70%", x.right - 60, yPx - 5);
      ctx.restore();
    }
  };

  STATE.charts["overlayChart"] = new Chart(canvas, {
    type: "line",
    plugins: [thresholdPlugin],
    data: {
      datasets: [
        {
          label: `${cleanSensor}`,
          data: cleanPts,
          hidden: !OVERLAY_STATE.clean,
          borderColor: "#7cc8ff", backgroundColor: "#7cc8ff22",
          borderWidth: 2, pointRadius: 0, tension: 0.25, fill: false
        },
        {
          label: `${riskSensor}`,
          data: riskPts,
          hidden: !OVERLAY_STATE.risk,
          borderColor: "#ff5353", backgroundColor: "#ff535322",
          borderWidth: 2, pointRadius: 0, tension: 0.25, fill: false
        }
      ]
    },
    options: {
      parsing: false, responsive: true, maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { display: false },
        zoom: {
          pan: { enabled: true, mode: "x" },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" }
        }
      },
      scales: {
        x: {
          type: "time", min: xMin, max: xMax,
          time: { displayFormats: { hour: "HH:mm, MMM d", day: "MMM d" }, tooltipFormat: "MMM d, yyyy HH:mm" },
          title: { display: true, text: "Timeline", color: "#d7e8ff" },
          ticks: { source: "auto", color: "#d7e8ff", maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
          grid: { color: "rgba(255,255,255,.10)" }
        },
        y: {
          title: { display: true, text: "%", color: "#d7e8ff" },
          ticks: { color: "#d7e8ff" },
          grid: { color: "rgba(255,255,255,.10)" }
        }
      }
    }
  });
}

// ===== AAALAC Threshold =====
function updateAAALAC(temp, rh) {
  const tVal = typeof temp.cur === "number" ? temp.cur : null;
  const tPct = tVal !== null ? Math.min(100, Math.max(0, ((tVal - 18) / (26 - 18)) * 100)) : 0;
  const tOk  = tVal !== null && tVal >= 18 && tVal <= 26;
  const tEl  = document.getElementById("aaalac-temp-val");
  const tBar = document.getElementById("aaalac-temp-bar");
  const tBadge = document.getElementById("aaalac-temp-badge");
  if (tEl) tEl.textContent = tVal !== null ? `${tVal.toFixed(1)} °C` : "--";
  if (tBar) { tBar.style.width = `${tPct}%`; tBar.style.background = tOk ? "#35d071" : "#ff5353"; }
  if (tBadge) {
    tBadge.textContent = tOk ? "✓ IN RANGE" : "✗ OUT";
    tBadge.style.background = tOk ? "#0c3524" : "#401617";
    tBadge.style.color = tOk ? "#35d071" : "#ff5353";
  }

  const rhVal = typeof rh.cur === "number" ? rh.cur : null;
  const rhPct = rhVal !== null ? Math.min(100, Math.max(0, ((rhVal - 30) / (70 - 30)) * 100)) : 0;
  const rhOk  = rhVal !== null && rhVal >= 30 && rhVal <= 70;
  const rhEl  = document.getElementById("aaalac-rh-val");
  const rhBar = document.getElementById("aaalac-rh-bar");
  const rhBadge = document.getElementById("aaalac-rh-badge");
  if (rhEl) rhEl.textContent = rhVal !== null ? `${rhVal.toFixed(0)} %` : "--";
  if (rhBar) { rhBar.style.width = `${rhPct}%`; rhBar.style.background = rhOk ? "#35d071" : "#ff5353"; }
  if (rhBadge) {
    rhBadge.textContent = rhOk ? "✓ IN RANGE" : "✗ OUT";
    rhBadge.style.background = rhOk ? "#0c3524" : "#401617";
    rhBadge.style.color = rhOk ? "#35d071" : "#ff5353";
  }
}

// ===== Floor Plan Rotation =====
let floorDeg = 0;

function rotateFloor(delta) {
  floorDeg = (floorDeg + delta + 360) % 360;
  const img = document.getElementById("floorplan-img");
  if (img) img.style.transform = `rotate(${floorDeg}deg)`;
  const label = document.getElementById("floor-deg");
  if (label) label.textContent = `${floorDeg}°`;
}

function resetFloor() {
  floorDeg = 0;
  const img = document.getElementById("floorplan-img");
  if (img) img.style.transform = "rotate(0deg)";
  const label = document.getElementById("floor-deg");
  if (label) label.textContent = "0°";
}

// ===== Reports: Raw Data Extraction Console =====

const SENSOR_MAP = {
  COR: {
    B: ["COR_ROOM_IAQ"],
    C: ["COR_C_A_IAQ","COR_C_B_IAQ"],
    R: ["COR_R_A_IAQ","COR_R_B_IAQ"]
  },
  MCH: {
    B: ["MCH_ROOM_IAQ"],
    C: ["MCH_C_A_IAQ","MCH_C_B_IAQ"],
    R: ["MCH_R_A_IAQ","MCH_R_B_IAQ"]
  },
  MTG: {
    B: ["MTG_ROOM_IAQ"],
    C: [],
    R: []
  }
};

function getSensorsForCurrentState() {
  return SENSOR_MAP[STATE.room]?.[STATE.zone] || [];
}

function updateReportSensorList() {
  const list = document.getElementById("rpt-sensor-list");
  if (!list) return;
  const sensors = getSensorsForCurrentState();
  if (!sensors.length) {
    list.innerHTML = `<p style="color:var(--muted);font-size:13px">No sensors for this zone.</p>`;
    return;
  }
  list.innerHTML = sensors.map(s => `
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
                  background:#0b1522;border:1px solid var(--line);border-radius:8px;padding:10px 12px">
      <input type="checkbox" value="${s}" checked
        style="accent-color:#c0392b;width:15px;height:15px">
      <span style="font-size:13px">${s}</span>
    </label>
  `).join("");
}

function initReports() {
  updateReportSensorList();
  document.getElementById("rpt-endpoint").addEventListener("change", e => {
    const isImage = e.target.value === "images/raw";
    document.getElementById("rpt-sensors-wrap").style.display = isImage ? "none" : "";
    document.getElementById("rpt-size-wrap").style.display = isImage ? "none" : "";
  });
}

async function runExtraction() {
  const endpoint = document.getElementById("rpt-endpoint").value;
  const size = document.getElementById("rpt-size").value || 500;
  const fmt = document.querySelector('input[name="rpt-fmt"]:checked').value;
  const btn = document.getElementById("rpt-btn");
  const status = document.getElementById("rpt-status");

  const sensors = [...document.querySelectorAll("#rpt-sensor-list input:checked")]
    .map(cb => cb.value);

  if (endpoint !== "images/raw" && !sensors.length) {
    status.style.display = "block";
    status.style.background = "#401617";
    status.textContent = "⚠️ Please select at least one sensor.";
    return;
  }

  btn.disabled = true;
  btn.innerHTML = "⏳ Fetching data...";
  status.style.display = "block";
  status.style.background = "#0d2b55";
  status.textContent = `Fetching ${endpoint} ...`;

  try {
    let allRows = [];

    if (endpoint === "images/raw") {
      const res = await fetch(`${API}/images/raw?size=${size}`);
      allRows = parseNDJSON(await res.text());
    } else {
      for (const sensor of sensors) {
        status.textContent = `Fetching ${sensor} ...`;
        const res = await fetch(`${API}/${endpoint}?iaq=${sensor}&size=${size}`);
        const rows = parseNDJSON(await res.text());
        allRows = allRows.concat(rows);
      }
      allRows.sort((a, b) => {
        const da = toDate(a), db = toDate(b);
        return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
      });
    }

    if (!allRows.length) {
      status.style.background = "#401617";
      status.textContent = "⚠️ No data returned from API.";
      return;
    }

    let blob, filename;
    const tag = `${endpoint.replace(/\//g,"_")}_${Date.now()}`;

    if (fmt === "csv") {
      const keys = Object.keys(allRows[0]);
      const csv = [keys.join(","), ...allRows.map(r =>
        keys.map(k => JSON.stringify(r[k] ?? "")).join(",")
      )].join("\n");
      blob = new Blob([csv], { type: "text/csv" });
      filename = `export_${tag}.csv`;
    } else {
      blob = new Blob([allRows.map(r => JSON.stringify(r)).join("\n")],
        { type: "application/x-ndjson" });
      filename = `export_${tag}.ndjson`;
    }

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);

    status.style.background = "#0c3524";
    status.textContent = `✅ Downloaded ${allRows.length} records → ${filename}`;

  } catch (e) {
    status.style.background = "#401617";
    status.textContent = `❌ Error: ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = "<span>⚡</span> Initialize Extraction Execution Route";
  }
}

// script is at end of body — DOM is ready
installToolbars();
bindEvents();
initReports();
loadMasterLog().then(refresh);

// Extra safety net: once EVERYTHING (images, fonts, CDN scripts) has finished
// loading, force every chart to re-measure its container. This clears the
// same "chart rendered before layout settled" glitch that can otherwise only
// be fixed by the user manually scrolling the page.
window.addEventListener("load", () => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      Object.values(STATE.charts).forEach(c => c.resize());
    });
  });
});

setTimeout(() => {
  updateOverlay();
  setTimeout(updateOverlay, 5000);
}, 2000);
setInterval(refresh, 60000);
setInterval(updateOverlay, 120000);

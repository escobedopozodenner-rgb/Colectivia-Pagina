const { stops, routes, destinations, freq } = window.NUNEZ;

const params = new URLSearchParams(location.search);
const stop =
  stops.find((item) => item.id === params.get("parada")) ||
  stops.find((item) => item.id === "cabildo-nunez") ||
  stops[0];

const destinationInput = document.getElementById("destination");
const destinationList = document.getElementById("destination-list");
const chipsEl = document.getElementById("chips");
const results = document.getElementById("results");
const heading = document.getElementById("results-heading");
const sub = document.getElementById("results-sub");
const empty = document.getElementById("empty");
const stopMeta = document.getElementById("stop-meta");
const hereEl = document.getElementById("here");
const clockEl = document.getElementById("clock");
const boardEl = document.getElementById("board");
const askEl = document.getElementById("ask");
const tripEl = document.getElementById("trip");
const backBtn = document.getElementById("back");

const IDLE_MS = 45000;
let idleTimer;
let selectedDest = "";

function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function minutesToLabel(total) {
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

function parseHM(value) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function dayKey(now) {
  const d = now.getDay();
  if (d === 6) return "saturday";
  if (d === 0) return "sunday";
  return "weekday";
}

function dayLabel(key) {
  if (key === "saturday") return "sábado";
  if (key === "sunday") return "domingo / feriado";
  return "día hábil";
}

function expandWindows(windows, offset) {
  const times = [];
  windows.forEach(([from, to, every]) => {
    let start = parseHM(from) + offset;
    let end = parseHM(to) + offset;
    if (end <= start) end += 1440;
    for (let t = start; t <= end; t += every) times.push(((t % 1440) + 1440) % 1440);
  });
  return [...new Set(times)].sort((a, b) => a - b);
}

function currentWindow(windows, minutes) {
  for (const [from, to, every] of windows) {
    const start = parseHM(from);
    let end = parseHM(to);
    if (end <= start) {
      if (minutes >= start || minutes <= end) return every;
    } else if (minutes >= start && minutes <= end) {
      return every;
    }
  }
  return windows[windows.length - 1][2];
}

function nextTimes(times, now, count) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const sec = now.getSeconds();
  const upcoming = times.filter((t) => t > nowMin || (t === nowMin && sec < 20));
  return upcoming.concat(times).slice(0, count);
}

function hereIndex(route) {
  const stopNorm = normalize(stop.name);
  const tokens = stopNorm.split(/[\s/,]+/).filter((t) => t.length > 3);
  let best = 0;
  let bestScore = -1;
  route.via.forEach((item, index) => {
    const hay = normalize(`${item.stop} ${item.locality}`);
    let score = 0;
    if (hay.includes(stopNorm) || stopNorm.includes(normalize(item.stop))) score += 8;
    tokens.forEach((token) => {
      if (hay.includes(token)) score += 2;
    });
    if (normalize(item.locality) === "nunez" && stop.id !== "ciudad-universitaria") score += 1;
    if (stop.id === "ciudad-universitaria" && hay.includes("universitaria")) score += 10;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return bestScore >= 6 ? best : -1;
}

function pathFromHere(route) {
  const start = hereIndex(route);
  if (start < 0) return [];
  return route.via.slice(start);
}

function matchesDestination(route, query) {
  if (!query) return false;
  const path = pathFromHere(route);
  if (path.length < 2) return false;
  const q = normalize(query);
  const later = path.slice(1);
  if (normalize(route.toward).includes(q)) {
    const alreadyHere = normalize(path[0].locality).includes(q) || normalize(path[0].stop).includes(q);
    if (!alreadyHere) return true;
  }
  return later.some((item) => {
    return normalize(item.locality).includes(q) || normalize(item.stop).includes(q);
  });
}

function isDestPoint(item, query) {
  if (!query) return false;
  const q = normalize(query);
  return normalize(item.locality).includes(q) || normalize(item.stop).includes(q);
}

function reachablePlaces() {
  const places = new Set();
  stop.services.forEach((id) => {
    pathFromHere(routes[id]).forEach((item) => {
      if (normalize(item.locality) !== "nunez") places.add(item.locality);
    });
  });
  destinations.forEach((place) => {
    if (stop.services.some((id) => matchesDestination(routes[id], place))) places.add(place);
  });
  return [...places].sort((a, b) => a.localeCompare(b, "es"));
}

function secondsUntil(busMin, now) {
  const busSec = busMin * 60;
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  let diff = busSec - nowSec;
  if (diff < -20) diff += 86400;
  return diff;
}

function waitLabel(busMin, now) {
  const diff = secondsUntil(busMin, now);
  if (diff <= 20) return "ahora";
  const minutes = Math.floor(diff / 60);
  const seconds = diff % 60;
  if (minutes <= 0) return `en ${seconds} s`;
  return `en ${minutes}:${pad(seconds)}`;
}

function arrivalAtDest(route, query, busMin) {
  const path = pathFromHere(route);
  let destIndex = path.findIndex((item) => isDestPoint(item, query));
  if (destIndex < 0) destIndex = path.length - 1;
  return minutesToLabel(busMin + destIndex * 4);
}

function tickClock() {
  clockEl.textContent = new Date().toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function serviceSnapshot(routeId, now) {
  const route = routes[routeId];
  const key = dayKey(now);
  const windows = freq[route.freq][key];
  const times = expandWindows(windows, stop.offset);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const upcoming = nextTimes(times, now, 8);
  return { route, key, windows, times, nowMin, upcoming, every: currentWindow(windows, nowMin) };
}

function renderBoard(now) {
  const next = stop.services
    .filter((id) => pathFromHere(routes[id]).length)
    .map((id) => {
      const snap = serviceSnapshot(id, now);
      return { id, ...snap, next: snap.upcoming[0] };
    })
    .sort((a, b) => a.next - b.next)
    .slice(0, 8);

  boardEl.innerHTML = next
    .map(
      (item) => `
      <div class="pill">
        <b>${item.route.line}</b>
        <span>${item.route.toward}</span>
        <em data-next="${item.next}">${minutesToLabel(item.next)} · ${waitLabel(item.next, now)}</em>
      </div>`
    )
    .join("");
}

function card(routeId, now, query) {
  const snap = serviceSnapshot(routeId, now);
  const { route, upcoming, nowMin, every, times, key } = snap;
  const path = pathFromHere(route);
  const next = upcoming[0];

  const article = document.createElement("article");
  article.className = "card";
  article.innerHTML = `
    <div class="card-top">
      <span class="badge">${route.line}</span>
      <div>
        <h3>Línea ${route.line} hacia ${route.toward}</h3>
        <p class="meta">Ramal ${route.ramal} · te subís acá, en ${stop.name}</p>
      </div>
      <p class="eta">
        <strong>${minutesToLabel(next)}</strong>
        <span data-next="${next}">próximo ${waitLabel(next, now)}</span>
      </p>
    </div>
    <div class="times">
      ${upcoming
        .map((t, i) => `<span class="time${i === 0 ? " next" : ""}">${minutesToLabel(t)}</span>`)
        .join("")}
    </div>
    <p class="freq">Cada ${every} min · llega a ${query} cerca de las ${arrivalAtDest(route, query, next)} · primer ${minutesToLabel(times[0])} · último ${minutesToLabel(times[times.length - 1])} (${dayLabel(key)})</p>
    <ol class="route">
      ${path
        .map((item, i) => {
          const here = i === 0;
          const dest = isDestPoint(item, query);
          return `<li class="${here ? "is-here" : ""} ${dest ? "is-dest" : ""}"><span>${item.stop}</span><small>${item.locality}${here ? " · tu parada" : dest ? " · tu destino" : ""}</small></li>`;
        })
        .join("")}
    </ol>
  `;
  return article;
}

function showHome() {
  selectedDest = "";
  destinationInput.value = "";
  askEl.hidden = false;
  tripEl.hidden = true;
}

function showTrip(query) {
  selectedDest = query;
  destinationInput.value = query;
  askEl.hidden = true;
  tripEl.hidden = false;
  renderTrip();
}

function renderTrip() {
  const query = selectedDest;
  const now = new Date();
  const matched = stop.services.filter((id) => matchesDestination(routes[id], query));

  heading.textContent = `Para ir a ${query}`;
  sub.textContent = `${matched.length} ${matched.length === 1 ? "colectivo" : "colectivos"} desde ${stop.name}`;

  results.innerHTML = "";
  if (!matched.length) {
    empty.hidden = false;
    empty.textContent = `Ningún colectivo de esta parada declara ${query} más adelante en su ruta. Probá un barrio vecino.`;
    return;
  }

  empty.hidden = true;
  matched.forEach((id) => results.appendChild(card(id, now, query)));
}

function paintWaits() {
  const now = new Date();
  document.querySelectorAll("[data-next]").forEach((el) => {
    const next = Number(el.dataset.next);
    if (el.tagName === "EM") {
      el.textContent = `${minutesToLabel(next)} · ${waitLabel(next, now)}`;
    } else {
      el.textContent = `próximo ${waitLabel(next, now)}`;
    }
  });
}

function render() {
  const now = new Date();
  tickClock();
  renderBoard(now);
  if (selectedDest) renderTrip();
}

let lastMinute = -1;

function tick() {
  const now = new Date();
  tickClock();
  const minute = now.getHours() * 60 + now.getMinutes();
  if (minute !== lastMinute) {
    lastMinute = minute;
    renderBoard(now);
    if (selectedDest) renderTrip();
    return;
  }
  paintWaits();
}

function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(showHome, IDLE_MS);
}

hereEl.textContent = `Estás en ${stop.name}`;
stopMeta.textContent = `${stop.address} · ${stop.hint}`;

reachablePlaces().forEach((place) => {
  const option = document.createElement("option");
  option.value = place;
  destinationList.appendChild(option);

  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  chip.textContent = place;
  chip.addEventListener("click", () => showTrip(place));
  chipsEl.appendChild(chip);
});

destinationInput.addEventListener("change", () => {
  const value = destinationInput.value.trim();
  if (value) showTrip(value);
});

destinationInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const value = destinationInput.value.trim();
    if (value) showTrip(value);
  }
});

backBtn.addEventListener("click", showHome);

["pointerdown", "keydown"].forEach((type) => {
  document.addEventListener(type, resetIdle, { passive: true });
});

setInterval(tick, 250);
resetIdle();
render();

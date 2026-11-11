const categories = window.ROBO_CATEGORIES;

const explorations = window.ROBO_EXPLORATIONS;
const categoryList = document.querySelector("#category-list");
const cardGrid = document.querySelector("#card-grid");
const searchInput = document.querySelector("#search-input");
const resultCount = document.querySelector("#result-count");
const emptyState = document.querySelector("#empty-state");
const exploreDialog = document.querySelector("#explore-dialog");
let activeCategory = "All";
let activeExploration = null;
let activeStep = 0;
let animationPaused = false;
let sceneRotation = { x: 7, y: -8 };
let sceneDrag = null;
let sendingMessage = false;
const CHAT_STORAGE_KEY = "robo-chat-history-v1";
const SETTINGS_STORAGE_KEY = "robo-settings-v1";
const STUDENTS_STORAGE_KEY = "robo-students-v1";
const SCHEDULE_STORAGE_KEY = "robo-schedule-v1";
const CALENDAR_STORAGE_KEY = "robo-calendar-v1";
const TIMETABLE_STORAGE_KEY = "robo-timetable-v1";
const ALARM_STORAGE_KEY = "robo-alarms-v1";
const MAX_TIMER_SECONDS = 5 * 60 * 60;
const ALARM_SOUNDS = [
  { id: "classic", name: "Classic chime", wave: "sine", notes: [523, 659, 784, 659] },
  { id: "bright", name: "Bright bells", wave: "sine", notes: [784, 988, 1175, 988] },
  { id: "digital", name: "Digital pulse", wave: "square", notes: [660, 880, 660, 1047] },
  { id: "marimba", name: "Marimba", wave: "triangle", notes: [392, 523, 659, 523] },
  { id: "rising", name: "Rising tones", wave: "sine", notes: [392, 494, 587, 698, 880] },
  { id: "soft", name: "Soft waves", wave: "sine", notes: [440, 554, 440, 554] },
  { id: "woodblock", name: "Woodblock", wave: "triangle", notes: [880, 660, 880, 660] },
  { id: "chords", name: "Gentle chords", wave: "sine", notes: [523, 659, 784, 1047, 784, 659] },
  { id: "sparkle", name: "Sparkle", wave: "triangle", notes: [1047, 1319, 1568, 1319] },
  { id: "double-beep", name: "Double beep", wave: "square", notes: [740, 740, 988, 988] }
];
const TIMETABLE_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIMETABLE_ROW_TIMES = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
const DEFAULT_TIMETABLE = TIMETABLE_ROW_TIMES.map((time, index) => ({
  time,
  Monday: index % 2 === 0 ? "Study block" : "Free reading",
  Tuesday: index % 3 === 0 ? "Math" : "Project work",
  Wednesday: index % 2 === 0 ? "Science" : "Creative task",
  Thursday: index % 3 === 0 ? "History" : "Review notes",
  Friday: index % 2 === 0 ? "Reading" : "Revision",
  Saturday: index % 3 === 0 ? "Practice" : "Family time",
  Sunday: index % 2 === 0 ? "Rest and reset" : "Planning"
}));
let conversations = loadStored(CHAT_STORAGE_KEY, []);
let students = loadStored(STUDENTS_STORAGE_KEY, []);
let authState = { signedIn: false, provider: "Guest", displayName: "Guest", email: "" };
let oauthConfig = null;
let settings = loadStored(SETTINGS_STORAGE_KEY, { theme: "light", responseStyle: "balanced", alarmSound: "classic" });
if (!ALARM_SOUNDS.some(sound => sound.id === settings.alarmSound)) settings.alarmSound = "classic";
let timetableEntries = loadStored(TIMETABLE_STORAGE_KEY, DEFAULT_TIMETABLE);
let alarmEntries = loadStored(ALARM_STORAGE_KEY, [
  { id: "alarm-1", when: "2026-11-11T07:30", label: "Wake-up review", ringing: false },
  { id: "alarm-2", when: "2026-11-11T18:45", label: "Evening recap", ringing: false }
]);
let activeClockMode = "alarm";
let selectedCalendarMonth = new Date().getMonth();
let selectedCalendarYear = new Date().getFullYear();
let stopwatchStart = null;
let stopwatchElapsedMs = 0;
let stopwatchHandle = null;
let timerRemainingMs = 0;
let timerHandle = null;
let timerRunning = false;
let alarmAudioContext = null;
let activeAlarmOscillators = [];
let alarmSoundTimeout = null;
let lastTimetableAnnouncement = null;
let scheduleItems = loadStored(SCHEDULE_STORAGE_KEY, [
  { id: "schedule-1", title: "Freshwater swamp review", date: "2026-11-12", time: "09:00", notes: "Summarize the habitat and biodiversity connections." },
  { id: "schedule-2", title: "Spacecraft re-entry recap", date: "2026-11-15", time: "15:30", notes: "Compare re-entry heat, atmosphere, and safety systems." },
  { id: "schedule-3", title: "Silk Road timeline", date: "2026-11-18", time: "11:15", notes: "Map trade routes and why the network mattered to culture." }
]);
let calendarNotes = loadStored(CALENDAR_STORAGE_KEY, {});
let currentChatId = null;
let selectedDayDate = null;

function loadStored(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.error(`Unable to load ${key} from this browser.`, error);
    return fallback;
  }
}

function saveStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Unable to save ${key} in this browser.`, error);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function renderCategories() {
  categoryList.innerHTML = categories.map(category =>
    `<button class="category-button" type="button" aria-pressed="${category === activeCategory}" data-category="${category}">${category}</button>`
  ).join("");
}

function renderCards() {
  const query = searchInput.value.trim().toLowerCase();
  const visible = explorations.filter(item =>
    (activeCategory === "All" || item.category === activeCategory) &&
    (!query || `${item.title} ${item.description} ${item.category}`.toLowerCase().includes(query))
  );
  cardGrid.innerHTML = visible.map(item => `
    <button class="exploration-card" type="button" data-id="${item.id}" aria-label="Explore ${item.title}" style="--scene-accent:${item.accent};--scene-tint:${item.tint}">
      <span class="card-art"><span class="card-category">${item.category}</span><span class="card-symbol" aria-hidden="true">${item.icon}</span><span class="mini-land"></span><span class="card-play" aria-hidden="true">▶</span></span>
      <span class="card-info"><span class="card-title-row"><span class="card-title">${item.title}</span><span class="card-level">${item.level}</span></span><span class="card-description">${item.description}</span><span class="card-meta"><span>◷ &nbsp;${item.duration}</span><span>Explore &nbsp;→</span></span></span>
    </button>
  `).join("");
  resultCount.textContent = `${visible.length} ${visible.length === 1 ? "exploration" : "explorations"}`;
  emptyState.hidden = visible.length > 0;
  cardGrid.hidden = visible.length === 0;
}

function renderScene(item) {
  activeExploration = item;
  activeStep = 0;
  animationPaused = false;
  document.querySelector("#scene-category").textContent = item.category;
  document.querySelector("#scene-title").textContent = item.title;
  document.querySelector("#scene-frame").style.setProperty("--scene-accent", item.accent);
  document.querySelector("#scene-frame").style.setProperty("--scene-tint", item.tint);
  document.querySelector("#scene-art").innerHTML = item.art;
  sceneRotation = { x: 7, y: -8 };
  updateSceneRotation();
  document.querySelector("#scene-caption").textContent = item.caption;
  document.querySelector("#scene-frame").classList.remove("paused", "is-rotated");
  document.querySelector("#flow-scene").textContent = "Ⅱ";
  document.querySelector("#flow-scene").setAttribute("aria-label", "Pause scene animation");
  const pins = document.querySelector("#scene-pins");
  pins.innerHTML = item.pins.map((pin, index) => `
    <button type="button" class="scene-pin" data-label-anchor="${pin.x > 60 ? "left" : "right"}" data-label-vertical="${pin.y > 50 ? "below" : "above"}" style="left:${pin.x}%;top:${pin.y}%" data-step="${index}" aria-label="Point ${index + 1}: ${pin.label}" aria-pressed="${index === 0}">
      <span class="pin-dot">${index + 1}</span><span class="scene-pin-label">${pin.label}</span>
    </button>
  `).join("");
  document.querySelector(".scene-scale").textContent = `01 — ${String(item.notes.length).padStart(2, "0")}`;
  document.querySelector("#step-dots").innerHTML = item.notes.map((_, index) =>
    `<button class="step-dot" type="button" data-step="${index}" aria-label="Go to point ${index + 1}" aria-current="${index === 0 ? "step" : "false"}"></button>`
  ).join("");
  updateLesson();
  exploreDialog.showModal();
  document.querySelector("#close-dialog").focus();
}

function updateSceneRotation() {
  document.querySelector("#scene-art").style.transform =
    `rotateX(${sceneRotation.x}deg) rotateY(${sceneRotation.y}deg) scale(.96)`;
}

function updateLesson() {
  const [title, copy, roboNote] = activeExploration.notes[activeStep];
  document.querySelector("#lesson-kicker").textContent = `LOOK CLOSER · ${activeExploration.title.toUpperCase()}`;
  document.querySelector("#lesson-step").textContent = `${String(activeStep + 1).padStart(2, "0")} / ${String(activeExploration.notes.length).padStart(2, "0")}`;
  document.querySelector("#lesson-title").textContent = title;
  document.querySelector("#lesson-copy").textContent = copy;
  document.querySelector("#robo-note-copy").textContent = roboNote;
  document.querySelector("#lesson-progress-bar").style.width = `${((activeStep + 1) / activeExploration.notes.length) * 100}%`;
  document.querySelectorAll(".scene-pin").forEach((pin, index) => pin.setAttribute("aria-pressed", String(index === activeStep)));
  document.querySelectorAll(".step-dot").forEach((dot, index) => dot.setAttribute("aria-current", index === activeStep ? "step" : "false"));
}

function setStep(step) {
  if (!activeExploration) return;
  activeStep = (step + activeExploration.notes.length) % activeExploration.notes.length;
  updateLesson();
}

function setView(name) {
  document.querySelectorAll(".app-view").forEach(view => { view.hidden = view.id !== `${name}-view`; });
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === name));
  document.querySelector("#sidebar").classList.remove("mobile-open");
  document.querySelector("#mobile-menu").setAttribute("aria-expanded", "false");
  if (name === "students") renderStudents();
  if (name === "scheduled") renderSchedule();
  if (name === "chat") document.querySelector("#workspace-chat-input").focus();
}

function createChat() {
  currentChatId = null;
  document.querySelector("#conversation-messages").replaceChildren();
  document.querySelector("#workspace-chat-input").value = "";
  setView("chat");
}

function saveConversations() {
  conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  saveStored(CHAT_STORAGE_KEY, conversations);
  renderHistory();
}

function currentConversation() {
  return conversations.find(chat => chat.id === currentChatId);
}

function renderHistory() {
  const query = document.querySelector("#history-search").value.trim().toLowerCase();
  const visible = conversations.filter(chat => !query || chat.title.toLowerCase().includes(query) ||
    chat.messages.some(message => message.text.toLowerCase().includes(query)));
  document.querySelector("#history-count").textContent = conversations.length ? String(conversations.length) : "";
  document.querySelector("#history-empty").hidden = visible.length > 0;
  document.querySelector("#history-empty").textContent = conversations.length ? "No chats match your search." : "Your conversations will show up here.";
  document.querySelector("#chat-history").innerHTML = visible.map(chat =>
    `<button class="history-item${chat.id === currentChatId ? " selected" : ""}" type="button" data-chat-id="${escapeHtml(chat.id)}" title="${escapeHtml(chat.title)}">${escapeHtml(chat.title)}</button>`
  ).join("");
}

function renderConversation() {
  const conversation = currentConversation();
  const container = document.querySelector("#conversation-messages");
  const chatContent = document.querySelector(".chat-content");
  container.replaceChildren();
  chatContent.classList.toggle("has-messages", Boolean(conversation?.messages.length));
  if (!conversation) return;
  conversation.messages.forEach(message => {
    const bubble = document.createElement("article");
    bubble.className = `message-row ${message.role === "user" ? "user-message" : "assistant-message"}`;
    if (message.role === "assistant") {
      const avatar = document.createElement("span");
      avatar.className = "robo-avatar message-avatar";
      avatar.setAttribute("aria-hidden", "true");
      const icon = document.createElement("img");
      icon.className = "robo-icon";
      icon.src = "robo-icon.ico";
      icon.alt = "";
      avatar.append(icon);
      bubble.append(avatar);
    }
    const text = document.createElement("p");
    text.className = "message-text";
    text.textContent = message.text;
    bubble.append(text);
    const hasGeneratedImage = typeof message.imageData === "string" || (typeof message.imageSvg === "string" && message.imageSvg.startsWith("<svg "));
    if (hasGeneratedImage) {
      const artwork = document.createElement("div");
      artwork.className = "generated-artwork";
      const image = document.createElement("img");
      image.alt = `Illustration: ${message.imagePrompt || message.text}`;
      const imageMimeType = message.imageMimeType || "image/png";
      image.src = typeof message.imageData === "string"
        ? `data:${imageMimeType};base64,${message.imageData}`
        : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(message.imageSvg)}`;
      artwork.append(image);
      const download = document.createElement("button");
      download.type = "button";
      download.className = "artwork-download";
      download.textContent = typeof message.imageData === "string" ? "Download image" : "Download SVG";
      download.addEventListener("click", () => {
        const imageBytes = typeof message.imageData === "string"
          ? Uint8Array.from(atob(message.imageData), character => character.charCodeAt(0))
          : null;
        const file = new Blob([imageBytes || message.imageSvg], { type: imageBytes ? imageMimeType : "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(file);
        const link = document.createElement("a");
        link.href = url;
        const extension = imageMimeType === "image/jpeg" ? "jpg" : imageMimeType === "image/webp" ? "webp" : imageBytes ? "png" : "svg";
        link.download = `${(message.imagePrompt || "robo-illustration").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "robo-illustration"}.${extension}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      artwork.append(download);
      bubble.append(artwork);
    }
    if (message.explorationId) {
      const item = explorations.find(exploration => exploration.id === message.explorationId);
      if (item) {
        const launch = document.createElement("button");
        launch.type = "button";
        launch.className = "chat-launch";
        launch.textContent = `Open ${item.title} →`;
        launch.addEventListener("click", () => renderScene(item));
        bubble.append(launch);
      }
    }
    if (Array.isArray(message.sources) && message.sources.length) {
      const sources = document.createElement("div");
      sources.className = "message-sources";
      const label = document.createElement("span");
      label.textContent = "Sources";
      sources.append(label);
      message.sources.forEach(source => {
        if (!source.url || !/^https?:\/\//i.test(source.url)) return;
        const link = document.createElement("a");
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = source.title || source.url;
        sources.append(link);
      });
      if (sources.childElementCount > 1) bubble.append(sources);
    }
    container.append(bubble);
  });
  container.scrollTop = container.scrollHeight;
}

function findExploration(message) {
  const query = message.toLowerCase();
  const matches = explorations.flatMap(item => item.aliases
    .filter(alias => alias.length > 3 && query.includes(alias))
    .map(alias => ({ item, score: alias.length })));
  matches.sort((a, b) => b.score - a.score);
  return matches[0]?.item || null;
}

function getImagePrompt(message) {
  if (!/\b(?:image|picture|illustration|drawing|artwork|art)\b/i.test(message) &&
      !/^\s*(?:please\s+)?(?:draw|illustrate)\b/i.test(message)) return null;
  if (/^\s*(?:can|could|would)\s+you\b/i.test(message) &&
      /\b(?:as i describe|from my description|as i tell you)\b/i.test(message) &&
      !/\b(?:of|with|wearing|showing|depicting|featuring)\b/i.test(message)) return null;
  const prompt = message
    .replace(/^\s*(?:can|could|would)\s+you\s+(?:please\s+)?/i, "")
    .replace(/^\s*(?:please\s+)?(?:create|make|draw|generate|illustrate)\s+(?:me\s+)?/i, "")
    .replace(/^(?:an?\s+)?(?:image|picture|illustration|drawing|artwork|art)\s+(?:of\s+)?/i, "")
    .replace(/^(?:for me\s+)?(?:as|while)\s+i\s+(?:describe|explain|tell you)\b.*$/i, "")
    .replace(/^(?:for me|please|now|of|for)\s+/i, "")
    .replace(/^of\s+/i, "")
    .trim();
  if (!prompt || /^(?:for me|as i describe it|as i describe|whatever i describe)$/i.test(prompt)) return null;
  return prompt;
}

function vectorIllustration(prompt) {
  const animals = ["fox", "cat", "dog", "rabbit", "bear", "owl", "bird", "deer"];
  const subject = animals.find(animal => new RegExp(`\\b${animal}(?:s|es)?\\b`, "i").test(prompt));
  const isGirl = /\b(girl|woman|lady)\b/i.test(prompt);
  const isBoy = /\b(boy|man)\b/i.test(prompt);
  const isPerson = isGirl || isBoy || /\b(person|child|human)\b/i.test(prompt);
  const isVillage = /\b(village|villages|hut|huts|thatched)\b/i.test(prompt);
  const wantsGreenery = /\b(greenery|greenary|green|trees?|plants?|bushes|garden)\b/i.test(prompt);
  const colorNames = {
    red: "#cf4e38", orange: "#dc783f", golden: "#d7a648", yellow: "#e5bd45",
    green: "#4c8c58", blue: "#4f82bc", purple: "#8564a7", pink: "#d67591",
    white: "#f0ece1", gray: "#8b9094", grey: "#8b9094", brown: "#956344",
    black: "#282b31"
  };
  const colorPattern = Object.keys(colorNames).join("|");
  const subjectColorMatch = prompt.match(new RegExp(`\\b(${colorPattern})\\s+(?:[a-z-]+\\s+){0,1}${subject}s?\\b`, "i"));
  const animalColor = subjectColorMatch ? colorNames[subjectColorMatch[1].toLowerCase()] : (subject === "fox" ? "#d8753f" : "#b77a51");
  const hatMatch = prompt.match(new RegExp(`\\b(${colorPattern})\\s+(?:[a-z-]+\\s+){0,1}(?:hat|cap)\\b`, "i"));
  const hatColor = hatMatch ? colorNames[hatMatch[1].toLowerCase()] : "#292d33";
  const hasHat = /\b(?:hat|cap)\b/i.test(prompt);
  const dressMatch = prompt.match(new RegExp(`\\b(${colorPattern})\\s+(?:[a-z-]+\\s+){0,1}(?:frock|dress|gown|skirt)\\b`, "i"));
  const dressColor = dressMatch ? colorNames[dressMatch[1].toLowerCase()] : "#8564a7";
  const shirtMatch = prompt.match(new RegExp(`\\b(${colorPattern})\\s+(?:[a-z-]+\\s+){0,1}(?:shirt|top|jacket|sweater)\\b`, "i"));
  const shirtColor = shirtMatch ? colorNames[shirtMatch[1].toLowerCase()] : "#4f82bc";
  const hairColorMatch = prompt.match(/\b(blond|blonde|black|brown|red|gray|grey)\s+hair\b/i);
  const hairColor = hairColorMatch ? (hairColorMatch[1].toLowerCase().startsWith("blond") ? "#d7ad57" : colorNames[hairColorMatch[1].toLowerCase()] || "#49332e") : "#49332e";
  const skinTone = /\b(dark|deep|brown)\s+skin\b/i.test(prompt) ? "#8f5b43" : /\b(fair|light)\s+skin\b/i.test(prompt) ? "#f0c6a6" : "#d99b76";
  const night = /\b(night|moon|stars|space|dark)\b/i.test(prompt);
  const sceneId = `art-${Math.random().toString(36).slice(2, 9)}`;
  const skyTop = night ? "#18243d" : "#a8d7dc";
  const skyBottom = night ? "#566183" : "#f7d6a1";
  const ground = night ? "#354355" : "#829b6a";
  const face = isPerson
    ? `${isGirl ? `<path d="M263 161q-12-63 49-83 70-12 82 59l-5 98-30 6-7-80-77 0-5 79-31-5Z" fill="${hairColor}"/>` : `<path d="M267 137 260 111l25 13 12-29 22 19 24-19 9 28 25-12-9 49-27-23-27 8-28-8Z" fill="${hairColor}"/>`}<circle cx="314" cy="157" r="48" fill="${skinTone}"/><path d="M266 148q4-55 54-60 53 5 61 61-28-28-56-26-26 20-59 25Z" fill="${hairColor}"/><circle cx="297" cy="161" r="4" fill="#302b2a"/><circle cx="331" cy="161" r="4" fill="#302b2a"/><path d="M302 181q12 10 24 0" fill="none" stroke="#984f51" stroke-width="3" stroke-linecap="round"/>`
    : isVillage
      ? `<g><path d="M55 231 167 141l112 90v112H55Z" fill="#d9bd8f"/><path d="m38 235 129-110 130 110-18 17-112-93-111 93Z" fill="#956344"/><rect x="142" y="278" width="48" height="65" rx="18" fill="#77563e"/><rect x="77" y="256" width="34" height="32" fill="#a8d7dc" stroke="#77563e" stroke-width="6"/><path d="M363 231 475 141l112 90v112H363Z" fill="#d9bd8f"/><path d="m346 235 129-110 130 110-18 17-112-93-111 93Z" fill="#956344"/><rect x="450" y="278" width="48" height="65" rx="18" fill="#77563e"/><rect x="385" y="256" width="34" height="32" fill="#a8d7dc" stroke="#77563e" stroke-width="6"/>${wantsGreenery ? `<g fill="#4c8c58"><circle cx="37" cy="284" r="35"/><circle cx="35" cy="247" r="25"/><path d="M31 280h12v73H31Z" fill="#805a3b"/><circle cx="603" cy="279" r="38"/><circle cx="606" cy="239" r="28"/><path d="M600 277h12v76h-12Z" fill="#805a3b"/><circle cx="315" cy="318" r="17"/><circle cx="337" cy="325" r="13"/><circle cx="305" cy="331" r="10"/></g>` : ""}</g>`
    : !subject
      ? `<g>${/\b(flower|flowers|rose|tulip)\b/i.test(prompt) ? `<path d="M315 284v86m0-45q-43-30-52 2 31 16 52 6m0 12q38-32 54-4-24 23-54 15" fill="none" stroke="#4c8c58" stroke-width="10" stroke-linecap="round"/><g fill="#d67591"><ellipse cx="315" cy="185" rx="20" ry="50"/><ellipse cx="315" cy="185" rx="20" ry="50" transform="rotate(72 315 185)"/><ellipse cx="315" cy="185" rx="20" ry="50" transform="rotate(144 315 185)"/><ellipse cx="315" cy="185" rx="20" ry="50" transform="rotate(216 315 185)"/><ellipse cx="315" cy="185" rx="20" ry="50" transform="rotate(288 315 185)"/><circle cx="315" cy="185" r="20" fill="#e5bd45"/></g>`
        : /\b(castle|house|home|cottage|building)\b/i.test(prompt) ? (/\bcastle\b/i.test(prompt) ? `<path d="M203 202h52v-66l28 22 28-22v66h59v-66l28 22 28-22v66h32v153H203Z" fill="#d7c6a6"/><path d="M203 202h52v-66l28 22 28-22v66m59 0v-66l28 22 28-22v66" fill="none" stroke="#a78b6b" stroke-width="8"/><path d="M290 355v-77q24-40 48 0v77" fill="#6a7180"/><g fill="#a8d7dc"><rect x="224" y="231" width="19" height="31"/><rect x="267" y="221" width="18" height="27"/><rect x="349" y="221" width="18" height="27"/><rect x="391" y="231" width="19" height="31"/></g>` : `<path d="m210 220 104-84 106 84v116H210Z" fill="#f2d4a0"/><path d="m190 224 124-103 127 103-17 19-110-90-108 90Z" fill="#b65d4d"/><rect x="285" y="270" width="57" height="66" rx="4" fill="#6c85a5"/><rect x="229" y="244" width="37" height="37" fill="#a8d7dc"/><rect x="358" y="244" width="37" height="37" fill="#a8d7dc"/>`)
          : /\b(car|truck|bus|vehicle)\b/i.test(prompt) ? `<path d="m192 281 34-62q9-17 27-17h115q19 0 29 18l31 61v49H192Z" fill="#4f82bc"/><path d="m244 211-29 54h175l-26-54Z" fill="#bde0e4"/><circle cx="249" cy="330" r="26" fill="#303941"/><circle cx="367" cy="330" r="26" fill="#303941"/><circle cx="249" cy="330" r="11" fill="#d8e0de"/><circle cx="367" cy="330" r="11" fill="#d8e0de"/>`
            : /\b(tree|forest|woods)\b/i.test(prompt) ? `<path d="M293 238h43v123h-43Z" fill="#805a3b"/><path d="M314 102 224 257h180Z" fill="#4c8c58"/><path d="m314 151-79 130h158Z" fill="#639b63"/><circle cx="267" cy="231" r="35" fill="#78a96c"/><circle cx="359" cy="224" r="38" fill="#5a965f"/>`
              : /\b(planet|earth|moon|saturn|jupiter|mars)\b/i.test(prompt) ? `<circle cx="314" cy="215" r="105" fill="${/\b(earth)\b/i.test(prompt) ? "#4f82bc" : "#d7a648"}"/><path d="M222 211q43-43 81-2t96-9M245 263q38-32 72 0t69-4" fill="none" stroke="${/\b(earth)\b/i.test(prompt) ? "#4c8c58" : "#b8774b"}" stroke-width="24" stroke-linecap="round" opacity=".8"/>${/\b(saturn)\b/i.test(prompt) ? `<ellipse cx="314" cy="215" rx="147" ry="37" fill="none" stroke="#e4c78c" stroke-width="15" transform="rotate(-16 314 215)"/>` : ""}`
                : /\b(mountain|mountains|landscape|ocean|sea|beach|waterfall)\b/i.test(prompt) ? `<path d="m110 320 147-190 133 190Z" fill="#8298a7"/><path d="m257 130 40 56-46-17-35 45Z" fill="#f0ece1"/><path d="m300 320 131-158 123 158Z" fill="#677f78"/><path d="M0 322q91-26 182 0t183 0 275 0v118H0Z" fill="${/\b(ocean|sea|beach|waterfall)\b/i.test(prompt) ? "#4f91a2" : "#718b65"}"/>`
                  : /\b(rocket|spaceship|spacecraft)\b/i.test(prompt) ? `<path d="M314 106q78 71 55 194l-55 51-55-51q-23-123 55-194Z" fill="#d9e3e3"/><path d="M259 269 212 316l52 6m112-53 47 47-52 6" fill="#cf4e38"/><circle cx="314" cy="218" r="23" fill="#4f82bc" stroke="#fff" stroke-width="7"/><path d="m291 348 23 43 23-43" fill="#e5a944"/>`
                    : `<circle cx="314" cy="220" r="94" fill="${colorNames[(prompt.match(new RegExp(`\\b(${colorPattern})\\b`, "i")) || [])[1]?.toLowerCase()] || "#d7a648"}"/>`}</g>`
      : subject === "fox"
    ? `<path d="M259 169 247 103 298 143 329 131 367 102 361 174Z" fill="${animalColor}"/><path d="m257 132 2 38 29-24Z" fill="#f3b4a0"/><path d="m347 146 28-29-8 51Z" fill="#f3b4a0"/><ellipse cx="314" cy="183" rx="66" ry="56" fill="${animalColor}"/><path d="M268 197q45 50 91 0-5 50-45 54-41-4-46-54" fill="#f5eee2"/><ellipse cx="314" cy="218" rx="13" ry="9" fill="#34353a"/><ellipse cx="291" cy="184" rx="5" ry="7" fill="#282b31"/><ellipse cx="338" cy="184" rx="5" ry="7" fill="#282b31"/>`
    : subject === "rabbit"
      ? `<ellipse cx="285" cy="135" rx="20" ry="74" transform="rotate(-13 285 135)" fill="${animalColor}"/><ellipse cx="342" cy="133" rx="20" ry="75" transform="rotate(12 342 133)" fill="${animalColor}"/><ellipse cx="285" cy="137" rx="9" ry="50" transform="rotate(-13 285 137)" fill="#e9b3a5"/><ellipse cx="342" cy="135" rx="9" ry="50" transform="rotate(12 342 135)" fill="#e9b3a5"/><ellipse cx="314" cy="185" rx="65" ry="55" fill="${animalColor}"/><ellipse cx="290" cy="182" rx="5" ry="7" fill="#282b31"/><ellipse cx="338" cy="182" rx="5" ry="7" fill="#282b31"/><ellipse cx="314" cy="213" rx="20" ry="15" fill="#f5eee2"/><circle cx="314" cy="207" r="6" fill="#d87980"/>`
      : subject === "bear"
        ? `<circle cx="270" cy="145" r="28" fill="${animalColor}"/><circle cx="358" cy="145" r="28" fill="${animalColor}"/><circle cx="270" cy="145" r="12" fill="#dfb7a0"/><circle cx="358" cy="145" r="12" fill="#dfb7a0"/><circle cx="314" cy="184" r="68" fill="${animalColor}"/><ellipse cx="314" cy="210" rx="30" ry="23" fill="#e8cdb5"/><circle cx="314" cy="199" r="9" fill="#302c2b"/><circle cx="290" cy="177" r="5" fill="#282b31"/><circle cx="338" cy="177" r="5" fill="#282b31"/>`
        : subject === "bird" || subject === "owl"
          ? `<ellipse cx="314" cy="190" rx="70" ry="86" fill="${animalColor}"/><path d="M250 183 211 215l42 19M378 183l39 32-42 19" fill="${animalColor}"/><circle cx="290" cy="174" r="20" fill="#f4eee0"/><circle cx="338" cy="174" r="20" fill="#f4eee0"/><circle cx="290" cy="175" r="8" fill="#282b31"/><circle cx="338" cy="175" r="8" fill="#282b31"/><path d="m314 188-13 22h26Z" fill="#e5a944"/>`
          : subject === "deer"
            ? `<path d="M284 151 267 97l22 28 10-42 8 51M345 151l20-54-23 28-8-42-9 51" fill="none" stroke="#8a6547" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="314" cy="185" rx="62" ry="59" fill="${animalColor}"/><ellipse cx="314" cy="214" rx="25" ry="17" fill="#f2e7d8"/><circle cx="290" cy="180" r="5" fill="#282b31"/><circle cx="338" cy="180" r="5" fill="#282b31"/><circle cx="314" cy="211" r="7" fill="#302c2b"/>`
            : `<path d="M261 164 258 115l38 30 39 0 39-30-5 49Z" fill="${animalColor}"/><ellipse cx="314" cy="185" rx="66" ry="58" fill="${animalColor}"/><ellipse cx="314" cy="211" rx="29" ry="20" fill="#f0e5d7"/><circle cx="290" cy="182" r="6" fill="#282b31"/><circle cx="338" cy="182" r="6" fill="#282b31"/><ellipse cx="314" cy="211" rx="8" ry="6" fill="#302c2b"/>`;
  const hat = hasHat
    ? `<path d="M261 138q6-57 53-61 47 4 53 61Z" fill="${hatColor}"/><path d="M249 136q65-18 130 0v12q-65 13-130 0Z" fill="${hatColor}"/><path d="M279 105q35-16 70 0" fill="none" stroke="#ffffff55" stroke-width="4"/>`
    : "";
  const tail = subject === "fox"
    ? `<path d="M203 279q-86 10-76-59 8-54 74-19-43 0-30 38 11 25 43 14Z" fill="${animalColor}"/><path d="M128 231q15-24 47-20-24 21-7 43-34-1-40-23" fill="#f4eee2"/>`
    : subject ? `<path d="M219 292q-63 7-72-38 39 12 61-19" fill="none" stroke="${animalColor}" stroke-width="22" stroke-linecap="round"/>` : "";
  const personBody = isBoy
    ? `<path d="M299 205h30l8 24 40 20-12 28-33-15v54h-36v-54l-33 15-12-28 40-20Z" fill="${shirtColor}" stroke="#fff" stroke-opacity=".3" stroke-width="3"/><path d="m296 310-5 65h24l10-53 10 53h24l-5-65Z" fill="#45556a"/><path d="m287 375-7 9h37l-2-9m20 0-2 9h37l-7-9" fill="#343941"/><path d="m264 247-29 39m141-39 29 39" stroke="${skinTone}" stroke-width="12" stroke-linecap="round"/>`
    : isGirl
      ? `<path d="M301 204h26l7 25 48 35-15 22-36-20-17 68h-40l-17-68-36 20-15-22 48-35 7-25Z" fill="${dressColor}" stroke="#fff" stroke-opacity=".3" stroke-width="3"/><path d="m274 334 40-9 40 9-9 43h-62Z" fill="${dressColor}"/><path d="m283 377-7 7h34l4-7m16 0 4 7h34l-7-7" fill="#343941"/><path d="m265 246-28 43m138-43 28 43" stroke="${skinTone}" stroke-width="12" stroke-linecap="round"/>`
      : `<path d="M300 205h28l8 25 42 31-14 23-38-20-12 54h-40l-12-54-38 20-14-23 42-31 8-25Z" fill="${shirtColor}" stroke="#fff" stroke-opacity=".3" stroke-width="3"/><path d="m280 318 68 0-8 59h-52Z" fill="#45556a"/><path d="m288 377-7 7h34l2-7m15 0 2 7h34l-7-7" fill="#343941"/><path d="m265 246-28 43m138-43 28 43" stroke="${skinTone}" stroke-width="12" stroke-linecap="round"/>`;
  const genericBody = `<ellipse cx="314" cy="276" rx="85" ry="77" fill="#d7a648"/><circle cx="314" cy="177" r="59" fill="#e4bd8e"/><circle cx="294" cy="173" r="5" fill="#302b2a"/><circle cx="334" cy="173" r="5" fill="#302b2a"/><path d="M298 195q16 12 32 0" fill="none" stroke="#984f51" stroke-width="4" stroke-linecap="round"/>`;
  const scenery = `${night && /\b(moon|stars)\b/i.test(prompt) ? `<circle cx="500" cy="81" r="34" fill="#f4eac3"/>` : ""}${/\b(stars)\b/i.test(prompt) ? `<g fill="#fff5cf">${[[86,74],[174,111],[425,96],[552,147],[475,218],[108,194],[365,66]].map(([x,y]) => `<circle cx="${x}" cy="${y}" r="3"/>`).join("")}</g>` : ""}${/\b(sun|sunny)\b/i.test(prompt) ? `<circle cx="496" cy="91" r="40" fill="#ffe59a"/>` : ""}${/\bclouds?\b/i.test(prompt) ? `<g fill="#fff7db" opacity=".8"><ellipse cx="119" cy="112" rx="50" ry="17"/><ellipse cx="146" cy="106" rx="29" ry="19"/><ellipse cx="433" cy="137" rx="44" ry="13"/></g>` : ""}`;
  const title = prompt.slice(0, 100);
  const subjectBody = isPerson
    ? `${personBody}${face}${hasHat ? hat : ""}`
    : subject
      ? `${tail}<ellipse cx="317" cy="332" rx="103" ry="19" fill="#1e302d" opacity=".3"/><ellipse cx="314" cy="274" rx="77" ry="61" fill="${animalColor}"/><path d="M264 293v42h22v-40m54 0v40h23v-49" fill="${animalColor}"/><path d="M271 332h18m48 0h19" stroke="#f0e5d7" stroke-width="8" stroke-linecap="round"/>${face}${hat}`
      : `${face}${/\b(?:hat|cap)\b/i.test(prompt) ? hat : ""}`;
  const showGround = isVillage || subject || isPerson || /\b(flower|flowers|rose|tulip|castle|house|home|cottage|building|car|truck|bus|vehicle|tree|forest|woods|mountain|mountains|landscape|ocean|sea|beach|waterfall)\b/i.test(prompt);
  const backdrop = showGround
    ? `<path d="M0 292q122-92 244 0t238-7q94-76 158-24v179H0Z" fill="${night ? "#45556a" : "#a5b484"}"/><path d="M0 335q112-88 247-13t231-8q89-69 162-28v154H0Z" fill="url(#${sceneId}-ground)"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 440" role="img" aria-labelledby="${sceneId}-title"><title id="${sceneId}-title">${escapeHtml(title)}</title><defs><linearGradient id="${sceneId}-sky" x2="0" y2="1"><stop stop-color="${skyTop}"/><stop offset="1" stop-color="${skyBottom}"/></linearGradient><linearGradient id="${sceneId}-ground" x2="0" y2="1"><stop stop-color="${ground}"/><stop offset="1" stop-color="#455c4f"/></linearGradient><filter id="${sceneId}-shadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="10" stdDeviation="8" flood-color="#172522" flood-opacity=".22"/></filter></defs><rect width="640" height="440" rx="28" fill="url(#${sceneId}-sky)"/>${scenery}${backdrop}<g filter="url(#${sceneId}-shadow)">${subjectBody}</g></svg>`;
}

async function createIllustration(conversation, prompt) {
  if (/\b(?:violent|violence|kill|murder|blood|gore|attack|assault|bombing|explosion|stabbing|shooting|warfare|battlefield|torture|beating|fight|wound|wounded|corpse|massacre)\b/i.test(prompt)) {
    conversation.messages.push({
      role: "assistant",
      text: "I can’t create illustrations depicting violence. Try a peaceful, non-violent description instead."
    });
    conversation.updatedAt = Date.now();
    renderConversation();
    saveConversations();
    return;
  }
  sendingMessage = true;
  const sendButton = document.querySelector("#send-chat");
  sendButton.disabled = true;
  document.querySelectorAll(".chat-status").forEach(status => status.remove());
  saveConversations();
  showChatStatus("ROBO is creating your image…");
  try {
    const response = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    const result = await response.json();
    if (response.status === 503 && result.configured === false) {
      const imageSvg = vectorIllustration(prompt);
      conversation.messages.push({
        role: "assistant",
        text: "Gemini image generation isn’t configured on this server yet, so this is a local vector preview. Add GEMINI_API_KEY to the server environment to create prompt-specific Gemini images.",
        imagePrompt: prompt,
        imageSvg
      });
    } else if (response.status === 429) {
      conversation.messages.push({
        role: "assistant",
        text: "Gemini temporarily rejected this request because its image quota or rate limit was reached. I can’t bypass Google’s limit, but here’s a local vector preview while you check your project’s AI Studio rate limits.",
        imagePrompt: prompt,
        imageSvg: vectorIllustration(prompt)
      });
    } else {
      if (!response.ok) throw new Error(result.error || `Gemini image generation returned HTTP ${response.status}.`);
      if (typeof result.data !== "string" || !["image/png", "image/jpeg", "image/webp"].includes(result.mimeType)) {
        throw new Error("Gemini returned an invalid image. Please try again.");
      }
      conversation.messages.push({
        role: "assistant",
        text: "Here’s your image, generated by Gemini from your description.",
        imagePrompt: prompt,
        imageData: result.data,
        imageMimeType: result.mimeType
      });
    }
    conversation.updatedAt = Date.now();
    document.querySelectorAll(".chat-status").forEach(status => status.remove());
    renderConversation();
    saveConversations();
  } catch (error) {
    console.error("ROBO could not generate the image.", error);
    document.querySelectorAll(".chat-status").forEach(status => status.remove());
    showChatStatus(error.message || "ROBO couldn't generate that image. Please try again.", true, () => createIllustration(conversation, prompt));
  } finally {
    sendingMessage = false;
    sendButton.disabled = false;
  }
}

function showChatStatus(message, retry = false, retryAction = () => requestAnswer(currentConversation())) {
  const container = document.querySelector("#conversation-messages");
  const status = document.createElement("div");
  status.className = `chat-status${retry ? " chat-error" : ""}`;
  status.setAttribute("role", retry ? "alert" : "status");
  const text = document.createElement("span");
  text.textContent = message;
  status.append(text);
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Retry";
    button.addEventListener("click", retryAction);
    status.append(button);
  }
  container.append(status);
  container.scrollTop = container.scrollHeight;
}

async function requestAnswer(conversation) {
  if (sendingMessage || !conversation) return;
  sendingMessage = true;
  const sendButton = document.querySelector("#send-chat");
  sendButton.disabled = true;
  document.querySelectorAll(".chat-status").forEach(status => status.remove());
  showChatStatus("ROBO is thinking…");
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: conversation.messages.slice(-20).map(({ role, text }) => ({ role, text })),
        responseStyle: settings.responseStyle
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `ROBO returned HTTP ${response.status}.`);
    if (typeof result.text !== "string" || !result.text.trim()) throw new Error("ROBO returned an empty answer. Please try again.");
    const lastQuestion = [...conversation.messages].reverse().find(message => message.role === "user");
    const exploration = lastQuestion ? findExploration(lastQuestion.text) : null;
    conversation.messages.push({
      role: "assistant",
      text: result.text.trim(),
      sources: Array.isArray(result.sources) ? result.sources : [],
      ...(exploration ? { explorationId: exploration.id } : {})
    });
    conversation.updatedAt = Date.now();
    document.querySelectorAll(".chat-status").forEach(status => status.remove());
    renderConversation();
    saveConversations();
  } catch (error) {
    console.error("ROBO could not answer the message.", error);
    document.querySelectorAll(".chat-status").forEach(status => status.remove());
    showChatStatus(error.message || "ROBO couldn't answer that question. Please try again.", true);
  } finally {
    sendingMessage = false;
    sendButton.disabled = false;
  }
}

async function sendMessage(text) {
  const value = text.trim();
  if (!value || sendingMessage) return;
  if (!currentConversation()) {
    currentChatId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    conversations.unshift({ id: currentChatId, title: value.slice(0, 42), messages: [], updatedAt: Date.now() });
  }
  const conversation = currentConversation();
  conversation.messages.push({ role: "user", text: value });
  conversation.updatedAt = Date.now();
  document.querySelector("#workspace-chat-input").value = "";
  const imagePrompt = getImagePrompt(value);
  if (imagePrompt) {
    createIllustration(conversation, imagePrompt);
    return;
  }
  if (/\b(?:create|make|generate|draw)\b/i.test(value) && /\b(?:image|picture|illustration|drawing|artwork|art)\b/i.test(value) &&
      /\b(?:as i describe|as i tell you|for me)\b/i.test(value) && !/\b(?:of|with|wearing|showing|depicting|featuring)\b/i.test(value)) {
    conversation.messages.push({
      role: "assistant",
      text: "Yes—describe the subject and details you want in the image, and I’ll create it."
    });
    conversation.updatedAt = Date.now();
    renderConversation();
    saveConversations();
    return;
  }
  if (/^(hi|hello|hey|hiya|good morning|good afternoon|good evening)[!.?,\s]*$/i.test(value)) {
    conversation.messages.push({ role: "assistant", text: "Hello! How can I help you today?" });
    conversation.updatedAt = Date.now();
    renderConversation();
    saveConversations();
    return;
  }
  renderConversation();
  saveConversations();
  await requestAnswer(conversation);
}

function applyTheme() {
  const dark = settings.theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector("#theme-icon").textContent = dark ? "☀" : "☾";
  document.querySelector("#theme-label").textContent = dark ? "Light theme" : "Dark theme";
  document.querySelector("#settings-theme").textContent = dark ? "Switch to light" : "Switch to dark";
  document.querySelector('meta[name="theme-color"]').content = dark ? "#171c1b" : "#f5f7f4";
}

function toggleTheme() {
  settings.theme = settings.theme === "dark" ? "light" : "dark";
  saveStored(SETTINGS_STORAGE_KEY, settings);
  applyTheme();
}

function renderStudents() {
  document.querySelector("#student-list").innerHTML = students.map((student, index) =>
    `<div class="student-card"><span class="student-avatar">${escapeHtml(student.name.slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.grade)}</small></span><button type="button" class="remove-student" data-student-index="${index}" aria-label="Remove ${escapeHtml(student.name)}">×</button></div>`
  ).join("");
}

function formatTimeValue(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatDateValue(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function formatDateTimeLocal(date) {
  const offsetMinutes = date.getTimezoneOffset();
  const adjusted = new Date(date.getTime() - offsetMinutes * 60 * 1000);
  return adjusted.toISOString().slice(0, 16);
}

function normalizeTimeString(value) {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(?:am|pm)?$/i);
  if (!match) return trimmed.toLowerCase();
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const lower = trimmed.toLowerCase();
  if (/[ap]m/i.test(lower)) {
    const isPm = /pm/i.test(lower);
    if (isPm && hours < 12) hours += 12;
    if (!isPm && hours === 12) hours = 0;
  }
  const safeHours = String(hours).padStart(2, "0");
  const safeMinutes = String(minutes).padStart(2, "0");
  return `${safeHours}:${safeMinutes}`;
}

function nextTimetableTime() {
  const last = timetableEntries[timetableEntries.length - 1]?.time || "18:00";
  const [hour, minute] = last.split(":").map(Number);
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  next.setMinutes(next.getMinutes() + 60);
  return `${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`;
}

function addTimetableRow() {
  const nextTime = nextTimetableTime();
  const row = { time: nextTime };
  TIMETABLE_DAYS.forEach(day => { row[day] = ""; });
  timetableEntries.push(row);
  saveStored(TIMETABLE_STORAGE_KEY, timetableEntries);
  renderTimetable();
}

function renderTimetable() {
  const grid = document.querySelector("#timetable-grid");
  if (!grid) return;
  const heading = [`<div class="timetable-header-cell">Time</div>`].concat(TIMETABLE_DAYS.map(day => `<div class="timetable-header-cell">${day}</div>`)).join("");
  const rows = timetableEntries.map(row => {
    const cells = TIMETABLE_DAYS.map(day => `
      <textarea
        class="timetable-cell"
        rows="1"
        data-time="${row.time}"
        data-day="${day}"
        aria-label="${day} at ${row.time}"
        placeholder="Write a subject"
      >${escapeHtml(row[day] || "")}</textarea>
    `).join("");
    return `<div class="timetable-row"><textarea class="timetable-time" rows="1" data-time-field="${row.time}" aria-label="Time for row ${row.time}" data-row-time="${row.time}">${escapeHtml(row.time)}</textarea>${cells}</div>`;
  }).join("");
  grid.innerHTML = `<div class="timetable-header">${heading}</div>${rows}`;
  grid.querySelectorAll(".timetable-cell").forEach(resizeTimetableCell);
  grid.querySelectorAll(".timetable-time").forEach(resizeTimetableCell);
}

function resizeTimetableCell(cell) {
  cell.style.height = "auto";
  cell.style.height = `${Math.max(60, cell.scrollHeight)}px`;
}

function hideSplashScreen() {
  const splash = document.querySelector("#robo-splash-screen");
  if (!splash) return;
  splash.classList.add("hidden");
}

function updateClock() {
  const clock = document.querySelector("#robo-clock");
  if (!clock) return;
  const now = new Date();
  clock.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  checkScheduleAnnouncement(now);
  checkAlarms();
  updateTimerDisplay();
}

function showToast(message) {
  if (!message) return;
  const toast = document.createElement("div");
  toast.className = "robo-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

function getDisplayName() {
  if (!authState.signedIn) return "Guest";
  return authState.displayName?.trim() || (authState.email ? authState.email.split("@")[0] : "ROBO learner");
}

function updateAuthUi() {
  const profileName = document.querySelector(".profile-name");
  const profileGlyph = document.querySelector(".profile-button > span:first-child");
  const sidebarSignin = document.querySelector("#google-signin");
  const signoutButton = document.querySelector("#signin-signout");

  if (profileName && profileGlyph) {
    if (authState.signedIn) {
      const displayName = getDisplayName();
      profileName.textContent = displayName;
      profileGlyph.textContent = displayName.slice(0, 1).toUpperCase();
    } else {
      profileName.textContent = "Guest";
      profileGlyph.textContent = "G";
    }
  }

  if (sidebarSignin) {
    if (authState.signedIn) {
      sidebarSignin.innerHTML = '<span class="google-g" aria-hidden="true">✓</span><span><strong>Signed in</strong><small></small></span><span class="signin-arrow" aria-hidden="true">→</span>';
      sidebarSignin.querySelector("small").textContent = `${authState.provider || "ROBO"} account`;
    } else {
      sidebarSignin.innerHTML = '<span class="google-g" aria-hidden="true">G</span><span><strong>Sign in</strong><small>Secure sign-in options</small></span><span class="signin-arrow" aria-hidden="true">↗</span>';
    }
  }

  if (signoutButton) signoutButton.hidden = !authState.signedIn;
}

function signInWithProvider(profile) {
  authState = profile;
  updateAuthUi();
  showToast(`Signed in as ${profile.displayName || profile.email}.`);
}

async function signOutUser() {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw new Error("ROBO could not end the sign-in session.");
  } catch (error) {
    console.error("Unable to sign out of ROBO.", error);
    showToast(error.message || "Unable to sign out. Please try again.");
    return;
  }
  authState = { signedIn: false, provider: "Guest", displayName: "Guest", email: "" };
  updateAuthUi();
  showToast("Signed out of ROBO.");
}

function getAlarmAudioContext() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!alarmAudioContext) alarmAudioContext = new AudioCtor();
  return alarmAudioContext;
}

function stopAlarmTone() {
  if (alarmSoundTimeout) {
    window.clearTimeout(alarmSoundTimeout);
    alarmSoundTimeout = null;
  }
  activeAlarmOscillators.forEach(oscillator => {
    try { oscillator.stop(); } catch (error) { /* Oscillator may already have stopped. */ }
  });
  activeAlarmOscillators = [];
}

function triggerAlarmTone(soundId = settings.alarmSound) {
  try {
    const audio = getAlarmAudioContext();
    if (!audio) {
      showToast("Alarm sounds are not supported by this browser.");
      return;
    }
    stopAlarmTone();
    const sound = ALARM_SOUNDS.find(option => option.id === soundId) || ALARM_SOUNDS[0];
    const beginPlayback = () => {
      const startAt = audio.currentTime + 0.03;
      const duration = 5;
      const interval = 0.36;
      for (let offset = 0, index = 0; offset < duration; offset += interval, index += 1) {
        const noteDuration = Math.min(0.25, duration - offset);
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const noteStart = startAt + offset;
        const noteEnd = noteStart + noteDuration;
        oscillator.type = sound.wave;
        oscillator.frequency.setValueAtTime(sound.notes[index % sound.notes.length], noteStart);
        gain.gain.setValueAtTime(0.0001, noteStart);
        gain.gain.exponentialRampToValueAtTime(0.045, noteStart + Math.min(0.035, noteDuration / 3));
        gain.gain.setValueAtTime(0.045, noteEnd - Math.min(0.05, noteDuration / 3));
        gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(noteStart);
        oscillator.stop(noteEnd);
        activeAlarmOscillators.push(oscillator);
      }
      alarmSoundTimeout = window.setTimeout(stopAlarmTone, duration * 1000);
    };
    const resumed = audio.state === "suspended" ? audio.resume() : Promise.resolve();
    resumed.then(beginPlayback).catch(error => {
      console.warn("Unable to play ROBO alarm tone.", error);
      showToast("The alarm sound could not be played. Check your browser audio settings.");
    });
  } catch (error) {
    console.warn("Unable to play ROBO alarm tone.", error);
    showToast("The alarm sound could not be played. Check your browser audio settings.");
  }
}

function renderAlarmSoundOptions() {
  const container = document.querySelector("#alarm-sound-options");
  if (!container) return;
  container.innerHTML = ALARM_SOUNDS.map((sound, index) => `
    <button type="button" class="alarm-sound-option" data-alarm-sound="${sound.id}" aria-pressed="${settings.alarmSound === sound.id}">
      <span class="alarm-sound-number">${String(index + 1).padStart(2, "0")}</span>
      <span>${sound.name}</span>
      <span class="alarm-sound-preview" aria-hidden="true">▶</span>
    </button>
  `).join("");
}

function selectAlarmSound(soundId) {
  const sound = ALARM_SOUNDS.find(option => option.id === soundId);
  if (!sound) return;
  settings.alarmSound = sound.id;
  saveStored(SETTINGS_STORAGE_KEY, settings);
  renderAlarmSoundOptions();
  document.querySelector("#alarm-sound-status").textContent = `Selected ${sound.name}. Playing five-second preview.`;
  triggerAlarmTone(sound.id);
}

function renderAlarmList() {
  const list = document.querySelector("#alarm-list");
  if (!list) return;
  if (!alarmEntries.length) {
    list.innerHTML = `<div class="empty-item">No alarms set yet.</div>`;
    return;
  }
  list.innerHTML = alarmEntries.map(alarm => `
    <div class="alarm-item ${alarm.ringing ? "ringing" : ""}" data-alarm-id="${alarm.id}">
      <div>
        <strong>${escapeHtml(alarm.label || "Alarm")}</strong>
        <small>${escapeHtml(new Date(alarm.when).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</small>
      </div>
      <button type="button" class="remove-alarm" data-alarm-id="${alarm.id}" aria-label="Remove ${escapeHtml(alarm.label || "Alarm")}">×</button>
    </div>
  `).join("");
}

function addAlarm(whenValue, labelValue) {
  if (!whenValue) return;
  try {
    const audio = getAlarmAudioContext();
    if (audio?.state === "suspended") audio.resume().catch(error => console.warn("Unable to prepare ROBO alarm audio.", error));
  } catch (error) {
    console.warn("Unable to prepare ROBO alarm audio.", error);
  }
  const safeLabel = labelValue.trim() || "Morning review";
  const nextAlarm = {
    id: `alarm-${Date.now()}`,
    when: whenValue,
    label: safeLabel,
    ringing: false
  };
  alarmEntries.push(nextAlarm);
  saveStored(ALARM_STORAGE_KEY, alarmEntries);
  renderAlarmList();
}

function checkAlarms() {
  const now = new Date();
  let triggeredAny = false;
  alarmEntries.forEach(alarm => {
    const target = new Date(alarm.when);
    if (!Number.isNaN(target.getTime()) && target <= now && !alarm.ringing) {
      alarm.ringing = true;
      triggeredAny = true;
      showToast(`Alarm: ${alarm.label || "ROBO reminder"}`);
      triggerAlarmTone();
    }
  });
  if (triggeredAny) {
    saveStored(ALARM_STORAGE_KEY, alarmEntries);
    renderAlarmList();
  }
}

function formatStopwatchDisplay(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function updateStopwatchDisplay() {
  const display = document.querySelector("#stopwatch-display");
  if (!display) return;
  display.textContent = formatStopwatchDisplay(stopwatchElapsedMs);
}

function setStopwatch(newMs) {
  stopwatchElapsedMs = newMs;
  updateStopwatchDisplay();
}

function startStopwatch() {
  if (stopwatchHandle) return;
  stopwatchStart = Date.now() - stopwatchElapsedMs;
  stopwatchHandle = window.setInterval(() => {
    stopwatchElapsedMs = Date.now() - stopwatchStart;
    updateStopwatchDisplay();
  }, 50);
}

function pauseStopwatch() {
  if (!stopwatchHandle) return;
  window.clearInterval(stopwatchHandle);
  stopwatchHandle = null;
  stopwatchStart = null;
}

function resetStopwatch() {
  pauseStopwatch();
  setStopwatch(0);
}

function updateTimerDisplay() {
  const timerDisplay = document.querySelector("#timer-display");
  if (!timerDisplay) return;
  const totalSeconds = Math.max(0, Math.ceil(timerRemainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  timerDisplay.textContent = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function readTimerInputSeconds() {
  const hoursInput = document.querySelector("#timer-hours");
  const minutesInput = document.querySelector("#timer-minutes");
  const secondsInput = document.querySelector("#timer-seconds");
  const hours = Math.max(0, Math.min(5, Number(hoursInput.value) || 0));
  const minutes = Math.max(0, Math.min(59, Number(minutesInput.value) || 0));
  const seconds = Math.max(0, Math.min(59, Number(secondsInput.value) || 0));
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  if (totalSeconds > MAX_TIMER_SECONDS) {
    hoursInput.value = "5";
    minutesInput.value = "0";
    secondsInput.value = "0";
    document.querySelector("#timer-limit-note").textContent = "Maximum timer duration is 5 hours.";
    return MAX_TIMER_SECONDS;
  }
  hoursInput.value = String(hours);
  minutesInput.value = String(minutes);
  secondsInput.value = String(seconds);
  document.querySelector("#timer-limit-note").textContent = "Set up to 5 hours.";
  return totalSeconds;
}

function updateTimerFromInputs() {
  if (timerRunning) return;
  timerRemainingMs = readTimerInputSeconds() * 1000;
  updateTimerDisplay();
}

function stopTimerLoop() {
  if (timerHandle) {
    window.clearInterval(timerHandle);
    timerHandle = null;
  }
  timerRunning = false;
}

function startTimer() {
  if (!timerRemainingMs) timerRemainingMs = readTimerInputSeconds() * 1000;
  if (timerRemainingMs <= 0 || timerRunning) return;
  try {
    const audio = getAlarmAudioContext();
    if (audio?.state === "suspended") audio.resume().catch(error => console.warn("Unable to prepare ROBO alarm audio.", error));
  } catch (error) {
    console.warn("Unable to prepare ROBO alarm audio.", error);
  }
  timerRunning = true;
  timerHandle = window.setInterval(() => {
    timerRemainingMs = Math.max(0, timerRemainingMs - 1000);
    updateTimerDisplay();
    if (timerRemainingMs <= 0) {
      stopTimerLoop();
      showToast("Timer complete. Time to move on.");
      triggerAlarmTone();
    }
  }, 1000);
}

function pauseTimer() {
  stopTimerLoop();
}

function resetTimer() {
  stopTimerLoop();
  timerRemainingMs = readTimerInputSeconds() * 1000;
  updateTimerDisplay();
}

function renderCalendar() {
  const grid = document.querySelector("#calendar-grid");
  const monthSelect = document.querySelector("#calendar-month-select");
  const yearSelect = document.querySelector("#calendar-year-select");
  if (!grid || !monthSelect || !yearSelect) return;

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  monthSelect.innerHTML = monthNames.map((month, index) => `<option value="${index}" ${index === selectedCalendarMonth ? "selected" : ""}>${month}</option>`).join("");
  const years = Array.from({ length: 11 }, (_, offset) => new Date().getFullYear() - 5 + offset);
  yearSelect.innerHTML = years.map(year => `<option value="${year}" ${year === selectedCalendarYear ? "selected" : ""}>${year}</option>`).join("");

  const monthStart = new Date(selectedCalendarYear, selectedCalendarMonth, 1);
  const monthEnd = new Date(selectedCalendarYear, selectedCalendarMonth + 1, 0);
  const firstDayIndex = monthStart.getDay();
  const totalDays = monthEnd.getDate();
  const cells = [];

  for (let blank = 0; blank < firstDayIndex; blank += 1) {
    const previousMonthDay = new Date(selectedCalendarYear, selectedCalendarMonth, blank - firstDayIndex + 1);
    cells.push(`<button type="button" class="calendar-day muted" data-date="${formatDateValue(previousMonthDay)}" disabled>${previousMonthDay.getDate()}</button>`);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const date = new Date(selectedCalendarYear, selectedCalendarMonth, day);
    const iso = formatDateValue(date);
    const selected = selectedDayDate === iso ? "selected" : "";
    const noteClass = calendarNotes[iso] ? "has-note" : "";
    cells.push(`<button type="button" class="calendar-day ${selected} ${noteClass}" data-date="${iso}" aria-label="Open planner for ${date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}"><strong>${day}</strong>${calendarNotes[iso] ? '<span class="calendar-dot" aria-hidden="true"></span>' : ""}</button>`);
  }

  while (cells.length % 7 !== 0) {
    const nextDay = cells.length - (firstDayIndex + totalDays) + 1;
    const futureDate = new Date(selectedCalendarYear, selectedCalendarMonth + 1, nextDay);
    cells.push(`<button type="button" class="calendar-day muted" data-date="${formatDateValue(futureDate)}" disabled>${futureDate.getDate()}</button>`);
  }

  grid.innerHTML = cells.join("");
}

function openDayPlanner(date) {
  selectedDayDate = date;
  const label = document.querySelector("#day-note-date");
  const input = document.querySelector("#day-note-input");
  const panel = document.querySelector("#day-note-panel");
  if (!label || !input || !panel) return;
  const selected = new Date(`${date}T12:00:00`);
  label.textContent = selected.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  input.value = calendarNotes[date] || "";
  panel.hidden = false;
  renderCalendar();
}

function saveDayNote() {
  if (!selectedDayDate) return;
  const input = document.querySelector("#day-note-input");
  if (!input) return;
  calendarNotes[selectedDayDate] = input.value.trim();
  saveStored(CALENDAR_STORAGE_KEY, calendarNotes);
  renderCalendar();
  document.querySelector("#day-note-panel").hidden = true;
}

function checkScheduleAnnouncement(now) {
  const weekday = TIMETABLE_DAYS[now.getDay() === 0 ? 6 : now.getDay() - 1];
  const currentTime = normalizeTimeString(formatTimeValue(now));
  const entry = timetableEntries.find(row => {
    const rowTime = normalizeTimeString(row.time || "");
    return rowTime === currentTime && row[weekday] && row[weekday].trim();
  });
  if (!entry) return;
  const announcement = `Time for ${entry[weekday].trim()}`;
  const key = `${weekday}-${currentTime}`;
  if (lastTimetableAnnouncement !== key) {
    lastTimetableAnnouncement = key;
    showToast(announcement);
  }
}

function renderSchedule() {
  const list = document.querySelector("#schedule-list");
  const empty = document.querySelector("#schedule-empty");
  const sorted = [...scheduleItems].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  list.innerHTML = sorted.map(item => `
    <article class="schedule-item" data-id="${escapeHtml(item.id)}">
      <div class="schedule-badge" aria-hidden="true">${escapeHtml(item.title.slice(0, 1).toUpperCase())}</div>
      <div class="schedule-copy">
        <div class="schedule-title-row">
          <strong>${escapeHtml(item.title)}</strong>
          <button type="button" class="remove-schedule" data-schedule-id="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.title)}">×</button>
        </div>
        <div class="schedule-meta">
          <span>${escapeHtml(new Date(`${item.date}T${item.time}`).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }))}</span>
        </div>
        <p>${escapeHtml(item.notes || "No notes added.")}</p>
      </div>
    </article>
  `).join("");
  empty.hidden = sorted.length > 0;
  list.hidden = sorted.length === 0;
  saveStored(SCHEDULE_STORAGE_KEY, scheduleItems);
  renderTimetable();
  renderCalendar();
  renderAlarmList();
}

categoryList.addEventListener("click", event => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  activeCategory = button.dataset.category;
  renderCategories();
  renderCards();
});
searchInput.addEventListener("input", renderCards);
cardGrid.addEventListener("click", event => {
  const card = event.target.closest("[data-id]");
  if (card) renderScene(explorations.find(item => item.id === card.dataset.id));
});
document.querySelector("#close-dialog").addEventListener("click", () => exploreDialog.close());
document.querySelector("#scene-pins").addEventListener("click", event => {
  const pin = event.target.closest("[data-step]");
  if (pin) setStep(Number(pin.dataset.step));
});
document.querySelector("#step-dots").addEventListener("click", event => {
  const dot = event.target.closest("[data-step]");
  if (dot) setStep(Number(dot.dataset.step));
});
document.querySelector("#previous-step").addEventListener("click", () => setStep(activeStep - 1));
document.querySelector("#next-step").addEventListener("click", () => setStep(activeStep + 1));
document.querySelector("#next-lesson").addEventListener("click", () => setStep(activeStep + 1));
document.querySelector("#rotate-scene").addEventListener("click", () => {
  sceneRotation.y += 45;
  updateSceneRotation();
});
document.querySelector("#flow-scene").addEventListener("click", event => {
  animationPaused = !animationPaused;
  document.querySelector("#scene-frame").classList.toggle("paused", animationPaused);
  event.currentTarget.textContent = animationPaused ? "▶" : "Ⅱ";
  event.currentTarget.setAttribute("aria-label", animationPaused ? "Play scene animation" : "Pause scene animation");
});
document.querySelector("#workspace-chat-form").addEventListener("submit", event => {
  event.preventDefault();
  sendMessage(document.querySelector("#workspace-chat-input").value);
});
document.querySelector("#workspace-chat-input").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    document.querySelector("#workspace-chat-form").requestSubmit();
  }
});
document.querySelector(".starter-prompts").addEventListener("click", event => {
  const suggestion = event.target.closest("[data-prompt]");
  if (suggestion) sendMessage(suggestion.dataset.prompt);
});
document.querySelector(".dashboard-actions").addEventListener("click", event => {
  const action = event.target.closest("[data-view]");
  if (action) {
    setView(action.dataset.view);
    return;
  }
  const prompt = event.target.closest("[data-prompt]");
  if (prompt) sendMessage(prompt.dataset.prompt);
});
document.querySelector("#new-chat").addEventListener("click", createChat);
document.querySelector("#robo-prompt").addEventListener("click", () => renderScene(explorations.find(item => item.featured)));
document.querySelector("#chat-history").addEventListener("click", event => {
  const button = event.target.closest("[data-chat-id]");
  if (!button) return;
  currentChatId = button.dataset.chatId;
  setView("chat");
  renderConversation();
  renderHistory();
});
document.querySelector("#history-search").addEventListener("input", renderHistory);
document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
document.querySelector("#theme-toggle").addEventListener("click", toggleTheme);
document.querySelector("#settings-theme").addEventListener("click", toggleTheme);
document.querySelector("#alarm-sound-options").addEventListener("click", event => {
  const option = event.target.closest("[data-alarm-sound]");
  if (option) selectAlarmSound(option.dataset.alarmSound);
});
document.querySelector("#clear-history").addEventListener("click", () => {
  if (!conversations.length || !window.confirm("Clear all saved ROBO chats from this browser?")) return;
  conversations = [];
  currentChatId = null;
  saveConversations();
  renderConversation();
});
document.querySelectorAll('input[name="response-style"]').forEach(input => {
  input.checked = input.value === settings.responseStyle;
  input.addEventListener("change", () => {
    settings.responseStyle = input.value;
    saveStored(SETTINGS_STORAGE_KEY, settings);
  });
});
document.querySelector("#student-form").addEventListener("submit", event => {
  event.preventDefault();
  const name = document.querySelector("#student-name").value.trim();
  if (!name) return;
students.push({ name, grade: "Learner" });
  saveStored(STUDENTS_STORAGE_KEY, students);
  document.querySelector("#student-form").reset();
  renderStudents();
});
document.querySelector("#student-list").addEventListener("click", event => {
  const button = event.target.closest("[data-student-index]");
  if (!button) return;
  students.splice(Number(button.dataset.studentIndex), 1);
  saveStored(STUDENTS_STORAGE_KEY, students);
  renderStudents();
});

document.querySelectorAll(".schedule-tab").forEach(button => {
  button.addEventListener("click", () => {
    const selected = button.dataset.scheduleTab;
    document.querySelectorAll(".schedule-tab").forEach(tab => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".schedule-module").forEach(panel => {
      const active = panel.id === `schedule-${selected}-panel`;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    const clockShell = document.querySelector("#clock-shell");
    const clockCard = document.querySelector("#robo-clock-card");
    if (clockShell && clockCard) {
      const shouldExpand = selected === "clock";
      clockShell.classList.toggle("expanded", shouldExpand);
      clockCard.setAttribute("aria-expanded", String(shouldExpand));
    }
  });
});

document.querySelector("#robo-clock-card").addEventListener("click", () => {
  const clockShell = document.querySelector("#clock-shell");
  const clockCard = document.querySelector("#robo-clock-card");
  if (!clockShell || !clockCard) return;
  const expanded = !clockShell.classList.contains("expanded");
  clockShell.classList.toggle("expanded", expanded);
  clockCard.setAttribute("aria-expanded", String(expanded));
});

document.querySelectorAll(".clock-mode").forEach(button => {
  button.addEventListener("click", () => {
    activeClockMode = button.dataset.clockMode;
    document.querySelectorAll(".clock-mode").forEach(modeButton => {
      const active = modeButton === button;
      modeButton.classList.toggle("active", active);
      modeButton.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".clock-section").forEach(section => {
      const active = section.id === `clock-${activeClockMode}-panel`;
      section.hidden = !active;
      section.classList.toggle("active", active);
    });
  });
});

document.querySelector("#timetable-grid").addEventListener("input", event => {
  const cell = event.target.closest(".timetable-cell");
  const timeInput = event.target.closest(".timetable-time");
  if (cell) {
    resizeTimetableCell(cell);
    const row = timetableEntries.find(item => item.time === cell.dataset.time);
    if (!row) return;
    row[cell.dataset.day] = cell.value;
    saveStored(TIMETABLE_STORAGE_KEY, timetableEntries);
    return;
  }
  if (timeInput) {
    resizeTimetableCell(timeInput);
    const row = timetableEntries.find(item => item.time === timeInput.dataset.rowTime);
    if (!row) return;
    const newTime = normalizeTimeString(timeInput.value || "");
    row.time = newTime || row.time;
    if (!newTime) return;
    timeInput.dataset.rowTime = row.time;
    timeInput.setAttribute("aria-label", `Time for row ${row.time}`);
    saveStored(TIMETABLE_STORAGE_KEY, timetableEntries);
  }
});

document.querySelector("#alarm-form").addEventListener("submit", event => {
  event.preventDefault();
  const whenInput = document.querySelector("#alarm-datetime");
  const labelInput = document.querySelector("#alarm-label");
  addAlarm(whenInput.value, labelInput.value);
  event.currentTarget.reset();
  labelInput.value = "Morning review";
});

document.querySelector("#alarm-list").addEventListener("click", event => {
  const removeButton = event.target.closest("[data-alarm-id]");
  if (!removeButton) return;
  const id = removeButton.dataset.alarmId;
  alarmEntries = alarmEntries.filter(alarm => alarm.id !== id);
  saveStored(ALARM_STORAGE_KEY, alarmEntries);
  renderAlarmList();
});

document.querySelector("#calendar-grid").addEventListener("click", event => {
  const day = event.target.closest("[data-date]");
  if (!day) return;
  openDayPlanner(day.dataset.date);
});
document.querySelector("#calendar-month-select").addEventListener("change", event => {
  selectedCalendarMonth = Number(event.target.value);
  renderCalendar();
});
document.querySelector("#calendar-year-select").addEventListener("change", event => {
  selectedCalendarYear = Number(event.target.value);
  renderCalendar();
});
document.querySelector("#save-day-note").addEventListener("click", saveDayNote);

document.querySelector("#start-stopwatch").addEventListener("click", startStopwatch);
document.querySelector("#pause-stopwatch").addEventListener("click", pauseStopwatch);
document.querySelector("#reset-stopwatch").addEventListener("click", resetStopwatch);
document.querySelector("#start-timer").addEventListener("click", startTimer);
document.querySelector("#pause-timer").addEventListener("click", pauseTimer);
document.querySelector("#reset-timer").addEventListener("click", resetTimer);
document.querySelectorAll("#timer-hours, #timer-minutes, #timer-seconds").forEach(input => {
  input.addEventListener("input", updateTimerFromInputs);
});

document.querySelector("#add-schedule").addEventListener("click", () => {
  const formShell = document.querySelector("#schedule-form-shell");
  formShell.hidden = !formShell.hidden;
  if (!formShell.hidden) document.querySelector("#schedule-title").focus();
});
document.querySelector("#add-timetable-row").addEventListener("click", addTimetableRow);
document.querySelector("#cancel-schedule").addEventListener("click", () => {
  document.querySelector("#schedule-form").reset();
  document.querySelector("#schedule-form-shell").hidden = true;
});
document.querySelector("#schedule-form").addEventListener("submit", event => {
  event.preventDefault();
  const title = document.querySelector("#schedule-title").value.trim();
  const date = document.querySelector("#schedule-date").value;
  const time = document.querySelector("#schedule-time").value;
  const notes = document.querySelector("#schedule-notes").value.trim();
  if (!title || !date || !time) return;
  scheduleItems.push({
    id: `schedule-${Date.now()}`,
    title,
    date,
    time,
    notes
  });
  document.querySelector("#schedule-form").reset();
  document.querySelector("#schedule-form-shell").hidden = true;
  renderSchedule();
});
document.querySelector("#schedule-list").addEventListener("click", event => {
  const button = event.target.closest("[data-schedule-id]");
  if (!button) return;
  scheduleItems = scheduleItems.filter(item => item.id !== button.dataset.scheduleId);
  renderSchedule();
});
const signinDialog = document.querySelector("#signin-dialog");
function showSigninDetails() {
  if (!signinDialog) return;
  signinDialog.showModal();
}

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomOAuthValue() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function loadOAuthConfig() {
  const response = await fetch("/api/auth/config", { credentials: "same-origin" });
  if (!response.ok) throw new Error("ROBO could not load its sign-in configuration.");
  oauthConfig = await response.json();
  const providerButtons = [...document.querySelectorAll(".signin-provider")];
  providerButtons.forEach(button => {
    const config = oauthConfig.providers?.[button.dataset.provider];
    button.dataset.configured = String(Boolean(config?.configured));
    button.title = config?.configured
      ? `Continue securely with ${button.textContent.trim()}`
      : `${button.textContent.trim()} sign-in needs server OAuth configuration`;
  });
  const configured = providerButtons.some(button => button.dataset.configured === "true");
  const message = configured
    ? "You’ll authenticate directly with your provider. ROBO never receives your password."
    : "Sign-in setup needed: configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET, on the server.";
  document.querySelector("#signin-provider-status").textContent = message;
}

async function startOAuthSignIn(provider) {
  const config = oauthConfig?.providers?.[provider];
  if (!config?.configured) {
    const name = provider === "google" ? "Google" : "Microsoft";
    document.querySelector("#signin-provider-status").textContent =
      `${name} sign-in is not configured yet. The app owner must add its OAuth client ID and secret to the server environment.`;
    return;
  }
  if (!crypto.subtle) {
    showToast("Secure sign-in requires HTTPS (localhost is supported for development).");
    return;
  }
  try {
    const verifier = randomOAuthValue();
    const state = randomOAuthValue();
    const challenge = bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const redirectUri = oauthConfig.redirectUri;
    sessionStorage.setItem("robo-oauth-transaction-v1", JSON.stringify({ provider, state, verifier, redirectUri }));
    const authorization = new URL(config.authorizationEndpoint);
    const parameters = {
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: config.scope,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account"
    };
    if (provider === "microsoft") parameters.response_mode = "query";
    authorization.search = new URLSearchParams(parameters);
    window.location.assign(authorization.toString());
  } catch (error) {
    console.error("Could not start provider sign-in.", error);
    showToast(error.message || "Could not start sign-in. Please try again.");
  }
}

async function handleOAuthCallback() {
  const callbackUrl = new URL(window.location.href);
  const code = callbackUrl.searchParams.get("code");
  const state = callbackUrl.searchParams.get("state");
  const providerError = callbackUrl.searchParams.get("error");
  if (!code && !providerError) return false;
  window.history.replaceState({}, document.title, callbackUrl.pathname + callbackUrl.hash);
  const transactionText = sessionStorage.getItem("robo-oauth-transaction-v1");
  sessionStorage.removeItem("robo-oauth-transaction-v1");
  let transaction = null;
  try {
    transaction = transactionText ? JSON.parse(transactionText) : null;
  } catch (error) {
    console.error("Invalid saved sign-in transaction.", error);
  }
  if (providerError) {
    showToast("Sign-in was cancelled or declined by the provider.");
    return true;
  }
  if (!transaction || !state || state !== transaction.state || !code) {
    showToast("Sign-in could not be verified. Please try again.");
    return true;
  }
  try {
    const response = await fetch("/api/auth/exchange", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: transaction.provider,
        code,
        codeVerifier: transaction.verifier,
        redirectUri: transaction.redirectUri
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The provider could not complete sign-in.");
    signInWithProvider(result);
    if (signinDialog.open) signinDialog.close();
  } catch (error) {
    console.error("Provider sign-in could not be completed.", error);
    showToast(error.message || "Sign-in failed. Check your provider setup and try again.");
  }
  return true;
}

async function initializeAuth() {
  try {
    await loadOAuthConfig();
    if (await handleOAuthCallback()) return;
    const response = await fetch("/api/auth/session", { credentials: "same-origin" });
    if (!response.ok) throw new Error("ROBO could not restore the sign-in session.");
    const profile = await response.json();
    if (profile.signedIn) authState = profile;
    updateAuthUi();
  } catch (error) {
    console.error("Unable to initialize ROBO sign-in.", error);
    const status = document.querySelector("#signin-provider-status");
    if (status) status.textContent = error.message || "Sign-in is temporarily unavailable.";
    updateAuthUi();
  }
}

document.querySelector("#google-signin").addEventListener("click", showSigninDetails);
document.querySelector("#settings-signin").addEventListener("click", showSigninDetails);
document.querySelector("#close-signin").addEventListener("click", () => signinDialog.close());
document.querySelectorAll(".signin-provider").forEach(button => {
  button.addEventListener("click", () => startOAuthSignIn(button.dataset.provider));
});
document.querySelector("#signin-guest").addEventListener("click", async () => {
  if (authState.signedIn) await signOutUser();
  signinDialog.close();
});
document.querySelector("#signin-signout").addEventListener("click", () => {
  signOutUser();
  signinDialog.close();
});
signinDialog.addEventListener("click", event => { if (event.target === signinDialog) signinDialog.close(); });
document.querySelector("#mobile-menu").addEventListener("click", event => {
  const opened = document.querySelector("#sidebar").classList.toggle("mobile-open");
  event.currentTarget.setAttribute("aria-expanded", String(opened));
});
document.querySelector("#search-input").addEventListener("keydown", event => {
  if (event.key === "Escape") { searchInput.value = ""; renderCards(); }
});
exploreDialog.addEventListener("click", event => { if (event.target === exploreDialog) exploreDialog.close(); });
const sceneFrame = document.querySelector("#scene-frame");
sceneFrame.addEventListener("pointerdown", event => {
  if (event.target.closest("button")) return;
  sceneDrag = { x: event.clientX, y: event.clientY, rotationX: sceneRotation.x, rotationY: sceneRotation.y };
  sceneFrame.setPointerCapture(event.pointerId);
});
sceneFrame.addEventListener("pointermove", event => {
  if (!sceneDrag) return;
  sceneRotation.y = sceneDrag.rotationY + (event.clientX - sceneDrag.x) * .28;
  sceneRotation.x = Math.max(-28, Math.min(28, sceneDrag.rotationX - (event.clientY - sceneDrag.y) * .22));
  updateSceneRotation();
});
sceneFrame.addEventListener("pointerup", () => { sceneDrag = null; });
sceneFrame.addEventListener("pointercancel", () => { sceneDrag = null; });
document.addEventListener("keydown", event => {
  if (event.key === "/" && !event.target.closest("input, textarea, [contenteditable=true]") && !exploreDialog.open && !signinDialog.open) {
    event.preventDefault();
    document.querySelector("#history-search").focus();
    return;
  }
  if (!exploreDialog.open) return;
  if (event.key === "ArrowRight") setStep(activeStep + 1);
  if (event.key === "ArrowLeft") setStep(activeStep - 1);
});

selectedDayDate = formatDateValue(new Date());
renderCategories();
renderCards();
renderHistory();
renderStudents();
renderSchedule();
renderAlarmList();
renderAlarmSoundOptions();
updateStopwatchDisplay();
resetTimer();
updateClock();
updateAuthUi();
initializeAuth();
setInterval(updateClock, 1000);
setTimeout(hideSplashScreen, 1100);
applyTheme();

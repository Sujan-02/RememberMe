const STORAGE_KEY = "rememberme_occasions_v1";

const form = document.getElementById("occasionForm");
const nameInput = document.getElementById("occasionName");
const dateInput = document.getElementById("occasionDate");
const categoryInput = document.getElementById("occasionCategory");
const notesInput = document.getElementById("occasionNotes");
const repeatInput = document.getElementById("repeatYearly");
const list = document.getElementById("occasionList");
const emptyState = document.getElementById("emptyState");
const searchInput = document.getElementById("searchInput");
const filterInput = document.getElementById("filterCategory");
const toast = document.getElementById("toast");
const calendarGrid = document.getElementById("calendarGrid");
const selectedDateDetails = document.getElementById("selectedDateDetails");

let occasions = loadOccasions();
let editingId = null;
let toastTimer;
const today = new Date();
today.setHours(0, 0, 0, 0);
let calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
let selectedCalendarDate = new Date(today);

function loadOccasions() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveOccasions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(occasions));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2300);
}

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getNextDate(item) {
  const original = parseLocalDate(item.date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!item.repeat) return original;

  let next = new Date(today.getFullYear(), original.getMonth(), original.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, original.getMonth(), original.getDate());
  return next;
}

function daysUntil(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date - today) / 86400000);
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function updateStats() {
  const upcoming = occasions.filter(item => daysUntil(getNextDate(item)) >= 0 && daysUntil(getNextDate(item)) <= 30).length;
  const today = occasions.filter(item => daysUntil(getNextDate(item)) === 0).length;
  document.getElementById("totalCount").textContent = occasions.length;
  document.getElementById("upcomingCount").textContent = upcoming;
  document.getElementById("todayCount").textContent = today;
}

function dateKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function occasionsForCalendarDate(date) {
  return occasions.filter(item => {
    const savedDate = parseLocalDate(item.date);
    return item.repeat
      ? savedDate.getMonth() === date.getMonth() && savedDate.getDate() === date.getDate()
      : savedDate.getFullYear() === date.getFullYear() && savedDate.getMonth() === date.getMonth() && savedDate.getDate() === date.getDate();
  });
}

function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  document.getElementById("calendarMonth").textContent = calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  calendarGrid.innerHTML = "";

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const previousMonthDays = new Date(year, month, 0).getDate();
  const cellCount = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  for (let index = 0; index < cellCount; index += 1) {
    const dayNumber = index - firstDay + 1;
    const date = dayNumber < 1
      ? new Date(year, month - 1, previousMonthDays + dayNumber)
      : dayNumber > daysInMonth
        ? new Date(year, month + 1, dayNumber - daysInMonth)
        : new Date(year, month, dayNumber);
    const inMonth = date.getMonth() === month;
    const matches = occasionsForCalendarDate(date);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    if (!inMonth) button.classList.add("outside-month");
    if (dateKey(date) === dateKey(today)) button.classList.add("is-today");
    if (dateKey(date) === dateKey(selectedCalendarDate)) button.classList.add("is-selected");
    if (matches.length) button.classList.add("has-occasion");
    button.setAttribute("aria-label", `${date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}${matches.length ? `, ${matches.length} occasion${matches.length === 1 ? "" : "s"}` : ""}`);

    const number = document.createElement("span");
    number.className = "calendar-number";
    number.textContent = date.getDate();
    button.append(number);
    if (matches.length) {
      const marker = document.createElement("span");
      marker.className = "calendar-marker";
      marker.setAttribute("aria-hidden", "true");
      button.append(marker);
    }
    button.addEventListener("click", () => {
      selectedCalendarDate = date;
      renderCalendar();
    });
    calendarGrid.append(button);
  }

  renderSelectedDate();
}

function renderSelectedDate() {
  const matches = occasionsForCalendarDate(selectedCalendarDate);
  selectedDateDetails.innerHTML = "";
  const heading = document.createElement("strong");
  heading.className = "selected-date-title";
  heading.textContent = selectedCalendarDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  selectedDateDetails.append(heading);

  if (!matches.length) {
    const note = document.createElement("span");
    note.className = "selected-date-empty";
    note.textContent = "Nothing planned for this day";
    selectedDateDetails.append(note);
    return;
  }

  matches.forEach(item => {
    const detail = document.createElement("span");
    detail.className = "selected-date-occasion";
    detail.textContent = `${categoryEmoji(item.category)} ${item.name}`;
    selectedDateDetails.append(detail);
  });
}

function renderOccasions() {
  const search = searchInput.value.trim().toLowerCase();
  const category = filterInput.value;

  const visible = occasions
    .map(item => ({ ...item, nextDate: getNextDate(item) }))
    .filter(item => (category === "All" || item.category === category))
    .filter(item => `${item.name} ${item.category} ${item.notes}`.toLowerCase().includes(search))
    .sort((a, b) => a.nextDate - b.nextDate);

  list.innerHTML = "";
  emptyState.hidden = visible.length > 0;

  visible.forEach(item => {
    const days = daysUntil(item.nextDate);
    const countdown = days === 0 ? "Today 🎉" : days === 1 ? "Tomorrow!" : `${days} days to go`;
    const card = document.createElement("article");
    card.className = "occasion-card";

    const dateTile = document.createElement("div");
    dateTile.className = "date-tile";
    const month = document.createElement("span");
    month.textContent = item.nextDate.toLocaleDateString(undefined, { month: "short" });
    const day = document.createElement("strong");
    day.textContent = item.nextDate.getDate();
    dateTile.append(month, day);

    const info = document.createElement("div");
    info.className = "occasion-info";
    const title = document.createElement("h3");
    title.textContent = `${categoryEmoji(item.category)} ${item.name}`;
    const detail = document.createElement("p");
    detail.textContent = `${item.category} · ${formatDate(item.nextDate)}${item.notes ? " · " + item.notes : ""}`;
    const count = document.createElement("div");
    count.className = "countdown";
    count.textContent = countdown;
    info.append(title, detail, count);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const edit = document.createElement("button");
    edit.className = "icon-btn";
    edit.type = "button";
    edit.title = "Edit occasion";
    edit.setAttribute("aria-label", `Edit ${item.name}`);
    edit.textContent = "✏️";
    edit.addEventListener("click", () => startEdit(item.id));
    const remove = document.createElement("button");
    remove.className = "icon-btn";
    remove.type = "button";
    remove.title = "Delete occasion";
    remove.setAttribute("aria-label", `Delete ${item.name}`);
    remove.textContent = "🗑️";
    remove.addEventListener("click", () => deleteOccasion(item.id));
    actions.append(edit, remove);

    card.append(dateTile, info, actions);
    list.append(card);
  });

  updateStats();
  renderCalendar();
}

function categoryEmoji(category) {
  return ({ Birthday: "🎂", Anniversary: "💐", "College event": "🎓", Festival: "🪔", Meeting: "📌", Personal: "💖", Other: "✨" })[category] || "✨";
}

form.addEventListener("submit", event => {
  event.preventDefault();
  const occasion = {
    id: editingId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    name: nameInput.value.trim(),
    date: dateInput.value,
    category: categoryInput.value,
    notes: notesInput.value.trim(),
    repeat: repeatInput.checked
  };

  if (!occasion.name || !occasion.date) {
    showToast("Please enter an occasion name and date.");
    return;
  }

  if (editingId) {
    occasions = occasions.map(item => item.id === editingId ? occasion : item);
    showToast("Occasion updated successfully!");
  } else {
    occasions.push(occasion);
    showToast("Your occasion has been saved!");
  }

  saveOccasions();
  resetForm();
  renderOccasions();
});

function startEdit(id) {
  const item = occasions.find(occasion => occasion.id === id);
  if (!item) return;
  editingId = id;
  nameInput.value = item.name;
  dateInput.value = item.date;
  categoryInput.value = item.category;
  notesInput.value = item.notes || "";
  repeatInput.checked = Boolean(item.repeat);
  document.getElementById("formHeading").textContent = "Edit occasion";
  document.getElementById("saveBtn").textContent = "Save changes";
  document.getElementById("cancelEditBtn").hidden = false;
  document.querySelector(".form-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function deleteOccasion(id) {
  const item = occasions.find(occasion => occasion.id === id);
  if (!item || !confirm(`Delete "${item.name}"?`)) return;
  occasions = occasions.filter(occasion => occasion.id !== id);
  saveOccasions();
  renderOccasions();
  showToast("Occasion deleted.");
  if (editingId === id) resetForm();
}

function resetForm() {
  form.reset();
  editingId = null;
  repeatInput.checked = true;
  document.getElementById("formHeading").textContent = "Add an occasion";
  document.getElementById("saveBtn").textContent = "＋ Save occasion";
  document.getElementById("cancelEditBtn").hidden = true;
}

document.getElementById("cancelEditBtn").addEventListener("click", resetForm);
searchInput.addEventListener("input", renderOccasions);
filterInput.addEventListener("change", renderOccasions);
document.getElementById("prevMonthBtn").addEventListener("click", () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
  renderCalendar();
});
document.getElementById("nextMonthBtn").addEventListener("click", () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
  renderCalendar();
});

document.getElementById("todayDate").textContent = today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

// Show a gentle reminder when the app is opened.
function checkTodaysReminders() {
  const todays = occasions.filter(item => daysUntil(getNextDate(item)) === 0);
  if (todays.length) {
    showToast(`🎉 Today: ${todays.map(item => item.name).join(", ")}`);
  }
}

renderOccasions();
checkTodaysReminders();

// Progressive Web App install prompt (supported browsers only).
let installPrompt = null;
const installBtn = document.getElementById("installBtn");

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  installBtn.hidden = false;
});

installBtn.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installBtn.hidden = true;
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(error => {
      console.error("Service worker registration failed:", error);
    });
  });
}

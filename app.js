// 操作层：DOM 渲染、拖拽、播放与事件；计算找 Calc，持久化找 Store
const instruments = [
  { name: "大锣", token: "仓", freq: 180 },
  { name: "鼓", token: "冬", freq: 120 },
  { name: "钹", token: "才", freq: 360 },
  { name: "小锣", token: "台", freq: 520 }
];

const state = Store.load();

let timer = null;
let playIndex = 0;
let playlist = Calc.buildPlaylist(state.draft.seq);
let audioContext = null;
let dragMeasure = null;

const grid = document.querySelector("#grid");
const savedList = document.querySelector("#savedList");
const structure = document.querySelector("#structure");
const notesList = document.querySelector("#notesList");
const seqList = document.querySelector("#seqList");
const seqStatus = document.querySelector("#seqStatus");
const saveHint = document.querySelector("#saveHint");
const pieceName = document.querySelector("#pieceName");
const bpmInput = document.querySelector("#bpmInput");
const loopSelect = document.querySelector("#loopSelect");
const noteInput = document.querySelector("#noteInput");
const confirmSeqBtn = document.querySelector("#confirmSeq");

function currentStatus() {
  return Calc.draftStatus(state.draft, state.bpm, state.pattern);
}

// 序列有改动：重建播放清单并回到（跟随小节的）循环起点
function rebuildPlaylist() {
  playlist = Calc.buildPlaylist(state.draft.seq);
  playIndex = Calc.wrapIndex(playlist, state.loop);
}

function syncFields() {
  pieceName.value = state.pieceName;
  bpmInput.value = state.bpm;
}

function renderLoopSelect() {
  const current = state.loop;
  loopSelect.innerHTML = `<option value="">全段</option>` + state.draft.seq.map((entry, position) =>
    `<option value="${entry.measure}">第${entry.measure + 1}小节（走台第${position + 1}位${entry.repeat === 2 ? "·2遍" : ""}）</option>`
  ).join("");
  loopSelect.value = current === null ? "" : String(current);
}

function renderSequence() {
  const status = currentStatus();
  seqList.innerHTML = state.draft.seq.map((entry, position) => {
    const count = Calc.countCommands(state.pattern, entry.measure);
    const isStart = state.loop === entry.measure;
    return `
      <div class="seq-card${isStart ? " is-start" : ""}" draggable="true" data-measure="${entry.measure}">
        <span class="seq-grip" title="拖动调整走台顺序">⠿</span>
        <span class="seq-pos">走台${position + 1}</span>
        <strong>第${entry.measure + 1}小节</strong>
        <span class="seq-count">${count}个口令</span>
        ${isStart ? '<span class="seq-flag">循环起点</span>' : ""}
        <button class="repeat-btn${entry.repeat === 2 ? " doubled" : ""}" type="button"
                data-repeat="${entry.measure}" title="切换本小节练习遍数">
          ×${entry.repeat}
        </button>
      </div>`;
  }).join("");
  seqStatus.className = `seq-status status-${status}`;
  const message = {
    unconfirmed: "工作稿 · 尚未确认：可直接拖序试排，但保存方案时不会带走序列。",
    stale: "已过期：确认后速度或口令又改过，请重新确认。",
    confirmed: "已确认：保存方案时将按此走台序列保存。"
  }[status];
  seqStatus.textContent = message;
  confirmSeqBtn.disabled = status === "confirmed";
}

function renderGrid() {
  const head = ['<div class="label-cell"></div>'];
  playlist.forEach((item) => {
    head.push(
      `<div class="beat-group" data-pos="${item.position}" data-pass="${item.pass}">` +
      `第${item.measure + 1}小节${playlist.some((other) => other.measure === item.measure && other.pass !== item.pass) ? `·第${item.pass + 1}遍` : ""}` +
      `</div>`
    );
  });

  const beats = ['<div class="label-cell">乐器</div>'];
  playlist.forEach((item) => {
    beats.push(
      `<div class="beat-cell" data-pos="${item.position}" data-pass="${item.pass}" data-beat="${item.beat}">${item.beat + 1}</div>`
    );
  });

  const rows = instruments.flatMap((instrument, rowIndex) => {
    const row = [`<div class="label-cell">${instrument.name}</div>`];
    playlist.forEach((item) => {
      const step = item.measure * Calc.BEATS_PER_MEASURE + item.beat;
      const value = state.pattern[rowIndex][step];
      row.push(
        `<button class="cell ${value ? "filled" : ""}" type="button" data-row="${rowIndex}" data-step="${step}"` +
        ` data-pos="${item.position}" data-pass="${item.pass}" data-beat="${item.beat}">${value}</button>`
      );
    });
    return row;
  });

  grid.style.gridTemplateColumns = `76px repeat(${playlist.length}, minmax(40px, 1fr))`;
  grid.style.minWidth = `${76 + playlist.length * 40}px`;
  grid.innerHTML = [...head, ...beats, ...rows].join("");
}

function renderStructure() {
  let totalCommands = 0;
  const rows = state.draft.seq.map((entry, position) => {
    const count = Calc.countCommands(state.pattern, entry.measure);
    totalCommands += count * entry.repeat;
    return `
      <div class="structure-row">
        <span>走台${position + 1} · 第${entry.measure + 1}小节${entry.repeat === 2 ? " ×2" : ""}</span>
        <strong>${count}个口令${entry.repeat === 2 ? `（共${count * 2}）` : ""}</strong>
      </div>`;
  }).join("");
  const passes = state.draft.seq.reduce((sum, entry) => sum + entry.repeat, 0);
  structure.innerHTML = rows + `
    <div class="structure-total"><span>合计 ${passes} 遍次</span><strong>${totalCommands}个口令</strong></div>`;
}

function renderSidebars() {
  renderStructure();
  notesList.innerHTML = state.notes.length ? state.notes.map((note) => `
    <article class="note"><p>${note}</p></article>
  `).join("") : "<p>暂无批注。</p>";

  savedList.innerHTML = state.saved.length ? state.saved.map((item) => `
    <button class="saved-item" type="button" data-load="${item.id}">
      <strong>${item.name}</strong><br>
      <span>${item.bpm}BPM · ${item.notes.length}条批注${item.sequence ? " · 含走台序列" : " · 默认顺序"}</span>
    </button>
  `).join("") : "<p>还没有保存方案。</p>";
}

function renderSaveHint() {
  const status = currentStatus();
  saveHint.textContent = {
    unconfirmed: "保存方案不含序列，确认后才会随方案保存。",
    stale: "序列已过期，本次保存仍不含序列，请先重新确认。",
    confirmed: ""
  }[status];
}

function render() {
  syncFields();
  renderLoopSelect();
  renderSequence();
  renderGrid();
  renderSidebars();
  renderSaveHint();
}

function playSound(instrument) {
  audioContext ||= new AudioContext();
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.frequency.value = instrument.freq;
  osc.type = instrument.name === "鼓" ? "sine" : "square";
  gain.gain.setValueAtTime(0.08, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.08);
  osc.connect(gain).connect(audioContext.destination);
  osc.start();
  osc.stop(audioContext.currentTime + 0.09);
}

function clearHighlight() {
  document.querySelectorAll(".playing").forEach((el) => el.classList.remove("playing"));
}

function highlight(item) {
  clearHighlight();
  const selector = `[data-pos="${item.position}"][data-pass="${item.pass}"][data-beat="${item.beat}"]`;
  document.querySelectorAll(selector).forEach((el) => el.classList.add("playing"));
  const card = seqList.querySelector(`[data-measure="${item.measure}"]`);
  if (card) card.classList.add("playing");
}

function tick() {
  if (playIndex < 0 || playIndex >= playlist.length) playIndex = Calc.wrapIndex(playlist, state.loop);
  const item = playlist[playIndex];
  const step = item.measure * Calc.BEATS_PER_MEASURE + item.beat;
  highlight(item);
  instruments.forEach((instrument, rowIndex) => {
    if (state.pattern[rowIndex][step]) playSound(instrument);
  });
  const loopTop = Calc.wrapIndex(playlist, state.loop);
  // 走到末尾（或循环起点之后的边界）就再来一遍
  playIndex = playIndex + 1 >= playlist.length ? loopTop : playIndex + 1;
}

// ---- 口令格 ----
grid.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  const row = Number(cell.dataset.row);
  const step = Number(cell.dataset.step);
  state.pattern[row][step] = state.pattern[row][step] ? "" : instruments[row].token;
  Store.persist(state);
  renderGrid();
  renderStructure();
  renderSequence();
  renderSaveHint();
});

// ---- 走台序列：拖拽排序 ----
seqList.addEventListener("dragstart", (event) => {
  const card = event.target.closest(".seq-card");
  if (!card) return;
  dragMeasure = Number(card.dataset.measure);
  card.classList.add("dragging");
});

seqList.addEventListener("dragover", (event) => {
  const card = event.target.closest(".seq-card");
  if (card) event.preventDefault();
});

seqList.addEventListener("drop", (event) => {
  const card = event.target.closest(".seq-card");
  if (!card || dragMeasure === null) return;
  event.preventDefault();
  state.draft = Calc.moveEntry(state.draft, dragMeasure, Number(card.dataset.measure));
  Store.persist(state);
  rebuildPlaylist();
  render();
});

document.addEventListener("dragend", () => {
  dragMeasure = null;
  document.querySelectorAll(".seq-card.dragging").forEach((el) => el.classList.remove("dragging"));
});

// ---- 每小节 1 遍 / 2 遍 ----
seqList.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-repeat]");
  if (!btn) return;
  const measure = Number(btn.dataset.repeat);
  const current = state.draft.seq.find((entry) => entry.measure === measure);
  state.draft = Calc.setRepeat(state.draft, measure, current.repeat === 2 ? 1 : 2);
  Store.persist(state);
  rebuildPlaylist();
  render();
});

// ---- 确认工作稿 ----
confirmSeqBtn.addEventListener("click", () => {
  state.draft = Calc.confirmDraft(state.draft, state.bpm, state.pattern);
  Store.persist(state);
  renderSequence();
  renderSaveHint();
});

pieceName.addEventListener("input", () => {
  state.pieceName = pieceName.value;
  Store.persist(state);
});

bpmInput.addEventListener("input", () => {
  state.bpm = Number(bpmInput.value || 96);
  Store.persist(state);
  if (timer) {
    clearInterval(timer);
    timer = setInterval(tick, 60000 / state.bpm);
  }
  renderSequence();
  renderSaveHint();
});

loopSelect.addEventListener("change", () => {
  state.loop = loopSelect.value === "" ? null : Number(loopSelect.value);
  playIndex = Calc.wrapIndex(playlist, state.loop);
  Store.persist(state);
  renderSequence();
});

noteInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !noteInput.value.trim()) return;
  state.notes.unshift(noteInput.value.trim());
  noteInput.value = "";
  Store.persist(state);
  renderSidebars();
});

document.querySelector("#playBtn").addEventListener("click", () => {
  if (timer) clearInterval(timer);
  rebuildPlaylist();
  tick();
  timer = setInterval(tick, 60000 / state.bpm);
});

document.querySelector("#stopBtn").addEventListener("click", () => {
  clearInterval(timer);
  timer = null;
  clearHighlight();
});

document.querySelector("#saveBtn").addEventListener("click", () => {
  const status = currentStatus();
  state.saved.unshift(Store.snapshot(state, status));
  Store.persist(state);
  renderSidebars();
  saveHint.textContent = status === "confirmed"
    ? "方案已保存（含走台序列）。"
    : "方案已保存，但未含未确认/已过期的走台序列。";
});

savedList.addEventListener("click", (event) => {
  const id = event.target.closest("[data-load]")?.dataset.load;
  const plan = state.saved.find((entry) => entry.id === id);
  if (!plan) return;
  clearInterval(timer);
  timer = null;
  Store.restorePlan(state, plan);
  rebuildPlaylist();
  Store.persist(state);
  render();
});

render();

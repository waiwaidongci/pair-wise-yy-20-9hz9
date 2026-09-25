// 操作层：负责界面渲染、拖拽交互与播放调度；
// 序列计算走 rehearsal.js，状态读写走 storage.js。
import { loadState, persist } from "./storage.js";
import {
  BEATS_PER_MEASURE,
  expandSequence,
  loopRange,
  moveOrder,
  normalizeSequence,
  resolveFlatStep,
  sequenceStats
} from "./rehearsal.js";

const instruments = [
  { name: "大锣", token: "仓", freq: 180 },
  { name: "鼓", token: "冬", freq: 120 },
  { name: "钹", token: "才", freq: 360 },
  { name: "小锣", token: "台", freq: 520 }
];

const state = loadState();

let timer = null;
let playhead = null; // 展开序列里的流水拍点
let audioContext = null;
let dragFrom = null;

const grid = document.querySelector("#grid");
const savedList = document.querySelector("#savedList");
const structure = document.querySelector("#structure");
const notesList = document.querySelector("#notesList");
const pieceName = document.querySelector("#pieceName");
const bpmInput = document.querySelector("#bpmInput");
const loopSelect = document.querySelector("#loopSelect");
const noteInput = document.querySelector("#noteInput");
const sequenceList = document.querySelector("#sequenceList");
const seqStatus = document.querySelector("#seqStatus");
const seqTotals = document.querySelector("#seqTotals");
const confirmSeqBtn = document.querySelector("#confirmSeqBtn");
const saveBtn = document.querySelector("#saveBtn");

const STATUS_TEXT = {
  draft: { text: "工作稿 · 待确认", className: "is-draft" },
  stale: { text: "已过期 · 请重新确认", className: "is-stale" },
  confirmed: { text: "已确认 · 随方案保存", className: "is-confirmed" }
};

function commit() {
  persist(state);
}

function entries() {
  return expandSequence(state.sequence);
}

function syncFields() {
  pieceName.value = state.pieceName;
  bpmInput.value = state.bpm;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])
  );
}

// ---- 序列面板 ---------------------------------------------------------------

function renderSequencePanel() {
  const stats = sequenceStats(state.sequence, state.pattern);
  sequenceList.innerHTML = state.sequence.order
    .map((measure, position) => {
      const repeat = state.sequence.repeats[measure] === 2 ? 2 : 1;
      const count = stats.rows.find((row) => row.position === position).count;
      return `
        <div class="seq-card${repeat === 2 ? " repeated" : ""}" draggable="true"
             data-position="${position}" data-measure="${measure}">
          <span class="seq-handle" aria-hidden="true">⠿</span>
          <div class="seq-card-body">
            <strong>走台 ${position + 1}</strong>
            <span>第${measure + 1}小节 · ${count}个口令${repeat === 2 ? " · 演两遍" : ""}</span>
          </div>
          <button class="seq-repeat" type="button" data-position="${position}"
                  title="切换演一遍 / 演两遍">×${repeat}</button>
        </div>`;
    })
    .join("");

  const meta = STATUS_TEXT[state.sequence.status];
  seqStatus.textContent = meta.text;
  seqStatus.className = `seq-status ${meta.className}`;

  seqTotals.textContent = `共 ${stats.totalPasses} 遍小节 · ${stats.totalCommands} 个口令`;
  confirmSeqBtn.disabled = state.sequence.status === "confirmed";
  saveBtn.disabled = state.sequence.status !== "confirmed";
  saveBtn.title = state.sequence.status === "confirmed" ? "" : "序列尚未确认，请先确认排练序列";
}

// 循环起点按走台位次列，跟着小节顺序走
function renderLoopSelect() {
  loopSelect.innerHTML =
    `<option value="">从头循环</option>` +
    state.sequence.order
      .map((measure, position) =>
        `<option value="${position}">走台 ${position + 1}（第${measure + 1}小节）</option>`)
      .join("");
  const max = state.sequence.order.length - 1;
  if (current === "" || Number(current) > max) {
    state.loop = "";
  }
  loopSelect.value = state.loop;
}

// ---- 口令格（按展开序列铺列） ----------------------------------------------

function renderGrid() {
  const expanded = entries();
  const totalBeats = expanded.length * BEATS_PER_MEASURE;
  grid.style.gridTemplateColumns = `76px repeat(${totalBeats}, minmax(44px, 1fr))`;

  const groupCells = [`<div class="label-cell group-corner">乐器 / 小节</div>`];
  const beatCells = [`<div class="label-cell beat-corner">拍点</div>`];

  expanded.forEach((entry, entryIndex) => {
    if (entry.occurrence > 0) return;
    groupCells.push(`
      <div class="measure-cell ${entry.occurrences === 2 ? "is-repeat" : ""}"
           style="grid-column: span ${entry.occurrences * BEATS_PER_MEASURE};"
           data-group-start="${entryIndex}" data-group-end="${entryIndex + entry.occurrences - 1}">
        第${entry.measure + 1}小节${entry.occurrences === 2 ? "（演两遍）" : ""}
      </div>`);
  });
  for (let flat = 0; flat < totalBeats; flat += 1) {
    beatCells.push(`<div class="beat-cell">${(flat % BEATS_PER_MEASURE) + 1}</div>`);
  }

  const rows = instruments.flatMap((instrument, rowIndex) => {
    const cells = [`<div class="label-cell">${instrument.name}</div>`];
    expanded.forEach((entry, entryIndex) => {
      for (let beat = 0; beat < BEATS_PER_MEASURE; beat += 1) {
        const step = entry.measure * BEATS_PER_MEASURE + beat;
        const value = state.pattern[rowIndex][step];
        cells.push(`
          <button class="cell ${value ? "filled" : ""}" type="button"
                  data-row="${rowIndex}" data-step="${step}"
                  data-flatcol="${entryIndex * BEATS_PER_MEASURE + beat}">${value}</button>`);
      }
    });
    return cells;
  });

  grid.innerHTML = [...groupCells, ...beatCells, ...rows].join("");
}

// ---- 侧栏 -------------------------------------------------------------------

function renderSidebars() {
  const stats = sequenceStats(state.sequence, state.pattern);
  structure.innerHTML =
    stats.rows
      .map(
        (row) => `
      <div class="structure-row">
        <span>走台${row.position + 1} · 第${row.measure + 1}小节${row.repeat === 2 ? " ×2" : ""}</span>
        <strong>${row.count}个口令</strong>
      </div>`
      )
      .join("") +
    `<div class="structure-row structure-total">
       <span>合计（含重复）</span><strong>${stats.totalCommands}个口令</strong>
     </div>`;

  notesList.innerHTML = state.notes.length
    ? state.notes.map((note) => `<article class="note"><p>${escapeHtml(note)}</p></article>`).join("")
    : "<p>暂无批注。</p>";

  savedList.innerHTML = state.saved.length
    ? state.saved
        .map(
          (item) => `
      <button class="saved-item" type="button" data-load="${item.id}">
        <strong>${escapeHtml(item.name)}</strong><br>
        <span>${item.bpm}BPM · ${item.notes.length}条批注 · 序列${
            item.sequence?.status === "confirmed" ? "已确认" : "待确认"
          }</span>
      </button>`
        )
        .join("")
    : "<p>还没有保存方案。</p>";
}

function render() {
  syncFields();
  renderLoopSelect();
  renderSequencePanel();
  renderGrid();
  renderSidebars();
}

// ---- 声音与播放 -------------------------------------------------------------

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

function highlight(flatStep) {
  document.querySelectorAll(".cell.playing").forEach((cell) => cell.classList.remove("playing"));
  document.querySelectorAll(".measure-cell.active").forEach((cell) => cell.classList.remove("active"));

  // 点亮展开流水里当前这一拍（重复小节的两列各自独立点亮）
  grid.querySelectorAll(`.cell[data-flatcol="${flatStep}"]`).forEach((cell) =>
    cell.classList.add("playing")
  );
  const groupIndex = Math.floor(flatStep / BEATS_PER_MEASURE);
  grid.querySelectorAll(".measure-cell").forEach((group) => {
    if (groupIndex >= Number(group.dataset.groupStart) && groupIndex <= Number(group.dataset.groupEnd)) {
      group.classList.add("active");
    }
  });
}

function tick() {
  const { start, end } = loopRange(state.sequence, state.loop);
  if (playhead === null || playhead < start || playhead > end) playhead = start;
  highlight(playhead);

  const { patternStep } = resolveFlatStep(state.sequence, playhead);
  instruments.forEach((instrument, rowIndex) => {
    if (state.pattern[rowIndex][patternStep]) playSound(instrument);
  });

  // 播到末尾：按循环起点再走一遍
  playhead = playhead >= end ? start : playhead + 1;
}

function stopPlayback() {
  if (timer) clearInterval(timer);
  timer = null;
  playhead = null;
  document.querySelectorAll(".cell.playing").forEach((cell) => cell.classList.remove("playing"));
  document.querySelectorAll(".measure-cell.active").forEach((cell) => cell.classList.remove("active"));
}

// ---- 口令格编辑 -------------------------------------------------------------

grid.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  const row = Number(cell.dataset.row);
  const step = Number(cell.dataset.step);
  state.pattern[row][step] = state.pattern[row][step] ? "" : instruments[row].token;
  // 口令后来改了：确认过的序列也算过期，需要重新确认
  if (state.sequence.status === "confirmed") state.sequence.status = "stale";
  commit();
  render();
});

// ---- 序列拖拽 ---------------------------------------------------------------

sequenceList.addEventListener("dragstart", (event) => {
  const card = event.target.closest(".seq-card");
  if (!card) return;
  dragFrom = Number(card.dataset.position);
  card.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
});

sequenceList.addEventListener("dragend", () => {
  dragFrom = null;
  document.querySelectorAll(".seq-card.dragging").forEach((card) => card.classList.remove("dragging"));
  document.querySelectorAll(".seq-card.drop-before").forEach((card) => card.classList.remove("drop-before"));
});

sequenceList.addEventListener("dragover", (event) => {
  event.preventDefault();
  const card = event.target.closest(".seq-card");
  document.querySelectorAll(".seq-card.drop-before").forEach((item) => item.classList.remove("drop-before"));
  if (card) card.classList.add("drop-before");
});

sequenceList.addEventListener("drop", (event) => {
  event.preventDefault();
  const card = event.target.closest(".seq-card");
  if (!card || dragFrom === null) return;
  const to = Number(card.dataset.position);
  state.sequence.order = moveOrder(state.sequence.order, dragFrom, to);
  // 工作稿拖动后仍是工作稿；已确认的拖过即变工作稿，重新确认后才保存
  if (state.sequence.status === "confirmed") state.sequence.status = "draft";
  if (dragFrom === to) return;
  stopPlayback();
  commit();
  render();
});

sequenceList.addEventListener("click", (event) => {
  const button = event.target.closest(".seq-repeat");
  if (!button) return;
  const position = Number(button.dataset.position);
  const measure = state.sequence.order[position];
  state.sequence.repeats[measure] = state.sequence.repeats[measure] === 2 ? 1 : 2;
  if (state.sequence.status === "confirmed") state.sequence.status = "draft";
  stopPlayback();
  commit();
  render();
});

// ---- 序列确认 ---------------------------------------------------------------

confirmSeqBtn.addEventListener("click", () => {
  state.sequence = normalizeSequence({ ...state.sequence, status: "confirmed" });
  stopPlayback();
  commit();
  render();
});

// ---- 普通控件 ---------------------------------------------------------------

pieceName.addEventListener("input", () => {
  state.pieceName = pieceName.value;
  commit();
});

bpmInput.addEventListener("input", () => {
  state.bpm = Number(bpmInput.value || 96);
  if (state.sequence.status === "confirmed") state.sequence.status = "stale";
  commit();
  renderSequencePanel();
  if (timer) {
    clearInterval(timer);
    timer = setInterval(tick, 60000 / state.bpm);
  }
});

loopSelect.addEventListener("change", () => {
  state.loop = loopSelect.value;
  playhead = null;
  commit();
});

noteInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !noteInput.value.trim()) return;
  state.notes.unshift(noteInput.value.trim());
  noteInput.value = "";
  commit();
  renderSidebars();
});

document.querySelector("#playBtn").addEventListener("click", () => {
  if (timer) clearInterval(timer);
  playhead = loopRange(state.sequence, state.loop).start;
  tick();
  timer = setInterval(tick, 60000 / state.bpm);
});

document.querySelector("#stopBtn").addEventListener("click", stopPlayback);

// ---- 保存 / 载入 ------------------------------------------------------------

saveBtn.addEventListener("click", () => {
  // 只有确认过的序列才随方案保存；工作稿/过期稿不允许保存
  if (state.sequence.status !== "confirmed") return;
  state.saved.unshift({
    id: crypto.randomUUID(),
    name: state.pieceName || "未命名片段",
    bpm: state.bpm,
    loop: state.loop,
    notes: [...state.notes],
    pattern: state.pattern.map((row) => [...row]),
    sequence: JSON.parse(JSON.stringify(state.sequence)),
    createdAt: new Date().toISOString()
  });
  commit();
  renderSidebars();
});

savedList.addEventListener("click", (event) => {
  const id = event.target.closest("[data-load]")?.dataset.load;
  const item = state.saved.find((entry) => entry.id === id);
  if (!item) return;
  state.pieceName = item.name;
  state.bpm = item.bpm;
  state.notes = [...item.notes];
  state.pattern = item.pattern.map((row) => [...row]);
  // 载入旧方案：有序列按原顺序补齐，状态规整后直接生效
  state.sequence = normalizeSequence(item.sequence);
  state.sequence.status = "confirmed";
  const max = state.sequence.order.length - 1;
  state.loop = item.loop === "" || Number(item.loop) > max ? "" : item.loop;
  stopPlayback();
  commit();
  render();
});

render();

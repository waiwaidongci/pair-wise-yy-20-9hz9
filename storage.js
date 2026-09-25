// 保存层：只负责工作状态的读写与规整，不参与渲染和播放计算。
import { defaultSequence, normalizeSequence, migratePlan } from "./rehearsal.js";

export const storageKey = "wxyy-4-luogujing-grid";

const INSTRUMENTS = [
  { token: "仓" },
  { token: "冬" },
  { token: "才" },
  { token: "台" }
];
const STEPS = 16;

function defaultPattern() {
  return INSTRUMENTS.map((instrument) =>
    Array.from({ length: STEPS }, (_, index) => (index % 4 === 0 ? instrument.token : ""))
  );
}

function normalizePattern(pattern) {
  if (!Array.isArray(pattern) || pattern.length !== INSTRUMENTS.length) return defaultPattern();
  return pattern.map((row, rowIndex) => {
    if (!Array.isArray(row)) return defaultPattern()[rowIndex];
    return Array.from({ length: STEPS }, (_, step) =>
      row[step] === INSTRUMENTS[rowIndex].token ? INSTRUMENTS[rowIndex].token : ""
    );
  });
}

function normalizeNotes(notes) {
  return Array.isArray(notes) ? notes.filter((note) => typeof note === "string") : [];
}

function normalizeSaved(saved) {
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((item) => item && item.id)
    .map((item) => migratePlan({ ...item }))
    .map((item) => ({
      ...item,
      name: item.name || "未命名片段",
      bpm: Number(item.bpm) || 96,
      loop: String(item.loop ?? ""),
      notes: normalizeNotes(item.notes),
      pattern: normalizePattern(item.pattern)
    }));
}

export function loadState() {
  const raw = JSON.parse(localStorage.getItem(storageKey) || "null") || {};
  const state = {
    pieceName: typeof raw.pieceName === "string" ? raw.pieceName : "出场锣鼓-慢起",
    bpm: Number(raw.bpm) || 96,
    loop: String(raw.loop ?? ""),
    notes: normalizeNotes(raw.notes),
    pattern: normalizePattern(raw.pattern),
    sequence: normalizeSequence(raw.sequence),
    saved: normalizeSaved(raw.saved)
  };
  // 历史工作状态没有序列：按原顺序补齐
  if (!raw.sequence) state.sequence.status = "confirmed";
  return state;
}

export function persist(state) {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

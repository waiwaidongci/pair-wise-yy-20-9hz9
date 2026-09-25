// 计算层：排练序列的纯数据逻辑，不碰 DOM，也不负责持久化。
// 序列结构 sequence：
//   order:   长度 4 的数组，值为小节编号 0..3，表示走台顺序
//   repeats: 长度 4 的数组，按小节编号记录 1 或 2（演几遍）
//   status:  "draft"（工作稿）/ "confirmed"（已确认）/ "stale"（已过期）

export const MEASURE_COUNT = 4;
export const BEATS_PER_MEASURE = 4;
const MEASURE_INDEXES = [0, 1, 2, 3];
const VALID_STATUS = ["draft", "confirmed", "stale"];

export function defaultSequence() {
  return { order: [0, 1, 2, 3], repeats: [1, 1, 1, 1], status: "confirmed" };
}

// 把历史数据 / 外部载入数据规整成合法序列；非法时回退默认顺序。
export function normalizeSequence(sequence) {
  const base = defaultSequence();
  if (!sequence || typeof sequence !== "object") return base;

  const order = Array.isArray(sequence.order) ? sequence.order.map(Number) : [];
  const isPermutation =
    order.length === MEASURE_COUNT &&
    MEASURE_INDEXES.every((index) => order.filter((value) => value === index).length === 1);

  const repeats = base.repeats.map((_, measure) =>
    Number(sequence.repeats?.[measure]) === 2 ? 2 : 1
  );

  const status = VALID_STATUS.includes(sequence.status) ? sequence.status : "draft";

  return {
    order: isPermutation ? order : base.order,
    repeats,
    status
  };
}

// 把走台序列展开成“一遍一遍的小节”流水，重复小节出现多次。
// 每项：{ position（走台位次）, measure（小节编号）, occurrence（第几遍 0/1）, occurrences（共几遍） }
export function expandSequence(sequence) {
  const entries = [];
  sequence.order.forEach((measure, position) => {
    const occurrences = sequence.repeats[measure] === 2 ? 2 : 1;
    for (let occurrence = 0; occurrence < occurrences; occurrence += 1) {
      entries.push({ position, measure, occurrence, occurrences });
    }
  });
  return entries;
}

// 拖拽换位：返回新的 order 数组。
export function moveOrder(order, from, to) {
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) {
    return [...order];
  }
  const next = [...order];
  const [measure] = next.splice(from, 1);
  next.splice(to, 0, measure);
  return next;
}

// 循环起点（走台位次）换算成展开流水里的拍点区间；到末尾折回起点。
export function loopRange(sequence, loop) {
  const entries = expandSequence(sequence);
  const end = entries.length * BEATS_PER_MEASURE - 1;
  if (loop === "" || loop === null || loop === undefined) return { start: 0, end };

  const position = Number(loop);
  const firstEntry = entries.findIndex((entry) => entry.position === position);
  return { start: (firstEntry < 0 ? 0 : firstEntry) * BEATS_PER_MEASURE, end };
}

// 展开流水中的某个拍点对应到原始 pattern 的位置。
export function resolveFlatStep(sequence, flatStep) {
  const entries = expandSequence(sequence);
  const entryIndex = Math.min(Math.floor(flatStep / BEATS_PER_MEASURE), entries.length - 1);
  const entry = entries[entryIndex];
  const beat = flatStep % BEATS_PER_MEASURE;
  return { entry, beat, patternStep: entry.measure * BEATS_PER_MEASURE + beat };
}

export function measureCommandCount(pattern, measure) {
  const start = measure * BEATS_PER_MEASURE;
  return pattern.reduce(
    (count, row) => count + row.slice(start, start + BEATS_PER_MEASURE).filter(Boolean).length,
    0
  );
}

// 段落统计跟着走台顺序走；合计按实际演出遍数计算。
export function sequenceStats(sequence, pattern) {
  const rows = sequence.order.map((measure, position) => ({
    position,
    measure,
    repeat: sequence.repeats[measure] === 2 ? 2 : 1,
    count: measureCommandCount(pattern, measure)
  }));
  const totalPasses = rows.reduce((sum, row) => sum + row.repeat, 0);
  const totalCommands = rows.reduce((sum, row) => sum + row.count * row.repeat, 0);
  return { rows, totalPasses, totalCommands };
}

// 旧方案没有序列数据：按原始 1→2→3→4 顺序补齐，视为已确认。
export function migratePlan(plan) {
  if (!plan || typeof plan !== "object") return plan;
  if (!plan.sequence) plan.sequence = defaultSequence();
  const sequence = normalizeSequence(plan.sequence);
  sequence.status = "confirmed";
  plan.sequence = sequence;
  return plan;
}

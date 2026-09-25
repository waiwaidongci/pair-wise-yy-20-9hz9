// 保存层：只管 localStorage 读写与方案快照，不做页面渲染
const Store = (() => {
  const storageKey = "wxyy-4-luogujing-grid";

  function load() {
    const raw = JSON.parse(localStorage.getItem(storageKey) || "null") || {};
    const pattern = instruments.map((instrument, rowIndex) => {
      const savedRow = Array.isArray(raw.pattern) ? raw.pattern[rowIndex] : null;
      return Array.from({ length: Calc.STEP_COUNT }, (_, step) =>
        savedRow && savedRow[step] ? savedRow[step] : step % 4 === 0 ? instrument.token : ""
      );
    });
    return {
      pieceName: raw.pieceName || "出场锣鼓-慢起",
      bpm: Number(raw.bpm) > 0 ? Number(raw.bpm) : 96,
      loop: raw.loop === "" || raw.loop == null || !Calc.isValidMeasure(Number(raw.loop)) ? null : Number(raw.loop),
      notes: Array.isArray(raw.notes) ? raw.notes : [],
      pattern,
      // 工作稿在页面刷新之间保留；basis 为 null 表示尚未确认
      draft: Calc.createDraft(raw.draft && raw.draft.seq, raw.draft && raw.draft.basis),
      saved: Array.isArray(raw.saved) ? raw.saved : []
    };
  }

  // 工作稿随当前页面状态一起持久化，但只在确认后才会写进方案
  function persist(state) {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  // 保存方案时：只有已确认且未过期的序列才随方案带走
  function snapshot(state, status) {
    const plan = {
      id: crypto.randomUUID(),
      name: state.pieceName || "未命名片段",
      bpm: state.bpm,
      loop: state.loop,
      notes: [...state.notes],
      pattern: state.pattern.map((row) => [...row]),
      createdAt: new Date().toISOString()
    };
    if (status === "confirmed") {
      plan.sequence = Calc.normalizeSequence(state.draft.seq).map((entry) => ({ ...entry }));
    }
    return plan;
  }

  // 载入旧方案：有 sequence 按原顺序，没有就按 1-2-3-4 补齐；载入即视为已确认
  function restorePlan(state, plan) {
    state.pieceName = plan.name;
    state.bpm = plan.bpm;
    state.loop = plan.loop === "" || plan.loop == null || !Calc.isValidMeasure(Number(plan.loop)) ? null : Number(plan.loop);
    state.notes = [...plan.notes];
    state.pattern = plan.pattern.map((row) => [...row]);
    state.draft = Calc.createDraft(plan.sequence, {
      bpm: state.bpm,
      hash: Calc.patternHash(state.pattern)
    });
    return state;
  }

  return { load, persist, snapshot, restorePlan };
})();

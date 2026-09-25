// 计算层：全部为纯函数，不碰 DOM 也不碰 localStorage
// 小节编号固定为 0-3（页面四格不变），序列只决定“走台顺序”和重复次数。
const Calc = (() => {
  const MEASURE_COUNT = 4;
  const BEATS_PER_MEASURE = 4;
  const STEP_COUNT = MEASURE_COUNT * BEATS_PER_MEASURE;

  function isValidMeasure(measure) {
    return Number.isInteger(measure) && measure >= 0 && measure < MEASURE_COUNT;
  }

  // 默认走台顺序：1、2、3、4，各一遍
  function defaultSequence() {
    return Array.from({ length: MEASURE_COUNT }, (_, measure) => ({ measure, repeat: 1 }));
  }

  // 接纳旧方案/残缺数据：去重、去非法值，缺的小节按原顺序补在末尾
  function normalizeSequence(seq) {
    const seen = new Set();
    const result = [];
    if (Array.isArray(seq)) {
      for (const entry of seq) {
        const measure = Number(entry && entry.measure);
        if (!isValidMeasure(measure) || seen.has(measure)) continue;
        seen.add(measure);
        result.push({ measure, repeat: Number(entry && entry.repeat) === 2 ? 2 : 1 });
      }
    }
    for (let measure = 0; measure < MEASURE_COUNT; measure += 1) {
      if (!seen.has(measure)) result.push({ measure, repeat: 1 });
    }
    return result;
  }

  function patternHash(pattern) {
    return pattern.map((row) => row.join(".")).join("|");
  }

  // 工作稿：seq 为当前顺序，basis 为确认时的速度/口令快照；null 表示从未确认
  function createDraft(seq, basis) {
    return {
      seq: normalizeSequence(seq),
      basis: basis ? { bpm: Number(basis.bpm), hash: String(basis.hash) } : null
    };
  }

  function isConfirmed(draft) {
    return !!draft.basis;
  }

  // 已确认但速度或口令与确认时不一致，即为过期
  function draftStatus(draft, bpm, pattern) {
    if (!draft.basis) return "unconfirmed";
    if (draft.basis.bpm !== Number(bpm) || draft.basis.hash !== patternHash(pattern)) {
      return "stale";
    }
    return "confirmed";
  }

  function confirmDraft(draft, bpm, pattern) {
    return createDraft(draft.seq, { bpm, hash: patternHash(pattern) });
  }

  // 改动序列本身：回到未确认状态
  function touchDraft(draft) {
    return createDraft(draft.seq, null);
  }

  function moveEntry(draft, fromMeasure, toMeasure) {
    const seq = normalizeSequence(draft.seq);
    const from = seq.findIndex((entry) => entry.measure === fromMeasure);
    if (from < 0 || !isValidMeasure(toMeasure) || fromMeasure === toMeasure) return touchDraft(draft);
    const [moved] = seq.splice(from, 1);
    // 先移除再定位，避免目标在拖动项之后时索引错位
    const to = seq.findIndex((entry) => entry.measure === toMeasure);
    if (to < 0) return touchDraft(draft);
    seq.splice(to, 0, moved);
    return createDraft(seq, null);
  }

  function setRepeat(draft, measure, repeat) {
    const seq = normalizeSequence(draft.seq).map((entry) =>
      entry.measure === measure ? { ...entry, repeat: repeat === 2 ? 2 : 1 } : entry
    );
    return createDraft(seq, null);
  }

  // 把序列展开成播放清单：同一小节按重复遍数出现多次
  function buildPlaylist(seq) {
    const playlist = [];
    normalizeSequence(seq).forEach((entry, position) => {
      for (let pass = 0; pass < entry.repeat; pass += 1) {
        for (let beat = 0; beat < BEATS_PER_MEASURE; beat += 1) {
          playlist.push({ measure: entry.measure, beat, position, pass });
        }
      }
    });
    return playlist;
  }

  // 循环起点按小节编号绑定，拖顺序后仍指向同一小节；找不到就从头
  function wrapIndex(playlist, loopStart) {
    if (isValidMeasure(loopStart)) {
      const index = playlist.findIndex((item) => item.measure === loopStart);
      if (index >= 0) return index;
    }
    return 0;
  }

  function countCommands(pattern, measure) {
    const start = measure * BEATS_PER_MEASURE;
    return pattern.reduce(
      (total, row) => total + row.slice(start, start + BEATS_PER_MEASURE).filter(Boolean).length,
      0
    );
  }

  return {
    MEASURE_COUNT,
    BEATS_PER_MEASURE,
    STEP_COUNT,
    isValidMeasure,
    defaultSequence,
    normalizeSequence,
    patternHash,
    createDraft,
    isConfirmed,
    draftStatus,
    confirmDraft,
    touchDraft,
    moveEntry,
    setRepeat,
    buildPlaylist,
    wrapIndex,
    countCommands
  };
})();

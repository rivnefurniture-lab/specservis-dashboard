const internallyTrackedDirections = new Set(["Капбудівництво"]);

const reviewCpvCodes = new Set([
  "45312100",
  "45333000",
  "45440000",
  "71000000",
  "71220000",
  "71510000",
  "71520000",
  "71530000",
  "71630000",
]);

export function classifyCoverage({ direction, cpvCode, seenByTeam }) {
  if (!internallyTrackedDirections.has(direction)) {
    return {
      coverageStatus: "untracked",
      coverageNote: "Внутрішній Excel цього напрямку ще не підключено",
    };
  }
  if (seenByTeam) {
    return {
      coverageStatus: "seen",
      coverageNote: "Знайдено у внутрішньому реєстрі команди",
    };
  }
  if (reviewCpvCodes.has(String(cpvCode ?? ""))) {
    return {
      coverageStatus: "review",
      coverageNote: `ДК ${cpvCode} ще не підтверджений історією команди`,
    };
  }
  return {
    coverageStatus: "missed",
    coverageNote: "Релевантний тендер не знайдено у внутрішньому реєстрі",
  };
}

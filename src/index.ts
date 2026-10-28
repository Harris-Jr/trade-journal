export * from './domain/types.js';
export { buildTrades, applyAnnotations } from './metrics/trade.js';
export {
  computeStats,
  equityCurve,
  maxDrawdown,
  type TradeStats,
  type EquityPoint,
  type DrawdownResult,
} from './metrics/stats.js';
export {
  healthScore,
  DEFAULT_WEIGHTS,
  scoreProfitFactor,
  scoreAvgWinLoss,
  scoreRecoveryFactor,
  scoreMaxDrawdown,
  scoreTradeWin,
  scoreConsistency,
  type HealthScore,
  type HealthScoreWeights,
} from './metrics/healthScore.js';
export {
  importExecutionsFromCsv,
  parseCsv,
  GENERIC_MAPPING,
  type ImportResult,
  type ColumnMapping,
} from './import/genericCsv.js';
export { Repository } from './db/repository.js';
export { createApi } from './server/api.js';
export {
  projectTrade,
  unitSuffix,
  type ValueUnit,
  type InstrumentSpec,
  type ProjectionContext,
  type Projected,
} from './analytics/projection.js';
export {
  evaluateGoal,
  validateGoalTarget,
  METRIC_DEFS,
  type GoalProgress,
  type MetricDef,
  type MetricCategory,
  type MetricUnit,
} from './analytics/progress.js';
export { periodKey, type ProgressPeriod } from './analytics/reports.js';
export { playbookAnalytics, type PlaybookAnalytics } from './analytics/playbook.js';
export {
  computeInsights,
  DEFAULT_THRESHOLDS,
  type Insight,
  type InsightType,
  type InsightThresholds,
  type InsightsResult,
} from './analytics/insights.js';
export {
  propSummary,
  accountTotals,
  type PropSummary,
  type PropAccountTotals,
} from './analytics/propfirm.js';
export {
  report,
  groupBy,
  reportByDay,
  reportByWeek,
  reportByMonth,
  reportByDayOfWeek,
  reportByHourOfDay,
  reportBySymbol,
  reportByStrategy,
  reportBySetup,
  reportByTag,
  reportByDuration,
  DURATION_BUCKETS,
  type BreakdownRow,
  type ReportDimension,
  type SortBy,
} from './analytics/reports.js';

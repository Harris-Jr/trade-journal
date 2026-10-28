// End-to-end demo: CSV → executions → trades → stats → health score.
// Run after `npm run build`:  node examples/demo.mjs
import {
  importExecutionsFromCsv,
  buildTrades,
  applyAnnotations,
  computeStats,
  equityCurve,
  healthScore,
} from '../dist/index.js';

const csv = `Account,Symbol,Type,Side,Qty,Price,Time,Commission,Multiplier
A1,AAPL,stock,BUY,100,180.00,2024-03-01T14:30:00Z,1,
A1,AAPL,stock,SELL,100,183.50,2024-03-01T15:10:00Z,1,
A1,AAPL,stock,SELL,50,181.00,2024-03-04T14:40:00Z,1,
A1,AAPL,stock,BUY,50,179.50,2024-03-04T15:30:00Z,1,
A1,ES,futures,BUY,2,5100.00,2024-03-05T14:35:00Z,4,50
A1,ES,futures,SELL,2,5088.00,2024-03-05T15:05:00Z,4,50
A1,ES,futures,BUY,1,5095.00,2024-03-06T14:35:00Z,2,50
A1,ES,futures,SELL,1,5112.00,2024-03-06T16:00:00Z,2,50`;

const { executions, errors } = importExecutionsFromCsv(csv);
if (errors.length) console.log('import errors:', errors);

let trades = buildTrades(executions);
// Attach a planned stop to the first trade to demonstrate R-multiple.
trades = trades.map((t, i) => (i === 0 ? applyAnnotations(t, { stopLoss: 178.5 }) : t));

console.log('\n=== Trades ===');
for (const t of trades) {
  console.log(
    `${t.symbol.padEnd(5)} ${t.direction.padEnd(5)} qty=${t.quantity} ` +
      `entry=${t.avgEntryPrice} exit=${t.avgExitPrice} net=${t.netPnl}` +
      (t.rMultiple !== undefined ? `  R=${t.rMultiple}` : ''),
  );
}

console.log('\n=== Stats ===');
const s = computeStats(trades);
console.log({
  trades: s.trades,
  winRate: `${(s.winRate * 100).toFixed(1)}%`,
  profitFactor: s.profitFactor,
  expectancy: s.expectancy,
  netPnl: s.netPnl,
  maxDrawdown: s.drawdown.maxDrawdown,
  recoveryFactor: s.recoveryFactor,
});

console.log('\n=== Equity curve (start $10,000) ===');
console.log(equityCurve(trades, 10000).map((p) => p.equity));

console.log('\n=== Health Score (independent Zella-Score equivalent) ===');
const hs = healthScore(trades);
console.log('total:', hs.total);
for (const [k, c] of Object.entries(hs.components)) {
  console.log(`  ${k.padEnd(16)} value=${c.value.toFixed(2)} score=${c.score.toFixed(1)} weight=${c.weight}`);
}

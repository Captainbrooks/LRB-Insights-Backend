export function normalizeMetric({
  clientId,
  platform,
  channel,
  sourceId,
  sourceName,
  metric,
  value,
  date,
  meta = {}
}) {
  return {
    clientId,
    platform,
    channel,
    sourceId,
    sourceName,
    metric,
    value: Number(value) || 0,
    date: new Date(date),
    meta
  };
}

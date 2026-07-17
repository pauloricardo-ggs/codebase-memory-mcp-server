const counters = new Map();
const gauges = new Map();
const histograms = new Map();

function key(name, labels = {}) {
  const entries = Object.entries(labels).filter(([, value]) => value !== undefined && value !== null).sort(([a], [b]) => a.localeCompare(b));
  return `${name}|${entries.map(([label, value]) => `${label}=${String(value)}`).join(',')}`;
}

function parseKey(value) {
  const [name, raw = ''] = value.split('|');
  const labels = raw ? Object.fromEntries(raw.split(',').map(item => item.split('='))) : {};
  return { name, labels };
}

function labelsText(labels) {
  const entries = Object.entries(labels);
  if (!entries.length) return '';
  return `{${entries.map(([name, value]) => `${name}="${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`;
}

export function increment(name, labels = {}, value = 1) {
  const metric = key(name, labels);
  counters.set(metric, (counters.get(metric) || 0) + value);
}

export function gauge(name, value, labels = {}) {
  gauges.set(key(name, labels), Number(value) || 0);
}

export function observe(name, value, labels = {}) {
  const metric = key(name, labels);
  const current = histograms.get(metric) || { count: 0, sum: 0 };
  current.count += 1;
  current.sum += Number(value) || 0;
  histograms.set(metric, current);
}

export function metricsText() {
  gauge('knowledge_sync_process_resident_memory_bytes', process.memoryUsage().rss);
  gauge('knowledge_sync_process_heap_used_bytes', process.memoryUsage().heapUsed);
  gauge('knowledge_sync_process_uptime_seconds', process.uptime());
  const lines = [];
  for (const [metric, value] of counters) {
    const { name, labels } = parseKey(metric);
    lines.push(`${name}${labelsText(labels)} ${value}`);
  }
  for (const [metric, value] of gauges) {
    const { name, labels } = parseKey(metric);
    lines.push(`${name}${labelsText(labels)} ${value}`);
  }
  for (const [metric, value] of histograms) {
    const { name, labels } = parseKey(metric);
    lines.push(`${name}_count${labelsText(labels)} ${value.count}`);
    lines.push(`${name}_sum${labelsText(labels)} ${value.sum}`);
  }
  return `${lines.join('\n')}\n`;
}

export function log(level, event, fields = {}) {
  const safe = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, service: 'knowledge-sync', event, ...safe });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

export async function timed(metric, labels, operation) {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    observe(metric, (performance.now() - started) / 1000, labels);
  }
}

const counters = new Map();
const gauges = new Map();
const histograms = new Map();

function serializeLabels(labels) {
  const entries = Object.entries(labels).filter(([, value]) => value !== undefined && value !== null).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? `{${entries.map(([name, value]) => `${name}="${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}` : '';
}

function metricKey(name, labels) { return JSON.stringify([name, labels]); }

export function increment(name, labels = {}, value = 1) {
  const key = metricKey(name, labels);
  counters.set(key, (counters.get(key) || 0) + value);
}

export function gauge(name, value, labels = {}) { gauges.set(metricKey(name, labels), Number(value) || 0); }

export function observe(name, value, labels = {}) {
  const key = metricKey(name, labels);
  const current = histograms.get(key) || { count: 0, sum: 0 };
  current.count += 1;
  current.sum += Number(value) || 0;
  histograms.set(key, current);
}

export function metricsText() {
  gauge('cbm_admin_process_resident_memory_bytes', process.memoryUsage().rss);
  gauge('cbm_admin_process_heap_used_bytes', process.memoryUsage().heapUsed);
  gauge('cbm_admin_process_uptime_seconds', process.uptime());
  const lines = [];
  for (const [key, value] of counters) { const [name, labels] = JSON.parse(key); lines.push(`${name}${serializeLabels(labels)} ${value}`); }
  for (const [key, value] of gauges) { const [name, labels] = JSON.parse(key); lines.push(`${name}${serializeLabels(labels)} ${value}`); }
  for (const [key, value] of histograms) {
    const [name, labels] = JSON.parse(key);
    lines.push(`${name}_count${serializeLabels(labels)} ${value.count}`, `${name}_sum${serializeLabels(labels)} ${value.sum}`);
  }
  return `${lines.join('\n')}\n`;
}

export function log(level, event, fields = {}) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, service: 'admin', event, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

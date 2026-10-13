import { STORAGE_QUEUE_KEY } from "./config.js";

function validJob(job) {
  return Boolean(job && typeof job.id === "string" && job.id.trim() && typeof job.preferencia === "string");
}

export function createMemoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

export function loadQueue(storage) {
  try {
    const raw = JSON.parse(storage.getItem(STORAGE_QUEUE_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter(validJob) : [];
  } catch {
    return [];
  }
}

export function saveQueue(storage, jobs) {
  storage.setItem(STORAGE_QUEUE_KEY, JSON.stringify(jobs));
}

export function enqueue(storage, job) {
  const jobs = loadQueue(storage).filter((item) => item.id !== job.id);
  jobs.push(job);
  saveQueue(storage, jobs);
  return jobs;
}

export function removeQueued(storage, id) {
  const jobs = loadQueue(storage).filter((item) => item.id !== id);
  saveQueue(storage, jobs);
  return jobs;
}

export function isNetworkError(err) {
  if (!err || err.status) return false;
  return err.code === "network" || err.name === "TypeError";
}

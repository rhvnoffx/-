// All writers, including those with Web Locks, use the same IndexedDB transaction
// so tabs with different lock support cannot race on the localStorage collection.
export function withCollectionTransaction(key, update) {
  const transact = () => new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open('andee-collection-coordination', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('locks');
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Collection coordination is blocked')); };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      let result, failure;
      try {
        const transaction = db.transaction('locks', 'readwrite');
        const gate = transaction.objectStore('locks').get(key);
        gate.onsuccess = () => {
          try { result = update(); }
          catch (error) { failure = error; transaction.abort(); }
        };
        transaction.oncomplete = () => { db.close(); resolve(result); };
        transaction.onabort = () => { db.close(); reject(failure || transaction.error || new Error('Collection transaction aborted')); };
      } catch (error) { db.close(); reject(error); }
    };
  });
  return navigator.locks ? navigator.locks.request(key, transact) : transact();
}

export class InvalidCollectionError extends Error {}

export function readCollection(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new InvalidCollectionError('Invalid saved collection'); }
  if (!Array.isArray(value)) throw new InvalidCollectionError('Invalid saved collection');
  return value;
}

import { gzip, gunzip, strFromU8, strToU8 } from 'fflate';
import { get, set, del } from 'idb-keyval';

const memoryStore = new Map();

const hasWindow = typeof window !== 'undefined';
const hasIndexedDb = hasWindow && typeof window.indexedDB !== 'undefined';
const hasLocalStorage = hasWindow && typeof window.localStorage !== 'undefined';

function gzipAsync(data) {
  return new Promise((resolve, reject) => {
    gzip(data, { level: 6 }, (err, compressed) => {
      if (err) reject(err);
      else resolve(compressed);
    });
  });
}

function gunzipAsync(data) {
  return new Promise((resolve, reject) => {
    gunzip(data, (err, decompressed) => {
      if (err) reject(err);
      else resolve(decompressed);
    });
  });
}

function encodeForLocalStorage(u8) {
  if (!hasWindow) return null;
  if (!(u8 instanceof Uint8Array)) return null;
  let binary = '';
  for (let i = 0; i < u8.length; i += 1) {
    binary += String.fromCharCode(u8[i]);
  }
  return `gz:${btoa(binary)}`;
}

function decodeFromLocalStorage(value) {
  if (!hasWindow || typeof value !== 'string') return null;
  if (value.startsWith('gz:')) {
    const b64 = value.slice(3);
    const binary = atob(b64);
    const u8 = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      u8[i] = binary.charCodeAt(i);
    }
    return u8;
  }
  if (value.startsWith('json:')) {
    return value.slice(5);
  }
  return null;
}

function memoryKey(key) {
  return `mem::${key}`;
}

async function readFromIndexedDb(key) {
  if (!hasIndexedDb) return undefined;
  try {
    const value = await get(key);
    return value === undefined ? undefined : value;
  } catch (err) {
    return undefined;
  }
}

async function writeToIndexedDb(key, value) {
  if (!hasIndexedDb) return false;
  try {
    await set(key, value);
    return true;
  } catch (err) {
    return false;
  }
}

async function removeFromIndexedDb(key) {
  if (!hasIndexedDb) return false;
  try {
    await del(key);
    return true;
  } catch (err) {
    return false;
  }
}

function readFromLocal(key) {
  if (!hasLocalStorage) return undefined;
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    return undefined;
  }
}

function writeToLocal(key, value) {
  if (!hasLocalStorage) return false;
  try {
    if (value == null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
    return true;
  } catch (err) {
    return false;
  }
}

function removeFromLocal(key) {
  if (!hasLocalStorage) return false;
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch (err) {
    return false;
  }
}

export async function writeCompressedJson(key, value) {
  if (!key) return { backend: 'none', bytes: 0 };
  if (value == null) {
    await removeCompressed(key);
    return { backend: 'none', bytes: 0 };
  }

  const json = JSON.stringify(value);
  const u8 = strToU8(json);
  try {
    const compressed = await gzipAsync(u8);
    if (await writeToIndexedDb(key, compressed)) {
      return { backend: 'idb', bytes: compressed.byteLength };
    }
    const encoded = encodeForLocalStorage(compressed);
    if (encoded && writeToLocal(key, encoded)) {
      return { backend: 'localStorage', bytes: compressed.byteLength };
    }
    memoryStore.set(memoryKey(key), compressed);
    return { backend: 'memory', bytes: compressed.byteLength };
  } catch (err) {
    if (writeToLocal(key, `json:${json}`)) {
      return { backend: 'localStorage', bytes: json.length };
    }
    memoryStore.set(memoryKey(key), json);
    return { backend: 'memory', bytes: json.length };
  }
}

export async function readCompressedJson(key) {
  if (!key) return null;
  let raw = await readFromIndexedDb(key);
  if (raw instanceof Uint8Array) {
    try {
      const decompressed = await gunzipAsync(raw);
      return JSON.parse(strFromU8(decompressed));
    } catch (err) {
      // fall through to other backends
    }
  }

  const localValue = readFromLocal(key);
  if (localValue != null) {
    const decoded = decodeFromLocalStorage(localValue);
    if (decoded instanceof Uint8Array) {
      try {
        const decompressed = await gunzipAsync(decoded);
        return JSON.parse(strFromU8(decompressed));
      } catch (err) {
        return null;
      }
    }
    if (typeof decoded === 'string') {
      try {
        return JSON.parse(decoded);
      } catch (err) {
        return null;
      }
    }
  }

  const memoryValue = memoryStore.get(memoryKey(key));
  if (memoryValue instanceof Uint8Array) {
    try {
      const decompressed = await gunzipAsync(memoryValue);
      return JSON.parse(strFromU8(decompressed));
    } catch (err) {
      return null;
    }
  }
  if (typeof memoryValue === 'string') {
    try {
      return JSON.parse(memoryValue);
    } catch (err) {
      return null;
    }
  }

  return null;
}

export async function removeCompressed(key) {
  if (!key) return false;
  const removedIdb = await removeFromIndexedDb(key);
  const removedLocal = removeFromLocal(key);
  const memoryRemoved = memoryStore.delete(memoryKey(key));
  return removedIdb || removedLocal || memoryRemoved;
}

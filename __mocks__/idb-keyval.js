const store = new Map();

async function get(key) {
  return store.get(key);
}

async function set(key, value) {
  store.set(key, value);
}

async function del(key) {
  store.delete(key);
}

module.exports = { get, set, del };

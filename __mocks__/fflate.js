const { TextEncoder, TextDecoder } = require('util');

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toUint8(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') return encoder.encode(data);
  if (Array.isArray(data)) return Uint8Array.from(data);
  return new Uint8Array();
}

function gzip(data, opts, cb) {
  const callback = typeof opts === 'function' ? opts : cb;
  if (typeof callback === 'function') {
    callback(null, toUint8(data));
  }
}

function gunzip(data, opts, cb) {
  const callback = typeof opts === 'function' ? opts : cb;
  if (typeof callback === 'function') {
    callback(null, toUint8(data));
  }
}

function strFromU8(data) {
  return decoder.decode(toUint8(data));
}

function strToU8(str) {
  return encoder.encode(typeof str === 'string' ? str : '');
}

module.exports = { gzip, gunzip, strFromU8, strToU8 };

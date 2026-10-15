const zlib = require('node:zlib');
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const files = [], directory = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = Buffer.from(entry.data || ''), compressed = zlib.deflateRawSync(data), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(entry.flags || 0,6); local.writeUInt16LE(8,8);
    local.writeUInt32LE(crc,14); local.writeUInt32LE(compressed.length,18); local.writeUInt32LE(entry.declaredSize ?? data.length,22); local.writeUInt16LE(name.length,26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314,4); central.writeUInt16LE(20,6); central.writeUInt16LE(entry.flags || 0,8); central.writeUInt16LE(8,10);
    central.writeUInt32LE(crc,16); central.writeUInt32LE(compressed.length,20); central.writeUInt32LE(entry.declaredSize ?? data.length,24); central.writeUInt16LE(name.length,28); central.writeUInt32LE(entry.attributes ?? ((0x81a4 << 16) >>> 0),38); central.writeUInt32LE(offset,42);
    files.push(local,name,compressed); directory.push(central,name); offset += local.length + name.length + compressed.length;
  }
  const listing = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10); end.writeUInt32LE(listing.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...files,listing,end]);
}
module.exports = { zip };

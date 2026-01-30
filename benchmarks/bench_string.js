
const ITER = 1_000_000;
const key = "key12345";
const buf = Buffer.alloc(100);
const len = buf.write(key);
const tempBuf = Buffer.alloc(1024);

console.time('toString');
for(let i=0; i<ITER; i++) {
    const s = buf.toString('utf8', 0, len);
    if (s !== key) throw 'err';
}
console.timeEnd('toString');

console.time('compare');
for(let i=0; i<ITER; i++) {
    const w = tempBuf.write(key, 0, len, 'utf8');
    if (buf.compare(tempBuf, 0, w, 0, len) !== 0) throw 'err';
}
console.timeEnd('compare');

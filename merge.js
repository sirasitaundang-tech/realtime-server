// รวมการแก้ไขจากหลายเครื่อง (3-way merge) ลดปัญหา "คนส่งทีหลังเขียนทับของคนก่อน"
//   base   = สถานะที่เครื่องนั้นเห็นล่าสุดตอนเริ่มแก้
//   theirs = สถานะปัจจุบันบนเซิร์ฟเวอร์ (อาจมีคนอื่นแก้ไปแล้ว)
//   mine   = สถานะที่เครื่องนี้ส่งมา
// กติกา: ฝั่งไหนไม่ได้แก้ → เอาของอีกฝั่ง / แก้คนละช่อง → เก็บทั้งคู่ / แก้ช่องเดียวกัน → เครื่องที่ส่งมาชนะ

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

function stable(x) {
  if (x === undefined) return "u";
  if (Array.isArray(x)) return "[" + x.map(stable).join(",") + "]";
  if (isObj(x)) {
    return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + stable(x[k])).join(",") + "}";
  }
  return JSON.stringify(x);
}
const eq = (a, b) => stable(a) === stable(b);

// จุด (stop) ไม่มี id: ถ้าชื่อไม่ตรงกันแปลว่าถูกแทรก/ย้าย/เปลี่ยนชื่อ ห้ามเอาช่องจากคนละจุดมาผสมกัน
function mergeItem(b, t, m) {
  if (isObj(b) && isObj(t) && isObj(m) && "n" in b && (t.n !== b.n || m.n !== b.n)) {
    return eq(m, b) ? t : m;
  }
  return merge3(b, t, m);
}

function merge3(base, theirs, mine) {
  if (eq(mine, base)) return theirs;
  if (eq(theirs, base)) return mine;
  if (eq(mine, theirs)) return mine;

  if (isObj(theirs) && isObj(mine)) {
    const b = isObj(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const v = merge3(b[k], theirs[k], mine[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  if (Array.isArray(theirs) && Array.isArray(mine) && Array.isArray(base)) {
    const n = base.length;
    if (theirs.length >= n && mine.length >= n) {
      const out = [];
      for (let i = 0; i < n; i++) out.push(mergeItem(base[i], theirs[i], mine[i]));
      const extra = theirs.slice(n);
      const seen = new Set(extra.map(stable));
      for (const x of mine.slice(n)) if (!seen.has(stable(x))) extra.push(x);
      return out.concat(extra);
    }
  }
  return mine;
}

module.exports = { merge3, stable, eq };

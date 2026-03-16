const fs = require('fs');
const html = fs.readFileSync('debug_listado.html', 'utf8');
const reg = /<input[^>]+name="([^"]+)"[^>]*>/g;
let m;
const res = new Set();
while ((m = reg.exec(html)) !== null) {
  res.add(m[1]);
}
console.log([...res].join('\n'));

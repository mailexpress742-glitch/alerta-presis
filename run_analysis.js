const child_process = require('child_process');

if (!process.env.HAS_RESTARTED) {
    try {
        child_process.execSync('node --max-old-space-size=4096 ' + __filename, {
            env: { ...process.env, HAS_RESTARTED: '1' },
            stdio: 'inherit'
        });
    } catch (e) {
        process.exit(1);
    }
    process.exit(0);
}

const fs = require('fs');
const stripHtml = (s) => s ? Buffer.from(s.replace(/<[^>]+>/g, '').trim()).toString('utf8') : '';
let htmlContent = fs.readFileSync('export.csv', 'utf8');

let headers = [];
const theadStart = htmlContent.indexOf('<thead');
const theadEnd = htmlContent.indexOf('</thead');
if (theadStart !== -1 && theadEnd !== -1) {
    const thead = htmlContent.substring(theadStart, theadEnd);
    const thMatches = [...thead.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
    headers = thMatches.map(m => stripHtml(m[1]));
}

const idxGuia = headers.indexOf('Nro Guia');
const idxEstado = headers.indexOf('Estado');
const idxFechaPactada = headers.indexOf('Fecha Pactada');

const tbodyStart = htmlContent.indexOf('<tbody');
const tbodyEnd = htmlContent.indexOf('</tbody', tbodyStart);

let currentIdx = tbodyStart !== -1 ? tbodyStart : 0;
const endLimit = tbodyEnd !== -1 ? tbodyEnd : htmlContent.length;

const uniqueGuias = new Set();
let totalCriticos = 0;
let estadosCriticos = {};

const hoy = new Date();
hoy.setHours(0, 0, 0, 0);
const limiteInferior = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

while (currentIdx !== -1 && currentIdx < endLimit) {
    const trStart = htmlContent.indexOf('<tr', currentIdx);
    if (trStart === -1 || trStart > endLimit) break;
    const trEnd = htmlContent.indexOf('</tr>', trStart);
    if (trEnd === -1) break;
    
    const trStr = htmlContent.substring(trStart, trEnd);
    currentIdx = trEnd + 5;
    
    const tds = [];
    let tdCur = 0;
    while (true) {
        const tdS = trStr.indexOf('<td', tdCur);
        if (tdS === -1) break;
        const tdClose = trStr.indexOf('>', tdS);
        if (tdClose === -1) break;
        const tdE = trStr.indexOf('</td>', tdClose);
        if (tdE === -1) break;
        tds.push(stripHtml(trStr.substring(tdClose + 1, tdE)));
        tdCur = tdE + 5;
    }
    
    if (tds.length < 10) continue;
    
    const fechaPactadaStr = tds[idxFechaPactada];
    const estado = tds[idxEstado];
    const guia = tds[idxGuia];
    
    if (!fechaPactadaStr) continue;

    const estadosPermitidos = [
        'Esperando programación', 'En transito', 'Falla mecánica', 'En ruta para su entrega',
        'No se encuentra', 'Despachado', 'Retirado por el dist', 'Reprogramacion por no visita',
        'Sin visita', 'Despachado al int', '1 visita sin contacto'
    ];

    const estadoValido = estadosPermitidos.some(e => estado.toLowerCase().includes(e.toLowerCase()));
    if (!estadoValido) continue;
    
    let datePactada;
    if (fechaPactadaStr.includes('-')) {
        const p = fechaPactadaStr.split('-');
        datePactada = new Date(p[0], p[1] - 1, p[2]);
    } else if (fechaPactadaStr.includes('/')) {
        const p = fechaPactadaStr.split('/');
        datePactada = new Date(p[2], p[1] - 1, p[0]);
    }
    
    if (!datePactada || isNaN(datePactada.getTime())) continue;
    
    if (datePactada < limiteInferior) continue;

    const utcHoy = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const utcPactada = Date.UTC(datePactada.getFullYear(), datePactada.getMonth(), datePactada.getDate());
    const diffDays = Math.floor((utcPactada - utcHoy) / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 0) {
        totalCriticos++;
        uniqueGuias.add(guia);
        const est = estado.replace(/^\d+-/, '').substring(0, 30);
        estadosCriticos[est] = (estadosCriticos[est] || 0) + 1;
    }
}

console.log("Total Críticos contados:", totalCriticos);
console.log("Total Guías Únicas:", uniqueGuias.size);
console.log("Desglose por Estado:");
const sortedEstados = Object.entries(estadosCriticos).sort((a, b) => b[1] - a[1]);
sortedEstados.forEach(e => console.log(` - ${e[0]}: ${e[1]}`));

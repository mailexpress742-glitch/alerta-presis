const child_process = require('child_process');

if (!process.env.HAS_RESTARTED) {
    console.log("Reiniciando el parser con 4GB de memoria limite para procesar el archivo gigante...");
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

require('dotenv').config();
const fs = require('fs');
const nodemailer = require('nodemailer');

async function procesarAlertas() {
    console.log("Parseando HTML con String Loop de bajo consumo de memoria...");
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
    const idxCliente = headers.indexOf('Remitente') !== -1 ? headers.indexOf('Remitente') : headers.indexOf('Cliente'); 
    const idxRemito = headers.indexOf('Remito');
    const idxEstado = headers.indexOf('Estado');
    const idxFechaPactada = headers.indexOf('Fecha Pactada');
    const idxFechaIngreso = headers.indexOf('Fecha'); 
    
    console.log(`Indices detectados - Guia: ${idxGuia}, Pactada: ${idxFechaPactada}, Estado: ${idxEstado}`);

    const alertas = [];
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const tbodyStart = htmlContent.indexOf('<tbody');
    const tbodyEnd = htmlContent.indexOf('</tbody', tbodyStart);
    
    let currentIdx = tbodyStart !== -1 ? tbodyStart : 0;
    const endLimit = tbodyEnd !== -1 ? tbodyEnd : htmlContent.length;
    let count = 0;
    
    console.log("Iniciando bucle de extraccion rapida...");
    
    while (currentIdx !== -1 && currentIdx < endLimit) {
        const trStart = htmlContent.indexOf('<tr', currentIdx);
        if (trStart === -1 || trStart > endLimit) break;
        
        const trEnd = htmlContent.indexOf('</tr>', trStart);
        if (trEnd === -1) break;
        
        const trStr = htmlContent.substring(trStart, trEnd);
        currentIdx = trEnd + 5;
        count++;
        
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
        const fechaIngresoStr = tds[idxFechaIngreso];
        const estado = tds[idxEstado];
        
        if (!fechaPactadaStr || !fechaIngresoStr) continue;

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
        datePactada.setHours(0, 0, 0, 0);

        const limiteInferior = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        if (datePactada < limiteInferior) continue;

        const utcHoy = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
        const utcPactada = Date.UTC(datePactada.getFullYear(), datePactada.getMonth(), datePactada.getDate());
        const diffDays = Math.floor((utcPactada - utcHoy) / (1000 * 60 * 60 * 24));
        
        let categoria = 'PROXIMO';
        if (diffDays <= 0) categoria = 'CRITICO';
        else if (diffDays <= 2) categoria = 'ADVERTENCIA';

        const d = datePactada.getDate().toString().padStart(2, '0');
        const m = (datePactada.getMonth() + 1).toString().padStart(2, '0');
        const pactadaSalida = `${d}/${m}/${datePactada.getFullYear()}`;

        alertas.push({
            guia: tds[idxGuia],
            remito: tds[idxRemito],
            cliente: tds[idxCliente].substring(0, 30),
            estado: estado.replace(/^\d+-/, '').substring(0, 30),
            fechaPactada: pactadaSalida,
            categoria: categoria
        });
    }

    // Separar y ordenar para priorizar lo de HOY
    const criticos = alertas.filter(a => a.categoria === 'CRITICO').sort((a, b) => {
        const [da, ma, ya] = a.fechaPactada.split('/').map(Number);
        const [db, mb, yb] = b.fechaPactada.split('/').map(Number);
        return new Date(yb, mb - 1, db) - new Date(ya, ma - 1, da); // Descendente
    });
    const advertencias = alertas.filter(a => a.categoria === 'ADVERTENCIA').sort((a, b) => {
        const [da, ma, ya] = a.fechaPactada.split('/').map(Number);
        const [db, mb, yb] = b.fechaPactada.split('/').map(Number);
        return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db); // Ascendente
    });
    const proximos = alertas.filter(a => a.categoria === 'PROXIMO').sort((a, b) => {
        const [da, ma, ya] = a.fechaPactada.split('/').map(Number);
        const [db, mb, yb] = b.fechaPactada.split('/').map(Number);
        return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db); // Ascendente
    });

    const hoyStr = `${hoy.getDate().toString().padStart(2, '0')}/${(hoy.getMonth()+1).toString().padStart(2, '0')}/${hoy.getFullYear()}`;
    const hoyCount = criticos.filter(a => a.fechaPactada === hoyStr).length;

    console.log(`Resumen Final - HOY (${hoyStr}): ${hoyCount}, CRITICOS TOTAL: ${criticos.length}, ADVERTENCIAS: ${advertencias.length}, PROXIMOS: ${proximos.length}`);

    const nombresMeses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const nombreMesActual = nombresMeses[hoy.getMonth()];

    let emailHtml = `
      <div style="font-family:Arial,sans-serif;color:#333;max-width:800px;margin:0 auto">
        <h2>Reporte Diario Presis (${new Date().toLocaleDateString()})</h2>
        <p>Categorización de guías por Fecha Pactada (Mes de ${nombreMesActual} y pendientes del mes anterior):</p>
    `;
    
    const renderTable = (lista, tituloHtml, color, limite = 30) => {
        if (lista.length === 0) return '';
        const items = lista.slice(0, limite);
        let htmlSnippet = `
          <div style="margin-top:20px;margin-bottom:5px;font-weight:bold;color:${color}">
            ${tituloHtml} (Mostrando ${items.length} de ${lista.length})
          </div>
          <table style="width:100%;border-collapse:collapse;border:1px solid #000" border="1" cellspacing="0" cellpadding="5">
            <tr style="background:#eee;font-size:12px">
              <th style="border:1px solid #000">Guia</th>
              <th style="border:1px solid #000">Remito</th>
              <th style="border:1px solid #000">Cliente</th>
              <th style="border:1px solid #000">Pactada</th>
              <th style="border:1px solid #000">Estado</th>
            </tr>
        `;
        
        items.forEach(a => {
            htmlSnippet += `
              <tr style="font-size:11px">
                <td style="border:1px solid #000">${a.guia}</td>
                <td style="border:1px solid #000">${a.remito}</td>
                <td style="border:1px solid #000">${a.cliente}</td>
                <td style="border:1px solid #000;text-align:center">${a.fechaPactada}</td>
                <td style="border:1px solid #000">${a.estado}</td>
              </tr>
            `;
        });
        htmlSnippet += `</table>`;
        return htmlSnippet;
    };

    emailHtml += renderTable(criticos, '🔴 CRÍTICO (HOY o VENCIDAS)', '#d32f2f');
    emailHtml += renderTable(advertencias, '🟡 PRÓXIMAS 48 HORAS', '#f57f17');
    emailHtml += renderTable(proximos, '🟢 PRÓXIMA SEMANA', '#388e3c');
    emailHtml += `</div>`;

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    if (process.env.SMTP_USER) {
        console.log("Enviando email...");
        try {
            const info = await transporter.sendMail({
                from: `"Presis Bot" <${process.env.SMTP_USER}>`,
                to: process.env.REPORT_EMAILS || 'destinatario@ejemplo.com',
                subject: `Alerta Presis - ${criticos.length} CRÍTICAS | ${advertencias.length} ADVERTENCIAS`,
                html: emailHtml,
            });
            console.log("Correo enviado:", info.messageId);
        } catch(e) {
            console.error("Error enviando correo:", e);
        }
    } else {
        console.log("No se configuraron variables de entorno SMTP. Saltando envío.");
    }
}

procesarAlertas().catch(console.error);


const child_process = require('child_process');

if (!process.env.HAS_RESTARTED) {
    console.log("Reiniciando el parser con 4GB de memoria limite para procesar el archivo gigante...");
    try {
        child_process.execSync('node --max-old-space-size=4096 "' + __filename + '" ' + process.argv.slice(2).join(' '), {
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

const emailsLogistica = {
    'Mendoza': ['traficomendoza@mailexpress.com.ar', 'gestionlogistica@mailexpress.com.ar', 'gquijada@mailexpress.com.ar'],
    'Bs As': ['Pnavarro@mailexpress.com.ar', 'buenosaires@mailexpress.com.ar'],
    'San Juan': ['mflores@mailexpress.com.ar', 'gquiroga@mailexpress.com.ar'],
    'San Rafael': ['ftorres@mailexpress.com.ar', 'sanrafael@mailexpress.com.ar'],
    'San Luis': ['atcsanluis@mailexpress.com.ar', 'traficosl@mailexpress.com.ar'],
    'Cordoba': ['Traficocba@mailexpress.com.ar'],
    'Santa Fe': ['galvarez@mailexpress.com.ar', 'naeberhard@mailexpress.com.ar'],
    'Rosario': ['lzabala@mailexpress.com.ar'],
    'Parana': ['naeberhard@mailexpress.com.ar'],
    'Resto del pais': ['gestionlogistica@mailexpress.com.ar', 'gquijada@mailexpress.com.ar']
};

const emailsPostal = {
    'Mendoza': ['acabello@mailexpress.com.ar', 'psiarri@mailexpress.com.ar'],
    'Bs As': ['Tquijano@mailexpress.com.ar', 'gquijano@mailexpress.com.ar', 'mfernandez@mailexpress.com.ar'],
    'San Juan': ['mflores@mailexpress.com.ar', 'auditorsj@mailexpress.com.ar'],
    'San Rafael': ['ftorres@mailexpress.com.ar', 'sanrafael@mailexpress.com.ar'],
    'San Luis': ['atcsanluis@mailexpress.com.ar', 'cganen@mailexpress.com.ar'],
    'Cordoba': ['pmalvezzi@mailexpress.com.ar', 'operacionescba@mailexpress.com.ar'],
    'Santa Fe': ['Vanina.cabral@mailexpress.com.ar', 'naeberhard@mailexpress.com.ar'],
    'Rosario': ['Vanina.cabral@mailexpress.com.ar'],
    'Parana': ['naeberhard@mailexpress.com.ar'],
    'Resto del pais': ['acabello@mailexpress.com.ar']
};

function clasificarSucursal(suc) {
    if (!suc) return 'Resto del pais';
    const s = suc.toUpperCase();
    if (s.includes('MZA') || s.includes('MENDOZA') || s.includes('DORREGO')) return 'Mendoza';
    if (s.includes('CABA') || s.includes('BS AS') || s.includes('BUENOS AIRES') || s.includes('FERR')) return 'Bs As';
    if (s.includes('SAN JUAN') || s.includes('RAWSON')) return 'San Juan';
    if (s.includes('SAN RAFAEL')) return 'San Rafael';
    if (s.includes('SAN LUIS') || s.includes('VILLA MERCEDES')) return 'San Luis';
    if (s.includes('CORDOBA') || s.includes('CBA')) return 'Cordoba';
    if (s.includes('SANTA FE')) return 'Santa Fe';
    if (s.includes('ROSARIO')) return 'Rosario';
    if (s.includes('PARANA')) return 'Parana';
    return 'Resto del pais';
}

async function procesarAlertas() {
    console.log("Parseando CSV real con readline de bajo consumo de memoria...");
    const readline = require('readline');

    const sectorParams = process.argv[2] || 'logistica';
    const sectorTitle = sectorParams.toUpperCase();
    const filename = `export_${sectorParams}.csv`;
    
    if (!fs.existsSync(filename)) {
        console.error("No se encontro archivo:", filename);
        return;
    }

    const hoy = new Date();
    let alertasPorSucursal = {};
    let count = 0;
    
    let headers = [];
    let idxGuia, idxCliente, idxRemito, idxEstado, idxDomicilio, idxSucursal, idxFechaPactada, idxFechaIngreso;
    
    const parseCsvLine = (text) => {
        let ret = [];
        let inQuote = false;
        let value = '';
        for (let i = 0; i < text.length; i++) {
            let char = text[i];
            if (inQuote) {
                if (char === '"' && i + 1 < text.length && text[i+1] === '"') {
                    value += '"';
                    i++;
                } else if (char === '"') {
                    inQuote = false;
                } else {
                    value += char;
                }
            } else {
                if (char === '"') {
                    inQuote = true;
                } else if (char === ';') {
                    ret.push(value.trim());
                    value = '';
                } else {
                    value += char;
                }
            }
        }
        ret.push(value.trim());
        return ret;
    };

    const fileStream = fs.createReadStream(filename);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let isFirstLine = true;
    for await (const line of rl) {
        if (!line.trim()) continue;
        const tds = parseCsvLine(line);
        
        if (isFirstLine) {
            headers = tds;
            idxGuia = headers.indexOf('Nro Guia');
            idxCliente = headers.indexOf('Remitente') !== -1 ? headers.indexOf('Remitente') : headers.indexOf('Cliente'); 
            idxRemito = headers.indexOf('Remito');
            idxEstado = headers.indexOf('Estado');
            idxDomicilio = headers.indexOf('Domicilio');
            idxSucursal = headers.indexOf('Sucursal');
            idxFechaPactada = headers.indexOf('Fecha Pactada');
            idxFechaIngreso = headers.indexOf('Fecha');
            console.log(`Indices detectados - Guia: ${idxGuia}, Pactada: ${idxFechaPactada}, Estado: ${idxEstado}, Sucursal: ${idxSucursal}`);
            isFirstLine = false;
            continue;
        }
        
        count++;
        if (tds.length < 10) continue;
        
        const fechaPactadaStr = tds[idxFechaPactada];
        const fechaIngresoStr = tds[idxFechaIngreso];
        const estado = tds[idxEstado];
        const sucursalTexto = idxSucursal !== -1 ? tds[idxSucursal] : '';
        
        if (!fechaPactadaStr || !fechaIngresoStr) continue;

        const estadosPermitidos = [
            'Esperando programacion', 'Esperando programación', 'En transito', 'Falla mecanica', 'Falla mecánica', 
            'En ruta para su entrega', 'No se encuentra', 'Despachado', 'Retirado por el dist', 
            'Reprogramacion por no visita', 'Sin visita', 'Despachado al int', '1 visita sin contacto'
        ];

        const estadoValido = estadosPermitidos.some(e => estado.toLowerCase().includes(e.toLowerCase()));
        if (!estadoValido) continue;
        
        let datePactada;
        if (fechaPactadaStr.includes('/')) {
            const parts = fechaPactadaStr.split('/');
            if (parts.length >= 3) {
                datePactada = new Date(parts[2].substring(0,4), parts[1] - 1, parts[0]);
            }
        }
        if (!datePactada || isNaN(datePactada.getTime())) continue;

        const dDiff = Math.ceil((hoy - datePactada) / (1000 * 60 * 60 * 24));
        if (dDiff >= 1) {
            let sucLlave = mapearSucursal(sucursalTexto);
            if (!alertasPorSucursal[sucLlave]) alertasPorSucursal[sucLlave] = [];
            alertasPorSucursal[sucLlave].push(tds);
        }
    }

    ﻿const child_process = require('child_process');

if (!process.env.HAS_RESTARTED) {
    console.log("Reiniciando el parser con 4GB de memoria limite para procesar el archivo gigante...");
    try {
        child_process.execSync('node --max-old-space-size=4096 "' + __filename + '" ' + process.argv.slice(2).join(' '), {
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

const emailsLogistica = {
    'Mendoza': ['traficomendoza@mailexpress.com.ar', 'gestionlogistica@mailexpress.com.ar', 'gquijada@mailexpress.com.ar'],
    'Bs As': ['Pnavarro@mailexpress.com.ar', 'buenosaires@mailexpress.com.ar'],
    'San Juan': ['mflores@mailexpress.com.ar', 'gquiroga@mailexpress.com.ar'],
    'San Rafael': ['ftorres@mailexpress.com.ar', 'sanrafael@mailexpress.com.ar'],
    'San Luis': ['atcsanluis@mailexpress.com.ar', 'traficosl@mailexpress.com.ar'],
    'Cordoba': ['Traficocba@mailexpress.com.ar'],
    'Santa Fe': ['galvarez@mailexpress.com.ar', 'naeberhard@mailexpress.com.ar'],
    'Rosario': ['lzabala@mailexpress.com.ar'],
    'Parana': ['naeberhard@mailexpress.com.ar'],
    'Resto del pais': ['gestionlogistica@mailexpress.com.ar', 'gquijada@mailexpress.com.ar']
};

const emailsPostal = {
    'Mendoza': ['acabello@mailexpress.com.ar', 'psiarri@mailexpress.com.ar'],
    'Bs As': ['Tquijano@mailexpress.com.ar', 'gquijano@mailexpress.com.ar', 'mfernandez@mailexpress.com.ar'],
    'San Juan': ['mflores@mailexpress.com.ar', 'auditorsj@mailexpress.com.ar'],
    'San Rafael': ['ftorres@mailexpress.com.ar', 'sanrafael@mailexpress.com.ar'],
    'San Luis': ['atcsanluis@mailexpress.com.ar', 'cganen@mailexpress.com.ar'],
    'Cordoba': ['pmalvezzi@mailexpress.com.ar', 'operacionescba@mailexpress.com.ar'],
    'Santa Fe': ['Vanina.cabral@mailexpress.com.ar', 'naeberhard@mailexpress.com.ar'],
    'Rosario': ['Vanina.cabral@mailexpress.com.ar'],
    'Parana': ['naeberhard@mailexpress.com.ar'],
    'Resto del pais': ['acabello@mailexpress.com.ar']
};

function clasificarSucursal(suc) {
    if (!suc) return 'Resto del pais';
    const s = suc.toUpperCase();
    if (s.includes('MZA') || s.includes('MENDOZA') || s.includes('DORREGO')) return 'Mendoza';
    if (s.includes('CABA') || s.includes('BS AS') || s.includes('BUENOS AIRES') || s.includes('FERR')) return 'Bs As';
    if (s.includes('SAN JUAN') || s.includes('RAWSON')) return 'San Juan';
    if (s.includes('SAN RAFAEL')) return 'San Rafael';
    if (s.includes('SAN LUIS') || s.includes('VILLA MERCEDES')) return 'San Luis';
    if (s.includes('CORDOBA') || s.includes('CBA')) return 'Cordoba';
    if (s.includes('SANTA FE')) return 'Santa Fe';
    if (s.includes('ROSARIO')) return 'Rosario';
    if (s.includes('PARANA')) return 'Parana';
    return 'Resto del pais';
}

async function procesarAlertas() {
    console.log("Parseando HTML con String Loop de bajo consumo de memoria...");
    const stripHtml = (s) => s ? Buffer.from(s.replace(/<[^>]+>/g, '').trim()).toString('utf8') : '';

    const sectorParams = process.argv[2] || 'logistica';
    const sectorTitle = sectorParams.toUpperCase();
    const filename = `export_${sectorParams}.csv`;
    let htmlContent;
    try {
        htmlContent = fs.readFileSync(filename, 'utf8');
    } catch (e) {
        console.error("No se encontro archivo:", filename);
        return;
    }
    
    let headers = [];
    const theadStart = htmlContent.indexOf('<thead');
    if (theadStart === -1) {
        console.error("No se encontro THEAD");
        return;
    }
    const theadEnd = htmlContent.indexOf('</thead', theadStart);
    const theadStr = htmlContent.substring(theadStart, theadEnd);
    let hCur = 0;
    while (true) {
        const thS = theadStr.indexOf('<th', hCur);
        if (thS === -1) break;
        const thClose = theadStr.indexOf('>', thS);
        if (thClose === -1) break;
        const thE = theadStr.indexOf('</th>', thClose);
        if (thE === -1) break;
        headers.push(stripHtml(theadStr.substring(thClose + 1, thE)));
        hCur = thE + 5;
    }

    const idxGuia = headers.indexOf('Nro Guia');
    const idxCliente = headers.indexOf('Remitente') !== -1 ? headers.indexOf('Remitente') : headers.indexOf('Cliente'); 
    const idxRemito = headers.indexOf('Remito');
    const idxEstado = headers.indexOf('Estado');
    const idxDomicilio = headers.indexOf('Domicilio');
    const idxSucursal = headers.indexOf('Sucursal');
    const idxFechaPactada = headers.indexOf('Fecha Pactada');
    const idxFechaIngreso = headers.indexOf('Fecha'); 

    console.log(`Indices detectados - Guia: ${idxGuia}, Pactada: ${idxFechaPactada}, Estado: ${idxEstado}, Sucursal: ${idxSucursal}`);

    let currentIdx = theadEnd;
    let endLimit = htmlContent.indexOf('</table', currentIdx);
    if (endLimit === -1) endLimit = htmlContent.length;

    const hoy = new Date();
    let alertasPorSucursal = {};

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
        const sucursalTexto = idxSucursal !== -1 ? tds[idxSucursal] : '';
        
        if (!fechaPactadaStr || !fechaIngresoStr) continue;

        const estadosPermitidos = [
            'Esperando programacin', 'En transito', 'Falla mecnica', 'En ruta para su entrega',
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

        const sucursalFinal = clasificarSucursal(sucursalTexto);
        if (!alertasPorSucursal[sucursalFinal]) {
            alertasPorSucursal[sucursalFinal] = [];
        }

        alertasPorSucursal[sucursalFinal].push({
            guia: tds[idxGuia],
            remito: tds[idxRemito],
            cliente: tds[idxCliente].substring(0, 30),
            domicilio: idxDomicilio !== -1 ? tds[idxDomicilio].substring(0, 40) : '',
            estado: estado.replace(/^\d+-/, '').substring(0, 30),
            fechaPactada: pactadaSalida,
            categoria: categoria
        });
    }

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    const nombresMeses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const nombreMesActual = nombresMeses[hoy.getMonth()];

    for (const [sucursal, alertasDeSucursal] of Object.entries(alertasPorSucursal)) {
        const criticos = alertasDeSucursal.filter(a => a.categoria === 'CRITICO').sort((a, b) => {
            const [da, ma, ya] = a.fechaPactada.split('/').map(Number);
            const [db, mb, yb] = b.fechaPactada.split('/').map(Number);
            return new Date(yb, mb - 1, db) - new Date(ya, ma - 1, da); 
        });
        const advertencias = alertasDeSucursal.filter(a => a.categoria === 'ADVERTENCIA').sort((a, b) => {
            const [da, ma, ya] = a.fechaPactada.split('/').map(Number);
            const [db, mb, yb] = b.fechaPactada.split('/').map(Number);
            return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db); 
        });
        const proximos = alertasDeSucursal.filter(a => a.categoria === 'PROXIMO').sort((a, b) => {
            const [da, ma, ya] = a.fechaPactada.split('/').map(Number);
            const [db, mb, yb] = b.fechaPactada.split('/').map(Number);
            return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db); 
        });

        // Solo enviar si hay alertas!
        if (criticos.length === 0 && advertencias.length === 0) continue;

        let emailHtml = `
          <div style="font-family:Arial,sans-serif;color:#333;max-width:800px;margin:0 auto">
            <h2>Reporte Diario Presis ${sectorTitle} - ${sucursal} (${new Date().toLocaleDateString()})</h2>
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
                  <th style="border:1px solid #000">Domicilio</th>
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
                    <td style="border:1px solid #000">${a.domicilio}</td>
                    <td style="border:1px solid #000;text-align:center">${a.fechaPactada}</td>
                    <td style="border:1px solid #000">${a.estado}</td>
                  </tr>
                `;
            });
            htmlSnippet += `</table>`;
            return htmlSnippet;
        };

        emailHtml += renderTable(criticos, '🚨 CRÍTICO (HOY o VENCIDAS)', '#d32f2f');
        emailHtml += renderTable(advertencias, '⚠️ PRÓXIMAS 48 HORAS', '#f57f17');
        emailHtml += renderTable(proximos, '🟢 PRÓXIMA SEMANA', '#388e3c');
        emailHtml += `</div>`;

        let destinos = [];
        if (sectorParams === 'postal' && emailsPostal[sucursal]) {
            destinos = emailsPostal[sucursal];
        } else if (sectorParams === 'logistica' && emailsLogistica[sucursal]) {
            destinos = emailsLogistica[sucursal];
        }

        if (destinos.length === 0) {
            console.log(`No hay correos configurados para ${sucursal} (${sectorTitle}). Saltando.`);
            continue;
        }

        if (process.env.SMTP_USER) {
            console.log(`Enviando email a ${sucursal} (${sectorTitle})...`);
            try {
                const info = await transporter.sendMail({
                    from: `"Presis Bot" <${process.env.SMTP_USER}>`,
                    to: destinos.join(', '),
                    cc: process.env.REPORT_EMAILS || '',
                    subject: `Alerta Presis ${sectorTitle} [${sucursal}] - ${criticos.length} CRÍTICAS | ${advertencias.length} ADVERTENCIAS`,
                    html: emailHtml,
                });
                console.log(`Correo enviado a ${sucursal}:`, info.messageId);
            } catch(e) {
                console.error(`Error enviando correo a ${sucursal}:`, e);
            }
        }
    }
}


}
procesarAlertas().catch(console.error);

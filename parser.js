require('dotenv').config();
const fs = require('fs');
const cheerio = require('cheerio');

async function procesarAlertas() {
    console.log("Leyendo archivo export.csv...");
    const htmlContent = fs.readFileSync('export.csv', 'utf8');
    
    console.log("Parseando HTML con Cheerio...");
    const $ = cheerio.load(htmlContent);
    
    const alertas = [];
    
    // Mapeo dinamico de headers
    const headers = [];
    $('thead th').each((i, th) => {
        headers.push($(th).text().trim());
    });
    
    // Indices de interés
    const idxGuia = headers.indexOf('Nro Guia');
    const idxCliente = headers.indexOf('Remitente') !== -1 ? headers.indexOf('Remitente') : headers.indexOf('Cliente'); 
    const idxRemito = headers.indexOf('Remito');
    const idxEstado = headers.indexOf('Estado');
    const idxFechaPactada = headers.indexOf('Fecha Pactada');
    const idxFechaIngreso = headers.indexOf('Fecha'); 
    
    console.log(`Indices detectados - Guia: ${idxGuia}, Pactada: ${idxFechaPactada}, Estado: ${idxEstado}`);

    const rows = $('tbody tr');
    console.log(`Se encontraron ${rows.length} registros. Procesando...`);
    
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    // Clasificación y Filtrado
    rows.each((i, row) => {
        const cols = $(row).find('td');
        if (cols.length < 10) return;
        
        const fechaPactadaStr = $(cols[idxFechaPactada]).text().trim();
        const fechaIngresoStr = $(cols[idxFechaIngreso]).text().trim();
        const estado = $(cols[idxEstado]).text().trim();
        
        if (!fechaPactadaStr || !fechaIngresoStr) return;

        const estadosPermitidos = [
            'Esperando programación', 'En transito', 'Falla mecánica', 'En ruta para su entrega',
            'No se encuentra', 'Despachado', 'Retirado por el dist', 'Reprogramacion por no visita',
            'Sin visita', 'Despachado al int', '1 visita sin contacto'
        ];

        const estadoValido = estadosPermitidos.some(e => estado.toLowerCase().includes(e.toLowerCase()));
        if (!estadoValido) return; 
        
        let datePactada;
        if (fechaPactadaStr.includes('-')) {
            const p = fechaPactadaStr.split('-');
            datePactada = new Date(p[0], p[1] - 1, p[2]);
        } else if (fechaPactadaStr.includes('/')) {
            const p = fechaPactadaStr.split('/');
            datePactada = new Date(p[2], p[1] - 1, p[0]);
        }
        
        if (!datePactada || isNaN(datePactada.getTime())) return;
        datePactada.setHours(0, 0, 0, 0);

        // --- FILTRO DE MES ---
        if (datePactada.getFullYear() < 2026) return;
        if (datePactada.getFullYear() === 2026 && datePactada.getMonth() < hoy.getMonth()) return;

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
            guia: $(cols[idxGuia]).text().trim(),
            remito: $(cols[idxRemito]).text().trim(),
            cliente: $(cols[idxCliente]).text().trim().substring(0, 30),
            estado: estado.replace(/^\d+-/, '').substring(0, 30),
            fechaPactada: pactadaSalida,
            categoria: categoria
        });
    });
    
    // Separar y ordenar para priorizar lo de HOY
    const criticos = alertas.filter(a => a.categoria === 'CRITICO').sort((a, b) => {
        // Ordenamos por fecha descendente (lo más nuevo arriba)
        // Pero queremos que lo de HOY (11/03) esté arriba de todo.
        const [da, ma, ya] = a.fechaPactada.split('/').map(Number);
        const [db, mb, yb] = b.fechaPactada.split('/').map(Number);
        const dateA = new Date(ya, ma - 1, da);
        const dateB = new Date(yb, mb - 1, db);
        return dateB - dateA; // Descendente: 11/03 antes que 09/03
    });
    const advertencias = alertas.filter(a => a.categoria === 'ADVERTENCIA').sort((a, b) => {
        const [da, ma, ya] = a.fechaPactada.split('/').map(Number);
        const [db, mb, yb] = b.fechaPactada.split('/').map(Number);
        return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db); // Ascendente (12/03 antes que 13/03)
    });
    const proximos = alertas.filter(a => a.categoria === 'PROXIMO').sort((a, b) => {
        const [da, ma, ya] = a.fechaPactada.split('/').map(Number);
        const [db, mb, yb] = b.fechaPactada.split('/').map(Number);
        return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db); // Ascendente
    });
    
    const hoyStr = `${hoy.getDate().toString().padStart(2, '0')}/${(hoy.getMonth()+1).toString().padStart(2, '0')}/${hoy.getFullYear()}`;
    const hoyCount = criticos.filter(a => a.fechaPactada === hoyStr).length;

    console.log(`Resumen Final - HOY (${hoyStr}): ${hoyCount}, CRITICOS TOTAL: ${criticos.length}, ADVERTENCIAS: ${advertencias.length}, PROXIMOS: ${proximos.length}`);
    console.log("Primeros Criticos (ordenados):", criticos.slice(0, 5).map(a => `${a.guia}: ${a.fechaPactada}`));

    let emailHtml = `
      <div style="font-family:Arial,sans-serif;color:#333;max-width:800px;margin:0 auto">
        <h2>Reporte Diario Presis (${new Date().toLocaleDateString()})</h2>
        <p>Categorización de guías por Fecha Pactada (Solo mes de Marzo):</p>
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
    emailHtml += renderTable(advertencias, '🟠 PRÓXIMAS 48 HORAS', '#f57f17');
    emailHtml += renderTable(proximos, '🟢 PRÓXIMA SEMANA', '#388e3c');
    emailHtml += `</div>`;

    // Guardar el reporte HTML para verlo
    fs.writeFileSync('reporte.html', emailHtml);
    console.log("Reporte generado en reporte.html.");

    // Nodemailer
    const nodemailer = require('nodemailer');
    
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

procesarAlertas();

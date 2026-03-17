require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function scrapePresis() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  console.log("Navegando al login...");
  await page.goto('https://mexlv.epresis.com/login');
  
  // Login usando variables de entorno o credenciales por defecto
  const user = process.env.PRESIS_USER || 'airisarri';
  const pass = process.env.PRESIS_PASS || 'Airisarri2026.';
  
  await page.fill('input[type="text"]', user);
  await page.fill('input[type="password"]', pass);
  await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => console.log('Timeout navigation ignorado')),
      page.click('text=Ingresar')
  ]);
  
  console.log("Login exitoso.");

  console.log("Navegando a listado de multiitems...");
  await page.goto('https://mexlv.epresis.com/guias/multiitems/listado', { waitUntil: 'load' });
  
  console.log("Esperando que cargue la página...");
  await page.waitForTimeout(3000); // Dar tiempo para que los scripts de la página terminen

  // Capturamos el HTML para debug si es necesario
  const html = await page.content();
  fs.writeFileSync('debug_listado.html', html);

  // Tomar screenshot del estado inicial (toda la página)
  await page.screenshot({ path: 'debug_01_loaded.png', fullPage: true });

  console.log("Aplicando filtros con API nativa...");
  try {
      await page.waitForSelector('.btn-buscar', { state: 'attached' });
      // Esperar que el modal inicial desaparezca
      await page.waitForSelector('#pleaseWaitDialog', { state: 'hidden', timeout: 30000 }).catch(() => {});

      console.log("Llenando fecha_pactada nativamente...");
      const fechaLocator = page.locator('input[name="fecha_pactada"]');
      
      // Calcular fechas dinamicamente
      const formatLoc = (d) => {
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const yyyy = d.getFullYear();
          return `${dd}/${mm}/${yyyy}`;
      };
      
      const hoy = new Date();
      const hace30Dias = new Date(hoy);
      hace30Dias.setDate(hoy.getDate() - 30);
      
      const en30Dias = new Date(hoy);
      en30Dias.setDate(hoy.getDate() + 30);
      
      const dateRangeStr = `${formatLoc(hace30Dias)} - ${formatLoc(en30Dias)}`;
      console.log(`Aplicando rango de fechas dinámico: ${dateRangeStr}`);

      await fechaLocator.waitFor({ state: 'visible' });
      await fechaLocator.click(); // Open daterangepicker
      await page.keyboard.type(dateRangeStr);
      await page.keyboard.press('Enter'); // Apply daterangepicker selection
      
      console.log("Tomando screenshot para ver los inputs llenos...");
      await page.screenshot({ path: 'debug_01b_after_fill.png', fullPage: true });

      console.log("Haciendo click en Buscar...");
      await page.evaluate(() => document.querySelector('.btn-buscar').click());
      
      console.log("Esperando que aparezca modal de carga y luego desaparezca...");
      await page.waitForTimeout(1000); 
      await page.waitForSelector('#pleaseWaitDialog', { state: 'hidden', timeout: 60000 }).catch(() => {});
      
      console.log("Esperando que la tabla termine de cargar (Cargando, espere por favor...)");
      await page.waitForFunction(() => !document.body.innerText.includes('Cargando, espere por favor'), { timeout: 60000 }).catch(() => {});
      
      await page.screenshot({ path: 'debug_02_after_buscar_final.png', fullPage: true });
  } catch (e) {
      console.log("Error durante filtros o Buscar:", e.message);
  }

      const finalHtml = await page.content();
      fs.writeFileSync('debug_listado_final.html', finalHtml);
      
      const botonesExportar = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('a, button'));
          return els.map(e => ({
              tag: e.tagName,
              text: e.innerText.trim(),
              className: e.className,
              href: e.href,
              onclick: e.getAttribute('onclick')
          })).filter(o => o.text.toLowerCase().includes('export') || o.text.toLowerCase().includes('csv'));
      });
      fs.writeFileSync('debug_botones_exportar.json', JSON.stringify(botonesExportar, null, 2));

       console.log("Haciendo clic en Exportar CSV con evaluate...");
       try {
           const downloadPromise = page.waitForEvent('download', { timeout: 120000 }); // Más tiempo por las dudas
           await page.evaluate(() => {
               const els = Array.from(document.querySelectorAll('a, button'));
               const csvButtons = els.filter(e => e.innerText && (e.innerText.includes('CSV') || e.innerText.includes('Exportar')));
               console.log(`Se encontraron ${csvButtons.length} botones con texto 'CSV' o 'Exportar'.`);
               const btn = csvButtons[0]; // Tomar el primer botón encontrado
               if (btn) {
                   console.log("Botón de exportación encontrado y clickeado");
                   btn.click();
               } else {
                   throw new Error("No se encontró ningún botón que diga CSV o Exportar");
               }
           });
           
           const download = await downloadPromise;
           const downloadPath = path.join(__dirname, 'export.csv');
           await download.saveAs(downloadPath);
           
           if (fs.existsSync(downloadPath)) {
               const stats = fs.statSync(downloadPath);
               console.log(`CSV Exportado exitosamente en: ${downloadPath} (Tamaño: ${stats.size} bytes)`);
           } else {
               throw new Error("El archivo no se guardó después de la descarga");
           }
       } catch (err) {
           console.error("CRITICAL ERROR: No se pudo exportar CSV -", err.message);
           process.exit(1); // Forzar que GitHub Actions marque este paso como FALLIDO
       }

  await browser.close();


}

scrapePresis().catch(console.error);

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
  await page.goto('https://mexlv.epresis.com/guias/multiitems/listado', { waitUntil: 'networkidle', timeout: 60000 });
  
  // VALIDACIÓN CRÍTICA: ¿Nos mandaron de vuelta al login?
  const currentUrl = page.url();
  console.log(`URL actual: ${currentUrl}`);
  if (currentUrl.includes('/login')) {
      await page.screenshot({ path: 'debug_01_login_failed.png', fullPage: true });
      throw new Error("LOGIN FALLIDO: El sistema redirigió de vuelta al login. Verifica el usuario/clave en GitHub Secrets.");
  }

  console.log("Esperando que cargue la página interna...");
  await page.waitForSelector('#formulario', { timeout: 60000 });
  
  // Esperar a que el modal inicial "Cargando" esté oculto
  try {
      await page.waitForSelector('#pleaseWaitDialog', { state: 'hidden', timeout: 30000 });
  } catch (e) {}
  
  console.log("Aplicando filtros...");
  try {
      const fechaLocator = page.locator('input[name="fecha_pactada"]');
      
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
      
      const startLoc = formatLoc(hace30Dias);
      const endLoc = formatLoc(en30Dias);
      const dateRangeStr = `${startLoc} - ${endLoc}`;
      console.log(`Rango: ${dateRangeStr}`);

      await fechaLocator.waitFor({ state: 'visible' });
      console.log("Setting date range directly via DOM evaluate and daterangepicker API...");
      const debugLog = await page.evaluate(({ val, start, end }) => {
          const logs = [];
          logs.push(`window.$ defined: ${typeof window.$}`);
          logs.push(`window.jQuery defined: ${typeof window.jQuery}`);
          
          const jqEl = window.$ ? window.$('#fecha_pactada') : (window.jQuery ? window.jQuery('#fecha_pactada') : null);
          logs.push(`jqEl found: ${jqEl && jqEl.length}`);
          
          if (jqEl && jqEl.length) {
              const picker = jqEl.data('daterangepicker');
              logs.push(`picker found: ${!!picker}`);
              if (picker) {
                  try {
                      const m = window.moment || window.Moment || (typeof moment !== 'undefined' ? moment : null);
                      logs.push(`moment defined: ${typeof m}`);
                      if (typeof m === 'function') {
                          picker.setStartDate(m(start, 'DD/MM/YYYY'));
                          picker.setEndDate(m(end, 'DD/MM/YYYY'));
                          logs.push('setStartDate/setEndDate called with moment');
                      } else {
                          picker.setStartDate(start);
                          picker.setEndDate(end);
                          logs.push('setStartDate/setEndDate called with string');
                      }
                      jqEl.trigger('apply.daterangepicker', picker);
                      jqEl.trigger('change');
                      logs.push('apply.daterangepicker and change triggered');
                  } catch (e) {
                      logs.push(`Error setting picker: ${e.message}`);
                  }
              } else {
                  jqEl.val(val).trigger('change');
                  logs.push('val and change triggered (no picker)');
              }
          } else {
              const domEl = document.getElementById('fecha_pactada');
              logs.push(`domEl found: ${!!domEl}`);
              if (domEl) {
                  domEl.value = val;
                  domEl.dispatchEvent(new Event('change', { bubbles: true }));
                  logs.push('domEl value set and change event dispatched');
              }
          }
          return logs;
      }, { val: dateRangeStr, start: startLoc, end: endLoc });
      console.log("EVALUATE LOGS:", debugLog);
  } catch (err) {
      console.error("ERROR FILTROS:", err.message);
      await page.screenshot({ path: 'debug_error_filtros.png', fullPage: true });
      process.exit(1);
  }
  
  await page.screenshot({ path: 'debug_01b_after_fill.png', fullPage: true });

  console.log("Haciendo clic en Buscar...");
  try {
      // Nos aseguramos de que el modal de carga esté completamente oculto antes de hacer clic en Buscar
      try {
          await page.waitForSelector('#pleaseWaitDialog', { state: 'hidden', timeout: 30000 });
      } catch (e) {}

      const searchBtn = page.locator('.btn-buscar, button:has-text("Buscar"), a:has-text("Buscar")').first();
      await searchBtn.click();
  } catch (err) {
      console.error("ERROR EN BUSQUEDA:", err.message);
      await page.screenshot({ path: 'debug_error_buscar.png', fullPage: true });
      process.exit(1);
  }
  
  console.log("Esperando carga de datos...");
  try {
      // Esperamos a que el diálogo de carga esté oculto/desaparezca después de la búsqueda
      await page.waitForTimeout(1000);
      await page.waitForSelector('#pleaseWaitDialog', { state: 'hidden', timeout: 60000 });
  } catch (err) {
      console.log("Advertencia: No se detectó o no desapareció el overlay de carga, continuando...");
  }
  
  await page.screenshot({ path: 'debug_02_after_buscar_final.png', fullPage: true });
  fs.writeFileSync(path.join(__dirname, 'debug_listado_final.html'), await page.content());

  console.log("Intentando Exportar CSV...");
  let csvBuffer = null;
  
  console.log("Configurando interceptación de la descarga...");
  await context.route('**/exportarExcel', async (route) => {
      console.log("¡Request de exportación detectado por el interceptor!");

      try {
          const response = await route.fetch();
          csvBuffer = await response.body();
          console.log(`Descarga interceptada con éxito: ${csvBuffer.length} bytes`);
          await route.fulfill({
              status: 200,
              contentType: 'text/csv',
              body: csvBuffer
          });
      } catch (err) {
          console.error("Error al interceptar descarga en la ruta:", err.message);
          await route.abort();
      }
  });

  try {
      // Hacemos clic en el botón Exportar CSV nativo de la página
      await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('a, button'));
          const btn = els.find(e => e.innerText && (e.innerText.includes('CSV') || e.innerText.includes('Exportar')));
          if (btn) btn.click();
          else throw new Error("No se encontró botón CSV/Exportar");
      });
      
      console.log("Esperando a que el interceptor capture el archivo...");
      let elapsed = 0;
      while (!csvBuffer && elapsed < 120000) {
          await page.waitForTimeout(1000);
          elapsed += 1000;
      }
      
      if (!csvBuffer) {
          throw new Error("No se interceptó la descarga del CSV tras 120 segundos.");
      }
      
      const downloadPath = require('path').join(__dirname, 'export.csv');
      fs.writeFileSync(downloadPath, csvBuffer);
      console.log(`CSV Guardado: ${fs.statSync(downloadPath).size} bytes`);
      
      await page.screenshot({ path: 'debug_03_export_ok.png', fullPage: true });
  } catch (err) {
      console.error("ERROR EXPORTACIÓN:", err.message);
      await page.screenshot({ path: 'debug_error_exportacion.png', fullPage: true });
      process.exit(1);
  }

  await browser.close();
}

scrapePresis().catch(err => {
    console.error("SCRAPER FAILED:", err.message);
    process.exit(1);
});

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
  
  const currentUrl = page.url();
  console.log(`URL actual: ${currentUrl}`);
  if (currentUrl.includes('/login')) {
      await page.screenshot({ path: 'debug_01_login_failed.png', fullPage: true });
      throw new Error("LOGIN FALLIDO: El sistema redirigi de vuelta al login. Verifica el usuario/clave en GitHub Secrets.");
  }

  console.log("Esperando que cargue la pogina interna...");
  await page.waitForSelector('#formulario', { timeout: 60000 });
  
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
      console.log(`Rango a establecer: ${dateRangeStr}`);

      await fechaLocator.waitFor({ state: 'visible' });
      
      // Seteo inicial y log inmediato
      const log1 = await page.evaluate(({ val, start, end }) => {
          const el = $('#fecha_pactada');
          const picker = el.data('daterangepicker');
          if (picker) {
              const m = window.moment || window.Moment || (typeof moment !== 'undefined' ? moment : null);
              if (typeof m === 'function') {
                  picker.setStartDate(m(start, 'DD/MM/YYYY'));
                  picker.setEndDate(m(end, 'DD/MM/YYYY'));
              } else {
                  picker.setStartDate(start);
                  picker.setEndDate(end);
              }
              el.trigger('apply.daterangepicker', picker);
              el.trigger('change');
          } else {
              el.val(val).trigger('change');
          }
          return {
              val: el.val(),
              serialize: $('#formulario').serializeArray().find(d => d.name === 'fecha_pactada')
          };
      }, { val: dateRangeStr, start: startLoc, end: endLoc });
      console.log("LOG 1 (inmediato):", log1);

      await page.waitForTimeout(1000);

      const log2 = await page.evaluate(() => {
          const el = $('#fecha_pactada');
          return {
              val: el.val(),
              serialize: $('#formulario').serializeArray().find(d => d.name === 'fecha_pactada')
          };
      });
      console.log("LOG 2 (despu�s de 1s):", log2);

  } catch (err) {
      console.error("ERROR FILTROS:", err.message);
      await page.screenshot({ path: 'debug_error_filtros.png', fullPage: true });
      process.exit(1);
  }
  
  await page.screenshot({ path: 'debug_01b_after_fill.png', fullPage: true });

  console.log("Haciendo clic en Buscar...");
  try {
      try {
          await page.waitForSelector('#pleaseWaitDialog', { state: 'hidden', timeout: 30000 });
      } catch (e) {}

      const searchBtn = page.locator('.btn-buscar, button:has-text("Buscar"), a:has-text("Buscar")').first();
      
      const log3 = await page.evaluate(() => {
          const el = $('#fecha_pactada');
          return {
              val: el.val(),
              serialize: $('#formulario').serializeArray().find(d => d.name === 'fecha_pactada')
          };
      });
      console.log("LOG 3 (antes de click Buscar):", log3);

      await searchBtn.click();
  } catch (err) {
      console.error("ERROR EN BUSQUEDA:", err.message);
      await page.screenshot({ path: 'debug_error_buscar.png', fullPage: true });
      process.exit(1);
  }
  
  console.log("Esperando carga de datos...");
  try {
      await page.waitForTimeout(1000);
      await page.waitForSelector('#pleaseWaitDialog', { state: 'hidden', timeout: 60000 });
  } catch (err) {}
  
  const log4 = await page.evaluate(() => {
      const el = $('#fecha_pactada');
      return {
          val: el.val(),
          serialize: $('#formulario').serializeArray().find(d => d.name === 'fecha_pactada')
      };
  });
  console.log("LOG 4 (despu�s de Buscar completado):", log4);
  
  await page.screenshot({ path: 'debug_02_after_buscar_final.png', fullPage: true });
  fs.writeFileSync(path.join(__dirname, 'debug_listado_final.html'), await page.content());

  console.log("Intentando Exportar CSV...");
  let csvBuffer = null;
  
  console.log("Configurando interceptaci�n de la descarga...");
  await context.route('**/exportarExcel', async (route) => {
      console.log("�Request de exportaci�n detectado por el interceptor!");
      console.log("POST Body:", route.request().postData());

      try {
          const response = await route.fetch({ timeout: 120000 });
          csvBuffer = await response.body();
          console.log(`Descarga interceptada con �xito: ${csvBuffer.length} bytes`);
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
      await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('a, button'));
          const btn = els.find(e => e.innerText && e.innerText.trim() === 'Exportar CSV');
          if (btn) btn.click();
          else throw new Error('No se encontro boton Exportar CSV');
      });
      
      console.log("Esperando a que el interceptor capture el archivo...");
      let elapsed = 0;
      while (!csvBuffer && elapsed < 120000) {
          await page.waitForTimeout(1000);
          elapsed += 1000;
      }
      
      if (!csvBuffer) {
          throw new Error("No se intercept� la descarga del CSV tras 120 segundos.");
      }
      
      const downloadPath = require('path').join(__dirname, 'export.csv');
      fs.writeFileSync(downloadPath, csvBuffer);
      console.log(`CSV Guardado: ${fs.statSync(downloadPath).size} bytes`);
      
      await page.screenshot({ path: 'debug_03_export_ok.png', fullPage: true });
  } catch (err) {
      console.error("ERROR EXPORTACI�N:", err.message);
      await page.screenshot({ path: 'debug_error_exportacion.png', fullPage: true });
      process.exit(1);
  }

  await browser.close();
}

scrapePresis().catch(err => {
    console.error("SCRAPER FAILED:", err.message);
    process.exit(1);
});

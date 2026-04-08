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
  await page.waitForTimeout(5000); 

  // Capturamos el HTML para debug
  const html = await page.content();
  fs.writeFileSync('debug_listado.html', html);
  await page.screenshot({ path: 'debug_01_loaded.png', fullPage: true });

  console.log("Aplicando filtros...");
  try {
      // Intentamos con varios selectores para el botón de buscar
      const buscarBtn = page.locator('.btn-buscar, button:has-text("Buscar"), a:has-text("Buscar")').first();
      await buscarBtn.waitFor({ state: 'attached', timeout: 45000 });
      
      // Esperar que el modal inicial desaparezca
      await page.waitForSelector('#pleaseWaitDialog', { state: 'hidden', timeout: 30000 }).catch(() => {});

      console.log("Llenando fecha_pactada...");
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
      
      const dateRangeStr = `${formatLoc(hace30Dias)} - ${formatLoc(en30Dias)}`;
      console.log(`Rango: ${dateRangeStr}`);

      await fechaLocator.waitFor({ state: 'visible' });
      await fechaLocator.click();
      await page.keyboard.type(dateRangeStr);
      await page.keyboard.press('Enter');
      
      await page.screenshot({ path: 'debug_01b_after_fill.png', fullPage: true });

      console.log("Haciendo clic en Buscar...");
      await buscarBtn.click();
      
      console.log("Esperando carga de datos...");
      await page.waitForTimeout(2000); 
      await page.waitForSelector('#pleaseWaitDialog', { state: 'hidden', timeout: 60000 }).catch(() => {});
      await page.waitForFunction(() => !document.body.innerText.includes('Cargando, espere por favor'), { timeout: 60000 }).catch(() => {});
      
      await page.screenshot({ path: 'debug_02_after_buscar_final.png', fullPage: true });
  } catch (e) {
      console.error("ERROR EN BUSQUEDA:", e.message);
      await page.screenshot({ path: 'debug_error_busqueda.png', fullPage: true });
      throw e;
  }

  const finalHtml = await page.content();
  fs.writeFileSync('debug_listado_final.html', finalHtml);
  
  console.log("Intentando Exportar CSV...");
  try {
      const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
      await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('a, button'));
          const btn = els.find(e => e.innerText && (e.innerText.includes('CSV') || e.innerText.includes('Exportar')));
          if (btn) btn.click();
          else throw new Error("No se encontró botón CSV/Exportar");
      });
      
      const download = await downloadPromise;
      const downloadPath = path.join(__dirname, 'export.csv');
      await download.saveAs(downloadPath);
      
      if (fs.existsSync(downloadPath)) {
          console.log(`CSV Guardado: ${fs.statSync(downloadPath).size} bytes`);
      }
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

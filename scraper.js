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
      
      const dateRangeStr = `${formatLoc(hace30Dias)} - ${formatLoc(en30Dias)}`;
      console.log(`Rango: ${dateRangeStr}`);

      await fechaLocator.waitFor({ state: 'visible' });
      await fechaLocator.click();
      
      // Limpiamos el input primero por si tiene texto preexistente
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      
      await page.keyboard.type(dateRangeStr);
      await page.keyboard.press('Enter');
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
  try {
      // Obtenemos la serialización exacta del formulario usando el jQuery de la propia página
      const postData = await page.evaluate(() => {
          // Eliminamos el input type anterior si existiese
          const oldType = document.getElementById('type_export');
          if (oldType) oldType.remove();

          // Creamos y agregamos el input de tipo csv como lo hace exportFilter
          const frm = document.getElementById('formulario');
          if (!frm) throw new Error('No se encontró el formulario #formulario');

          const input = document.createElement('input');
          input.name = 'type';
          input.type = 'hidden';
          input.value = 'csv';
          input.id = 'type_export';
          frm.appendChild(input);

          // Serializamos usando jQuery para garantizar compatibilidad al 100%
          return $('#formulario').serialize();
      });

      if (!postData) {
          throw new Error("No se pudo serializar el formulario.");
      }

      console.log("Formulario serializado correctamente. Enviando POST directo...");

      // Hacemos el POST directo usando el request helper de Playwright con el payload serializado
      const response = await page.request.post('https://mexlv.epresis.com/guias/exportarExcel', {
          data: postData,
          headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Referer': page.url()
          },
          timeout: 120000
      });

      if (!response.ok()) {
          throw new Error(`El servidor devolvió HTTP ${response.status()}: ${response.statusText()}`);
      }

      const buffer = await response.body();
      const downloadPath = require('path').join(__dirname, 'export.csv');
      fs.writeFileSync(downloadPath, buffer);

      if (fs.existsSync(downloadPath)) {
          console.log(`CSV Guardado: ${fs.statSync(downloadPath).size} bytes`);
      }
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

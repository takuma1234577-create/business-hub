import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const base = process.env.TEST_URL || 'http://127.0.0.1:5173'
const executablePath = process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await puppeteer.launch({ executablePath, headless: true, args: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] : [] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844 })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text()) })
  const bodyContains = async text => page.waitForFunction(value => document.body.innerText.includes(value), {}, text)
  const value = selector => page.$eval(selector, element => element.value)
  await page.goto(base)
  await page.type('input[type=email]', 'test@example.com')
  await page.type('input[type=password]', 'preserve-this-password')
  await page.select('#business-hub-language', 'en')
  await bodyContains('Email address')
  assert.equal(await value('input[type=email]'), 'test@example.com')
  assert.equal(await value('input[type=password]'), 'preserve-this-password')
  await page.select('#business-hub-language', 'es')
  await bodyContains('Correo electrónico')
  await page.reload()
  await bodyContains('Correo electrónico')
  assert.equal(await page.$eval('html', element => element.lang), 'es')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.select('#business-hub-language', 'ja')
  await bodyContains('メールアドレス')
  console.log('PASS: login in three languages, input preservation, reload persistence, mobile width')

  await page.setRequestInterception(true)
  page.on('request', request => {
    if (request.url().includes('/api/auth/verify')) request.respond({ status: 200, contentType: 'application/json', body: '{"valid":true}' })
    else if (request.url().includes('/api/return-review/logs')) request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'test', order_id: 'ORDER-1', customer_name: '保存', request_type: 'return', reason: 'other', reason_detail: '削除', image_count: 3, ai_approved: true, ai_confidence: 0.95, ai_reason: '保存', ai_flags: [], rule_check_passed: true, rule_fail_reasons: [], final_result: 'approved', shopify_result: 'success', line_notified: true, created_at: '2026-10-03T12:00:00Z' }], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }) })
    else if (new URL(request.url()).pathname.startsWith('/api/')) request.respond({ status: 200, contentType: 'application/json', body: '{}' })
    else if (!request.url().startsWith(base) && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) request.abort()
    else request.continue()
  })
  await page.evaluate(() => localStorage.setItem('auth_token', 'i18n-test-only'))
  await page.goto(base)
  await bodyContains('業務ツール')
  await page.select('#business-hub-language', 'en')
  await bodyContains('Business tools')
  await page.select('#business-hub-language', 'es')
  await bodyContains('Herramientas de trabajo')
  const japanese = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const found = []
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (!node.parentElement.closest('[translate="no"],script,style') && /[ぁ-んァ-ヶ一-龠]/.test(node.textContent)) found.push(node.textContent.trim())
    }
    return found
  })
  assert.deepEqual(japanese, [], 'Home should be fully translated')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  console.log('PASS: all home cards, mobile layout')

  for (const [route, en, es] of [
    ['/settings', 'API settings - Additional verification', 'Ajustes de API - Verificación adicional'],
    ['/image-downloader', 'Bulk product image download', 'Descarga de imágenes de productos en lote'],
    ['/return-logs', 'Review history', 'Historial de evaluaciones'],
  ]) {
    await page.goto(`${base}${route}`)
    await page.select('#business-hub-language', 'en')
    await bodyContains(en)
    await page.select('#business-hub-language', 'es')
    await bodyContains(es)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${route}: mobile overflow`)
  }
  await page.waitForSelector('tbody tr')
  await page.click('tbody tr')
  await bodyContains('Detalles de evaluación')
  await bodyContains('3 fotos')
  assert.equal(await page.$$eval('[translate="no"]', nodes => nodes.filter(n => n.textContent === '保存').length), 2, 'Customer name and AI text must remain original')
  assert.equal(await page.$$eval('[translate="no"]', nodes => nodes.some(n => n.textContent === '削除')), true, 'Stored request details must remain original')
  await page.select('#business-hub-language', 'en')
  await bodyContains('Assessment details')
  await bodyContains('3 photos')
  assert.equal(await page.$eval('select:not(#business-hub-language)', element => element.value), 'all')
  console.log('PASS: settings, downloader, return history/detail, raw content protection, mobile layout')

  await page.goto(`${base}/tests/i18n.html`)
  await page.waitForSelector('#controlled')
  await page.select('#business-hub-language', 'ja')
  await page.type('#controlled', '-edited')
  await page.type('#uncontrolled', '-edited')
  await page.select('#implicit-option', '削除')
  await page.select('#explicit-option', 'delete')
  await page.select('#business-hub-language', 'es')
  await bodyContains('Herramientas de trabajo')
  assert.equal(await value('#controlled'), 'draft-edited')
  assert.equal(await value('#uncontrolled'), 'original-edited')
  assert.equal(await value('#implicit-option'), '削除')
  assert.equal(await value('#explicit-option'), 'delete')
  assert.equal(await value('#textarea'), '保存')
  assert.equal(await page.$eval('#textarea', element => element.placeholder), 'Buscar…')
  assert.equal(await page.$eval('#original', element => element.textContent), '保存')
  assert.equal(await page.$eval('#mixed-count', element => element.textContent), '12 elementos')
  assert.equal(await page.$eval('#parameter-name', element => element.textContent), '¿Desconectar 保存?')
  assert.equal(await page.$eval('#escaped-template', element => element.textContent), 'Anuncio creado: CAM / $123 (debes aportar las fotos por separado)')
  assert.equal(await page.$eval('#template-token', element => element.textContent), '{会社名}')
  assert.equal(await page.$eval('#locale-date', element => element.textContent), '3 de octubre')
  assert.equal(await page.$eval('#editable', element => element.textContent), '保存')
  await page.click('#toggle')
  assert.equal(await page.$('#conditional'), null)
  await page.click('#toggle')
  assert.equal(await page.$eval('#conditional', element => element.textContent), 'Guardar')
  await page.click('#ref-focus')
  assert.equal(await page.evaluate(() => document.activeElement.id), 'controlled')
  const dialog = new Promise(resolve => page.once('dialog', async event => { const text = event.message(); await event.dismiss(); resolve(text) }))
  await page.click('#dialog')
  assert.equal(await dialog, 'Guardado')
  await page.evaluate(() => {
    localStorage.setItem('business-hub.language', 'en')
    window.dispatchEvent(new StorageEvent('storage', { key: 'business-hub.language', newValue: 'en' }))
  })
  await bodyContains('Business tools')
  assert.equal(await page.$eval('#business-hub-language', element => element.value), 'en')
  assert.equal(await value('#controlled'), 'draft-edited')
  await page.evaluate(() => {
    localStorage.setItem('business-hub.language', 'invalid')
    window.dispatchEvent(new StorageEvent('storage', { key: 'business-hub.language', newValue: 'invalid' }))
  })
  await bodyContains('業務ツール')
  assert.equal(await page.$eval('#business-hub-language', element => element.value), 'ja')
  assert.deepEqual(errors, [])
  console.log('PASS: controlled/uncontrolled forms, option values, textarea, opt-out, conditional content, refs, dialogs, no React errors')
} finally {
  await browser.close()
}

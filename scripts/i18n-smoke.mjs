import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'

const base = process.env.TEST_URL || 'http://127.0.0.1:5173'
const executablePath = process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await puppeteer.launch({ executablePath, headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844 })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
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
  await page.click('#toggle')
  assert.equal(await page.$('#conditional'), null)
  await page.click('#toggle')
  assert.equal(await page.$eval('#conditional', element => element.textContent), 'Guardar')
  await page.click('#ref-focus')
  assert.equal(await page.evaluate(() => document.activeElement.id), 'controlled')
  const dialog = new Promise(resolve => page.once('dialog', async event => { const text = event.message(); await event.dismiss(); resolve(text) }))
  await page.click('#dialog')
  assert.equal(await dialog, 'Guardado')
  assert.deepEqual(errors, [])
  console.log('PASS: controlled/uncontrolled forms, option values, textarea, opt-out, conditional content, refs, dialogs, no React errors')
} finally {
  await browser.close()
}

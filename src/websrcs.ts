import { promises as fs, constants as fsConst } from 'fs'
import ora from 'ora'
import chalk from 'chalk'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import sharp from 'sharp'
import puppeteer from 'puppeteer'

interface WebscrsOption {
  outputDir: string;
  device?: string;
  width?: number;
  height?: number;
  short?: boolean;
  compare?: boolean;
}

interface ScreenshotOption extends WebscrsOption {
  target: string;
  filename: string;
  index: string;
}

const invalidUrl = (url: string) => {
  try {
    // eslint-disable-next-line no-new
    new URL(url)
  } catch (error) {
    return true
  }
  return false
}

const url2filename = (url: string, prefix = '') => {
  const { host, pathname, search } = new URL(url)
  const path = pathname
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replace(/\//g, '_')
  const query = search.replace(/[?&=/]/g, '')
  const file = path + query ? `-${path}${query}` : ''
  const name = `${prefix}${host}${file}`.substring(0, 250)
  return `${name}.png`
}

const screenshot = async (browser: puppeteer.Browser, options: ScreenshotOption) => {
  const loaderOpen = ora(`${options.index}.${chalk.cyan('Open:')} ${options.target}`).start()
  const page = await browser.newPage()
  if (options.width || options.height) {
    const { width: curW, height: curH } = page.viewport()
    const width = options.width ? options.width : curW
    const height = options.height ? options.height : curH
    page.setViewport({ width, height })
  }
  if (options.device) {
    await page.emulate(puppeteer.devices[options.device])
  }
  const buf = await page.goto(options.target).then(async res => {
    if (!res?.ok()) {
      throw new Error(`Not Found: ${options.target}`)
    }
    loaderOpen.succeed()
    const path = `${options.outputDir}/${options.filename}`
    const loaderSS = ora({
      text: `${chalk.cyan('Save:')} ${path}`,
      prefixText: '=>',
    }).start()
    const buf = await page.screenshot({
      path,
      fullPage: !options.short,
    }).catch(error => {
      loaderSS.fail()
      console.log(`${chalk.red(`${error.name}:`)} ${error.message}`)
      return undefined
    })
    loaderSS.succeed()
    return buf
  }).catch(error => {
    loaderOpen.fail()
    console.log(`${chalk.red(`${error.name}:`)} ${error.message}`)
    return undefined
  })
  await page.close()
  return buf
}

const fitDimension = async (originBufA: Buffer | undefined, originBufB: Buffer | undefined) => {
  const sharpA = sharp(originBufA)
  const sharpB = sharp(originBufB)
  const { width: widthA, height: heightA } = await sharpA.metadata()
  const { width: widthB, height: heightB } = await sharpB.metadata()
  const width = (widthA === undefined || widthB === undefined) ?
    0 :
    widthA > widthB ?
      widthA :
      widthB
  const height = (heightA === undefined || heightB === undefined) ?
    0 :
    heightA > heightB ?
      heightA :
      heightB

  const isResize = width && height && (widthA !== widthB || heightA !== heightB)
  if (isResize) {
    const resizeOptions: sharp.ResizeOptions = {
      width,
      height,
      fit: 'contain',
      position: 'left top',
      background: { r: 255, g: 255, b: 255, alpha: 0.5 },
    }
    sharpA.resize(resizeOptions)
    sharpB.resize(resizeOptions)
  }
  const bufA = await sharpA.toBuffer()
  const bufB = await sharpB.toBuffer()
  return {
    bufA,
    bufB,
    width,
    height,
  }
}

export const websrcs = async (urls: string[] = [], options: WebscrsOption) => {
  if (invalidUrl(urls[0]) && await fs.access(urls[0], fsConst.R_OK).then(() => true).catch(() => false)) {
    const data = await fs.readFile(urls[0], 'utf8')
    urls = data.trim().split(/\s/)
  }

  urls.forEach((url, index) => {
    if (invalidUrl(url)) {
      throw new TypeError(`arg${index + 1} - invalid URL "${url}"`)
    }
  })

  if (options.compare && urls.length % 2) {
    throw new TypeError('compare URLs must be even.')
  }

  if (options.device && !(options.device in puppeteer.devices)) {
    throw new TypeError('Specify unknown device. see details https://github.com/puppeteer/puppeteer/blob/master/lib/DeviceDescriptors.js')
  }

  await fs.mkdir(options.outputDir, { recursive: true })

  const browser = await puppeteer.launch()

  // screenshot
  if (options.compare) {
    console.log(chalk.green.bold('\nCompare screenshots of URLs...'))
    const iterator = urls.entries()
    for (const [i, urlA] of iterator) {
      const index = `${Math.floor(i / 2) + 1}`
      const ssBufA = await screenshot(browser, {
        target: urlA,
        index,
        filename: url2filename(urlA, `${index}a-`),
        ...options,
      })
      const [, urlB] = iterator.next().value
      const ssBufB = await screenshot(browser, {
        target: urlB,
        index,
        filename: url2filename(urlB, `${index}b-`),
        ...options,
      })
      if (ssBufA === undefined || ssBufB === undefined) {
        continue
      }
      const filename = `${options.outputDir}/${index}c-screenshot-diff.png`
      const loader = ora(`${index}.${chalk.cyan('Diff:')} ${filename}`).start()
      const { width, height, bufA, bufB } = await fitDimension(ssBufA, ssBufB)
      const imgA = PNG.sync.read(bufA)
      const imgB = PNG.sync.read(bufB)
      const imgDiff = new PNG({ width, height })
      pixelmatch(imgA.data, imgB.data, imgDiff.data, width, height, {
        threshold: 0.1,
      })
      await fs.writeFile(filename, PNG.sync.write(imgDiff))
      loader.succeed()
    }
  } else {
    console.log(chalk.green.bold('\nTake screenshots of URLs...'))
    for (const [index, target] of urls.entries()) {
      await screenshot(browser, {
        target,
        index: `${index + 1}`,
        filename: url2filename(target, `${index + 1}-`),
        ...options,
      })
    }
  }
  await browser.close()
}

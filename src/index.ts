/* eslint-disable no-await-in-loop */
import { Args, Command, Flags } from '@oclif/core'
import chalk from 'chalk'
import { promises as fs, constants as fsConst } from 'node:fs'
import ora from 'ora'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import puppeteer, { KnownDevices } from 'puppeteer'
import sharp from 'sharp'

interface WebscrsOption {
  compare?: boolean
  device?: keyof typeof KnownDevices
  height?: number
  outputDir: string
  short?: boolean
  width?: number
}

interface ScreenshotOption extends WebscrsOption {
  filename: string
  index: string
  target: string
}

const invalidUrl = (url: string) => {
  try {
    // eslint-disable-next-line no-new
    new URL(url)
  } catch {
    return true
  }

  return false
}

const isFilePath = async (path: string) => {
  try {
    await fs.access(path, fsConst.R_OK)
    return true
  } catch {
    return false
  }
}

const url2filename = (url: string, prefix = '') => {
  const { hostname, pathname, search } = new URL(url)
  const path = pathname
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replaceAll('/', '_')
  const query = search.replaceAll(/[?&=/]/g, '')
  const file = (path + query) ? `-${path}${query}` : ''
  const name = `${prefix}${hostname}${file}`.slice(0, 250)
  return `${name}.png`
}

const screenshot = async (browser: puppeteer.Browser, options: ScreenshotOption) => {
  const loaderOpen = ora(`${options.index}.${chalk.cyan('Loading page:')} ${options.target}`).start()
  const page = await browser.newPage()

  if (options.width || options.height) {
    const viewPort = page.viewport()
    const curW = viewPort?.width ?? 0
    const curH = viewPort?.height ?? 0
    const width = options.width ?? curW
    const height = options.height ?? curH
    await page.setViewport({ height, width })
  }

  if (options.device && KnownDevices[options.device]) {
    await page.emulate(KnownDevices[options.device])
  }

  try {
    const res = await page.goto(options.target)
    if (!res?.ok()) {
      throw new Error(`Not Found: ${options.target}`)
    }

    loaderOpen.succeed()

    const path = `${options.outputDir}/${options.filename}`

    const loaderSS = ora({
      prefixText: '=>',
      text: `${chalk.cyan('Capturing screenshot:')} ${path}`,
    }).start()

    try {
      const buf = await page.screenshot({
        fullPage: !options.short,
        path,
      })
      loaderSS.succeed()
      return buf
    } catch (error) {
      loaderSS.fail()
      if (error instanceof Error) {
        process.stdout.write(`${chalk.red(`${error.name}:`)} ${error.message}\n`)
      }

      return false
    }
  } catch (error) {
    loaderOpen.fail()
    if (error instanceof Error) {
      process.stdout.write(`${chalk.red(`${error.name}:`)} ${error.message}\n`)
    }

    return false
  }
}

const fitDimension = async (originBufA: Uint8Array, originBufB: Uint8Array) => {
  const sharpA = sharp(originBufA)
  const sharpB = sharp(originBufB)

  const { height: heightA, width: widthA } = await sharpA.metadata()
  const { height: heightB, width: widthB } = await sharpB.metadata()

  const width = (widthA !== undefined && widthB !== undefined) ? Math.max(widthA, widthB) : 0
  const height = (heightA !== undefined && heightB !== undefined) ? Math.max(heightA, heightB) : 0
  const isResize = width && height && (widthA !== widthB || heightA !== heightB)

  if (isResize) {
    const resizeOptions: sharp.ResizeOptions = {
      background: { alpha: 0.5, b: 255, g: 255, r: 255 },
      fit: 'contain',
      height,
      position: 'left top',
      width,
    }

    sharpA.resize(resizeOptions)
    sharpB.resize(resizeOptions)
  }

  const bufA = await sharpA.toBuffer()
  const bufB = await sharpB.toBuffer()

  return {
    bufA,
    bufB,
    height,
    width,
  }
}

let browser: null | puppeteer.Browser = null

const webscrs = async (urls: string[] = [], options: WebscrsOption) => {
  if (invalidUrl(urls[0]) && await isFilePath(urls[0])) {
    const data = await fs.readFile(urls[0], 'utf8')
    urls = data.trim().split(/\s+/)
  }

  for (const [index, url] of urls.entries()) {
    if (invalidUrl(url)) {
      throw new TypeError(`arg${index + 1} - invalid URL "${url}"`)
    }
  }

  if (options.compare && urls.length % 2) {
    throw new TypeError('Compare URLs must be even')
  }

  if (options.device && !KnownDevices[options.device]) {
    throw new TypeError('Unknown device specified. See details at https://pptr.dev/api/puppeteer.knowndevices')
  }

  await fs.mkdir(options.outputDir, { recursive: true })
  browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true
  })

  let hasFailures = false

  if (options.compare) {
    process.stdout.write(chalk.green.bold('\nStarting screenshot comparison...\n'))

    for (let i = 0; i < urls.length; i += 2) {
      const number = `${Math.floor(i / 2) + 1}`
      const urlA = urls[i]
      const urlB = urls[i + 1]

      const ssBufA = await screenshot(browser, {
        filename: url2filename(urlA, `${number}a-`),
        index: number,
        target: urlA,
        ...options,
      })

      const ssBufB = await screenshot(browser, {
        filename: url2filename(urlB, `${number}b-`),
        index: number,
        target: urlB,
        ...options,
      })

      if (ssBufA === false || ssBufB === false) {
        hasFailures = true
        continue
      }

      const filename = `${options.outputDir}/${number}c-screenshot-diff.png`
      const loader = ora(`${number}.${chalk.cyan('Generating diff:')} ${filename}`).start()
      const { bufA, bufB, height, width } = await fitDimension(ssBufA, ssBufB)
      const imgA = PNG.sync.read(bufA)
      const imgB = PNG.sync.read(bufB)
      const imgDiff = new PNG({ height, width })

      const unmatchedPixel = pixelmatch(imgA.data, imgB.data, imgDiff.data, width, height)

      await fs.writeFile(filename, PNG.sync.write(imgDiff))

      if (unmatchedPixel) {
        loader.warn(loader.text + ' - ' + chalk.yellow(`${unmatchedPixel} pixels different`))
      } else {
        loader.succeed(loader.text + ' - ' + chalk.green('No differences found'))
      }
    }
  } else {
    process.stdout.write(chalk.green.bold('\nStarting screenshot capture...\n'))

    for (const [index, target] of urls.entries()) {
      const result = await screenshot(browser, {
        filename: url2filename(target, `${index + 1}-`),
        index: `${index + 1}`,
        target,
        ...options,
      })
      if (result === false) {
        hasFailures = true
      }
    }
  }

  if (hasFailures) {
    process.stdout.write('🚨 ' +chalk.yellow.bold('Tasks completed with some failures!\n'))
  } else {
    process.stdout.write('✨️ ' + chalk.green.bold('All tasks completed successfully!\n'))
  }
}

export default class Webscrs extends Command {
  static args = {
    url: Args.string({ description: 'urls for screenshot', multiple: true, required: true }),
  }
  static description = 'Take a screenshot from a url and generate a diff from two urls.'
  static examples = [
    '\nTake screenshots of URLs\n$ webscrs "https://example.com/" "https://example.net/"',
    '\nCompare screenshots of URLs\n$ webscrs -c "https://example.com/" "https://example.net/"',
    '\nExecute from file of URL list\n$ webscrs "url.txt"',
    '\nEmulate device\n$ webscrs -d "iPhone 6" "https://example.com/"',
  ]
  static flags = {
    compare: Flags.boolean({
      char: 'c',
      default: false,
      description: 'compare odd and even URL pairs',
    }),
    device: Flags.string({
      char: 'd',
      description: 'emulate mobile device',
    }),
    height: Flags.integer({
      char: 'h',
      description: 'height of viewport',
    }),
    help: Flags.help(),
    outputDir: Flags.string({
      char: 'o',
      default: './screenshots',
      description: 'output directory of screenshots',
    }),
    short: Flags.boolean({
      char: 's',
      default: false,
      description: 'screenshot at viewport size',
    }),
    version: Flags.version({ char: 'v' }),
    width: Flags.integer({
      char: 'w',
      description: 'width of viewport',
    }),
  }
  static strict = false

  async run() {
    const { argv, flags } = await this.parse(Webscrs)
    const typedFlags = {
      ...flags,
      device: flags.device as keyof typeof KnownDevices | undefined
    }
    await webscrs(argv as string[], typedFlags)
    .catch((error: Error) => {
      this.error(error.message, { exit: 1 })
    })
    .finally(() => {
      if (browser) {
        browser.close()
      }
    })
  }
}

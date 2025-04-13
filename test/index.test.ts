import { serve } from '@hono/node-server'
import { expect } from 'chai'
import { Hono } from 'hono'
import { promises as fs } from 'node:fs'
import net from 'node:net'
import sharp from 'sharp'

import Webscrs from '../src'

function captureProcessOutput() {
  const logs: string[] = []
  const originalStdoutWrite = process.stdout.write
  const originalStderrWrite = process.stderr.write

  process.stdout.write = ((...args) => {
    const message = args[0]?.toString()
    if (message && message.trim()) {
      logs.push(message)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return originalStdoutWrite.apply(process.stdout, args as any)
  }) as typeof process.stdout.write

  process.stderr.write = ((...args) => {
    const message = args[0]?.toString()
    if (message && message.trim()) {
      logs.push(message)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return originalStderrWrite.apply(process.stderr, args as any)
  }) as typeof process.stderr.write

  const cleanup = () => {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
  }

  return { cleanup, logs }
}

function htmlBody(content: string) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
      </head>
      <body>${content}</body>
    </html>
  `
}

describe('webscrs', () => {
  const outputDir = './test-screenshots'
  let server: ReturnType<typeof serve>
  let baseUrl: string

  before(async () => {
    const app = new Hono()

    app.get('/', (c) => c.html(htmlBody('<h1>Test Page 1</h1>')))
    app.get('/same', (c) => c.html(htmlBody('<h1>Test Page 1</h1>')))
    app.get('/diff', (c) => c.html(htmlBody('<h1>Test Page 2</h1>')))
    app.get('/tall', (c) => c.html(htmlBody('<div style="height: 1280px"><h1>Tall Page</h1></div>')))
    app.get('/huge', (c) => c.html(htmlBody('<div style="width:50000px;height:50000px"><h1>Huge Page</h1></div>')))
    app.get('/search', (c) => c.html(htmlBody(`<h1>Query: ${JSON.stringify(c.req.query())}</h1>`)))

    server = serve({ fetch: app.fetch, port: 0 })
    const { port } = server.address() as net.AddressInfo
    baseUrl = `http://localhost:${port}`

    try {
      await fs.rm(outputDir, { force: true, recursive: true })
    } catch {}
  })

  beforeEach(async () => {
    await fs.mkdir(outputDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(outputDir, { force: true, recursive: true })
  })

  after(() => {
    server.close()
  })

  it('takes a screenshot of a single URL', async () => {
    const { cleanup, logs } = captureProcessOutput()

    await Webscrs.run([`${baseUrl}`, '-o', outputDir])

    cleanup()

    const files = await fs.readdir(outputDir)
    expect(files).to.have.lengthOf(1)
    expect(files[0]).to.equal('1-localhost.png')

    expect(logs.some(log => log.includes('All tasks completed successfully'))).to.be.true
  })

  it('takes a screenshot with short option', async () => {
    const { cleanup, logs } = captureProcessOutput()

    await Webscrs.run([
      `${baseUrl}/tall`,
      '-s',
      '-o',
      outputDir
    ])

    cleanup()

    const [file] = await fs.readdir(outputDir)
    const imgBuffer = await fs.readFile(`${outputDir}/${file}`)
    const dimensions = await sharp(imgBuffer).metadata()

    expect(file).to.equal('1-localhost-tall.png')
    expect(dimensions.height).to.be.lessThan(1000)

    expect(logs.some(log => log.includes('All tasks completed successfully'))).to.be.true
  })

  it('compares two URLs (no difference)', async () => {
    const { cleanup, logs } = captureProcessOutput()

    await Webscrs.run([
      `${baseUrl}`,
      `${baseUrl}/same`,
      '-c',
      '-o',
      outputDir
    ])

    cleanup()

    const files = await fs.readdir(outputDir)
    expect(files).to.have.lengthOf(3)
    expect(files).to.include.members([
      '1a-localhost.png',
      '1b-localhost-same.png',
      '1c-screenshot-diff.png'
    ])

    expect(logs.some(log => log.includes('No differences found'))).to.be.true
    expect(logs.some(log => log.includes('All tasks completed successfully'))).to.be.true
  })

  it('compares two URLs (difference)', async () => {
    const { cleanup, logs } = captureProcessOutput()

    await Webscrs.run([
      `${baseUrl}`,
      `${baseUrl}/diff`,
      '-c',
      '-o',
      outputDir
    ])

    cleanup()

    const files = await fs.readdir(outputDir)
    expect(files).to.have.lengthOf(3)
    expect(files).to.include.members([
      '1a-localhost.png',
      '1b-localhost-diff.png',
      '1c-screenshot-diff.png'
    ])

    expect(logs.some(log => log.includes('pixels different'))).to.be.true
    expect(logs.some(log => log.includes('All tasks completed successfully'))).to.be.true
  })

  it('emulates mobile device', async () => {
    const { cleanup, logs } = captureProcessOutput()

    await Webscrs.run([
      `${baseUrl}`,
      '-d',
      'iPhone SE',
      '-o',
      outputDir
    ])

    cleanup()

    const [file] = await fs.readdir(outputDir)
    const imgBuffer = await fs.readFile(`${outputDir}/${file}`)
    const dimensions = await sharp(imgBuffer).metadata()

    expect(file).to.equal('1-localhost.png')
    expect(dimensions.width).to.equal(640)
    expect(dimensions.height).to.equal(1136)

    expect(logs.some(log => log.includes('All tasks completed successfully'))).to.be.true
  })

  it('fails with invalid URL', async () => {
    let error: Error | unknown

    try {
      await Webscrs.run(['invalid-url', '-o', outputDir])
    } catch (error_) {
      error = error_
    }

    if (error instanceof Error) {
      expect(error.message).to.equal('arg1 - invalid URL "invalid-url"')
    }
  })

  it('fails when comparing odd number of URLs', async () => {
    let error: Error | unknown

    try {
      await Webscrs.run([
        `${baseUrl}`,
        '-c',
        '-o',
        outputDir
      ])
    } catch (error_) {
      error = error_
    }

    if (error instanceof Error) {
      expect(error.message).to.equal('Compare URLs must be even')
    }
  })

  it('handles invalid device name', async () => {
    let error: Error | unknown

    try {
      await Webscrs.run([`${baseUrl}`, '-d', 'InvalidDevice', '-o', outputDir])
    } catch (error_) {
      error = error_ as Error
    }

    if (error instanceof Error) {
      expect(error.message).to.include('Unknown device specified. See details at https://pptr.dev/api/puppeteer.knowndevices')
    }
  })

  it('takes a screenshot of URL with path and query parameters', async () => {
    const { cleanup, logs } = captureProcessOutput()

    await Webscrs.run([`${baseUrl}?foo=bar`, '-o', outputDir])

    cleanup()

    const files = await fs.readdir(outputDir)
    expect(files).to.have.lengthOf(1)
    expect(files[0]).to.equal('1-localhost-foobar.png')

    expect(logs.some(log => log.includes('All tasks completed successfully'))).to.be.true
  })

  it('reads URLs from a file', async () => {
    const { cleanup, logs } = captureProcessOutput()

    const urlFile = `${outputDir}/urls.txt`
    await fs.writeFile(urlFile, `${baseUrl}\n${baseUrl}/same`)

    await Webscrs.run([urlFile, '-o', outputDir])

    cleanup()

    const files = await fs.readdir(outputDir)
    expect(files).to.have.lengthOf(3)

    expect(files[0]).to.equal('1-localhost.png')
    expect(files[1]).to.equal('2-localhost-same.png')

    expect(logs.some(log => log.includes('All tasks completed successfully'))).to.be.true
  })

  it('handles viewport resizing', async () => {
    const { cleanup, logs } = captureProcessOutput()

    await Webscrs.run([
      `${baseUrl}`,
      '-w',
      '1024',
      '-h',
      '768',
      '-o',
      outputDir
    ])

    cleanup()

    const [file] = await fs.readdir(outputDir)
    const imgBuffer = await fs.readFile(`${outputDir}/${file}`)
    const dimensions = await sharp(imgBuffer).metadata()

    expect(file).to.equal('1-localhost.png')
    expect(dimensions.width).to.equal(1024)
    expect(dimensions.height).to.equal(768)

    expect(logs.some(log => log.includes('All tasks completed successfully'))).to.be.true
  })

  it('compares screenshots with different dimensions', async () => {
    const { cleanup, logs } = captureProcessOutput()

    await Webscrs.run([
      `${baseUrl}`,
      `${baseUrl}/tall`,
      '-c',
      '-w',
      '1024',
      '-o',
      outputDir
    ])

    cleanup()

    const files = await fs.readdir(outputDir)
    expect(files).to.have.lengthOf(3)

    const imgBufferA = await fs.readFile(`${outputDir}/${files[0]}`)
    const dimensionsA = await sharp(imgBufferA).metadata()

    expect(files[0]).to.equal('1a-localhost.png')
    expect(dimensionsA.width).to.equal(1024)
    expect(dimensionsA.height).to.equal(600)

    const imgBufferB = await fs.readFile(`${outputDir}/${files[1]}`)
    const dimensionsB = await sharp(imgBufferB).metadata()

    expect(files[1]).to.equal('1b-localhost-tall.png')
    expect(dimensionsB.width).to.equal(1024)
    expect(dimensionsB.height).to.equal(1309)

    const imgBufferC = await fs.readFile(`${outputDir}/${files[2]}`)
    const dimensionsC = await sharp(imgBufferC).metadata()

    expect(files[2]).to.equal('1c-screenshot-diff.png')
    expect(dimensionsC.width).to.equal(1024)
    expect(dimensionsC.height).to.equal(1309)

    expect(logs.some(log => log.includes('All tasks completed successfully'))).to.be.true
  })

  it('handles screenshot failures gracefully', async () => {
    const { cleanup, logs } = captureProcessOutput()
    const invalidButWellFormedUrl = 'http://localhost:12345/network-error'

    await Webscrs.run([invalidButWellFormedUrl, '-o', outputDir])

    cleanup()

    const files = await fs.readdir(outputDir)
    expect(files).to.have.lengthOf(0)

    expect(logs.some(log => log.includes('net::ERR_CONNECTION_REFUSED at http://localhost:12345/network-error'))).to.be.true
    expect(logs.some(log => log.includes('Tasks completed with some failures!'))).to.be.true
  })

  it('handles empty URL list from file', async () => {
    let error: Error | unknown

    const urlFile = `${outputDir}/empty-urls.txt`

    await fs.writeFile(urlFile, '')

    try {
      await Webscrs.run([urlFile, '-o', outputDir])
    } catch (error_) {
      error = error_
    }

    if (error instanceof Error) {
      expect(error.message).to.equal('arg1 - invalid URL ""')
    }
  })

  it('handles server error during screenshot', async () => {
    const { cleanup, logs } = captureProcessOutput()

    await Webscrs.run([`${baseUrl}/error`, '-o', outputDir])

    cleanup()

    expect(logs.some(log => log.includes('Not Found:'))).to.be.true
    expect(logs.some(log => log.includes('Tasks completed with some failures!'))).to.be.true
  })

  it('continues processing when one screenshot fails in compare mode', async () => {
    const { cleanup, logs } = captureProcessOutput()
    const invalidButWellFormedUrl = 'http://localhost:12345/nonexistent'

    await Webscrs.run([
      `${baseUrl}`,
      invalidButWellFormedUrl,
      '-c',
      '-o',
      outputDir
    ])

    cleanup()

    const files = await fs.readdir(outputDir)

    expect(files).to.have.lengthOf(1)
    expect(files[0]).to.equal('1a-localhost.png')

    expect(logs.some(log => log.includes('net::ERR_CONNECTION_REFUSED'))).to.be.true
    expect(logs.some(log => log.includes('Tasks completed with some failures!'))).to.be.true
  })

  it('handles screenshot failures with extremely large page', async () => {
    const { cleanup, logs } = captureProcessOutput()

    await Webscrs.run([`${baseUrl}/huge`, '-o', outputDir])

    cleanup()

    const files = await fs.readdir(outputDir)
    expect(files).to.have.lengthOf(0)

    expect(logs.some(log => log.includes('Protocol error (Page.captureScreenshot)'))).to.be.true
    expect(logs.some(log => log.includes('Tasks completed with some failures!'))).to.be.true
  })
})

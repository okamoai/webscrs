import { Command, flags } from '@oclif/command'
import { websrcs } from './websrcs'

class Webscrs extends Command {
  static strict = false

  static description = 'Take a screenshot from a url and generate a diff from two urls.'

  static examples = [
    '\nTake screenshots of URLs\n$ webscrs "https://example.com/" "https://example.net/"',
    '\nCompare screenshots of URLs\n$ webscrs -c "https://example.com/" "https://example.net/"',
    '\nExecute from file of URL list\n$ webscrs "url.txt"',
    '\nEmulate device\n$ webscrs -d "iPhone 6" "https://example.com/"',
  ]

  static args = [
    {
      name: 'url',
      required: true,
      description: 'urls for screenshot',
    },
  ]

  static flags = {
    version: flags.version({ char: 'v' }),
    help: flags.help(),
    outputDir: flags.string({
      char: 'o',
      description: 'output directory of screenshots',
      default: './screenshots',
    }),
    compare: flags.boolean({
      char: 'c',
      description: 'compare odd and even URL pairs',
      default: false,
    }),
    device: flags.string({
      char: 'd',
      description: 'emulate mobile device',
    }),
    width: flags.integer({
      char: 'w',
      description: 'width of viewport',
    }),
    height: flags.integer({
      char: 'h',
      description: 'height of viewport',
    }),
    short: flags.boolean({
      char: 's',
      description: 'screenshot at viewport size',
      default: false,
    }),
  }

  async run() {
    const { argv, flags } = this.parse(Webscrs)
    await websrcs(argv, flags).catch(error => {
      this.error(error.message, { exit: 1 })
    })
  }
}
export = Webscrs

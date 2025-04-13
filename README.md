webscrs
=======

A CLI for website screenshots and comparisons.

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Example](#example)
- [License](#license)

## Requirements

- node 18+

## Installation
```sh-session
$ npm install -g webscrs
```

## Usage
```sh-session

USAGE
  $ webscrs <OPTIONS> <URL> [, <URL>...]

ARGUMENTS
  URL  urls for screenshot

OPTIONS
  -c, --compare              compare odd and even URL pairs
  -d, --device=device        emulate mobile device
  -h, --height=height        height of viewport
  -o, --outputDir=outputDir  [default: ./screenshots] output directory of screenshots
  -s, --short                screenshot at viewport size
  -v, --version              show CLI version
  -w, --width=width          width of viewport
  --help                     show CLI help
  ```

## Example

### Take screenshots of URLs.

```
$ webscrs "https://example.com/" "https://example.net/"

Starting screenshot capture...
✔ 1.Loading page: https://example.com/
=> ✔ Capturing screenshot: ./screenshots/1-example.com.png
✔ 2.Loading page: https://example.net/
=> ✔ Capturing screenshot: ./screenshots/2-example.net.png
✨️ All tasks completed successfully!
```

### Compare screenshots of URLs.

```
$ webscrs -c "https://example.com/" "https://example.net/"

Starting screenshot comparison...
✔ 1.Loading page: https://example.com/
=> ✔ Capturing screenshot: ./screenshots/1a-example.com.png
✔ 1.Loading page: https://example.net/
=> ✔ Capturing screenshot: ./screenshots/1b-example.net.png
✔ 1.Generating diff: ./screenshots/1c-screenshot-diff.png - No differences found
✨️ All tasks completed successfully!
```
\* argments url must be even.


### Execute from file of URL list.

```
$ webscrs "url.txt"
```
\*  File format is URL list delimited by white-space.


### Emulate device.

```
$ webscrs -d "iPhone 6" "https://example.com/"
```
\* -d option is specified from [Puppeteer known device](https://pptr.dev/api/puppeteer.knowndevices).

## License

MIT © [okamoai](https://github.com/okamoai)

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

const STARTUP_TIMEOUT_MS = 30_000
const DISCOVERY_TIMEOUT_MS = 10_000
const REQUEST_TIMEOUT_MS = 1_000
const WEBSOCKET_TIMEOUT_MS = 10_000
const COMMAND_TIMEOUT_MS = 15_000
const SHUTDOWN_TIMEOUT_MS = 5_000

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function withTimeout(promise, milliseconds, description) {
  let timeout
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${description} timed out after ${milliseconds}ms`)), milliseconds)
    }),
  ]).finally(() => clearTimeout(timeout))
}

function appendTail(current, chunk, maximumLength = 16_000) {
  return `${current}${chunk}`.slice(-maximumLength)
}

function processFailure(session, message) {
  const output = [
    session.stdout && `Browser stdout:\n${session.stdout}`,
    session.stderr && `Browser stderr:\n${session.stderr}`,
    session.exitDetails && `Browser exit: ${session.exitDetails}`,
  ].filter(Boolean).join('\n')
  return new Error(`${message}${output ? `\n${output}` : '\nBrowser produced no captured stdout/stderr.'}`)
}

async function readJson(url, description) {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${description} returned HTTP ${response.status}`)
  return response.json()
}

async function waitForJson(url, description, session) {
  const deadline = Date.now() + DISCOVERY_TIMEOUT_MS
  let lastError
  while (Date.now() < deadline) {
    if (session.processError) throw processFailure(session, `Browser process failed: ${session.processError.message}`)
    if (session.exitDetails) throw processFailure(session, `Browser exited before ${description}: ${session.exitDetails}`)
    try {
      return await readJson(url, description)
    } catch (error) {
      lastError = error
      await delay(100)
    }
  }
  throw processFailure(session, `${description} failed at ${url}: ${lastError?.message || 'no response'}`)
}

async function waitForDevToolsPort(profileDirectory, session) {
  const activePortPath = join(profileDirectory, 'DevToolsActivePort')
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  let lastError

  while (Date.now() < deadline) {
    if (session.processError) throw processFailure(session, `Browser process failed to start: ${session.processError.message}`)
    if (session.exitDetails) throw processFailure(session, `Browser exited during startup: ${session.exitDetails}`)
    try {
      const [portText] = (await readFile(activePortPath, 'utf8')).split(/\r?\n/)
      const port = Number(portText)
      if (Number.isInteger(port) && port > 0 && port <= 65_535) return port
      lastError = new Error(`Invalid DevToolsActivePort value: ${portText}`)
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }

  throw processFailure(session, `Browser startup did not create ${activePortPath}: ${lastError?.message || 'no details'}`)
}

function connectToBrowser(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl)
  const pending = new Map()
  let commandId = 0
  let closeError

  socket.addEventListener('message', (event) => {
    let message
    try {
      message = JSON.parse(event.data)
    } catch (error) {
      closeError = new Error(`Could not parse DevTools message: ${error.message}`)
      return
    }
    if (!message.id || !pending.has(message.id)) return

    const request = pending.get(message.id)
    clearTimeout(request.timeout)
    pending.delete(message.id)
    if (message.error) request.rejectCommand(new Error(message.error.message))
    else request.resolveCommand(message.result)
  })

  socket.addEventListener('error', () => {
    closeError = new Error(`WebSocket error connecting to ${webSocketUrl}`)
  })
  socket.addEventListener('close', (event) => {
    closeError = new Error(`DevTools WebSocket closed (${event.code}${event.reason ? `: ${event.reason}` : ''})`)
    for (const request of pending.values()) {
      clearTimeout(request.timeout)
      request.rejectCommand(closeError)
    }
    pending.clear()
  })

  const ready = new Promise((resolveReady, rejectReady) => {
    if (socket.readyState === WebSocket.OPEN) {
      resolveReady()
      return
    }
    socket.addEventListener('open', resolveReady, { once: true })
    socket.addEventListener('error', () => rejectReady(closeError || new Error(`WebSocket error connecting to ${webSocketUrl}`)), { once: true })
    socket.addEventListener('close', () => rejectReady(closeError || new Error(`WebSocket closed before connecting to ${webSocketUrl}`)), { once: true })
  })

  return {
    socket,
    ready: withTimeout(ready, WEBSOCKET_TIMEOUT_MS, 'DevTools WebSocket connection'),
    command(method, params = {}) {
      if (socket.readyState !== WebSocket.OPEN) return Promise.reject(closeError || new Error('DevTools WebSocket is not open'))
      commandId += 1
      const id = commandId
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolveCommand, rejectCommand) => {
        const timeout = setTimeout(() => {
          pending.delete(id)
          rejectCommand(new Error(`DevTools command ${method} timed out after ${COMMAND_TIMEOUT_MS}ms`))
        }, COMMAND_TIMEOUT_MS)
        pending.set(id, { resolveCommand, rejectCommand, timeout })
      })
    },
  }
}

async function stopBrowserProcess(session) {
  const child = session?.process
  if (!child || child.exitCode !== null || child.signalCode !== null) return 'already exited'
  if (session.processError && !child.pid) return 'process did not start'

  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    await withTimeout(new Promise((resolveExit) => {
      killer.once('error', resolveExit)
      killer.once('exit', resolveExit)
    }), SHUTDOWN_TIMEOUT_MS, 'Browser process-tree termination')
  } else {
    child.kill('SIGTERM')
  }

  const waitForExit = () => {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
    return withTimeout(new Promise((resolveExit) => child.once('exit', resolveExit)), SHUTDOWN_TIMEOUT_MS, 'Browser shutdown')
  }
  try {
    await waitForExit()
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await waitForExit()
    if (child.exitCode === null && child.signalCode === null) throw error
  }
  return 'stopped'
}

export function createAssertionTracker() {
  const counts = { passed: 0, failed: 0 }
  return {
    check(condition, message) {
      if (!condition) {
        counts.failed += 1
        throw new Error(message)
      }
      counts.passed += 1
    },
    get counts() { return { ...counts } },
  }
}

export function reportBrowserDiagnostics(session) {
  if (!session) return
  if (session.stdout) console.error(`[BROWSER STDOUT]\n${session.stdout}`)
  if (session.stderr) console.error(`[BROWSER STDERR]\n${session.stderr}`)
  if (session.processError) console.error(`[BROWSER PROCESS ERROR] ${session.processError.stack || session.processError.message}`)
  if (session.exitDetails) console.error(`[BROWSER PROCESS EXIT] ${session.exitDetails}`)
}

export function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean)

  return candidates.find((candidate) => existsSync(candidate))
}

export async function createScreenshotRunDirectory(projectRoot, testName) {
  const root = join(projectRoot, 'test-results')
  await mkdir(root, { recursive: true })
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const directory = await mkdtemp(join(root, `${testName}-${timestamp}-`))
  console.log(`SCREENSHOT_RUN_DIRECTORY ${directory}`)
  return directory
}

export async function startBrowser({ browserPath, temporaryRoot, pageUrl, windowSize = '1440,1000' }) {
  const profileDirectory = join(temporaryRoot, 'browser-profile')
  await mkdir(profileDirectory, { recursive: true })
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDirectory}`,
  ]
  if (windowSize) args.push(`--window-size=${windowSize}`)
  args.push(pageUrl)

  const child = spawn(browserPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const session = { process: child, profileDirectory, stdout: '', stderr: '', processError: null, exitDetails: null }
  child.stdout.on('data', (chunk) => { session.stdout = appendTail(session.stdout, chunk.toString()) })
  child.stderr.on('data', (chunk) => { session.stderr = appendTail(session.stderr, chunk.toString()) })
  child.once('error', (error) => { session.processError = error })
  child.once('exit', (code, signal) => { session.exitDetails = `code=${code}, signal=${signal}` })

  session.connect = async () => {
    const port = await waitForDevToolsPort(profileDirectory, session)
    session.port = port
    const baseUrl = `http://127.0.0.1:${port}`
    const version = await waitForJson(`${baseUrl}/json/version`, 'DevTools /json/version discovery', session)
    session.version = version
    const deadline = Date.now() + DISCOVERY_TIMEOUT_MS
    let target
    let lastError
    while (Date.now() < deadline) {
      const targets = await waitForJson(`${baseUrl}/json/list`, 'DevTools /json/list discovery', session)
      target = targets.find((candidate) => candidate.type === 'page' && candidate.url.startsWith(pageUrl))
      if (target?.webSocketDebuggerUrl) break
      lastError = new Error(`No page target matched ${pageUrl}; targets: ${targets.map((item) => `${item.type}:${item.url}`).join(', ') || '(none)'}`)
      await delay(100)
    }
    if (!target?.webSocketDebuggerUrl) throw processFailure(session, `DevTools page target discovery failed: ${lastError?.message || 'no matching page target'}`)

    session.target = target
    const connection = connectToBrowser(target.webSocketDebuggerUrl)
    session.connection = connection
    await connection.ready
    return session
  }

  return session
}

export async function cleanupBrowserSession(session) {
  if (!session) return 'not started'
  session.connection?.socket.close()
  return stopBrowserProcess(session)
}

export async function closeViteServer(vite) {
  if (!vite) return 'not started'
  await withTimeout(vite.close(), SHUTDOWN_TIMEOUT_MS, 'Vite server shutdown')
  return 'stopped'
}

export async function removeTemporaryRoot(temporaryRoot, safeTempRoot) {
  if (!resolve(temporaryRoot).startsWith(`${resolve(tmpdir())}${sep}`)) {
    throw new Error(`Refusing to remove a temporary path outside the OS temp directory: ${temporaryRoot}`)
  }
  if (!resolve(temporaryRoot).startsWith(safeTempRoot)) {
    throw new Error(`Refusing to remove an unexpected temporary path: ${temporaryRoot}`)
  }
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

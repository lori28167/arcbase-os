import http from 'node:http'
import net from 'node:net'
import {once} from 'node:events'

import {afterEach, describe, expect, test, vi} from 'vitest'
import WebSocket, {WebSocketServer} from 'ws'

vi.mock('execa', () => ({$: vi.fn()}))

import LanIngress from './lan-ingress.js'
import DomainAccess from '../domain-access/domain-access.js'

type Seen = {upstream: string; url?: string; proto?: string; host?: string; forwardedFor?: string}

const servers: Array<http.Server | WebSocketServer> = []

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function listen(server: http.Server) {
	servers.push(server)
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	return (server.address() as net.AddressInfo).port
}

// An upstream that echoes what it received and accepts WebSockets.
async function createUpstream(name: string) {
	const server = http.createServer((request, response) => {
		const seen: Seen = {
			upstream: name,
			url: request.url,
			proto: request.headers['x-forwarded-proto'] as string,
			host: request.headers.host,
			forwardedFor: request.headers['x-forwarded-for'] as string,
		}
		response.setHeader('content-type', 'application/json')
		response.end(JSON.stringify(seen))
	})
	const wss = new WebSocketServer({server})
	servers.push(wss)
	wss.on('connection', (socket) => socket.send(name))
	return listen(server)
}

type FakeApp = {port: number; protected?: boolean}

async function createIngress({
	dashboardPort,
	apps,
	publicApps,
}: {
	dashboardPort: number
	apps: Record<string, FakeApp>
	publicApps?: string[]
}) {
	const logger = {createChildLogger: () => logger, log: () => {}, verbose: () => {}, error: () => {}}
	const settings = {enabled: true, domain: 'arcbase.example.com', publicApps}
	const domainAccess = new DomainAccess({logger, store: {get: async () => settings}} as never)
	await domainAccess.start()
	const ingress = new LanIngress({dataDirectory: '/tmp', logger, port: dashboardPort, domainAccess} as never)
	const internals = ingress as unknown as {
		findAppMuxServer(label: string): unknown
		createHttpProxyServer(port: number, protocol: 'http', options: {domainRouting: boolean}): http.Server
	}
	// Fake mux entries the way updateAppMuxServers records them. The gateway
	// server is a closed server, as during an app restart: routing must only
	// rely on the recorded upstream port.
	vi.spyOn(internals, 'findAppMuxServer').mockImplementation((label) => {
		const app = apps[label]
		if (!app) return
		return {
			route: {id: label, publicPort: 1, hiddenPort: 2, gateway: app.protected === false ? undefined : {auth: true}},
			gatewayServer: app.protected === false ? undefined : http.createServer(),
			upstreamPort: app.port,
		}
	})
	const server = internals.createHttpProxyServer(dashboardPort, 'http', {domainRouting: true})
	return listen(server)
}

function get(port: number, host: string, headers: Record<string, string> = {}) {
	return new Promise<{status: number; body: string}>((resolve, reject) => {
		const request = http.get({host: '127.0.0.1', port, path: '/', headers: {host, ...headers}}, (response) => {
			let body = ''
			response.on('data', (chunk) => (body += chunk))
			response.on('end', () => resolve({status: response.statusCode!, body}))
		})
		request.on('error', reject)
	})
}

const tunnel = {'cf-visitor': '{"scheme":"https"}', 'cf-ray': 'test'}

describe('LAN ingress domain routing', () => {
	test('routes the dashboard, app login and app hostnames by Host header', async () => {
		const dashboardPort = await createUpstream('dashboard')
		const filesPort = await createUpstream('files')
		const port = await createIngress({dashboardPort, apps: {files: {port: filesPort}}})

		const dashboard = JSON.parse((await get(port, 'arcbase.example.com', tunnel)).body) as Seen
		expect(dashboard).toMatchObject({upstream: 'dashboard', url: '/', proto: 'https', host: 'arcbase.example.com'})

		const app = JSON.parse((await get(port, 'files.arcbase.example.com', tunnel)).body) as Seen
		expect(app).toMatchObject({upstream: 'files', url: '/', proto: 'https', host: 'files.arcbase.example.com'})

		// App login lives on the dashboard domain; there is no auth hostname.
		expect((await get(port, 'auth.arcbase.example.com', tunnel)).status).toBe(404)
		expect((await get(port, 'missing.arcbase.example.com', tunnel)).status).toBe(404)
	})

	test('strips client address headers the tunnel forwards before reaching apps', async () => {
		const dashboardPort = await createUpstream('dashboard')
		const filesPort = await createUpstream('files')
		const port = await createIngress({dashboardPort, apps: {files: {port: filesPort}}})

		const app = JSON.parse(
			(
				await get(port, 'files.arcbase.example.com', {
					...tunnel,
					'x-forwarded-for': '192.168.1.10, 203.0.113.7',
					'cf-connecting-ip': '203.0.113.7',
				})
			).body,
		) as Seen
		expect(app.upstream).toBe('files')
		expect(app.forwardedFor).toBeUndefined()
	})

	test('serves apps without ArcbaseOS login only when the owner opted them in', async () => {
		const dashboardPort = await createUpstream('dashboard')
		const jellyfinPort = await createUpstream('jellyfin')
		const adguardPort = await createUpstream('adguard')
		const port = await createIngress({
			dashboardPort,
			apps: {jellyfin: {port: jellyfinPort, protected: false}, adguard: {port: adguardPort, protected: false}},
			publicApps: ['jellyfin'],
		})

		expect(JSON.parse((await get(port, 'jellyfin.arcbase.example.com', tunnel)).body).upstream).toBe('jellyfin')
		expect((await get(port, 'adguard.arcbase.example.com', tunnel)).status).toBe(404)
	})

	test('redirects plain HTTP visits to the public domain to HTTPS', async () => {
		const dashboardPort = await createUpstream('dashboard')
		const port = await createIngress({dashboardPort, apps: {}})

		const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
			http
				.get(
					{
						host: '127.0.0.1',
						port,
						path: '/login?next=1',
						headers: {host: 'arcbase.example.com', 'cf-visitor': '{"scheme":"http"}'},
					},
					resolve,
				)
				.on('error', reject)
		})
		response.resume()
		expect(response.statusCode).toBe(308)
		expect(response.headers.location).toBe('https://arcbase.example.com/login?next=1')
	})

	test('keeps the real protocol for requests that did not come through Cloudflare', async () => {
		const dashboardPort = await createUpstream('dashboard')
		const port = await createIngress({dashboardPort, apps: {}})

		const spoofed = JSON.parse((await get(port, 'umbrel.local', {'x-forwarded-proto': 'https'})).body) as Seen
		expect(spoofed).toMatchObject({upstream: 'dashboard', proto: 'http'})

		const lanDomain = JSON.parse((await get(port, 'arcbase.example.com')).body) as Seen
		expect(lanDomain).toMatchObject({upstream: 'dashboard', proto: 'http'})
	})

	test('routes WebSocket upgrades by Host even after other hosts were proxied', async () => {
		const dashboardPort = await createUpstream('dashboard')
		const filesPort = await createUpstream('files')
		const port = await createIngress({dashboardPort, apps: {files: {port: filesPort}}})

		// Serve plain requests on both hosts first: a middleware must not claim
		// every later upgrade on the shared server.
		await get(port, 'arcbase.example.com')
		await get(port, 'files.arcbase.example.com')

		const receive = (host: string) =>
			new Promise<string>((resolve, reject) => {
				const socket = new WebSocket(`ws://127.0.0.1:${port}/`, {headers: {host}})
				socket.once('message', (data) => {
					resolve(data.toString())
					socket.close()
				})
				socket.once('error', reject)
			})
		expect(await receive('files.arcbase.example.com')).toBe('files')
		expect(await receive('arcbase.example.com')).toBe('dashboard')
	})
})

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

async function createIngress({dashboardPort, appPorts}: {dashboardPort: number; appPorts: Record<string, number>}) {
	const logger = {createChildLogger: () => logger, log: () => {}, verbose: () => {}, error: () => {}}
	const settings = {enabled: true, domain: 'arcbase.example.com', appHostTemplate: '{app}.arcbase.example.com'}
	const domainAccess = new DomainAccess({logger, store: {get: async () => settings}} as never)
	await domainAccess.start()
	const ingress = new LanIngress({dataDirectory: '/tmp', logger, port: dashboardPort, domainAccess} as never)
	const internals = ingress as unknown as {
		getDomainAppUpstreamPort(label: string): number | undefined
		createHttpProxyServer(port: number, protocol: 'http', options: {domainRouting: boolean}): http.Server
	}
	vi.spyOn(internals, 'getDomainAppUpstreamPort').mockImplementation((label) => appPorts[label])
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

describe('LAN ingress domain routing', () => {
	test('routes the dashboard, auth and app hostnames by Host header', async () => {
		const dashboardPort = await createUpstream('dashboard')
		const filesPort = await createUpstream('files')
		const port = await createIngress({dashboardPort, appPorts: {files: filesPort}})
		const tunnel = {'x-forwarded-proto': 'https'}

		const dashboard = JSON.parse((await get(port, 'arcbase.example.com', tunnel)).body) as Seen
		expect(dashboard).toMatchObject({upstream: 'dashboard', url: '/', proto: 'https', host: 'arcbase.example.com'})

		const auth = JSON.parse((await get(port, 'auth.arcbase.example.com', tunnel)).body) as Seen
		expect(auth).toMatchObject({upstream: 'dashboard', url: '/app-auth/', proto: 'https'})

		const app = JSON.parse((await get(port, 'files.arcbase.example.com', tunnel)).body) as Seen
		expect(app).toMatchObject({upstream: 'files', url: '/', proto: 'https', host: 'files.arcbase.example.com'})
		// Apps never receive X-Forwarded-For, matching the per-app HTTPS proxies.
		expect(app.forwardedFor).toBeUndefined()

		expect((await get(port, 'missing.arcbase.example.com', tunnel)).status).toBe(404)
	})

	test('keeps the real protocol for LAN hosts and requests without tunnel headers', async () => {
		const dashboardPort = await createUpstream('dashboard')
		const port = await createIngress({dashboardPort, appPorts: {}})

		const spoofed = JSON.parse((await get(port, 'umbrel.local', {'x-forwarded-proto': 'https'})).body) as Seen
		expect(spoofed).toMatchObject({upstream: 'dashboard', proto: 'http'})

		const plain = JSON.parse((await get(port, 'arcbase.example.com')).body) as Seen
		expect(plain).toMatchObject({upstream: 'dashboard', proto: 'http'})
	})

	test('routes WebSocket upgrades by Host even after other hosts were proxied', async () => {
		const dashboardPort = await createUpstream('dashboard')
		const filesPort = await createUpstream('files')
		const port = await createIngress({dashboardPort, appPorts: {files: filesPort}})

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

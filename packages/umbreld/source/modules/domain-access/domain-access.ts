import type http from 'node:http'

import type Umbreld from '../../index.js'

// ArcbaseOS can be reached through a public domain that a reverse tunnel such
// as cloudflared forwards to the LAN ingress dashboard port (80, or 443 with
// TLS verification disabled in the tunnel). A tunnel only routes hostnames, not
// the per-app ports used on the LAN, so every app gets its own hostname built
// from a template such as `{app}.example.com`. App login happens on the
// dashboard domain itself under `/app-auth`, so the dashboard session (and its
// logout) also covers apps, like the shared hostname does on the LAN.

export const APP_HOST_PLACEHOLDER = '{app}'

export type DomainAccessSettings = {
	enabled: boolean
	// Hostname serving the dashboard, e.g. `home.example.com`.
	domain: string
	// Custom hostname template for apps, containing `{app}` exactly once.
	// Defaults to `{app}.<domain>` when unset.
	appHostTemplate?: string
	// Apps without ArcbaseOS login (no app gateway, or login turned off) that
	// the owner explicitly chose to expose on the public domain.
	publicApps?: string[]
}

export type DomainAccessInput = {
	enabled: boolean
	domain: string
	appHostTemplate?: string
	publicApps?: string[]
}

export type DomainAccessHost = {kind: 'dashboard'} | {kind: 'app'; label: string}

const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const APP_ID_PATTERN = /^[a-zA-Z0-9-]+$/
// Names that only resolve on the local network or the device itself. A public
// domain under them would shadow LAN hostnames like `umbrel.local`.
const LOCAL_SUFFIXES = ['local', 'localhost', 'internal', 'lan', 'home.arpa', 'onion', 'test', 'invalid']

export function normalizeHostname(value: unknown) {
	if (typeof value !== 'string') return null
	const hostname = value.trim().toLowerCase().replace(/\.$/, '')
	if (!hostname || hostname.length > 253) return null
	const labels = hostname.split('.')
	if (labels.length < 2 || labels.some((label) => !LABEL_PATTERN.test(label))) return null
	// A purely numeric final label would make this an IPv4 literal, not a domain.
	if (/^[0-9]+$/.test(labels.at(-1)!)) return null
	if (LOCAL_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))) return null
	return hostname
}

// Return the hostname a template produces for one label, or null if the
// template is not a valid hostname template.
function fillTemplate(template: string, label: string) {
	const index = template.indexOf(APP_HOST_PLACEHOLDER)
	if (index === -1 || template.indexOf(APP_HOST_PLACEHOLDER, index + 1) !== -1) return null
	return normalizeHostname(template.replace(APP_HOST_PLACEHOLDER, label))
}

export function normalizeAppHostTemplate(value: unknown) {
	if (typeof value !== 'string') return null
	const template = value.trim().toLowerCase().replace(/\.$/, '')
	// App ids never contain dots, so the placeholder always expands inside a
	// single DNS label.
	return fillTemplate(template, 'x') ? template : null
}

export function effectiveAppHostTemplate(settings: Pick<DomainAccessSettings, 'domain' | 'appHostTemplate'>) {
	return settings.appHostTemplate ?? `${APP_HOST_PLACEHOLDER}.${settings.domain}`
}

export function appHostname(settings: DomainAccessSettings, appId: string) {
	if (!APP_ID_PATTERN.test(appId)) return null
	return fillTemplate(effectiveAppHostTemplate(settings), appId.toLowerCase())
}

// Strip the port from a Host header and lowercase it. IPv6 literals never match
// a domain, so they are returned as-is without their brackets.
export function hostnameFromHostHeader(host: string | undefined) {
	if (!host) return ''
	const value = host.trim().toLowerCase()
	if (value.startsWith('[')) return value.slice(1, value.indexOf(']'))
	return value.replace(/:\d*$/, '').replace(/\.$/, '')
}

export function matchDomainAccessHost(
	settings: DomainAccessSettings | undefined,
	host: string | undefined,
): DomainAccessHost | undefined {
	if (!settings?.enabled) return
	const hostname = hostnameFromHostHeader(host)
	if (!hostname) return
	if (hostname === settings.domain) return {kind: 'dashboard'}

	const [prefix, suffix] = effectiveAppHostTemplate(settings).split(APP_HOST_PLACEHOLDER)
	if (hostname.length <= prefix.length + suffix.length) return
	if (!hostname.startsWith(prefix) || !hostname.endsWith(suffix)) return
	const label = hostname.slice(prefix.length, hostname.length - suffix.length)
	if (!/^[a-z0-9-]+$/.test(label)) return
	return {kind: 'app', label}
}

function firstHeader(value: string | string[] | undefined) {
	return Array.isArray(value) ? value[0] : value
}

// The scheme the visitor used at Cloudflare's edge. cloudflared talks plain
// HTTP to the dashboard port while the browser may use HTTPS, and Cloudflare
// reports the visitor's scheme in `CF-Visitor` (and `X-Forwarded-Proto` next
// to `CF-Ray`). This deliberately does not depend on the configured domain, so
// saving or changing the domain never flips which session cookie a tunnel
// request expects. A LAN client forging these headers only affects its own
// requests: its Secure cookies are refused over plain HTTP.
export function cloudflareVisitorScheme(headers: http.IncomingHttpHeaders): 'http' | 'https' | undefined {
	const visitor = firstHeader(headers['cf-visitor'])
	if (visitor) {
		try {
			const scheme = JSON.parse(visitor)?.scheme
			if (scheme === 'http' || scheme === 'https') return scheme
		} catch {}
	}
	if (!firstHeader(headers['cf-ray'])) return
	const proto = firstHeader(headers['x-forwarded-proto'])?.split(',')[0]?.trim().toLowerCase()
	return proto === 'http' || proto === 'https' ? proto : undefined
}

// The protocol the browser used for a request reaching a dashboard listener.
export function originalProtocol(request: http.IncomingMessage, listenerProtocol: 'http' | 'https') {
	if (listenerProtocol === 'https') return 'https'
	return cloudflareVisitorScheme(request.headers) === 'https' ? 'https' : 'http'
}

export function parseDomainAccessSettings(input: DomainAccessInput): DomainAccessSettings {
	const domain = normalizeHostname(input.domain)
	if (!domain) throw new Error('Invalid domain. Use a public domain such as home.example.com')

	let appHostTemplate: string | undefined
	if (input.appHostTemplate?.trim()) {
		const template = normalizeAppHostTemplate(input.appHostTemplate)
		if (!template) {
			throw new Error(
				`Invalid app hostname template. It must contain ${APP_HOST_PLACEHOLDER} once and be a public domain`,
			)
		}
		// Store the default as unset so it keeps following later domain changes.
		if (template !== effectiveAppHostTemplate({domain})) appHostTemplate = template
	}

	const publicApps = [...new Set((input.publicApps ?? []).filter((appId) => APP_ID_PATTERN.test(appId)))].sort()
	return {
		enabled: input.enabled,
		domain,
		...(appHostTemplate ? {appHostTemplate} : {}),
		...(publicApps.length > 0 ? {publicApps} : {}),
	}
}

export default class DomainAccess {
	#umbreld: Umbreld
	#settings?: DomainAccessSettings
	logger: Umbreld['logger']

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		this.logger = umbreld.logger.createChildLogger('domain-access')
	}

	async start() {
		const stored = await this.#umbreld.store.get('settings.domainAccess')
		try {
			this.#settings = stored ? parseDomainAccessSettings(stored) : undefined
		} catch (error) {
			this.logger.error('Ignoring invalid domain access settings', error)
			this.#settings = undefined
		}
		if (this.#settings?.enabled) this.logger.log(`Domain access enabled for ${this.#settings.domain}`)
	}

	get() {
		const settings = this.#settings
		return {
			enabled: settings?.enabled ?? false,
			domain: settings?.domain ?? '',
			// The custom template only, so the UI can leave the default empty.
			appHostTemplate: settings?.appHostTemplate ?? '',
			effectiveAppHostTemplate: settings ? effectiveAppHostTemplate(settings) : '',
			publicApps: settings?.publicApps ?? [],
		}
	}

	async set(input: DomainAccessInput) {
		const settings = parseDomainAccessSettings(input)
		await this.#umbreld.store.set('settings.domainAccess', settings)
		this.#settings = settings
		this.logger.log(`Domain access ${settings.enabled ? 'enabled' : 'disabled'} for ${settings.domain}`)
		return this.get()
	}

	match(host: string | undefined) {
		return matchDomainAccessHost(this.#settings, host)
	}

	// Whether an app without ArcbaseOS login may be served on the domain.
	isPublicApp(appId: string) {
		return this.#settings?.publicApps?.includes(appId) ?? false
	}

	appHostname(appId: string) {
		return this.#settings?.enabled ? appHostname(this.#settings, appId) : null
	}

	// Apps on the domain log in on the dashboard domain itself.
	appAuthHostname() {
		return this.#settings?.enabled ? this.#settings.domain : null
	}
}

import type http from 'node:http'

import type Umbreld from '../../index.js'

// ArcbaseOS can be reached through a public domain that a reverse tunnel such
// as cloudflared forwards to the LAN ingress dashboard port (80, or 443 with
// TLS verification disabled in the tunnel). A tunnel only routes hostnames, not
// the per-app ports used on the LAN, so every app gets its own hostname built
// from a template such as `{app}.arcbase.example.com`. App login happens on the
// reserved `auth` hostname, mirroring the dedicated `:2000` origin on the LAN.

export const APP_HOST_PLACEHOLDER = '{app}'
export const AUTH_HOST_LABEL = 'auth'

export type DomainAccessSettings = {
	enabled: boolean
	// Hostname serving the dashboard, e.g. `arcbase.example.com`.
	domain: string
	// Hostname template for apps, containing `{app}` exactly once.
	appHostTemplate: string
}

export type DomainAccessHost = {kind: 'dashboard'} | {kind: 'auth'} | {kind: 'app'; label: string}

const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export function normalizeHostname(value: unknown) {
	if (typeof value !== 'string') return null
	const hostname = value.trim().toLowerCase().replace(/\.$/, '')
	if (!hostname || hostname.length > 253) return null
	const labels = hostname.split('.')
	if (labels.length < 2 || labels.some((label) => !LABEL_PATTERN.test(label))) return null
	// A purely numeric final label would make this an IPv4 literal, not a domain.
	if (/^[0-9]+$/.test(labels.at(-1)!)) return null
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
	// single DNS label. Check the reserved auth label expands to a valid name too.
	if (!fillTemplate(template, 'x') || !fillTemplate(template, AUTH_HOST_LABEL)) return null
	return template
}

export function defaultAppHostTemplate(domain: string) {
	return `${APP_HOST_PLACEHOLDER}.${domain}`
}

export function appHostname(settings: DomainAccessSettings, appId: string) {
	return fillTemplate(settings.appHostTemplate, appId.toLowerCase())
}

export function authHostname(settings: DomainAccessSettings) {
	return fillTemplate(settings.appHostTemplate, AUTH_HOST_LABEL)
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

	const [prefix, suffix] = settings.appHostTemplate.split(APP_HOST_PLACEHOLDER)
	if (hostname.length <= prefix.length + suffix.length) return
	if (!hostname.startsWith(prefix) || !hostname.endsWith(suffix)) return
	const label = hostname.slice(prefix.length, hostname.length - suffix.length)
	if (!/^[a-z0-9-]+$/.test(label)) return
	if (label === AUTH_HOST_LABEL) return {kind: 'auth'}
	return {kind: 'app', label}
}

function firstHeader(value: string | string[] | undefined) {
	return Array.isArray(value) ? value[0] : value
}

// cloudflared talks plain HTTP to the dashboard port while the browser uses
// HTTPS at Cloudflare's edge. Cloudflare reports the visitor's scheme in
// `X-Forwarded-Proto` and `CF-Visitor`; callers only honour them for the
// configured domain so LAN requests keep their real protocol.
export function forwardedHttps(headers: http.IncomingHttpHeaders) {
	const proto = firstHeader(headers['x-forwarded-proto'])?.split(',')[0]?.trim().toLowerCase()
	if (proto === 'https') return true
	const visitor = firstHeader(headers['cf-visitor'])
	if (!visitor) return false
	try {
		return JSON.parse(visitor)?.scheme === 'https'
	} catch {
		return false
	}
}

export function parseDomainAccessSettings(input: {
	enabled: boolean
	domain: string
	appHostTemplate?: string
}): DomainAccessSettings {
	const domain = normalizeHostname(input.domain)
	if (!domain) throw new Error('Invalid domain')
	const appHostTemplate = normalizeAppHostTemplate(input.appHostTemplate?.trim() || defaultAppHostTemplate(domain))
	if (!appHostTemplate) throw new Error(`Invalid app hostname template, it must contain ${APP_HOST_PLACEHOLDER} once`)
	const settings = {enabled: input.enabled, domain, appHostTemplate}
	if (authHostname(settings) === domain) throw new Error('The dashboard domain cannot be an app hostname')
	return settings
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

	// Synchronous so LAN ingress can route every request without awaiting the store.
	get settings() {
		return this.#settings
	}

	get() {
		const settings = this.#settings
		return {
			enabled: settings?.enabled ?? false,
			domain: settings?.domain ?? '',
			appHostTemplate: settings?.appHostTemplate ?? '',
			authHostname: settings ? authHostname(settings) : '',
		}
	}

	async set(input: {enabled: boolean; domain: string; appHostTemplate?: string}) {
		const settings = parseDomainAccessSettings(input)
		await this.#umbreld.store.set('settings.domainAccess', settings)
		this.#settings = settings
		this.logger.log(`Domain access ${settings.enabled ? 'enabled' : 'disabled'} for ${settings.domain}`)
		return this.get()
	}

	async clear() {
		await this.#umbreld.store.delete('settings.domainAccess')
		this.#settings = undefined
		return this.get()
	}

	match(host: string | undefined) {
		return matchDomainAccessHost(this.#settings, host)
	}

	appHostname(appId: string) {
		if (!/^[a-zA-Z0-9-]+$/.test(appId)) return null
		return this.#settings?.enabled ? appHostname(this.#settings, appId) : null
	}

	authHostname() {
		return this.#settings?.enabled ? authHostname(this.#settings) : null
	}

	// The protocol the browser used. Requests on the plain-HTTP port that carry
	// the tunnel's HTTPS markers for the configured domain are HTTPS requests.
	originalProtocol(request: http.IncomingMessage, listenerProtocol: 'http' | 'https'): 'http' | 'https' {
		if (listenerProtocol === 'https') return 'https'
		return this.match(request.headers.host) && forwardedHttps(request.headers) ? 'https' : 'http'
	}
}

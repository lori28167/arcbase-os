import {describe, expect, test} from 'vitest'

import {
	appHostname,
	cloudflareVisitorScheme,
	effectiveAppHostTemplate,
	matchDomainAccessHost,
	normalizeAppHostTemplate,
	normalizeHostname,
	originalProtocol,
	parseDomainAccessSettings,
} from './domain-access.js'

describe('domain access settings', () => {
	test('normalizes hostnames and rejects invalid or local ones', () => {
		expect(normalizeHostname(' Arcbase.Example.COM. ')).toBe('arcbase.example.com')
		expect(normalizeHostname('localhost')).toBeNull()
		expect(normalizeHostname('192.168.1.10')).toBeNull()
		expect(normalizeHostname('-bad.example.com')).toBeNull()
		expect(normalizeHostname('under_score.example.com')).toBeNull()
		expect(normalizeHostname('https://example.com')).toBeNull()
		expect(normalizeHostname('umbrel.local')).toBeNull()
		expect(normalizeHostname('nas.home.arpa')).toBeNull()
		expect(normalizeHostname('box.lan')).toBeNull()
	})

	test('app hostname templates contain the placeholder exactly once and stay public', () => {
		expect(normalizeAppHostTemplate('{app}.example.com')).toBe('{app}.example.com')
		expect(normalizeAppHostTemplate('{APP}-home.Example.com')).toBe('{app}-home.example.com')
		expect(normalizeAppHostTemplate('example.com')).toBeNull()
		expect(normalizeAppHostTemplate('{app}.{app}.example.com')).toBeNull()
		expect(normalizeAppHostTemplate('{app}')).toBeNull()
		expect(normalizeAppHostTemplate('{app}.local')).toBeNull()
	})

	test('defaults apps to subdomains of the dashboard domain, following domain changes', () => {
		const settings = parseDomainAccessSettings({enabled: true, domain: 'Arcbase.Example.com'})
		expect(settings).toEqual({enabled: true, domain: 'arcbase.example.com'})
		expect(appHostname(settings, 'Nextcloud')).toBe('nextcloud.arcbase.example.com')

		// Sending the default template back stores nothing, so a later domain
		// change still moves the apps.
		const resaved = parseDomainAccessSettings({...settings, appHostTemplate: '{app}.arcbase.example.com'})
		expect(resaved.appHostTemplate).toBeUndefined()
		expect(effectiveAppHostTemplate({...resaved, domain: 'b.example.com'})).toBe('{app}.b.example.com')
	})

	test('keeps a custom template and the opted-in public apps', () => {
		const settings = parseDomainAccessSettings({
			enabled: true,
			domain: 'home.example.com',
			appHostTemplate: '{app}.example.com',
			publicApps: ['jellyfin', 'jellyfin', 'bad app', 'adguard'],
		})
		expect(settings).toEqual({
			enabled: true,
			domain: 'home.example.com',
			appHostTemplate: '{app}.example.com',
			publicApps: ['adguard', 'jellyfin'],
		})
		expect(appHostname(settings, 'files')).toBe('files.example.com')
		expect(appHostname(settings, 'evil.example.org')).toBeNull()
	})

	test('rejects invalid domains and templates', () => {
		expect(() => parseDomainAccessSettings({enabled: true, domain: 'not a domain'})).toThrow('Invalid domain')
		expect(() => parseDomainAccessSettings({enabled: true, domain: 'umbrel.local'})).toThrow('Invalid domain')
		expect(() =>
			parseDomainAccessSettings({enabled: true, domain: 'home.example.com', appHostTemplate: '{app}.local'}),
		).toThrow('Invalid app hostname template')
	})
})

describe('matchDomainAccessHost', () => {
	const settings = parseDomainAccessSettings({
		enabled: true,
		domain: 'home.example.com',
		appHostTemplate: '{app}.example.com',
	})

	test('classifies dashboard and app hostnames', () => {
		expect(matchDomainAccessHost(settings, 'home.example.com')).toEqual({kind: 'dashboard'})
		expect(matchDomainAccessHost(settings, 'HOME.example.com:443')).toEqual({kind: 'dashboard'})
		expect(matchDomainAccessHost(settings, 'nextcloud.example.com')).toEqual({kind: 'app', label: 'nextcloud'})
		// There is no separate auth hostname; `auth` is an ordinary app label.
		expect(matchDomainAccessHost(settings, 'auth.example.com')).toEqual({kind: 'app', label: 'auth'})
	})

	test('ignores LAN hosts, nested labels and disabled settings', () => {
		expect(matchDomainAccessHost(settings, 'umbrel.local')).toBeUndefined()
		expect(matchDomainAccessHost(settings, '192.168.1.10:80')).toBeUndefined()
		expect(matchDomainAccessHost(settings, '[::1]:80')).toBeUndefined()
		expect(matchDomainAccessHost(settings, 'a.b.example.com')).toBeUndefined()
		expect(matchDomainAccessHost(settings, '.example.com')).toBeUndefined()
		expect(matchDomainAccessHost(settings, undefined)).toBeUndefined()
		expect(matchDomainAccessHost({...settings, enabled: false}, 'home.example.com')).toBeUndefined()
		expect(matchDomainAccessHost(undefined, 'home.example.com')).toBeUndefined()
	})
})

describe('cloudflareVisitorScheme', () => {
	test('reads the visitor scheme Cloudflare forwards', () => {
		expect(cloudflareVisitorScheme({'cf-visitor': '{"scheme":"https"}'})).toBe('https')
		expect(cloudflareVisitorScheme({'cf-visitor': '{"scheme":"http"}'})).toBe('http')
		expect(cloudflareVisitorScheme({'cf-ray': 'abc', 'x-forwarded-proto': 'https'})).toBe('https')
		expect(cloudflareVisitorScheme({'cf-visitor': 'not json'})).toBeUndefined()
		expect(cloudflareVisitorScheme({})).toBeUndefined()
	})

	test('ignores X-Forwarded-Proto that did not come through Cloudflare', () => {
		expect(cloudflareVisitorScheme({'x-forwarded-proto': 'https'})).toBeUndefined()
	})

	test('does not depend on the Host, so saving settings never flips the session cookie', () => {
		const request = (headers: Record<string, string>) => ({headers}) as never
		expect(originalProtocol(request({'cf-visitor': '{"scheme":"https"}', host: 'anything.example'}), 'http')).toBe(
			'https',
		)
		expect(originalProtocol(request({host: 'umbrel.local'}), 'http')).toBe('http')
		expect(originalProtocol(request({}), 'https')).toBe('https')
	})
})

import {describe, expect, test} from 'vitest'

import {
	appHostname,
	authHostname,
	forwardedHttps,
	matchDomainAccessHost,
	normalizeAppHostTemplate,
	normalizeHostname,
	parseDomainAccessSettings,
} from './domain-access.js'

describe('domain access settings', () => {
	test('normalizes hostnames and rejects invalid ones', () => {
		expect(normalizeHostname(' Arcbase.Example.COM. ')).toBe('arcbase.example.com')
		expect(normalizeHostname('localhost')).toBeNull()
		expect(normalizeHostname('192.168.1.10')).toBeNull()
		expect(normalizeHostname('-bad.example.com')).toBeNull()
		expect(normalizeHostname('under_score.example.com')).toBeNull()
		expect(normalizeHostname('https://example.com')).toBeNull()
	})

	test('app hostname templates contain the placeholder exactly once', () => {
		expect(normalizeAppHostTemplate('{app}.example.com')).toBe('{app}.example.com')
		expect(normalizeAppHostTemplate('{APP}-home.Example.com')).toBe('{app}-home.example.com')
		expect(normalizeAppHostTemplate('example.com')).toBeNull()
		expect(normalizeAppHostTemplate('{app}.{app}.example.com')).toBeNull()
		expect(normalizeAppHostTemplate('{app}')).toBeNull()
	})

	test('defaults apps to subdomains of the dashboard domain', () => {
		const settings = parseDomainAccessSettings({enabled: true, domain: 'Arcbase.Example.com'})
		expect(settings).toEqual({
			enabled: true,
			domain: 'arcbase.example.com',
			appHostTemplate: '{app}.arcbase.example.com',
		})
		expect(appHostname(settings, 'Nextcloud')).toBe('nextcloud.arcbase.example.com')
		expect(authHostname(settings)).toBe('auth.arcbase.example.com')
	})

	test('rejects a template whose auth hostname is the dashboard', () => {
		expect(() =>
			parseDomainAccessSettings({enabled: true, domain: 'auth.example.com', appHostTemplate: '{app}.example.com'}),
		).toThrow()
		expect(() => parseDomainAccessSettings({enabled: true, domain: 'not a domain'})).toThrow('Invalid domain')
	})
})

describe('matchDomainAccessHost', () => {
	const settings = parseDomainAccessSettings({
		enabled: true,
		domain: 'home.example.com',
		appHostTemplate: '{app}-home.example.com',
	})

	test('classifies dashboard, auth and app hostnames', () => {
		expect(matchDomainAccessHost(settings, 'home.example.com')).toEqual({kind: 'dashboard'})
		expect(matchDomainAccessHost(settings, 'HOME.example.com:443')).toEqual({kind: 'dashboard'})
		expect(matchDomainAccessHost(settings, 'auth-home.example.com')).toEqual({kind: 'auth'})
		expect(matchDomainAccessHost(settings, 'nextcloud-home.example.com')).toEqual({kind: 'app', label: 'nextcloud'})
	})

	test('ignores LAN hosts, nested labels and disabled settings', () => {
		expect(matchDomainAccessHost(settings, 'umbrel.local')).toBeUndefined()
		expect(matchDomainAccessHost(settings, '192.168.1.10:80')).toBeUndefined()
		expect(matchDomainAccessHost(settings, '[::1]:80')).toBeUndefined()
		expect(matchDomainAccessHost(settings, 'a.b-home.example.com')).toBeUndefined()
		expect(matchDomainAccessHost(settings, '-home.example.com')).toBeUndefined()
		expect(matchDomainAccessHost(settings, undefined)).toBeUndefined()
		expect(matchDomainAccessHost({...settings, enabled: false}, 'home.example.com')).toBeUndefined()
		expect(matchDomainAccessHost(undefined, 'home.example.com')).toBeUndefined()
	})
})

describe('forwardedHttps', () => {
	test('reads the visitor scheme Cloudflare forwards', () => {
		expect(forwardedHttps({'x-forwarded-proto': 'https'})).toBe(true)
		expect(forwardedHttps({'x-forwarded-proto': 'https, http'})).toBe(true)
		expect(forwardedHttps({'cf-visitor': '{"scheme":"https"}'})).toBe(true)
		expect(forwardedHttps({'x-forwarded-proto': 'http'})).toBe(false)
		expect(forwardedHttps({'cf-visitor': 'not json'})).toBe(false)
		expect(forwardedHttps({})).toBe(false)
	})
})

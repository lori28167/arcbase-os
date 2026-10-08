import {indexBy} from 'remeda'

import {UserApp} from '@/trpc/trpc'

export function firstNameFromFullName(name: string) {
	return name.split(' ')[0]
}

export function sleep(milliseconds: number) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function isNormalNumber(value: number | null | undefined): value is number {
	if (value === undefined || value === null) return false
	return value !== Infinity && value !== -Infinity && !isNaN(value)
}

// https://stackoverflow.com/a/39419171
export function assertUnreachable(x: never): never {
	throw new Error("Didn't expect to get here, got " + x)
}

/**
 * Does what lodash's keyBy does, but returns with better types
 */
export function keyBy<T, U extends keyof T>(array: ReadonlyArray<T>, key: U): Record<T[U] & string, T> {
	return indexBy(array, (el) => el[key])
}

// Not using `url-join` or others because they remove desired slashes after joining. `new URL('?bla=1', 'http://localhost:3001/a/').href` preserves trailing slash to return 'http://localhost:3001/a/?bla=1'
// The `transmission` app depends on this behavior because the app's full path is `http://localhost:9091/transmission/web/` but when joining a query string, we want it to be `http://localhost:9091/transmission/web/?bla=1`
export function urlJoin(base: string, path: string) {
	return new URL(path, base).href
}

/** `urlJoin` doesn't work when used like so: `urlJoin('foo', 'bar')`, and sometimes we just want basic behavior */
export function pathJoin(base: string, path: string) {
	// Remove trailing slash from base and leading slash from path
	return base.replace(/\/$/, '') + '/' + path.replace(/^\//, '')
}

export type DomainAccessInfo = {enabled: boolean; domain: string; effectiveAppHostTemplate: string}

const DOMAIN_ACCESS_KEY = 'ARCBASE_DOMAIN_ACCESS'

function readCachedDomainAccess(): DomainAccessInfo | undefined {
	try {
		const value = JSON.parse(localStorage.getItem(DOMAIN_ACCESS_KEY) ?? 'null')
		if (typeof value?.domain === 'string' && typeof value?.effectiveAppHostTemplate === 'string') return value
	} catch {
		// Storage can be unavailable or hold stale data; wait for the query instead.
	}
}

// Public domain routed to ArcbaseOS by a tunnel such as cloudflared. Kept at
// module level because app URLs are built outside React render, and cached so
// app links are right before the settings query resolves on the next load.
let domainAccess: DomainAccessInfo | undefined = readCachedDomainAccess()
let appIdsByPort = new Map<string, string>()

export function setDomainAccess(value: DomainAccessInfo) {
	domainAccess = {
		enabled: value.enabled,
		domain: value.domain,
		effectiveAppHostTemplate: value.effectiveAppHostTemplate,
	}
	try {
		localStorage.setItem(DOMAIN_ACCESS_KEY, JSON.stringify(domainAccess))
	} catch {
		// Only a load-time optimisation; the in-memory value is already updated.
	}
}

// Lets `umbrel:<port>` shortcuts resolve to an app's public hostname.
export function setDomainAccessApps(apps: {id: string; port: number}[]) {
	appIdsByPort = new Map(apps.map((app) => [String(app.port), app.id]))
}

function isOnDomainAccessHost() {
	if (!domainAccess?.enabled) return false
	return location.hostname.toLowerCase().replace(/\.$/, '') === domainAccess.domain
}

/**
 * The app's own public hostname, but only while the dashboard is open on the
 * public domain. A tunnel routes hostnames rather than ports, so `domain:port`
 * would not reach the app. LAN access keeps using `hostname:port`.
 */
export function domainAccessAppHostname(appId: string) {
	if (!isOnDomainAccessHost() || !domainAccess!.effectiveAppHostTemplate.includes('{app}')) return
	return domainAccess!.effectiveAppHostTemplate.replace('{app}', appId.toLowerCase())
}

/** URL for a `umbrel:<port>[/path]` shortcut target on the current host. */
export function umbrelPortUrl(portAndPath: string, protocol = location.protocol) {
	const separator = portAndPath.search(/[/?#]/)
	const port = separator === -1 ? portAndPath : portAndPath.slice(0, separator)
	const rest = separator === -1 ? '' : portAndPath.slice(separator)
	const appId = appIdsByPort.get(port)
	const publicHostname = appId ? domainAccessAppHostname(appId) : undefined
	if (publicHostname) return `${protocol}//${publicHostname}${rest}`
	return `${protocol}//${location.hostname}:${portAndPath}`
}

export function appToUrl(app: UserApp, protocol = location.protocol) {
	if (isOnionPage()) return `${location.protocol}//${app.hiddenService}`
	const publicHostname = domainAccessAppHostname(app.id)
	if (publicHostname) return `${protocol}//${publicHostname}`
	return `${protocol}//${location.hostname}:${app.port}`
}

export function appToUrlWithAppPath(app: UserApp, protocol = location.protocol) {
	return urlJoin(appToUrl(app, protocol), app.path ?? '')
}

const ALWAYS_OPEN_HTTPS_REQUIRED_APPS_KEY = 'UMBREL_ALWAYS_OPEN_HTTPS_REQUIRED_APPS'

export function getAlwaysOpenHttpsRequiredApps() {
	return localStorage.getItem(ALWAYS_OPEN_HTTPS_REQUIRED_APPS_KEY) === 'true'
}

export function setAlwaysOpenHttpsRequiredApps(value: boolean) {
	if (value) {
		localStorage.setItem(ALWAYS_OPEN_HTTPS_REQUIRED_APPS_KEY, 'true')
	} else {
		localStorage.removeItem(ALWAYS_OPEN_HTTPS_REQUIRED_APPS_KEY)
	}
}

export function isOnionPage() {
	return window.location.origin.indexOf('.onion') !== -1
}

export function preloadImage(url: string): Promise<void> {
	return new Promise((resolve) => {
		const img = new Image()
		const handleLoad = () => {
			img.removeEventListener('load', handleLoad)
			resolve()
		}
		img.addEventListener('load', handleLoad)
		img.src = url
	})
}

// ---

export function isWindows() {
	return /Win/i.test(navigator.userAgent)
}

export function isLinux() {
	return /Linux/i.test(navigator.userAgent)
}

export function isMac() {
	return /Mac/i.test(navigator.userAgent)
}

export function platform() {
	if (isWindows()) return 'windows'
	if (isLinux()) return 'linux'
	if (isMac()) return 'mac'
	return 'other'
}

// NOTE: in Chrome, this can be `true` when emulating a touch device
export const IS_ANDROID = /Android/i.test(navigator.userAgent)

export const IS_DEV = localStorage.getItem('debug') === 'true'

export function cmdOrCtrl() {
	return isMac() ? '⌘' : 'Ctrl+'
}

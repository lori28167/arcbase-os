import React from 'react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {Checkbox} from '@/components/ui/checkbox'
import {CopyButton} from '@/components/ui/copy-button'
import {Input, Labeled} from '@/components/ui/input'
import {Switch} from '@/components/ui/switch'
import {toast} from '@/components/ui/toast'
import {useApps} from '@/providers/apps'
import {BackButton} from '@/routes/settings/_components/shared'
import {trpcReact} from '@/trpc/trpc'

// cloudflared only treats a leading `*.` as a wildcard, so other templates
// need one ingress rule per app hostname.
export function cloudflaredIngress(domain: string, template: string, appIds: string[]) {
	const hostnames = template.startsWith('{app}.')
		? [`*.${template.slice('{app}.'.length)}`]
		: appIds.map((appId) => template.replace('{app}', appId.toLowerCase()))
	return [
		'ingress:',
		`  - hostname: ${domain}`,
		'    service: http://localhost:80',
		...hostnames.flatMap((hostname) => [`  - hostname: "${hostname}"`, '    service: http://localhost:80']),
		'  - service: http_status:404',
	].join('\n')
}

// Configure the public domain a cloudflared tunnel forwards to this device.
// The tunnel routes hostnames rather than ports, so apps get their own
// hostnames (e.g. `files.example.com`) instead of `domain:port`.
export function DomainAccessSettingsPanel({onBack}: {onBack: () => void}) {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()
	const {userApps} = useApps()
	const domainAccessQ = trpcReact.domainAccess.get.useQuery()
	const unprotectedAppsQ = trpcReact.domainAccess.listUnprotectedApps.useQuery()

	const [enabled, setEnabled] = React.useState(false)
	const [domain, setDomain] = React.useState('')
	const [appHostTemplate, setAppHostTemplate] = React.useState('')
	const [publicApps, setPublicApps] = React.useState<string[]>([])

	const resetFromServer = React.useCallback(() => {
		if (!domainAccessQ.data) return
		setEnabled(domainAccessQ.data.enabled)
		setDomain(domainAccessQ.data.domain)
		// Only the custom template: an empty field keeps following the domain.
		setAppHostTemplate(domainAccessQ.data.appHostTemplate)
		setPublicApps(domainAccessQ.data.publicApps)
	}, [domainAccessQ.data])
	React.useEffect(resetFromServer, [resetFromServer])

	const setMut = trpcReact.domainAccess.set.useMutation({
		onSuccess: () => {
			utils.domainAccess.get.invalidate()
			toast.success(t('domain-access.saved'))
		},
		onError: (error) => {
			// Show what the server actually has, e.g. the switch back off.
			setEnabled(domainAccessQ.data?.enabled ?? false)
			toast.error(t('domain-access.save-error', {message: error.message}))
		},
	})

	const trimmedDomain = domain.trim().toLowerCase().replace(/\.$/, '')
	const template = (appHostTemplate.trim() || (trimmedDomain ? `{app}.${trimmedDomain}` : '')).toLowerCase()

	const save = (overrides: {enabled?: boolean; publicApps?: string[]} = {}) => {
		if (!trimmedDomain) return
		setMut.mutate({
			enabled: overrides.enabled ?? enabled,
			domain: trimmedDomain,
			appHostTemplate: appHostTemplate.trim() || undefined,
			publicApps: overrides.publicApps ?? publicApps,
		})
	}

	const togglePublicApp = (appId: string, checked: boolean) => {
		const next = checked ? [...publicApps, appId] : publicApps.filter((id) => id !== appId)
		setPublicApps(next)
		save({publicApps: next})
	}

	const appName = (appId: string) => userApps?.find((app) => app.id === appId)?.name ?? appId
	const cloudflaredConfig =
		trimmedDomain && template.includes('{app}')
			? cloudflaredIngress(
					trimmedDomain,
					template,
					(userApps ?? []).map((app) => app.id),
				)
			: ''

	return (
		<div className='flex flex-col gap-y-5'>
			<BackButton onClick={onBack}>{t('advanced-settings')}</BackButton>
			<div className='space-y-1 px-1'>
				<h3 className='text-18 leading-tight font-semibold'>{t('domain-access.title')}</h3>
				<p className='text-13 leading-tight text-white/45'>{t('domain-access.description')}</p>
			</div>

			<label className='flex items-center justify-between gap-x-2 rounded-12 bg-white/6 p-4'>
				<div className='flex-1 space-y-1'>
					<h3 className='text-14 leading-tight font-medium'>{t('domain-access.enable')}</h3>
					<p className='text-13 leading-tight opacity-45'>{t('domain-access.enable-description')}</p>
				</div>
				<Switch
					checked={enabled}
					disabled={!trimmedDomain || setMut.isPending || domainAccessQ.isLoading}
					onCheckedChange={(checked) => {
						setEnabled(checked)
						save({enabled: checked})
					}}
				/>
			</label>

			<form
				className='flex flex-col gap-y-4'
				onSubmit={(event) => {
					event.preventDefault()
					save()
				}}
			>
				<Labeled label={t('domain-access.domain')}>
					<Input
						sizeVariant='short'
						placeholder='home.example.com'
						value={domain}
						onValueChange={setDomain}
						autoCapitalize='off'
						autoCorrect='off'
						spellCheck={false}
					/>
				</Labeled>
				<Labeled label={t('domain-access.app-host-template')}>
					<Input
						sizeVariant='short'
						placeholder={trimmedDomain ? `{app}.${trimmedDomain}` : '{app}.example.com'}
						value={appHostTemplate}
						onValueChange={setAppHostTemplate}
						autoCapitalize='off'
						autoCorrect='off'
						spellCheck={false}
					/>
				</Labeled>
				<p className='px-1 text-12 leading-snug text-white/45'>{t('domain-access.app-host-template-description')}</p>
				<Button
					type='submit'
					size='md'
					variant='primary'
					className='self-end'
					disabled={!trimmedDomain || setMut.isPending}
				>
					{t('domain-access.save')}
				</Button>
			</form>

			{!!unprotectedAppsQ.data?.length && (
				<div className='flex flex-col gap-y-2'>
					<h3 className='px-1 text-14 leading-tight font-medium'>{t('domain-access.public-apps-title')}</h3>
					<p className='px-1 text-12 leading-snug text-white/45'>{t('domain-access.public-apps-description')}</p>
					{unprotectedAppsQ.data.map((appId) => (
						<label key={appId} className='flex items-center gap-x-3 rounded-12 bg-white/6 p-3 text-13'>
							<Checkbox
								checked={publicApps.includes(appId)}
								disabled={!trimmedDomain || setMut.isPending}
								onCheckedChange={(checked) => togglePublicApp(appId, checked === true)}
							/>
							<span>{appName(appId)}</span>
						</label>
					))}
				</div>
			)}

			{cloudflaredConfig && (
				<div className='flex flex-col gap-y-2'>
					<div className='flex items-center justify-between gap-x-2 px-1'>
						<h3 className='text-14 leading-tight font-medium'>{t('domain-access.cloudflared-title')}</h3>
						<CopyButton value={cloudflaredConfig} />
					</div>
					<p className='px-1 text-12 leading-snug text-white/45'>
						{template.startsWith('{app}.')
							? t('domain-access.cloudflared-description', {
									domain: trimmedDomain,
									wildcard: `*.${template.slice('{app}.'.length)}`,
								})
							: t('domain-access.cloudflared-description-per-app', {domain: trimmedDomain})}
					</p>
					<pre className='overflow-x-auto rounded-12 bg-black/30 p-3 font-mono text-12 text-white/70'>
						{cloudflaredConfig}
					</pre>
				</div>
			)}
		</div>
	)
}

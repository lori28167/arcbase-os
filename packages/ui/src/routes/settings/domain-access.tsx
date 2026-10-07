import React from 'react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {CopyButton} from '@/components/ui/copy-button'
import {Input, Labeled} from '@/components/ui/input'
import {Switch} from '@/components/ui/switch'
import {toast} from '@/components/ui/toast'
import {BackButton} from '@/routes/settings/_components/shared'
import {trpcReact} from '@/trpc/trpc'

// Configure the public domain a cloudflared tunnel forwards to this device.
// The tunnel routes hostnames rather than ports, so apps get their own
// hostnames (e.g. `files.arcbase.example.com`) instead of `domain:port`.
export function DomainAccessSettingsPanel({onBack}: {onBack: () => void}) {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()
	const domainAccessQ = trpcReact.domainAccess.get.useQuery()
	const setMut = trpcReact.domainAccess.set.useMutation({
		onSuccess: () => {
			utils.domainAccess.get.invalidate()
			toast.success(t('domain-access.saved'))
		},
		onError: (error) => toast.error(t('domain-access.save-error', {message: error.message})),
	})

	const [enabled, setEnabled] = React.useState(false)
	const [domain, setDomain] = React.useState('')
	const [appHostTemplate, setAppHostTemplate] = React.useState('')

	React.useEffect(() => {
		if (!domainAccessQ.data) return
		setEnabled(domainAccessQ.data.enabled)
		setDomain(domainAccessQ.data.domain)
		setAppHostTemplate(domainAccessQ.data.appHostTemplate)
	}, [domainAccessQ.data])

	const trimmedDomain = domain.trim().toLowerCase()
	const effectiveTemplate = appHostTemplate.trim() || (trimmedDomain ? `{app}.${trimmedDomain}` : '')
	const wildcardHostname = effectiveTemplate.replace('{app}', '*')

	const save = (nextEnabled = enabled) => {
		if (!trimmedDomain) return
		setMut.mutate({enabled: nextEnabled, domain: trimmedDomain, appHostTemplate: appHostTemplate.trim() || undefined})
	}

	const cloudflaredConfig = trimmedDomain
		? [
				'ingress:',
				`  - hostname: ${trimmedDomain}`,
				'    service: http://localhost:80',
				`  - hostname: "${wildcardHostname}"`,
				'    service: http://localhost:80',
				'  - service: http_status:404',
			].join('\n')
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
						save(checked)
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
						placeholder='arcbase.example.com'
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
						placeholder={trimmedDomain ? `{app}.${trimmedDomain}` : '{app}.arcbase.example.com'}
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

			{cloudflaredConfig && (
				<div className='flex flex-col gap-y-2'>
					<div className='flex items-center justify-between gap-x-2 px-1'>
						<h3 className='text-14 leading-tight font-medium'>{t('domain-access.cloudflared-title')}</h3>
						<CopyButton value={cloudflaredConfig} />
					</div>
					<p className='px-1 text-12 leading-snug text-white/45'>
						{t('domain-access.cloudflared-description', {
							domain: trimmedDomain,
							wildcard: wildcardHostname,
							auth: effectiveTemplate.replace('{app}', 'auth'),
						})}
					</p>
					<pre className='overflow-x-auto rounded-12 bg-black/30 p-3 font-mono text-12 text-white/70'>
						{cloudflaredConfig}
					</pre>
				</div>
			)}
		</div>
	)
}

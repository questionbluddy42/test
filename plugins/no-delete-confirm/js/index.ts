import { AlertActionCreators, ToastActionCreators } from '@valenced/discord/actions'
import { instead } from '@valenced/patcher'

type AlertProps = Record<string, unknown>

// Matches only the delete message popup, so other warnings still show.
function isDeleteMessageAlert(key: string, props: AlertProps | undefined) {
	if (/delete[-_ ]?message/i.test(key)) return true

	const title = props?.title
	return typeof title === 'string' && /^delete message\??$/i.test(title.trim())
}

// Finds the function that confirms the popup.
function findConfirm(props: AlertProps | undefined) {
	if (!props) return

	for (const name of Object.keys(props)) {
		const value = props[name]
		if (typeof value === 'function' && /^on(confirm|accept|ok|yes|submit)/i.test(name))
			return value as () => unknown
	}

	// Newer popups keep their buttons inside an actions object.
	const actions = props.actions
	if (!actions || typeof actions !== 'object') return

	const entries = Object.entries(actions as Record<string, unknown>)
	const primary =
		entries.find(([name]) => /primary|confirm|accept|yes/i.test(name)) ?? entries[0]
	const button = primary?.[1]
	if (!button || typeof button !== 'object') return

	for (const [name, value] of Object.entries(button as Record<string, unknown>)) {
		if (typeof value === 'function' && /^on(press|click|confirm|accept|submit)/i.test(name))
			return value as () => unknown
	}
}

// Debug: describes every prop (and the actions object) as short text pieces.
function describe(props: AlertProps) {
	const parts: string[] = []
	for (const name of Object.keys(props)) {
		const value = props[name]
		const type = typeof value === 'function' ? 'fn' : Array.isArray(value) ? 'arr' : typeof value
		parts.push(`${name}:${type}`)
	}

	const actions = props.actions
	if (actions && typeof actions === 'object') {
		for (const [name, value] of Object.entries(actions as Record<string, unknown>)) {
			const inner =
				value && typeof value === 'object'
					? Object.keys(value as object)
							.map(k => `${k}:${typeof (value as Record<string, unknown>)[k] === 'function' ? 'fn' : typeof (value as Record<string, unknown>)[k]}`)
							.join(',')
					: typeof value
			parts.push(`actions.${name}={${inner}}`)
		}
	}

	const chunks: string[] = []
	let current = ''
	for (const part of parts) {
		if ((current + part).length > 60) {
			chunks.push(current)
			current = ''
		}
		current += `${part} `
	}
	if (current) chunks.push(current)
	return chunks
}

function toast(text: string) {
	try {
		ToastActionCreators.open('no-delete-confirm-debug', { text, duration: 4500 })
	} catch {
		try {
			ToastActionCreators.open({ key: 'no-delete-confirm-debug', content: text } as never)
		} catch {}
	}
}

export default plugin({
	start({ cleanup }) {
		cleanup(
			instead(AlertActionCreators, 'openAlert', (args, original) => {
				const [key, alert] = args
				const props = (alert as { props?: AlertProps } | null)?.props

				if (props && isDeleteMessageAlert(key, props)) {
					const confirm = findConfirm(props)
					if (confirm) {
						confirm()
						return
					}

					// No confirm found: show the props, one piece at a time.
					const chunks = describe(props)
					chunks.forEach((chunk, i) => {
						setTimeout(() => toast(`${i + 1}/${chunks.length} ${chunk}`), i * 5000)
					})
				}

				return original(...args)
			}),
		)
	},
})

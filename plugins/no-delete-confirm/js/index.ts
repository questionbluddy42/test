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
		if (typeof value === 'function' && /^on(confirm|accept|ok|yes|submit)/i.test(name)) return value as () => unknown
	}
}

// Debug: describes every prop as short text pieces.
function describe(props: AlertProps) {
	const parts: string[] = []
	for (const name of Object.keys(props)) {
		const value = props[name]
		const type = typeof value === 'function' ? 'fn' : Array.isArray(value) ? 'arr' : typeof value
		parts.push(`${name}:${type}`)
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

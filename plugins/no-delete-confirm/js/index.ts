import { AlertActionCreators, ToastActionCreators } from '@valenced/discord/actions'
import { instead } from '@valenced/patcher'

interface AlertProps {
	title?: unknown
	onConfirm?: () => unknown
}

// Matches only the delete message popup, so other warnings still show.
function isDeleteMessageAlert(key: string, props: AlertProps | undefined) {
	if (/delete[-_ ]?message/i.test(key)) return true

	const title = props?.title
	return typeof title === 'string' && /^delete message\??$/i.test(title.trim())
}

// Debug: shows the key and prop names of every popup as a toast.
function debugToast(key: string, props: AlertProps | undefined) {
	const title = props?.title
	const text = `alert key=${key} | title=${typeof title === 'string' ? title : typeof title} | props=${props ? Object.keys(props).join(',') : 'none'}`

	try {
		ToastActionCreators.open('no-delete-confirm-debug', { text, duration: 8000 })
	} catch {
		// Older toast overload.
		ToastActionCreators.open({ key: 'no-delete-confirm-debug', content: text } as never)
	}
}

export default plugin({
	start({ cleanup }) {
		cleanup(
			instead(AlertActionCreators, 'openAlert', (args, original) => {
				const [key, alert] = args
				const props = (alert as { props?: AlertProps } | null)?.props

				try {
					debugToast(key, props)
				} catch {}

				if (isDeleteMessageAlert(key, props) && typeof props?.onConfirm === 'function') {
					props.onConfirm()
					return
				}

				return original(...args)
			}),
		)
	},
})

import { AlertActionCreators } from '@valenced/discord/actions'
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

export default plugin({
	start({ cleanup }) {
		// Runs the popup's confirm action right away and skips showing the popup.
		cleanup(
			instead(AlertActionCreators, 'openAlert', (args, original) => {
				const [key, alert] = args
				const props = (alert as { props?: AlertProps } | null)?.props

				if (isDeleteMessageAlert(key, props) && typeof props?.onConfirm === 'function') {
					props.onConfirm()
					return
				}

				return original(...args)
			}),
		)
	},
})

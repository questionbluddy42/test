import { AlertActionCreators } from '@valenced/discord/actions'
import { instead } from '@valenced/patcher'

type AlertProps = Record<string, unknown>

interface ButtonProps {
	variant?: unknown
	onPress?: unknown
}

// Matches only the delete message popup, so other warnings still show.
function isDeleteMessageAlert(key: string, props: AlertProps | undefined) {
	if (/delete[-_ ]?message/i.test(key)) return true

	const title = props?.title
	return typeof title === 'string' && /^delete message\??$/i.test(title.trim())
}

// The popup's buttons are AlertActionButton elements. The primary one is Yes.
function findConfirm(props: AlertProps) {
	const actions = props.actions as { props?: { children?: unknown } } | undefined
	const children = actions?.props?.children
	const buttons = Array.isArray(children) ? children : [children]

	for (const button of buttons) {
		const buttonProps = (button as { props?: ButtonProps } | null)?.props
		if (buttonProps?.variant === 'primary' && typeof buttonProps.onPress === 'function')
			return buttonProps.onPress as () => unknown
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
						// Presses Yes for the user and skips showing the popup.
						confirm()
						return
					}
				}

				return original(...args)
			}),
		)
	},
})

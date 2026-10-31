import { AlertActionCreators } from '@valenced/discord/actions'
import { instead } from '@valenced/patcher'

type AlertProps = Record<string, unknown>

// Matches only the delete message popup, so other warnings still show.
function isDeleteMessageAlert(key: string, props: AlertProps | undefined) {
	if (/delete[-_ ]?message/i.test(key)) return true

	const title = props?.title
	return typeof title === 'string' && /^delete message\??$/i.test(title.trim())
}

// Debug: describes one value as short text.
function label(value: unknown): string {
	if (typeof value === 'function') return 'fn'
	if (typeof value === 'string') return `'${value.slice(0, 16)}'`
	if (Array.isArray(value)) return `arr${value.length}`
	if (value && typeof value === 'object') return 'obj'
	return String(value)
}

function typeName(type: unknown): string {
	if (typeof type === 'string') return type
	if (type && (typeof type === 'function' || typeof type === 'object')) {
		const named = type as { displayName?: string; name?: string }
		return named.displayName || named.name || '?'
	}
	return typeof type
}

// Debug: walks a React element tree and writes one line per element.
function dump(node: unknown, path: string, depth: number, out: string[]) {
	if (Array.isArray(node)) {
		node.forEach((child, i) => dump(child, `${path}[${i}]`, depth, out))
		return
	}

	if (!node || typeof node !== 'object' || !('props' in node)) {
		out.push(`${path}=${label(node)}`)
		return
	}

	const element = node as { type?: unknown; props?: AlertProps }
	const props = element.props ?? {}
	const items = Object.keys(props)
		.filter(name => name !== 'children')
		.map(name => `${name}:${label(props[name])}`)
	out.push(`${path} <${typeName(element.type)}> ${items.join(' ')}`)

	if (depth < 5 && props.children !== undefined) dump(props.children, `${path}.c`, depth + 1, out)
}

export default plugin({
	start({ cleanup }) {
		cleanup(
			instead(AlertActionCreators, 'openAlert', (args, original) => {
				const [key, alert, ...rest] = args
				const props = (alert as { props?: AlertProps } | null)?.props

				if (props && isDeleteMessageAlert(key, props)) {
					const lines: string[] = []
					dump(props.actions, 'actions', 0, lines)

					// Shows the dump in place of the popup text. Yes and No still work as normal.
					const shown = { ...(alert as object), props: { ...props, content: lines.join('\n').slice(0, 900) } }
					return original(key, shown as never, ...rest)
				}

				return original(...args)
			}),
		)
	},
})

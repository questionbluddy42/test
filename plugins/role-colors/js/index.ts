import { ToastActionCreators } from '@valenced/discord/actions'
import { Stores } from '@valenced/discord/flux'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { instead } from '@valenced/patcher'
import { ReactJSXRuntime } from '@valenced/react'
import { insteadJSX } from '@valenced/react/jsx-runtime'

// Probe version 2: reads the typing indicator's output, member data, and mention-like text.
// Copies a report to the clipboard.

const report = new Map<string, string>()
const names = new WeakMap<object, string>()
let timer: ReturnType<typeof setTimeout> | undefined
let Inner: unknown
let unpatchInner: (() => boolean) | undefined

function typeName(type: unknown): string {
	if (typeof type === 'string') return type
	if (!type || (typeof type !== 'function' && typeof type !== 'object')) return typeof type

	const cached = names.get(type as object)
	if (cached !== undefined) return cached

	const named = type as { displayName?: string; name?: string; type?: unknown; render?: unknown }
	let name = named.displayName || named.name || ''
	if (!name && named.type) name = typeName(named.type)
	if (!name && typeof named.render === 'function') name = (named.render as { name?: string }).name || ''

	names.set(type as object, name || '?')
	return name || '?'
}

function label(value: unknown): string {
	if (typeof value === 'function') return 'fn'
	if (typeof value === 'string') return `'${value.slice(0, 24)}'`
	if (Array.isArray(value)) return `arr${value.length}`
	if (value && typeof value === 'object') return 'obj'
	return String(value)
}

function styleLabel(style: unknown): string {
	if (Array.isArray(style)) return `arr${style.length}`
	if (style && typeof style === 'object') {
		const record = style as Record<string, unknown>
		const color = typeof record.color === 'string' ? ` color=${record.color}` : ''
		return `{${Object.keys(record).join(',')}${color}}`
	}
	return label(style)
}

function describe(props: unknown) {
	if (!props || typeof props !== 'object') return ''
	const record = props as Record<string, unknown>
	return Object.keys(record)
		.filter(name => name !== 'children')
		.map(name => `${name}:${name === 'style' ? styleLabel(record[name]) : label(record[name])}`)
		.join(' ')
}

// Walks a rendered React element tree, one line per element.
function dump(node: unknown, path: string, depth: number, out: string[]) {
	if (Array.isArray(node)) {
		node.forEach((child, i) => dump(child, `${path}[${i}]`, depth, out))
		return
	}

	if (!node || typeof node !== 'object' || !('props' in node)) {
		out.push(`${path}=${label(node)}`)
		return
	}

	const element = node as { type?: unknown; props?: Record<string, unknown> }
	const props = element.props ?? {}
	out.push(`${path} <${typeName(element.type)}> ${describe(props)}`)

	if (depth < 7 && props.children !== undefined) dump(props.children, `${path}.c`, depth + 1, out)
}

function toast(text: string) {
	try {
		ToastActionCreators.open('role-colors-probe', { text, duration: 5000 })
	} catch {
		try {
			ToastActionCreators.open({ key: 'role-colors-probe', content: text } as never)
		} catch {}
	}
}

function add(key: string, text: string) {
	if (report.has(key) || report.size >= 40) return
	report.set(key, text)

	if (timer) clearTimeout(timer)
	timer = setTimeout(() => {
		Clipboard.setString([...report.entries()].map(([k, v]) => `## ${k}\n${v}`).join('\n'))
		toast(`Probe copied ${report.size} entries. Paste it in the chat.`)
	}, 6000)
}

// Reads a member from the guild member store, to find which field holds the role color.
function memberInfo(guildId: unknown, userId: unknown) {
	const store = (Stores as Record<string, unknown>).GuildMemberStore as
		| { getMember?: (guild: unknown, user: unknown) => Record<string, unknown> | null }
		| undefined
	if (!store?.getMember) return 'GuildMemberStore: no getMember'

	const member = store.getMember(guildId, userId)
	if (!member) return 'member: null'

	return `member keys: ${Object.keys(member).join(',')} | colorString=${label(member.colorString)} | color=${label(member.color)}`
}

function renderInner(props: unknown) {
	const component = Inner as {
		type?: (props: unknown) => unknown
		render?: (props: unknown, ref: unknown) => unknown
	}
	if (typeof Inner === 'function') return (Inner as (props: unknown) => unknown)(props)
	if (typeof component?.type === 'function') return component.type(props)
	if (typeof component?.render === 'function') return component.render(props, null)
	return null
}

// Renders the original indicator unchanged, and reports what it produced.
function TypingIndicatorProbe(props: unknown) {
	const tree = renderInner(props)

	try {
		const p = props as { typingUserIds?: unknown[]; channel?: { guild_id?: unknown } }
		const lines: string[] = []
		dump(tree, 'tree', 0, lines)
		add('typing output', lines.join('\n'))

		const guildId = p.channel?.guild_id
		const userId = p.typingUserIds?.[0]
		add('typing member', `guild=${label(guildId)} user=${label(userId)} | ${memberInfo(guildId, userId)}`)
	} catch (error) {
		add('typing error', String(error))
	}

	return tree
}

function watch(type: unknown, props: unknown) {
	try {
		const name = typeName(type)

		if (!Inner && name === 'TypingIndicatorInner') {
			Inner = type
			unpatchInner = insteadJSX(type as never, (args, jsx) =>
				jsx(TypingIndicatorProbe as never, args[1] as never, args[2]),
			)
			return
		}

		// Mention-like text starts with @.
		const children = (props as { children?: unknown } | null)?.children
		const first = Array.isArray(children) ? children[0] : children
		if (typeof first === 'string' && first.startsWith('@'))
			add(`mention-like <${name}>`, `${describe(props)} text=${label(first)}`)
	} catch {}
}

export default plugin({
	start({ cleanup }) {
		cleanup(
			instead(ReactJSXRuntime, 'jsx', (args, original) => {
				watch(args[0], args[1])
				return original(...args)
			}),
		)
		cleanup(
			instead(ReactJSXRuntime, 'jsxs', (args, original) => {
				watch(args[0], args[1])
				return original(...args)
			}),
		)
		cleanup(() => {
			if (timer) clearTimeout(timer)
			unpatchInner?.()
		})
	},
})

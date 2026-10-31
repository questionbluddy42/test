import { ToastActionCreators } from '@valenced/discord/actions'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { instead } from '@valenced/patcher'
import { React, ReactJSXRuntime } from '@valenced/react'

// Temporary probe: finds how mentions are drawn, then copies a report to the clipboard.

type Props = Record<string, unknown>

const report = new Map<string, string>()
const names = new WeakMap<object, string>()
let timer: ReturnType<typeof setTimeout> | undefined

function typeName(type: unknown): string {
	if (typeof type === 'string') return type
	if (!type || (typeof type !== 'function' && typeof type !== 'object')) return ''

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

function describe(props: Props) {
	return Object.keys(props)
		.filter(name => name !== 'children')
		.map(name => `${name}:${name === 'style' ? styleLabel(props[name]) : label(props[name])}`)
		.join(' ')
}

function isElement(node: unknown): node is { type?: unknown; props: Props } {
	return !!node && typeof node === 'object' && 'props' in node && !!(node as { props?: unknown }).props
}

function textOf(node: unknown): string | undefined {
	if (typeof node === 'string') return node
	if (Array.isArray(node)) {
		for (const child of node) {
			const text = textOf(child)
			if (text !== undefined) return text
		}
		return
	}
	if (isElement(node)) return textOf(node.props.children)
}

function childrenSummary(children: unknown): string {
	const list = Array.isArray(children) ? children : [children]
	return list
		.slice(0, 6)
		.map(child => (isElement(child) ? `<${typeName(child.type)}>${label(textOf(child))}` : label(child)))
		.join(' , ')
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

let createElementCalls = 0

// children is given for createElement, where they are not inside props.
function watch(type: unknown, props: unknown, children?: unknown) {
	try {
		const p = (props && typeof props === 'object' ? props : {}) as Props
		const content = children !== undefined ? children : p.children

		// Components that are handed a user or role id.
		if (p.userId !== undefined || p.roleId !== undefined) {
			const name = typeName(type)
			add(`id <${name}>`, `${describe(p)} text=${label(textOf(content))}`)
		}

		// Elements whose text starts with @.
		const first = textOf(content)
		if (typeof first === 'string' && first.startsWith('@')) {
			const name = typeName(type)
			add(`@text <${name}>${children !== undefined ? ' (createElement)' : ''}`, `${describe(p)} children=[${childrenSummary(content)}]`)
		}
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
		cleanup(
			instead(React, 'createElement', (args, original) => {
				createElementCalls++
				if (createElementCalls === 1) add('createElement used', 'yes')
				const [type, props, ...rest] = args as unknown as [unknown, unknown, ...unknown[]]
				watch(type, props, rest.length > 1 ? rest : rest[0])
				return original(...args)
			}),
		)
		cleanup(() => {
			if (timer) clearTimeout(timer)
		})
	},
})

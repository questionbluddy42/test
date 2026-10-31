import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { before } from '@valenced/patcher'

interface ReplyManager {
	createPendingReply(options: { shouldMention?: boolean }): unknown
}

export default plugin({
	start({ cleanup }) {
		// Discord's reply bar reads shouldMention when a reply starts.
		// Forcing it to false starts every reply with the ping off.
		// The user can still switch it on with the @ button.
		const unsub = getModules(
			withProps<ReplyManager>('createPendingReply'),
			ReplyManager => {
				cleanup(
					before(ReplyManager, 'createPendingReply', ([options]) => {
						return [{ ...options, shouldMention: false }]
					}),
				)
			},
		)

		cleanup(unsub)
	},
})

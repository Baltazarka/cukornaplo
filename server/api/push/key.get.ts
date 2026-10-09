import { vapidPublicKey, listSubscriptions } from '../../utils/push'

export default defineEventHandler(() => ({ publicKey: vapidPublicKey(), devices: listSubscriptions().map((d) => ({ name: d.name, createdAt: d.createdAt, endpoint: d.endpoint })) }))

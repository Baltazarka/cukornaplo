// Az érvényes megtekintési linkek listája.
import { activeShares } from '../../utils/share'

export default defineEventHandler(() => ({ shares: activeShares() }))

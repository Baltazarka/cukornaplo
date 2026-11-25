// A főoldali „Kihívás” kártya adata: fut-e tiszta mérés, és a napszak tiszta eseményeinek száma.
import { challengeNow } from '../utils/challenge'

export default defineEventHandler(() => challengeNow() ?? { state: { kind: 'clear' }, segment: null })

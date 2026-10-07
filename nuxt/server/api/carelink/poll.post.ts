// Kézi CareLink lekérés ("Lekérés most").
import { clPoll } from '../../utils/carelink'

export default defineEventHandler(() => clPoll())

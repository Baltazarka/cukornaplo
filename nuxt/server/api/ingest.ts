// Új útvonal: /api/ingest (minden metódus ide fut; a nem-POST kérést a handler 405-tel utasítja el, nem 404-gyel)
import { handleIngest } from '../utils/ingest'

export default defineEventHandler((event) => handleIngest(event))

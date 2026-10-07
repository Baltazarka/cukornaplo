// Új útvonal: POST /api/ingest
import { handleIngest } from '../utils/ingest'

export default defineEventHandler((event) => handleIngest(event))

// Visszafelé kompatibilis útvonal: a telefon a régi /api/ingest.php címre küldhet tovább.
import { handleIngest } from '../../utils/ingest'

export default defineEventHandler((event) => handleIngest(event))

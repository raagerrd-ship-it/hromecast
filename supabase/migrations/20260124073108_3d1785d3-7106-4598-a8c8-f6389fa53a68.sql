-- Ta bort oanvända tabeller som skapar säkerhetsvarningar
-- Dessa tabeller användes för cloud-synkronisering men projektet är nu offline-first

DROP TABLE IF EXISTS public.screensaver_settings;
DROP TABLE IF EXISTS public.cast_commands;
DROP TABLE IF EXISTS public.discovered_chromecasts;
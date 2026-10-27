export const APPS = {
  listen: {
    url: process.env.FILM_LISTEN_URL ?? "http://localhost:5174",
    state: ".auth/film-listen.json",
  },
  admin: {
    url: process.env.FILM_ADMIN_URL ?? "http://localhost:5173",
    state: ".auth/film-admin.json",
  },
} as const;

export type App = keyof typeof APPS;

export function isApp(value: string | undefined): value is App {
  return value !== undefined && value in APPS;
}

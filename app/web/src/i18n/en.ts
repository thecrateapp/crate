export const en = {
  "nav.listen": "Listen",
  "nav.admin": "Admin",
  "nav.architecture": "Architecture",
  "nav.developers": "Developers",
  "nav.docs": "Docs",
  "nav.github": "GitHub",
  "hero.eyebrow": "Free / open source / self hosted",
  "hero.title": "Crate is not a streaming service.",
  "hero.subline": "It's a tool for revolution.",
  "hero.caption": "{tracks} tracks · one library",
  "cta.copy": "Copy",
  "cta.copied": "Copied",
  "cta.copyLabel": "Copy the install command",
  "statement.1":
    'Crate is free, open-source software for taking music back from streaming platforms and returning it to the people who give it meaning: fans and artists. <span class="hl">No subscriptions. No algorithms.</span>',
  "statement.2":
    "Install it in your server. Bring your files. Tell your friends. Start a community and break with the system.",
  "statement.3":
    'Own your music. Support your artists. <span class="hl">Refuse the middleman.</span>',
  "get.title": "Get Crate",
  "get.server": "Server",
  "get.requirements":
    "Linux x86_64 with Docker. 4 cores and 8 GB RAM recommended.",
  "get.clients": "Apps",
  "get.ios":
    "On iPhone, open your server in Safari and add it to the Home Screen.",
  "explore.listen": "Player, radio, paths, offline",
  "explore.admin": "Library health, enrichment, analysis",
  "explore.architecture": "Workers, read plane, events",
  "explore.developers": "APIs, tokens, contributing",
  "footer.manifesto": "Read the manifesto",
  "footer.license": "AGPL-3.0",
} as const;

export type MessageKey = keyof typeof en;

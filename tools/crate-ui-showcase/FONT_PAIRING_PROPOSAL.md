> **Combinación aprobada por Diego, 21 de octubre de 2026:** Bricolage Grotesque
> para títulos e IBM Plex Sans para cuerpo, conservando JetBrains Mono.
> Aplicada a la identidad compartida de Listen y Admin y autorizada para commit/push.
> Las recomendaciones siguientes conservan el historial de alternativas exploradas.

# Propuesta tipográfica para Crate V3

Investigación: 21 de octubre de 2026. Propuesta para comparar; no cambia fuentes, tokens ni componentes. **JetBrains Mono 400 se conserva en todas las opciones.**

Recomiendo probar primero **Hubot Sans en títulos + Mona Sans en cuerpo**. Sus proporciones relacionadas unen la interfaz, mientras los detalles geométricos de Hubot refuerzan el carácter tecnológico. Mona deja respirar nombres, formularios y biografías. Con el cyan, las hairlines y MonoLabel existentes, la identidad puede ganar precisión sin depender de letras de ciencia ficción muy ornamentadas. Esta valoración visual es una hipótesis para el preview, no una aprobación de sustitución global.

## Segunda tanda — cuatro alternativas nuevas

Esta tanda se creó mientras la app probaba Hubot/Mona y modifica únicamente el comparador.
La decisión posterior aprobada es Bricolage Grotesque + IBM Plex Sans. Las descripciones son direcciones visuales
propuestas para Crate, no prestaciones técnicas atribuidas a las fundiciones.

| Títulos                                                        | Texto                                                              | Dirección a comparar                                                   | Atención en la revisión                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Tektur](https://fonts.google.com/specimen/Tektur)             | [Golos Text](https://fonts.google.com/specimen/Golos+Text)         | Angular e industrial; mayor contraste con el cuerpo.                   | Comprobar que la personalidad de las letras no domine todos los encabezados.             |
| [Chakra Petch](https://fonts.google.com/specimen/Chakra+Petch) | [IBM Plex Sans](https://fonts.google.com/specimen/IBM+Plex+Sans)   | Técnica, ligera; cortes en los títulos y texto de interfaz más sobrio. | Display disponible hasta 700: los roles 800 de un hero requieren una decisión posterior. |
| [Oxanium](https://fonts.google.com/specimen/Oxanium)           | [Hanken Grotesk](https://fonts.google.com/specimen/Hanken+Grotesk) | Geometría digital con curvas menos convencionales.                     | Valorar si su asociación visual con videojuegos encaja con la música.                    |
| [Unbounded](https://fonts.google.com/specimen/Unbounded)       | [Onest](https://fonts.google.com/specimen/Onest)                   | Titular ancho, más cercano a identidad musical/electrónica.            | Consume más ancho: observar saltos de línea con nombres largos.                          |

Las ocho familias nuevas tienen sus binarios WOFF2 originales, cobertura Latin/Latin Extended,
licencias OFL y hashes junto al preview. Son fuentes normales de peso variable salvo Chakra
Petch (pesos estáticos 300/400/500/600/700). No se añaden a los imports de las apps.
JetBrains Mono, los tamaños, pesos declarados, tracking y controles se conservan.

La vista inicial **Nuevas** muestra estas cuatro en dos columnas en escritorio y una en móvil.
**Todas** incluye también las cuatro parejas anteriores. Cada pareja tiene su propia historia
estable. [Abrir la tanda nueva](http://127.0.0.1:6006/?path=/story/reviews-1be-font-pairings--new-alternatives).

## Punto de partida real

La identidad compartida declara Poppins como `--font-brand`, Bricolage Grotesque como `--font-display-stack` y JetBrains Mono como `--font-mono-stack`. Los papeles que deben sobrevivir al cambio son:

| Papel   | Contrato actual que importa para comparar                                                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cuerpo  | EntityRow/Card: 14 px, peso 500; HairlineRow: 12/18 px; Input/Select: 15/21 px, 400; subtítulos: 14 px. Los inputs móviles suben a 16 px.                                              |
| Display | PageHeader: 24/30 px, 600; SectionHeader: 18/24/30 px, 700; PageHero: escalas 24–60 px y pesos 700/800; editorial de artista: 36/48 y 52/56 px. También hay numerales de estadísticas. |
| Mono    | MonoLabel ALL CAPS: 11/15,4 px o 11,5/16,1 px, 400, tracking 0,14/0,16 em; filtros y badges: 12/16 px. Se conserva familia, peso y geometría.                                          |

Fuentes locales: [identidad](../../app/shared/ui/tokens/themes.css), [escala](../../app/shared/ui/tokens/typography.css), [contratos](../../app/shared/AGENTS.md), [PageHero](docs/PageHero.mdx) y [ArtistHeroPresentation](docs/ArtistHeroPresentation.mdx). El tracking display actual llega a −0,08 em: no debe trasladarse sin revisar colisiones y acentos en las nuevas formas.

**Web y Tauri cargan hoy Poppins; Capacitor excluye ese archivo y el cuerpo cae en la fuente del sistema. Display y mono se empaquetan en todos los runtimes.** Lo establecen [Listen main](../../app/listen/src/main.tsx), [Listen CSS](../../app/listen/src/index.css) y [desktop main](../../app/listen-desktop/src/main.tsx). La prueba debe mostrar también cuerpo SF/Roboto junto al display candidato. Cambiar esa política móvil sería una decisión adicional. V3 comparte identidad con Admin: una adopción posterior deberá coordinar ambos consumidores de los tokens.

## Tres combinaciones, por orden

| Prioridad           | Display                    | Cuerpo                          | Dirección y riesgo principal                                                                                                                                                                                                                                                                                         |
| ------------------- | -------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 · Recomendada** | **Hubot Sans 600/700/800** | **Mona Sans 400/500/600/700**   | Tecnología sobria. Hubot aporta esquinas y acentos geométricos; Mona equilibra listas densas y texto. Riesgo: una asociación visual con GitHub y titulares demasiado mecánicos si se expanden o aprietan en exceso.                                                                                                  |
| **2**               | **Saira 600/700/800**      | **Saira 400/500/600/700**       | Una sola familia proporcional: ritmo industrial, curvas cuadradas y buena continuidad entre datos, navegación y títulos. Riesgo: menos contraste editorial y una textura algo estrecha en párrafos largos. Mantener ancho normal en cuerpo.                                                                          |
| **3**               | **Anybody 600/700/800**    | **Spline Sans 400/500/600/700** | Más personalidad musical: titulares anchos de raíz Eurostile/noventas y cuerpo compacto con cortes discretos. Riesgo: Anybody consume ancho en títulos largos; Spline solo ofrece 300–700 y carece de cursiva oficial en la distribución revisada. No convertirla en una oblicua sintética sin valorar el resultado. |

En las tres, **JetBrains Mono 400** sigue en etiquetas, metadatos, tiempos y lecturas instrumentales; títulos y nombres preservan su caja natural. Los números grandes se prueban con el display candidato. Comenzaría con ancho normal 100, sin animar ejes ni usar versiones ultra condensadas para hacer caber textos.

La [fundición/proyecto de Hubot y Mona](https://github.com/mona-sans) presenta precisamente la relación entre el dibujo técnico de Hubot y el uso de Mona en producto. [Mona actual](https://github.com/github/mona-sans) añade tamaño óptico, pero es una revisión distinta de la distribución WOFF2 v2 medida abajo: no mezclar ambas silenciosamente. [Saira](https://github.com/Omnibus-Type/Saira) fue diseñada para titulares y textos largos. La [fundición de Anybody](https://etceteratype.co/pages/anybody) documenta sus referencias y sus anchos extremos; [Spline Sans](https://github.com/SorkinType/SplineSans) declara como objetivo interfaces y párrafos, con proporciones eficientes. Estas capacidades técnicas apoyan la selección; la jerarquía visual sigue necesitando comparación en Crate.

## Licencia, cobertura y carga

Las cinco familias tienen **SIL OFL 1.1** en sus repositorios oficiales: [Hubot](https://github.com/github/hubot-sans/blob/main/OFL.txt), [Mona](https://github.com/github/mona-sans/blob/main/OFL.txt), [Saira](https://github.com/Omnibus-Type/Saira/blob/master/OFL.txt), [Anybody](https://github.com/Etcetera-Type-Co/Anybody/blob/master/OFL.txt) y [Spline](https://github.com/SorkinType/SplineSans/blob/main/OFL.txt). La [FAQ oficial, §§1.4, 2.1–2.2](https://openfontlicense.org/ofl-faq/) permite incluirlas en software comercial y servirlas mediante `@font-face`. No hay coste de licencia por visitas o instalaciones. Hay que distribuir avisos/licencia y respetar las condiciones sobre nombres reservados al modificar las fuentes.

| Familia                                                                                        | Pesos variables disponibles                             | WOFF2 normal, latín + latín extendido |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------: |
| [Hubot Sans](https://fonts.googleapis.com/css2?family=Hubot+Sans:wght@200..900&display=swap)   | 200–900; originales también con ancho y cursiva         |           66.856 bytes · **65,3 KiB** |
| [Mona Sans](https://fonts.googleapis.com/css2?family=Mona+Sans:wght@200..900&display=swap)     | 200–900; originales con ancho, cursiva y tamaño óptico  |           55.312 bytes · **54,0 KiB** |
| [Saira](https://fonts.googleapis.com/css2?family=Saira:wght@100..900&display=swap)             | 100–900; originales también con ancho y cursiva         |           58.364 bytes · **57,0 KiB** |
| [Anybody](https://fonts.googleapis.com/css2?family=Anybody:wght@100..900&display=swap)         | 100–900; originales también con ancho, cursiva separada |           46.256 bytes · **45,2 KiB** |
| [Spline Sans](https://fonts.googleapis.com/css2?family=Spline+Sans:wght@300..700&display=swap) | 300–700, normal                                         |           79.096 bytes · **77,2 KiB** |

Medición propia de los binarios que devuelve la API oficial de Google Fonts para Chromium, ancho 100 y eje `wght` variable, el 21-10-2026. Versiones internas: Hubot/Mona 2.000, Saira 1.101, Anybody 1.113, Spline 1.001. Los enlaces de la tabla son las peticiones reproducibles; sirven para obtener los archivos y **autoalojarlos**, no para introducir dependencia de Google en ejecución.

Los presupuestos máximos de ambas particiones son **119,3 KiB** para Hubot+Mona, **57,0 KiB** para Saira y **122,4 KiB** para Anybody+Spline, más los **27,8 KiB existentes de JetBrains Mono**. Cada familia añade dos archivos; `unicode-range` permite cargar solo la partición necesaria. Son bytes WOFF2, no tiempos de red ni la carga inicial real. La cursiva de cuerpo añade 56,6 KiB en Mona o 63,7 KiB en Saira si se necesita; Spline no tiene esa variante. Un paquete con ejes de ancho/tamaño óptico completos tendrá otro coste.

Verifiqué el `cmap` de las particiones latín y latín extendido: las cinco cubren los caracteres precompuestos necesarios en **español, catalán, euskera, francés, alemán e italiano**, incluidos `à á ç è é í ï ñ ò ó ú ü œ Œ ß ẞ · ¡ ¿ €` y sus mayúsculas. Esto no equivale a cobertura universal de los nombres del catálogo. La futura prueba comprobará también diacríticos descompuestos y conservará `system-ui, sans-serif` para otros alfabetos. El fallback mono actual se mantiene: `ui-monospace, "SF Mono", Menlo, monospace`.

## Comparación pequeña antes de aplicar

Preview implementado en `reviews/FontPairingReview.tsx`: [página aislada](http://127.0.0.1:5186/review-1be-font-pairings.html) y [Storybook](http://127.0.0.1:6006/?path=/story/reviews-1be-font-pairings--complete). Permite comparar las cuatro opciones juntas o una por una, usando PageHeader, SectionHeader, EntityCard, EntityRow, vistas TrackRow, StatNumber y formularios/acciones reales. Cambia únicamente las variables display/cuerpo dentro de cada muestra; JetBrains Mono, geometría, pesos y tracking no se alteran. Los WOFF2 y licencias se sirven localmente desde `assets/font-pairing/`, con procedencia y hashes en `sources.json`. No modifica la identidad global ni las fuentes de las apps. El texto editable se sincroniza entre las muestras y las acciones son locales.

La siguiente lista conserva el alcance de una evaluación posterior más amplia; la escena pequeña actual no certifica WebViews ni sustituye una elección visual aprobada:

1. Selector entre actual, Hubot/Mona, Saira y Anybody/Spline; misma anchura, artwork, cyan, hairlines y contenido. Comparación a tamaños reales, sin ampliar todo para favorecer el display.
2. Una sección Home con hero, PageHeader/SectionHeader, cuatro EntityRows, un track largo, mini player, formulario y numeral estadístico. Incluir 360/390 px, escritorio y la misma escena en los WebViews de Tauri/Capacitor; en móvil, comparar cuerpo candidato y cuerpo de sistema.
3. Medir saltos de línea, truncado, altura y baseline junto a MonoLabel, distinción `I/l/1` y `O/0`, signos/acentos, contraste de pesos 400/500 y carga fría/caché/offline con `font-display: swap`. Revisar primero los tokens actuales y luego, por separado, un tracking menos negativo; registrar cada ajuste.
4. Elegir por lectura y personalidad en contexto. Después se planifica el cambio compartido, sus fallbacks y las pruebas afectadas; no se actualizan contratos/baselines para dar por aprobada una fuente.

Textos de prueba que ya existen en el catálogo local del showcase: **The Lovecraft Sextet**, **Luz de octubre · Costa Norte**, **Nocturnal Ensemble and the Extraordinary Orchestra of the Very Long Night**, **Averylongunbrokenalbumtitlethatmustremainreadablewithoutcroppingtheheading** y **AnUnbrokenTitleThatNeedsToWrapWithoutEscapingTheCollection**. Proceden de [PageHero](stories/PageHero.stories.tsx), [ArtistPageReview](reviews/ArtistPageReview.tsx) y [EntityCard](stories/EntityCard.stories.tsx); los dos últimos son casos sintéticos de estrés. Añadir `Björk · Sigur Rós · Einstürzende Neubauten` y `El cant dels ocells · L’été à Montréal · Für immer · L’ultima notte` para acentos y apóstrofos. No se ha consultado producción ni se presupone que estas muestras adicionales pertenezcan a su biblioteca.

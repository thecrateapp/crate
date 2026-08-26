# Bandcamp feed validation

Fecha de cierre: 2026-08-23

## Resultado

Bandcamp RSS no se clasifica como una fuente estable para el feed de Crate.
Queda como `optional-experimental` y debe permanecer detrás de
`CRATE_EXTERNAL_RSS_ENABLED=false` hasta disponer de evidencia nueva y
repetible.

El MVP de Updates no depende de RSS. El feed autenticado de Discover tampoco
se considera una API pública: es un contrato web interno, aislado detrás de
su propio adaptador y feature flag.

## Matriz observada

Las muestras de URLs y nombres de artistas se han sanitizado. Las pruebas se
hicieron sobre artistas y sellos reales, pero no se conserva ninguna cookie,
credencial, contenido privado ni payload completo.

| Caso                                 | URL/patrón probado                    | Resultado               | Campos RSS                      | Conclusión                                   |
| ------------------------------------ | ------------------------------------- | ----------------------- | ------------------------------- | -------------------------------------------- |
| Artista con subdominio               | `https://<artist>.bandcamp.com/feed`  | `404`                   | ninguno                         | No asumir que `/feed` existe                 |
| Artista con subdominio, variante RSS | `https://<artist>.bandcamp.com/rss`   | `404`                   | ninguno                         | No hay endpoint estable confirmado           |
| Sello alojado en Bandcamp            | `https://<label>.bandcamp.com/feed`   | `404`                   | ninguno                         | El comportamiento no es distinto para sellos |
| Página pública del artista           | `https://<artist>.bandcamp.com/music` | `200`, `text/html`      | sin feed XML confirmado         | No sustituir RSS por scraping HTML           |
| Discover autenticado                 | endpoint web interno de Discover      | `200` con sesión válida | items de releases/publicaciones | Fuente privada y experimental, no RSS        |

No se observaron respuestas `304`, `403`, `429` ni timeouts en la muestra
disponible; por tanto no se presentan como comportamiento confirmado. El
parser y el worker deben manejarlas defensivamente aunque no haya fixture real
de cada caso.

## Autodiscovery y estabilidad

- No se confirmó un `Link: rel="alternate"` consistente en las páginas
  probadas.
- No se ha confirmado un GUID estable ni un contrato común de fechas, imágenes
  y URL canónica porque los endpoints RSS probados devolvieron `404`.
- Si una fuente futura publica RSS, Crate debe aceptar solo XML válido, limitar
  tamaño e items, conservar metadatos sanitizados y registrar la versión del
  parser.
- Una URL que deje de existir debe marcar la fuente como `not_found`; no debe
  activar scraping agresivo como fallback.

## Consideraciones operativas y de términos

La [API pública de Bandcamp](https://bandcamp.com/developer) documenta acceso
OAuth para cuentas de artistas, sellos y partners, no una API de discovery de
fans. El [Terms of Use](https://bandcamp.com/terms_of_use) puede cambiar sin
aviso y limita el uso del contenido a los términos publicados por Bandcamp.
Por eso RSS se trata como una fuente opcional de bajo volumen, con allowlist,
backoff, concurrencia limitada y sin almacenar audio, cookies o tokens.

## Fixtures

- `app/tests/fixtures/bandcamp/rss-404.json` documenta el caso `404` observado
  sin conservar un cuerpo de respuesta innecesario.
- `app/tests/fixtures/bandcamp/unexpected-html.html` representa una respuesta
  HTML inesperada que el parser debe rechazar.
- No se añade un fixture `200` de Bandcamp porque la validación realizada no
  obtuvo ningún feed XML válido; los tests del parser usan XML sintético y no
  lo presentan como evidencia del proveedor.

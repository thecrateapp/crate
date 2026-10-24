# Revisión de recurrencias de Admin — 24 de octubre de 2026

Revisión estática del worktree `feat/crate_v3`, motivada por las nuevas capturas de Artist. No sustituye a la verificación visual de los arreglos de Artist ni certifica todos los estados de Admin en navegador. No se modificó código, no se ejecutaron operaciones de biblioteca ni se accedió a producción.

Los arreglos de Artist se documentan por separado en [el cierre de este corte](2026-10-24-artist-followup-resolution.md). F01–F04 siguen siendo findings adicionales de esta revisión.

Referencias: [checklist de Admin](../../../app/ui/ADMIN_UI_REVIEW_CHECKLIST.md), instrucciones de Admin/shared, Listen y los contratos activos de `InstrumentPanel`, `EmptyState`, `ErrorState`, `FormField`, `ActionGroup` y `OpsRefreshNotice`.

## Findings adicionales

### F01 — P2. Los errores auxiliares de AI Models vuelven a desplazar el contenido principal

**Ubicación:** `app/ui/src/pages/AiModels.tsx:91` y `:104`; lectura independiente en `app/ui/src/components/ai-models/ActivityPanel.tsx:52` y `:246`.

Con el snapshot de configuración disponible, un fallo de usage o activity inserta un `ErrorState` antes de Default model, Features, Providers y Advanced. Cada bloque usa el mínimo de 160 px de `.crate-error-state`; pueden aparecer dos. El error de activity queda separado del panel Activity por todas las secciones de configuración y puede coexistir con el error del lector independiente de ActivityPanel.

Es la misma causa compositiva que el aviso Missing albums de Artist: una lectura secundaria se presenta como un bloque de página, fuera de la superficie a la que pertenece. No es necesario cambiar la geometría compartida de ErrorState.

**Corrección mínima:** colocar el error de usage junto a sus métricas/gráfico y el de activity junto a Features/Activity, con un único propietario de lectura y reintento. En refrescos con datos conservados, reutilizar el aviso compacto existente; mantener ErrorState para la indisponibilidad inicial de la superficie correspondiente.

**Regresión que debe cubrirse:** snapshot correcto más fallos simultáneos de usage/activity; controles de configuración visibles, avisos asociados a sus superficies y un único camino de reintento por lectura.

### F02 — P3. Formularios secundarios de AI Models y Agents omiten la receta de campos

**Ubicaciones activas:**

- `app/ui/src/components/ai-models/AddProviderDialog.tsx:107` y `:117`: Name/Address se componen con `label`, `space-y-1`, tipografía de cuerpo y color blanco con opacidad.
- `app/ui/src/components/agents/connections/OAuthApps.tsx:142`, `:166` y `:175`: Client ID, App name y Redirect URIs tienen `label` local y `gap-1.5`; el Switch en `:151` tiene otro label de cuerpo y separación local.
- `app/ui/src/components/ai-models/BillableTestDialog.tsx:126`, `app/ui/src/components/ai-models/ProfileForm.tsx:375` y `app/ui/src/components/agents/plan/DecisionBar.tsx:167`: acknowledgements con Checkbox usan label de cuerpo y `gap-3`.

Los controles base sí son compartidos, pero los captions y su composición no. El resultado vuelve a tener fuentes y separaciones de 4/6/12 px junto al contrato actual de MonoLabel y 8 px stacked / 16 px inline.

**Corrección mínima:** `FormField` stacked para Input/Textarea y `FormField layout="inline"` para Checkbox/Switch. Conservar asociaciones, hints, required, disabled y los textos completos de confirmación. No sustituir los formularios de dominio por otro fundamento.

**Regresión que debe cubrirse:** nombres accesibles y asociaciones se conservan; captions son MonoLabel real y el wrapper usa la receta compartida. Comprobar Address al cambiar a Ollama y el estado busy/acknowledged de las confirmaciones.

### F03 — P3. Quedan superficies translúcidas locales en interiores de Agents y AI Models

**Ubicación:** `app/ui/src/components/agents/plan/DecisionBar.tsx:23`; `app/ui/src/components/ai-models/AdvancedPanel.tsx:105`.

DecisionBar sigue usando una mezcla de color al 95 %, `backdrop-blur` y una sombra literal. ProfileItem usa `bg-white/[0.02]` y `border-white/10`. Son consumidores activos: AgentPlanDetail monta DecisionBar para planes pendientes y AdvancedPanel monta ProfileItem para los perfiles guardados. No se trata de código legacy sin ruta.

**Corrección mínima:** superficie sólida y borde con los tokens/recetas existentes. Preservar sticky, espacio inferior reservado y estados de expiración/conflicto de la barra de decisión. En ProfileItem, reutilizar la superficie operativa existente o su receta, sin añadir otra Card fundacional.

**Regresión que debe cubrirse:** revisar un plan largo con footer sticky y un perfil con historial desplegado; el cambio de superficie no debe tapar acciones ni recortar el contenido.

### F04 — P3. Los estados de la barra de decisión conservan iconos decorativos

**Ubicación:** `app/ui/src/components/agents/plan/DecisionBar.tsx:99` y `:127`.

Clock acompaña el mensaje de plan expirado y TriangleAlert el de lista incompleta. No son acciones y repiten información ya expresada por el texto. Se apartan de la regla confirmada para las superficies revisadas de Admin.

**Corrección mínima:** mantener el mensaje, tono semántico y `role="alert"`, retirando esos glifos y su separación local. No convertirlos en botones ni modificar el permiso para aprobar.

## Recurrencias de las capturas de Artist

Las cuatro incidencias del usuario se revisan en el arreglo de Artist de este mismo corte, por lo que no se cuentan otra vez en F01–F04:

- El hueco de Biography procede de la cabecera de `InstrumentPanel` con una acción de 44 px alineada al inicio y el margen posterior de cabecera. Comparar encabezado con/sin acción; no recortar el área táctil para comprimirlo.
- Missing albums es un **error auxiliar**, no un empty state de los álbumes locales. `Artist.tsx` lo monta antes de los tabs; la ausencia de álbumes locales tampoco tiene una rama EmptyState propia en ArtistDiscographySection.
- El grafo es el único instrumento interactivo de este tipo en Admin; su lista de controles añadida y el comportamiento de clic se revisan en su propio controlador. No se encontró otra lista alternativa accidental equivalente en las páginas activas.
- La regla inferior de acciones se fuerza en `ArtistHeroSection.actionsClassName`; AlbumHeader no la repite. Tabs mantiene su propio separador funcional y su indicador: no debe eliminarse globalmente para quitar la regla de Artist.

## Checklist y límites

| Comprobación dirigida                                   | Resultado                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Error auxiliar junto a la superficie a la que pertenece | Needs change: F01, además del arreglo de Artist                                                  |
| Empty/Error de página frente a estado de una colección  | Needs change: Discography, cubierto por el arreglo de Artist                                     |
| Hueco de cabecera producido por acciones                | Needs change: Biography; revisar en el contrato compartido y consumidores con acciones           |
| Regla extra explícita bajo acciones Hero                | Needs change: Artist; sin segunda instancia activa en Album                                      |
| Lista alternativa del grafo visible por accidente       | Needs change: ArtistNetworkGraph; sin segundo consumidor de otro instrumento con el mismo patrón |
| Captions de campos y controles comunes                  | Needs change: F02                                                                                |
| Superficies y glifos secundarios revisados              | Needs change: F03–F04                                                                            |
| Browse conserva covers cuadrados                        | Pass: excepción confirmada, no se propone cambiarla                                              |

Se recorrieron los usos de estados compartidos, InstrumentPanel/OpsPanel y headers de las rutas activas de catálogo, operaciones, configuración, AI Models, Agents y Federation. Se siguieron las ramas montadas antes de elevar findings. Se excluyen `UserMap` —Users ya no lo monta— y la rama colapsada de ShowCard —sin consumidor actual—, aunque conservan estilos antiguos en disco.

La revisión no ejecutó la suite completa ni midió el navegador. Las capturas del usuario son evidencia de las incidencias de Artist; F01–F04 se apoyan en código y contratos vigentes. Corresponde a cada corrección añadir su regresión focal y verificar su presentación real. No se reabre ninguno de los 29 findings históricos por conservar su número: estos son puntos concretos del estado actual que aún requieren trabajo.
